'use strict';
/** Operaciones compartidas entre la web pública y el CRM (app/flujo.php). */
const { ahora } = require('./util');
const { siguienteAsesor } = require('./mailer');

async function leadPorToken(ctx, token) {
  if (!/^[a-f0-9]{32}$/.test(String(token ?? ''))) return null;
  return ctx.db.una('SELECT * FROM leads WHERE token = ?', [token]);
}

async function leadPorId(ctx, id) {
  return ctx.db.una('SELECT * FROM leads WHERE id = ?', [id]);
}

async function usuarioPorId(ctx, id) {
  if (!id) return null;
  return ctx.db.una('SELECT id, nombre, email, rol, activo, calendario_url FROM usuarios WHERE id = ?', [id]);
}

async function ultimaSimulacion(ctx, leadId) {
  const s = await ctx.db.una('SELECT * FROM simulaciones WHERE lead_id = ? ORDER BY id DESC LIMIT 1', [leadId]);
  if (!s) return null;
  s.entrada = JSON.parse(s.entrada);
  s.cliente = JSON.parse(s.cliente);
  s.interno = JSON.parse(s.interno);
  return s;
}

async function guardarSimulacion(ctx, leadId, r) {
  const e = r.entrada;
  const i = r.interno;
  const res = await ctx.db.ejec('INSERT INTO simulaciones (lead_id, creado, producto_id, producto_nombre, superficie, espacio, grado, corrosion, area_m2, moneda, kg_fabcom, venta_potencial_cop, dif_total_pct, entrada, cliente, interno) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
    leadId, ahora(), i.producto_id, i.producto, e.superficie, e.espacio, e.grado, e.corrosion, e.area_m2, e.moneda,
    i.fabcom.kg, i.venta_potencial_cop, i.dif_total_pct, JSON.stringify(e), JSON.stringify(r.cliente), JSON.stringify(i),
  ]);
  return res.id;
}

/** Asigna asesor por rotación si el lead aún no tiene. Devuelve el asesor. Modifica lead.asesor_id. */
async function asegurarAsesor(ctx, lead) {
  if (lead.asesor_id) {
    const u = await usuarioPorId(ctx, Number(lead.asesor_id));
    if (u && Number(u.activo) === 1) return u;
  }
  const a = await siguienteAsesor(ctx);
  if (a) {
    await ctx.db.ejec('UPDATE leads SET asesor_id = ? WHERE id = ?', [a.id, lead.id]);
    lead.asesor_id = a.id;
    await ctx.evento(Number(lead.id), 'asignacion', 'Asignado por rotación a ' + a.nombre + '.');
  }
  return a;
}

module.exports = { leadPorToken, leadPorId, usuarioPorId, ultimaSimulacion, guardarSimulacion, asegurarAsesor };
