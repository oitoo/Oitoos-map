"""
===========================================================================
MANIFEST DEL MÒDUL: gpx_manager.py (El Gestor de Traçats GPX)
===========================================================================
OBJECTIU: 
    Actuar com la capa d'abstracció i manipulació de fitxers de telemetria 
    geogràfica (GPX). S'encarrega d'interpretar, predir, fusionar i exportar 
    les rutes dels usuaris amb garanties d'integritat estructural XML.

ESTRATÈGIA VIGENT: "Processament Asíncron Estricte i Predicció Híbrida"
    - FASE 1 (Extracció Nadiua): Es llegeixen els arxius exclusivament en mode 
      binari ('rb') per blindar el parser expat/XML davant d'etiquetes de codificació 
      o accents estranys que trenquin l'aplicació.
    - FASE 2 (Predicció del Transport): Es fa servir una heurística combinada de 
      tres nivells: 
         a) Semàntica de fitxer (paraules clau amb regex tolerant a sanitarització).
         b) Telemetria dinàmica (velocitat mitjana real i màxima extreta dels timestamps).
         c) Densitat i distància espacial (salts >150m i distàncies totals >50km delaten el 
            tren o vehicle quan les rutes es fan servir sense dades de temps).
    - FASE 3 (Costura de Rutes): L'algoritme troba el punt de tangència més proper 
      a la coordenada de selecció de l'usuari (click) per retallar el traçat A 
      i enllaçar-lo amb el traçat B de forma coherent.
===========================================================================
"""

import os
import re
import unicodedata
import gpxpy
import gpxpy.gpx
from datetime import date
from src.cleaner import calcular_distancia

# -------------------------------------------------------------------------
# FUNCIONS D'UTILITAT I NORMALITZACIÓ
# -------------------------------------------------------------------------

def normalitzar_text(text):
    """Elimina accents, diacrítics i converteix a minúscules."""
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return text.lower()


# -------------------------------------------------------------------------
# FASE 1: EXTRACCIÓ I LECTURA DE DADES PURES
# -------------------------------------------------------------------------

def extreure_dades_completes_gpx(gpx_path):
    """
    [LECTURA] Obre i parseja un fitxer GPX una sola vegada.
    Retorna les coordenades netes, els Waypoints (tractats com estacions) i la data real de captura.
    """
    coordenades = []
    estacions = []
    data_gpx = None

    if not os.path.exists(gpx_path):
        return coordenades, estacions, data_gpx

    try:
        # 🌟 BLINDATGE NADIU: Obrim en mode binari ('rb') perquè el parser XML gestioni l'UTF-8 de forma nativa
        with open(gpx_path, 'rb') as f:
            gpx = gpxpy.parse(f)
            
        # 1. Extreure coordenades dels Tracks actius (Rutes gravades en calent)
        for track in gpx.tracks:
            for segment in track.segments:
                for point in segment.points:
                    coordenades.append([point.latitude, point.longitude])
                    if not data_gpx and point.time:
                        data_gpx = point.time.strftime('%Y-%m-%d')
                        
        # 2. Si no té tracks, mirem si s'ha guardat com a element 'route' (Rutes planejades en fred)
        if not coordenades:
            for route in gpx.routes:
                for point in route.points:
                    coordenades.append([point.latitude, point.longitude])

        # 3. Extreure Waypoints oficials de la ruta (Estacions de pas que s'ancoraran a les vies)
        for wpt in gpx.waypoints:
            nom = wpt.name.strip() if wpt.name else "Estació"
            estacions.append({"nom": nom, "coords": [wpt.latitude, wpt.longitude]})
            
        # Cas de contingència: Si no té tracks ni rutes, convertim els Waypoints en les coordenades base del traçat
        if not coordenades and estacions:
            for estacio in estacions:
                coordenades.append(estacio["coords"])
            
    except Exception as e:
        print(f"⚠️ [GPX-ERROR] Error processant l'arxiu GPX ({gpx_path}): {e}")
        
    return coordenades, estacions, data_gpx or date.today().isoformat()


# -------------------------------------------------------------------------
# FASE 2: INTEL·LIGÈNCIA DE PREDICCIÓ DE TRANSPORT (VERSIÓ MILLORADA)
# -------------------------------------------------------------------------

def predir_mode_transport(gpx_path, coords, filename):
    """
    [IA-HEURÍSTICA MILLORADA] Intueix automàticament el mètode de transport per optimitzar 
    els filtres dels motors ferroviaris o de carretera.
    """
    nom_net = normalitzar_text(filename)
    
    # 2.1 Anàlisi Filològica Ampliada i Tolerant a Sanitarització (Regex)
    PATRONS_TREN = [
        r'tren', r'ave', r'rail', r'carrilet', r'tur.*stic', r'cremallera', 
        r'tram', r'fgc', r'renfe', r'feve', r'ferro', r'darjeeling', r'linea',
        r'línia', r'fvc', r'vapor'
    ]
    PATRONS_BICI = [r'bici', r'mtb', r'ciclisme', r'bike', r'cycling', r'btt', r'gravel']
    PATRONS_WALK = [r'caminant', r'walk', r'hiking', r'peu', r'senderisme', r'trekking', r'travesia']

    if any(re.search(p, nom_net) for p in PATRONS_TREN):
        return 'tren'
    if any(re.search(p, nom_net) for p in PATRONS_BICI):
        return 'bicicleta'
    if any(re.search(p, nom_net) for p in PATRONS_WALK):
        return 'caminant'
        
    # 2.2 Anàlisi Cinemàtica Avançada: Mitjana + Velocitat Màxima
    try:
        with open(gpx_path, 'rb') as f:
            gpx = gpxpy.parse(f)
        dades = gpx.get_moving_data()
        
        if dades and dades.moving_time > 0:
            vel_mitjana = (dades.moving_distance / dades.moving_time) * 3.6  # km/h
            vel_maxima = (dades.max_speed * 3.6) if dades.max_speed else 0.0  # km/h

            # Criteri per a caminants
            if vel_mitjana < 7.5: 
                return "caminant"
            
            # Zona de conflicte Bici vs Tren Turístic/Lent (7.5 a 28 km/h)
            if vel_mitjana < 28.0:
                # Si té un pic de velocitat màxima > 38 km/h, és un vehicle/tren lent
                if vel_maxima > 38.0:
                    return "tren"
                return "bicicleta"
            
            # Velocitats superiors a 28 km/h són directament tren o vehicle
            return "tren"
    except Exception:
        pass  # Si falla el parseig de temps, passem a l'anàlisi espacial
        
    if not coords or len(coords) < 2: 
        return 'caminant'
    
    # 2.3 Anàlisi de Densitat Espacial i Distància Total (sense timestamps)
    dist_total = 0
    salts_grans = 0
    salt_maxim = 0

    for i in range(1, len(coords)):
        dist = calcular_distancia(coords[i-1], coords[i])
        dist_total += dist
        if dist > salt_maxim:
            salt_maxim = dist
        if dist > 150:  # Salts de més de 150m entre punts
            salts_grans += 1
            
    dist_mitjana = dist_total / len(coords)
    
    # Criteri per distància total: Si fa més de 50 km en un traçat d'edició (sense temps), és un tren o vehicle
    if dist_total > 50000:
        return 'tren'

    # Un tren (encara que lent) sol tenir algun salt llarg o una mitjana superior
    if salts_grans > (len(coords) * 0.03) or dist_mitjana > 40 or salt_maxim > 400: 
        return 'tren'
    if dist_mitjana > 15: 
        return 'bicicleta'
        
    return 'caminant'


# -------------------------------------------------------------------------
# FASE 3: MANIPULACIÓ EXTRAPOLATIVA (COSTURA)
# -------------------------------------------------------------------------

def fusionar_dos_gpx(coords_a, coords_b, click_lat, click_lon):
    """
    [EDICIÓ] Troba els índexs de màxima proximitat geomètrica al punt on l'usuari 
    ha fet clic al mapa interactiu i uneix ambdues llistes, descartant el traçat sobrant.
    """
    def trobar_index_proper(coords):
        min_d, index_minim = float('inf'), 0
        for idx, pt in enumerate(coords):
            d = calcular_distancia([click_lat, click_lon], pt)
            if d < min_d:
                min_d, index_minim = d, idx
        return index_minim

    idx_a = trobar_index_proper(coords_a)
    idx_b = trobar_index_proper(coords_b)

    # Custim: Línia original fins a la intersecció + Línia nova des de la intersecció
    return coords_a[:idx_a + 1] + coords_b[idx_b:]


# -------------------------------------------------------------------------
# FASE 4: EXPORTACIÓ I SERIALITZACIÓ STÀNDARD
# -------------------------------------------------------------------------

def guardar_coordenades_a_gpx(coords, path_desti, nom_ruta="Ruta"):
    """
    [PERSISTÈNCIA] Converteix la llista de matrius numèriques en un fitxer XML 
    estructuralment correcte, sota el formalisme de l'estàndard oficial GPX 1.1.
    """
    nou_gpx = gpxpy.gpx.GPX()
    nou_track = gpxpy.gpx.GPXTrack(name=nom_ruta)
    nou_segment = gpxpy.gpx.GPXTrackSegment()
    
    # Mapatge cap a instàncies de punt geogràfic reals de gpxpy
    for lat, lon in coords:
        nou_segment.points.append(gpxpy.gpx.GPXTrackPoint(latitude=lat, longitude=lon))
        
    nou_track.segments.append(nou_segment)
    nou_gpx.tracks.append(nou_track)
    
    # Assegurar la integritat del directori abans de l'escriptura en disc
    os.makedirs(os.path.dirname(path_desti), exist_ok=True)
    with open(path_desti, 'w', encoding='utf-8') as f:
        f.write(nou_gpx.to_xml())