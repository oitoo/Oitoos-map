"""
MÒDUL: route_train.py
Motor Ferroviari Global. Calcula la ruta real del tren seguint l'orografia i vies d'OSM.
"""

import os
import sys
import re
import math
import json
import gpxpy
import gpxpy.gpx
import networkx as nx
import logging

# Intentem importar variables globals
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
try:
    from config import DIR_PENDENTS
except ImportError:
    DIR_PENDENTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dades", "pendents"))

try:
    from generator.build_route_map import descarregar_graf_ferroviari_unificat
except ImportError:
    from build_route_map import descarregar_graf_ferroviari_unificat


# -------------------------------------------------------------------------
# FUNCIONS AUXILIARS I TRACTAMENT DE DADES
# -------------------------------------------------------------------------

def calcular_distancia_haversine_local(lat1, lon1, lat2, lon2):
    R = 6371000  
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def parsejar_i_netejar_coordenades(punts_bruts):
    punts_netejats = []
    if len(punts_bruts) == 1 and isinstance(punts_bruts[0], str) and '\n' in punts_bruts[0]:
        punts_bruts = punts_bruts[0].split('\n')
        
    comptador = 1
    for element in punts_bruts:
        if not element or not element.strip(): continue
        try:
            nom = f"Estació {comptador}"
            if isinstance(element, str):
                if '|' in element:
                    parts = element.split('|')
                    nom = parts[0].strip()
                    element = parts[1]
                netejat = element.replace('[', '').replace(']', '').replace('"', '').strip()
                if ',' in netejat:
                    lat_s, lon_s = netejat.split(',')
                    punts_netejats.append([float(lat_s.strip()), float(lon_s.strip()), nom])
                    comptador += 1
            elif isinstance(element, (list, tuple)) and len(element) >= 2:
                if len(element) >= 3: nom = element[2]
                punts_netejats.append([float(element[0]), float(element[1]), nom])
                comptador += 1
        except Exception:
            continue
    return punts_netejats


# -------------------------------------------------------------------------
# FILTRES I ESTRATÈGIES DE XARXA
# -------------------------------------------------------------------------

def penalitzar_vies_servei_i_detours(G):
    comptador = 0
    for u, v, data in G.edges(data=True):
        es_servei = False
        if data.get('railway') == 'service' or data.get('service'):
            es_servei = True
        elif 'tags' in data and isinstance(data['tags'], dict):
            if data['tags'].get('railway') == 'service' or data['tags'].get('service'):
                es_servei = True
                
        if es_servei:
            data['weight'] = data.get('weight', 1.0) * 2000.0
            comptador += 1
    if comptador > 0:
        logging.info(f"[FILTRE] Penalitzades {comptador} arestes de servei (Blindatge del tronc principal).")

def penalitzar_vies_per_modalitat(G, mode_ruta):
    comptador = 0
    for u, v, data in G.edges(data=True):
        tags = data.get('tags', {})
        es_hsr = ('highspeed' in tags and tags['highspeed'] == 'yes') or data.get('highspeed') == 'yes'
        rw = tags.get('railway') or data.get('railway')
        
        if mode_ruta == "historic" and es_hsr:
            data['weight'] = data.get('weight', 1.0) * 50.0
            comptador += 1
        elif mode_ruta == "modern" and not es_hsr:
            data['weight'] = data.get('weight', 1.0) * 15.0
            comptador += 1
        elif mode_ruta == "via_estreta" and rw == "narrow_gauge":
            data['weight'] = data.get('weight', 1.0) * 0.2
            comptador += 1
            
    if comptador > 0:
        logging.info(f"[TAXACIÓ] S'han ajustat {comptador} segments pel criteri de modalitat ({mode_ruta}).")

def aplicar_bloquejos_usuari(G, vies_bloquejades_str):
    if vies_bloquejades_str == "none" or not vies_bloquejades_str: return
        
    llista_ids = vies_bloquejades_str.split(',')
    comptador = 0
    
    for u, v, data in list(G.edges(data=True)):
        if str(data.get('way_id', '')) in llista_ids:
            G.remove_edge(u, v)
            comptador += 1
            
    if comptador > 0:
        logging.info(f"[RESTRICCIÓ UI] Talls quirúrgics aplicats: {comptador} segments esborrats per petició de l'usuari.")

def injectar_switches_manuals(G, custom_switches, radi_max_metres=12):
    if not custom_switches: return
    if isinstance(custom_switches, str):
        try: custom_switches = json.loads(custom_switches)
        except Exception: custom_switches = []

    comptador = 0
    for sw in custom_switches:
        if isinstance(sw, dict) and 'lat' in sw and 'lon' in sw:
            lat_sw, lon_sw = float(sw['lat']), float(sw['lon'])
        elif isinstance(sw, (list, tuple)) and len(sw) >= 2:
            lat_sw, lon_sw = float(sw[0]), float(sw[1])
        else: continue

        candidats = []
        for node, data in G.nodes(data=True):
            dist = calcular_distancia_haversine_local(lat_sw, lon_sw, data['y'], data['x'])
            if dist <= radi_max_metres:
                candidats.append((dist, node))

        candidats.sort(key=lambda x: x[0])

        if len(candidats) >= 2:
            nodes_triats = [n for _, n in candidats[:3]]
            node_entrada = nodes_triats[0] 
            for node_sortida in nodes_triats[1:]:
                if not G.has_edge(node_entrada, node_sortida):
                    G.add_edge(node_entrada, node_sortida, weight=0.1, length=2.0, service='switch_quirurgic')
                    comptador += 1

    if comptador > 0:
        logging.info(f"[SWITCH QUIRÚRGIC] Injectades {comptador} branques d'agulla de precisió (Topologia 1-a-2).")


# -------------------------------------------------------------------------
# CÀLCUL ESPACIAL I GEOMETRIA DE CONNEXIÓ
# -------------------------------------------------------------------------

def obtenir_candidats_estacio(G, lat, lon, nom_estacio, radi_base=400):
    estacions_osm = G.graph.get('osm_stations', [])
    nom_buscat = re.sub(r'[^a-z0-9]', '', nom_estacio.lower())
    SUFIXOS_DIRECCIONALS = {'bei', 'nan', 'xi', 'dong', 'north', 'south', 'west', 'east', 'central'}
    
    centres_a_avaluar = [(lat, lon)]
    nom_oficial, millor_st_osm, st_parcial = None, None, None
    min_dist_exacta, min_dist_parcial = float('inf'), float('inf')
    
    for st in estacions_osm:
        nom_st_clean = re.sub(r'[^a-z0-9]', '', st['nom'].lower())
        dy = (st['lat'] - lat) * 111.0
        dx = (st['lon'] - lon) * 111.0 * math.cos(math.radians(lat))
        dist_km = math.sqrt(dx*dx + dy*dy)
        
        if nom_buscat and nom_st_clean:
            if nom_buscat == nom_st_clean:
                if dist_km < 15.0 and dist_km < min_dist_exacta:
                    min_dist_exacta, millor_st_osm = dist_km, st
            elif nom_buscat in nom_st_clean or nom_st_clean in nom_buscat:
                diferencia = nom_st_clean.replace(nom_buscat, '')
                te_sufix = any(suf in diferencia for suf in SUFIXOS_DIRECCIONALS)
                max_dist = 1.5 if te_sufix else 4.0
                if dist_km <= max_dist and dist_km < min_dist_parcial:
                    min_dist_parcial, st_parcial = dist_km, st

    st_triada = millor_st_osm or st_parcial
    if st_triada:
        centres_a_avaluar.append((st_triada['lat'], st_triada['lon']))
        nom_oficial = st_triada['nom']

    candidats_set = set()
    min_dist_global = float('inf')
    millor_node_absolut = None
    nodes_amb_dist = []
    
    for node, data in G.nodes(data=True):
        dist_min_node = float('inf')
        for c_lat, c_lon in centres_a_avaluar:
            dx_m = (data['x'] - c_lon) * 111000 * math.cos(math.radians(c_lat))
            dy_m = (data['y'] - c_lat) * 111000
            dist_m = math.sqrt(dx_m*dx_m + dy_m*dy_m)
            if dist_m < dist_min_node: dist_min_node = dist_m
        
        nodes_amb_dist.append((node, dist_min_node))
        if dist_min_node < min_dist_global:
            min_dist_global, millor_node_absolut = dist_min_node, node

    for r in [radi_base, 2000, 5000]:
        cands = [n for n, d in nodes_amb_dist if d <= r]
        if cands:
            candidats_set.update(cands)
            break
            
    if not candidats_set: candidats_set.add(millor_node_absolut)
    candidats_llista = list(candidats_set)

    if len(candidats_llista) > 12:
        candidats_llista.sort(key=lambda n: min(
            math.sqrt(((G.nodes[n]['x']-clon)*111000)**2 + ((G.nodes[n]['y']-clat)*111000)**2)
            for clat, clon in centres_a_avaluar
        ))
        candidats_llista = candidats_llista[:12]

    return candidats_llista, nom_oficial if nom_oficial else nom_estacio, min_dist_global, (lat, lon)

def trobar_i_cosir_en_memoria(G, cands_origen, cands_desti):
    paths_A, costs_A = {}, {}
    for u in cands_origen:
        try:
            c_u, p_u = nx.single_source_dijkstra(G, source=u, weight='weight')
            paths_A[u], costs_A[u] = p_u, c_u
        except Exception: pass

    paths_B, costs_B = {}, {}
    G_rev = G.reverse(copy=False) if G.is_directed() else G
    for v in cands_desti:
        try:
            c_v, p_v = nx.single_source_dijkstra(G_rev, source=v, weight='weight')
            paths_B[v], costs_B[v] = p_v, c_v
        except Exception: pass

    nodes_reach_A = set().union(*(paths_A[u].keys() for u in paths_A))
    nodes_reach_B = set().union(*(paths_B[v].keys() for v in paths_B))

    if not nodes_reach_A or not nodes_reach_B:
        return None, float('inf'), None, None

    min_gap = float('inf')
    best_u, best_v = None, None
    coords_B = [(G.nodes[v]['y'], G.nodes[v]['x'], v) for v in nodes_reach_B]

    for u_node in nodes_reach_A:
        lat_u, lon_u = G.nodes[u_node]['y'], G.nodes[u_node]['x']
        for lat_v, lon_v, v_node in coords_B:
            if abs(lat_u - lat_v) > 0.08 or abs(lon_u - lon_v) > 0.08: continue
            d = calcular_distancia_haversine_local(lat_u, lon_u, lat_v, lon_v)
            if d < min_gap:
                min_gap, best_u, best_v = d, u_node, v_node

    if best_u is None:
        for u_node in nodes_reach_A:
            lat_u, lon_u = G.nodes[u_node]['y'], G.nodes[u_node]['x']
            for lat_v, lon_v, v_node in coords_B:
                d = calcular_distancia_haversine_local(lat_u, lon_u, lat_v, lon_v)
                if d < min_gap: min_gap, best_u, best_v = d, u_node, v_node

    if best_u is None or best_v is None: return None, float('inf'), None, None

    connexions = []
    for u_orig in cands_origen:
        if u_orig in paths_A and best_u in paths_A[u_orig]:
            for v_dest in cands_desti:
                if v_dest in paths_B and best_v in paths_B[v_dest]:
                    path = paths_A[u_orig][best_u] + list(reversed(paths_B[v_dest][best_v]))
                    cost = costs_A[u_orig][best_u] + costs_B[v_dest][best_v] + (min_gap * 50.0) + 500.0
                    connexions.append((u_orig, v_dest, cost, path))

    return connexions, min_gap, best_u, best_v


# -------------------------------------------------------------------------
# GENERADOR GPX I MOTOR PRINCIPAL
# -------------------------------------------------------------------------

def generar_i_desar_gpx(nom_ruta, coordenades, waypoints=None):
    logging.info("=== Generació del fitxer GPX Jeràrquic ===")
    try:
        gpx = gpxpy.gpx.GPX()
        if waypoints:
            for w in waypoints:
                gpx.waypoints.append(gpxpy.gpx.GPXWaypoint(latitude=w['lat'], longitude=w['lon'], name=w['name']))
            logging.info(f"[OK] Injectats {len(waypoints)} Waypoints dinàmics.")

        track = gpxpy.gpx.GPXTrack(name=nom_ruta)
        segment = gpxpy.gpx.GPXTrackSegment()
        for lat, lon in coordenades:
            segment.points.append(gpxpy.gpx.GPXTrackPoint(latitude=lat, longitude=lon))
        track.segments.append(segment)
        gpx.tracks.append(track)

        os.makedirs(DIR_PENDENTS, exist_ok=True)
        nom_net = re.sub(r'[^a-z0-9\-_.]', '_', nom_ruta.lower().strip()) + ".gpx"
        ruta_desti = os.path.join(DIR_PENDENTS, nom_net)

        with open(ruta_desti, 'w', encoding='utf-8') as f:
            f.write(gpx.to_xml())
        logging.info(f"[OK] Fitxer creat a: {nom_net}")
        return nom_net
    except Exception as e:
        logging.error(f"[ERROR] Generant GPX: {e}")
        return None

def calcular_cami_ferroviari(nom_ruta, str_bloquejos, punts_gps, custom_switches=None):
    logging.info("=== Motor de Rutes Global (Programació Dinàmica & Súper-Graf) ===")
    punts_netejats = parsejar_i_netejar_coordenades(punts_gps)
    
    if len(punts_netejats) < 2:
        coords_directes = [[p[0], p[1]] for p in punts_netejats]
        generar_i_desar_gpx(nom_ruta, coords_directes)
        return coords_directes

    nom_lower = nom_ruta.lower()
    if any(k in nom_lower for k in ["via estreta", "narrow", "muntanya", "turístic", "cremallera", "funicular"]):
        mode_ruta = "via_estreta"
    elif any(k in nom_lower for k in ["regional", "històric", "historic", "convencional"]):
        mode_ruta = "historic"
    else:
        mode_ruta = "modern"

    logging.info(f"[DETECCIÓ] Modalitat de ruta detectada: {mode_ruta.upper()}")

    G = descarregar_graf_ferroviari_unificat(punts_netejats, mode_ruta=mode_ruta)
    if G is None or len(G.nodes) == 0:
        coords_directes = [[p[0], p[1]] for p in punts_netejats]
        return generar_i_desar_gpx(nom_ruta, coords_directes) or coords_directes

    penalitzar_vies_servei_i_detours(G)
    penalitzar_vies_per_modalitat(G, mode_ruta)
    aplicar_bloquejos_usuari(G, str_bloquejos)
    injectar_switches_manuals(G, custom_switches)

    logging.info("=== Càlcul Global (Avaluació Multi-Candidat amb Graf Dirigit) ===")
    estacions_dades = []
    for lat, lon, nom in punts_netejats:
        cands, nom_definitiu, _, (base_lat, base_lon) = obtenir_candidats_estacio(G, lat, lon, nom)
        nom_segur = nom_definitiu.encode('utf-8', errors='ignore').decode('utf-8')
        logging.info(f"[ANÀLISI] '{nom_segur}': {len(cands)} nodes candidats per a l'andana.")
        estacions_dades.append({'nom': nom_definitiu, 'candidats': cands})

    DAG = nx.DiGraph()
    memoria_camins = {} 

    # 1. Transvasament intern entre andanes
    for i, est in enumerate(estacions_dades):
        for u in est['candidats']:
            for v in est['candidats']:
                if u != v:
                    dist = calcular_distancia_haversine_local(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x'])
                    DAG.add_edge((i, u), (i, v), weight=dist * 2.0 + 10.0)
                    memoria_camins[(i, u, v)] = [u, v]

    # 2. Avaluar connexions entre estacions
    for i in range(len(estacions_dades) - 1):
        cands_origen, cands_desti = estacions_dades[i]['candidats'], estacions_dades[i+1]['candidats']
        connexio_trobada = False

        # Intent A: Cerca Directa
        for u in cands_origen:
            try:
                costs, paths = nx.single_source_dijkstra(G, source=u, weight='weight')
                for v in cands_desti:
                    if v in costs:
                        DAG.add_edge((i, u), (i+1, v), weight=costs[v])
                        memoria_camins[(i, u, v)] = paths[v]
                        connexio_trobada = True
            except Exception: continue

        # Intent B: Cosit Virtual en Memòria
        if not connexio_trobada:
            logging.warning(f"[COSIT] Buscant bretxes físiques entre estacions {i+1} i {i+2}...")
            connexions, min_gap, _, _ = trobar_i_cosir_en_memoria(G, cands_origen, cands_desti)
            if connexions:
                logging.info(f"[COSIT OK] Ruptura salvada ({min_gap:.1f}m). {len(connexions)} unions creades.")
                for u_orig, v_dest, cost_c, path_c in connexions:
                    DAG.add_edge((i, u_orig), (i+1, v_dest), weight=cost_c)
                    memoria_camins[(i, u_orig, v_dest)] = path_c
                connexio_trobada = True

        # Intent C: Emergència (Línia Recta de Tram)
        if not connexio_trobada:
            logging.error(f"[AVÍS] Tram {i+1}-{i+2} aïllat! Generant línia recta de seguretat.")
            for u in cands_origen:
                for v in cands_desti:
                    dist = calcular_distancia_haversine_local(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x'])
                    DAG.add_edge((i, u), (i+1, v), weight=1000000.0 + dist)
                    memoria_camins[(i, u, v)] = [u, v]

    # 3. Resolució del Súper-Graf
    DAG.add_node('INICI')
    DAG.add_node('FINAL')
    for u in estacions_dades[0]['candidats']:
        if DAG.has_node((0, u)): DAG.add_edge('INICI', (0, u), weight=0)
    for v in estacions_dades[-1]['candidats']:
        if DAG.has_node((len(estacions_dades)-1, v)): DAG.add_edge((len(estacions_dades)-1, v), 'FINAL', weight=0)

    try:
        cost_total, seq_dag = nx.single_source_dijkstra(DAG, source='INICI', target='FINAL', weight='weight')
        logging.info(f"[ÈXIT GLOBAL] Ruta òptima trobada! Cost combinat: {cost_total:.2f}")
    except nx.NetworkXNoPath:
        logging.error("[FALLBACK] Sense connexió global. Retornant geometria directa.")
        coords_directes = [[p[0], p[1]] for p in punts_netejats]
        generar_i_desar_gpx(nom_ruta, coords_directes)
        return coords_directes

    # 4. Construcció de la Geometria Geogràfica
    nodes_finals, waypoints_calibrats, visitades = [], [], set()
    seq_real = seq_dag[1:-1]
    
    for idx in range(len(seq_real)):
        st_idx, u = seq_real[idx]
        if st_idx not in visitades:
            waypoints_calibrats.append({'name': estacions_dades[st_idx]['nom'], 'lat': G.nodes[u]['y'], 'lon': G.nodes[u]['x']})
            visitades.add(st_idx)
        
        if idx < len(seq_real) - 1:
            st_next, v = seq_real[idx+1]
            tram = memoria_camins.get((st_idx, u, v), [u, v])
            if nodes_finals: nodes_finals.extend(tram[1:]) 
            else: nodes_finals.extend(tram)

    coords_finals = [[G.nodes[n]['y'], G.nodes[n]['x']] for n in nodes_finals]
    generar_i_desar_gpx(nom_ruta, coords_finals, waypoints=waypoints_calibrats)
    return coords_finals

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
    if len(sys.argv) < 5:
        logging.error("Ús: python route_train.py <nom_ruta> <vies_bloquejades> <punt1> <punt2> ... [custom_switches_json]")
        sys.exit(1)
    
    switches_arg = sys.argv[-1] if len(sys.argv) >= 6 and (sys.argv[-1].startswith('[') or sys.argv[-1].startswith('{')) else None
    punts_args = sys.argv[3:-1] if switches_arg else sys.argv[3:]

    calcular_cami_ferroviari(sys.argv[1], sys.argv[2], punts_args, custom_switches=switches_arg)