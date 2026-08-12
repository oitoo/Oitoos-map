/**
 * static/js/map_layers.js
 * Manipulació de capes visuals de Leaflet mitjançant l'API nativa L.geoJSON().
 */

import { state } from './state.js';

let mapInstance = null;
let activeGeoJsonLayer = null;
let stationMarkersGroup = null;
let switchMarkersGroup = null;
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

const CATEGORY_COLORS = {
  walk: '#22c55e',
  cycle: '#f97316',
  bus: '#f59e0b',
  car: '#ef4444',
  train: '#d946ef',
  boat: '#0ea5e9',
  plane: '#6366f1'
};

export function initMapLayers(map) {
  mapInstance = map;
  
  activeGeoJsonLayer = L.geoJSON(null, {
    style: (feature) => {
      const cat = CATEGORY_MAP[feature?.properties?.category] || 'car';
      return {
        color: CATEGORY_COLORS[cat] || '#209cee',
        weight: 5,
        opacity: 0.85
      };
    }
  }).addTo(mapInstance);

  stationMarkersGroup = L.layerGroup().addTo(mapInstance);
  switchMarkersGroup = L.layerGroup().addTo(mapInstance);
  
  // Utilitzar L.featureGroup() per al càlcul automàtic de límits (getBounds())[cite: 12, 13]
  globalRoutesGroup = L.featureGroup().addTo(mapInstance);
}

export function actualitzarCapesMapa(isEdicio = false) {
  if (!mapInstance) return;

  const currentState = state.get();
  renderGeoJsonState(currentState.currentRoute);
  renderStationMarkers(currentState.llistaPunts);

  if (isEdicio) {
    renderSwitchMarkers(currentState.switchesManuals, currentState.rawCoords);
  } else {
    if (switchMarkersGroup) switchMarkersGroup.clearLayers();
  }
}

export function mostrarCapesVerificacio() {
  if (switchMarkersGroup) switchMarkersGroup.clearLayers();
  actualitzarCapesMapa(false);
}

export function amagarCapesEdicio() {
  if (activeGeoJsonLayer) activeGeoJsonLayer.clearLayers();
  if (stationMarkersGroup) stationMarkersGroup.clearLayers();
  if (switchMarkersGroup) switchMarkersGroup.clearLayers();
}

/**
 * Carrega i dibuixa FeatureCollections GeoJSON usant L.geoJSON() natiu[cite: 12, 13].
 */
export function renderGlobalRoutes(rutesGeoJSON, filtresActius = [], onDesverificarCallback) {
  if (!globalRoutesGroup || !mapInstance) return;
  
  amagarCapesEdicio();
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
          color: CATEGORY_COLORS[cat] || '#209cee',
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

  try {
    const bounds = globalRoutesGroup.getBounds();
    if (bounds.isValid()) mapInstance.fitBounds(bounds, { padding: [30, 30] });
  } catch (e) {
    console.warn('[MapLayers] Error ajustant bounds de rutes globals:', e);
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
    let lat = punt.lat;
    let lng = punt.lng;

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

    const marker = L.marker([lat, lng], { icon, draggable: true });
    marker.bindTooltip(punt.nom || `Punt ${index + 1}`);

    marker.on('dragend', (e) => {
      const newPos = e.target.getLatLng();
      const updatedPunts = [...state.get().llistaPunts];
      updatedPunts[index] = {
        ...updatedPunts[index],
        lat: newPos.lat,
        lng: newPos.lng,
        coords: [newPos.lat, newPos.lng]
      };
      state.setLlistaPunts(updatedPunts);
    });

    stationMarkersGroup.addLayer(marker);
  });
}

function renderSwitchMarkers(switchesManuals, coords) {
  switchMarkersGroup.clearLayers();
  if (!switchesManuals || !coords || coords.length === 0) return;

  Object.keys(switchesManuals).forEach((switchId) => {
    const posicio = switchesManuals[switchId];
    const point = coords[parseInt(switchId, 10)];
    if (point && Array.isArray(point) && point.length >= 2) {
      const color = posicio === 'diverted' ? '#ffdd57' : '#48c774';
      const circle = L.circleMarker([point[0], point[1]], {
        radius: 8,
        fillColor: color,
        color: '#000',
        weight: 1,
        fillOpacity: 0.9
      });
      circle.bindPopup(`Canvi de via ID: ${switchId}<br>Estat: <strong>${posicio}</strong>`);
      switchMarkersGroup.addLayer(circle);
    }
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