/**
 * GEOROUTE VIEWER (Web Pública Estàtica)
 * Només lectura. Carrega les rutes des de dades/json_publics/ i les dibuixa a Leaflet.
 */

// 1. Inicialització del Mapa
const map = L.map("map", {
    center: [20, 0],
    zoom: 2,
    zoomControl: true
});

// Capa Base OpenStreetMap
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Estat global
let activeLine = null;
const allLines = [];
const loadedCategories = {};

// Configuració de la paleta de colors per categoria
const CATEGORY_COLORS = {
    walk: "#2ecc71",     // Verd
    cycle: "#f39c12",    // Taronja
    train: "#9b59b6",    // Lila
    land: "#e74c3c",     // Vermell
    boat: "#3498db",     // Blau
    plane: "#f1c40f"     // Groc
};

// Mode/Estat dels filtres
const categoryState = {
    walk: false,
    cycle: false,
    train: false,
    land: false,
    boat: false,
    plane: false
};

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
        if (titleEl) titleEl.innerText = "Fes clic en una ruta";
        if (metaEl) metaEl.innerText = "";
        return;
    }

    if (titleEl) titleEl.innerText = track.name || "Ruta sense nom";
    if (metaEl) metaEl.innerText = `${track.category ? track.category.toUpperCase() : ''} • ${formatDate(track.date)}`;
}

// --- GESTIÓ D'ESTILS I VISIBILITAT ---

function applyStyles() {
    allLines.forEach(l => {
        if (!map.hasLayer(l)) return;

        if (!activeLine) {
            l.setStyle({ opacity: 0.6, weight: 3 });
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

// --- CARREGADOR DE CATEGORIES ---

function loadCategory(category) {
    if (loadedCategories[category]) {
        updateVisibility();
        return;
    }

    showLoading(`Carregant rutes de ${category}...`);

    // Carrega directament el fitxer JSON públic exportat per l'Admin
    fetch(`dades/json_publics/${category}.json`)
        .then(response => {
            if (!response.ok) throw new Error("Fitxer no trobat");
            return response.json();
        })
        .then(tracks => {
            tracks.forEach(track => {
                if (!track.points || !track.points.length) return;

                // Descomprimeix o adapta les coordenades si és necessari
                const latLngs = track.points.map(p => {
                    // Admet tant formats comprimits (p[0]/100000) com arrays estàndard [lat, lon]
                    const lat = p[0] > 180 || p[0] < -180 ? p[0] / 100000 : p[0];
                    const lon = p[1] > 180 || p[1] < -180 ? p[1] / 100000 : p[1];
                    return [lat, lon];
                });

                const line = L.polyline(latLngs, {
                    color: getColor(category),
                    weight: 3,
                    opacity: 0.6
                });

                line._track = { ...track, category };
                allLines.push(line);

                if (categoryState[category]) {
                    line.addTo(map);
                }

                // Esdeveniment de selecció
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

            // Sincronitza la vista global
            if (allLines.length > 0) {
                const visibleLines = allLines.filter(l => map.hasLayer(l));
                if (visibleLines.length > 0) {
                    const group = L.featureGroup(visibleLines);
                    map.fitBounds(group.getBounds(), { padding: [30, 30] });
                }
            }
        })
        .catch(err => {
            console.warn(`No s'han pogut carregar les rutes de ${category}:`, err);
            hideLoading();
        });
}

// --- ESDEVENIMENTS ---

// Deseleccionar en fer clic fora
map.on("click", () => {
    activeLine = null;
    updateInfo(null);
    applyStyles();
});

// Escoltar els canvis dels Checkboxes de filtres
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