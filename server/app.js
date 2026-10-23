'use strict';
/**
 * Aplicación Express: atiende las mismas direcciones que la versión PHP
 * (api/*.php, pdf.php y admin/*.php) para que el frontend no cambie.
 */
const express = require('express');
const { crearContexto, SalidaTemprana } = require('./contexto');
const api = require('./api');
const admin = require('./admin');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.set('query parser', 'extended');
app.use(express.json({ limit: '200kb', strict: false }));
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 5000 }));

/** Ejecuta una página con su contexto y traduce las salidas tempranas (redirecciones, errores). */
function ruta(fn, { json = false } = {}) {
  return async (req, res) => {
    let ctx = null;
    try {
      ctx = await crearContexto(req, res);
      await fn(ctx);
    } catch (err) {
      if (err instanceof SalidaTemprana) {
        if (!res.headersSent) err.enviar();
        return;
      }
      console.error(err);
      if (res.headersSent) return;
      if (json) {
        res.status(500).type('application/json').send(JSON.stringify({ ok: false, error: 'Ocurrió un error en el servidor. Intente de nuevo en unos minutos.' }));
      } else {
        res.status(500).type('text/plain; charset=utf-8').send('Ocurrió un error en el servidor. Intente de nuevo en unos minutos.');
      }
    }
  };
}

// Simulador público
app.all('/api/config.php', ruta(api.config, { json: true }));
app.all('/api/lead.php', ruta(api.lead, { json: true }));
app.all('/api/simular.php', ruta(api.simular, { json: true }));
app.all('/api/resultado.php', ruta(api.resultado, { json: true }));
app.all('/api/accion.php', ruta(api.accion, { json: true }));
app.all('/pdf.php', ruta(api.pdf));

// CRM
app.get('/admin', (req, res, next) => (req.originalUrl.split('?')[0] === '/admin' ? res.redirect(301, '/admin/') : next()));
app.all(['/admin/', '/admin/index.php'], ruta(admin.index));
for (const p of ['salir', 'cuenta', 'usuarios', 'leads', 'exportar', 'lead', 'nueva', 'marketing', 'productos', 'parametros', 'ajustes']) {
  app.all('/admin/' + p + '.php', ruta(admin[p]));
}

module.exports = app;
