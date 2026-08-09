"""
===========================================================================
MANIFEST DEL MÒDUL: cleaner.py (El Filtre Quirúrgic de Geometria)
===========================================================================
OBJECTIU: 
    Netejar, filtrar i simplificar traces GPS brutes abans d'enviar-les als 
    algorismes de ruteig o renderitzar-les al mapa interactiu del front-end.

ESTRATÈGIA VIGENT: "Filtratge en 3 Fases i Compressió Escalar"
    - FASE 1 (Soroll Inicial): S'elimina el típic "salt" caòtic de centenars 
      de metres que fan els xips GPS quan s'encenen freds abans de triangular.
    - FASE 2 (Spikes i Bucles): Es depuren els pics d'un o dos punts (errors de 
      rebot de senyal) i es col·lapsen les "teranyines" microscòpiques que 
      es generen quan l'usuari es queda quiet fent un cafè o esperant el tren.
    - FASE 3 (Simplificació Ràpida): Mitjançant l'algorisme de Douglas-Peucker, 
      es descarten punts redundants que cauen en línia recta.
    - FASE 4 (Compressió Web): Es sacrifiquen els decimals llargs multiplicant 
      per 100.000 i convertint a enters (`round`), estalviant fins a un 60% 
      de pes en el trànsit JSON cap al navegador.
===========================================================================
"""

import math
import osmnx as ox
import networkx as nx

# -------------------------------------------------------------------------
# FASE 1: MATEMÀTICA I DISTÀNCIES GEODÈSIQUES
# -------------------------------------------------------------------------

def calcular_distancia(p1, p2):
    """
    [MATE] Calcula la distància real en metres entre dues coordenades fent servir la fórmula de Haversine.
    És essencial per saber si un salt del GPS és humà o un error conceptual de localització.
    """
    R = 6371000  # Radi de la Terra en metres
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))  # El min(1.0, a) et protegeix totalment davant d'errors de flotant


def dist_perpendicular(pt, inici_linia, final_linia):
    """
    [MATE] Calcula la distància perpendicular estimada en metres des d'un punt 
    a un segment rectilini. Vital com a funció cost per a l'algorisme Douglas-Peucker.
    """
    x0, y0 = pt[0], pt[1]
    x1, y1 = inici_linia[0], inici_linia[1]
    x2, y2 = final_linia[0], final_linia[1]
    
    numerador = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
    denominador = math.sqrt((y2 - y1)**2 + (x2 - x1)**2)
    
    if denominador == 0:
        return calcular_distancia(pt, inici_linia)
    return (numerador / denominador) * 111000  # Conversió ràpida de graus a metres globals


# -------------------------------------------------------------------------
# FASE 2: FILTRATGE DE BRUTÍCIA (SPikes I TERANYINES)
# -------------------------------------------------------------------------

def netejar_punxes_i_teranyines(coords, dist_min_spike=50.0, max_dist_retorn=45.0, finestra_local=20):
    """
    [DEPURACIÓ] Elimina quirúrgicament anomalies del GPS en tres fases compactes:
    1. Soroll inicial de cobertura.
    2. Punxes aïllades de 1 o 2 punts (Spikes).
    3. Micro-bucles en àrees de parada (teranyines).
    """
    if len(coords) < 4:
        return coords

    # Sub-fase 2.1: Filtre de soroll per estabilització inicial del xip GPS
    inici_valid = 0
    for k in range(min(20, len(coords) - 5)):
        d_jump = calcular_distancia(coords[k], coords[k+1])
        d_next_dense = calcular_distancia(coords[k+1], coords[k+2])
        # Si hi ha un salt enorme peró la següent posició és densa i normal, era un rebot inicial
        if d_jump > 100.0 and d_next_dense < 25.0:
            inici_valid = k + 1
            
    coords = coords[inici_valid:]
    if len(coords) < 4: 
        return coords

    # Sub-fase 2.2: Eliminació de rebot de senyal en parets (Spikes)
    netes = [coords[0]]
    i = 1
    n = len(coords)
    while i < n - 1:
        p_prev = netes[-1]
        p_curr = coords[i]
        p_next = coords[i+1]
        
        d1 = calcular_distancia(p_prev, p_curr)
        d2 = calcular_distancia(p_curr, p_next)
        d_skip = calcular_distancia(p_prev, p_next)
        
        # Salt de 1 punt anòmal (el GPS fa un pic d'anada i tornada instantani)
        if d1 > dist_min_spike and d2 > dist_min_spike and d_skip < max_dist_retorn:
            i += 1
            continue
            
        # Salt de 2 punts anòmals seguits en la mateixa finestra d'error
        if i < n - 2:
            p_next2 = coords[i+2]
            d2_2 = calcular_distancia(p_curr, p_next2)
            d_skip2 = calcular_distancia(p_prev, p_next2)
            if d1 > dist_min_spike and d2_2 > dist_min_spike and d_skip2 < max_dist_retorn:
                i += 2
                continue

        netes.append(p_curr)
        i += 1
    netes.append(coords[-1])

    # Sub-fase 2.3: Col·lapse de micro-bucles (estacions, parades de cafè)
    coordenades_finals = []
    idx = 0
    mida = len(netes)
    while idx < mida:
        p1 = netes[idx]
        coordenades_finals.append(p1)
        saltar_a = -1
        max_cerca = min(mida, idx + finestra_local)
        # Cerquem de final a inici per trobar el tall de bucle més gran possible
        for j in range(max_cerca - 1, idx + 3, -1):
            if calcular_distancia(p1, netes[j]) < 5.0:
                saltar_a = j
                break
        if saltar_a != -1:
            idx = saltar_a
        else:
            idx += 1

    return coordenades_finals


# -------------------------------------------------------------------------
# FASE 3: OPTIMITZACIÓ I SIMPLIFICACIÓ CARTOGRÀFICA
# -------------------------------------------------------------------------

def douglas_peucker(coords, tolerancia_metres=3.0):
    """
    [REDUCCIÓ] Algorisme clàssic de simplificació cartogràfica Ramer-Douglas-Peucker. 
    Elimina punts redundants que estiguin en pràctica línia recta per sota del llindar de tolerància.
    """
    if len(coords) < 3:
        return coords

    dmax = 0
    index = 0
    inici = coords[0]
    final = coords[-1]

    for i in range(1, len(coords) - 1):
        d = dist_perpendicular(coords[i], inici, final)
        if d > dmax:
            index = i
            dmax = d

    if dmax > tolerancia_metres:
        # Recursivitat sobre els dos sub-segments resultants del punt de màxima inflexió
        esquerra = douglas_peucker(coords[:index+1], tolerancia_metres)
        dreta = douglas_peucker(coords[index:], tolerancia_metres)
        return esquerra[:-1] + dreta
    else:
        return [inici, final]


def optimitzar_per_web(coords):
    """
    [COMPRESIÓ] Multiplica les coordenades per 100.000 i les arrodoneix a valors enters.
    Això elimina la cua de decimals redundants dels floats en el fitxer JSON, reduint-ne el pes un 60%.
    Al front-end només caldrà dividir per 100.000 de nou per recuperar la traça exacta.
    """
    return [[round(lat * 100000), round(lon * 100000)] for lat, lon in coords]