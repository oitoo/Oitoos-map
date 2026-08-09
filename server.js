const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8080;

// Middlewares per processar JSON i dades de formulari
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Suport per a fitxers gzipped (.gz)
app.use((req, res, next) => {
    if (req.url.endsWith('.gz')) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Type', 'application/json');
    }
    next();
});

// Fitxers estàtics (CSS, JS, Tracks, etc.)
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/tracks', express.static(path.join(__dirname, 'tracks')));
app.use(express.static(__dirname));

// ==========================================
// RUTES DE LA INTERFÍCIE
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/carregar_pendent/:filename', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// ENDPOINT: PUBLICAR A GITHUB PAGES
// ==========================================
app.post('/api/publish', (req, res) => {
    // Afegim només la carpeta tracks/ i el fitxer index.html
    const gitCommand = 'git add tracks/ index.html && (git diff-index --quiet HEAD || git commit -m "Actualització de rutes públiques") && git push';

    exec(gitCommand, { cwd: __dirname }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error en publicar a GitHub: ${error.message}`);
            return res.status(500).json({ 
                success: false, 
                message: "Error en executar les comandes de Git: " + error.message 
            });
        }
        
        console.log(`Git Output: ${stdout}`);
        return res.json({ 
            success: true, 
            message: "El mapa s'ha publicat correctament a GitHub Pages!" 
        });
    });
});

// ==========================================
// ENDPOINTS DE L'API DE GEOROUTE STUDIO
// ==========================================
app.get('/api/get_routes', (req, res) => {
    const tracksDir = path.join(__dirname, 'tracks');
    if (!fs.existsSync(tracksDir)) {
        return res.json({ status: 'success', routes: [] });
    }

    fs.readdir(tracksDir, (err, files) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        const routes = jsonFiles.map(file => {
            try {
                const content = fs.readFileSync(path.join(tracksDir, file), 'utf8');
                const parsed = JSON.parse(content);
                return { id: file, filename: file, ...parsed };
            } catch (e) {
                return null;
            }
        }).filter(Boolean);

        res.json({ status: 'success', routes });
    });
});

app.post('/api/generar_ruta', (req, res) => {
    const { target_script, route_name } = req.body;
    console.log(`Generant ruta: ${route_name} amb ${target_script}`);
    const safeFilename = (route_name || 'nova_ruta').toLowerCase().replace(/[^a-z0-9]/g, '_') + '.json';
    res.json({ status: "success", filename: safeFilename });
});

app.post('/api/desar_edicio', (req, res) => {
    res.json({ status: "success", message: "Edició desada correctament." });
});

app.post('/api/verificar_ruta', (req, res) => {
    res.json({ status: "success", message: "Ruta verificada i publicada localment." });
});

app.post('/api/desverificar_ruta', (req, res) => {
    res.json({ status: "success", message: "Ruta retornada a pendents." });
});

// Servidor en marxa
app.listen(PORT, () => {
    console.log(`🚀 Servidor GeoRoute Studio actiu a http://localhost:${PORT}`);
});