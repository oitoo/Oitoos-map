/**
 * static/js/map_layers.js
 * Manipulació de capes visuals de Leaflet 100% Read-Only mitjançant L.geoJSON().
 */

import { state } from './state.js';
import { getCategoryColor } from './utils.js';

let mapInstance = null;
let activeGeoJsonLayer = null;
let stationMarkersGroup = null;
let globalRoutesGroup = null;
let magnifierControl = null;

const CATEGORY_MAP = {
  walk: 'walk', caminant: 'walk', 'a_peu': 'walk', peu: 'walk',
  cycle: 'cycle', bicicleta: 'cycle', bici: 'cycle',
  bus: 'bus', autobus: 'bus',
  car: 'car', land: 'car', cotxe: 'car', cotxe_privat: 'car', coche: 'car',
  train: 'train', tren: 'train', ferrocarril: 'train',
  boat: 'boat', barca: 'boat', vaixell: 'boat',
  plane: 'plane', avio: 'plane'
};

export function initMapLayers(map) {
  mapInstance = map;
  
  activeGeoJsonLayer = L.geoJSON(null, {
    style: (feature) => {
      const rawCat = (feature?.properties?.category || 'car').toLowerCase();
      const cat = CATEGORY_MAP[rawCat] || rawCat;
      return {
        color: getCategoryColor(cat),
        weight: 5,
        opacity: 0.85
      };
    }
  }).addTo(mapInstance);

  stationMarkersGroup = L.layerGroup().addTo(mapInstance);
  globalRoutesGroup = L.featureGroup().addTo(mapInstance);
}

export function actualitzarCapesMapa() {
  if (!mapInstance) return;

  const currentState = state.get();
  renderGeoJsonState(currentState.rutaActual);
  renderStationMarkers(currentState.llistaPunts);
}

export function netegarCapesRuta() {
  if (activeGeoJsonLayer) activeGeoJsonLayer.clearLayers();
  if (stationMarkersGroup) stationMarkersGroup.clearLayers();
}

/**
 * Carrega i dibuixa FeatureCollections GeoJSON en mode de només lectura.
 * @param {Array|Object} rutesGeoJSON 
 * @param {Array} filtresActius 
 * @param {Function} onDesverificarCallback 
 * @param {boolean} ajustarBounds - Si és true, enquadra la vista Leaflet a totes les rutes.
 */
export function renderGlobalRoutes(rutesGeoJSON, filtresActius = [], onDesverificarCallback, ajustarBounds = true) {
  if (!globalRoutesGroup || !mapInstance) return;
  
  netegarCapesRuta();
  globalRoutesGroup.clearLayers();

  if (!rutesGeoJSON) return;

  const collections = Array.isArray(rutesGeoJSON) ? rutesGeoJSON : [rutesGeoJSON];

  collections.forEach((fc) => {
    if (!fc || (fc.type !== 'FeatureCollection' && fc.type !== 'Feature')) return;

    const layer = L.geoJSON(fc, {
      filter: (feature) => {
        if (filtresActius.length === 0) return true;
        const rawCat = (feature.properties?.category || fc.properties?.categoria || 'car').toLowerCase();
        const cat = CATEGORY_MAP[rawCat] || rawCat;
        return filtresActius.includes(cat);
      },
      style: (feature) => {
        const rawCat = (feature.properties?.category || fc.properties?.categoria || 'car').toLowerCase();
        const cat = CATEGORY_MAP[rawCat] || rawCat;
        return {
          color: getCategoryColor(cat),
          weight: 4,
          opacity: 0.85
        };
      },
      onEachFeature: (feature, featureLayer) => {
        const props = feature.properties || {};
        const cat = CATEGORY_MAP[(props.category || '').toLowerCase()] || 'car';

        const popupDiv = document.createElement('div');
        popupDiv.className = 'p-2 space-y-2 text-xs text-gray-800';
        popupDiv.innerHTML = `
          <div class="font-bold text-sm border-b pb-1 mb-1 text-gray-900">${props.nom || props.name || 'Ruta sense nom'}</div>
          <div><strong>Categoria:</strong> <span class="capitalize">${cat}</span></div>
          <div><strong>Data:</strong> ${props.date || '-'}</div>
          <button class="btn-desverificar-map mt-2 w-full bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-2 rounded transition cursor-pointer flex items-center justify-center gap-1 shadow">
            <span>⚠️</span> <span>Desverificar / Tornar a pendents</span>
          </button>
        `;

        const btnDesverificar = popupDiv.querySelector('.btn-desverificar-map');
        if (btnDesverificar) {
          btnDesverificar.addEventListener('click', () => {
            if (onDesverificarCallback) onDesverificarCallback(props.id);
          });
        }

        featureLayer.bindPopup(popupDiv);
      }
    });

    globalRoutesGroup.addLayer(layer);
  });

  if (ajustarBounds) {
    try {
      const bounds = globalRoutesGroup.getBounds();
      if (bounds.isValid()) mapInstance.fitBounds(bounds, { padding: [30, 30] });
    } catch (e) {
      console.warn('[MapLayers] Error ajustant bounds de rutes globals:', e);
    }
  }
}

export function netejarRutesGlobals() {
  if (globalRoutesGroup) globalRoutesGroup.clearLayers();
}

function renderGeoJsonState(currentRouteFeatureCollection) {
  if (!activeGeoJsonLayer) return;
  activeGeoJsonLayer.clearLayers();

  if (!currentRouteFeatureCollection || !currentRouteFeatureCollection.features?.length) return;

  activeGeoJsonLayer.addData(currentRouteFeatureCollection);

  try {
    const bounds = activeGeoJsonLayer.getBounds();
    if (bounds.isValid()) mapInstance.fitBounds(bounds, { padding: [40, 40] });
  } catch (e) {
    console.warn('[MapLayers] Error en calcular bounds de la capa GeoJSON:', e);
  }
}

function renderStationMarkers(punts) {
  stationMarkersGroup.clearLayers();
  if (!punts || !Array.isArray(punts)) return;

  punts.forEach((punt, index) => {
    let lat = punt.lat ?? punt.latitude;
    let lng = punt.lng ?? punt.lon ?? punt.longitude;

    if ((lat == null || lng == null) && Array.isArray(punt.coords) && punt.coords.length >= 2) {
      lat = Number(punt.coords[0]);
      lng = Number(punt.coords[1]);
    }

    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;

    const icon = L.divIcon({
      className: 'custom-station-icon',
      html: `<div style="background-color: #3273dc; color: white; border-radius: 50%; width: 24px; height: 24px; text-align: center; line-height: 24px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${index + 1}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([lat, lng], { icon, draggable: false });
    marker.bindTooltip(punt.nom || `Punt ${index + 1}`);

    stationMarkersGroup.addLayer(marker);
  });
}

export function toggleMagnifier(activar) {
  if (!mapInstance) return;

  if (activar && !magnifierControl) {
    magnifierControl = L.control.lens ? L.control.lens() : null;
    if (magnifierControl) magnifierControl.addTo(mapInstance);
  } else if (!activar && magnifierControl) {
    mapInstance.removeControl(magnifierControl);
    magnifierControl = null;
  }
}