'use strict';
/**
 * Contexto de cada petición: ajustes y parámetros leídos de la base de datos al inicio,
 * para que un cambio hecho en Administración se vea de inmediato en la siguiente petición.
 */
const db = require('./db');
const { ahora, fechaBogota } = require('./util');

class SalidaTemprana extends Error {
  constructor(enviar) {
    super('salida');
    this.enviar = enviar;
  }
}

async function crearContexto(req, res) {
  await db.asegurarInstalacion();
  const [ajustes, params] = await Promise.all([
    db.todas('SELECT clave, valor FROM ajustes'),
    db.todas('SELECT * FROM parametros ORDER BY orden'),
  ]);
  const ctx = {
    req,
    res,
    db,
    _ajustes: Object.fromEntries(ajustes.map((r) => [r.clave, r.valor])),
    _params: params,
  };

  /** ajuste(): valor vacío cuenta como no definido, igual que en PHP. */
  ctx.ajuste = (clave, def = null) => {
    const v = ctx._ajustes[clave];
    return v !== undefined && v !== null && v !== '' ? v : def;
  };
  ctx.ajusteGuardar = async (clave, valorNuevo) => {
    await db.ejec('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', [clave, String(valorNuevo)]);
    ctx._ajustes[clave] = String(valorNuevo);
  };
  /** parametros(): mapa clave → fila, en el orden configurado. */
  ctx.parametros = () => {
    const out = {};
    for (const p of ctx._params) out[p.clave] = p;
    return out;
  };
  ctx.recargarParametros = async () => {
    ctx._params = await db.todas('SELECT * FROM parametros ORDER BY orden');
  };
  ctx.parametro = (clave) => {
    const p = ctx._params.find((x) => x.clave === clave);
    return p ? Number(p.valor) : 0;
  };

  ctx.ip = () => {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return (xf || req.socket?.remoteAddress || '').slice(0, 45);
  };
  ctx.esHttps = () => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
  ctx.baseUrl = () => {
    const b = process.env.BASE_URL || '';
    if (b) return b.replace(/\/+$/, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    return (ctx.esHttps() ? 'https' : 'http') + '://' + host;
  };

  ctx.evento = async (leadId, tipo, detalle = '', usuarioId = null) => {
    await db.ejec('INSERT INTO eventos (lead_id, tipo, detalle, usuario_id, creado) VALUES (?,?,?,?,?)', [leadId, tipo, Array.from(String(detalle)).slice(0, 2000).join(''), usuarioId, ahora()]);
  };

  /** Límite simple de peticiones por IP para los formularios públicos. */
  ctx.limitePeticiones = async (accion, max, segundos) => {
    const ip = ctx.ip();
    const desde = fechaBogota(Date.now() - segundos * 1000);
    await db.ejec('DELETE FROM limites WHERE creado < ?', [fechaBogota(Date.now() - 86400 * 1000)]);
    const cuenta = Number(await db.valor('SELECT COUNT(*) FROM limites WHERE ip = ? AND accion = ? AND creado >= ?', [ip, accion, desde]));
    if (cuenta >= max) {
      throw new SalidaTemprana(() => ctx.json({ ok: false, error: 'Demasiados intentos. Espere unos minutos y vuelva a intentarlo.' }, 429));
    }
    await db.ejec('INSERT INTO limites (ip, accion, creado) VALUES (?,?,?)', [ip, accion, ahora()]);
  };

  ctx.json = (data, codigo = 200) => {
    res.status(codigo);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(JSON.stringify(data));
  };
  return ctx;
}

module.exports = { crearContexto, SalidaTemprana };
