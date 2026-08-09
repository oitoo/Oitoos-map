"""
MÒDUL: build_route_map.py
Connecta amb OpenStreetMap (Overpass), gestiona la memòria cau i crea el graf ferroviari (NetworkX).
"""

import requests
import networkx as nx
import math
import os
import pickle
import re
import logging
import sys

# Intentem importar la configuració central (afegint el directori pare al path)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
try:
    from config import DIR_GENERATOR
    DIR_CACHE = os.path.join(DIR_GENERATOR, 'graph_cache')
except ImportError:
    # Fallback per si s'executa aïlladament
    DIR_CACHE = os.path.join(os.path.dirname(__file__), 'graph_cache')


# -------------------------------------------------------------------------
# FUNCIONS AUXILIARS DE GEOMETRIA
# -------------------------------------------------------------------------

def calcular_distancia_haversine(lat1, lon1, lat2, lon2):
    R = 6371000  
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def calcular_bounding_box(punts_gps):
    lats = [p[0] for p in punts_gps]
    lons = [p[1] for p in punts_gps]
    
    dist_total = calcular_distancia_haversine(min(lats), min(lons), max(lats), max(lons))
    marge_dinamic = min(0.30, max(0.08, (dist_total / 1000) / 3000)) 
    
    return (
        min(lats) - marge_dinamic, 
        min(lons) - marge_dinamic, 
        max(lats) + marge_dinamic, 
        max(lons) + marge_dinamic
    ), marge_dinamic


# -------------------------------------------------------------------------
# SUBLÒGIQUES DE CAU, DESCÀRREGA I CONSTRUCCIÓ
# -------------------------------------------------------------------------

def buscar_a_memoria_cau(req_bbox, mode_ruta):
    os.makedirs(DIR_CACHE, exist_ok=True)
    req_min_lat, req_min_lon, req_max_lat, req_max_lon = req_bbox
    TOLERANCIA = 0.005  
    patro_coords = re.compile(r"graf_([a-z_]+)_(-?\d+(?:\.\d+)?)\_(-?\d+(?:\.\d+)?)\_(-?\d+(?:\.\d+)?)\_(-?\d+(?:\.\d+)?)\.pkl")

    fitxers = [f for f in os.listdir(DIR_CACHE) if f.endswith('.pkl')]
    logging.info(f"[CACHE CHECK] Analitzant {len(fitxers)} arxius a 'graph_cache'...")

    for nom_arxiu in fitxers:
        ruta_completa = os.path.join(DIR_CACHE, nom_arxiu)
        mode_guardat, c_min_lat, c_min_lon, c_max_lat, c_max_lon = None, None, None, None, None
        G_candidat = None

        match = patro_coords.match(nom_arxiu)
        if match:
            mode_guardat = match.group(1)
            c_min_lat, c_min_lon, c_max_lat, c_max_lon = map(float, match.groups()[1:])
        else:
            try:
                with open(ruta_completa, 'rb') as f: G_candidat = pickle.load(f)
                mode_guardat = G_candidat.graph.get('mode')
                if 'bbox' in G_candidat.graph:
                    c_min_lat, c_min_lon, c_max_lat, c_max_lon = G_candidat.graph['bbox']
            except Exception:
                continue

        if c_min_lat is not None and mode_guardat is not None:
            coberta_lat = (c_min_lat - TOLERANCIA) <= req_min_lat and (c_max_lat + TOLERANCIA) >= req_max_lat
            coberta_lon = (c_min_lon - TOLERANCIA) <= req_min_lon and (c_max_lon + TOLERANCIA) >= req_max_lon
            
            if coberta_lat and coberta_lon and mode_guardat == mode_ruta:
                if match:
                    try:
                        with open(ruta_completa, 'rb') as f: return pickle.load(f), ruta_completa
                    except Exception: continue
                return G_candidat, ruta_completa
                
    return None, None

def descarregar_dades_overpass(req_bbox, mode_ruta):
    req_min_lat, req_min_lon, req_max_lat, req_max_lon = req_bbox
    
    if mode_ruta == "via_estreta":
        via_query = f'way["railway"~"rail|narrow_gauge|light_rail|funicular|miniature"][!"service"]({req_min_lat},{req_min_lon},{req_max_lat},{req_max_lon});'
    elif mode_ruta == "historic":
        via_query = f'way["railway"~"rail|narrow_gauge"][!"service"]["highspeed"!="yes"]({req_min_lat},{req_min_lon},{req_max_lat},{req_max_lon});'
    else:
        via_query = f'way["railway"="rail"][!"service"]({req_min_lat},{req_min_lon},{req_max_lat},{req_max_lon});'

    query_str = f'[out:json][timeout:250];({via_query}node["railway"~"station|halt"]({req_min_lat},{req_min_lon},{req_max_lat},{req_max_lon}););(._; >;);out body qt;'
    servidors = [
        "https://overpass-api.de/api/interpreter", 
        "https://overpass.openstreetmap.fr/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    ]
    headers = {'User-Agent': 'TrainGPXPlanner/23.0'}
    
    for idx, url in enumerate(servidors):
        try:
            logging.info(f"[API] Connectant al Servidor Overpass {idx+1}...")
            response = requests.post(url, data={'data': query_str}, headers=headers, timeout=260)
            if response.status_code == 200:
                logging.info(f"[API ÈXIT] Dades descarregades. Processant geometria...")
                return response.json().get('elements', [])
            logging.warning(f"[API AVÍS] Servidor {idx+1} ha rebutjat la petició (Codi {response.status_code}).")
        except Exception as e:
            logging.error(f"[API ERROR] Servidor {idx+1} no respon ({type(e).__name__}).")
            
    return None

def construir_graf_matematic(elements, mode_ruta, req_bbox):
    G_final = nx.Graph()
    estacions_globals, noms_indexats = [], set()
    
    # 1. Indexació de Nodes i Estacions
    for el in elements:
        if el['type'] == 'node':
            G_final.add_node(el['id'], y=float(el['lat']), x=float(el['lon']))
            tags = el.get('tags', {})
            if tags.get('railway') in ['station', 'halt']:
                nom = tags.get('name:en') or tags.get('int_name') or tags.get('name:pinyin') or tags.get('name')
                if nom:
                    nom_net = nom.strip().lower()
                    if 'bus' not in nom_net and 'metro' not in nom_net and nom_net not in noms_indexats:
                        noms_indexats.add(nom_net)
                        estacions_globals.append({'nom': nom.strip(), 'lat': float(el['lat']), 'lon': float(el['lon'])})

    # 2. Connexió d'Arestes i Pesos
    for el in elements:
        if el['type'] == 'way':
            tags = el.get('tags', {})
            rw = tags.get('railway')
            if rw in ['rail', 'narrow_gauge', 'light_rail', 'funicular', 'miniature']:
                factor = 1.0
                usage = tags.get('usage', '')
                
                if rw == 'narrow_gauge': factor = 0.5 if mode_ruta == "via_estreta" else 2.0
                elif usage == 'main': factor = 1.0  
                elif usage == 'branch': factor = 3.0 
                else: factor = 5.0
                    
                if mode_ruta == "modern" and tags.get('highspeed') == 'yes': factor = 0.5 
                
                nodes = el['nodes']
                for u, v in zip(nodes[:-1], nodes[1:]):
                    if G_final.has_node(u) and G_final.has_node(v):
                        dist = calcular_distancia_haversine(G_final.nodes[u]['y'], G_final.nodes[u]['x'], G_final.nodes[v]['y'], G_final.nodes[v]['x'])
                        pes = dist * factor
                        
                        if G_final.has_edge(u, v):
                            if G_final[u][v]['weight'] > pes:
                                G_final[u][v]['weight'] = pes
                                G_final[u][v]['way_id'] = str(el['id'])
                        else:
                            G_final.add_edge(u, v, weight=pes, length=dist, way_id=str(el['id']))

    # 3. Neteja de components petits i metadades
    components = [c for c in nx.connected_components(G_final) if len(c) >= 3]
    if components:
        G_final = G_final.subgraph(set.union(*components)).copy()
        
    G_final.graph.update({
        'mode': mode_ruta, 
        'osm_stations': estacions_globals, 
        'bbox': req_bbox
    })
    
    return G_final


# -------------------------------------------------------------------------
# ORQUESTRADOR PRINCIPAL
# -------------------------------------------------------------------------

def descarregar_graf_ferroviari_unificat(punts_gps, mode_ruta="historic"):
    if isinstance(mode_ruta, bool): mode_ruta = "historic" if mode_ruta else "modern"
    if len(punts_gps) < 2: return None

    logging.info(f"=== MOTOR OVERPASS | MODE: {mode_ruta.upper()} ===")

    # 1. Càlcul de la capsa
    req_bbox, marge = calcular_bounding_box(punts_gps)
    req_min_lat, req_min_lon, req_max_lat, req_max_lon = req_bbox

    # 2. Cercar a la Memòria Cau
    G_carregat, ruta_cache = buscar_a_memoria_cau(req_bbox, mode_ruta)
    if G_carregat:
        logging.info(f"[CACHE ÈXIT] Mapa reutilitzat: {os.path.basename(ruta_cache)}. Nodes actius: {len(G_carregat.nodes)}")
        return G_carregat

    # 3. Descàrrega API Overpass
    logging.info(f"[XARXA] Nova Capsa demanada (Marge {marge:.2f}º): {req_min_lat:.3f},{req_min_lon:.3f} a {req_max_lat:.3f},{req_max_lon:.3f}")
    elements = descarregar_dades_overpass(req_bbox, mode_ruta)
    
    if not elements:
        logging.error("[ERROR CRÍTIC] Cap servidor ha pogut processar la capsa.")
        return None

    # 4. Construcció del Graf
    G_final = construir_graf_matematic(elements, mode_ruta, req_bbox)
    
    # 5. Desar a la cau
    fitxer_cache = os.path.join(DIR_CACHE, f"graf_{mode_ruta}_{req_min_lat:.3f}_{req_min_lon:.3f}_{req_max_lat:.3f}_{req_max_lon:.3f}.pkl")
    try:
        with open(fitxer_cache, 'wb') as f: pickle.dump(G_final, f)
        logging.info(f"[DESAT EN CAU] Mapa guardat a: {os.path.basename(fitxer_cache)}")
    except Exception as e:
        logging.warning(f"[AVÍS CAU] No s'ha pogut desar el fitxer a disc ({e}).")
        
    logging.info(f"[ÈXIT] Graf unificat llest! Nodes connectats: {len(G_final.nodes)} | Estacions: {len(G_final.graph['osm_stations'])}")
    return G_final