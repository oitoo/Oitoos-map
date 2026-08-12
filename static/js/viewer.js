/**
 * GEOROUTE VIEWER (Visor Públic Natiu GeoJSON RFC 7946)
 */

const map = L.map("map", {
    center: [41.72, 1.82],
    zoom: 8,
    zoomControl: true
});

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,         
    maxNativeZoom: 16,   
    attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TNM'
}).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,   
    opacity: 0.7,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

let activeFeatureLayer = null;
const loadedGeoJsonLayers = {};

const CATEGORY_STYLES = {
    walk:  { color: "#16a34a", weight: 3, dashArray: null },
    cycle: { color: "#ea580c", weight: 3, dashArray: null },
    bus:   { color: "#d97706", weight: 3, dashArray: null },
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
    car: false,
    boat: false,
    plane: false
};

function formatDate(dateStr) {
    if (!dateStr) return "Sense data";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
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

function updateInfo(props) {
    const titleEl = document.getElementById("title");
    const metaEl = document.getElementById("meta");

    if (!props) {
        if (titleEl) titleEl.innerText = "Fes clic en una ruta";
        if (metaEl) metaEl.innerText = "";
        return;
    }

    if (titleEl) titleEl.innerText = props.nom || props.name || "Ruta sense nom";
    if (metaEl) metaEl.innerText = `${props.category ? props.category.toUpperCase() : ''} • ${formatDate(props.date)}`;
}

function applyStyles() {
    Object.keys(loadedGeoJsonLayers).forEach(category => {
        const geoJsonGroup = loadedGeoJsonLayers[category];
        if (!map.hasLayer(geoJsonGroup)) return;

        const baseStyle = CATEGORY_STYLES[category] || { color: "#3388ff", weight: 3 };

        geoJsonGroup.eachLayer(layer => {
            if (!activeFeatureLayer) {
                layer.setStyle({ color: baseStyle.color, weight: baseStyle.weight, dashArray: baseStyle.dashArray, opacity: 0.85 });
            } else if (layer === activeFeatureLayer) {
                layer.setStyle({ color: baseStyle.color, weight: baseStyle.weight + 2, dashArray: baseStyle.dashArray, opacity: 1 });
            } else {
                layer.setStyle({ color: baseStyle.color, weight: Math.max(1.5, baseStyle.weight - 1), dashArray: baseStyle.dashArray, opacity: 0.25 });
            }
        });
    });
}

function updateVisibility() {
    Object.keys(categoryState).forEach(category => {
        const layer = loadedGeoJsonLayers[category];
        if (!layer) return;

        if (categoryState[category]) {
            if (!map.hasLayer(layer)) layer.addTo(map);
        } else {
            if (map.hasLayer(layer)) map.removeLayer(layer);
        }
    });
}

function loadCategory(category) {
    if (loadedGeoJsonLayers[category]) {
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
        .then(featureCollection => {
            const styleConfig = CATEGORY_STYLES[category] || { color: "#95a5a6", weight: 3 };

            // Renderització nativa mitjançant L.geoJSON
            const geoJsonLayer = L.geoJSON(featureCollection, {
                style: () => ({
                    color: styleConfig.color,
                    weight: styleConfig.weight,
                    dashArray: styleConfig.dashArray,
                    opacity: 0.85
                }),
                onEachFeature: (feature, layer) => {
                    layer.on("click", (e) => {
                        L.DomEvent.stopPropagation(e);
                        activeFeatureLayer = layer;
                        updateInfo(feature.properties);
                        applyStyles();
                        if (layer.getBounds) {
                            map.fitBounds(layer.getBounds(), { padding: [30, 30] });
                        }
                    });
                }
            });

            loadedGeoJsonLayers[category] = geoJsonLayer;

            if (categoryState[category]) {
                geoJsonLayer.addTo(map);
            }

            hideLoading();
            updateVisibility();
            applyStyles();

            const visibleLayers = Object.values(loadedGeoJsonLayers).filter(l => map.hasLayer(l));
            if (visibleLayers.length > 0) {
                const group = L.featureGroup(visibleLayers);
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
    activeFeatureLayer = null;
    updateInfo(null);
    applyStyles();
});

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#filters input[type='checkbox']").forEach(cb => {
        const category = cb.value === 'land' ? 'car' : cb.value;
        categoryState[category] = cb.checked;

        if (cb.checked) {
            loadCategory(category);
        }

        cb.addEventListener("change", (e) => {
            const cat = e.target.value === 'land' ? 'car' : e.target.value;
            categoryState[cat] = e.target.checked;

            if (e.target.checked) {
                loadCategory(cat);
            } else {
                updateVisibility();
                applyStyles();
            }
        });
    });

    const filtersPanel = document.getElementById("filters");
    const toggleBtn = document.getElementById("toggle-filters");
    const filtersWrapper = document.getElementById("filters-wrapper");

    const TEMPS_ESPERA = 7000;
    let hideTimer = null;
    let tempsInici = 0;
    let tempsCaducat = false;
    let ratoliASobre = false;

    function showFilters() {
        filtersPanel.classList.remove("collapsed");
        tempsInici = Date.now();
        tempsCaducat = false;

        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            tempsCaducat = true;
            if (!ratoliASobre) {
                hideFilters();
            }
        }, TEMPS_ESPERA);
    }

    function hideFilters() {
        filtersPanel.classList.add("collapsed");
        clearTimeout(hideTimer);
        tempsCaducat = false;
    }

    if (toggleBtn) {
        toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (filtersPanel.classList.contains("collapsed")) {
                showFilters();
            } else {
                hideFilters();
            }
        });
    }

    if (filtersWrapper) {
        filtersWrapper.addEventListener("mouseenter", () => {
            ratoliASobre = true;
        });

        filtersWrapper.addEventListener("mouseleave", () => {
            ratoliASobre = false;
            if (tempsCaducat || (Date.now() - tempsInici >= TEMPS_ESPERA)) {
                hideFilters();
            }
        });
    }

    document.addEventListener("click", (e) => {
        if (filtersWrapper && !filtersWrapper.contains(e.target)) {
            hideFilters();
        }
    });
});