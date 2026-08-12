/**
 * static/js/map_studio.js
 * Orquestrador principal de Map Studio adaptat a l'estat GeoJSON[cite: 12, 14].
 */

import { state } from './state.js';
import * as api from './api.js';
import { 
  initUI, 
  actualitzarLlistaPuntsUI, 
  actualitzarPanellBloquejosUI, 
  notificarUsuari, 
  obrirCreacioRuta,
  actualitzarLlistaPendentsUI
} from './ui_modals.js';
import { 
  initMapLayers, 
  actualitzarCapesMapa, 
  mostrarCapesVerificacio,
  amagarCapesEdicio, 
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
    setupKeyboardShortcuts();
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

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,
    maxNativeZoom: 16,
    attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TNM'
  }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,
    opacity: 0.7,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);
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

  const btnDesfer = document.getElementById('btn-desfer');
  if (btnDesfer) {
    btnDesfer.addEventListener('click', () => {
      if (state.undo()) {
        mostrarCapesVerificacio();
        actualitzarLlistaPuntsUI();
        actualitzarPanellBloquejosUI();
        notificarUsuari("S'ha desfet l'últim canvi", "info");
      } else {
        notificarUsuari("No hi ha més canvis per desfer", "warning");
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

export async function carregarRutaPendent(filename) {
  if (!filename) return;

  try {
    const res = await fetch(`/api/pendent/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    const dadaPendent = await res.json();

    const coords = dadaPendent.coords || 
                   dadaPendent.geometria || 
                   dadaPendent.coordenades || 
                   dadaPendent.segments || 
                   dadaPendent.points || [];

    const meta = dadaPendent.metadata || {};
    const nomFinal = dadaPendent.nom_ruta || dadaPendent.nom || meta.nom || meta.name || filename.replace(/\.gpx$/i, '');
    const dataFinal = dadaPendent.data_ruta || dadaPendent.data || meta.data || meta.date || '';
    const modeFinal = dadaPendent.mode_transport || dadaPendent.mode || meta.mode || meta.category || 'train';

    const elNom = document.getElementById('nom-ruta');
    if (elNom) elNom.value = nomFinal;

    const elData = document.getElementById('data-ruta');
    if (elData) elData.value = dataFinal;

    const elMode = document.getElementById('select-mode-transport');
    if (elMode) elMode.value = modeFinal;

    let punts = [];
    if (Array.isArray(dadaPendent.estacions) && dadaPendent.estacions.length > 0) {
      punts = dadaPendent.estacions.map((est, idx) => {
        const rawCoords = Array.isArray(est.coords) ? est.coords : [est.lat, est.lng];
        return {
          id: 'est_' + Date.now() + idx,
          nom: est.nom || est.name || `Punt ${idx + 1}`,
          lat: est.lat ?? rawCoords[0],
          lng: est.lng ?? rawCoords[1],
          coords: rawCoords,
          tipus: 'estacio',
          actiu: true
        };
      });
    }

    state.setRutaActualId(dadaPendent.gpx_filename || filename);
    state.setRawCoords(coords);
    state.setLlistaPunts(punts);
    state.setMetadata({
      nomRuta: nomFinal,
      dataRuta: dataFinal,
      modeTransport: modeFinal
    });

    if (dadaPendent.vies_bloquejades && Array.isArray(dadaPendent.vies_bloquejades)) {
      dadaPendent.vies_bloquejades.forEach((v) => state.toggleViaBloquejada(v));
    }

    const mapContainer = document.getElementById('map-container');
    if (mapContainer) mapContainer.dataset.filename = filename;

    netejarRutesGlobals();
    mostrarCapesVerificacio();
    actualitzarLlistaPuntsUI();
    actualitzarPanellBloquejosUI();
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

    amagarCapesEdicio();

    try {
      notificarUsuari('Carregant totes les rutes del mapa...', 'info');
      const res = await api.getRoutes();
      llistaRutesGlobals = Array.isArray(res) ? res : (res.routes || res.rutes || []);
      state.setGlobalRoutes(llistaRutesGlobals);
      dibuixarRutesGlobalsFiltredes();
    } catch (err) {
      notificarUsuari(`Error en carregar el mapa: ${err.message}`, 'danger');
    }
  } else {
    const selectElem = document.getElementById('select-gpx') || 
                       document.getElementById('select-fitxer-pendent') || 
                       document.getElementById('select-pendents') ||
                       document.getElementById('select-fitxers-pendents');

    const mapContainer = document.getElementById('map-container');
    const fitxerDesti = (selectElem && selectElem.value) || 
                        (mapContainer && mapContainer.dataset.filename);

    if (fitxerDesti) {
      window.location.href = `/carregar_pendent/${encodeURIComponent(fitxerDesti)}`;
    } else {
      window.location.href = '/';
    }
  }
};

function dibuixarRutesGlobalsFiltredes() {
  const filtresCheckboxes = document.querySelectorAll('.filtre-categoria:checked');
  const filtresActius = Array.from(filtresCheckboxes).map((c) => c.value.toLowerCase());

  renderGlobalRoutes(llistaRutesGlobals, filtresActius, async (routeId) => {
    try {
      notificarUsuari('Desverificant ruta...', 'info');
      await api.desverificarRuta(routeId);
      await actualitzarLlistaPendentsUI();

      const res = await api.getRoutes();
      llistaRutesGlobals = Array.isArray(res) ? res : (res.routes || res.rutes || []);
      state.setGlobalRoutes(llistaRutesGlobals);
      dibuixarRutesGlobalsFiltredes();

      notificarUsuari('Ruta desverificada i retornada a pendents', 'success');
    } catch (err) {
      console.error('Error en desverificar ruta:', err);
      notificarUsuari(`Error en desverificar la ruta: ${err.message}`, 'danger');
    }
  });
}

function setupFiltresListeners() {
  const checkboxes = document.querySelectorAll('.filtre-categoria');
  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      if (esModeMapa) dibuixarRutesGlobalsFiltredes();
    });
  });
}

async function carregarDadesInicials() {
  await actualitzarLlistaPendentsUI();

  const selectElem = document.getElementById('select-gpx') || 
                     document.getElementById('select-fitxer-pendent') || 
                     document.getElementById('select-pendents') ||
                     document.getElementById('select-fitxers-pendents');

  if (selectElem && !selectElem.dataset.listenerAdded) {
    selectElem.dataset.listenerAdded = 'true';
    selectElem.addEventListener('change', (e) => {
      if (e.target.value) {
        window.location.href = `/carregar_pendent/${encodeURIComponent(e.target.value)}`;
      }
    });
  }

  const mapContainer = document.getElementById('map-container');
  const filename = mapContainer ? mapContainer.dataset.filename : null;
  const routeIdParam = new URLSearchParams(window.location.search).get('route_id');

  if (filename) {
    await carregarRutaPendent(filename);
  } else if (selectElem && selectElem.value) {
    await carregarRutaPendent(selectElem.value);
  } else if (routeIdParam) {
    try {
      const res = await api.getRoutes();
      const rutes = Array.isArray(res) ? res : (res.routes || res.rutes || []);
      const rutaActual = rutes.find((r) => String(r.id) === String(routeIdParam));

      if (rutaActual) {
        state.setRutaActualId(rutaActual.id);
        const coords = rutaActual.coords || rutaActual.coordenades || rutaActual.segments || [];
        const punts = rutaActual.punts || rutaActual.punts_de_pas || [];
        state.setRawCoords(coords);
        state.setLlistaPunts(punts);
        mostrarCapesVerificacio();
      }
    } catch (err) {
      console.error('Error carregant ruta via API getRoutes:', err);
    }
  }

  mostrarCapesVerificacio();
  actualitzarLlistaPuntsUI();
  actualitzarPanellBloquejosUI();
  state.markClean();

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (state.undo()) {
        mostrarCapesVerificacio();
        actualitzarLlistaPuntsUI();
        actualitzarPanellBloquejosUI();
        notificarUsuari("S'ha desfet l'últim canvi", "info");
      } else {
        notificarUsuari('No hi ha més canvis per desfer', 'warning');
      }
    }
  });
}

window.obrirCreacioRuta = obrirCreacioRuta;