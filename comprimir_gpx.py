import xml.etree.ElementTree as ET
import os

def comprimir_gpx(arxiu_entrada, arxiu_sortida, max_punts=500):
    if not os.path.exists(arxiu_entrada):
        print(f"Error: No s'ha trobat l'arxiu '{arxiu_entrada}'")
        return

    print("Llegint l'arxiu GPX...")
    tree = ET.parse(arxiu_entrada)
    root = tree.getroot()
    
    # Truc per netejar els namespaces de l'XML i fer-ho compatible amb qualsevol GPX
    for elem in root.iter():
        if '}' in elem.tag:
            elem.tag = elem.tag.split('}', 1)[1]
            
    # Busquem tots els punts de la ruta
    punts = root.findall('.//trkpt')
    punts_totals = len(punts)
    
    if punts_totals == 0:
        print("No s'ha trobat cap punt de ruta (trkpt) en aquest fitxer.")
        return
        
    print(f"S'han trobat {punts_totals} punts originals.")
    
    # Calculem el salt necessari per no passar-nos del màxim de punts
    salt = max(1, punts_totals // max_punts)
    punts_reduïts = punts[::salt]
    
    # Guardem el resultat en un format CSV súper compacte
    with open(arxiu_sortida, 'w', encoding='utf-8') as f:
        f.write("lat,lon\n")  # Capçalera de columnes
        for p in punts_reduïts:
            f.write(f"{p.get('lat')},{p.get('lon')}\n")
            
    print(f"---")
    print(f"Procés completat correctament!")
    print(f"Arxiu reduït a {len(punts_reduïts)} punts (agafant 1 de cada {salt}).")
    print(f"Guardat a: {arxiu_sortida}")

# --- CONFIGURACIÓ ---
# Canvia el nom de l'arxiu d'entrada pel teu arxiu real
arxiu_gpx_original = "ruta.gpx" 
arxiu_csv_lleuger = "ruta_comprimida.csv"

# Executar la funció
comprimir_gpx(arxiu_gpx_original, arxiu_csv_lleuger, max_punts=500)