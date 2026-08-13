/**
 * static/js/api.js
 * Capa d'integració REST API per al backend de Flask en GeoJSON directe.
 * Inclou control d'errors unificat, bloqueig d'interfície anti-duplicació i validació d'estat.
 */

import { state } from './state.js';

/**
 * Processa la resposta HTTP de qualsevol petició i en gestiona els errors de backend.
 */
async function handleResponse(response) {
  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: 'Error inesperat al servidor.' };
    }
    const message = errorData.message || errorData.error || `Error HTTP ${response.status}: ${response.statusText}`;
    throw new Error(message);
  }
  return await response.json();
}

/**
 * Controla l'activació/desactivació visual dels elements d'acció durant peticions asíncrones.
 */
function toggleUiLoading(isLoading) {
  const actionButtons = document.querySelectorAll('button, input[type="submit"], select');
  actionButtons.forEach((btn) => {
    if (isLoading) {
      if (!btn.hasAttribute('data-was-disabled')) {
        btn.setAttribute('data-was-disabled', btn.disabled ? 'true' : 'false');
      }
      btn.disabled = true;
      btn.classList.add('opacity-50', 'pointer-events-none');
    } else {
      const wasDisabled = btn.getAttribute('data-was-disabled') === 'true';
      if (!wasDisabled) {
        btn.disabled = false;
      }
      btn.removeAttribute('data-was-disabled');
      btn.classList.remove('opacity-50', 'pointer-events-none');
    }
  });
}

/**
 * Wrapper unificat per realitzar totes les peticions HTTP de l'aplicació.
 */
async function apiFetch(url, options = {}, { validationType = null } = {}) {
  const currentState = state.get();
  
  if (currentState.carregant) {
    throw new Error("Hi ha una operació en curs. Sisplau, espera que finalitzi.");
  }

  if (validationType === 'verificar' && !state.potVerificar()) {
    throw new Error("No es pot verificar la ruta: no hi ha cap ruta GeoJSON vàlida o el nom de fitxer no és vàlid.");
  }

  if (validationType === 'publicar' && !state.potPublicar()) {
    throw new Error("No es pot publicar en aquest moment.");
  }

  state.setCarregant(true);
  toggleUiLoading(true);

  try {
    const res = await fetch(url, options);
    return await handleResponse(res);
  } catch (err) {
    console.error(`[API Fetch Error] ${url}:`, err);
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error("Error de connexió amb el servidor. Comprova la xarxa.");
    }
    throw err;
  } finally {
    state.setCarregant(false);
    toggleUiLoading(false);
  }
}

/**
 * Obté la llista de rutes pendents de verificar.
 */
export async function getPendents() {
  try {
    return await apiFetch('/api/pendents');
  } catch (err) {
    throw new Error(`No s'ha pogut carregar la llista de pendents: ${err.message}`);
  }
}

/**
 * Obté la llista de rutes com a respostes GeoJSON.
 */
export async function getRoutes() {
  try {
    return await apiFetch(`/api/get_routes?_t=${Date.now()}`, { cache: 'no-store' });
  } catch (err) {
    throw new Error(`No s'ha pogut carregar la llista de rutes: ${err.message}`);
  }
}

/**
 * Desverifica una ruta publicada i la retorna a la carpeta de pendents.
 */
export async function desverificarRuta(routeId) {
  try {
    return await apiFetch('/api/desverificar_ruta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_id: routeId })
    });
  } catch (err) {
    throw new Error(`Error en desverificar la ruta: ${err.message}`);
  }
}

/**
 * Genera una ruta mitjançant un prompt d'IA.
 */
export async function generarRuta(payload) {
  try {
    return await apiFetch('/api/generar_ruta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error(`No s'ha pogut generar la ruta: ${err.message}`);
  }
}

/**
 * Importa un traçat des d'un enllaç o dades de Google Maps.
 */
export async function importarGoogleMaps(payload) {
  try {
    const bodyData = typeof payload === 'string' ? { url: payload } : payload;
    return await apiFetch('/api/importar_google_maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
  } catch (err) {
    throw new Error(`Error en la importació des de Google Maps: ${err.message}`);
  }
}

/**
 * Obté la informació detallada i dades d'elevació/pendent.
 */
export async function getDetallsPendent(coords) {
  try {
    return await apiFetch('/api/detalls_pendent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords })
    });
  } catch (err) {
    throw new Error(`Error en calcular els detalls de pendent: ${err.message}`);
  }
}

/**
 * Desa les metadades actualitzades de la ruta.
 */
export async function desarEdicio(routeData) {
  try {
    return await apiFetch('/api/desar_edicio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeData)
    });
  } catch (err) {
    throw new Error(`No s'han pogut desar els canvis: ${err.message}`);
  }
}

/**
 * Valida i mou la ruta a l'estat verificat.
 */
export async function verificarRuta(routeData) {
  try {
    return await apiFetch('/api/verificar_ruta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeData)
    }, { validationType: 'verificar' });
  } catch (err) {
    throw new Error(`Error durant la verificació de la ruta: ${err.message}`);
  }
}

/**
 * Publica les rutes verificades cap a GitHub Pages.
 */
export async function publishRuta(routeId = null) {
  try {
    return await apiFetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_id: routeId })
    }, { validationType: 'publicar' });
  } catch (err) {
    throw new Error(`No s'ha pogut publicar a GitHub: ${err.message}`);
  }
}

/**
 * Consulta l'API d'Overpass per a dades geomètriques de suport.
 */
export async function queryOverpass(query) {
  try {
    const endpoint = 'https://overpass-api.de/api/interpreter';
    return await apiFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`
    });
  } catch (err) {
    throw new Error(`Error en la consulta Overpass: ${err.message}`);
  }
}