/**
 * GEOROUTE VIEWER (Web pública estàtica - Mode Clar & Auto-hide)
 */

// 1. Inicialització del mapa base amb només alfabet llatí (Esri)
const map = L.map("map", {
    center: [41.72, 1.82],
    zoom: 8,
    zoomControl: true
});

// 1. Capa de fons: Relleu Esri
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,         // Zoom màxim permès a la pantalla
    maxNativeZoom: 16,   // A partir de zoom 16, estira la imatge en lloc de demanar-ne de noves
    attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TNM'
}).addTo(map);

// 2. Capa superior: Noms i vies (CARTO)
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,   // CARTO arriba molt ben definit fins a nivell 19
    opacity: 0.7,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

// Estat global
let activeLine = null;
const allLines = [];
const loadedCategories = {};

const CATEGORY_STYLES = {
    walk:  { color: "#16a34a", weight: 3, dashArray: null },
    cycle: { color: "#ea580c", weight: 3, dashArray: null },
    bus:   { color: "#d97706", weight: 3, dashArray: null },
    land:  { color: "#dc2626", weight: 3, dashArray: null },
    cotxe: { color: "#dc2626", weight: 3, dashArray: null },
    car:   { color: "#dc2626", weight: 3, dashArray: null },
    train: { color: "#c026d3", weight: 3, dashArray: null },
    boat:  { color: "#0284c7", weight: 3, dashArray: "10, 8" },
    plane: { color: "#4f46e5", weight: 3, dashArray: "16, 10" }
};

const categoryState = {
    walk: false,
    cycle: false,
    bus: false,
    train: false,
    land: false,
    boat: false,
    plane: false
};

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

function formatDate(dateStr) {
    if (!dateStr) return "Sense data";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
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

    if (titleEl) titleEl.innerText = track.name || track.title || "Ruta sense nom";
    if (metaEl) metaEl.innerText = `${track.category ? track.category.toUpperCase() : ''} • ${formatDate(track.date)}`;
}

function applyStyles() {
    allLines.forEach(l => {
        if (!map.hasLayer(l)) return;

        const cat = l._track.category;
        const style = CATEGORY_STYLES[cat] || { color: "#3388ff", weight: 3, dashArray: null };

        if (!activeLine) {
            l.setStyle({ color: style.color, weight: style.weight, dashArray: style.dashArray, opacity: 0.85 });
            return;
        }

        if (l === activeLine) {
            l.setStyle({ color: style.color, weight: style.weight + 2, dashArray: style.dashArray, opacity: 1 });
        } else {
            l.setStyle({ color: style.color, weight: Math.max(1.5, style.weight - 1), dashArray: style.dashArray, opacity: 0.25 });
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

function loadCategory(category) {
    if (loadedCategories[category]) {
        updateVisibility();
        return;
    }

    showLoading(`S'estan carregant les rutes de ${category}...`);

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

                const style = CATEGORY_STYLES[category] || { color: "#95a5a6", weight: 3, dashArray: null };

                const line = L.polyline(latLngs, {
                    color: style.color,
                    weight: style.weight,
                    dashArray: style.dashArray,
                    opacity: 0.85
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
            applyStyles();

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

// --- ESDEVENIMENTS I INTERACCIÓ DE LA LLEGENDA ---

map.on("click", () => {
    activeLine = null;
    updateInfo(null);
    applyStyles();
});

document.addEventListener("DOMContentLoaded", () => {
    // 1. Checkboxes
    document.querySelectorAll("#filters input[type='checkbox']").forEach(cb => {
        const category = cb.value;
        categoryState[category] = cb.checked;

        if (cb.checked) {
            loadCategory(category);
        }

        cb.addEventListener("change", (e) => {
            const cat = e.target.value;
            categoryState[cat] = e.target.checked;

            if (e.target.checked) {
                loadCategory(cat);
            } else {
                updateVisibility();
                applyStyles();
            }
        });
    });

    // 2. Control del desplegable auto-ocultable
    const filtersPanel = document.getElementById("filters");
    const toggleBtn = document.getElementById("toggle-filters");
    const filtersWrapper = document.getElementById("filters-wrapper");

    let hideTimer = null;

    function showFilters() {
        filtersPanel.classList.remove("collapsed");
        resetHideTimer();
    }

    function hideFilters() {
        filtersPanel.classList.add("collapsed");
        clearTimeout(hideTimer);
    }

    function resetHideTimer() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideFilters();
        }, 3500); // 3.5 segons d'inactivitat per plegar-se
    }

    // Fer clic al botó alterna entre desplegat i col·lapsat
    toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (filtersPanel.classList.contains("collapsed")) {
            showFilters();
        } else {
            hideFilters();
        }
    });

    // Mantenir obert mentre el ratolí estigui a sobre
    filtersWrapper.addEventListener("mouseenter", () => {
        clearTimeout(hideTimer);
    });

    // Iniciar compte enrere quan el ratolí surt de la zona
    filtersWrapper.addEventListener("mouseleave", () => {
        if (!filtersPanel.classList.contains("collapsed")) {
            resetHideTimer();
        }
    });

    // Amagar si es fa clic fora del panell
    document.addEventListener("click", (e) => {
        if (!filtersWrapper.contains(e.target)) {
            hideFilters();
        }
    });
});