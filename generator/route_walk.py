"""
MÒDUL: route_walk.py
Motor de Rutes per a Vianants i Muntanya.
Calcula itineraris a peu prioritzant senders i camins de muntanya utilitzant OSMnx i NetworkX.
"""

import os
import sys
import re
import math
import logging
import gpxpy
import gpxpy.gpx
import networkx as nx

# -------------------------------------------------------------------------
# INTEGRACIÓ D'ARQUITECTURA I CONFIGURACIÓ CENTRAL
# -------------------------------------------------------------------------

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Importació centralitzada de directoris des de config.py
try:
    from config import DIR_PENDENTS
except ImportError:
    DIR_PENDENTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dades", "pendents"))

# Importació del netejador de geometries amb fallback de seguretat
try:
    from src.cleaner import netejar_punxes_i_teranyines
except ImportError:
    def netejar_punxes_i_teranyines(coords):
        return coords

# Comprovació de disponibilitat d'OSMnx
try:
    import osmnx as ox
    ox.settings.log_console = False
    ox.settings.use_cache = True
    HAS_OSMNX = True
except ImportError:
    HAS_OSMNX = False


# -------------------------------------------------------------------------
# FUNCIONS AUXILIARS I PARSEIG DE DADES
# -------------------------------------------------------------------------

def parsejar_i_netejar_coordenades(punts_bruts):
    """
    Normalitza i valida la llista de coordenades d'entrada.
    Accepta cadenes amb formats:
    - "Nom|Latitud,Longitud"
    - "Latitud,Longitud"
    - "[Latitud, Longitud]"
    - Llistes o tuples [Lat, Lon]
    """
    punts_netejats = []
    if len(punts_bruts) == 1 and isinstance(punts_bruts[0], str) and '\n' in punts_bruts[0]:
        punts_bruts = punts_bruts[0].split('\n')
        
    for element in punts_bruts:
        if not element or (isinstance(element, str) and not element.strip()):
            continue
        try:
            if isinstance(element, str):
                netejat = element.replace('[', '').replace(']', '').replace('"', '').strip()
                
                # Descomponem el nom si ve en format "Nom|Lat,Lon"
                if '|' in netejat:
                    netejat = netejat.split('|')[-1].strip()
                
                if ',' in netejat:
                    lat_s, lon_s = netejat.split(',')[:2]
                    punts_netejats.append([float(lat_s.strip()), float(lon_s.strip())])
            elif isinstance(element, (list, tuple)) and len(element) >= 2:
                punts_netejats.append([float(element[0]), float(element[1])])
        except Exception:
            continue
            
    return punts_netejats

def generar_i_desar_gpx(nom_ruta, coordenades, waypoints=None, prefix="walk_"):
    """
    Genera el fitxer GPX i el desa a la carpeta central de pendents (DIR_PENDENTS).
    """
    logging.info("=== Generació del fitxer GPX a peu ===")
    try:
        gpx = gpxpy.gpx.GPX()
        
        if waypoints:
            for w in waypoints:
                gpx.waypoints.append(gpxpy.gpx.GPXWaypoint(latitude=w['lat'], longitude=w['lon'], name=w['name']))
            logging.info(f"[OK] Injectats {len(waypoints)} Waypoints.")

        track = gpxpy.gpx.GPXTrack(name=nom_ruta)
        segment = gpxpy.gpx.GPXTrackSegment()
        for lat, lon in coordenades:
            segment.points.append(gpxpy.gpx.GPXTrackPoint(latitude=lat, longitude=lon))
        track.segments.append(segment)
        gpx.tracks.append(track)

        os.makedirs(DIR_PENDENTS, exist_ok=True)
        nom_net = prefix + re.sub(r'[^a-z0-9\-_.]', '_', nom_ruta.lower().strip()) + ".gpx"
        ruta_desti = os.path.join(DIR_PENDENTS, nom_net)

        with open(ruta_desti, 'w', encoding='utf-8') as f:
            f.write(gpx.to_xml())
            
        logging.info(f"[OK] Fitxer GPX guardat a: {nom_net}")
        return nom_net
    except Exception as e:
        logging.error(f"[ERROR] No s'ha pogut generar el GPX: {e}")
        return None


# -------------------------------------------------------------------------
# MOTOR DE RUTES A PEU (OSMnx / NetworkX)
# -------------------------------------------------------------------------

def calcular_ruta_caminant_local(nom_ruta, punts_gps):
    """
    Descarrega la xarxa de camins i carrers per a vianants al voltant dels punts,
    aplica penalitzacions a les carreteres principals i prioritza senders de muntanya.
    """
    punts_netejats = parsejar_i_netejar_coordenades(punts_gps)

    if len(punts_netejats) < 2:
        logging.warning("⚠️ Es necessiten com a mínim 2 punts per traçar una ruta a peu.")
        if punts_netejats:
            generar_i_desar_gpx(nom_ruta, punts_netejats)
        return punts_netejats

    if not HAS_OSMNX:
        logging.error("❌ La llibreria 'osmnx' no està instal·lada. Es generarà una línia directa.")
        generar_i_desar_gpx(nom_ruta, punts_netejats)
        return punts_netejats

    # 1. Definir l'àrea de cerca (Bounding Box) amb un marge reduït per a vianants
    lats = [p[0] for p in punts_netejats]
    lons = [p[1] for p in punts_netejats]
    
    nord, sud = max(lats) + 0.02, min(lats) - 0.02
    est, oest = max(lons) + 0.02, min(lons) - 0.02

    logging.info(f"🥾 Descarregant xarxa de vianants/muntanya per a: [{nom_ruta}]...")
    
    try:
        # Descarrega el graf del perfil de caminant (carrers, zones de vianants, senders, escales)
        G = ox.graph_from_bbox(
            bbox=(nord, sud, est, oest),
            network_type='walk',
            retain_all=False,
            simplify=True
        )
        
        # 2. Ponderació intel·ligent: avantatge a senders i penalització a asfalt
        for u, v, key, data in G.edges(keys=True, data=True):
            tipus = data.get('highway', '')
            if isinstance(tipus, list): 
                tipus = tipus[0]
                
            distancia_real = data.get('length', 1.0)
            multiplicador = 1.0
            
            if tipus in ['path', 'footway', 'pedestrian', 'steps']:
                multiplicador = 0.7   # Camí de muntanya / sender preferent
            elif tipus in ['track']:
                multiplicador = 1.0   # Pista forestal
            elif tipus in ['residential', 'living_street']:
                multiplicador = 1.8   # Carrers urbans
            elif tipus in ['tertiary', 'secondary', 'primary']:
                multiplicador = 5.0   # Carreteres principals (evitar)
                
            data['cost_caminar'] = distancia_real * multiplicador

    except Exception as e:
        logging.error(f"❌ Error descarregant o processant el graf de vianants: {e}")
        generar_i_desar_gpx(nom_ruta, punts_netejats)
        return punts_netejats

    # 3. Mapejar coordenades d'usuari als nodes més propers
    nodes_pas = []
    for lat, lon in punts_netejats:
        try:
            node = ox.nearest_nodes(G, X=lon, Y=lat)
            nodes_pas.append(node)
        except Exception as e:
            logging.warning(f"[AVÍS] No s'ha trobat cap node a prop de ({lat}, {lon}): {e}")
            continue

    if len(nodes_pas) < 2:
        logging.warning("[AVÍS] Nodes insuficients connectats al graf. Retornant coordenades directes.")
        generar_i_desar_gpx(nom_ruta, punts_netejats)
        return punts_netejats

    # 4. Càlcul del camí òptim basat en el cost personalitzat
    cami_nodes_total = []
    for i in range(len(nodes_pas) - 1):
        origen = nodes_pas[i]
        desti = nodes_pas[i+1]
        try:
            segment = nx.shortest_path(G, origen, desti, weight='cost_caminar')
            if i > 0: 
                segment = segment[1:]
            cami_nodes_total.extend(segment)
        except nx.NetworkXNoPath:
            logging.warning(f"[AVÍS] Sense camí trobat directament entre nodes {origen} i {desti}.")
            if origen not in cami_nodes_total: 
                cami_nodes_total.append(origen)
            cami_nodes_total.append(desti)

    # 5. Reconstrucció de la traça geogràfica a partir dels nodes
    coordenades_finals = []
    for idx in range(len(cami_nodes_total) - 1):
        u = cami_nodes_total[idx]
        v = cami_nodes_total[idx+1]
        dades_aresta = G.get_edge_data(u, v)
        
        if dades_aresta:
            data = dades_aresta[0] if 0 in dades_aresta else list(dades_aresta.values())[0]
            if 'geometry' in data:
                for lon_g, lat_g in list(data['geometry'].coords)[:-1]:
                    coordenades_finals.append([lat_g, lon_g])
            else:
                coordenades_finals.append([G.nodes[u]['y'], G.nodes[u]['x']])
        else:
            coordenades_finals.append([G.nodes[u]['y'], G.nodes[u]['x']])

    if cami_nodes_total:
        ultim_node = cami_nodes_total[-1]
        coordenades_finals.append([G.nodes[ultim_node]['y'], G.nodes[ultim_node]['x']])

    # 6. Post-processament de neteja
    coordenades_netes = netejar_punxes_i_teranyines(coordenades_finals)
    
    # 7. Desar fitxer GPX a la carpeta centralitzada
    generar_i_desar_gpx(nom_ruta, coordenades_netes)

    return coordenades_netes


# -------------------------------------------------------------------------
# EXECUCIÓ DES DE LÍNIA DE COMANDES (CLI)
# -------------------------------------------------------------------------

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")

    if len(sys.argv) < 3:
        logging.error("Ús: python route_walk.py <nom_ruta> <lat1,lon1> <lat2,lon2> ...")
        sys.exit(1)

    nom_de_la_ruta = sys.argv[1]
    arguments_punts = sys.argv[2:]

    logging.info(f"=== INICI RUTA A PEU: {nom_de_la_ruta} ===")
    calcular_ruta_caminant_local(nom_de_la_ruta, arguments_punts)