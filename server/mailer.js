'use strict';
/**
 * Envío de correos con nodemailer (equivale a app/mailer.php con PHPMailer).
 * Usa el SMTP configurado en Administración → Ajustes. En Vercel no existe el correo
 * propio del servidor, así que sin SMTP el envío falla y queda registrado el motivo.
 * Cada envío queda registrado en la tabla "correos" para verlo en el CRM.
 */
const nodemailer = require('nodemailer');
const { e, n, dinero, ahora, ascii } = require('./util');

function textoPlano(html) {
  const s = html.replace(/<(br|\/p|\/tr|\/h\d|\/li)[^>]*>/gi, '\n').replace(/<[^>]*>/g, '');
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|#039|nbsp);/gi, (m, c) => {
    const k = c.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos' || k === '#039') return "'";
    if (k === 'nbsp') return ' ';
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    return String.fromCodePoint(parseInt(k.slice(1), 10));
  }).trim();
}

/** @param adjuntos lista de [Buffer, nombre de archivo] */
async function enviarCorreo(ctx, para, nombre, asunto, html, adjuntos = [], leadId = null, responderA = null) {
  let ok = false;
  let error = '';
  try {
    const host = String(ctx.ajuste('smtp_host', '') || '');
    if (host === '') {
      throw new Error('No hay servidor SMTP configurado. Escríbalo en Administración → Ajustes → Correo saliente.');
    }
    const seg = String(ctx.ajuste('smtp_seguridad', 'tls'));
    const usuario = String(ctx.ajuste('smtp_usuario', '') || '');
    const transporte = nodemailer.createTransport({
      host,
      port: parseInt(ctx.ajuste('smtp_puerto', '587'), 10) || 587,
      secure: seg === 'ssl',
      requireTLS: seg === 'tls',
      ignoreTLS: seg !== 'ssl' && seg !== 'tls',
      auth: usuario !== '' ? { user: usuario, pass: String(ctx.ajuste('smtp_clave', '') || '') } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
    });
    await transporte.sendMail({
      from: { name: String(ctx.ajuste('correo_remitente_nombre', 'Fabcom S.A.S.')), address: String(ctx.ajuste('correo_remitente', 'administrador@fabcomsas.com')) },
      to: { name: nombre, address: para },
      replyTo: responderA || undefined,
      subject: asunto,
      html,
      text: textoPlano(html),
      attachments: adjuntos.map(([bin, archivo]) => ({ filename: archivo, content: bin, contentType: 'application/pdf' })),
    });
    ok = true;
  } catch (ex) {
    error = String(ex && ex.message ? ex.message : ex);
  }
  try {
    await ctx.db.ejec('INSERT INTO correos (lead_id, para, asunto, estado, error, creado) VALUES (?,?,?,?,?,?)',
      [leadId, para, asunto, ok ? 'enviado' : 'error', Array.from(error).slice(0, 500).join(''), ahora()]);
  } catch (ex) {
    // El registro del correo nunca debe interrumpir la simulación.
  }
  return ok;
}

function plantillaCorreo(ctx, titulo, cuerpoHtml) {
  const empresa = e(ctx.ajuste('empresa_nombre', 'Fabcom S.A.S.'));
  const dir = e(ctx.ajuste('empresa_direccion', ''));
  return '<!doctype html><html lang="es"><body style="margin:0;background:#eef3f7;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#1a2940">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f7"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">'
    + '<tr><td style="background:#193C6C;padding:22px 28px;border-bottom:4px solid #58BEC5"><div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:.2px">Fabcom</div>'
    + '<div style="font-size:16px;line-height:1.35;color:#ffffff;margin-top:10px;font-weight:600">' + e(titulo) + '</div></td></tr>'
    + '<tr><td style="padding:24px 28px;font-size:14px;line-height:1.6">' + cuerpoHtml + '</td></tr>'
    + '<tr><td style="padding:16px 28px;background:#f5f8fa;font-size:11px;line-height:1.5;color:#606e80">' + empresa + (dir ? ' · ' + dir : '') + '</td></tr>'
    + '</table></td></tr></table></body></html>';
}

/** Siguiente asesor en la rotación de leads (usuarios activos que reciben leads). */
async function siguienteAsesor(ctx) {
  const lista = await ctx.db.todas('SELECT id, nombre, email, calendario_url FROM usuarios WHERE activo = 1 AND recibe_leads = 1 ORDER BY id');
  if (!lista.length) return null;
  const ultimo = parseInt(ctx.ajuste('rotacion_ultimo', '0'), 10) || 0;
  let elegido = lista[0];
  for (const u of lista) {
    if (Number(u.id) > ultimo) {
      elegido = u;
      break;
    }
  }
  await ctx.ajusteGuardar('rotacion_ultimo', String(elegido.id));
  return elegido;
}

function filaCorreo(k, v) {
  return '<tr><td style="padding:5px 12px 5px 0;color:#606e80;font-size:13px;vertical-align:top;white-space:nowrap">' + e(k) + '</td><td style="padding:5px 0;font-size:13px;font-weight:600">' + v + '</td></tr>';
}

/** Correo al cliente con el PDF adjunto. */
async function correoResultadoCliente(ctx, lead, cliente, pdf, asesor) {
  let filas = '';
  for (const f of cliente.filas) {
    const dif = f.pct === null ? '' : ' <span style="color:#1e7a4a">(' + (f.pct > 0 ? '+' : '−') + n(Math.abs(f.pct)) + ' %)</span>';
    filas += '<tr><td style="padding:8px 8px 8px 0;border-bottom:1px solid #e3e9ef;font-size:13px">' + e(f.etiqueta) + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #e3e9ef;font-size:13px;color:#606e80">' + e(f.arena) + '</td>'
      + '<td style="padding:8px 0 8px 8px;border-bottom:1px solid #e3e9ef;font-size:13px;font-weight:600;color:#193C6C">' + e(f.fabcom) + dif + '</td></tr>';
  }
  const link = ctx.baseUrl() + '/?r=' + encodeURIComponent(lead.token);
  const cuerpo = '<p style="margin:0 0 14px">Hola, ' + e(lead.nombre) + ':</p>'
    + '<p style="margin:0 0 14px">Adjuntamos el comparativo de su proyecto de ' + e(cliente.proyecto.area) + ' en ' + e(String(cliente.proyecto.superficie).toLowerCase()) + '. El abrasivo recomendado es <strong>' + e(cliente.producto.nombre) + '</strong>.</p>'
    + (filas === '' ? '' : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr>'
      + '<th align="left" style="padding:6px 8px 6px 0;font-size:12px;color:#606e80;font-weight:500;border-bottom:2px solid #193C6C">Indicador</th>'
      + '<th align="left" style="padding:6px 8px;font-size:12px;color:#606e80;font-weight:500;border-bottom:2px solid #193C6C">Arena sílice</th>'
      + '<th align="left" style="padding:6px 0 6px 8px;font-size:12px;color:#606e80;font-weight:500;border-bottom:2px solid #193C6C">Abrasivo Fabcom</th></tr>' + filas + '</table>')
    + '<p style="margin:0 0 18px"><a href="' + e(link) + '" style="display:inline-block;background:#193C6C;color:#ffffff;text-decoration:none;padding:11px 20px;font-weight:600;font-size:14px;border-radius:6px">Ver el resultado en línea</a></p>'
    + (asesor ? '<p style="margin:0 0 14px">Su asesor es ' + e(asesor.nombre) + ' (<a href="mailto:' + e(asesor.email) + '" style="color:#193C6C">' + e(asesor.email) + '</a>). Puede responder este correo para pedir la cotización o una visita técnica.</p>' : '')
    + '<p style="margin:0;font-size:12px;color:#606e80">El resultado es una estimación basada en los datos que usted suministró y en referencias públicas. No es una cotización.</p>';
  const archivo = 'Comparativo-Fabcom-' + ((ascii(lead.empresa) || 'proyecto').replace(/[^A-Za-z0-9]+/g, '-')) + '.pdf';
  return enviarCorreo(ctx, lead.email, lead.nombre, 'Su comparativo: arena sílice frente a ' + cliente.producto.nombre,
    plantillaCorreo(ctx, 'Su comparativo de limpieza abrasiva', cuerpo), [[pdf, archivo]], Number(lead.id), asesor ? asesor.email : null);
}

/** Alerta interna al asesor asignado: datos del lead y cifras completas. */
async function correoAlertaAsesor(ctx, lead, sim, asesor, motivo = 'Nuevo lead del simulador') {
  const i = sim.interno;
  const c = sim.cliente;
  const mon = i.moneda;
  const tipo = lead.tipo_cliente === 'actual' ? 'Cliente actual (lo eligió a usted)' : (lead.tipo_cliente === 'nuevo' ? 'Cliente nuevo' : 'Sin dato');
  const t = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">'
    + filaCorreo('Contacto', e(lead.nombre) + ' · ' + e(lead.empresa))
    + filaCorreo('Correo', '<a href="mailto:' + e(lead.email) + '" style="color:#193C6C">' + e(lead.email) + '</a>')
    + filaCorreo('Teléfono', e(lead.telefono))
    + (lead.sector !== '' ? filaCorreo('Sector', e(lead.sector)) : '')
    + (lead.area_cargo !== '' ? filaCorreo('Área', e(lead.area_cargo)) : '')
    + filaCorreo('Tipo de cliente', tipo)
    + filaCorreo('Proyecto', e(c.proyecto.area + ((c.proyecto.toneladas_arena ?? '') !== '' ? ' (calculado con ' + c.proyecto.toneladas_arena + ')' : '') + ' · ' + c.proyecto.superficie + ' · espacio ' + String(c.proyecto.espacio).toLowerCase()))
    + filaCorreo('Abrasivo recomendado', e(i.producto))
    + filaCorreo('Cantidad estimada', e(c.cantidad_estimada))
    + filaCorreo('Venta potencial', e(dinero(i.venta_potencial_cop, 'COP')) + ' a ' + e(dinero(i.precio_kg_cop, 'COP')) + '/kg')
    + filaCorreo('Costo total', 'Arena ' + e(dinero(i.arena.total, mon)) + ' · Fabcom ' + e(dinero(i.fabcom.total, mon)) + ' (' + (i.dif_total_pct > 0 ? '+' : '−') + n(Math.abs(Number(i.dif_total_pct))) + ' %)')
    + (i.precio_equilibrio_cop_kg !== null ? filaCorreo('Precio de equilibrio', e(dinero(Math.max(0, i.precio_equilibrio_cop_kg), 'COP')) + '/kg') : '')
    + filaCorreo('El cliente vio', i.costo_mostrado_cliente === 'total' ? 'ahorro en costo total' : (i.costo_mostrado_cliente === 'operacion' ? 'ahorro en costo de operación, sin abrasivo' : 'sin fila de costo'))
    + '</table>';
  const link = ctx.baseUrl() + '/admin/lead.php?id=' + Number(lead.id);
  const cuerpo = '<p style="margin:0 0 14px">' + e(asesor.nombre) + ', este lead quedó asignado a usted.</p>' + t
    + '<p style="margin:0 0 6px"><a href="' + e(link) + '" style="display:inline-block;background:#193C6C;color:#ffffff;text-decoration:none;padding:11px 20px;font-weight:600;font-size:14px;border-radius:6px">Abrir el lead en el CRM</a></p>'
    + '<p style="margin:14px 0 0;font-size:12px;color:#606e80">Información interna de Fabcom. No reenviar al cliente.</p>';
  return enviarCorreo(ctx, asesor.email, asesor.nombre, motivo + ': ' + lead.empresa + ' · ' + c.proyecto.area, plantillaCorreo(ctx, motivo, cuerpo), [], Number(lead.id), lead.email);
}

/** Alerta al asesor apenas el cliente registra sus datos de contacto (antes de simular). */
async function correoAlertaRegistro(ctx, lead, asesor) {
  const tipo = lead.tipo_cliente === 'actual' ? 'Cliente actual (lo eligió a usted)' : (lead.tipo_cliente === 'nuevo' ? 'Cliente nuevo (asignado por turno)' : 'Sin dato');
  const t = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">'
    + filaCorreo('Contacto', e(lead.nombre) + ' · ' + e(lead.empresa))
    + filaCorreo('Correo', '<a href="mailto:' + e(lead.email) + '" style="color:#193C6C">' + e(lead.email) + '</a>')
    + filaCorreo('Teléfono', e(lead.telefono))
    + (lead.sector !== '' ? filaCorreo('Sector', e(lead.sector)) : '')
    + (lead.area_cargo !== '' ? filaCorreo('Área', e(lead.area_cargo)) : '')
    + filaCorreo('Tipo de cliente', tipo)
    + '</table>';
  const link = ctx.baseUrl() + '/admin/lead.php?id=' + Number(lead.id);
  const cuerpo = '<p style="margin:0 0 14px">' + e(asesor.nombre) + ', esta persona acaba de registrarse en el simulador y quedó asignada a usted. Cuando termine la simulación recibirá otro correo con los datos del proyecto.</p>' + t
    + '<p style="margin:0"><a href="' + e(link) + '" style="display:inline-block;background:#193C6C;color:#ffffff;text-decoration:none;padding:11px 20px;font-weight:600;font-size:14px;border-radius:6px">Abrir el lead en el CRM</a></p>';
  return enviarCorreo(ctx, asesor.email, asesor.nombre, 'Nuevo registro en el simulador: ' + lead.empresa, plantillaCorreo(ctx, 'Nuevo registro en el simulador', cuerpo), [], Number(lead.id), lead.email);
}

module.exports = { enviarCorreo, plantillaCorreo, siguienteAsesor, correoResultadoCliente, correoAlertaAsesor, correoAlertaRegistro };
