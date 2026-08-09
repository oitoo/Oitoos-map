"""
Llançador Automàtic de Rutes Ferroviàries (Batch Runner)
Descripció: Parseja el bloc massiu de rutes, en neteja la sintaxi i les envia
            seqüencialment al motor unificat V12.3.
Actualització: Evita falsos positius de línies rectes per caigudes de l'API,
               esborra els GPX defectuosos, fa un reintent i desglossa els errors.
"""

import os
import re
import time
import sys
import io
from generator.route_train import calcular_cami_ferroviari
from config import DIR_PENDENTS

class CapturaLogs:
    """
    Permet interceptar la sortida per consola i analitzar els missatges d'error 
    del servidor Overpass, sense ocultar la informació a la pantalla.
    """
    def __enter__(self):
        self.buffer = io.StringIO()
        self.old_stdout = sys.stdout
        self.old_stderr = sys.stderr
        sys.stdout = self
        sys.stderr = self
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stdout = self.old_stdout
        sys.stderr = self.old_stderr

    def write(self, text):
        self.old_stdout.write(text)  # Mostra per pantalla normalment
        self.buffer.write(text)      # Ho guarda per a la nostra anàlisi

    def flush(self):
        self.old_stdout.flush()

    def obtingut(self):
        return self.buffer.getvalue()

def es_gpx_fals_positiu(ruta_gpx, num_estacions):
    """
    Analitza l'interior del GPX. Si té pràcticament la mateixa quantitat de 
    punts (<trkpt> o <rtept>) que d'estacions, significa que és una línia recta.
    Una ruta ferroviària real en conté centenars o milers.
    """
    if not os.path.exists(ruta_gpx):
        return False
    try:
        with open(ruta_gpx, 'r', encoding='utf-8') as f:
            contingut = f.read()
            punts = contingut.count('<trkpt') + contingut.count('<rtept')
            
            # Si només hi ha tants punts com estacions (o molt pocs), és invàlid
            if 0 < punts <= num_estacions + 5:
                return True
    except:
        pass
    return False

# Bloc massiu actualitzat amb les rutes regionals sol·licitades
DADES_RUTES_BRUTES = """
### Pequin - Xangai (Vies regionals)
Beijing|39.905,116.428
Langfang|39.521,116.708
Tianjin West|39.157,117.163
Cangzhou|38.308,116.878
Dezhou|37.450,116.321
Jinan|36.669,116.986
Taian|36.198,117.114
Yanzhou|35.556,116.828
Zaozhuang West|34.795,117.227
Xuzhou|34.265,117.202
Suzhou (Anhui)|33.637,116.983
Bengbu|32.943,117.369
Chuzhou North|32.321,118.312
Nanjing|32.087,118.799
Zhenjiang|32.197,119.431
Changzhou|31.786,119.962
Wuxi|31.588,120.306
Suzhou|31.315,120.612
Kunshan|31.391,120.963
Shanghai|31.249,121.455

### Xangai - Suzhou (Vies regionals)
Shanghai|31.249,121.455
Kunshan|31.391,120.963
Suzhou|31.315,120.612

### Suzhou - Xi'an (Vies regionals)
Suzhou|31.315,120.612
Wuxi|31.588,120.306
Changzhou|31.786,119.962
Zhenjiang|32.197,119.431
Nanjing|32.087,118.799
Bengbu|32.943,117.369
Xuzhou|34.265,117.202
Shangqiu|34.444,115.651
Kaifeng|34.803,114.351
Zhengzhou|34.758,113.658
Luoyang|34.686,112.433
Sanmenxia|34.791,111.205
Tongguan|34.593,110.276
Huashan|34.568, 110.088
Weinarn|34.502,109.509
Xi'an|34.276,108.966

### Xi'an - Chengdu (Vies regionals)
Xi'an|34.276,108.966
Xianyang|34.327,108.706
Baoji|34.363,107.144
Qinling|34.234,106.945
Fengzhou|33.911,106.878
Lueyang|33.328,106.155
Guangyuan|32.441,105.832
Jiangyou|31.777,104.742
Mianyang|31.472,104.689
Deyang|31.127,104.402
Chengdu|30.699,104.073

### Chengdu - Guilin (Vies regionals)
Chengdu|30.699,104.073
Suining|30.511,105.592
Chongqing North|29.610,106.551
Guanba|28.922,106.832
Tongzi|28.133,106.825
Zunyi|27.712,106.941
Guiyang|26.572,106.712
Duyun|26.262,107.519
Liuzhou|24.318,109.398
Guilin|25.269,110.291

### Guilin - Shenzhen (Vies regionals)
Guilin|25.269,110.291
Lingchuan|25.402,110.329
Quanzhou South|25.923,111.066
Yongzhou|26.417,111.609
Hengyang|26.895,112.607
Chenzhou|25.779,113.018
Shaoguan|24.802,113.597
Guangzhou|23.151,113.253
Dongguan|23.012,113.751
Shenzhen|22.533,114.117

### Shenzhen - Hong Kong (Vies regionals)
Shenzhen|22.533,114.117
Lo Wu|22.529,114.114
Sheung Shui|22.502,114.139
Tai Po Market|22.446,114.169
Shatin|22.383,114.187
Hung Hom (Hong Kong)|22.303,114.182

### Ubon Ratchathani - Bangkok (Vies regionals)
Ubon Ratchathani|15.221,104.858
Si Sa Ket|15.114,104.331
Surin|14.889,103.494
Buriram|14.999,103.111
Nakhon Ratchasima|14.973,102.079
Ayutthaya|14.356,100.584
Bangkok Hua Lamphong|13.745,100.517

### Bangkok - Aranyaprathet (Vies regionals)
Bangkok Hua Lamphong|13.745,100.517
Chachoengsao Junction|13.682,101.077
Prachin Buri|14.053,101.378
Kabin Buri|13.993,101.724
Sa Kaeo|13.811,102.073
Aranyaprathet|13.693,102.511

### Bangkok - Chiang Mai (Vies regionals)
Bangkok Hua Lamphong|13.745,100.517
Ayutthaya|14.356,100.584
Lopburi|14.799,100.615
Nakhon Sawan|15.679,100.122
Phitsanulok|16.824,100.264
Uttaradit|17.626,100.094
Lampang|18.280,99.475
Chiang Mai|18.784,99.017

### Chiang Mai - Bangkok (Vies regionals)
Chiang Mai|18.784,99.017
Lampang|18.280,99.475
Uttaradit|17.626,100.094
Phitsanulok|16.824,100.264
Nakhon Sawan|15.679,100.122
Lopburi|14.799,100.615
Ayutthaya|14.356,100.584
Bangkok Hua Lamphong|13.745,100.517

### Calcuta - Puri (Vies regionals)
Howrah Junction|22.583,88.341
Kharagpur Junction|22.333,87.322
Balasore|21.493,86.924
Bhadrak|21.054,86.495
Cuttack Junction|20.463,85.892
Bhubaneswar|20.261,85.843

### Bhubaneswar - Chennai (Vies regionals)
Bhubaneswar|20.261,85.843
Brahmapur|19.313,84.793
Palasa|18.771,84.420
Vizianagaram Junction|18.114,83.411
Visakhapatnam Junction|17.728,83.292
Rajahmundry|17.004,81.777
Vijayawada Junction|16.518,80.621
Ongole|15.505,80.049
Nellore|14.448,79.986
Gudur Junction|14.143,79.849
Chennai Central|13.082,80.275

### Chennai - Mysore (Vies regionals)
Chennai Central|13.082,80.275
Katpadi Junction|12.969,79.132
Jolarpettai Junction|12.569,78.577
Bangalore City|12.978,77.570
Mandya|12.527,76.901
Mysore Junction|12.316,76.643

### Madurai - Kanyakumari (Vies regionals)
Madurai Junction|9.919,78.112
Virudhunagar Junction|9.589,77.957
Satur|9.324,77.927
Kovilpatti|9.176,77.868
Tirunelveli Junction|8.717,77.691
Kanyakumari|8.088,77.549

### Kanyakumari - Alappuzha (Vies regionals)
Kanyakumari|8.088,77.549
Nagercoil Junction|8.183,77.452
Thiruvananthapuram Central|8.487,76.952
Kollam Junction|8.883,76.595
Kayamkulam Junction|9.172,76.499
Alappuzha|9.491,76.326

### Ernakulam - Kannur (Vies regionals)
Ernakulam Junction|9.964,76.296
Aluva|10.109,76.355
Thrissur|10.518,76.211
Shoranur Junction|10.760,76.273
Tirur|10.916,75.925
Kozhikode Main|11.249,75.783
Thalassery|11.748,75.494
Kannur|11.868,75.355

### Kannur - Madgaon (Vies regionals)
Kannur|11.868,75.355
Kasaragod|12.505,74.985
Mangalore Junction|12.865,74.866
Udupi|13.348,74.757
Kundapura|13.642,74.697
Murdeshwar|14.095,74.492
Karwar|14.821,74.148
Madgaon Junction|15.274,73.958

### Madgaon - Hospet (Vies regionals)
Madgaon Junction|15.274,73.958
Sanvordem|15.260,74.116
Kulem|15.334,74.256
Castle Rock|15.402,74.332
Londa Junction|15.462,74.536
Alnavar Junction|15.437,74.821
Dharwad|15.432,75.006
Hubli Junction|15.345,75.149
Gadag Junction|15.433,75.629
Koppal|15.344,76.155
Hospet Junction|15.269,76.388

### Hospet - Hyderabad (Vies regionals)
Hospet Junction|15.269,76.388
Ballari Junction|15.143,76.924
Guntakal Junction|15.166,77.375
Adoni|15.632,77.279
Raichur Junction|16.202,77.355
Wadi Junction|17.051,76.992
Vikarabad Junction|17.336,77.904
Secunderabad Junction|17.434,78.501

### Hyderabad - Warangal (Vies regionals)
Secunderabad Junction|17.434,78.501
Bhongir|17.514,78.887
Jangaon|17.722,79.163
Kazipet Junction|17.978,79.525
Warangal|17.962,79.610

### Hyderabad - Nagpur (Vies regionals)
Secunderabad Junction|17.434,78.501
Kazipet Junction|17.978,79.525
Ramagundam|18.761,79.435
Manchiryal|18.874,79.452
Sirpur Kaghaznagar|19.330,79.493
Balharshah Junction|19.851,79.351
Chandrapur|19.957,79.300
Nagpur Junction|21.153,79.088

### Nagpur - Rourkela (Vies regionals)
Nagpur Junction|21.153,79.088
Gondia Junction|21.458,80.198
Durg Junction|21.189,81.285
Raipur Junction|21.258,81.631
Bilaspur Junction|22.096,82.144
Jharsuguda Junction|21.859,84.026
Rourkela Junction|22.224,84.890

### Rourkela - Gaya (Vies regionals)
Rourkela Junction|22.224,84.890
Ranchi Junction|23.349,85.327
Bokaro Steel City|23.640,86.155
Gomoh Junction|23.869,86.131
Koderma Junction|24.472,85.534
Gaya Junction|24.802,85.004

### Patna - Siliguri (Vies regionals)
Patna Junction|25.602,85.137
Barauni Junction|25.431,86.012
Khagaria Junction|25.501,86.483
Katihar Junction|25.553,87.561
KishanGanj|26.079,87.938
New Jalpaiguri|26.685,88.441

### Siliguri - Darjeeling (Turístic)
Siliguri Junction|26.732,88.411
Sukna|26.791,88.361
Tindharia|26.853,88.340
Kurseong|26.881,88.277
Ghum|27.008,88.248
Darjeeling|27.042,88.263

### Varanasi - Delhi (Vies regionals)
Varanasi Junction|25.328,82.988
Lucknow Charbagh|26.832,80.944
Bareilly Junction|28.341,79.429
Moradabad Junction|28.841,78.759
Ghaziabad Junction|28.654,77.427
New Delhi|28.643,77.221

### Delhi - Agra (Vies regionals)
New Delhi|28.643,77.221
Mathura Junction|27.494,77.674
Agra Cantt.|27.158,77.995

### Agra - Jaipur (Vies regionals)
Agra Cantt.|27.158,77.995
Bharatpur Junction|27.214,77.494
Bandikui Junction|27.045,76.570
Dausa|26.892,76.340
Jaipur Junction|26.919,75.786

### Jaipur - Ajmer (Vies regionals)
Jaipur Junction|26.919,75.786
Phulera Junction|26.873,75.242
Kishangarh|26.574,74.879
Ajmer Junction|26.456,74.631

### Ajmer - Haridwar (Vies regionals)
Ajmer Junction|26.456,74.631
Jaipur Junction|26.919,75.786
Alwar Junction|27.567,76.611
Rewari Junction|28.192,76.621
Old Delhi (Delhi Junction)|28.658,77.229
Meerut City Junction|28.977,77.705
Tapri Junction|29.916,77.544
Roorkee|29.866,77.893
Haridwar|29.944,78.163

### Haridwar - Pathankot (Vies regionals)
Haridwar|29.944,78.163
Saharanpur Junction|29.969,77.536
Ambala Cantt. Junction|30.334,76.841
Ludhiana Junction|30.902,75.861
Jalandhar Cantt. Junction|31.307,75.632
Suchipind|31.334,75.617
Pathankot Cantt.|32.257,75.679

### Pathankot - Jammu (Vies regionals)
Pathankot Cantt.|32.257,75.679
Kathua|32.373,75.460
Jammu Tawi|32.705,74.880

### Jammu - Amritsar (Vies regionals)
Jammu Tawi|32.705,74.880
Kathua|32.373,75.460
Pathankot Cantt.|32.257,75.679
Jalandhar City Junction|31.332,75.579
Amritsar Junction|31.634,74.865

### Amritsar - Bikaner (Vies regionals)
Amritsar Junction|31.634,74.865
Jalandhar City Junction|31.332,75.579
Ludhiana Junction|30.902,75.861
Dhuri Junction|30.373,75.865
Bhatinda Junction|30.209,74.951
Hanumangarh Junction|29.582,74.316
Suratgarh Junction|29.319,73.896
Bikaner Junction|28.016,73.314

### Bikaner - Jodhpur (Vies regionals)
Bikaner Junction|28.016,73.314
Deshnoke|27.791,73.344
Nokha|27.534,73.418
Nagaur|27.200,73.734
Merta Road Junction|26.653,74.032
Jodhpur Junction|26.287,73.016

### Jaisalmer - Jodhpur (Vies regionals)
Jaisalmer|26.903,70.925
Ramdevra|27.026,71.928
Phalodi Junction|27.127,72.370
Jodhpur Junction|26.287,73.016

### Jodhpur - Jaipur (Vies regionals)
Jodhpur Junction|26.287,73.016
Merta Road Junction|26.653,74.032
Degana Junction|26.896,74.323
Makrana Junction|27.042,74.723
Phulera Junction|26.873,75.242
Jaipur Junction|26.919,75.786

### Kota - Udaipur (Vies regionals)
Kota Junction|25.218,75.864
Bundî|25.439,75.658
Chittaurgarh Junction|24.890,74.625
Mavli Junction|24.789,73.992
Udaipur City|24.571,73.697

### Udaipur - Ahmedabad (Vies regionals)
Udaipur City|24.571,73.697
Jai Samand Road|24.218,73.746
Dungarpur|23.839,73.712
Himmatnagar Junction|23.593,72.969
Asarva Junction|23.044,72.614
Ahmedabad Junction|23.029,72.602

### Pathankot - Amritsar (Vies regionals directes)
Pathankot Junction|32.268,75.648
Gurdaspur|32.039,75.401
Batala Junction|31.815,75.201
Amritsar Junction|31.634,74.865

"""

def parsejar_bloc_de_rutes(text_brut):
    rutes_processades = []
    ruta_actual = None
    estacions_ruta_actual = []

    linies = text_brut.strip().split('\n')
    
    for linia in linies:
        linia = linia.strip()
        if not linia:
            continue
            
        if linia.startswith('###'):
            if ruta_actual and estacions_ruta_actual:
                rutes_processades.append((ruta_actual, estacions_ruta_actual))
            ruta_actual = linia.replace('###', '').strip()
            estacions_ruta_actual = []
            continue
            
        if '|' in linia:
            match = re.match(r"^([^|]+)\|([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)", linia)
            if match:
                nom_estacio = match.group(1).strip()
                lat = match.group(2).strip()
                lon = match.group(3).strip()
                estacions_ruta_actual.append(f"{nom_estacio}|{lat},{lon}")
                
    if ruta_actual and estacions_ruta_actual:
        rutes_processades.append((ruta_actual, estacions_ruta_actual))
        
    return rutes_processades

def obtenir_nom_arxiu(nom_ruta):
    nom_net = re.sub(r'[^a-z0-9\-]', '_', nom_ruta.lower())
    return f"{nom_net}.gpx"

def llançar_processament_en_bloc():
    rutes = parsejar_bloc_de_rutes(DADES_RUTES_BRUTES)
    total_rutes = len(rutes)
    
    directori_sortida = DIR_PENDENTS
    
    if not os.path.exists(directori_sortida):
        os.makedirs(directori_sortida)
        
    # Comptadors globals per al resum final
    rutes_generades = 0
    rutes_saltades = 0
    rutes_fallades_api = 0
    rutes_fallades_enrutament = 0
    
    peticio_previa_feta = False 
    
    print("=" * 70)
    print(f" 🚀 S'HAN DETECTAT {total_rutes} RUTES REGIONALS PER PROCESSAR EN SÈRIE.")
    print("=" * 70)
    
    for i, (nom_ruta, llista_estacions) in enumerate(rutes, 1):
        nom_arxiu_esperat = obtenir_nom_arxiu(nom_ruta)
        ruta_completa = os.path.join(directori_sortida, nom_arxiu_esperat)
        
        print("\n" + "#" * 60)
        print(f" 🛤️ [{i}/{total_rutes}] AVALUANT: {nom_ruta.upper()}")
        
        # Validem també que l'arxiu existent no sigui un fals positiu de línies rectes prèvi
        if os.path.exists(ruta_completa):
            if es_gpx_fals_positiu(ruta_completa, len(llista_estacions)):
                print(f" 🗑️ DETECTAT GPX INSUFICIENT: Eliminant fals positiu anterior ({nom_arxiu_esperat}).")
                os.remove(ruta_completa)
            else:
                print(f" ⏭️ SALTANT: La ruta ja està generada correctament al disc -> {nom_arxiu_esperat}")
                print("#" * 60)
                rutes_saltades += 1
                continue
            
        print(f" 📍 Estacions de pas a connectar: {len(llista_estacions)}")
        print("#" * 60 + "\n")
        
        INTENTS_MAXIMS = 2
        intent_actual = 1
        exit_assolit = False
        motiu_error = None
        
        while intent_actual <= INTENTS_MAXIMS:
            if intent_actual > 1:
                print(f" 🔄 REINTENT [{intent_actual}/{INTENTS_MAXIMS}] Recuperant error de xarxa per '{nom_ruta}'...")
                time.sleep(20) # Pausa llarga abans de reintentar una connexió fallida

            if peticio_previa_feta and intent_actual == 1:
                TEMPS_ESPERA = 12
                print(f" 💤 Descans tècnic: Dormint {TEMPS_ESPERA} segons per no saturar l'API...")
                time.sleep(TEMPS_ESPERA)
                
            peticio_previa_feta = True
            t_inici = time.time()
            
            try:
                # Cridem el motor interceptant els logs
                with CapturaLogs() as logs:
                    calcular_cami_ferroviari(nom_ruta, "none", llista_estacions)
                
                text_logs = logs.obtingut()
                
                # AVALUACIÓ DEL RESULTAT
                if os.path.exists(ruta_completa):
                    # Comprovem la integritat i els missatges d'error de xarxa
                    fallada_api_detectada = ("Cap servidor ha pogut processar la capsa" in text_logs) or \
                                            ("ERROR CRÍTIC" in text_logs and "API" in text_logs) or \
                                            es_gpx_fals_positiu(ruta_completa, len(llista_estacions))
                    
                    if fallada_api_detectada:
                        print(f"\n ❌ 🌐 ERROR D'API DETECTAT: Falla la baixada del mapa. S'ha esborrat el GPX de línies rectes.")
                        os.remove(ruta_completa)
                        motiu_error = "api"
                    else:
                        durada = time.time() - t_inici
                        print(f"\n ✅ [{i}/{total_rutes}] ÈXIT: Ruta '{nom_ruta}' generada correctament en {durada:.1f} segons.")
                        exit_assolit = True
                        break # Sortim del bucle de reintents si hi ha hagut èxit
                else:
                    # El procés ha acabat però no hi ha fitxer (error del motor)
                    print(f"\n ❌ 🛤️ ERROR D'ENRUTAMENT: No s'ha generat l'arxiu GPX esperat.")
                    motiu_error = "enrutament"
                    break # Si no és error de xarxa, no reintentem i passem a la següent ruta
                    
            except Exception as e:
                print(f"\n ❌ 💥 ERRADA CRÍTICA (CODI) A LA RUTA '{nom_ruta}': {e}")
                motiu_error = "enrutament"
                break 

            intent_actual += 1
            
        # Comptabilització un cop finalitzats els intents
        if not exit_assolit:
            if motiu_error == "api":
                rutes_fallades_api += 1
            else:
                rutes_fallades_enrutament += 1
            
    # Resum dinàmic final actualitzat
    print("\n" + "=" * 70)
    print(" 🎉 PROCÉS BATCH FINALITZAT!")
    print(f" 📊 RESUM TOTAL: {total_rutes} RUTES")
    print(f"    ✅ {rutes_generades} Generades correctament")
    print(f"    ⏭️ {rutes_saltades} Saltades (ja existien al disc)")
    print(f"    🌐 {rutes_fallades_api} Fallades per desconnexió de l'API (Sense descàrrega de mapes)")
    print(f"    🛤️ {rutes_fallades_enrutament} Fallades per errors purs d'enrutament/codi")
    print("=" * 70)

if __name__ == '__main__':
    llançar_processament_en_bloc()