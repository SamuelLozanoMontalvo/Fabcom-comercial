'use strict';
/**
 * Servidor para probar en su computador: `npm install` y luego `npm run dev`.
 * Sirve la carpeta public/ y las mismas rutas que en Vercel. Sin variables de
 * Turso usa el archivo datos/local.db.
 */
const path = require('path');
const express = require('express');
const app = require('../server/app');

const servidor = express();
servidor.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  next();
});
servidor.use(express.static(path.join(__dirname, '..', 'public')));
servidor.use(app);

const puerto = Number(process.env.PORT) || 3000;
servidor.listen(puerto, () => {
  console.log('Simulador en http://localhost:' + puerto + '  ·  CRM en http://localhost:' + puerto + '/admin/');
});
