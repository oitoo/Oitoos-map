/**
 * static/js/state.js
 * Gestió de l'estat global de Map Studio i historial de canvis (Undo) en format GeoJSON RFC 7946.
 */

class StateManager {
  constructor() {
    this.undoStack = [];
    this.maxUndoDepth = 25;
    this.resetState();
  }

  /**
   * Restableix l'estat inicial de l'editor en estructures GeoJSON[cite: 12, 15].
   */
  resetState() {
    this.state = {
      currentRoute: {
        type: "FeatureCollection",
        features: []
      },
      globalRoutes: [], // Llista de FeatureCollections GeoJSON[cite: 12, 15]
      rawCoords: [],
      llistaPunts: [],
      viesBloquejades: [],
      switchesManuals: {},
      detallsPendent: [],
      rutaActualId: null,
      nomRuta: '',
      dataRuta: '',
      modeTransport: 'walk',
      isDirty: false
    };
    this.undoStack = [];
  }

  get() {
    return JSON.parse(JSON.stringify(this.state));
  }

  pushSnapshot() {
    if (this.undoStack.length >= this.maxUndoDepth) {
      this.undoStack.shift();
    }
    this.undoStack.push(JSON.stringify(this.state));
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const previousState = this.undoStack.pop();
    this.state = JSON.parse(previousState);
    return true;
  }

  /**
   * Fixa la ruta actual com a FeatureCollection GeoJSON estàndard[cite: 12, 15].
   */
  setCurrentRoute(featureCollection) {
    this.pushSnapshot();
    if (featureCollection && featureCollection.type === 'FeatureCollection') {
      this.state.currentRoute = featureCollection;
    } else {
      this.state.currentRoute = {
        type: "FeatureCollection",
        features: featureCollection ? [featureCollection] : []
      };
    }
    this.state.isDirty = true;
  }

  /**
   * Fixa les rutes globals com a matriu de GeoJSON FeatureCollections[cite: 12, 15].
   */
  setGlobalRoutes(routes) {
    this.pushSnapshot();
    this.state.globalRoutes = Array.isArray(routes) ? routes : [routes];
  }

  setRawCoords(coords) {
    this.pushSnapshot();
    this.state.rawCoords = coords;
    
    // Converteix coordenades [lat, lng] a GeoJSON [lon, lat]
    const geojsonCoords = coords.map(c => [c[1], c[0]]);
    this.state.currentRoute = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: geojsonCoords
          },
          properties: {
            nom: this.state.nomRuta,
            date: this.state.dataRuta,
            category: this.state.modeTransport
          }
        }
      ]
    };
    this.state.isDirty = true;
  }

  setLlistaPunts(punts) {
    this.pushSnapshot();
    this.state.llistaPunts = punts;
    this.state.isDirty = true;
  }

  eliminarPunt(index) {
    if (index >= 0 && index < this.state.llistaPunts.length) {
      this.pushSnapshot();
      this.state.llistaPunts.splice(index, 1);
      this.state.isDirty = true;
    }
  }

  toggleViaBloquejada(viaId) {
    this.pushSnapshot();
    const index = this.state.viesBloquejades.indexOf(viaId);
    if (index === -1) {
      this.state.viesBloquejades.push(viaId);
    } else {
      this.state.viesBloquejades.splice(index, 1);
    }
    this.state.isDirty = true;
  }

  setSwitchManual(switchId, posicio) {
    this.pushSnapshot();
    this.state.switchesManuals[switchId] = posicio;
    this.state.isDirty = true;
  }

  setDetallsPendent(detalls) {
    this.state.detallsPendent = detalls;
  }

  setRutaActualId(id) {
    this.state.rutaActualId = id;
  }

  setMetadata({ nomRuta, dataRuta, modeTransport }) {
    if (nomRuta !== undefined) this.state.nomRuta = nomRuta;
    if (dataRuta !== undefined) this.state.dataRuta = dataRuta;
    if (modeTransport !== undefined) this.state.modeTransport = modeTransport;

    if (this.state.currentRoute && this.state.currentRoute.features.length > 0) {
      this.state.currentRoute.features[0].properties = {
        ...this.state.currentRoute.features[0].properties,
        nom: this.state.nomRuta,
        date: this.state.dataRuta,
        category: this.state.modeTransport
      };
    }
  }

  markClean() {
    this.state.isDirty = false;
  }
}

export const state = new StateManager();