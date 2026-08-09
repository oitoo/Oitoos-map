// ==========================================
// CONFIGURACIÓ INICIAL I VARIABLES D'ESTAT
// ==========================================
let rawCoords = JSON.parse(document.getElementById('flask-coords')?.textContent || '[]');
let segmentsInicials = JSON.parse(document.getElementById('flask-segments')?.textContent || '[]');
const estacionsOriginals = JSON.parse(document.getElementById('flask-estacions')?.textContent || '[]');

let llistaPunts = estacionsOriginals.map((est, idx) => ({
    id: 'est_' + Date.now() + idx,
    nom: est.nom || 'Punt',
    coords: Array.isArray(est.coords) ? est.coords : est.coords.split(',').map(Number),
    tipus: 'estacio',
    actiu: true
}));

let estatPreRecalcul = null;
let viesBloquejades = []; 
let switchesManuals = []; 
let estatEdicioModificat = false; 

let map;
let capaRutaPolyline = null;
let capesSegments = L.featureGroup();
let marcadorsActius = []; 
let marcadorsSwitches = []; 

let modeLupaActiu = false;
let modeEdicioActiu = false;
let modeMapaActiu = false;
let capaInspeccioLupa = null; 

let capesRutesMapa = L.featureGroup();
let dadesRutesCarregades = [];

let draggedItemIdx = null; 

// Mode de transport actiu per defecte
window.modeTransportActual = 'tren';

// Colors per categoria al Mode Mapa
const COLORS_CATEGORIA = {
    'walk': '#22c55e',   // Verd
    'cycle': '#f97316',  // Taronja
    'land': '#ef4444',   // Vermell
    'train': '#a855f7',  // Purpura
    'boat': '#3b82f6',   // Blau
    'plane': '#eab308'   // Groc
};

// Mapa de mòduls i executables de transport
const MODULS_TRANSPORT = {
    'walk': { nom: 'A peu', icona: '🥾', script: 'route_walk' },
    'cycle': { nom: 'Bicicleta', icona: '🚲', script: 'route_bike' },
    'land': { nom: 'Cotxe/Motor', icona: '🚗', script: 'route_car' },
    'train': { nom: 'Tren', icona: '🚆', script: 'route_train' },
    'boat': { nom: 'Barca', icona: '🚢', script: 'route_ship' },
    'plane': { nom: 'Avió', icona: '✈️', script: 'route_plane' }
};

// ==========================================
// DESCODIFICADOR DE POLYLINE (GOOGLE)
// ==========================================
function decodePolyline(encoded) {
    if (!encoded) return [];
    let points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

// ==========================================
// INICIALITZACIÓ DEL MAPA
// ==========================================
function inicialitzarMapa() {
    map = L.map('map', { zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    capaInspeccioLupa = L.featureGroup().addTo(map);
    capesSegments.addTo(map);
    capesRutesMapa.addTo(map);

    dibuixarTrazatRuta(rawCoords, segmentsInicials);

    renderitzarPunts();
    renderitzarSwitches();
    actualitzarPanellBloquejos();
    configurarEines();
    configurarFiltresMapa();
    comprovarEstatBarraLateral();
}

function dibuixarTrazatRuta(coords, segments) {
    if (capaRutaPolyline) map.removeLayer(capaRutaPolyline);
    capesSegments.clearLayers();

    if (coords && coords.length > 0) {
        capaRutaPolyline = L.polyline(coords, { color: '#60a5fa', weight: 3, opacity: 0.45, dashArray: '6, 10' }).addTo(map);
        map.fitBounds(capaRutaPolyline.getBounds(), { padding: [30, 30] });
    } else {
        map.setView([41.72, 1.82], 9);
    }

    if (segments && segments.length > 0) {
        segments.forEach((s) => {
            if (s.length > 1) {
                L.polyline(s, { color: '#10b981', weight: 4 }).addTo(capesSegments);
            }
        });
    }
}

// ==========================================
// MODE MAPA I FILTRES FLOTANTS
// ==========================================
window.toggleModeMapa = function() {
    const sidebar = document.getElementById('sidebar');
    const mapContainer = document.getElementById('map-container');
    const panellFiltres = document.getElementById('panell-filtres-mapa');
    const botoModeMapa = document.getElementById('boto-mode-mapa');
    const botoNovaRuta = document.getElementById('boto-nova-ruta');
    const botoPublicar = document.getElementById('boto-publicar-github');

    if (!panellFiltres || !botoModeMapa) return;

    const entraAlMapa = panellFiltres.classList.contains('hidden');

    if (entraAlMapa) {
        modeMapaActiu = true;

        if (capaRutaPolyline && map.hasLayer(capaRutaPolyline)) map.removeLayer(capaRutaPolyline);
        if (capesSegments && map.hasLayer(capesSegments)) map.removeLayer(capesSegments);
        marcadorsActius.forEach(m => map.removeLayer(m));
        marcadorsSwitches.forEach(m => map.removeLayer(m));

        if (sidebar) sidebar.classList.add('hidden');
        if (mapContainer) {
            mapContainer.classList.remove('lg:col-span-3');
            mapContainer.classList.add('lg:col-span-4');
        }
        panellFiltres.classList.remove('hidden');

        // Intercanvi de botons a la capçalera
        if (botoNovaRuta) botoNovaRuta.classList.add('hidden');
        if (botoPublicar) botoPublicar.classList.remove('hidden');

        botoModeMapa.innerHTML = '<span>✅</span> <span>Verificació</span>';
        botoModeMapa.classList.add('actiu');

        const checkboxes = document.querySelectorAll('.filtre-categoria');
        const algunMarcat = Array.from(checkboxes).some(cb => cb.checked);
        if (!algunMarcat) {
            checkboxes.forEach(cb => cb.checked = true);
        }

        carregarRutesMapa();

    } else {
        modeMapaActiu = false;

        capesRutesMapa.clearLayers();

        if (capaRutaPolyline) capaRutaPolyline.addTo(map);
        if (capesSegments) capesSegments.addTo(map);
        renderitzarPunts();
        renderitzarSwitches();

        if (sidebar) sidebar.classList.remove('hidden');
        if (mapContainer) {
            mapContainer.classList.remove('lg:col-span-4');
            mapContainer.classList.add('lg:col-span-3');
        }
        panellFiltres.classList.add('hidden');

        // Intercanvi de botons a la capçalera
        if (botoNovaRuta) botoNovaRuta.classList.remove('hidden');
        if (botoPublicar) botoPublicar.classList.add('hidden');

        botoModeMapa.innerHTML = '<span>🗺️</span> <span>Mapa</span>';
        botoModeMapa.classList.remove('actiu');

        if (capaRutaPolyline) {
            map.fitBounds(capaRutaPolyline.getBounds(), { padding: [30, 30] });
        }
    }

    setTimeout(() => { if (map) map.invalidateSize(); }, 50);
    setTimeout(() => { if (map) map.invalidateSize(); }, 250);
};

async function carregarRutesMapa() {
    try {
        const resp = await fetch('/api/get_routes').then(r => r.json());
        if (resp.status === 'success' || Array.isArray(resp)) {
            dadesRutesCarregades = resp.routes || resp;
            filtrarIAnimarRutesMapa();
        }
    } catch (e) {
        console.warn("No s'han pogut carregar les rutes del mapa:", e);
    }
}

function configurarFiltresMapa() {
    const checkboxes = document.querySelectorAll('.filtre-categoria');
    checkboxes.forEach(chk => {
        chk.addEventListener('change', () => {
            if (modeMapaActiu) filtrarIAnimarRutesMapa();
        });
    });
}

function filtrarIAnimarRutesMapa() {
    capesRutesMapa.clearLayers();

    const categoriesActives = Array.from(document.querySelectorAll('.filtre-categoria:checked'))
        .map(c => c.value);

    dadesRutesCarregades.forEach(ruta => {
        const cat = ruta.category || ruta.mode || 'land';
        if (categoriesActives.includes(cat)) {
            let coords = [];
            
            if (ruta.polyline) {
                coords = decodePolyline(ruta.polyline);
            } else if (ruta.coords) {
                coords = ruta.coords;
            }

            if (coords.length > 0) {
                const color = COLORS_CATEGORIA[cat] || '#ffffff';
                const poly = L.polyline(coords, {
                    color: color,
                    weight: 4,
                    opacity: 0.8
                }).addTo(capesRutesMapa);

                const popupHtml = `
                    <div class="p-1 space-y-2">
                        <h4 class="font-bold text-sm text-white">${ruta.title || ruta.name || 'Ruta sense nom'}</h4>
                        <p class="text-xs text-gray-400">📅 Data: ${ruta.date || 'Sense data'}</p>
                        <p class="text-xs text-gray-400">🏷️ Categoria: <span style="color:${color};">${cat.toUpperCase()}</span></p>
                        <button onclick="window.desverificarRuta('${ruta.id || ruta.filename}')" class="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-1 px-2 rounded text-xs transition mt-2 cursor-pointer">
                            ⚠️ Desverificar / Tornar a pendents
                        </button>
                    </div>
                `;
                poly.bindPopup(popupHtml, { className: 'lupa-popup' });
            }
        }
    });

    if (capesRutesMapa.getLayers().length > 0) {
        map.fitBounds(capesRutesMapa.getBounds(), { padding: [40, 40] });
    }
}

window.desverificarRuta = async function(routeId) {
    try {
        const resp = await fetch('/api/desverificar_ruta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route_id: routeId })
        }).then(r => r.json());

        if (resp.status === "success") {
            map.closePopup();
            await carregarRutesMapa();
        } else {
            console.error("Error en desverificar la ruta:", resp.message);
        }
    } catch (e) {
        console.error("Error de connexió en desverificar la ruta:", e);
    }
};

// ==========================================
// FUNCIÓ PER PUBLICAR A GITHUB PAGES
// ==========================================
window.publicarAGitHub = async function() {
    const boto = document.getElementById('boto-publicar-github');
    const textBoto = document.getElementById('text-boto-publicar');

    if (!boto || boto.disabled) return;

    boto.disabled = true;
    boto.classList.add('opacity-75', 'cursor-not-allowed');
    if (textBoto) textBoto.innerText = 'Publicant...';

    try {
        const resposta = await fetch('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const dades = await resposta.json();

        if (dades.success) {
            alert('✅ ' + dades.message);
        } else {
            alert('❌ Error en publicar: ' + dades.message);
        }
    } catch (err) {
        alert('❌ Error de connexió amb el servidor.');
        console.error(err);
    } finally {
        boto.disabled = false;
        boto.classList.remove('opacity-75', 'cursor-not-allowed');
        if (textBoto) textBoto.innerText = 'Publicar a GitHub';
    }
};

// ==========================================
// GESTIÓ DE MODES DE LA BARRA LATERAL
// ==========================================
window.canviarModeBarraLateral = function(mode) {
    const secVerificacio = document.getElementById('seccio-verificacio');
    const secEdicio = document.getElementById('seccio-edicio');

    if (mode === 'EDICIO') {
        if (secVerificacio) secVerificacio.classList.add('hidden');
        if (secEdicio) secEdicio.classList.remove('hidden');
        modeEdicioActiu = true;
    } else {
        if (secEdicio) secEdicio.classList.add('hidden');
        if (secVerificacio) secVerificacio.classList.remove('hidden');
        modeEdicioActiu = false;

        if (modeLupaActiu) {
            modeLupaActiu = false;
            const btnLupa = document.getElementById('boto-lupa');
            const txtLupa = document.getElementById('lupa-text');
            if (btnLupa) btnLupa.classList.remove('actiu');
            if (txtLupa) txtLupa.textContent = "Activar Lupa d'Inspecció";
        }
    }
};

function comprovarEstatBarraLateral() {
    const selectGpx = document.getElementById('select-gpx');
    const sidebar = document.getElementById('sidebar');
    const mapContainer = document.getElementById('map-container');

    if (!selectGpx || selectGpx.options.length === 0 || selectGpx.value === '') {
        if (sidebar) sidebar.classList.add('hidden');
        if (mapContainer) {
            mapContainer.classList.remove('lg:col-span-3');
            mapContainer.classList.add('lg:col-span-4');
        }
    } else {
        if (sidebar && !modeMapaActiu) sidebar.classList.remove('hidden');
        if (mapContainer && !modeMapaActiu) {
            mapContainer.classList.remove('lg:col-span-4');
            mapContainer.classList.add('lg:col-span-3');
        }
    }
    if (map) map.invalidateSize();
}

// ==========================================
// POPUP CREACIÓ DE RUTA (ASSISTENT IA)
// ==========================================
window.obrirCreacioRuta = function() {
    const existent = document.getElementById('modal-creacio-ruta');
    if (existent) existent.remove();

    const dataAvui = new Date().toISOString().split('T')[0];
    window.modeTransportActual = 'train';

    const botonsPestanyesHtml = Object.keys(MODULS_TRANSPORT).map(key => {
        const item = MODULS_TRANSPORT[key];
        const esActiu = key === window.modeTransportActual;
        const classes = esActiu ? 
            'bg-indigo-600 text-white border-indigo-500 font-bold' : 
            'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-750 hover:text-gray-200';

        return `
            <button id="tab-btn-${key}" onclick="window.canviarPestanyaTransport('${key}')" 
                    class="tab-mode-btn flex-1 justify-center px-3 py-2 text-xs rounded-t border-t border-x transition flex items-center gap-1.5 whitespace-nowrap ${classes}">
                <span>${item.icona}</span>
                <span>${item.nom}</span>
            </button>
        `;
    }).join('');

    const modalHtml = `
    <div id="modal-creacio-ruta" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl p-6 text-gray-100 flex flex-col gap-4">
            
            <div class="flex justify-between items-center border-b border-gray-800 pb-3">
                <h3 class="text-base font-bold text-indigo-400 flex items-center gap-2">🌐 Crear Nova Ruta</h3>
                <button onclick="document.getElementById('modal-creacio-ruta').remove()" class="text-gray-400 hover:text-white text-lg font-bold px-2">&times;</button>
            </div>

            <div class="flex border-b border-gray-800 gap-1 overflow-x-auto scrollbar-none">
                ${botonsPestanyesHtml}
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-850 p-4 rounded-lg border border-gray-800" id="grid-camps-formulari">
                <div>
                    <label class="block text-[11px] font-semibold text-gray-400 mb-1">Ciutat Origen</label>
                    <input type="text" id="ia-origen" placeholder="Ex: Barcelona" class="w-full bg-gray-800 border border-gray-700 rounded p-2 text-xs text-white focus:outline-none focus:border-indigo-500">
                </div>
                <div>
                    <label class="block text-[11px] font-semibold text-gray-400 mb-1">Ciutat Destí</label>
                    <input type="text" id="ia-desti" placeholder="Ex: Reus" class="w-full bg-gray-800 border border-gray-700 rounded p-2 text-xs text-white focus:outline-none focus:border-indigo-500">
                </div>
                <div>
                    <label class="block text-[11px] font-semibold text-gray-400 mb-1">Data del Viatge</label>
                    <input type="date" id="ia-data" value="${dataAvui}" class="w-full bg-gray-800 border border-gray-700 rounded p-2 text-xs text-white focus:outline-none focus:border-indigo-500">
                </div>
                
                <div id="container-mode-tren">
                    <label class="block text-[11px] font-semibold text-gray-400 mb-1">Mode de Tren</label>
                    <select id="ia-mode-tren" class="w-full bg-gray-800 border border-gray-700 rounded p-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer">
                        <option value="Regional" selected>Regional</option>
                        <option value="Alta velocitat">Alta velocitat</option>
                        <option value="Rodalies">Rodalies</option>
                    </select>
                </div>
            </div>

            <div>
                <button onclick="window.copiarPromptIA()" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-3 rounded text-xs transition flex items-center justify-center gap-2 shadow cursor-pointer">
                    📋 1. Copiar Prompt adaptat per a la IA
                </button>
                <div id="feedback-prompt" class="text-[11px] text-emerald-400 hidden text-center mt-1.5 font-medium">
                    ✓ Prompt copiat al portaretalls! Enganxa'l a la teva IA preferida.
                </div>
            </div>

            <div>
                <label class="block text-[11px] font-semibold text-gray-400 mb-1">2. Enganxa la resposta obtinguda de la IA:</label>
                <textarea id="ia-resposta" rows="5" placeholder="Punt d'origen|Latitud,Longitud&#10;Punt de pas 1|Latitud,Longitud&#10;Punt de destí|Latitud,Longitud" class="w-full bg-gray-800 border border-gray-700 rounded p-2 text-[11px] text-indigo-200 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"></textarea>
            </div>

            <div class="flex justify-between items-center pt-2 border-t border-gray-800">
                <span id="script-target-info" class="text-[10px] text-gray-500 font-mono">
                    Executable: generator/${MODULS_TRANSPORT['train'].script}.py
                </span>
                <div class="flex gap-2">
                    <button onclick="document.getElementById('modal-creacio-ruta').remove()" class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition cursor-pointer">Cancelar</button>
                    <button onclick="window.enviarRutaIA()" class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-xs transition flex items-center gap-1 shadow cursor-pointer">
                        🚀 Crear Ruta
                    </button>
                </div>
            </div>

        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.canviarPestanyaTransport = function(modeKey) {
    window.modeTransportActual = modeKey;
    const config = MODULS_TRANSPORT[modeKey];

    document.querySelectorAll('.tab-mode-btn').forEach(btn => {
        btn.className = 'tab-mode-btn flex-1 justify-center px-3 py-2 text-xs rounded-t border-t border-x transition flex items-center gap-1.5 whitespace-nowrap bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-750 hover:text-gray-200';
    });

    const btnActiu = document.getElementById(`tab-btn-${modeKey}`);
    if (btnActiu) {
        btnActiu.className = 'tab-mode-btn flex-1 justify-center px-3 py-2 text-xs rounded-t border-t border-x transition flex items-center gap-1.5 whitespace-nowrap bg-indigo-600 text-white border-indigo-500 font-bold';
    }

    const containerTren = document.getElementById('container-mode-tren');
    if (containerTren) {
        if (modeKey === 'train') {
            containerTren.classList.remove('hidden');
        } else {
            containerTren.classList.add('hidden');
        }
    }

    const targetInfo = document.getElementById('script-target-info');
    if (targetInfo) {
        targetInfo.innerText = `Executable: generator/${config.script}.py`;
    }
    
    const feedbackPrompt = document.getElementById('feedback-prompt');
    if (feedbackPrompt) feedbackPrompt.classList.add('hidden');
};

window.copiarPromptIA = async function() {
    const origen = document.getElementById('ia-origen').value.trim();
    const desti = document.getElementById('ia-desti').value.trim();
    const dataViatge = document.getElementById('ia-data').value;
    const modeKey = window.modeTransportActual;
    const modeInfo = MODULS_TRANSPORT[modeKey];

    if (!origen || !desti) return;

    let modeTextDesc = modeInfo.nom;
    if (modeKey === 'train') {
        const modeTrenSelect = document.getElementById('ia-mode-tren').value;
        modeTextDesc = `tren mode ${modeTrenSelect}`;
    }

    const textPrompt = `Actua com un expert geogràfic en rutes de transport. La teva tasca és calcular els punts de pas o estacions clau per a una ruta en mode: ${modeTextDesc.toUpperCase()} (${modeInfo.icona}).

Genera la ruta des de ${origen} fins a ${desti} per al dia ${dataViatge}.

Regles Estrictes:
1. Retorna ÚNICAMENT el llistat de punts o estacions. Sense introduccions, salutacions ni codi markdown.
2. El punt d'origen ha de ser la primera línia, el punt de destí l'última línia, i entremig els punts de pas imprescindibles per dibuixar el traçat real sense salts abruptes.
3. Has d'utilitzar OBLIGATÒRIAMENT aquest format exacte per a cada línia: Nom del Punt|Latitud,Longitud`;

    try {
        await navigator.clipboard.writeText(textPrompt);
        document.getElementById('feedback-prompt').classList.remove('hidden');
    } catch (err) {
        console.error("Error en copiar el prompt al portaretalls:", err);
    }
};

window.enviarRutaIA = async function() {
    const origen = document.getElementById('ia-origen').value.trim();
    const desti = document.getElementById('ia-desti').value.trim();
    const modeKey = window.modeTransportActual;
    const modeInfo = MODULS_TRANSPORT[modeKey];
    const respostaText = document.getElementById('ia-resposta').value.trim();

    if (!respostaText) return;

    const puntsNous = respostaText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('```'));

    if (puntsNous.length < 2) return;

    let nomMode = modeInfo.nom;
    if (modeKey === 'train') {
        const elTren = document.getElementById('ia-mode-tren');
        if (elTren) nomMode = elTren.value;
    }

    const nomRutaFormatat = `${origen} - ${desti} (${nomMode})`;

    const payload = {
        route_name: nomRutaFormatat,
        transport_mode: modeKey,
        target_script: modeInfo.script,
        train_submode: modeKey === 'train' ? nomMode : null,
        stations: puntsNous,
        blocked_ways: [],
        custom_switches: []
    };

    const modal = document.getElementById('modal-creacio-ruta');
    if (modal) modal.remove();

    const elementEstat = document.getElementById('estat-recalcul');
    if (elementEstat) {
        elementEstat.innerText = `Calculant la ruta (${nomMode}) al servidor, espera...`;
        elementEstat.classList.remove('hidden');
    }

    try {
        const resposta = await fetch('/api/generar_ruta', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        }).then(r => r.json());

        if (resposta.status === "success") {
            window.location.href = `/carregar_pendent/${resposta.filename}`;
        } else {
            console.error("Error en crear la ruta:", resposta.message);
        }
    } catch (error) {
        console.error("Error de connexió amb el servidor:", error);
    } finally {
        if (elementEstat) elementEstat.classList.add('hidden');
    }
};

// ==========================================
// GESTIÓ UNIFICADA DE PUNTS I DRAG & DROP
// ==========================================
function renderitzarPunts() {
    marcadorsActius.forEach(m => map.removeLayer(m));
    marcadorsActius = [];

    const divPunts = document.getElementById('llista-punts');
    if (!divPunts) return;
    divPunts.innerHTML = '';

    llistaPunts.forEach((punt, idx) => {
        const iconaTipus = punt.tipus === 'estacio' ? '📍' : '📌';
        const colorText = punt.tipus === 'estacio' ? 'text-indigo-200' : 'text-red-300';
        const classeEstat = punt.actiu ? '' : 'punt-desactivat';
        
        divPunts.innerHTML += `
            <div draggable="true" ondragstart="window.dragStart(${idx})" ondragover="window.dragOver(event)" ondrop="window.drop(${idx})" 
                 class="punt-arrossegable flex justify-between items-center bg-gray-800 hover:bg-gray-700 p-1.5 rounded border border-gray-700 ${classeEstat}">
                <div class="flex items-center truncate pr-2">
                    <span class="mr-2 cursor-grab opacity-50">⣿</span>
                    <span class="mr-1">${iconaTipus}</span>
                    <span class="${colorText} truncate text-[11px]" title="${punt.nom}">${punt.nom}</span>
                </div>
                <button onclick="window.togglePunt(${idx})" class="text-gray-400 hover:text-white font-bold px-2 py-0.5 rounded transition">
                    ${punt.actiu ? '✕' : '↩️'}
                </button>
            </div>`;

        if (punt.actiu && !modeMapaActiu) {
            let markerOptions = { draggable: true }; 

            if (punt.tipus === 'forcat') {
                markerOptions.icon = L.divIcon({
                    className: '',
                    html: `<div style="background-color:#ef4444; width:12px; height:12px; border-radius:50%; border:2px solid white;"></div>`,
                    iconSize: [12, 12], iconAnchor: [6, 6]
                });
            }

            const marker = L.marker(punt.coords, markerOptions).addTo(map);
            marker.bindPopup(`<b>${punt.nom}</b><br><span class="text-xs text-gray-500">${punt.coords[0].toFixed(5)}, ${punt.coords[1].toFixed(5)}</span>`);

            marker.on('dragend', function(e) {
                const novesCoords = e.target.getLatLng();
                punt.coords = [novesCoords.lat, novesCoords.lng];
                if(punt.tipus === 'forcat') {
                    punt.nom = `${novesCoords.lat.toFixed(5)}, ${novesCoords.lng.toFixed(5)}`;
                }
                estatEdicioModificat = true;
                renderitzarPunts();
                actualitzarEstatBotoRecalcul();
            });

            marcadorsActius.push(marker);
        }
    });
    actualitzarEstatBotoRecalcul();
}

window.togglePunt = function(idx) {
    llistaPunts[idx].actiu = !llistaPunts[idx].actiu;
    estatEdicioModificat = true;
    renderitzarPunts();
};

window.dragStart = function(idx) { draggedItemIdx = idx; };
window.dragOver = function(e) { e.preventDefault(); }; 
window.drop = function(idx) {
    if (draggedItemIdx === null || draggedItemIdx === idx) return;
    const item = llistaPunts.splice(draggedItemIdx, 1)[0];
    llistaPunts.splice(idx, 0, item);
    estatEdicioModificat = true;
    renderitzarPunts();
};

window.forcarPas = function(lat, lon) {
    const nomCoord = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const indexInsercio = llistaPunts.length > 1 ? llistaPunts.length - 1 : llistaPunts.length;
    
    llistaPunts.splice(indexInsercio, 0, {
        id: 'forcat_' + Date.now(),
        nom: nomCoord,
        coords: [lat, lon],
        tipus: 'forcat',
        actiu: true
    });
    
    estatEdicioModificat = true;
    renderitzarPunts();
    map.closePopup();
};

// ==========================================
// GESTIÓ DE SWITCHES MANUALS I BLOQUEJOS
// ==========================================
window.crearSwitchManual = function(lat, lon) {
    switchesManuals.push({ lat: lat, lon: lon });
    estatEdicioModificat = true;
    renderitzarSwitches();
    map.closePopup();
};

window.eliminarSwitch = function(idx) {
    switchesManuals.splice(idx, 1);
    estatEdicioModificat = true;
    renderitzarSwitches();
};

function renderitzarSwitches() {
    marcadorsSwitches.forEach(m => map.removeLayer(m));
    marcadorsSwitches = [];

    const divSwitches = document.getElementById('llista-switches');
    if (!divSwitches) return;

    divSwitches.innerHTML = switchesManuals.length === 0 ? 
        `<span class="text-gray-500 italic">Cap intercanviador manual creat.</span>` : '';

    switchesManuals.forEach((sw, idx) => {
        const nomText = `${sw.lat.toFixed(5)}, ${sw.lon.toFixed(5)}`;
        divSwitches.innerHTML += `
            <div class="flex justify-between items-center bg-gray-800 p-1.5 rounded border border-gray-700">
                <span class="text-purple-300 text-[11px]">🔀 Punt ${idx + 1} (${nomText})</span>
                <button onclick="window.eliminarSwitch(${idx})" class="text-red-400 hover:text-white font-bold px-1 transition">✕</button>
            </div>`;

        if (!modeMapaActiu) {
            const marker = L.circleMarker([sw.lat, sw.lon], { color: '#a855f7', fillColor: '#c084fc', fillOpacity: 0.9, radius: 7 }).addTo(map);
            marker.bindPopup(`<b>Punt Manual ${idx + 1}</b><br><span class="text-xs text-gray-400">${nomText}</span><br>
                <button onclick="window.eliminarSwitch(${idx})" class="w-full bg-red-600 hover:bg-red-500 text-white p-1 rounded text-xs mt-2 transition">Eliminar</button>`, { className: 'lupa-popup' });

            marcadorsSwitches.push(marker);
        }
    });

    actualitzarEstatBotoRecalcul();
}

window.bloquejarVia = function(idVia, nomVia) {
    if (!viesBloquejades.find(v => v.id === idVia)) viesBloquejades.push({ id: idVia, nom: nomVia });
    estatEdicioModificat = true; 
    actualitzarPanellBloquejos(); 
    map.closePopup();
};

window.eliminarBloqueig = function(idVia) {
    viesBloquejades = viesBloquejades.filter(v => v.id !== idVia);
    actualitzarPanellBloquejos();
};

function actualitzarPanellBloquejos() {
    const div = document.getElementById('llista-bloquejades');
    if (!div) return;

    div.innerHTML = viesBloquejades.length === 0 ? `<span class="text-gray-500 italic">Cap via bloquejada.</span>` :
        viesBloquejades.map(v => `<div class="flex justify-between items-center bg-gray-800 p-1 rounded"><span>⛔ ${v.nom}</span><button onclick="window.eliminarBloqueig(${v.id})" class="text-red-400">✕</button></div>`).join('');
    actualitzarEstatBotoRecalcul();
}

function actualitzarEstatBotoRecalcul() {
    const btn = document.getElementById('boto-recalcular');
    if (!btn) return;

    if (viesBloquejades.length > 0 || switchesManuals.length > 0 || estatEdicioModificat) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

// ==========================================
// COMUNICACIÓ AMB EL MOTOR PYTHON (EDICIÓ)
// ==========================================
async function recalcularRutaEditada() {
    const btnRecalcular = document.getElementById('boto-recalcular');
    const msgEstat = document.getElementById('estat-recalcular');

    if (btnRecalcular) btnRecalcular.disabled = true;
    if (msgEstat) msgEstat.classList.remove('hidden');

    estatPreRecalcul = {
        rawCoords: JSON.parse(JSON.stringify(rawCoords)),
        segments: JSON.parse(JSON.stringify(segmentsInicials)),
        llistaPunts: JSON.parse(JSON.stringify(llistaPunts)),
        viesBloquejades: JSON.parse(JSON.stringify(viesBloquejades)),
        switchesManuals: JSON.parse(JSON.stringify(switchesManuals))
    };

    const arrayPuntsOrdenats = llistaPunts
        .filter(p => p.actiu)
        .map(p => `${p.nom}|${p.coords[0]},${p.coords[1]}`);

    const modeKey = document.getElementById('select-mode-transport')?.value || "train";
    const modeInfo = MODULS_TRANSPORT[modeKey] || MODULS_TRANSPORT['train'];

    const payload = {
        route_name: document.getElementById('nom-ruta')?.value || "ruta_modificada",
        transport_mode: modeKey,
        target_script: modeInfo.script,
        stations: arrayPuntsOrdenats,
        blocked_ways: viesBloquejades.map(v => v.id),
        custom_switches: switchesManuals
    };

    try {
        const resposta = await fetch('/api/generar_ruta', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        }).then(r => r.json());

        if (resposta.status === "success") {
            window.location.href = `/carregar_pendent/${resposta.filename}`;
        } else {
            console.error("Error en recalcular:", resposta.message);
        }
    } catch(e) {
        console.error("Error de connexió amb el servidor:", e);
    } finally {
        if (btnRecalcular) btnRecalcular.disabled = false;
        if (msgEstat) msgEstat.classList.add('hidden');
    }
}

window.desferCanvis = function() {
    if (estatPreRecalcul) {
        rawCoords = JSON.parse(JSON.stringify(estatPreRecalcul.rawCoords));
        segmentsInicials = JSON.parse(JSON.stringify(estatPreRecalcul.segments));
        llistaPunts = JSON.parse(JSON.stringify(estatPreRecalcul.llistaPunts));
        viesBloquejades = JSON.parse(JSON.stringify(estatPreRecalcul.viesBloquejades));
        switchesManuals = JSON.parse(JSON.stringify(estatPreRecalcul.switchesManuals));
        estatPreRecalcul = null;
    } else {
        llistaPunts = JSON.parse(JSON.stringify(estacionsOriginals.map((est, idx) => ({
            id: 'est_' + Date.now() + idx,
            nom: est.nom || 'Punt',
            coords: Array.isArray(est.coords) ? est.coords : est.coords.split(',').map(Number),
            tipus: 'estacio',
            actiu: true
        }))));
        viesBloquejades = [];
        switchesManuals = [];
    }

    estatEdicioModificat = false;
    dibuixarTrazatRuta(rawCoords, segmentsInicials);
    renderitzarPunts();
    renderitzarSwitches();
    actualitzarPanellBloquejos();
    actualitzarEstatBotoRecalcul();
};

window.acceptarEdicio = async function() {
    const selectGpx = document.getElementById('select-gpx');
    const nomRuta = document.getElementById('nom-ruta')?.value.trim();
    const dataRuta = document.getElementById('data-ruta')?.value;
    const modeTransport = document.getElementById('select-mode-transport')?.value;

    const payload = {
        gpx_filename: selectGpx ? selectGpx.value : '',
        nom_ruta: nomRuta,
        data_ruta: dataRuta,
        mode_transport: modeTransport,
        stations: llistaPunts,
        blocked_ways: viesBloquejades,
        custom_switches: switchesManuals
    };

    try {
        const resp = await fetch('/api/desar_edicio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(r => r.json());

        if (resp.status === "success") {
            canviarModeBarraLateral('VERIFICACIO');
        } else {
            console.error("Error en desar l'edició:", resp.message);
        }
    } catch (e) {
        console.error("Error de connexió:", e);
    }
};

window.verificarIDesar = async function() {
    const selectGpx = document.getElementById('select-gpx');
    const nomRuta = document.getElementById('nom-ruta')?.value.trim();
    const dataRuta = document.getElementById('data-ruta')?.value;
    const modeTransport = document.getElementById('select-mode-transport')?.value;

    if (!selectGpx || !selectGpx.value) return;

    const payload = {
        gpx_filename: selectGpx.value,
        nom_ruta: nomRuta,
        data_ruta: dataRuta,
        mode_transport: modeTransport,
        punts: llistaPunts.filter(p => p.actiu)
    };

    try {
        const resp = await fetch('/api/verificar_ruta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(r => r.json());

        if (resp.status === "success") {
            window.location.href = '/';
        } else {
            console.error("Error en verificar la ruta:", resp.message);
        }
    } catch (e) {
        console.error("Error de connexió amb el servidor:", e);
    }
};

// ==========================================
// EINES DEL MAPA (LUPA D'INSPECCIÓ)
// ==========================================
function configurarEines() {
    const botoLupa = document.getElementById('boto-lupa');
    const txtLupa = document.getElementById('lupa-text');

    if (botoLupa) {
        botoLupa.addEventListener('click', () => { 
            modeLupaActiu = !modeLupaActiu; 
            botoLupa.classList.toggle('actiu', modeLupaActiu);
            if (txtLupa) {
                txtLupa.textContent = modeLupaActiu ? "Lupa Activa (Clica al mapa)" : "Activar Lupa d'Inspecció";
            }
        });
    }

    map.on('click', async function(e) {
        if (!modeLupaActiu && !modeEdicioActiu) return;
        if (modeMapaActiu) return;
        
        const esEdicio = modeEdicioActiu;
        const lat = e.latlng.lat; const lon = e.latlng.lng;
        capaInspeccioLupa.clearLayers();
        
        const popup = L.popup({ className: 'lupa-popup' }).setLatLng(e.latlng).setContent("Processant dades...").openOn(map);
        
        const radi = esEdicio ? 1500 : 500; 
        const query = `[out:json][timeout:25]; (way(around:${radi},${lat},${lon});); out body; >; out skel qt;`;
        
        // URL Corregida (sense parèntesis ni correus Markdown)
        const dades = await fetch("https://overpass-api.de/api/interpreter", { 
            method: "POST", 
            body: "data=" + encodeURIComponent(query), 
            headers: { "Content-Type": "application/x-www-form-urlencoded" } 
        }).then(r => r.json()).catch(() => null);
        
        map.closePopup(popup);
        if (!dades || dades.elements.length === 0) return;
        
        const nodesMap = {};
        dades.elements.forEach(el => { if(el.type === 'node') nodesMap[el.id] = [el.lat, el.lon]; });
        
        dades.elements.forEach(via => {
            if (via.type === 'way') {
                const coords = via.nodes.map(id => nodesMap[id]).filter(c => c);
                const linia = L.polyline(coords, { color: esEdicio ? '#f59e0b' : '#3b82f6', weight: 4 }).addTo(capaInspeccioLupa);

                let htmlPopup = `<b>${via.tags?.name || 'Via/Carretera'} (ID: ${via.id})</b>`;
                if (esEdicio) {
                    htmlPopup += `<hr class="my-2 border-gray-500">
                             <button onclick="window.bloquejarVia(${via.id}, '${via.tags?.name || via.id}')" class="w-full bg-red-600 hover:bg-red-500 text-white p-1 rounded text-xs mb-1 transition cursor-pointer">⛔ Bloquejar</button>
                             <button onclick="window.forcarPas(${coords[0][0]}, ${coords[0][1]})" class="w-full bg-blue-600 hover:bg-blue-500 text-white p-1 rounded text-xs transition cursor-pointer">📍 Forçar Pas Aquí</button>`;
                }
                linia.bindPopup(htmlPopup, { className: 'lupa-popup' });
            }
        });
    });
}

window.onload = inicialitzarMapa;