"""
MÒDUL: app.py
Servidor central (Flask). Gestiona la UI, emmagatzema arxius i orquestra 
els subprocessos del motor de generació de rutes.
"""

import os
import json
import sys
import shutil
import subprocess
import re
import uuid
import logging
from datetime import date, datetime
from flask import Flask, render_template, request, redirect, url_for, jsonify

# Intentar carregar les variables d'entorn del fitxer .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from config import (
    DIR_PENDENTS, DIR_ARXIU, DIR_JSON, DIR_GENERATOR, MAX_CONTENT_LENGTH, inicialitzar_entorn
)

if DIR_GENERATOR not in sys.path:
    sys.path.append(DIR_GENERATOR)

from src.cleaner import douglas_peucker, optimitzar_per_web, calcular_distancia, netejar_punxes_i_teranyines
from src.gpx_manager import extreure_dades_completes_gpx, predir_mode_transport, fusionar_dos_gpx, guardar_coordenades_a_gpx

# Intentar la importació directa dels motors de generació
try:
    from route_walk import calcular_ruta_caminant_local
    HAS_ROUTE_WALK = True
except ImportError:
    HAS_ROUTE_WALK = False

try:
    from route_train import generar_ruta_tren
    HAS_ROUTE_TRAIN = True
except ImportError:
    HAS_ROUTE_TRAIN = False

# Configuració de Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

logging.info("Inicialitzant directoris...")
inicialitzar_entorn()

# --- CONFIGURACIÓ DE PRIVACITAT (CASA) ---
HOME_LAT = float(os.environ.get('VITE_HOME_LAT', os.environ.get('HOME_LAT', 0)))
HOME_LON = float(os.environ.get('VITE_HOME_LON', os.environ.get('HOME_LON', 0)))
HOME_RADIUS_METRES = 150

def regenerar_tracks_js():
    """Escaneja la carpeta d'arxivats (DIR_ARXIU) i regenera el fitxer tracks.js automàticament."""
    tracks_list = []
    if os.path.exists(DIR_ARXIU):
        for root, _, files in os.walk(DIR_ARXIU):
            for file in files:
                if file.lower().endswith('.gpx'):
                    # Converteix la ruta al format web (relatiu i amb slash /)
                    rel_path = os.path.relpath(os.path.join(root, file), start=".").replace("\\", "/")
                    tracks_list.append(rel_path)
    
    tracks_list.sort()
    contingut_js = f"const tracks = {json.dumps(tracks_list, indent=2, ensure_ascii=False)};\n"
    
    try:
        with open("tracks.js", "w", encoding="utf-8") as f:
            f.write(contingut_js)
        logging.info(f"⚡ 'tracks.js' regenerat correctament amb {len(tracks_list)} rutes.")
    except Exception as e:
        logging.error(f"Error regenerant tracks.js: {e}")

def retallar_prop_de_casa(coords, lat_casa=HOME_LAT, lon_casa=HOME_LON, radi=HOME_RADIUS_METRES):
    """Elimina els punts de l'inici i del final que caiguin dins del radi de seguretat de casa."""
    if not coords or not lat_casa or not lon_casa:
        return coords

    # Retallar per l'inici
    start_idx = 0
    while start_idx < len(coords):
        pt = coords[start_idx]
        c_lat = pt[0] if isinstance(pt, (list, tuple)) else pt.get('lat')
        c_lon = pt[1] if isinstance(pt, (list, tuple)) else pt.get('lon')
        
        if calcular_distancia((c_lat, c_lon), (lat_casa, lon_casa)) > radi:
            break
        start_idx += 1

    # Retallar pel final
    end_idx = len(coords) - 1
    while end_idx > start_idx:
        pt = coords[end_idx]
        c_lat = pt[0] if isinstance(pt, (list, tuple)) else pt.get('lat')
        c_lon = pt[1] if isinstance(pt, (list, tuple)) else pt.get('lon')
        
        if calcular_distancia((c_lat, c_lon), (lat_casa, lon_casa)) > radi:
            break
        end_idx -= 1

    return coords[start_idx:end_idx + 1]

def llistar_pendents():
    if os.path.exists(DIR_PENDENTS):
        return sorted([f for f in os.listdir(DIR_PENDENTS) if f.lower().endswith('.gpx')])
    return []

def processar_ruta_per_transport(raw_coords, mode):
    if not raw_coords: 
        return raw_coords
        
    # 1. Aplicar primer el retall de seguretat de casa
    coords_segures = retallar_prop_de_casa(raw_coords)
    
    if mode not in ['caminant', 'bicicleta', 'walk', 'cycle']: 
        return coords_segures
        
    coords_netes = netejar_punxes_i_teranyines(coords_segures)
    tolerancia = 2.0 if mode in ['caminant', 'walk'] else 4.0
    return douglas_peucker(coords_netes, tolerancia_metres=tolerancia)

def generar_segments_alta_densitat(coords, transport_mode):
    if not coords: return []
    interval = 1000 if transport_mode in ["caminant", "walk"] else 10000 if transport_mode in ["bicicleta", "cycle"] else 5000
    segments = []
    segment_actual = [coords[0]]
    distancia_acumulada = 0
    
    for i in range(1, len(coords)):
        segment_actual.append(coords[i])
        distancia_acumulada += calcular_distancia(coords[i-1], coords[i])
        if distancia_acumulada >= interval:
            segments.append(segment_actual)
            segment_actual = [coords[i]]
            distancia_acumulada = 0
            
    if len(segment_actual) > 1: segments.append(segment_actual)
    elif len(segments) > 0: segments[-1].append(segment_actual[0])
    return segments

# --- RUTES PRINCIPALS ---

@app.route('/')
def index():
    pendents = llistar_pendents()
    if pendents: 
        return redirect(url_for('carregar_pendent', filename=pendents[0]))
    return render_template('index.html', segments=[], coords_originals=[], estacions_oficials=[], 
                           data_avui=date.today().isoformat(), fitxers_pendents=[], nom_ruta="", gpx_filename="")

@app.route('/carregar_pendent/<filename>')
def carregar_pendent(filename):
    nom_segur = os.path.basename(filename)
    gpx_path = os.path.join(DIR_PENDENTS, nom_segur)
    
    if not os.path.exists(gpx_path): 
        return redirect(url_for('index'))
        
    raw_coords, estacions, data_gpx = extreure_dades_completes_gpx(gpx_path)
    mode_predit = predir_mode_transport(gpx_path, raw_coords, nom_segur)
    
    nom_base = os.path.splitext(nom_segur)[0]
    
    json_path = os.path.join(DIR_PENDENTS, f"{nom_base}.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                dades_json = json.load(f)
                if isinstance(dades_json, dict):
                    nom_base = dades_json.get('name', nom_base)
                    data_gpx = dades_json.get('date', data_gpx)
        except Exception:
            pass

    coords_processades = processar_ruta_per_transport(raw_coords, mode_predit)
    segments = generar_segments_alta_densitat(coords_processades, mode_predit)

    return render_template('index.html', 
                           segments=segments, coords_originals=raw_coords,
                           mode_detectat=mode_predit, estacions_oficials=estacions, 
                           nom_ruta=nom_base, gpx_filename=nom_segur, 
                           data_avui=data_gpx or date.today().isoformat(), 
                           fitxers_pendents=llistar_pendents())

# --- ENDPOINTS API REST ---

@app.route('/api/get_routes', methods=['GET'])
def api_get_routes():
    """Retorna totes les rutes verificades arxivades per mostrar en el Mode Mapa General."""
    routes = []
    if os.path.exists(DIR_JSON):
        for filename in os.listdir(DIR_JSON):
            if filename.lower().endswith('.json'):
                mode_folder = os.path.splitext(filename)[0]
                json_file = os.path.join(DIR_JSON, filename)
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        cat_routes = json.load(f)
                    for r in cat_routes:
                        gpx_filename = r.get('gpx_filename', '')
                        cat = r.get('category', mode_folder)
                        gpx_path = os.path.join(DIR_ARXIU, cat, gpx_filename)
                        
                        coords = []
                        if os.path.exists(gpx_path):
                            coords, _, _ = extreure_dades_completes_gpx(gpx_path)
                        
                        routes.append({
                            "id": r.get('id', gpx_filename),
                            "title": r.get('name', 'Ruta sense nom'),
                            "date": r.get('date', ''),
                            "category": cat,
                            "filename": gpx_filename,
                            "coords": coords
                        })
                except Exception as e:
                    logging.error(f"Error llegint {json_file}: {e}")
                        
    return jsonify({"status": "success", "routes": routes})


@app.route('/api/desverificar_ruta', methods=['POST'])
def api_desverificar_ruta():
    """Elimina la ruta del registre JSON d'arxivats i mou el fitxer GPX de nou a pendents."""
    data = request.json or {}
    route_id = data.get('route_id')
    
    if not route_id:
        return jsonify({"status": "error", "message": "ID de ruta o nom de fitxer no especificat."}), 400

    trobat = False
    gpx_filename_target = None
    category_target = None

    if os.path.exists(DIR_JSON):
        for filename in os.listdir(DIR_JSON):
            if filename.lower().endswith('.json'):
                mode_folder = os.path.splitext(filename)[0]
                json_file = os.path.join(DIR_JSON, filename)
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        cat_routes = json.load(f)
                    
                    noves_rutes = []
                    for r in cat_routes:
                        if r.get('id') == route_id or r.get('gpx_filename') == route_id:
                            trobat = True
                            gpx_filename_target = r.get('gpx_filename')
                            category_target = r.get('category', mode_folder)
                        else:
                            noves_rutes.append(r)
                    
                    if trobat:
                        with open(json_file, 'w', encoding='utf-8') as f:
                            json.dump(noves_rutes, f, ensure_ascii=False, indent=2)
                        break
                except Exception as e:
                    logging.error(f"Error processant {json_file}: {e}")

    if not trobat:
        return jsonify({"status": "error", "message": "Ruta no trobada al registre JSON de verificades."}), 404

    if gpx_filename_target and category_target:
        src_gpx = os.path.join(DIR_ARXIU, category_target, gpx_filename_target)
        dst_gpx = os.path.join(DIR_PENDENTS, gpx_filename_target)
        
        if os.path.exists(src_gpx):
            os.makedirs(DIR_PENDENTS, exist_ok=True)
            shutil.move(src_gpx, dst_gpx)

    # Actualitzar l'índex tracks.js automàticament
    regenerar_tracks_js()

    return jsonify({"status": "success", "message": "Ruta desverificada i retornada a pendents correctament."})


@app.route('/api/verificar_ruta', methods=['POST'])
def api_verificar_ruta():
    data = request.json or {}
    gpx_filename = os.path.basename(data.get('gpx_filename', ''))
    mode_transport = data.get('mode_transport', 'caminant')
    nom_ruta = data.get('nom_ruta', os.path.splitext(gpx_filename)[0])
    data_ruta = data.get('data_ruta', date.today().isoformat())
    punts = data.get('punts', [])

    origen_gpx = os.path.join(DIR_PENDENTS, gpx_filename)
    if not os.path.exists(origen_gpx):
        return jsonify({"status": "error", "message": "Fitxer GPX no trobat a pendents."}), 404

    desti_folder_gpx = os.path.join(DIR_ARXIU, mode_transport)
    os.makedirs(desti_folder_gpx, exist_ok=True)
    desti_gpx = os.path.join(desti_folder_gpx, gpx_filename)
    shutil.move(origen_gpx, desti_gpx)

    json_temp = os.path.join(DIR_PENDENTS, f"{os.path.splitext(gpx_filename)[0]}.json")
    if os.path.exists(json_temp):
        try: os.remove(json_temp)
        except Exception: pass

    os.makedirs(DIR_JSON, exist_ok=True)
    
    fitxer_json_cat = os.path.join(DIR_JSON, f"{mode_transport}.json")
    rutes_existents = []
    if os.path.exists(fitxer_json_cat):
        try:
            with open(fitxer_json_cat, "r", encoding="utf-8") as f:
                rutes_existents = json.load(f)
        except Exception: pass

    nova_entrada = {
        "id": str(uuid.uuid4())[:8],
        "category": mode_transport,
        "name": nom_ruta,
        "date": data_ruta,
        "gpx_filename": gpx_filename,
        "points": punts
    }
    rutes_existents.append(nova_entrada)

    with open(fitxer_json_cat, "w", encoding="utf-8") as f:
        json.dump(rutes_existents, f, ensure_ascii=False, indent=2)

    # Actualitzar l'índex tracks.js automàticament
    regenerar_tracks_js()

    return jsonify({"status": "success", "message": "Ruta verificada i arxivada correctament."})


@app.route('/api/desar_edicio', methods=['POST'])
def api_desar_edicio():
    data = request.json or {}
    gpx_filename = os.path.basename(data.get('gpx_filename', ''))
    
    if not gpx_filename:
        return jsonify({"status": "error", "message": "Nom de fitxer no especificat."}), 400

    nom_base = os.path.splitext(gpx_filename)[0]
    json_path = os.path.join(DIR_PENDENTS, f"{nom_base}.json")

    contingut_json = {
        "gpx_filename": gpx_filename,
        "name": data.get('nom_ruta', nom_base),
        "date": data.get('data_ruta', date.today().isoformat()),
        "mode_transport": data.get('mode_transport', 'tren'),
        "stations": data.get('stations', []),
        "vies_bloquejades": data.get('blocked_ways', []),
        "switches_manuals": data.get('custom_switches', []),
        "updated_at": datetime.now().isoformat()
    }

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(contingut_json, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "success", "message": "Edició desada en JSON. Fitxer GPX intacte."})


@app.route('/api/generar_ruta', methods=['POST'])
def api_generar_ruta():
    data = request.json or {}
    route_name = data.get('route_name')
    estacions = data.get('stations', [])
    vies_bloquejades = data.get('blocked_ways', [])
    custom_switches = data.get('custom_switches', [])
    transport_mode = data.get('transport_mode', 'tren').lower()
    
    target_script = data.get('target_script', '')

    if len(estacions) < 2 or not route_name: 
        return jsonify({"status": "error", "message": "Falten dades per a generar la ruta."}), 400

    # Determinació intel·ligent del motor segons el mode de transport
    is_walk = transport_mode in ['caminant', 'walk', 'muntanya'] or 'walk' in target_script
    
    try:
        nom_fitxer_final = re.sub(r'[^\w\-_.]', '_', route_name.lower().strip()) + ".gpx"
        
        # OPCIÓ A: Càlcul de ruta a peu / muntanya (route_walk)
        if is_walk:
            logging.info(f"🥾 Executant motor de caminada (route_walk) per a '{route_name}'")
            
            if HAS_ROUTE_WALK:
                # Execució directa en Python per major rendiment
                calcular_ruta_caminant_local(route_name, estacions)
            else:
                # Fallback via subprocés
                entorn = os.environ.copy()
                entorn["PYTHONPATH"] = os.path.abspath(".")
                proces = subprocess.Popen(
                    [sys.executable, "route_walk.py", route_name] + estacions,
                    cwd="generator", env=entorn, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
                )
                _, stderr_output = proces.communicate()
                if proces.returncode != 0:
                    return jsonify({"status": "error", "message": f"Error motor caminada: {stderr_output.strip()}"}), 500

        # OPCIÓ B: Càlcul de ruta ferroviària (route_train)
        else:
            logging.info(f"🚆 Executant motor ferroviari (route_train) per a '{route_name}'")
            
            vies_bloquejades_str = ",".join(map(str, vies_bloquejades)) if vies_bloquejades else "none"
            switches_str = json.dumps(custom_switches) if custom_switches else "[]"
            
            entorn = os.environ.copy()
            entorn["PYTHONPATH"] = os.path.abspath(".")
            proces = subprocess.Popen(
                [sys.executable, "route_train.py", route_name, vies_bloquejades_str] + estacions + [switches_str], 
                cwd="generator", env=entorn, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
            _, stderr_output = proces.communicate()
            if proces.returncode != 0:
                return jsonify({"status": "error", "message": f"Error motor trens: {stderr_output.strip()}"}), 500

        # Lectura del fitxer GPX resultant generat a DIR_PENDENTS
        fitxer_gpx = os.path.join(DIR_PENDENTS, nom_fitxer_final)
        
        # Fallback de nom de fitxer per si té prefix (p. ex. walk_nom_ruta.gpx)
        if not os.path.exists(fitxer_gpx):
            fitxer_gpx_alt = os.path.join(DIR_PENDENTS, f"walk_{nom_fitxer_final}")
            if os.path.exists(fitxer_gpx_alt):
                fitxer_gpx = fitxer_gpx_alt
                nom_fitxer_final = f"walk_{nom_fitxer_final}"

        if os.path.exists(fitxer_gpx):
            raw_coords, noves_estacions, _ = extreure_dades_completes_gpx(fitxer_gpx)
            coords_processades = processar_ruta_per_transport(raw_coords, transport_mode)
            segments = generar_segments_alta_densitat(coords_processades, transport_mode)

            return jsonify({
                "status": "success", 
                "filename": nom_fitxer_final,
                "coords": raw_coords,
                "segments": segments,
                "estacions": noves_estacions
            })
            
        return jsonify({"status": "error", "message": f"El fitxer GPX '{nom_fitxer_final}' no s'ha trobat a la carpeta de pendents."}), 500

    except Exception as e:
        logging.error(f"Error a /api/generar_ruta: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/publish', methods=['POST'])
def api_publish():
    """Executa les comandes de Git per publicar NOMÉS les dades públiques a GitHub."""
    try:
        # Assegurar que tracks.js està al dia abans de fer git add
        regenerar_tracks_js()

        elements_publics = [e for e in [DIR_ARXIU, DIR_JSON, "index.html", "tracks.js"] if os.path.exists(e)]
        
        if elements_publics:
            subprocess.run(["git", "add"] + elements_publics, check=True)

        try:
            subprocess.run(
                ["git", "commit", "-m", "Actualització de rutes públiques des de GeoRoute Studio"],
                check=True
            )
        except subprocess.CalledProcessError:
            pass

        subprocess.run(["git", "push", "origin", "main"], check=True)

        return jsonify({
            "success": True,
            "message": "S'han publicat les rutes públiques correctament a GitHub!"
        }), 200

    except subprocess.CalledProcessError as e:
        logging.error(f"Error executant Git: {e}")
        return jsonify({
            "success": False,
            "message": f"Error en executar les comandes de Git: {str(e)}"
        }), 500
    except Exception as e:
        logging.error(f"Error del servidor en publicar: {e}")
        return jsonify({
            "success": False,
            "message": f"Error inesperat del servidor: {str(e)}"
        }), 500


if __name__ == '__main__':
    logging.info("🚀 INICIANT GEOROUTE STUDIO 🚀")
    app.run(debug=True, port=5000)