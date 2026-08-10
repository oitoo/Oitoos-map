/**
 * static/js/utils.js
 * Mòdul utilitari compartit per al visor i l'editor de mapes.
 */

/**
 * Paleta de colors unificada per a les categories i mitjans de transport.
 */
export const COLOR_PALETTE = {
    walk: '#2B8A3E',    // Verd
    train: '#C92A2A',   // Vermell
    cycle: '#1864AB',   // Blau
    bus: '#E67E22',     // Taronja
    default: '#5C5F66'  // Gris
};

/**
 * Retorna el color hex associat a una categoria o el color per defecte si no existeix.
 * @param {string} category - Nom de la categoria (ex: 'walk', 'train').
 * @returns {string} Codi de color en format hexadecimal.
 */
export function getCategoryColor(category) {
    if (!category) return COLOR_PALETTE.default;
    const normalized = String(category).toLowerCase().trim();
    return COLOR_PALETTE[normalized] || COLOR_PALETTE.default;
}

/**
 * Descodifica una llista de coordenades en format de polilínia codificada (OSRM/Google).
 * @param {string} encoded - Cadena de text amb la polilínia codificada.
 * @returns {Array<[number, number]>} Matriu de coordenades en format [[lat, lon], ...].
 */
export function decodePolyline(encoded) {
    if (!encoded) return [];
    
    let points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

/**
 * Executa una consulta a Overpass provant servidors mirall alternatius en cas de fallada de xarxa o de limitació de taxa.
 * @param {string} query - Consulta en llenguatge Overpass QL.
 * @returns {Promise<Object>} Objecte JSON retornat per l'API.
 */
export async function queryOverpassWithFallback(query) {
    const OVERPASS_ENDPOINTS = [
        '[https://overpass-api.de/api/interpreter](https://overpass-api.de/api/interpreter)',
        '[https://overpass.kumi.systems/api/interpreter](https://overpass.kumi.systems/api/interpreter)',
        '[https://maps.mail.ru/osm/tools/overpass/api/interpreter](https://maps.mail.ru/osm/tools/overpass/api/interpreter)'
    ];

    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `data=${encodeURIComponent(query)}`
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (err) {
            console.warn(`[Utils] Error al connectar amb ${endpoint}. Es provarà el següent mirall...`);
        }
    }
    throw new Error("Tots els servidors d'Overpass estan inaccessibles en aquest moment.");
}

/**
 * Escapa caràcters especials d'HTML per prevenir injeccions XSS al DOM.
 * @param {string} str - Cadena de text original.
 * @returns {string} Cadena de text neta i segura per utilitzar en innerHTML/textContent.
 */
export function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Formata una distància en metres a una cadena de text llegible (m o km).
 * @param {number} meters - Distància en metres.
 * @returns {string} Text formatat (ex: "850 m" o "12.4 km").
 */
export function formatDistance(meters) {
    if (typeof meters !== 'number' || isNaN(meters)) return '0 m';
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Formata una durada en segons a una cadena de text llegible (min o h min).
 * @param {number} seconds - Temps en segons.
 * @returns {string} Text formatat (ex: "45 min" o "2 h 15 min").
 */
export function formatDuration(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '0 min';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours} h ${remMinutes} min` : `${hours} h`;
}