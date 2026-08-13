/**
 * static/js/state.js
 * Gestió de l'estat centralitzat i font única de la veritat per a Map Studio.
 * Model de dades immutable i de només lectura/verificació en format GeoJSON RFC 7946.
 */

class StateManager {
  constructor() {
    this.reset();
  }

  /**
   * Restableix l'estat inicial del panell de control.
   */
  reset() {
    this.state = {
      rutaActual: null,        // FeatureCollection GeoJSON carregada (o null)
      nomFitxer: '',           // Nom del fitxer actual (ex: "tren_r1.gpx")
      estatCirculacio: null,   // 'pendent' | 'draft' | 'verificat'
      carregant: false,        // Flag de bloqueig UI durant operacions asíncrones
      globalRoutes: [],        // Llista de FeatureCollections GeoJSON publicades
      rawCoords: [],           // Coordenades originals [lat, lng]
      llistaPunts: [],         // Waypoints / Estacions
      metadata: {
        nomRuta: '',
        dataRuta: '',
        modeTransport: 'train'
      }
    };
  }

  /**
   * Retorna una còpia profunda immutabilitzada de l'estat actual per evitar mutacions accidentals.
   */
  get() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Comprova si la FeatureCollection GeoJSON actual és vàlida segons l'estàndard RFC 7946.
   */
  esGeoJSONValid(fc = this.state.rutaActual) {
    if (!fc || typeof fc !== 'object') return false;
    if (fc.type !== 'FeatureCollection') return false;
    if (!Array.isArray(fc.features) || fc.features.length === 0) return false;
    
    return fc.features.some(f => f && f.geometry && Array.isArray(f.geometry.coordinates));
  }

  /**
   * Validació de transició d'estat: Determina si la ruta actual es pot verificar.
   */
  potVerificar() {
    if (this.state.carregant) return false;
    if (!this.state.nomFitxer) return false;
    return this.esGeoJSONValid();
  }

  /**
   * Validació de transició d'estat: Determina si es pot publicar a GitHub Pages.
   */
  potPublicar() {
    if (this.state.carregant) return false;
    return true;
  }

  setCarregant(carregant) {
    this.state.carregant = Boolean(carregant);
  }

  setNomFitxer(nomFitxer) {
    this.state.nomFitxer = nomFitxer || '';
  }

  // Àlies per mantenir la compatibilitat amb la resta de mòduls
  setRutaActualId(id) {
    this.setNomFitxer(id);
  }

  setEstatCirculacio(estat) {
    const estatsValids = ['pendent', 'draft', 'verificat', null];
    if (estatsValids.includes(estat)) {
      this.state.estatCirculacio = estat;
    }
  }

  setRutaActual(featureCollection) {
    if (featureCollection && featureCollection.type === 'FeatureCollection') {
      this.state.rutaActual = featureCollection;
    } else if (featureCollection && featureCollection.type === 'Feature') {
      this.state.rutaActual = {
        type: 'FeatureCollection',
        features: [featureCollection]
      };
    } else {
      this.state.rutaActual = null;
    }
  }

  setRawCoords(coords) {
    this.state.rawCoords = Array.isArray(coords) ? coords : [];
    
    if (this.state.rawCoords.length > 0) {
      // Si el primer punt conté la latitud com a segon element (format GeoJSON estàndard [lng, lat]),
      // es preserva sense invertir.
      const geojsonCoords = this.state.rawCoords.map(c => {
        if (Array.isArray(c) && c.length >= 2) {
          return [Number(c[0]), Number(c[1])];
        }
        return c;
      });

      this.state.rutaActual = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: geojsonCoords
            },
            properties: {
              nom: this.state.metadata.nomRuta,
              date: this.state.metadata.dataRuta,
              category: this.state.metadata.modeTransport
            }
          }
        ]
      };
    }
  }

  setLlistaPunts(punts) {
    this.state.llistaPunts = Array.isArray(punts) ? punts : [];
  }

  setMetadata({ nomRuta, dataRuta, modeTransport }) {
    if (nomRuta !== undefined) this.state.metadata.nomRuta = nomRuta;
    if (dataRuta !== undefined) this.state.metadata.dataRuta = dataRuta;
    if (modeTransport !== undefined) this.state.metadata.modeTransport = modeTransport;

    if (this.state.rutaActual && this.state.rutaActual.features?.length > 0) {
      this.state.rutaActual.features[0].properties = {
        ...this.state.rutaActual.features[0].properties,
        nom: this.state.metadata.nomRuta,
        date: this.state.metadata.dataRuta,
        category: this.state.metadata.modeTransport
      };
    }
  }

  setGlobalRoutes(routes) {
    this.state.globalRoutes = Array.isArray(routes) ? routes : [routes];
  }

  markClean() {
    // Es manté per compatibilitat d'interfície
  }
}

export const state = new StateManager();