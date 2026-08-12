/**
 * static/js/api.js
 * Capa d'integració REST API per al backend de Flask en GeoJSON directe.
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
 * Obté la llista de rutes com a respostes GeoJSON.
 */
export async function getRoutes() {
  try {
    const res = await fetch(`/api/get_routes?_t=${Date.now()}`, { cache: 'no-store' });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API getRoutes]', err);
    throw new Error(`No s'ha pogut carregar la llista de rutes: ${err.message}`);
  }
}

export async function desverificarRuta(routeId) {
  try {
    const res = await fetch('/api/desverificar_ruta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_id: routeId })
    });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API desverificarRuta]', err);
    throw new Error(`Error en desverificar la ruta: ${err.message}`);
  }
}

export async function generarRuta(payload) {
  try {
    const res = await fetch('/api/generar_ruta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API generarRuta]', err);
    throw new Error(`No s'ha pogut generar la ruta: ${err.message}`);
  }
}

export async function importarGoogleMaps(payload) {
  try {
    const bodyData = typeof payload === 'string' ? { url: payload } : payload;
    const res = await fetch('/api/importar_google_maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API importarGoogleMaps]', err);
    throw new Error(`Error en la importació des de Google Maps: ${err.message}`);
  }
}

export async function getDetallsPendent(coords) {
  try {
    const res = await fetch('/api/detalls_pendent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords })
    });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API getDetallsPendent]', err);
    throw new Error(`Error en calcular els detalls de pendent: ${err.message}`);
  }
}

export async function desarEdicio(routeData) {
  try {
    const res = await fetch('/api/desar_edicio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeData)
    });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API desarEdicio]', err);
    throw new Error(`No s'han pogut desar els canvis: ${err.message}`);
  }
}

export async function verificarRuta(routeData) {
  try {
    const res = await fetch('/api/verificar_ruta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeData)
    });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API verificarRuta]', err);
    throw new Error(`Error durant la verificació de la ruta: ${err.message}`);
  }
}

export async function publishRuta(routeId = null) {
  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_id: routeId })
    });
    return await handleResponse(res);
  } catch (err) {
    console.error('[API publishRuta]', err);
    throw new Error(`No s'ha pogut publicar a GitHub: ${err.message}`);
  }
}

export async function queryOverpass(query) {
  try {
    const endpoint = 'https://overpass-api.de/api/interpreter';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`
    });

    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error('[API queryOverpass]', err);
    throw new Error(`Error en la consulta Overpass: ${err.message}`);
  }
}

export async function getPendents() {
  try {
    const res = await fetch('/api/pendents');
    return await handleResponse(res);
  } catch (err) {
    console.error('[API getPendents]', err);
    throw new Error(`No s'ha pogut carregar la llista de pendents: ${err.message}`);
  }
}