'use strict';
/**
 * Sesión de asesores, protección CSRF y plantilla del CRM (app/auth.php).
 * En Vercel no hay sesiones en disco: la sesión viaja en una cookie firmada (HMAC)
 * con una clave secreta guardada en la base de datos al instalar.
 */
const crypto = require('crypto');
const { e, APP_VERSION, ESTADOS_LEAD, tokenHex, fechaCorta } = require('./util');
const { SalidaTemprana } = require('./contexto');

const COOKIE = 'fabcom_crm';
const DURACION_MS = 12 * 3600 * 1000;

function secreto(ctx) {
  return process.env.SESSION_SECRET || ctx.ajuste('sesion_secreto', '') || 'fabcom';
}

function firmar(ctx, datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  const firma = crypto.createHmac('sha256', secreto(ctx)).update(cuerpo).digest('base64url');
  return cuerpo + '.' + firma;
}

function leerCookie(req, nombre) {
  const h = req.headers.cookie || '';
  for (const parte of h.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

/** Carga la sesión de la cookie y prepara su escritura automática al responder. */
function iniciarSesion(ctx) {
  if (ctx.sesion) return ctx.sesion;
  let datos = {};
  const raw = leerCookie(ctx.req, COOKIE);
  if (raw && raw.includes('.')) {
    const [cuerpo, firma] = raw.split('.');
    const esperada = crypto.createHmac('sha256', secreto(ctx)).update(cuerpo).digest('base64url');
    if (firma && esperada.length === firma.length && crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) {
      try {
        const d = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
        if (d && typeof d === 'object' && (!d.exp || d.exp > Date.now())) datos = d;
      } catch (err) {
        datos = {};
      }
    }
  }
  ctx.sesion = datos;
  ctx.sesionInicial = JSON.stringify(datos);
  const res = ctx.res;
  const original = res.writeHead;
  res.writeHead = function (...args) {
    const actual = JSON.stringify(ctx.sesion);
    if (ctx.sesionBorrar) {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${ctx.esHttps() ? '; Secure' : ''}`);
    } else if (actual !== ctx.sesionInicial || ctx.sesion.uid) {
      const d = { ...ctx.sesion, exp: Date.now() + DURACION_MS };
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(firmar(ctx, d))}; Path=/; HttpOnly; SameSite=Lax${ctx.esHttps() ? '; Secure' : ''}`);
    }
    return original.apply(this, args);
  };
  return datos;
}

async function usuarioActual(ctx) {
  iniciarSesion(ctx);
  if (ctx._usuario === undefined) {
    ctx._usuario = null;
    if (ctx.sesion.uid) {
      ctx._usuario = await ctx.db.una('SELECT * FROM usuarios WHERE id = ? AND activo = 1', [ctx.sesion.uid]);
    }
  }
  return ctx._usuario;
}

function redirigir(ctx, a) {
  return new SalidaTemprana(() => ctx.res.redirect(302, a));
}

async function exigirSesion(ctx) {
  const u = await usuarioActual(ctx);
  if (!u) throw redirigir(ctx, 'index.php');
  ctx.res.set('X-Frame-Options', 'DENY');
  ctx.res.set('Cache-Control', 'no-store');
  return u;
}

async function exigirAdmin(ctx) {
  const u = await exigirSesion(ctx);
  if (u.rol !== 'admin') {
    const html = await cabecera(ctx, 'Sin permiso', '') + '<p class="vacio">Solo el administrador puede gestionar los usuarios.</p>' + pie();
    throw new SalidaTemprana(() => ctx.res.status(403).type('html').send(html));
  }
  return u;
}

function csrf(ctx) {
  iniciarSesion(ctx);
  if (!ctx.sesion.csrf) ctx.sesion.csrf = tokenHex(16);
  return ctx.sesion.csrf;
}

function csrfCampo(ctx) {
  return '<input type="hidden" name="csrf" value="' + e(csrf(ctx)) + '">';
}

function csrfVerificar(ctx) {
  iniciarSesion(ctx);
  const a = String(ctx.sesion.csrf || '');
  const b = String((ctx.req.body || {}).csrf || '');
  if (!a || a.length !== b.length || !crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))) {
    throw new SalidaTemprana(() => ctx.res.status(400).type('text/plain').send('La sesión del formulario venció. Vuelva atrás, recargue la página e intente de nuevo.'));
  }
}

function esPost(ctx) {
  return ctx.req.method === 'POST';
}

function mensajeFlash(ctx, texto, tipo = 'ok') {
  iniciarSesion(ctx);
  ctx.sesion.flash = [texto, tipo];
}

function tomarFlash(ctx) {
  iniciarSesion(ctx);
  const f = ctx.sesion.flash || null;
  delete ctx.sesion.flash;
  return f;
}

function claveValida(c) {
  if (Buffer.byteLength(String(c)) < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[A-Za-z]/.test(c) || !/\d/.test(c)) return 'La contraseña debe combinar letras y números.';
  return null;
}

async function cabecera(ctx, titulo, activo) {
  const u = await usuarioActual(ctx);
  const menu = [
    ['leads', 'leads.php', 'Leads'],
    ['nueva', 'nueva.php', 'Simular con un cliente'],
    ['marketing', 'marketing.php', 'Marketing'],
    ['productos', 'productos.php', 'Productos y precios'],
    ['parametros', 'parametros.php', 'Parámetros'],
    ['ajustes', 'ajustes.php', 'Ajustes'],
  ];
  if (u && u.rol === 'admin') menu.push(['usuarios', 'usuarios.php', 'Usuarios']);
  let h = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  h += '<meta name="robots" content="noindex, nofollow"><title>' + e(titulo) + ' · CRM Fabcom</title>';
  h += '<link rel="icon" href="../assets/img/favicon.png"><link rel="stylesheet" href="../assets/css/admin.css?v=' + e(APP_VERSION) + '"></head><body>';
  if (u) {
    h += '<header class="barra"><div class="barra__fila"><a href="leads.php" class="barra__marca"><img src="../assets/img/logo-fabcom-blanco.png" alt="Fabcom" width="104" height="23"><span>CRM del simulador</span></a>';
    h += '<nav class="barra__menu" aria-label="Secciones">';
    for (const [k, href, txt] of menu) {
      h += '<a href="' + href + '"' + (k === activo ? ' class="es-activo" aria-current="page"' : '') + '>' + e(txt) + '</a>';
    }
    h += '</nav><div class="barra__usuario"><a href="cuenta.php">' + e(u.nombre) + '</a><a href="salir.php">Salir</a></div></div></header>';
  }
  h += '<main class="contenido">';
  const f = tomarFlash(ctx);
  if (f) h += '<div class="flash flash--' + e(f[1]) + '" role="status">' + e(f[0]) + '</div>';
  if (titulo !== '' && u) h += '<h1>' + e(titulo) + '</h1>';
  return h;
}

function pie() {
  return '</main></body></html>';
}

function etiquetaEstado(est) {
  return '<span class="estado estado--' + e(est) + '">' + e(ESTADOS_LEAD[est] ?? est) + '</span>';
}

module.exports = {
  iniciarSesion, usuarioActual, exigirSesion, exigirAdmin, csrf, csrfCampo, csrfVerificar, esPost,
  mensajeFlash, claveValida, cabecera, pie, etiquetaEstado, redirigir, fechaCorta,
};
