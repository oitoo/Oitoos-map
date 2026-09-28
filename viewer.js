(function () {
    "use strict";

    // Configuració única per a estils i etiquetes (SSOT)
    const STYLES_CONFIG = {
        walk:   { label: "Caminant", color: "#16a34a", weight: 3, dashArray: null },
        bike:   { label: "Ciclisme", color: "#dc2626", weight: 3, dashArray: null },
        bus:    { label: "Autobús", color: "#eab308", weight: 3, dashArray: null },
        car:    { label: "Cotxe",    color: "#f97316", weight: 3, dashArray: null },
        train:  { label: "Tren",     color: "#c026d3", weight: 3, dashArray: null },
        boat:   { label: "Barca",    color: "#0284c7", weight: 3, dashArray: "10, 8" },
        flight: { label: "Avió",     color: "#4f46e5", weight: 3, dashArray: "16, 10" }
    };

    class GeoRouteViewer {
        constructor() {
            this.map = null;
            this.canvasRenderer = L.canvas({ padding: 0.5 });
            this.activeFeatureLayer = null;
            this.loadedGeoJsonLayers = {};
            this.loadingStatus = {};
            this.categoryState = {};

            // Caché permanent d'elements DOM
            this.dom = {
                loading: document.getElementById("loading"),
                errorToast: document.getElementById("error-toast"),
                info: document.getElementById("info"),
                title: document.getElementById("title"),
                meta: document.getElementById("meta"),
                filters: document.getElementById("filters"),
                toggleBtn: document.getElementById("toggle-filters"),
                filtersWrapper: document.getElementById("filters-wrapper")
            };

            this.initMap();
            this.renderFiltersUI();
            this.initEvents();
        }

        initMap() {
            this.map = L.map("map", { center: [41.72, 1.82], zoom: 8 });

            // Capa base original (Esri + CARTO)
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 21, maxNativeZoom: 16, attribution: 'Esri'
            }).addTo(this.map);

            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_29es_1_f27f6a0c40942b2e13c2379e', {
                maxZoom: 21, maxNativeZoom: 19, opacity: 0.7, attribution: 'CARTO'
            }).addTo(this.map);

            this.map.on("click", () => {
                this.activeFeatureLayer = null;
                this.updateInfo(null);
                this.applyStyles();
            });

            // Recalcula els estils automàticament en fer zoom
            this.map.on("zoomend", () => {
                this.applyStyles();
            });
        }

        renderFiltersUI() {
            if (!this.dom.filters) return;
            const fragment = document.createDocumentFragment();

            Object.entries(STYLES_CONFIG).forEach(([key, cfg]) => {
                this.categoryState[key] = false;
                const label = document.createElement("label");
                label.style.color = cfg.color;

                const input = document.createElement("input");
                input.type = "checkbox";
                input.value = key;
                input.style.accentColor = cfg.color;

                label.appendChild(input);
                label.appendChild(document.createTextNode(` ${cfg.label}`));
                fragment.appendChild(label);
            });

            this.dom.filters.appendChild(fragment);
        }

        showLoading(text) {
            if (this.dom.loading) {
                this.dom.loading.innerText = text;
                this.dom.loading.style.display = "block";
            }
        }

        hideLoading() {
            if (this.dom.loading) this.dom.loading.style.display = "none";
        }

        showErrorNotification(message) {
            if (!this.dom.errorToast) return;
            this.dom.errorToast.innerText = message;
            this.dom.errorToast.classList.add("visible");
            setTimeout(() => this.dom.errorToast.classList.remove("visible"), 4000);
        }

        updateInfo(props) {
            if (!this.dom.info) return;
            if (!props) {
                this.dom.info.style.display = "none";
                return;
            }
            this.dom.info.style.display = "block";
            if (this.dom.title) this.dom.title.innerText = props.nom || props.name || "Ruta sense nom";
    
            // Ara només mostrem la data (sense la categoria / mode de transport)
            if (this.dom.meta) this.dom.meta.innerText = this.formatDate(props.date);
        }

        formatDate(dateStr) {
            if (!dateStr) return "Sense data";
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
        }

        // Càlcul dinàmic de gruix i puntejat segons el nivell de zoom
        getScaledStyle(category, baseConfig) {
            const zoom = this.map ? this.map.getZoom() : 8;

            // 1. Gruix dinàmic (1px en visió mundial/zoom <= 2 fins a ~4.5px en zoom proper)
            let weight = Math.max(1, 1 + (zoom - 2) * 0.28);
            if (weight > 4.5) weight = 4.5;

            // 2. Escalat del puntejat (dashArray) per a avions i barques
            let dashArray = baseConfig.dashArray;
            if (dashArray) {
                const scale = Math.max(0.3, Math.min(1.2, zoom / 10));
                const parts = baseConfig.dashArray.split(",").map(v => parseFloat(v.trim()));
                dashArray = `${Math.max(2, Math.round(parts[0] * scale))}, ${Math.max(2, Math.round(parts[1] * scale))}`;
            }

            return { weight, dashArray };
        }

        applyStyles() {
            Object.keys(this.loadedGeoJsonLayers).forEach(category => {
                const geoJsonGroup = this.loadedGeoJsonLayers[category];
                if (!this.map.hasLayer(geoJsonGroup)) return;

                const base = STYLES_CONFIG[category] || { color: "#5C5F66", weight: 3, dashArray: null };
                const scaled = this.getScaledStyle(category, base);

                geoJsonGroup.eachLayer(layer => {
                    const isSelected = layer === this.activeFeatureLayer;
                    const isNoneSelected = !this.activeFeatureLayer;

                    layer.setStyle({
                        color: base.color,
                        weight: isSelected ? scaled.weight + 2 : (isNoneSelected ? scaled.weight : Math.max(1, scaled.weight - 1)),
                        dashArray: scaled.dashArray,
                        opacity: isSelected ? 1 : (isNoneSelected ? 0.85 : 0.25)
                    });
                });
            });
        }

        updateVisibility() {
            Object.keys(this.categoryState).forEach(cat => {
                const layer = this.loadedGeoJsonLayers[cat];
                if (!layer) return;
                this.categoryState[cat] ? (!this.map.hasLayer(layer) && layer.addTo(this.map)) : (this.map.hasLayer(layer) && this.map.removeLayer(layer));
            });
        }

        async loadCategory(category) {
            if (["loading", "loaded"].includes(this.loadingStatus[category])) {
                this.updateVisibility();
                return;
            }

            this.loadingStatus[category] = "loading";
            this.showLoading(`Carregant ${category}...`);

            try {
                const response = await fetch(`./json_publics/${category}.json`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const featureCollection = await response.json();

                const styleConfig = STYLES_CONFIG[category] || { color: "#5C5F66", weight: 3 };
                const geoJsonLayer = L.geoJSON(featureCollection, {
                    renderer: this.canvasRenderer,
                    style: () => {
                        const scaled = this.getScaledStyle(category, styleConfig);
                        return {
                            color: styleConfig.color,
                            weight: scaled.weight,
                            dashArray: scaled.dashArray,
                            opacity: 0.85
                        };
                    },
                    onEachFeature: (feature, layer) => {
                        layer.on("click", (e) => {
                            L.DomEvent.stopPropagation(e);
                            this.activeFeatureLayer = layer;
                            this.updateInfo(feature.properties);
                            this.applyStyles();
                            if (layer.getBounds) this.map.fitBounds(layer.getBounds(), { padding: [30, 30] });
                        });
                    }
                });

                this.loadedGeoJsonLayers[category] = geoJsonLayer;
                this.loadingStatus[category] = "loaded";

                if (this.categoryState[category]) geoJsonLayer.addTo(this.map);
                this.hideLoading();
                this.updateVisibility();
                this.applyStyles();

                const visibleLayers = Object.values(this.loadedGeoJsonLayers).filter(l => this.map.hasLayer(l));
                if (visibleLayers.length) {
                    this.map.fitBounds(L.featureGroup(visibleLayers).getBounds(), { padding: [40, 40] });
                }
            } catch (err) {
                console.warn(`Error en carregar ${category}:`, err);
                this.loadingStatus[category] = "error";
                this.hideLoading();
                this.showErrorNotification(`Error en carregar la categoria '${category}'.`);
            }
        }

        initEvents() {
            this.dom.filters.querySelectorAll("input[type='checkbox']").forEach(cb => {
                cb.addEventListener("change", (e) => {
                    const cat = e.target.value;
                    this.categoryState[cat] = e.target.checked;
                    if (e.target.checked) this.loadCategory(cat);
                    else {
                        this.updateVisibility();
                        this.applyStyles();
                    }
                });
            });

            this.initUIPanelEvents();
        }

        initUIPanelEvents() {
            const { filters, toggleBtn, filtersWrapper } = this.dom;
            if (!filters) return;

            const TEMPS_ESPERA = 7000;
            let hideTimer = null, tempsInici = 0, tempsCaducat = false, ratoliASobre = false;

            const showFilters = () => {
                filters.classList.remove("collapsed");
                filters.setAttribute("aria-hidden", "false");
                if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "true");
                tempsInici = Date.now();
                tempsCaducat = false;
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => {
                    tempsCaducat = true;
                    if (!ratoliASobre) hideFilters();
                }, TEMPS_ESPERA);
            };

            const hideFilters = () => {
                filters.classList.add("collapsed");
                filters.setAttribute("aria-hidden", "true");
                if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
                clearTimeout(hideTimer);
                tempsCaducat = false;
            };

            if (toggleBtn) {
                toggleBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    filters.classList.contains("collapsed") ? showFilters() : hideFilters();
                });
            }

            if (filtersWrapper) {
                filtersWrapper.addEventListener("mouseenter", () => { ratoliASobre = true; });
                filtersWrapper.addEventListener("mouseleave", () => {
                    ratoliASobre = false;
                    if (tempsCaducat || (Date.now() - tempsInici >= TEMPS_ESPERA)) hideFilters();
                });
            }

            document.addEventListener("click", (e) => {
                if (filtersWrapper && !filtersWrapper.contains(e.target)) hideFilters();
            });
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        window.geoRouteViewer = new GeoRouteViewer();
    });
})();