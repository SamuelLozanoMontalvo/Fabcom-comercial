'use strict';
/** Rutas públicas del simulador (api/*.php y pdf.php de la versión PHP). */
const { SUPERFICIES, GRADOS, CORROSIONES, SECTORES, AREAS_CARGO, MONEDAS, txt, largo, emailValido, tokenHex, ahora, hoy } = require('./util');
const { CLAVES_COSTO_CLIENTE, CLAVES_EN_DINERO, costosPorDefecto, normalizarEntrada, simular } = require('./engine');
const { leadPorToken, leadPorId, ultimaSimulacion, guardarSimulacion, asegurarAsesor } = require('./flujo');
const { correoResultadoCliente, correoAlertaAsesor, correoAlertaRegistro } = require('./mailer');
const { generarPdf } = require('./pdf');
const { SalidaTemprana } = require('./contexto');

function entrada(ctx) {
  const b = ctx.req.body;
  return b && typeof b === 'object' && !Array.isArray(b) && !Buffer.isBuffer(b) ? b : {};
}

function salir(ctx, data, codigo = 200) {
  return new SalidaTemprana(() => ctx.json(data, codigo));
}

function exigirPost(ctx) {
  if (ctx.req.method !== 'POST') throw salir(ctx, { ok: false, error: 'Método no permitido.' }, 405);
}

const vacioPhp = (v) => v === undefined || v === null || v === '' || v === '0' || v === 0 || v === false || (Array.isArray(v) && v.length === 0);

async function config(ctx) {
  const params = ctx.parametros();
  const costos = {};
  for (const m of Object.keys(MONEDAS)) costos[m] = costosPorDefecto(ctx, m);
  const campos = CLAVES_COSTO_CLIENTE.map((k) => ({ clave: k, etiqueta: params[k].etiqueta, unidad: params[k].unidad, dinero: CLAVES_EN_DINERO.includes(k) }));
  const grados = Object.entries(GRADOS).map(([k, [nombre, norma]]) => ({ clave: k, nombre, norma }));
  const asesores = await ctx.db.todas('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre');
  ctx.json({
    ok: true,
    asesores: asesores.map((a) => ({ id: Number(a.id), nombre: a.nombre })),
    superficies: SUPERFICIES,
    grados,
    corrosiones: CORROSIONES,
    sectores: SECTORES,
    areas: AREAS_CARGO,
    monedas: MONEDAS,
    campos_costo: campos,
    costos,
    recargo_nocturno: ctx.parametro('recargo_nocturno_pct'),
    whatsapp: String(ctx.ajuste('whatsapp_numero', '')).replace(/\D+/g, ''),
    politica_url: String(ctx.ajuste('politica_datos_url', '')),
    empresa: String(ctx.ajuste('empresa_nombre', 'Fabcom S.A.S.')),
  });
}

async function lead(ctx) {
  exigirPost(ctx);
  await ctx.limitePeticiones('lead', 12, 3600);
  const d = entrada(ctx);
  if (txt(d.sitio_web ?? '') !== '') return ctx.json({ ok: true, token: tokenHex(16) }); // campo trampa para robots

  const nombre = txt(d.nombre ?? '', 120);
  const email = txt(d.email ?? '', 160).toLowerCase();
  const empresa = txt(d.empresa ?? '', 160);
  const telefono = txt(d.telefono ?? '', 40);
  const sector = SECTORES.includes(d.sector) ? String(d.sector) : '';
  const area = AREAS_CARGO.includes(d.area_cargo) ? String(d.area_cargo) : '';

  const err = {};
  if (largo(nombre) < 3) err.nombre = 'Escriba su nombre completo.';
  if (!emailValido(email)) err.email = 'Escriba un correo válido, por ejemplo nombre@empresa.com.';
  if (largo(empresa) < 2) err.empresa = 'Escriba el nombre de su empresa.';
  if (telefono.replace(/\D+/g, '').length < 7) err.telefono = 'Escriba un teléfono con al menos 7 dígitos.';
  if (vacioPhp(d.acepta_datos)) err.acepta_datos = 'Para continuar debe autorizar el tratamiento de sus datos.';
  const tipoCliente = ['nuevo', 'actual'].includes(d.tipo_cliente) ? String(d.tipo_cliente) : '';
  let elegido = null;
  if (tipoCliente === 'actual') {
    elegido = await ctx.db.una('SELECT id, nombre, email, calendario_url FROM usuarios WHERE id = ? AND activo = 1', [parseInt(d.asesor_id ?? 0, 10) || 0]);
    if (!elegido) err.asesor_id = 'Elija el nombre de su asesor de Fabcom.';
  }
  if (Object.keys(err).length) return ctx.json({ ok: false, error: 'Revise los campos marcados.', campos: err }, 422);

  const ua = String(ctx.req.headers['user-agent'] || '');
  const disp = /Mobile|Android|iPhone/i.test(ua) ? 'móvil' : (/iPad|Tablet/i.test(ua) ? 'tableta' : 'escritorio');
  const marketing = vacioPhp(d.acepta_marketing) ? 0 : 1;
  let l = await ctx.db.una('SELECT * FROM leads WHERE email = ? ORDER BY id DESC LIMIT 1', [email]);

  if (l) {
    await ctx.db.ejec("UPDATE leads SET nombre=?, empresa=?, telefono=?, sector=CASE WHEN ?<>'' THEN ? ELSE sector END, area_cargo=CASE WHEN ?<>'' THEN ? ELSE area_cargo END, acepta_datos=1, acepta_marketing=MAX(acepta_marketing, ?) WHERE id=?",
      [nombre, empresa, telefono, sector, sector, area, area, marketing, l.id]);
    await ctx.evento(Number(l.id), 'registro', 'Volvió a registrarse en el simulador.');
    if (tipoCliente !== '') await ctx.db.ejec('UPDATE leads SET tipo_cliente = ? WHERE id = ?', [tipoCliente, l.id]);
    l = await leadPorId(ctx, Number(l.id));
    if (elegido && Number(l.asesor_id) !== Number(elegido.id)) {
      await ctx.db.ejec('UPDATE leads SET asesor_id = ? WHERE id = ?', [elegido.id, l.id]);
      await ctx.evento(Number(l.id), 'asignacion', 'El cliente eligió a su asesor: ' + elegido.nombre + '.');
      l.asesor_id = elegido.id;
    }
    const asesor = await asegurarAsesor(ctx, l);
    if (asesor) await correoAlertaRegistro(ctx, l, asesor);
    return ctx.json({ ok: true, token: l.token });
  }

  const token = tokenHex(16);
  const r = await ctx.db.ejec('INSERT INTO leads (token, creado, nombre, email, empresa, telefono, sector, area_cargo, acepta_datos, acepta_marketing, origen, utm_source, utm_medium, utm_campaign, referrer, dispositivo, ip, tipo_cliente, asesor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
    token, ahora(), nombre, email, empresa, telefono, sector, area, 1, marketing, 'web',
    txt(d.utm_source ?? '', 80), txt(d.utm_medium ?? '', 80), txt(d.utm_campaign ?? '', 120), txt(d.referrer ?? '', 250), disp, ctx.ip(), tipoCliente, elegido ? Number(elegido.id) : null,
  ]);
  const id = Number(r.id);
  await ctx.evento(id, 'registro', 'Se registró en el simulador. Autorizó el tratamiento de datos' + (marketing ? ' y recibir información comercial.' : '.'));
  l = await leadPorId(ctx, id);
  if (elegido) await ctx.evento(id, 'asignacion', 'Cliente actual. Eligió a su asesor: ' + elegido.nombre + '.');
  const asesor = await asegurarAsesor(ctx, l);
  if (asesor) await correoAlertaRegistro(ctx, l, asesor);
  return ctx.json({ ok: true, token });
}

async function simularRuta(ctx) {
  exigirPost(ctx);
  await ctx.limitePeticiones('simular', 40, 3600);
  const d = entrada(ctx);
  const l = await leadPorToken(ctx, String(d.token ?? ''));
  if (!l) return ctx.json({ ok: false, error: 'Su registro venció. Vuelva a escribir sus datos de contacto.', reiniciar: true }, 401);
  const e = normalizarEntrada(ctx, d);
  if (e.errores && e.errores.length) return ctx.json({ ok: false, error: e.errores.join(' ') }, 422);
  delete e.errores;

  let r;
  try {
    r = await simular(ctx, e);
  } catch (ex) {
    console.error('Simulador: ' + (ex && ex.message));
    return ctx.json({ ok: false, error: 'No pudimos calcular la simulación. Intente de nuevo en unos minutos.' }, 500);
  }

  const primera = Number(await ctx.db.valor('SELECT COUNT(*) FROM simulaciones WHERE lead_id = ?', [l.id])) === 0;
  await guardarSimulacion(ctx, Number(l.id), r);
  await ctx.evento(Number(l.id), 'simulacion', r.cliente.proyecto.area + ' · ' + r.cliente.proyecto.superficie + ' · ' + r.interno.producto);

  let correoEnviado = false;
  const asesor = await asegurarAsesor(ctx, l);
  if (primera && ctx.ajuste('enviar_pdf_cliente', '1') === '1') {
    try {
      const pdf = await generarPdf(ctx, l, r.cliente, ahora());
      correoEnviado = await correoResultadoCliente(ctx, l, r.cliente, pdf, asesor);
      await ctx.evento(Number(l.id), correoEnviado ? 'correo_cliente' : 'correo_error', correoEnviado ? 'PDF enviado a ' + l.email + '.' : 'No se pudo enviar el PDF a ' + l.email + '. Revise Ajustes → Correo.');
    } catch (ex) {
      console.error('Simulador PDF/correo: ' + (ex && ex.message));
    }
  }
  // Cada simulación le llega al asesor del cliente: la primera como lead nuevo, las siguientes como nueva simulación.
  if (asesor) await correoAlertaAsesor(ctx, l, r, asesor, primera ? 'Nuevo lead del simulador' : 'Nueva simulación de su cliente');

  return ctx.json({ ok: true, resultado: r.cliente, correo_enviado: correoEnviado, correo: l.email, pdf_url: 'pdf.php?t=' + l.token });
}

async function resultado(ctx) {
  const l = await leadPorToken(ctx, String(ctx.req.query.t ?? ''));
  const sim = l ? await ultimaSimulacion(ctx, Number(l.id)) : null;
  if (!sim) return ctx.json({ ok: false, error: 'No encontramos ese resultado.' }, 404);
  await ctx.evento(Number(l.id), 'vista_resultado', 'Abrió el resultado desde el enlace.');
  const ent = {};
  for (const k of ['superficie', 'superficie_otro', 'espacio', 'area_m2', 'toneladas_arena', 'grado', 'corrosion', 'perfil_valor', 'perfil_unidad', 'moneda', 'nocturno']) {
    if (Object.prototype.hasOwnProperty.call(sim.entrada, k)) ent[k] = sim.entrada[k];
  }
  return ctx.json({ ok: true, resultado: sim.cliente, entrada: ent, nombre: l.nombre, correo: l.email, pdf_url: 'pdf.php?t=' + l.token });
}

async function accion(ctx) {
  exigirPost(ctx);
  await ctx.limitePeticiones('accion', 30, 3600);
  const d = entrada(ctx);
  const l = await leadPorToken(ctx, String(d.token ?? ''));
  const sim = l ? await ultimaSimulacion(ctx, Number(l.id)) : null;
  if (!l || !sim) return ctx.json({ ok: false, error: 'No encontramos su simulación. Vuelva a calcularla.' }, 404);
  const tipo = String(d.tipo ?? '');
  const asesor = await asegurarAsesor(ctx, l);
  const id = Number(l.id);

  switch (tipo) {
    case 'cotizacion': {
      const msg = txt(d.mensaje ?? '', 800);
      const correo = txt(d.email ?? '', 160).toLowerCase();
      if (correo !== '' && !emailValido(correo)) return ctx.json({ ok: false, error: 'Escribe un correo válido, por ejemplo nombre@empresa.com.' }, 422);
      if (correo !== '' && correo !== l.email) {
        await ctx.db.ejec('UPDATE leads SET email = ? WHERE id = ?', [correo, id]);
        await ctx.evento(id, 'registro', 'Cambió su correo de ' + l.email + ' a ' + correo + ' al pedir la cotización.');
        l.email = correo;
      }
      await ctx.evento(id, 'cta_cotizacion', 'Pidió cotización. Correo confirmado: ' + l.email + '.' + (msg !== '' ? ' Mensaje: ' + msg : ''));
      if (asesor) await correoAlertaAsesor(ctx, l, sim, asesor, 'Solicitud de cotización');
      return ctx.json({ ok: true, correo: l.email, mensaje: 'Un asesor te contactará y enviará la cotización a ' + l.email + '.' });
    }
    case 'visita_calendario': {
      // Abre la agenda de Google Calendar del asesor asignado, si la tiene configurada.
      const url = String((asesor && asesor.calendario_url) || '').trim();
      if (url === '') return ctx.json({ ok: true, calendario_url: '' });
      await ctx.evento(id, 'cta_visita', 'Abrió la agenda de Google Calendar de ' + asesor.nombre + ' para pedir visita técnica.');
      await correoAlertaAsesor(ctx, l, sim, asesor, 'El cliente abrió su agenda para pedir visita técnica');
      return ctx.json({ ok: true, calendario_url: url, asesor: asesor.nombre });
    }
    case 'visita': {
      const fecha = txt(d.fecha ?? '', 10);
      const lugar = txt(d.lugar ?? '', 200);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < hoy()) return ctx.json({ ok: false, error: 'Elija una fecha de hoy en adelante.' }, 422);
      if (largo(lugar) < 3) return ctx.json({ ok: false, error: 'Escriba la ciudad o dirección de la visita.' }, 422);
      await ctx.db.ejec('UPDATE leads SET visita_fecha = ?, visita_lugar = ? WHERE id = ?', [fecha, lugar, id]);
      await ctx.evento(id, 'cta_visita', 'Pidió visita técnica para el ' + fecha + ' en ' + lugar + '.');
      if (asesor) await correoAlertaAsesor(ctx, l, sim, asesor, 'Solicitud de visita técnica (' + fecha + ', ' + lugar + ')');
      return ctx.json({ ok: true, mensaje: 'Recibimos su solicitud de visita técnica. ' + (asesor ? asesor.nombre + ' le confirmará la fecha.' : 'Un asesor le confirmará la fecha.') });
    }
    case 'whatsapp':
      await ctx.evento(id, 'cta_whatsapp', 'Abrió la conversación de WhatsApp.');
      return ctx.json({ ok: true });
    case 'enviar_pdf': {
      const pdf = await generarPdf(ctx, l, sim.cliente, sim.creado);
      const ok = await correoResultadoCliente(ctx, l, sim.cliente, pdf, asesor);
      await ctx.evento(id, ok ? 'correo_cliente' : 'correo_error', ok ? 'PDF reenviado a ' + l.email + '.' : 'No se pudo reenviar el PDF a ' + l.email + '.');
      if (!ok) return ctx.json({ ok: false, error: 'No pudimos enviar el correo. Descargue el PDF con el botón de al lado.' }, 502);
      return ctx.json({ ok: true, mensaje: 'Enviamos el PDF a ' + l.email + '.' });
    }
    default:
      return ctx.json({ ok: false, error: 'Acción desconocida.' }, 400);
  }
}

async function pdf(ctx) {
  const l = await leadPorToken(ctx, String(ctx.req.query.t ?? ''));
  const sim = l ? await ultimaSimulacion(ctx, Number(l.id)) : null;
  if (!sim) {
    return ctx.res.status(404).type('text/plain; charset=utf-8').send('No encontramos ese informe. Vuelva al simulador y calcule de nuevo.');
  }
  const bin = await generarPdf(ctx, l, sim.cliente, sim.creado);
  if (vacioPhp(ctx.req.query.i)) await ctx.evento(Number(l.id), 'pdf_descarga', 'Descargó el PDF.');
  ctx.res.set('Content-Type', 'application/pdf');
  ctx.res.set('Content-Disposition', 'inline; filename="Comparativo-Fabcom.pdf"');
  ctx.res.set('Content-Length', String(bin.length));
  ctx.res.set('Cache-Control', 'private, no-store');
  return ctx.res.end(bin);
}

module.exports = { config, lead, simular: simularRuta, resultado, accion, pdf };
