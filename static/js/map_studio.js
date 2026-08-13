/**
 * static/js/map_studio.js
 * Orquestrador principal de Map Studio (100% Lectura, Visualització i Circulació SPA).
 */

import { state } from './state.js';
import * as api from './api.js';
import { 
  initUI, 
  actualitzarLlistaPuntsUI, 
  notificarUsuari, 
  obrirCreacioRuta,
  actualitzarLlistaPendentsUI
} from './ui_modals.js';
import { 
  initMapLayers, 
  actualitzarCapesMapa, 
  netegarCapesRuta,
  renderGlobalRoutes, 
  netejarRutesGlobals, 
  toggleMagnifier 
} from './map_layers.js';

let map = null;
let esModeMapa = false;
let llistaRutesGlobals = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    initMap();
    initMapLayers(map);
    initUI();
    setupButtonListeners();
    setupFiltresListeners();

    await carregarDadesInicials();
  } catch (err) {
    console.error('[MapStudio Init]', err);
    notificarUsuari(`Error en inicialitzar l'editor: ${err.message}`, 'danger');
  }
});

function initMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement) {
    throw new Error("No s'ha trobat el contenidor HTML #map");
  }

  map = L.map('map', { 
    zoomControl: false,
    center: [41.3851, 2.1734],
    zoom: 10
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Capa 1: Relleu
  const esriHillshade = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,         
    maxNativeZoom: 13,
    attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TNM'
  });

  // Capa 2: Carrers
  const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,
    opacity: 0.7,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  });

  // Capa 3: Satèl·lit
  const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,
    maxNativeZoom: 18,
    attribution: 'Tiles &copy; Esri'
  });

  const mapaEstandard = L.layerGroup([esriHillshade, cartoLight]).addTo(map);

  const baseMaps = {
    "Estàndard": mapaEstandard,
    "Satèl·lit": esriSat
  };

  L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
}

function setupButtonListeners() {
  const btnMapa = document.getElementById('boto-mode-mapa');
  if (btnMapa) {
    btnMapa.addEventListener('click', () => window.toggleModeMapa());
  }

  const btnNovaRuta = document.getElementById('boto-nova-ruta');
  if (btnNovaRuta) {
    btnNovaRuta.addEventListener('click', () => obrirCreacioRuta());
  }

  const selectMode = document.getElementById('select-mode-transport');
  if (selectMode) {
    selectMode.addEventListener('change', (e) => {
      const nouMode = e.target.value;

      const currentState = state.get();
      state.setMetadata({
        ...currentState.metadata,
        modeTransport: nouMode
      });

      if (currentState.rutaActual) {
        const ruta = currentState.rutaActual;
        
        if (ruta.type === 'FeatureCollection' && Array.isArray(ruta.features)) {
          ruta.features.forEach(f => {
            if (!f.properties) f.properties = {};
            if (f.geometry && f.geometry.type === 'LineString') {
              f.properties.category = nouMode;
              f.properties.mode = nouMode;
            }
          });
          if (!ruta.properties) ruta.properties = {};
          ruta.properties.mode = nouMode;
          ruta.properties.category = nouMode;
        } else if (ruta.type === 'Feature') {
          if (!ruta.properties) ruta.properties = {};
          ruta.properties.category = nouMode;
          ruta.properties.mode = nouMode;
        }
        
        state.setRutaActual(ruta);
      }

      actualitzarCapesMapa();
    });
  }

  const btnVerificar = document.getElementById('boto-verificar-ruta') || 
                       document.getElementById('boto-guardar');
  if (btnVerificar) {
    btnVerificar.addEventListener('click', (e) => {
      e.preventDefault();
      processarVerificacioRuta();
    });
  }

  const btnPublicar = document.getElementById('boto-publicar-github');
  if (btnPublicar) {
    btnPublicar.addEventListener('click', async () => {
      try {
        notificarUsuari('Publicant canvis a GitHub Pages...', 'info');
        await api.publishRuta();
        notificarUsuari('S\'ha publicat correctament a GitHub Pages!', 'success');
      } catch (err) {
        notificarUsuari(err.message, 'danger');
      }
    });
  }

  const btnLupa = document.getElementById('boto-lupa');
  if (btnLupa) {
    let lupaActiva = false;
    btnLupa.addEventListener('click', () => {
      lupaActiva = !lupaActiva;
      btnLupa.classList.toggle('actiu', lupaActiva);
      toggleMagnifier(lupaActiva);
    });
  }
}

export async function processarVerificacioRuta() {
  const currentState = state.get();
  const filename = currentState.nomFitxer;

  if (!filename) {
    notificarUsuari('No hi ha cap fitxer pendent seleccionat per verificar', 'warning');
    return;
  }

  const nomInput = document.getElementById('nom-ruta')?.value;
  const dataInput = document.getElementById('data-ruta')?.value;
  const modeInput = document.getElementById('select-mode-transport')?.value;

  const payload = {
    type: "Feature",
    geometry: currentState.rutaActual?.geometry || {
      type: "LineString",
      coordinates: currentState.rawCoords || []
    },
    properties: {
      id: currentState.rutaActualId || filename.replace(/\.gpx$/i, ''),
      name: nomInput,
      gpx_filename: filename,
      category: modeInput,
      date: dataInput,
      stations: currentState.llistaPunts || []
    }
  };

  try {
    notificarUsuari('Verificant i arxivant la ruta...', 'info');

    const res = await fetch('/api/verificar_ruta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (!res.ok || result.status === 'error') {
      throw new Error(result.message || 'Error en verificar la ruta');
    }

    notificarUsuari('🎉 Ruta verificada correctament!', 'success');

    // Actualitzem l'estat local sense recarregar la pàgina
    await actualitzarLlistaPendentsUI();
    const pendentsRes = await api.getPendents();
    const pendents = Array.isArray(pendentsRes) ? pendentsRes : (pendentsRes.pendents || pendentsRes.files || []);

    const selectElem = document.getElementById('select-gpx') || 
                       document.getElementById('select-fitxer-pendent') || 
                       document.getElementById('select-pendents') ||
                       document.getElementById('select-fitxers-pendents');

    if (pendents.length > 0) {
      if (selectElem) selectElem.value = pendents[0];
      await carregarRutaPendent(pendents[0]);
    } else {
      netegarCapesRuta();
      netejarRutesGlobals();
      netejarFormulariUI();
      if (selectElem) selectElem.innerHTML = '<option value="">(Cap fitxer pendent)</option>';
      notificarUsuari('Totes les rutes han estat verificades!', 'info');
    }

  } catch (err) {
    console.error('[Verificacio Error]', err);
    notificarUsuari(`Error en verificar la ruta: ${err.message}`, 'danger');
  }
}

function netejarFormulariUI() {
  const elNom = document.getElementById('nom-ruta');
  if (elNom) elNom.value = '';
  const elData = document.getElementById('data-ruta');
  if (elData) elData.value = '';
  state.setNomFitxer(null);
  state.setRutaActual(null);
  state.setRawCoords([]);
  state.setLlistaPunts([]);
}

export async function carregarRutaPendent(filename) {
  if (!filename) return;

  try {
    const res = await fetch(`/api/pendent/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    const dadaPendent = await res.json();
    const props = dadaPendent.properties || dadaPendent;

    const nomFinal = props.name || props.nom || props.nom_ruta || filename.replace(/\.gpx$/i, '');
    const dataFinal = props.date || props.data || props.data_ruta || '';
    const modeFinal = props.category || props.mode || props.mode_transport || 'train';

    const elNom = document.getElementById('nom-ruta');
    if (elNom) elNom.value = nomFinal;

    const elData = document.getElementById('data-ruta');
    if (elData) elData.value = dataFinal;

    const elMode = document.getElementById('select-mode-transport');
    if (elMode) elMode.value = modeFinal;

    state.setNomFitxer(props.gpx_filename || filename);
    state.setMetadata({
      nomRuta: nomFinal,
      dataRuta: dataFinal,
      modeTransport: modeFinal
    });

    if (dadaPendent.type === 'Feature' || dadaPendent.type === 'FeatureCollection') {
      state.setRutaActual(dadaPendent);
    } else {
      const coords = dadaPendent.coords || dadaPendent.geometria || dadaPendent.coordenades || dadaPendent.segments || dadaPendent.points || [];
      state.setRawCoords(coords);
    }

    let punts = [];
    const rawStations = props.stations || props.estacions || dadaPendent.estacions || [];
    if (Array.isArray(rawStations) && rawStations.length > 0) {
      punts = rawStations.map((est, idx) => {
        const rawCoords = Array.isArray(est.coords) ? est.coords : [est.lat ?? est.latitud, est.lng ?? est.lon ?? est.longitud];
        return {
          id: 'est_' + Date.now() + idx,
          nom: est.nom || est.name || `Punt ${idx + 1}`,
          lat: est.lat ?? est.latitud ?? rawCoords[0],
          lng: est.lng ?? est.lon ?? est.longitud ?? rawCoords[1],
          coords: rawCoords,
          tipus: 'estacio',
          actiu: true
        };
      });
    }

    state.setLlistaPunts(punts);

    netejarRutesGlobals();
    actualitzarCapesMapa();
    actualitzarLlistaPuntsUI();
    state.markClean();

    if (map) map.invalidateSize();

  } catch (err) {
    console.error(`[Carregar Pendent Error] ${filename}:`, err);
    notificarUsuari(`Error en carregar la ruta: ${err.message}`, 'danger');
  }
}

window.toggleModeMapa = async function (forcarEstat = null) {
  esModeMapa = forcarEstat !== null ? forcarEstat : !esModeMapa;

  const sidebar = document.getElementById('sidebar');
  const mapContainer = document.getElementById('map-container');
  const panellFiltres = document.getElementById('panell-filtres-mapa');
  const btnNovaRuta = document.getElementById('boto-nova-ruta');
  const btnPublicar = document.getElementById('boto-publicar-github');
  const btnMapa = document.getElementById('boto-mode-mapa');
  const iconaBoto = document.getElementById('icona-boto-mapa');
  const textBoto = document.getElementById('text-boto-mapa');

  if (esModeMapa) {
    if (sidebar) sidebar.classList.add('hidden');
    if (mapContainer) {
      mapContainer.classList.remove('lg:col-span-3');
      mapContainer.classList.add('lg:col-span-4');
    }
    if (panellFiltres) panellFiltres.classList.remove('hidden');
    if (btnNovaRuta) btnNovaRuta.classList.add('hidden');
    if (btnPublicar) btnPublicar.classList.remove('hidden');

    if (btnMapa) btnMapa.classList.add('actiu');
    if (iconaBoto) iconaBoto.innerText = '✅';
    if (textBoto) textBoto.innerText = 'Verificació';

    netegarCapesRuta();

    try {
      notificarUsuari('Carregant totes les rutes del mapa...', 'info');
      const res = await api.getRoutes();
      llistaRutesGlobals = Array.isArray(res) ? res : (res.features || res.routes || res.rutes || []);
      state.setGlobalRoutes(llistaRutesGlobals);
      dibuixarRutesGlobalsFiltredes(true);
    } catch (err) {
      notificarUsuari(`Error en carregar el mapa: ${err.message}`, 'danger');
    }
  } else {
    // Retornar al mode verificació sense recarregar el navegador
    if (sidebar) sidebar.classList.remove('hidden');
    if (mapContainer) {
      mapContainer.classList.remove('lg:col-span-4');
      mapContainer.classList.add('lg:col-span-3');
    }
    if (panellFiltres) panellFiltres.classList.add('hidden');
    if (btnNovaRuta) btnNovaRuta.classList.remove('hidden');
    if (btnPublicar) btnPublicar.classList.add('hidden');

    if (btnMapa) btnMapa.classList.remove('actiu');
    if (iconaBoto) iconaBoto.innerText = '🗺️';
    if (textBoto) textBoto.innerText = 'Mode Mapa';

    netejarRutesGlobals();

    const selectElem = document.getElementById('select-gpx') || 
                       document.getElementById('select-fitxer-pendent') || 
                       document.getElementById('select-pendents') ||
                       document.getElementById('select-fitxers-pendents');

    if (selectElem && selectElem.value) {
      await carregarRutaPendent(selectElem.value);
    } else {
      await carregarDadesInicials();
    }
  }
};

function dibuixarRutesGlobalsFiltredes(ajustarBounds = true) {
  const filtresCheckboxes = document.querySelectorAll('.filtre-categoria:checked');
  const filtresActius = Array.from(filtresCheckboxes).map((c) => c.value.toLowerCase());

  renderGlobalRoutes(llistaRutesGlobals, filtresActius, async (routeId) => {
    try {
      notificarUsuari('Desverificant ruta...', 'info');
      await api.desverificarRuta(routeId);
      await actualitzarLlistaPendentsUI();

      const res = await api.getRoutes();
      llistaRutesGlobals = Array.isArray(res) ? res : (res.features || res.routes || res.rutes || []);
      state.setGlobalRoutes(llistaRutesGlobals);

      // Mantenim el zoom i posició actuals de l'usuari
      dibuixarRutesGlobalsFiltredes(false);

      notificarUsuari('Ruta desverificada i retornada a pendents', 'success');
    } catch (err) {
      console.error('Error en desverificar ruta:', err);
      notificarUsuari(`Error en desverificar la ruta: ${err.message}`, 'danger');
    }
  }, ajustarBounds);
}

function setupFiltresListeners() {
  const checkboxes = document.querySelectorAll('.filtre-categoria');
  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      if (esModeMapa) dibuixarRutesGlobalsFiltredes(false);
    });
  });
}

async function carregarDadesInicials() {
  // 1. Llegim la llista real de pendents
  let llistaPendentsReals = [];
  try {
    const res = await api.getPendents();
    llistaPendentsReals = Array.isArray(res) ? res : (res.pendents || res.files || []);
  } catch (err) {
    console.warn('[Init] Error consultant /api/pendents:', err);
  }

  // 2. Omplim el desplegable
  await actualitzarLlistaPendentsUI();

  const selectElem = document.getElementById('select-gpx') || 
                     document.getElementById('select-fitxer-pendent') || 
                     document.getElementById('select-pendents') ||
                     document.getElementById('select-fitxers-pendents');

  if (selectElem && !selectElem.dataset.listenerAdded) {
    selectElem.dataset.listenerAdded = 'true';
    // Canvi asíncron del fitxer sense recàrrega de pàgina
    selectElem.addEventListener('change', async (e) => {
      if (e.target.value) {
        await carregarRutaPendent(e.target.value);
      }
    });
  }

  // 3. Carreguem el primer fitxer disponible real
  if (llistaPendentsReals.length > 0) {
    const primerFitxer = llistaPendentsReals[0];
    if (selectElem) selectElem.value = primerFitxer;
    await carregarRutaPendent(primerFitxer);
  } else {
    netegarCapesRuta();
    netejarRutesGlobals();
    netejarFormulariUI();
  }

  actualitzarCapesMapa();
  actualitzarLlistaPuntsUI();
  state.markClean();

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);
}

window.obrirCreacioRuta = obrirCreacioRuta;