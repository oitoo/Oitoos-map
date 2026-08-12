/**
 * static/js/ui_modals.js
 * Interfície d'usuari, gestió de modals, pestanyes, panells laterals i accions de la interfície.
 */

import { state } from './state.js';
import * as api from './api.js';
import { actualitzarCapesMapa, mostrarCapesVerificacio } from './map_layers.js';

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
}

/**
 * Refresca el selector/desplegable de fitxers pendents al DOM
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

    selectElem.innerHTML = '';

    if (pendents.length === 0) {
      selectElem.innerHTML = '<option value="">Cap fitxer pendent</option>';
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
 * Alterna entre la Secció de Verificació i la Secció d'Edició al panell lateral,
 * actualitzant les capes del mapa segons el mode actiu.
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
      actualitzarCapesMapa(); // Mostra eines i capes d'edició (switches, controls)
    });
  }

  if (btnModeVerificacio && seccioVerificacio && seccioEdicio) {
    btnModeVerificacio.addEventListener('click', () => {
      seccioEdicio.classList.add('hidden');
      seccioVerificacio.classList.remove('hidden');
      mostrarCapesVerificacio(); // Neteja elements d'edició i deixa només traçat + estacions
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
 * Actualitza la llista de punts de pas i estacions a la barra lateral.
 */
export function actualitzarLlistaPuntsUI() {
  const container = document.getElementById('llista-punts-container');
  if (!container) return;

  const currentData = state.get();
  container.innerHTML = '';

  if (!currentData.llistaPunts || currentData.llistaPunts.length === 0) {
    container.innerHTML = '<p class="text-gray-400 italic">Cap punt registrat</p>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'space-y-1';

  currentData.llistaPunts.forEach((punt, idx) => {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between bg-gray-800 p-2 rounded border border-gray-700 text-xs text-gray-200';
    li.innerHTML = `
      <span class="truncate pr-2">${idx + 1}. ${punt.nom || 'Punt sense nom'}</span>
      <button class="btn-eliminar-punt text-red-400 hover:text-red-300 font-bold px-1.5 py-0.5 rounded bg-gray-700/50 hover:bg-gray-700 cursor-pointer" data-index="${idx}">✕</button>
    `;
    ul.appendChild(li);
  });

  container.appendChild(ul);

  container.querySelectorAll('.btn-eliminar-punt').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      state.eliminarPunt(idx);
      actualitzarCapesMapa();
      actualitzarLlistaPuntsUI();
      notificarUsuari('Punt eliminat de la seqüència', 'info');
    });
  });
}

/**
 * Actualitza el panell de bloquejos de via.
 */
export function actualitzarPanellBloquejosUI() {
  const container = document.getElementById('panell-bloquejos');
  if (!container) return;

  const { viesBloquejades } = state.get();
  container.innerHTML = `
    <p class="text-xs"><strong>Vies bloquejades:</strong> ${viesBloquejades.length}</p>
  `;
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
          gpx_filename: currentState.rutaActualId,
          nom_ruta: document.getElementById('nom-ruta')?.value || currentState.nomRuta,
          data_ruta: document.getElementById('data-ruta')?.value || currentState.dataRuta,
          mode_transport: document.getElementById('select-mode-transport')?.value || currentState.modeTransport,
          estacions: currentState.llistaPunts,
          vies_bloquejades: currentState.viesBloquejades,
          switches_manuals: currentState.switchesManuals
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
          gpx_filename: currentState.rutaActualId,
          nom_ruta: document.getElementById('nom-ruta')?.value || currentState.nomRuta,
          data_ruta: document.getElementById('data-ruta')?.value || currentState.dataRuta,
          mode_transport: document.getElementById('select-mode-transport')?.value || currentState.modeTransport,
          punts: currentState.llistaPunts,
          vies_bloquejades: currentState.viesBloquejades,
          switches_manuals: currentState.switchesManuals
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
 * Configura el botó per publicar a GitHub.
 */
function setupPublishListener() {
  const btnPublish = document.getElementById('boto-publicar-github');
  if (btnPublish) {
    btnPublish.addEventListener('click', async () => {
      const btnText = document.getElementById('text-boto-publicar');
      const textOriginal = btnText ? btnText.innerText : '';
      if (btnText) btnText.innerText = 'Publicant...';

      try {
        const res = await api.publishRuta();
        notificarUsuari(res.message || 'Rutes publicades a GitHub Pages amb èxit!', 'success');
      } catch (err) {
        notificarUsuari(`Error en publicar: ${err.message}`, 'danger');
      } finally {
        if (btnText) btnText.innerText = textOriginal;
      }
    });
  }
}

function setupFilterListeners() {
  
}

/**
 * Mostra un missatge de notificació flotant a la interfície.
 */
export function notificarUsuari(missatge, tipus = 'info') {
  const notificationArea = document.getElementById('notification-area') || createNotificationArea();
  const toast = document.createElement('div');
  
  let bgClass = 'bg-blue-600';
  if (tipus === 'success') bgClass = 'bg-emerald-600';
  if (tipus === 'danger') bgClass = 'bg-red-600';

  toast.className = `${bgClass} text-white font-medium px-4 py-3 rounded-lg shadow-xl text-xs flex items-center justify-between transition-all duration-300 transform translate-y-0 opacity-100 mb-2`;
  toast.innerText = missatge;

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