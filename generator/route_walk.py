import os
import sys
import re
import gpxpy
import gpxpy.gpx
import networkx as nx
import osmnx as ox

# Assegurem que el script pot importar components de la carpeta arrel
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from src.cleaner import calcular_distancia, netejar_punxes_i_teranyines

# Configurar OSMNX
ox.settings.log_console = False
ox.settings.use_cache = True

def calcular_ruta_caminant_local(nom_ruta, punts_gps):
    """
    Descarrega la xarxa de camins i carrers per a vianants al voltant dels punts,
    aplica penalitzacions a les carreteres grans i prioritza senders de muntanya.
    """
    if len(punts_gps) < 2:
        print("⚠️ Es necessiten com a mínim 2 punts per traçar una ruta a peu.")
        return punts_gps

    # 1. Definir l'àrea de cerca (Bounding Box) amb un marge de seguretat reduït (vianants fan trams més curts)
    lats = [p[0] for p in punts_gps]
    lons = [p[1] for p in punts_gps]
    
    nord, sud = max(lats) + 0.02, min(lats) - 0.02
    est, oest = max(lons) + 0.02, min(lons) - 0.02

    print(f"🥾 Descarregant xarxa de vianants/muntanya... [{nom_ruta}]")
    
    try:
        # Descarreguem el graf amb el perfil natiu de caminar (carrers, zones vianants, escales, senders)
        G = ox.graph_from_bbox(
            bbox=(nord, sud, est, oest),
            network_type='walk',
            retain_all=False,
            simplify=True
        )
        
        # 2. Ponderació intel·ligent: Donem avantatge als senders respecte a les carreteres asfaltades
        for u, v, key, data in G.edges(keys=True, data=True):
            tipus = data.get('highway', '')
            if isinstance(tipus, list): 
                tipus = tipus[0]
                
            distancia_real = data.get('length', 1.0)
            multiplicador = 1.0
            
            if tipus in ['path', 'footway', 'pedestrian', 'steps']:
                multiplicador = 0.7  # Camí preferent (escurça el cost fictici)
            elif tipus in ['track']:
                multiplicador = 1.0  # Pista forestal normal
            elif tipus in ['residential', 'living_street']:
                multiplicador = 1.8  # Carrers urbans (preferim muntanya si existeix)
            elif tipus in ['tertiary', 'secondary', 'primary']:
                multiplicador = 5.0  # Carreteres (evitar al màxim per seguretat)
                
            data['cost_caminar'] = distancia_real * multiplicador

    except Exception as e:
        print(f"❌ Error descarregant el graf de vianants: {e}")
        return punts_gps

    # 3. Mapejar coordenades de l'usuari als nodes més propers del graf
    nodes_pas = []
    for lat, lon in punts_gps:
        try:
            node = ox.nearest_nodes(G, X=lon, Y=lat)
            nodes_pas.append(node)
        except:
            continue

    if len(nodes_pas) < 2:
        return punts_gps

    # 4. Càlcul del camí òptim basat en el nostre pes personalitzat
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
            if origen not in cami_nodes_total: cami_nodes_total.append(origen)
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

    # Retornem passant el filtre final de neteja per eliminar micro-bucles
    return netejar_punxes_i_teranyines(coordenades_finals)


if __name__ == '__main__':
    """
    CLI: Execució directa des del sistema o subprocess
    Ús: python route_walk.py "Excursió Matagalls" "41.8,1.8" "41.81,1.82"
    """
    if len(sys.argv) < 4:
        print("Ús: python route_walk.py <nom_ruta> <lat1,lon1> <lat2,lon2> ...")
        sys.exit(1)

    nom_de_la_ruta = sys.argv[1]
    arguments_punts = sys.argv[2:]
    
    punts_entrada = []
    for arg in arguments_punts:
        netejat = arg.replace('[', '').replace(']', '').replace('"', '').strip()
        if ',' in netejat:
            lat_str, lon_str = netejat.split(',')
            punts_entrada.append([float(lat_str), float(lon_str)])

    ruta_caminada = calcular_ruta_caminant_local(nom_de_la_ruta, punts_entrada)

    # Construir l'arxiu GPX final
    gpx = gpxpy.gpx.GPX()
    track = gpxpy.gpx.GPXTrack(name=nom_de_la_ruta)
    segment = gpxpy.gpx.GPXTrackSegment()

    for lat, lon in ruta_caminada:
        segment.points.append(gpxpy.gpx.GPXTrackPoint(latitude=lat, longitude=lon))

    track.segments.append(segment)
    gpx.tracks.append(track)

    # Desa directe a la carpeta central de pendents
    DIR_PENDENTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dades", "pendents"))
    os.makedirs(DIR_PENDENTS, exist_ok=True)
    
    nom_net_fitxer = "walk_" + re.sub(r'[^\w\-_.]', '_', nom_de_la_ruta.lower().strip()) + ".gpx"
    ruta_desti = os.path.join(DIR_PENDENTS, nom_net_fitxer)

    with open(ruta_desti, 'w', encoding='utf-8') as f:
        f.write(gpx.to_xml())

    print(f"✨ Èxit! Traçat de muntanya guardat a: {ruta_desti}")