/**
 * GEOROUTE VIEWER (Web pública estàtica)
 * Només lectura. Carrega les rutes des de static/json_publics/ i les dibuixa a Leaflet.
 */

// 1. Inicialització del mapa base
const map = L.map("map", {
    center: [41.72, 1.82],
    zoom: 8,
    zoomControl: true
});

// Capa base fosca / CartoDB Dark Matter
L.tileLayer('https://{s}[.basemaps.cartocdn.com/dark_all/](https://.basemaps.cartocdn.com/dark_all/){z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="[https://www.openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)">OpenStreetMap</a> &copy; <a href="[https://carto.com/](https://carto.com/)">CARTO</a>'
}).addTo(map);

// Estat global
let activeLine = null;
const allLines = [];
const loadedCategories = {};

// Configuració de la paleta de colors per categoria
const CATEGORY_COLORS = {
    walk: "#22c55e",     // Verd
    cycle: "#f97316",    // Taronja
    train: "#a855f7",    // Púrpura
    land: "#ef4444",     // Vermell
    boat: "#3b82f6",     // Blau
    plane: "#eab308"     // Groc
};

const categoryState = {
    walk: false,
    cycle: false,
    train: false,
    land: false,
    boat: false,
    plane: false
};

// --- DESCODIFICADOR DE POLILÍNIA CODIFICADA (GOOGLE) ---
function decodePolyline(encoded) {
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

// --- UTILITATS ---

function formatDate(dateStr) {
    if (!dateStr) return "Sense data";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getColor(cat) {
    return CATEGORY_COLORS[cat] || "#95a5a6";
}

function showLoading(text) {
    const el = document.getElementById("loading");
    if (el) {
        el.innerText = text;
        el.style.display = "block";
    }
}

function hideLoading() {
    const el = document.getElementById("loading");
    if (el) el.style.display = "none";
}

function updateInfo(track) {
    const titleEl = document.getElementById("title");
    const metaEl = document.getElementById("meta");

    if (!track) {
        if (titleEl) titleEl.innerText = "Cliqueu en una ruta";
        if (metaEl) metaEl.innerText = "";
        return;
    }

    if (titleEl) titleEl.innerText = track.name || track.title || "Ruta sense nom";
    if (metaEl) metaEl.innerText = `${track.category ? track.category.toUpperCase() : ''} • ${formatDate(track.date)}`;
}

// --- GESTIÓ D'ESTILS I VISIBILITAT ---

function applyStyles() {
    allLines.forEach(l => {
        if (!map.hasLayer(l)) return;

        if (!activeLine) {
            l.setStyle({ opacity: 0.7, weight: 3 });
            return;
        }

        if (l === activeLine) {
            l.setStyle({ opacity: 1, weight: 6 });
        } else {
            l.setStyle({ opacity: 0.2, weight: 2 });
        }
    });
}

function updateVisibility() {
    allLines.forEach(line => {
        const cat = line._track.category;
        if (categoryState[cat]) {
            if (!map.hasLayer(line)) line.addTo(map);
        } else {
            if (map.hasLayer(line)) map.removeLayer(line);
        }
    });
}

// --- CARREGADOR DE CATEGORIES DES DE STATIC/JSON_PUBLICS ---

function loadCategory(category) {
    if (loadedCategories[category]) {
        updateVisibility();
        return;
    }

    showLoading(`S'estan carregant les rutes de ${category}...`);

    // Ruta relativa compatible amb GitHub Pages i Flask
    const jsonPath = `./static/json_publics/${category}.json`;

    fetch(jsonPath)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(tracks => {
            tracks.forEach(track => {
                let latLngs = [];

                if (track.polyline) {
                    latLngs = decodePolyline(track.polyline);
                } else {
                    const punts = track.coords || track.points;
                    if (!punts || !punts.length) return;

                    latLngs = punts.map(p => {
                        let lat, lon;
                        if (Array.isArray(p)) {
                            lat = p[0]; lon = p[1];
                        } else if (p && p.coords && Array.isArray(p.coords)) {
                            lat = p.coords[0]; lon = p.coords[1];
                        } else {
                            return null;
                        }

                        if (Number.isInteger(lat)) lat /= 100000;
                        if (Number.isInteger(lon)) lon /= 100000;

                        return [lat, lon];
                    }).filter(c => c !== null);
                }

                if (latLngs.length === 0) return;

                const line = L.polyline(latLngs, {
                    color: getColor(category),
                    weight: 3,
                    opacity: 0.7
                });

                line._track = { ...track, category };
                allLines.push(line);

                if (categoryState[category]) {
                    line.addTo(map);
                }

                line.on("click", (e) => {
                    L.DomEvent.stopPropagation(e);
                    activeLine = line;
                    updateInfo(line._track);
                    applyStyles();
                    map.fitBounds(line.getBounds(), { padding: [30, 30] });
                });
            });

            loadedCategories[category] = true;
            hideLoading();
            updateVisibility();

            const visibleLines = allLines.filter(l => map.hasLayer(l));
            if (visibleLines.length > 0) {
                const group = L.featureGroup(visibleLines);
                map.fitBounds(group.getBounds(), { padding: [40, 40] });
            }
        })
        .catch(err => {
            console.warn(`No s'han pogut carregar les rutes de ${category}:`, err);
            hideLoading();
        });
}

// --- ESDEVENIMENTS ---

map.on("click", () => {
    activeLine = null;
    updateInfo(null);
    applyStyles();
});

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#filters input[type='checkbox']").forEach(cb => {
        cb.addEventListener("change", (e) => {
            const category = e.target.value;
            categoryState[category] = e.target.checked;

            if (e.target.checked) {
                loadCategory(category);
            } else {
                updateVisibility();
                applyStyles();
            }
        });
    });
});