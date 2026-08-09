"""
LUPA MAPA - Eina de Diagnòstic de Xarxes Ferroviàries (OSM)
============================================================
Aquest script és una eina d'investigació autònoma dissenyada per analitzar les dades brutes
d'OpenStreetMap (OSM) en punts geogràfics concrets on el rutatge falla o fa coses estranyes.

Què fa exactament?
1. Rep unes coordenades (latitud, longitud) i defineix un radi de cerca (per defecte 500m).
2. Es connecta a l'API d'Overpass utilitzant un sistema de redundància (fallback) amb 
   3 servidors diferents per esquivar bloquejos (errors 429 o 406).
3. Descarrega i filtra exclusivament les vies de tren dins d'aquell radi.
4. Imprimeix per pantalla un resum llegible amb l'ID de la via i etiquetes clau 
   (ponts, túnels, alta velocitat, vies de servei).

És útil per:
- Detectar "forats" físics al mapa on les vies no estan connectades.
- Comprovar si un tram té etiquetes restrictives (ex: 'usage=industrial') que bloquegen la ruta.
- Trobar ràpidament l'ID d'OSM d'una via conflictiva per editar-la o inspeccionar-la al navegador.
"""

import requests

def investigar_area(lat, lon, radi_metres=500):
    print(f"\n🔍 Investigant àrea al voltant de {lat}, {lon} (Radi: {radi_metres}m)...")
    
    # Consulta Overpass per buscar vies de tren al voltant d'un punt
    query = f"""
    [out:json][timeout:25];
    (
      way["railway"](around:{radi_metres},{lat},{lon});
    );
    out tags;
    """
    
    # Tolerància a fallades (Fallback) amb 3 servidors diferents per evitar errors HTTP 429 i 406
    servidors = [
        "https://overpass-api.de/api/interpreter", 
        "https://overpass.openstreetmap.fr/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    ]
    headers = {'User-Agent': 'TrainGPXPlanner/21.0'}
    
    elements = None
    for idx_srv, url_servidor in enumerate(servidors):
        try:
            print(f"   -> [API] Connectant al Servidor Overpass {idx_srv+1}...", flush=True)
            # Posem un timeout de 30s perquè és una consulta petita
            response = requests.post(url_servidor, data={'data': query}, headers=headers, timeout=30)
            
            if response.status_code == 200:
                elements = response.json().get('elements', [])
                print(f"   -> [ÈXIT] Dades descarregades correctament.", flush=True)
                break
            else:
                print(f"      - [AVÍS] El servidor {idx_srv+1} ha rebutjat la petició (Codi HTTP {response.status_code}).", flush=True)
        except Exception as e:
            print(f"      - [ERROR] El servidor {idx_srv+1} no respon ({type(e).__name__}).", flush=True)
            
    if not elements:
        print("   -> [ERROR CRÍTIC] Cap servidor ha pogut processar la consulta.", flush=True)
        return
        
    # Filtrem només els elements que són vies
    vies = [el for el in elements if el.get('type') == 'way']
    
    if not vies:
        print("   -> No s'ha trobat cap via de tren en aquest radi. Pot ser un forat al mapa!")
        return
        
    print(f"   -> S'han trobat {len(vies)} vies de tren. Analitzant etiquetes:")
    for via in vies:
        tags = via.get('tags', {})
        id_via = via.get('id')
        nom = tags.get('name', 'Via sense nom')
        
        # Recopilem etiquetes interessants
        detalls = []
        if 'bridge' in tags: detalls.append(f"Pont: {tags['bridge']}")
        if 'tunnel' in tags: detalls.append(f"Túnel: {tags['tunnel']}")
        if 'highspeed' in tags: detalls.append(f"Alta Velocitat: {tags['highspeed']}")
        if 'usage' in tags: detalls.append(f"Ús: {tags['usage']}")
        if 'service' in tags: detalls.append(f"Via de servei: {tags['service']}")
        
        info_extra = " | ".join(detalls) if detalls else "Via estàndard (Sense ponts/túnels)"
        print(f"      - ID {id_via} ({nom}): {info_extra}")

# EXEMPLE D'ÚS:
# Pots posar aquí les coordenades d'un dels punts on sospites que hi ha coses rares
investigar_area(34.610926, 115.268702)