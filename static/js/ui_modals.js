/**
 * static/js/ui_modals.js
 * Interfície d'usuari, gestió de modals, pestanyes, panells laterals i accions de la interfície.
 * Protegit contra injeccions XSS mitjançant manipulació segura del DOM.
 */

import { state } from './state.js';
import * as api from './api.js';
import { actualitzarCapesMapa } from './map_layers.js';
import { getCategoryColor } from './utils.js';

/**
 * Mapa d'àlies per normalitzar noms de categories de la interfície local.
 */
const CATEGORY_MAP = {
  walk: 'walk', caminant: 'walk', 'a_peu': 'walk', peu: 'walk',
  cycle: 'cycle', bicicleta: 'cycle', bici: 'cycle',
  bus: 'bus', autobus: 'bus',
  car: 'car', land: 'car', cotxe: 'car', cotxe_privat: 'car', coche: 'car',
  train: 'train', tren: 'train', ferrocarril: 'train',
  boat: 'boat', barca: 'boat', vaixell: 'boat',
  plane: 'plane', avio: 'plane'
};

/**
 * Inicialitza els esdeveniments de la interfície d'usuari.
 */
export function initUI() {
  setupModalTabs();
  setupModalCloseListeners();
  setupFormListeners();
  setupAutoTitolListeners();
  setupSidebarListeners();
  setupSectionToggleListeners();
  setupPublishListener();
  setupFilterListeners();
  setupMetadataInputs();
  setupToolbarListeners();
  
  // 🎨 Sincronitzem dinàmicament els indicadors de la llegenda amb COLOR_PALETTE
  actualitzarColorsLlegendaUI();
}

/**
 * Pinta dinàmicament els indicadors de la llegenda i filtres amb els colors oficials de utils.js
 */
export function actualitzarColorsLlegendaUI() {
  // 1. Selector de badges/indicadors del panell de filtres del mapa local
  const itemsLlegenda = document.querySelectorAll('#panell-filtres-mapa label, .filtre-categoria-wrapper, #filters label');
  
  itemsLlegenda.forEach((item) => {
    const input = item.querySelector('input[type="checkbox"]');
    const dot = item.querySelector('.color-dot, .w-3, .h-3, .badge-color, span[style*="background"], span.rounded-full');
    
    if (input && dot) {
      const rawCat = (input.value || '').toLowerCase().trim();
      const cat = CATEGORY_MAP[rawCat] || rawCat;
      const color = getCategoryColor(cat);

      dot.style.backgroundColor = color;
      dot.style.borderColor = color;
    }
  });

  // 2. Elements amb atribut data-category o data-category-color
  document.querySelectorAll('[data-category-color], [data-category]').forEach((el) => {
    const rawCat = (el.getAttribute('data-category-color') || el.getAttribute('data-category') || '').toLowerCase().trim();
    const cat = CATEGORY_MAP[rawCat] || rawCat;
    const color = getCategoryColor(cat);
    
    el.style.backgroundColor = color;
    el.style.borderColor = color;
  });
}

/**
 * Configura els escoltadors de la barra d'eines principal (Botonera d'Acció Directa)
 */
function setupToolbarListeners() {
  // ➕ Nova Ruta
  const btnsNovaRuta = document.querySelectorAll('#btn-nova-ruta, #boto-nova-ruta, #btn-crear-ruta');
  btnsNovaRuta.forEach((btn) => {
    btn.addEventListener('click', () => obrirCreacioRuta());
  });

  // 🔍 Lupa / Inspecció de coordenades
  const btnsInspeccio = document.querySelectorAll('#btn-inspeccio, #btn-lupa, #btn-inspeccionar-coords');
  btnsInspeccio.forEach((btn) => {
    btn.addEventListener('click', () => toggleModeInspeccio());
  });

  // ↩️ Desverificar Ruta
  const btnsDesverificar = document.querySelectorAll('#btn-desverificar, #btn-desverificar-ruta');
  btnsDesverificar.forEach((btn) => {
    btn.addEventListener('click', async () => {
      await executarDesverificacio();
    });
  });
}

/**
 * Alterna el mode d'inspecció de coordenades sobre el mapa.
 */
function toggleModeInspeccio() {
  const mapContainer = document.getElementById('map') || document.getElementById('map-container');
  if (mapContainer) {
    const actiu = mapContainer.classList.toggle('inspection-mode-active');
    if (actiu) {
      notificarUsuari('🔍 Mode d\'inspecció activat. Fes clic al mapa per verificar coordenades.', 'info');
    } else {
      notificarUsuari('🔍 Mode d\'inspecció desactivat.', 'info');
    }
  }
}

/**
 * Executa l'acció de desverificar la ruta actual.
 */
async function executarDesverificacio() {
  const currentState = state.get();
  const routeId = currentState.nomFitxer || currentState.rutaActualId;

  if (!routeId) {
    notificarUsuari('No hi ha cap ruta seleccionada per desverificar.', 'danger');
    return;
  }

  try {
    notificarUsuari('S\'està desverificant la ruta...', 'info');
    const res = await api.desverificarRuta(routeId);
    notificarUsuari(res.message || 'Ruta retornada a pendents correctament.', 'success');
    await actualitzarLlistaPendentsUI();
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    notificarUsuari(err.message, 'danger');
  }
}

/**
 * Refresca el selector/desplegable de fitxers pendents al DOM de manera segura (Anti-XSS)
 */
export async function actualitzarLlistaPendentsUI() {
  const selectElem = document.getElementById('select-gpx') ||
                     document.getElementById('select-fitxer-pendent') || 
                     document.querySelector('select[name="fitxer_pendent"]') ||
                     document.getElementById('select-pendents') ||
                     document.getElementById('select-fitxers-pendents');

  if (!selectElem) {
    console.warn("⚠️ Element <select> de pendents no trobat al DOM.");
    return;
  }

  try {
    const mapContainer = document.getElementById('map-container');
    const fitxerActiu = mapContainer?.dataset?.filename || 
                        decodeURIComponent(window.location.pathname.replace('/carregar_pendent/', ''));

    const dada = await api.getPendents();
    const pendents = dada.pendents || [];
    const detalls = dada.detalls || [];

    const mapaDetalls = new Map();
    detalls.forEach(item => {
      if (item && item.gpx_filename) {
        mapaDetalls.set(item.gpx_filename, item.nom_ruta);
      }
    });

    selectElem.replaceChildren();

    if (pendents.length === 0) {
      const optBuida = document.createElement('option');
      optBuida.value = '';
      optBuida.textContent = 'Cap fitxer pendent';
      selectElem.appendChild(optBuida);
      return;
    }

    pendents.forEach(filename => {
      const option = document.createElement('option');
      option.value = filename;
      
      const nomRuta = mapaDetalls.get(filename);
      option.textContent = nomRuta ? `${nomRuta} (${filename})` : filename;

      if (fitxerActiu && filename === fitxerActiu) {
        option.selected = true;
      }

      selectElem.appendChild(option);
    });

    console.log(`✅ Selector actualitzat amb ${pendents.length} rutes pendents.`);

  } catch (err) {
    console.error('Error actualitzant el selector de pendents:', err);
  }
}

/**
 * Estableix la data d'avui per defecte als camps de selecció de data si estan buits.
 */
function establirDataPerDefecte() {
  const avui = new Date().toISOString().split('T')[0];
  const inputIaData = document.getElementById('input-ia-data');
  const inputGmapsData = document.getElementById('input-gmaps-data');

  if (inputIaData && !inputIaData.value) inputIaData.value = avui;
  if (inputGmapsData && !inputGmapsData.value) inputGmapsData.value = avui;
}

/**
 * Extreu automàticament l'origen i destí des d'una URL llarga de Google Maps.
 */
function extreureTitolDeGmapsUrlLocal(urlStr) {
  if (!urlStr) return '';
  try {
    let decodedUrl = decodeURIComponent(urlStr);

    if (decodedUrl.includes('/dir/')) {
      const pathAfterDir = decodedUrl.split('/dir/')[1];
      const parts = pathAfterDir.split('/');
      const locs = [];

      for (let part of parts) {
        part = part.split('?')[0].split('/@')[0].trim();
        if (
          part && 
          !part.startsWith('@') && 
          !part.startsWith('data=') && 
          !part.startsWith('am=') && 
          !part.startsWith('entry=')
        ) {
          let cleanPart = part.replace(/\+/g, ' ').replace(/%20/g, ' ');
          locs.push(cleanPart);
        }
      }

      if (locs.length >= 2) {
        return `${locs[0]} - ${locs[locs.length - 1]}`;
      } else if (locs.length === 1) {
        return locs[0];
      }
    }

    if (decodedUrl.includes('?') || decodedUrl.includes('&')) {
      const urlObj = new URL(urlStr);
      const saddr = urlObj.searchParams.get('saddr') || urlObj.searchParams.get('origin');
      const daddr = urlObj.searchParams.get('daddr') || urlObj.searchParams.get('destination');

      if (saddr && daddr) {
        return `${saddr.replace(/\+/g, ' ')} - ${daddr.replace(/\+/g, ' ')}`;
      } else if (saddr || daddr) {
        return (saddr || daddr).replace(/\+/g, ' ');
      }
    }

    if (decodedUrl.includes('/place/')) {
      const place = decodedUrl.split('/place/')[1].split('/')[0].split('?')[0];
      if (place) return place.replace(/\+/g, ' ');
    }
  } catch (e) {
    console.warn("Error en parsing local de la URL", e);
  }
  return '';
}

/**
 * Gestiona l'auto-deducció del títol de la ruta des d'Origen/Destí o la URL de Google Maps.
 */
function setupAutoTitolListeners() {
  const inputNom = document.getElementById('modal-titol-ruta');
  const inputOrigen = document.getElementById('input-origen');
  const inputDesti = document.getElementById('input-desti');
  const inputGmapsUrl = document.getElementById('input-gmaps-url');

  if (!inputNom) return;

  let titolModificatManualment = false;

  const actualitzarTitolAutoIA = () => {
    if (titolModificatManualment) return;
    const origen = inputOrigen ? inputOrigen.value.trim() : '';
    const desti = inputDesti ? inputDesti.value.trim() : '';

    if (origen && desti) {
      inputNom.value = `${origen} - ${desti}`;
    } else if (origen) {
      inputNom.value = origen;
    } else if (desti) {
      inputNom.value = desti;
    } else {
      inputNom.value = 'Nova Ruta';
    }
  };

  const actualitzarTitolAutoGmaps = async () => {
    if (titolModificatManualment) return;
    const url = inputGmapsUrl ? inputGmapsUrl.value.trim() : '';
    
    if (!url) {
      inputNom.value = 'Nova Ruta';
      return;
    }

    const titolLocal = extreureTitolDeGmapsUrlLocal(url);
    if (titolLocal) {
      inputNom.value = titolLocal;
      return;
    }

    if (url.includes('goo.gl') || url.includes('maps.app')) {
      inputNom.value = 'Llegint enllaç...';
      try {
        const response = await fetch('/api/descodificar_url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await response.json();
        
        if (!titolModificatManualment && data.titol) {
          inputNom.value = data.titol;
        } else if (!titolModificatManualment) {
          inputNom.value = 'Nova Ruta';
        }
      } catch (err) {
        if (!titolModificatManualment) inputNom.value = 'Nova Ruta';
      }
    }
  };

  if (inputOrigen) inputOrigen.addEventListener('input', actualitzarTitolAutoIA);
  if (inputDesti) inputDesti.addEventListener('input', actualitzarTitolAutoIA);

  if (inputGmapsUrl) {
    ['input', 'change', 'keyup'].forEach((evt) => {
      inputGmapsUrl.addEventListener(evt, actualitzarTitolAutoGmaps);
    });

    inputGmapsUrl.addEventListener('paste', () => {
      setTimeout(actualitzarTitolAutoGmaps, 50);
    });
  }

  inputNom.addEventListener('input', () => {
    titolModificatManualment = true;
    if (inputNom.value.trim() === '') {
      titolModificatManualment = false;
      const tabGmapsActiva = document.getElementById('tab-gmaps') && !document.getElementById('tab-gmaps').classList.contains('hidden');
      if (tabGmapsActiva) {
        actualitzarTitolAutoGmaps();
      } else {
        actualitzarTitolAutoIA();
      }
    }
  });
}

/**
 * Obre la finestra modal per a la creació/generació d'una nova ruta.
 */
export function obrirCreacioRuta() {
  const modal = document.getElementById('modal-creacio-ruta');
  if (modal) {
    establirDataPerDefecte();
    modal.classList.remove('hidden');
    modal.classList.add('is-active', 'flex');
  }
}

/**
 * Tanca la finestra modal de creació de ruta.
 */
export function tancarCreacioRuta() {
  const modal = document.getElementById('modal-creacio-ruta');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('is-active', 'flex');
  }
}

function setupModalCloseListeners() {
  const btnTancar = document.getElementById('btn-tancar-modal');
  if (btnTancar) {
    btnTancar.addEventListener('click', () => tancarCreacioRuta());
  }
}

/**
 * Configura la commutació entre pestanyes (Generació IA vs Importació Google Maps).
 */
function setupModalTabs() {
  const tabButtons = document.querySelectorAll('.modal-tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const targetTab = e.currentTarget.dataset.tab;
      
      tabButtons.forEach((b) => {
        b.classList.remove('is-active', 'text-emerald-400', 'border-emerald-400');
        b.classList.add('text-gray-400', 'border-transparent');
      });
      
      document.querySelectorAll('.modal-tab-content').forEach((c) => {
        c.classList.add('is-hidden', 'hidden');
      });

      e.currentTarget.classList.add('is-active', 'text-emerald-400', 'border-emerald-400');
      e.currentTarget.classList.remove('text-gray-400', 'border-transparent');

      const contentEl = document.getElementById(`tab-${targetTab}`);
      if (contentEl) {
        contentEl.classList.remove('is-hidden', 'hidden');
      }
    });
  });
}

/**
 * Alterna entre la Secció de Verificació i la Secció d'Edició al panell lateral.
 */
function setupSectionToggleListeners() {
  const btnModeEdicio = document.getElementById('btn-mode-edicio');
  const btnModeVerificacio = document.getElementById('btn-mode-verificacio');
  const seccioVerificacio = document.getElementById('seccio-verificacio');
  const seccioEdicio = document.getElementById('seccio-edicio');

  if (btnModeEdicio && seccioVerificacio && seccioEdicio) {
    btnModeEdicio.addEventListener('click', () => {
      seccioVerificacio.classList.add('hidden');
      seccioEdicio.classList.remove('hidden');
      actualitzarCapesMapa();
    });
  }

  if (btnModeVerificacio && seccioVerificacio && seccioEdicio) {
    btnModeVerificacio.addEventListener('click', () => {
      seccioEdicio.classList.add('hidden');
      seccioVerificacio.classList.remove('hidden');
      actualitzarCapesMapa();
    });
  }
}

/**
 * Sincronitza l'estat global quan l'usuari canvia els camps de títol, data o mode de transport.
 */
function setupMetadataInputs() {
  const elNom = document.getElementById('nom-ruta');
  const elData = document.getElementById('data-ruta');
  const elMode = document.getElementById('select-mode-transport');

  if (elNom) {
    elNom.addEventListener('input', (e) => state.setMetadata({ nomRuta: e.target.value }));
  }
  if (elData) {
    elData.addEventListener('change', (e) => state.setMetadata({ dataRuta: e.target.value }));
  }
  if (elMode) {
    elMode.addEventListener('change', (e) => state.setMetadata({ modeTransport: e.target.value }));
  }
}

/**
 * Copia un prompt predefinit al porta-retalls.
 */
export async function copiarPrompt(textPrompt) {
  try {
    await navigator.clipboard.writeText(textPrompt);
    notificarUsuari('Prompt copiat al porta-retalls!', 'success');
  } catch (err) {
    notificarUsuari("No s'ha pogut copiar el prompt", "danger");
  }
}

/**
 * Actualitza la llista de punts de pas i estacions a la barra lateral de manera segura (Anti-XSS).
 */
export function actualitzarLlistaPuntsUI() {
  const container = document.getElementById('llista-punts-container');
  if (!container) return;

  const currentData = state.get();
  container.replaceChildren();

  if (!currentData.llistaPunts || currentData.llistaPunts.length === 0) {
    const pBuida = document.createElement('p');
    pBuida.className = 'text-gray-400 italic';
    pBuida.textContent = 'Cap punt registrat';
    container.appendChild(pBuida);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'space-y-1';

  currentData.llistaPunts.forEach((punt, idx) => {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between bg-gray-800 p-2 rounded border border-gray-700 text-xs text-gray-200';

    const spanNom = document.createElement('span');
    spanNom.className = 'truncate pr-2';
    spanNom.textContent = `${idx + 1}. ${punt.nom || 'Punt sense nom'}`;

    const btnEliminar = document.createElement('button');
    btnEliminar.className = 'btn-eliminar-punt text-red-400 hover:text-red-300 font-bold px-1.5 py-0.5 rounded bg-gray-700/50 hover:bg-gray-700 cursor-pointer';
    btnEliminar.dataset.index = idx;
    btnEliminar.textContent = '✕';

    btnEliminar.addEventListener('click', (e) => {
      const i = parseInt(e.currentTarget.dataset.index, 10);
      state.eliminarPunt(i);
      actualitzarCapesMapa();
      actualitzarLlistaPuntsUI();
      notificarUsuari('Punt eliminat de la seqüència', 'info');
    });

    li.appendChild(spanNom);
    li.appendChild(btnEliminar);
    ul.appendChild(li);
  });

  container.appendChild(ul);
}

/**
 * Actualitza el panell de bloquejos de via de manera segura.
 */
export function actualitzarPanellBloquejosUI() {
  const container = document.getElementById('panell-bloquejos');
  if (!container) return;

  const { viesBloquejades } = state.get();
  container.replaceChildren();

  const p = document.createElement('p');
  p.className = 'text-xs';

  const strong = document.createElement('strong');
  strong.textContent = 'Vies bloquejades: ';

  p.appendChild(strong);
  p.appendChild(document.createTextNode(String(viesBloquejades ? viesBloquejades.length : 0)));

  container.appendChild(p);
}

/**
 * Configura els esdeveniments dels formularis de la modal.
 */
function setupFormListeners() {
  const formIA = document.getElementById('form-generar-ia');
  if (formIA) {
    formIA.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nomRuta = document.getElementById('modal-titol-ruta').value || 'Nova Ruta';
      const dataRuta = document.getElementById('input-ia-data').value;
      const origen = document.getElementById('input-origen').value;
      const desti = document.getElementById('input-desti').value;
      const modeTransport = document.getElementById('select-ia-mode').value;
      
      try {
        notificarUsuari('S\'està generant la ruta...', 'info');
        const result = await api.generarRuta({
          nom_ruta: nomRuta,
          data_ruta: dataRuta,
          estacions: [origen, desti],
          mode_transport: modeTransport
        });

        if (result.filename) {
          window.location.href = `/carregar_pendent/${result.filename}`;
        } else if (result.coords) {
          state.setRawCoords(result.coords);
          if (result.estacions) state.setLlistaPunts(result.estacions);
          if (dataRuta) state.setMetadata({ dataRuta });
          actualitzarCapesMapa();
          actualitzarLlistaPuntsUI();
          tancarCreacioRuta();
          notificarUsuari('Ruta generada amb èxit', 'success');
        }
      } catch (err) {
        notificarUsuari(err.message, 'danger');
      }
    });
  }

  const formGmaps = document.getElementById('form-importar-gmaps');
  if (formGmaps) {
    formGmaps.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('input-gmaps-url').value;
      const nomRuta = document.getElementById('modal-titol-ruta').value || 'Nova Ruta';
      const dataRuta = document.getElementById('input-gmaps-data').value;
      const modeTransport = document.getElementById('select-gmaps-mode').value;

      try {
        notificarUsuari('S\'està important des de Google Maps...', 'info');
        const result = await api.importarGoogleMaps({
          url,
          nom_ruta: nomRuta,
          data_ruta: dataRuta,
          mode_transport: modeTransport
        });

        if (result.redirect_url) {
          window.location.href = result.redirect_url;
        } else if (result.gpx_filename) {
          window.location.href = `/carregar_pendent/${result.gpx_filename}`;
        }
      } catch (err) {
        notificarUsuari(err.message, 'danger');
      }
    });
  }
}

/**
 * Configura els escoltadors de la barra lateral (Desar i Verificar).
 */
function setupSidebarListeners() {
  const selectPendents = document.getElementById('select-fitxer-pendent') ||
                        document.getElementById('select-pendents') || 
                        document.getElementById('select-fitxers-pendents') ||
                        document.getElementById('select-gpx');
  if (selectPendents) {
    selectPendents.addEventListener('change', (e) => {
      if (e.target.value) {
        window.location.href = `/carregar_pendent/${encodeURIComponent(e.target.value)}`;
      }
    });
  }

  const btnDesar = document.getElementById('btn-desar-edicio');
  if (btnDesar) {
    btnDesar.addEventListener('click', async () => {
      try {
        const currentState = state.get();
        const payload = {
          gpx_filename: currentState.nomFitxer || currentState.rutaActualId,
          nom_ruta: document.getElementById('nom-ruta')?.value || currentState.metadata?.nomRuta,
          data_ruta: document.getElementById('data-ruta')?.value || currentState.metadata?.dataRuta,
          mode_transport: document.getElementById('select-mode-transport')?.value || currentState.metadata?.modeTransport,
          estacions: currentState.llistaPunts
        };

        await api.desarEdicio(payload);
        state.markClean();
        await actualitzarLlistaPendentsUI();
        notificarUsuari('Canvis desats correctament', 'success');
      } catch (err) {
        notificarUsuari(err.message, 'danger');
      }
    });
  }

  const btnVerificar = document.getElementById('btn-verificar');
  if (btnVerificar) {
    btnVerificar.addEventListener('click', async () => {
      try {
        const currentState = state.get();
        const payload = {
          gpx_filename: currentState.nomFitxer || currentState.rutaActualId,
          nom_ruta: document.getElementById('nom-ruta')?.value || currentState.metadata?.nomRuta,
          data_ruta: document.getElementById('data-ruta')?.value || currentState.metadata?.dataRuta,
          mode_transport: document.getElementById('select-mode-transport')?.value || currentState.metadata?.modeTransport,
          punts: currentState.llistaPunts
        };

        await api.verificarRuta(payload);
        notificarUsuari('Ruta verificada i arxivada correctament!', 'success');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        notificarUsuari(err.message, 'danger');
      }
    });
  }
}

/**
 * Configura el botó per publicar a GitHub Pages.
 */
function setupPublishListener() {
  const btnPublish = document.getElementById('boto-publicar-github') || document.getElementById('btn-publicar');
  if (btnPublish) {
    btnPublish.addEventListener('click', async () => {
      const btnText = document.getElementById('text-boto-publicar');
      const textOriginal = btnText ? btnText.textContent : '';
      if (btnText) btnText.textContent = 'Publicant...';

      try {
        const res = await api.publishRuta();
        notificarUsuari(res.message || 'Rutes publicades a GitHub Pages amb èxit!', 'success');
      } catch (err) {
        notificarUsuari(`Error en publicar: ${err.message}`, 'danger');
      } finally {
        if (btnText) btnText.textContent = textOriginal;
      }
    });
  }
}

function setupFilterListeners() {
  // Espai per a filtres addicionals de la interfície
}

/**
 * Mostra un missatge de notificació flotant a la interfície de manera segura.
 */
export function notificarUsuari(missatge, tipus = 'info') {
  const notificationArea = document.getElementById('notification-area') || createNotificationArea();
  const toast = document.createElement('div');
  
  let bgClass = 'bg-blue-600';
  if (tipus === 'success') bgClass = 'bg-emerald-600';
  if (tipus === 'danger') bgClass = 'bg-red-600';

  toast.className = `${bgClass} text-white font-medium px-4 py-3 rounded-lg shadow-xl text-xs flex items-center justify-between transition-all duration-300 transform translate-y-0 opacity-100 mb-2`;
  toast.textContent = missatge;

  notificationArea.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function createNotificationArea() {
  const el = document.getElementById('notification-area');
  if (el) return el;
  const newEl = document.createElement('div');
  newEl.id = 'notification-area';
  newEl.className = 'fixed bottom-5 right-5 z-[9999] w-72 flex flex-col pointer-events-none';
  document.body.appendChild(newEl);
  return newEl;
}