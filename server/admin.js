'use strict';
/** Páginas del CRM (carpeta admin/ de la versión PHP). */
const bcrypt = require('bcryptjs');
const {
  e, n, nAuto, dinero, pesoTxt, txt, largo, num, int, vacio, emailValido, ahora, fechaBogota, fechaCorta, fechaDMY, tokenHex,
  SUPERFICIES, ESPACIOS, GRADOS, CORROSIONES, SECTORES, AREAS_CARGO, MONEDAS, ESTADOS_LEAD, phpRound,
} = require('./util');
const auth = require('./auth');
const { cabecera, pie, csrfCampo, csrfVerificar, esPost, mensajeFlash, claveValida, etiquetaEstado, exigirSesion, exigirAdmin } = auth;
const { costosPorDefecto, normalizarEntrada, simular, producto } = require('./engine');
const { leadPorId, usuarioPorId, ultimaSimulacion, guardarSimulacion } = require('./flujo');
const { correoResultadoCliente, enviarCorreo, plantillaCorreo } = require('./mailer');
const { generarPdf } = require('./pdf');
const { vistaSimulacionInterna, camposProyecto, camposCostos } = require('./vistas');

const P = (ctx) => (ctx.req.body && typeof ctx.req.body === 'object' ? ctx.req.body : {});
const Q = (ctx) => ctx.req.query || {};
const html = (ctx, h, codigo = 200) => ctx.res.status(codigo).type('html').send(h);
const ir = (ctx, a) => ctx.res.redirect(302, a);
const sel = (c) => (c ? 'selected' : '');
const chk = (c) => (c ? 'checked' : '');
const vacioPhp = (v) => vacio(v) || (Array.isArray(v) && v.length === 0) || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const hashClave = (c) => bcrypt.hashSync(String(c), 10);
const verificarClave = (c, h) => {
  try {
    return !!h && bcrypt.compareSync(String(c), String(h).replace(/^\$2y\$/, '$2b$'));
  } catch (err) {
    return false;
  }
};
const nl2br = (s) => String(s).replace(/(\r\n|\n|\r)/g, '<br />$1');
const decTxt = (v) => (v === null || v === undefined ? '' : String(Number(v)).replace(/\./g, ','));

/* ---------------- Ingreso ---------------- */
async function index(ctx) {
  if (await auth.usuarioActual(ctx)) return ir(ctx, 'leads.php');
  const admin = await ctx.db.una("SELECT * FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1");
  const primerUso = !!admin && vacio(admin.pass_hash);
  let error = '';

  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const p = P(ctx);
    const ip = ctx.ip();
    const fallos = Number(await ctx.db.valor("SELECT COUNT(*) FROM limites WHERE ip = ? AND accion = 'login_fallo' AND creado >= ?", [ip, fechaBogota(Date.now() - 900000)]));
    if (fallos >= 8) {
      error = 'Demasiados intentos fallidos. Espere 15 minutos.';
    } else if (primerUso) {
      const c1 = String(p.clave ?? '');
      error = claveValida(c1) ?? (c1 !== String(p.clave2 ?? '') ? 'Las dos contraseñas no coinciden.' : '');
      if (error === '') {
        await ctx.db.ejec("UPDATE usuarios SET pass_hash = ? WHERE id = ? AND (pass_hash IS NULL OR pass_hash = '')", [hashClave(c1), admin.id]);
        ctx.sesion = { uid: Number(admin.id) };
        mensajeFlash(ctx, 'Contraseña creada. Ahora cree las contraseñas de los asesores en Usuarios y configure el correo en Ajustes.');
        return ir(ctx, 'usuarios.php');
      }
    } else {
      const email = txt(p.email ?? '', 160).toLowerCase();
      const u = await ctx.db.una('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [email]);
      if (u && !vacio(u.pass_hash) && verificarClave(p.clave ?? '', u.pass_hash)) {
        ctx.sesion = { uid: Number(u.id) };
        await ctx.db.ejec('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?', [ahora(), u.id]);
        return ir(ctx, 'leads.php');
      }
      await ctx.db.ejec("INSERT INTO limites (ip, accion, creado) VALUES (?, 'login_fallo', ?)", [ip, ahora()]);
      error = 'El correo o la contraseña no coinciden.';
    }
  }

  let h = await cabecera(ctx, '', '');
  h += '\n<div class="ingreso">\n  <img src="../assets/img/logo-fabcom.png" alt="Fabcom" width="170" height="37">\n';
  if (primerUso) {
    h += '    <h1>Cree la contraseña del administrador</h1>\n    <p>Es el primer ingreso al CRM. Defina la contraseña de <strong>' + e(admin.email) + '</strong>.</p>\n';
  } else {
    h += '    <h1>CRM del simulador</h1>\n    <p>Ingrese con su correo de Fabcom.</p>\n';
  }
  if (error) h += '  <div class="flash flash--error" role="alert">' + e(error) + '</div>\n';
  h += '  <form method="post" class="formulario">\n    ' + csrfCampo(ctx) + '\n';
  if (!primerUso) {
    h += '      <label><span>Correo</span><input type="email" name="email" required autocomplete="username" autofocus></label>\n'
      + '      <label><span>Contraseña</span><input type="password" name="clave" required autocomplete="current-password"></label>\n'
      + '      <button class="btn">Ingresar</button>\n';
  } else {
    h += '      <label><span>Contraseña nueva</span><input type="password" name="clave" required minlength="10" autocomplete="new-password" autofocus><small>Mínimo 10 caracteres, con letras y números.</small></label>\n'
      + '      <label><span>Repita la contraseña</span><input type="password" name="clave2" required minlength="10" autocomplete="new-password"></label>\n'
      + '      <button class="btn">Crear contraseña e ingresar</button>\n';
  }
  h += '  </form>\n  <p class="ingreso__pie"><a href="../">Volver al simulador</a></p>\n</div>\n' + pie();
  return html(ctx, h);
}

async function salir(ctx) {
  auth.iniciarSesion(ctx);
  ctx.sesion = {};
  ctx.sesionBorrar = true;
  return ir(ctx, 'index.php');
}

/* ---------------- Mi cuenta ---------------- */
async function cuenta(ctx) {
  const u = await exigirSesion(ctx);
  let error = '';
  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const p = P(ctx);
    const nueva = String(p.nueva ?? '');
    if (!verificarClave(p.actual ?? '', u.pass_hash)) {
      error = 'La contraseña actual no coincide.';
    } else if ((error = claveValida(nueva) ?? '') === '' && nueva !== String(p.nueva2 ?? '')) {
      error = 'Las dos contraseñas nuevas no coinciden.';
    }
    if (error === '') {
      await ctx.db.ejec('UPDATE usuarios SET pass_hash = ? WHERE id = ?', [hashClave(nueva), u.id]);
      mensajeFlash(ctx, 'Contraseña cambiada.');
      return ir(ctx, 'cuenta.php');
    }
  }
  let h = await cabecera(ctx, 'Mi cuenta', '');
  h += '\n<section class="tarjeta tarjeta--angosta">\n'
    + '  <p><strong>' + e(u.nombre) + '</strong><br>' + e(u.email) + ' · ' + (u.rol === 'admin' ? 'Administrador' : 'Asesor') + '</p>\n'
    + '  <p>Su enlace personal del simulador, para enviarlo a sus clientes actuales:<br><strong>' + e(ctx.baseUrl()) + '/?asesor=' + Number(u.id) + '</strong></p>\n'
    + '  <h2>Cambiar contraseña</h2>\n';
  if (error) h += '  <div class="flash flash--error" role="alert">' + e(error) + '</div>\n';
  h += '  <form method="post" class="formulario">\n    ' + csrfCampo(ctx) + '\n'
    + '    <label><span>Contraseña actual</span><input type="password" name="actual" required autocomplete="current-password"></label>\n'
    + '    <label><span>Contraseña nueva</span><input type="password" name="nueva" required minlength="10" autocomplete="new-password"><small>Mínimo 10 caracteres, con letras y números.</small></label>\n'
    + '    <label><span>Repita la contraseña nueva</span><input type="password" name="nueva2" required minlength="10" autocomplete="new-password"></label>\n'
    + '    <button class="btn">Cambiar contraseña</button>\n  </form>\n</section>\n' + pie();
  return html(ctx, h);
}

/* ---------------- Usuarios ---------------- */
async function usuarios(ctx) {
  const yo = await exigirAdmin(ctx);
  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const p = P(ctx);
    const accion = String(p.accion ?? '');
    if (accion === 'crear') {
      const nombre = txt(p.nombre ?? '', 120);
      const email = txt(p.email ?? '', 160).toLowerCase();
      const clave = String(p.clave ?? '');
      let err = largo(nombre) < 3 ? 'Escriba el nombre del asesor.' : (!emailValido(email) ? 'Escriba un correo válido.' : claveValida(clave));
      if (!err) err = (await ctx.db.valor('SELECT 1 FROM usuarios WHERE email = ?', [email])) ? 'Ya existe un usuario con ese correo.' : null;
      if (err) {
        mensajeFlash(ctx, err, 'error');
      } else {
        await ctx.db.ejec('INSERT INTO usuarios (nombre, email, pass_hash, rol, activo, recibe_leads, creado) VALUES (?,?,?,?,1,?,?)', [nombre, email, hashClave(clave), 'asesor', vacioPhp(p.recibe_leads) ? 0 : 1, ahora()]);
        mensajeFlash(ctx, 'Usuario creado. Entréguele la contraseña temporal; podrá cambiarla en Mi cuenta.');
      }
    } else if (accion === 'guardar') {
      const id = int(p.id);
      const nombre = txt(p.nombre ?? '', 120);
      let activo = vacioPhp(p.activo) ? 0 : 1;
      if (id === Number(yo.id)) activo = 1; // el administrador no puede desactivarse a sí mismo
      if (largo(nombre) >= 3) {
        let cal = txt(p.calendario_url ?? '', 300);
        cal = /^https:\/\//i.test(cal) ? cal : '';
        await ctx.db.ejec('UPDATE usuarios SET nombre = ?, activo = ?, recibe_leads = ?, calendario_url = ? WHERE id = ?', [nombre, activo, vacioPhp(p.recibe_leads) ? 0 : 1, cal, id]);
      }
      const clave = String(p.clave ?? '');
      if (clave !== '') {
        const err = claveValida(clave);
        if (err) {
          mensajeFlash(ctx, err, 'error');
          return ir(ctx, 'usuarios.php');
        }
        await ctx.db.ejec('UPDATE usuarios SET pass_hash = ? WHERE id = ?', [hashClave(clave), id]);
      }
      mensajeFlash(ctx, 'Usuario actualizado.');
    }
    return ir(ctx, 'usuarios.php');
  }

  const lista = await ctx.db.todas('SELECT u.*, (SELECT COUNT(*) FROM leads l WHERE l.asesor_id = u.id) AS leads FROM usuarios u ORDER BY u.id');
  const base = e(ctx.baseUrl());
  let h = await cabecera(ctx, 'Usuarios', 'usuarios');
  h += '\n<p class="ayuda">Los leads nuevos se reparten por turnos entre los usuarios activos que tienen marcada la casilla «Recibe leads». Cada alerta llega al correo del usuario.</p>\n'
    + '<p class="ayuda">Enlace personal: cada asesor puede compartir con sus clientes actuales el enlace del simulador con su nombre ya elegido. Las respuestas de esos clientes le llegan a él, sin pasar por la rotación.</p>\n'
    + '<p class="ayuda">Agenda de Google Calendar: en Google Calendar, cada asesor crea un «Horario de citas» para visitas técnicas y copia aquí el enlace de su página de reservas. Con ese enlace, el botón «Agendar visita técnica» del simulador abre la agenda del asesor asignado. Sin enlace, el cliente propone fecha y lugar en un formulario.</p>\n'
    + '<section class="tarjeta">\n  <div class="tabla-caja"><table class="tabla">\n'
    + '    <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Leads</th><th>Activo</th><th>Recibe leads</th><th>Agenda de Google Calendar</th><th>Contraseña nueva</th><th></th></tr></thead>\n    <tbody>\n';
  for (const u of lista) {
    const f = 'u' + Number(u.id);
    h += '      <tr>\n'
      + '        <td><input form="' + f + '" type="text" name="nombre" value="' + e(u.nombre) + '" aria-label="Nombre" required></td>\n'
      + '        <td>' + e(u.email) + '<br><span class="tenue">Enlace personal: ' + base + '/?asesor=' + Number(u.id) + '</span>' + (vacio(u.pass_hash) ? '<br><span class="nota-alerta">Sin contraseña: aún no puede ingresar</span>' : '') + '</td>\n'
      + '        <td>' + (u.rol === 'admin' ? 'Administrador' : 'Asesor') + '</td>\n'
      + '        <td class="num">' + Number(u.leads) + '</td>\n'
      + '        <td><input form="' + f + '" type="checkbox" name="activo" ' + chk(Number(u.activo)) + ' ' + (Number(u.id) === Number(yo.id) ? 'disabled' : '') + ' aria-label="Activo"></td>\n'
      + '        <td><input form="' + f + '" type="checkbox" name="recibe_leads" ' + chk(Number(u.recibe_leads)) + ' aria-label="Recibe leads"></td>\n'
      + '        <td><input form="' + f + '" type="url" name="calendario_url" value="' + e(u.calendario_url) + '" placeholder="https://calendar.app.google/…" aria-label="Enlace de la agenda de Google Calendar"></td>\n'
      + '        <td><input form="' + f + '" type="password" name="clave" placeholder="Dejar igual" autocomplete="new-password" minlength="10" aria-label="Contraseña nueva"></td>\n'
      + '        <td><form id="' + f + '" method="post">' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="guardar"><input type="hidden" name="id" value="' + Number(u.id) + '"><button class="btn btn--chico">Guardar</button></form></td>\n'
      + '      </tr>\n';
  }
  h += '    </tbody>\n  </table></div>\n</section>\n'
    + '<section class="tarjeta tarjeta--angosta">\n  <h2>Agregar un usuario</h2>\n  <form method="post" class="formulario">\n'
    + '    ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="crear">\n'
    + '    <label><span>Nombre</span><input type="text" name="nombre" required maxlength="120"></label>\n'
    + '    <label><span>Correo</span><input type="email" name="email" required maxlength="160"></label>\n'
    + '    <label><span>Contraseña temporal</span><input type="password" name="clave" required minlength="10" autocomplete="new-password"><small>Mínimo 10 caracteres, con letras y números.</small></label>\n'
    + '    <label class="casilla"><input type="checkbox" name="recibe_leads" checked><span>Recibe leads por rotación</span></label>\n'
    + '    <button class="btn">Agregar usuario</button>\n  </form>\n</section>\n' + pie();
  return html(ctx, h);
}

/* ---------------- Leads ---------------- */
async function leads(ctx) {
  await exigirSesion(ctx);
  const q = Q(ctx);
  const f = {
    q: txt(q.q ?? '', 80),
    estado: Object.prototype.hasOwnProperty.call(ESTADOS_LEAD, String(q.estado ?? '')) ? String(q.estado) : '',
    asesor: int(q.asesor),
    sector: SECTORES.includes(q.sector) ? String(q.sector) : '',
  };
  const where = [];
  const args = [];
  if (f.q !== '') {
    where.push('(l.nombre LIKE ? OR l.empresa LIKE ? OR l.email LIKE ? OR l.telefono LIKE ?)');
    const like = '%' + f.q + '%';
    args.push(like, like, like, like);
  }
  if (f.estado !== '') { where.push('l.estado = ?'); args.push(f.estado); }
  if (f.asesor > 0) { where.push('l.asesor_id = ?'); args.push(f.asesor); }
  if (f.sector !== '') { where.push('l.sector = ?'); args.push(f.sector); }
  const sql = `SELECT l.*, u.nombre AS asesor, s.area_m2, s.producto_nombre, s.venta_potencial_cop, s.superficie, s.espacio, s.creado AS sim_fecha,
        (SELECT COUNT(*) FROM simulaciones x WHERE x.lead_id = l.id) AS n_sim,
        (SELECT GROUP_CONCAT(DISTINCT tipo) FROM eventos e WHERE e.lead_id = l.id AND e.tipo LIKE 'cta_%') AS ctas
        FROM leads l
        LEFT JOIN usuarios u ON u.id = l.asesor_id
        LEFT JOIN simulaciones s ON s.id = (SELECT MAX(id) FROM simulaciones WHERE lead_id = l.id)`
    + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY l.id DESC LIMIT 500';
  const lista = await ctx.db.todas(sql, args);
  const k = await ctx.db.una(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN estado = 'nuevo' THEN 1 ELSE 0 END) AS nuevos,
    SUM(CASE WHEN creado >= ? THEN 1 ELSE 0 END) AS semana
    FROM leads`, [fechaBogota(Date.now() - 7 * 86400000)]);
  const pot = Number(await ctx.db.valor("SELECT COALESCE(SUM(s.venta_potencial_cop),0) FROM leads l JOIN simulaciones s ON s.id = (SELECT MAX(id) FROM simulaciones WHERE lead_id = l.id) WHERE l.estado NOT IN ('perdido','ganado')"));
  const ctas = Number(await ctx.db.valor("SELECT COUNT(DISTINCT lead_id) FROM eventos WHERE tipo IN ('cta_cotizacion','cta_visita','cta_whatsapp')"));
  const asesores = await ctx.db.todas('SELECT id, nombre FROM usuarios ORDER BY nombre');
  const nomCta = { cta_cotizacion: 'Cotización', cta_visita: 'Visita', cta_whatsapp: 'WhatsApp' };

  let h = await cabecera(ctx, 'Leads', 'leads');
  h += '\n<div class="kpis">\n'
    + '  <div class="kpi"><b>' + n(k.total ?? 0) + '</b><span>leads en total</span></div>\n'
    + '  <div class="kpi"><b>' + n(k.nuevos ?? 0) + '</b><span>sin contactar</span></div>\n'
    + '  <div class="kpi"><b>' + n(k.semana ?? 0) + '</b><span>en los últimos 7 días</span></div>\n'
    + '  <div class="kpi"><b>' + n(ctas) + '</b><span>pidieron cotización, visita o WhatsApp</span></div>\n'
    + '  <div class="kpi"><b>' + e(dinero(pot, 'COP')) + '</b><span>venta potencial abierta, a precio de lista</span></div>\n</div>\n\n';
  h += '<form class="filtros" method="get">\n'
    + '  <label><span>Buscar</span><input type="search" name="q" value="' + e(f.q) + '" placeholder="Nombre, empresa, correo o teléfono"></label>\n'
    + '  <label><span>Estado</span><select name="estado"><option value="">Todos</option>' + Object.entries(ESTADOS_LEAD).map(([c, t]) => '<option value="' + c + '" ' + sel(f.estado === c) + '>' + e(t) + '</option>').join('') + '</select></label>\n'
    + '  <label><span>Asesor</span><select name="asesor"><option value="0">Todos</option>' + asesores.map((a) => '<option value="' + Number(a.id) + '" ' + sel(f.asesor === Number(a.id)) + '>' + e(a.nombre) + '</option>').join('') + '</select></label>\n'
    + '  <label><span>Sector</span><select name="sector"><option value="">Todos</option>' + SECTORES.map((s) => '<option ' + sel(f.sector === s) + '>' + e(s) + '</option>').join('') + '</select></label>\n'
    + '  <button class="btn btn--chico">Filtrar</button>\n'
    + '  <a class="btn btn--plano btn--chico" href="exportar.php">Descargar todo en CSV</a>\n</form>\n\n<section class="tarjeta">\n';
  if (!lista.length) {
    h += '  <p class="vacio">' + (where.length ? 'Ningún lead coincide con esos filtros.' : 'Todavía no hay leads. Aparecerán aquí cuando alguien complete el simulador.') + '</p>\n';
  } else {
    h += '  <div class="tabla-caja"><table class="tabla">\n'
      + '    <thead><tr><th>Fecha</th><th>Contacto</th><th>Proyecto</th><th>Abrasivo recomendado</th><th class="num">Venta potencial</th><th>Pidió</th><th>Asesor</th><th>Estado</th></tr></thead>\n    <tbody>\n';
    for (const l of lista) {
      let proyecto;
      if (!vacio(l.area_m2)) {
        proyecto = e(nAuto(l.area_m2)) + ' m² · ' + e(SUPERFICIES[l.superficie] ?? '') + '<br><span class="tenue">Espacio ' + e(String(ESPACIOS[l.espacio] ?? '').toLowerCase()) + (Number(l.n_sim) > 1 ? ' · ' + Number(l.n_sim) + ' simulaciones' : '') + '</span>';
      } else {
        proyecto = '<span class="tenue">Se registró y no simuló</span>';
      }
      const pidio = String(l.ctas ?? '').split(',').filter((c) => c !== '').map((c) => nomCta[c] ?? c).join(', ');
      h += '      <tr>\n'
        + '        <td class="nowrap">' + e(fechaCorta(l.creado)) + '</td>\n'
        + '        <td><a href="lead.php?id=' + Number(l.id) + '"><strong>' + e(l.empresa) + '</strong></a><br><span class="tenue">' + e(l.nombre) + (l.sector !== '' ? ' · ' + e(l.sector) : '') + '</span></td>\n'
        + '        <td>' + proyecto + '</td>\n'
        + '        <td>' + e(l.producto_nombre ?? '') + '</td>\n'
        + '        <td class="num nowrap">' + (!vacio(l.venta_potencial_cop) ? e(dinero(l.venta_potencial_cop, 'COP')) : '') + '</td>\n'
        + '        <td>' + e(pidio) + '</td>\n'
        + '        <td>' + e(l.asesor ?? 'Sin asignar') + '</td>\n'
        + '        <td>' + etiquetaEstado(l.estado) + '</td>\n      </tr>\n';
    }
    h += '    </tbody>\n  </table></div>\n';
  }
  h += '</section>\n' + pie();
  return html(ctx, h);
}

/* ---------------- Exportar CSV ---------------- */
function csvCampo(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Igual que fputcsv: comillas solo si hace falta.
  if (/[;"\n\r\t \\]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function exportar(ctx) {
  await exigirSesion(ctx);
  const rows = await ctx.db.todas(`SELECT l.id, l.creado, l.nombre, l.email, l.empresa, l.telefono, l.sector, l.area_cargo, l.estado, l.tipo_cliente, u.nombre AS asesor,
    l.origen, l.utm_source, l.utm_medium, l.utm_campaign, l.referrer, l.dispositivo, l.acepta_marketing, l.visita_fecha, l.visita_lugar,
    (SELECT COUNT(*) FROM simulaciones x WHERE x.lead_id = l.id) AS simulaciones,
    s.creado AS ultima_simulacion, s.superficie, s.espacio, s.grado, s.corrosion, s.area_m2, s.moneda, s.producto_nombre, s.kg_fabcom, s.venta_potencial_cop, s.dif_total_pct,
    (SELECT COUNT(*) FROM eventos e WHERE e.lead_id = l.id AND e.tipo = 'cta_cotizacion') AS pidio_cotizacion,
    (SELECT COUNT(*) FROM eventos e WHERE e.lead_id = l.id AND e.tipo = 'cta_visita') AS pidio_visita,
    (SELECT COUNT(*) FROM eventos e WHERE e.lead_id = l.id AND e.tipo = 'cta_whatsapp') AS abrio_whatsapp,
    (SELECT COUNT(*) FROM eventos e WHERE e.lead_id = l.id AND e.tipo = 'pdf_descarga') AS descargo_pdf
    FROM leads l LEFT JOIN usuarios u ON u.id = l.asesor_id
    LEFT JOIN simulaciones s ON s.id = (SELECT MAX(id) FROM simulaciones WHERE lead_id = l.id)
    ORDER BY l.id DESC`);
  const cab = ['ID', 'Fecha de registro', 'Nombre', 'Correo', 'Empresa', 'Teléfono', 'Sector', 'Área', 'Estado', 'Tipo de cliente', 'Asesor', 'Origen', 'UTM fuente', 'UTM medio', 'UTM campaña', 'Página de procedencia', 'Dispositivo', 'Acepta información comercial', 'Visita: fecha', 'Visita: lugar', 'Simulaciones', 'Última simulación', 'Superficie', 'Espacio', 'Grado de limpieza', 'Corrosión', 'Área m²', 'Moneda', 'Abrasivo recomendado', 'Abrasivo Fabcom kg', 'Venta potencial COP', 'Diferencia de costo total %', 'Pidió cotización', 'Pidió visita', 'Abrió WhatsApp', 'Descargó PDF'];
  let out = '\uFEFF' + cab.map(csvCampo).join(';') + '\n';
  for (const r of rows) {
    r.superficie = SUPERFICIES[r.superficie] ?? '';
    r.espacio = ESPACIOS[r.espacio] ?? '';
    r.grado = GRADOS[r.grado] ? GRADOS[r.grado][0] : '';
    r.estado = ESTADOS_LEAD[r.estado] ?? r.estado;
    r.acepta_marketing = Number(r.acepta_marketing) ? 'Sí' : 'No';
    r.tipo_cliente = { nuevo: 'Nuevo', actual: 'Actual' }[r.tipo_cliente] ?? '';
    for (const c of ['area_m2', 'kg_fabcom', 'venta_potencial_cop', 'dif_total_pct']) {
      r[c] = r[c] === null || r[c] === undefined ? '' : String(phpRound(Number(r[c]), 1)).replace('.', ',');
    }
    for (const c of Object.keys(r)) { // evita que Excel interprete texto como fórmula
      const v = r[c];
      if (typeof v === 'string' && v !== '' && '=+@'.includes(v[0])) r[c] = "'" + v;
    }
    out += Object.values(r).map(csvCampo).join(';') + '\n';
  }
  ctx.res.set('Content-Type', 'text/csv; charset=utf-8');
  ctx.res.set('Content-Disposition', 'attachment; filename="leads-simulador-fabcom-' + fechaBogota().slice(0, 10) + '.csv"');
  return ctx.res.send(Buffer.from(out, 'utf8'));
}

/* ---------------- Ficha del lead ---------------- */
async function lead(ctx) {
  const yo = await exigirSesion(ctx);
  const p = P(ctx);
  const id = int(Q(ctx).id ?? p.id ?? 0);
  const l = await leadPorId(ctx, id);
  if (!l) {
    return html(ctx, (await cabecera(ctx, 'Lead no encontrado', 'leads')) + '<p class="vacio">Ese lead no existe. <a href="leads.php">Volver al listado</a>.</p>' + pie());
  }

  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const accion = String(p.accion ?? '');
    if (accion === 'gestion') {
      const estado = Object.prototype.hasOwnProperty.call(ESTADOS_LEAD, String(p.estado ?? '')) ? String(p.estado) : l.estado;
      const asesor = int(p.asesor_id) || null;
      if (estado !== l.estado) {
        await ctx.evento(id, 'estado', 'Estado: ' + ESTADOS_LEAD[l.estado] + ' → ' + ESTADOS_LEAD[estado] + '.', Number(yo.id));
      }
      if (asesor !== (l.asesor_id ? Number(l.asesor_id) : null)) {
        const a = await usuarioPorId(ctx, asesor);
        await ctx.evento(id, 'asignacion', 'Reasignado a ' + ((a && a.nombre) ?? 'nadie') + '.', Number(yo.id));
      }
      await ctx.db.ejec('UPDATE leads SET estado = ?, asesor_id = ? WHERE id = ?', [estado, asesor, id]);
      mensajeFlash(ctx, 'Cambios guardados.');
    } else if (accion === 'nota') {
      const nota = txt(p.nota ?? '', 1500);
      if (nota !== '') {
        await ctx.evento(id, 'nota', nota, Number(yo.id));
        mensajeFlash(ctx, 'Nota agregada.');
      }
    } else if (accion === 'recalcular') {
      const en = normalizarEntrada(ctx, p);
      if (en.errores && en.errores.length) {
        mensajeFlash(ctx, en.errores.join(' '), 'error');
      } else {
        delete en.errores;
        const prod = await producto(ctx, int(p.producto_id));
        const precio = num(p.precio_kg ?? null);
        const r = await simular(ctx, en, prod || null, precio !== null && precio > 0 ? precio : null);
        await guardarSimulacion(ctx, id, r);
        await ctx.evento(id, 'simulacion', 'Recalculada por ' + yo.nombre + ': ' + r.interno.producto + ' a ' + dinero(r.interno.precio_kg_cop, 'COP') + '/kg.', Number(yo.id));
        let msg = 'Simulación recalculada.';
        let ok = false;
        const enviar = !vacioPhp(p.enviar);
        if (enviar) {
          const asesor = await usuarioPorId(ctx, l.asesor_id ? Number(l.asesor_id) : Number(yo.id));
          ok = await correoResultadoCliente(ctx, l, r.cliente, await generarPdf(ctx, l, r.cliente, ahora()), asesor);
          await ctx.evento(id, ok ? 'correo_cliente' : 'correo_error', ok ? 'PDF enviado a ' + l.email + '.' : 'No se pudo enviar el PDF. Revise Ajustes → Correo.', Number(yo.id));
          msg += ok ? ' El PDF se envió a ' + l.email + '.' : ' El PDF no se pudo enviar: revise el correo en Ajustes.';
        }
        mensajeFlash(ctx, msg, enviar && !ok ? 'error' : 'ok');
      }
    } else if (accion === 'borrar' && yo.rol === 'admin') {
      // En la base remota no se garantizan los borrados en cascada: se borran explícitamente.
      await ctx.db.lote([
        ['DELETE FROM simulaciones WHERE lead_id = ?', [id]],
        ['DELETE FROM eventos WHERE lead_id = ?', [id]],
        ['UPDATE correos SET lead_id = NULL WHERE lead_id = ?', [id]],
        ['DELETE FROM leads WHERE id = ?', [id]],
      ]);
      mensajeFlash(ctx, 'Lead eliminado.');
      return ir(ctx, 'leads.php');
    }
    return ir(ctx, 'lead.php?id=' + id);
  }

  const sim = await ultimaSimulacion(ctx, id);
  const eventos = await ctx.db.todas('SELECT e.*, u.nombre AS usuario FROM eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.lead_id = ? ORDER BY e.id DESC', [id]);
  const correos = await ctx.db.todas('SELECT * FROM correos WHERE lead_id = ? ORDER BY id DESC LIMIT 20', [id]);
  const asesores = await ctx.db.todas('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre');
  const productos = await ctx.db.todas('SELECT id, nombre, precio_kg FROM productos WHERE activo = 1 ORDER BY id');
  const tipos = { registro: 'Registro', simulacion: 'Simulación', asignacion: 'Asignación', correo_cliente: 'Correo', correo_error: 'Error de correo', pdf_descarga: 'PDF', vista_resultado: 'Visita', cta_cotizacion: 'Cotización', cta_visita: 'Visita técnica', cta_whatsapp: 'WhatsApp', nota: 'Nota', estado: 'Estado' };
  const tel = String(l.telefono ?? '').replace(/\D+/g, '');
  const ent = sim ? sim.entrada : {};
  const monedaEnt = ent.moneda ?? 'COP';

  let h = await cabecera(ctx, l.empresa, 'leads');
  h += '\n<p class="miga"><a href="leads.php">Leads</a> / ' + e(l.nombre) + ' ' + etiquetaEstado(l.estado) + '</p>\n<div class="dos-col">\n  <div>\n'
    + '    <section class="tarjeta">\n      <h2>Simulación más reciente</h2>\n';
  if (sim) {
    h += '        <p class="tenue">' + e(fechaCorta(sim.creado)) + ' · ' + e(sim.cliente.proyecto.area) + ' · ' + e(sim.cliente.proyecto.superficie) + ' · espacio ' + e(String(sim.cliente.proyecto.espacio).toLowerCase()) + '</p>\n';
    h += vistaSimulacionInterna(ctx, sim, l.token);
  } else {
    h += '        <p class="vacio">Se registró pero aún no hizo una simulación. Puede hacerla usted abajo.</p>\n';
  }
  h += '    </section>\n\n    <section class="tarjeta">\n'
    + '      <h2>' + (sim ? 'Recalcular con otro producto o precio' : 'Simular para este cliente') + '</h2>\n'
    + '      <p class="ayuda">Úselo para probar un precio negociado u otro abrasivo. La nueva simulación reemplaza a la anterior como «más reciente» y es la que sale en el PDF.</p>\n'
    + '      <form method="post" class="formulario formulario--ancho">\n'
    + '        ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="recalcular"><input type="hidden" name="id" value="' + id + '">\n'
    + '        ' + camposProyecto(ent) + '\n'
    + '        <details><summary>Costos del cliente</summary>' + camposCostos(ctx, ent.costos ?? costosPorDefecto(ctx, monedaEnt), monedaEnt) + '\n'
    + '          <label class="casilla"><input type="checkbox" name="nocturno" ' + chk(!vacioPhp(ent.nocturno)) + '><span>Trabajo en jornada nocturna</span></label></details>\n'
    + '        <div class="rejilla rejilla--3">\n'
    + '          <label><span>Producto</span><select name="producto_id"><option value="0">El recomendado por la matriz</option>'
    + productos.map((pr) => '<option value="' + Number(pr.id) + '" ' + sel(sim && Number(sim.interno.producto_id) === Number(pr.id)) + '>' + e(pr.nombre) + ' — lista ' + e(dinero(pr.precio_kg, 'COP')) + '/kg</option>').join('') + '</select></label>\n'
    + '          <label><span>Precio para este cliente, COP/kg</span><input type="text" name="precio_kg" inputmode="decimal" placeholder="Vacío = precio de lista" value="' + (sim && !vacioPhp(sim.interno.precio_personalizado) ? e(n(sim.interno.precio_kg_cop)) : '') + '"></label>\n'
    + '          <label class="casilla casilla--baja"><input type="checkbox" name="enviar"><span>Enviar el PDF nuevo a ' + e(l.email) + '</span></label>\n'
    + '        </div>\n        <button class="btn">Calcular</button>\n      </form>\n    </section>\n  </div>\n\n  <aside>\n';

  const procedencia = String(l.utm_source ?? '') + String(l.utm_campaign ?? '') + String(l.referrer ?? '');
  const llego = (String(l.utm_source ?? '') + ' / ' + String(l.utm_medium ?? '') + ' / ' + String(l.utm_campaign ?? '')).replace(/^[ /]+|[ /]+$/g, '') || l.referrer;
  h += '    <section class="tarjeta">\n      <h2>Contacto</h2>\n      <dl class="datos">\n'
    + '        <dt>Nombre</dt><dd>' + e(l.nombre) + '</dd>\n'
    + '        <dt>Empresa</dt><dd>' + e(l.empresa) + '</dd>\n'
    + '        <dt>Correo</dt><dd><a href="mailto:' + e(l.email) + '">' + e(l.email) + '</a></dd>\n'
    + '        <dt>Teléfono</dt><dd><a href="tel:' + e(tel) + '">' + e(l.telefono) + '</a>' + (tel.length >= 10 ? ' · <a href="https://wa.me/' + e(tel.length === 10 ? '57' + tel : tel) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</dd>\n'
    + '        <dt>Tipo de cliente</dt><dd>' + (l.tipo_cliente === 'actual' ? 'Cliente actual, eligió a su asesor' : (l.tipo_cliente === 'nuevo' ? 'Cliente nuevo' : 'Sin dato')) + '</dd>\n'
    + '        ' + (l.sector !== '' ? '<dt>Sector</dt><dd>' + e(l.sector) + '</dd>' : '') + '\n'
    + '        ' + (l.area_cargo !== '' ? '<dt>Área</dt><dd>' + e(l.area_cargo) + '</dd>' : '') + '\n'
    + '        ' + (l.visita_fecha !== '' && l.visita_fecha !== null ? '<dt>Visita pedida</dt><dd>' + e(fechaDMY(l.visita_fecha)) + ' · ' + e(l.visita_lugar) + '</dd>' : '') + '\n'
    + '        <dt>Registro</dt><dd>' + e(fechaCorta(l.creado)) + ' · ' + (l.origen === 'asesor' ? 'creado por un asesor' : 'web, ' + e(l.dispositivo)) + '</dd>\n'
    + '        ' + (procedencia !== '' ? '<dt>Llegó desde</dt><dd>' + e(llego) + '</dd>' : '') + '\n'
    + '        <dt>Información comercial</dt><dd>' + (Number(l.acepta_marketing) ? 'Aceptó recibirla' : 'No la aceptó') + '</dd>\n'
    + '      </dl>\n    </section>\n';
  h += '    <section class="tarjeta">\n      <h2>Gestión</h2>\n      <form method="post" class="formulario">\n'
    + '        ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="gestion"><input type="hidden" name="id" value="' + id + '">\n'
    + '        <label><span>Estado</span><select name="estado">' + Object.entries(ESTADOS_LEAD).map(([c, t]) => '<option value="' + c + '" ' + sel(l.estado === c) + '>' + e(t) + '</option>').join('') + '</select></label>\n'
    + '        <label><span>Asesor</span><select name="asesor_id"><option value="0">Sin asignar</option>' + asesores.map((a) => '<option value="' + Number(a.id) + '" ' + sel(Number(l.asesor_id) === Number(a.id)) + '>' + e(a.nombre) + '</option>').join('') + '</select></label>\n'
    + '        <button class="btn btn--chico">Guardar</button>\n      </form>\n'
    + '      <form method="post" class="formulario">\n'
    + '        ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="nota"><input type="hidden" name="id" value="' + id + '">\n'
    + '        <label><span>Nota de seguimiento</span><textarea name="nota" rows="3" maxlength="1500" required></textarea></label>\n'
    + '        <button class="btn btn--plano btn--chico">Agregar nota</button>\n      </form>\n    </section>\n';
  h += '    <section class="tarjeta">\n      <h2>Historial</h2>\n      <ul class="historial">\n';
  for (const ev of eventos) {
    h += '          <li class="historial__item historial__item--' + e(ev.tipo) + '"><b>' + e(tipos[ev.tipo] ?? ev.tipo) + '</b> <span class="tenue">' + e(fechaCorta(ev.creado)) + (ev.usuario ? ' · ' + e(ev.usuario) : '') + '</span><br>' + nl2br(e(ev.detalle)) + '</li>\n';
  }
  h += '      </ul>\n';
  if (correos.length) {
    h += '        <h3>Correos</h3>\n        <ul class="historial">\n          ';
    for (const c of correos) h += filaCorreo(c);
    h += '\n        </ul>\n';
  }
  h += '    </section>\n';
  if (yo.rol === 'admin') {
    h += '    <form method="post" onsubmit="return confirm(\'¿Eliminar este lead con sus simulaciones e historial? No se puede deshacer.\');">\n'
      + '      ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="borrar"><input type="hidden" name="id" value="' + id + '">\n'
      + '      <button class="btn btn--peligro btn--chico">Eliminar lead</button>\n    </form>\n';
  }
  h += '  </aside>\n</div>\n' + pie();
  return html(ctx, h);
}

function filaCorreo(c) {
  return '<li><b class="' + (c.estado === 'enviado' ? 'bien' : 'mal') + '">' + (c.estado === 'enviado' ? 'Enviado' : 'Falló') + '</b> <span class="tenue">' + e(fechaCorta(c.creado)) + '</span><br>' + e(c.asunto) + ' → ' + e(c.para) + (c.error !== '' && c.error !== null ? '<br><span class="mal">' + e(c.error) + '</span>' : '') + '</li>';
}

/* ---------------- Simular con un cliente ---------------- */
async function nueva(ctx) {
  const yo = await exigirSesion(ctx);
  const v = esPost(ctx) ? P(ctx) : {};
  let error = '';

  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const nombre = txt(v.nombre ?? '', 120);
    const email = txt(v.email ?? '', 160).toLowerCase();
    const empresa = txt(v.empresa ?? '', 160);
    const telefono = txt(v.telefono ?? '', 40);
    const en = normalizarEntrada(ctx, v);
    if (largo(nombre) < 3 || largo(empresa) < 2 || !emailValido(email)) {
      error = 'Escriba el nombre, la empresa y un correo válido del cliente.';
    } else if (vacioPhp(v.acepta_datos)) {
      error = 'Confirme que el cliente autorizó el tratamiento de sus datos.';
    } else if (en.errores && en.errores.length) {
      error = en.errores.join(' ');
    } else {
      delete en.errores;
      let l = await ctx.db.una('SELECT * FROM leads WHERE email = ? ORDER BY id DESC LIMIT 1', [email]);
      if (!l) {
        const r0 = await ctx.db.ejec("INSERT INTO leads (token, creado, nombre, email, empresa, telefono, sector, area_cargo, acepta_datos, asesor_id, origen, estado, tipo_cliente) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,'actual')", [
          tokenHex(16), ahora(), nombre, email, empresa, telefono, SECTORES.includes(v.sector) ? v.sector : '', AREAS_CARGO.includes(v.area_cargo) ? v.area_cargo : '', yo.id, 'asesor', 'contactado',
        ]);
        l = await leadPorId(ctx, Number(r0.id));
        await ctx.evento(Number(l.id), 'registro', 'Creado por ' + yo.nombre + ' desde el CRM.', Number(yo.id));
      }
      const prod = await producto(ctx, int(v.producto_id));
      const precio = num(v.precio_kg ?? null);
      const r = await simular(ctx, en, prod || null, precio !== null && precio > 0 ? precio : null);
      await guardarSimulacion(ctx, Number(l.id), r);
      await ctx.evento(Number(l.id), 'simulacion', 'Hecha por ' + yo.nombre + ': ' + r.cliente.proyecto.area + ' · ' + r.interno.producto + '.', Number(yo.id));
      let msg = 'Simulación guardada.';
      let tipo = 'ok';
      if (!vacioPhp(v.enviar)) {
        const ok = await correoResultadoCliente(ctx, l, r.cliente, await generarPdf(ctx, l, r.cliente, ahora()), await usuarioPorId(ctx, Number(l.asesor_id || yo.id)));
        await ctx.evento(Number(l.id), ok ? 'correo_cliente' : 'correo_error', ok ? 'PDF enviado a ' + l.email + '.' : 'No se pudo enviar el PDF. Revise Ajustes → Correo.', Number(yo.id));
        msg += ok ? ' El PDF se envió a ' + l.email + '.' : ' El PDF no se pudo enviar: revise el correo en Ajustes.';
        tipo = ok ? 'ok' : 'error';
      }
      mensajeFlash(ctx, msg, tipo);
      return ir(ctx, 'lead.php?id=' + Number(l.id));
    }
  }
  const productos = await ctx.db.todas('SELECT id, nombre, precio_kg FROM productos WHERE activo = 1 ORDER BY id');
  const moneda = Object.prototype.hasOwnProperty.call(MONEDAS, String(v.moneda ?? '')) ? v.moneda : 'COP';
  const costos = v.costos && typeof v.costos === 'object' && !Array.isArray(v.costos) ? v.costos : costosPorDefecto(ctx, moneda);
  let h = await cabecera(ctx, 'Simular con un cliente', 'nueva');
  h += '\n<p class="ayuda">Para usar en una reunión o una llamada. El cliente queda registrado como lead a su nombre y usted ve las cifras completas; el PDF que se le envía solo muestra porcentajes.</p>\n';
  if (error) h += '<div class="flash flash--error" role="alert">' + e(error) + '</div>\n';
  h += '<form method="post" class="formulario formulario--ancho">\n  ' + csrfCampo(ctx) + '\n'
    + '  <section class="tarjeta">\n    <h2>Cliente</h2>\n    <div class="rejilla rejilla--3">\n'
    + '      <label><span>Nombre</span><input type="text" name="nombre" required value="' + e(v.nombre ?? '') + '"></label>\n'
    + '      <label><span>Correo</span><input type="email" name="email" required value="' + e(v.email ?? '') + '"></label>\n'
    + '      <label><span>Empresa</span><input type="text" name="empresa" required value="' + e(v.empresa ?? '') + '"></label>\n'
    + '      <label><span>Teléfono</span><input type="tel" name="telefono" value="' + e(v.telefono ?? '') + '"></label>\n'
    + '      <label><span>Sector</span><select name="sector"><option value="">Sin definir</option>' + SECTORES.map((s) => '<option ' + sel((v.sector ?? '') === s) + '>' + e(s) + '</option>').join('') + '</select></label>\n'
    + '      <label><span>Área del contacto</span><select name="area_cargo"><option value="">Sin definir</option>' + AREAS_CARGO.map((s) => '<option ' + sel((v.area_cargo ?? '') === s) + '>' + e(s) + '</option>').join('') + '</select></label>\n'
    + '    </div>\n'
    + '    <label class="casilla"><input type="checkbox" name="acepta_datos" ' + chk(!vacioPhp(v.acepta_datos)) + '><span>El cliente autorizó el tratamiento de sus datos personales (Ley 1581 de 2012).</span></label>\n'
    + '  </section>\n  <section class="tarjeta">\n    <h2>Proyecto</h2>\n    ' + camposProyecto(v) + '\n'
    + '    <details><summary>Costos del cliente</summary>' + camposCostos(ctx, costos, moneda) + '\n'
    + '      <label class="casilla"><input type="checkbox" name="nocturno" ' + chk(!vacioPhp(v.nocturno)) + '><span>Trabajo en jornada nocturna</span></label></details>\n'
    + '  </section>\n  <section class="tarjeta">\n    <h2>Oferta</h2>\n    <div class="rejilla rejilla--3">\n'
    + '      <label><span>Producto</span><select name="producto_id"><option value="0">El recomendado por la matriz</option>' + productos.map((pr) => '<option value="' + Number(pr.id) + '" ' + sel(int(v.producto_id) === Number(pr.id)) + '>' + e(pr.nombre) + ' — lista ' + e(dinero(pr.precio_kg, 'COP')) + '/kg</option>').join('') + '</select></label>\n'
    + '      <label><span>Precio para este cliente, COP/kg</span><input type="text" name="precio_kg" inputmode="decimal" placeholder="Vacío = precio de lista" value="' + e(v.precio_kg ?? '') + '"></label>\n'
    + '      <label class="casilla casilla--baja"><input type="checkbox" name="enviar" ' + chk(!vacioPhp(v.enviar)) + '><span>Enviar el PDF al correo del cliente</span></label>\n'
    + '    </div>\n    <button class="btn">Calcular y guardar</button>\n  </section>\n</form>\n' + pie();
  return html(ctx, h);
}

/* ---------------- Marketing ---------------- */
async function marketing(ctx) {
  await exigirSesion(ctx);
  const qd = Q(ctx).dias;
  const dPedido = qd === undefined ? 90 : int(qd);
  const dias = [30, 90, 365, 0].includes(dPedido) ? dPedido : 90;
  const desde = dias ? fechaBogota(Date.now() - dias * 86400000).slice(0, 10) + ' 00:00:00' : '2000-01-01 00:00:00';
  const uno = async (sql) => Number(await ctx.db.valor(sql, [desde]));
  const grupo = (sql) => ctx.db.todas(sql, [desde]);
  const ult = 's.id = (SELECT MAX(id) FROM simulaciones WHERE lead_id = l.id)';

  const embudo = [
    ['Se registraron', await uno('SELECT COUNT(*) FROM leads WHERE creado >= ?')],
    ['Hicieron la simulación', await uno('SELECT COUNT(*) FROM leads l WHERE creado >= ? AND EXISTS (SELECT 1 FROM simulaciones s WHERE s.lead_id = l.id)')],
    ['Descargaron o reabrieron el resultado', await uno("SELECT COUNT(*) FROM leads l WHERE creado >= ? AND EXISTS (SELECT 1 FROM eventos e WHERE e.lead_id = l.id AND e.tipo IN ('pdf_descarga','vista_resultado'))")],
    ['Pidieron cotización, visita o WhatsApp', await uno("SELECT COUNT(*) FROM leads l WHERE creado >= ? AND EXISTS (SELECT 1 FROM eventos e WHERE e.lead_id = l.id AND e.tipo LIKE 'cta_%')")],
    ['Negocios ganados', await uno("SELECT COUNT(*) FROM leads WHERE creado >= ? AND estado = 'ganado'")],
  ];
  const bloques = [
    ['Tipo de cliente', "SELECT CASE tipo_cliente WHEN 'actual' THEN 'Cliente actual' WHEN 'nuevo' THEN 'Cliente nuevo' ELSE 'Sin dato' END AS k, COUNT(*) AS c FROM leads WHERE creado >= ? GROUP BY k ORDER BY c DESC"],
    ['Sector', "SELECT CASE WHEN sector = '' THEN 'Sin dato' ELSE sector END AS k, COUNT(*) AS c FROM leads WHERE creado >= ? GROUP BY k ORDER BY c DESC"],
    ['Área del contacto', "SELECT CASE WHEN area_cargo = '' THEN 'Sin dato' ELSE area_cargo END AS k, COUNT(*) AS c FROM leads WHERE creado >= ? GROUP BY k ORDER BY c DESC"],
    ['Fuente de tráfico', "SELECT CASE WHEN origen = 'asesor' THEN 'Creado por asesor' WHEN utm_source <> '' THEN utm_source || CASE WHEN utm_medium <> '' THEN ' / ' || utm_medium ELSE '' END WHEN referrer <> '' THEN 'Enlace desde otro sitio' ELSE 'Directo' END AS k, COUNT(*) AS c FROM leads WHERE creado >= ? GROUP BY k ORDER BY c DESC"],
    ['Campaña', "SELECT utm_campaign AS k, COUNT(*) AS c FROM leads WHERE creado >= ? AND utm_campaign <> '' GROUP BY k ORDER BY c DESC LIMIT 12"],
    ['Dispositivo', "SELECT CASE WHEN dispositivo = '' THEN 'Sin dato' ELSE dispositivo END AS k, COUNT(*) AS c FROM leads WHERE creado >= ? AND origen = 'web' GROUP BY k ORDER BY c DESC"],
    ['Tipo de superficie', `SELECT s.superficie AS k, COUNT(*) AS c FROM leads l JOIN simulaciones s ON ${ult} WHERE l.creado >= ? GROUP BY k ORDER BY c DESC`],
    ['Espacio de trabajo', `SELECT s.espacio AS k, COUNT(*) AS c FROM leads l JOIN simulaciones s ON ${ult} WHERE l.creado >= ? GROUP BY k ORDER BY c DESC`],
    ['Abrasivo recomendado', `SELECT s.producto_nombre AS k, COUNT(*) AS c FROM leads l JOIN simulaciones s ON ${ult} WHERE l.creado >= ? GROUP BY k ORDER BY c DESC`],
    ['Tamaño del proyecto', `SELECT CASE WHEN s.area_m2 < 500 THEN '1. Menos de 500 m²' WHEN s.area_m2 < 2000 THEN '2. 500 a 2.000 m²' WHEN s.area_m2 < 10000 THEN '3. 2.000 a 10.000 m²' ELSE '4. Más de 10.000 m²' END AS k, COUNT(*) AS c FROM leads l JOIN simulaciones s ON ${ult} WHERE l.creado >= ? GROUP BY k ORDER BY k`],
    ['Grado de limpieza pedido', `SELECT CASE WHEN s.grado = '' THEN 'No lo indicó' ELSE s.grado END AS k, COUNT(*) AS c FROM leads l JOIN simulaciones s ON ${ult} WHERE l.creado >= ? GROUP BY k ORDER BY c DESC`],
  ];
  const datosBloques = [];
  for (const [t, sql] of bloques) datosBloques.push([t, await grupo(sql)]);
  const nombres = { ...SUPERFICIES, ...ESPACIOS, sp7: 'Brush-off', sp6: 'Grado comercial', sp10: 'Metal casi blanco', sp5: 'Metal blanco' };
  const semanas = await grupo("SELECT strftime('%Y-%W', creado) AS k, MIN(date(creado)) AS d, COUNT(*) AS c FROM leads WHERE creado >= ? GROUP BY k ORDER BY k");
  const t = await ctx.db.una(`SELECT COALESCE(SUM(s.area_m2),0) AS m2, COALESCE(SUM(s.kg_fabcom),0) AS kg, COALESCE(SUM(s.venta_potencial_cop),0) AS cop, SUM(l.acepta_marketing) AS mk, COUNT(*) AS n FROM leads l JOIN simulaciones s ON ${ult} WHERE l.creado >= ?`, [desde]);

  let h = await cabecera(ctx, 'Marketing', 'marketing');
  h += '\n<form class="filtros" method="get">\n  <label><span>Periodo</span><select name="dias" onchange="this.form.submit()">\n    '
    + [[30, 'Últimos 30 días'], [90, 'Últimos 90 días'], [365, 'Último año'], [0, 'Todo']].map(([d, tx]) => '<option value="' + d + '" ' + sel(dias === d) + '>' + tx + '</option>').join('')
    + '\n  </select></label>\n  <noscript><button class="btn btn--chico">Ver</button></noscript>\n  <a class="btn btn--plano btn--chico" href="exportar.php">Descargar todo en CSV</a>\n</form>\n\n';
  h += '<div class="kpis">\n'
    + '  <div class="kpi"><b>' + n(t.m2) + ' m²</b><span>simulados en total</span></div>\n'
    + '  <div class="kpi"><b>' + e(pesoTxt(Number(t.kg))) + '</b><span>de abrasivo Fabcom estimado</span></div>\n'
    + '  <div class="kpi"><b>' + e(dinero(t.cop, 'COP')) + '</b><span>venta potencial a precio de lista</span></div>\n'
    + '  <div class="kpi"><b>' + n(t.mk ?? 0) + ' de ' + n(t.n) + '</b><span>aceptaron recibir información comercial</span></div>\n</div>\n\n';
  h += '<section class="tarjeta">\n  <h2>Embudo</h2>\n';
  const max = Math.max(1, embudo[0][1]);
  for (const [tx, c] of embudo) {
    h += '    <div class="fila-barra"><span>' + e(tx) + '</span><div class="fila-barra__pista"><i style="width:' + phpRound(c / max * 100, 1) + '%"></i></div><b>' + n(c) + '</b><em>' + (embudo[0][1] ? n(c / embudo[0][1] * 100) + ' %' : '') + '</em></div>\n';
  }
  h += '</section>\n\n';
  if (semanas.length) {
    const mx = Math.max(...semanas.map((s) => Number(s.c)));
    h += '<section class="tarjeta">\n  <h2>Leads por semana</h2>\n  <div class="columnas" role="img" aria-label="Leads por semana">\n    ';
    for (const s of semanas) {
      h += '<div class="columnas__col" title="Semana del ' + e(fechaDMY(s.d)) + ': ' + Number(s.c) + ' leads"><b>' + Number(s.c) + '</b><i style="height:' + Math.max(3, phpRound(Number(s.c) / mx * 110)) + 'px"></i><span>' + e(fechaDMY(s.d, false)) + '</span></div>';
    }
    h += '\n  </div>\n</section>\n\n';
  }
  h += '<div class="rejilla rejilla--2">\n';
  for (const [titulo, filas] of datosBloques) {
    if (!filas.length) continue;
    const mx = Math.max(...filas.map((r) => Number(r.c)));
    h += '  <section class="tarjeta">\n    <h2>' + e(titulo) + '</h2>\n';
    for (const r of filas) {
      const k = String(nombres[r.k] ?? String(r.k ?? '')).replace(/^\d\. /, '');
      h += '      <div class="fila-barra fila-barra--chica"><span>' + e(k) + '</span><div class="fila-barra__pista"><i style="width:' + phpRound(Number(r.c) / mx * 100, 1) + '%"></i></div><b>' + n(r.c) + '</b></div>\n';
    }
    h += '  </section>\n';
  }
  h += '</div>\n';
  if (!embudo[0][1]) h += '<p class="vacio">No hay leads en este periodo.</p>';
  h += '\n' + pie();
  return html(ctx, h);
}

/* ---------------- Productos y precios ---------------- */
async function productos(ctx) {
  await exigirSesion(ctx);
  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const p = P(ctx);
    const accion = String(p.accion ?? '');
    if (accion === 'producto') {
      const id = int(p.id);
      const nombre = txt(p.nombre ?? '', 120);
      const precio = num(p.precio_kg ?? null);
      const rp = num(p.ratio_prod ?? null);
      const rc = num(p.ratio_cons ?? null);
      const usos = num(p.usos ?? null);
      const polvo = num(p.polvo_pct_arena ?? null);
      if (nombre === '' || precio === null || precio < 0 || rp === null || rp <= 0 || rc === null || rc <= 0 || usos === null || usos < 1) {
        mensajeFlash(ctx, 'Revise el producto: el nombre es obligatorio, el precio no puede ser negativo, la velocidad y el consumo relativos deben ser mayores que cero y los usos, 1 o más.', 'error');
      } else {
        const campos = [nombre, txt(p.tipo ?? '', 120), txt(p.marca ?? '', 80), precio, rp, rc, usos, vacioPhp(p.reutilizable) ? 0 : 1, polvo,
          txt(p.silice_libre ?? '', 60), txt(p.dureza ?? '', 60), txt(p.norma ?? '', 80), txt(p.origen ?? '', 160), txt(p.descripcion ?? '', 400),
          txt(p.fuente_rend ?? '', 900), txt(p.fuente_ficha ?? '', 400), vacioPhp(p.datos_comparativos) ? 0 : 1, vacioPhp(p.activo) ? 0 : 1];
        if (id > 0) {
          campos.push(id);
          await ctx.db.ejec('UPDATE productos SET nombre=?, tipo=?, marca=?, precio_kg=?, ratio_prod=?, ratio_cons=?, usos=?, reutilizable=?, polvo_pct_arena=?, silice_libre=?, dureza=?, norma=?, origen=?, descripcion=?, fuente_rend=?, fuente_ficha=?, datos_comparativos=?, activo=? WHERE id=?', campos);
          mensajeFlash(ctx, 'Producto «' + nombre + '» actualizado. Las simulaciones nuevas ya usan estos valores.');
        } else {
          campos.unshift('p' + tokenHex(4));
          await ctx.db.ejec('INSERT INTO productos (clave, nombre, tipo, marca, precio_kg, ratio_prod, ratio_cons, usos, reutilizable, polvo_pct_arena, silice_libre, dureza, norma, origen, descripcion, fuente_rend, fuente_ficha, datos_comparativos, activo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', campos);
          mensajeFlash(ctx, 'Producto «' + nombre + '» creado.');
        }
      }
    } else if (accion === 'matriz') {
      const m = p.m && typeof p.m === 'object' ? p.m : {};
      const sentencias = [];
      for (const s of Object.keys(SUPERFICIES)) {
        for (const es of Object.keys(ESPACIOS)) {
          const pid = int(m[s] && m[s][es]);
          if (pid > 0 && await producto(ctx, pid)) {
            sentencias.push(['INSERT INTO recomendacion (superficie, espacio, producto_id) VALUES (?,?,?) ON CONFLICT(superficie, espacio) DO UPDATE SET producto_id = excluded.producto_id', [s, es, pid]]);
          }
        }
      }
      if (sentencias.length) await ctx.db.lote(sentencias);
      mensajeFlash(ctx, 'Matriz de recomendación guardada.');
    }
    return ir(ctx, 'productos.php');
  }

  const lista = await ctx.db.todas('SELECT * FROM productos ORDER BY activo DESC, id');
  const matriz = {};
  for (const r of await ctx.db.todas('SELECT * FROM recomendacion')) {
    (matriz[r.superficie] = matriz[r.superficie] || {})[r.espacio] = Number(r.producto_id);
  }
  const nuevoP = { id: 0, nombre: '', tipo: '', marca: '', precio_kg: 0, ratio_prod: 1, ratio_cons: 1, usos: 1, reutilizable: 0, polvo_pct_arena: null, silice_libre: '', dureza: '', norma: '', origen: '', descripcion: '', fuente_rend: '', fuente_ficha: '', datos_comparativos: 0, activo: 1 };
  const abrir = Q(ctx).abrir;

  let h = await cabecera(ctx, 'Productos y precios', 'productos');
  h += '\n<p class="ayuda">Los precios son internos: el cliente nunca los ve. Cada cambio se aplica a las simulaciones nuevas; las ya guardadas conservan el precio con el que se calcularon. Para un precio especial de un solo cliente, use «Recalcular» en la ficha del lead.</p>\n\n'
    + '<section class="tarjeta">\n  <h2>Qué abrasivo se recomienda</h2>\n'
    + '  <p class="ayuda">El simulador elige el producto según la superficie y el espacio de trabajo. Los valores iniciales siguen la práctica general de la industria; ajústelos al criterio técnico de Fabcom.</p>\n'
    + '  <form method="post">\n    ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="matriz">\n'
    + '    <div class="tabla-caja"><table class="tabla">\n'
    + '      <thead><tr><th>Superficie</th>' + Object.values(ESPACIOS).map((t) => '<th>Espacio ' + e(t.toLowerCase()) + '</th>').join('') + '</tr></thead>\n      <tbody>\n';
  for (const [s, t] of Object.entries(SUPERFICIES)) {
    h += '        <tr><td>' + e(t) + '</td>\n';
    for (const [es, te] of Object.entries(ESPACIOS)) {
      h += '          <td><select name="m[' + s + '][' + es + ']" aria-label="' + e(t + ', espacio ' + te) + '">'
        + lista.filter((pr) => Number(pr.activo)).map((pr) => '<option value="' + Number(pr.id) + '" ' + sel(((matriz[s] || {})[es] ?? 0) === Number(pr.id)) + '>' + e(pr.nombre) + '</option>').join('')
        + '</select></td>\n';
    }
    h += '        </tr>\n';
  }
  h += '      </tbody>\n    </table></div>\n    <button class="btn btn--chico">Guardar matriz</button>\n  </form>\n</section>\n\n';

  for (const pr of [...lista, nuevoP]) {
    const pid = Number(pr.id);
    h += '<details class="tarjeta producto" ' + (abrir !== undefined && int(abrir) === pid ? 'open' : '') + '>\n  <summary>\n';
    if (pid) {
      h += '      <span class="producto__nombre">' + e(pr.nombre) + (Number(pr.activo) ? '' : ' <span class="estado estado--perdido">Inactivo</span>') + (Number(pr.datos_comparativos) ? '' : ' <span class="estado estado--contactado">Faltan datos comparativos</span>') + '</span>\n'
        + '      <span class="producto__precio">' + e(dinero(pr.precio_kg, 'COP')) + '/kg</span>\n'
        + '      <span class="tenue">Velocidad ×' + n(pr.ratio_prod, 2) + ' · consumo ×' + n(pr.ratio_cons, 2) + ' · ' + n(pr.usos) + ' ' + (Number(pr.usos) === 1 ? 'uso' : 'usos') + '</span>\n';
    } else {
      h += '<span class="producto__nombre">Agregar un producto</span>';
    }
    h += '  </summary>\n  <form method="post" class="formulario formulario--ancho">\n'
      + '    ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="producto"><input type="hidden" name="id" value="' + pid + '">\n'
      + '    <div class="rejilla rejilla--4">\n'
      + '      <label class="ancho-2"><span>Nombre comercial</span><input type="text" name="nombre" required maxlength="120" value="' + e(pr.nombre) + '"></label>\n'
      + '      <label><span>Tipo de abrasivo</span><input type="text" name="tipo" maxlength="120" value="' + e(pr.tipo) + '"></label>\n'
      + '      <label><span>Marca</span><input type="text" name="marca" maxlength="80" value="' + e(pr.marca) + '"></label>\n'
      + '      <label><span>Precio, COP por kg sin IVA</span><input type="text" inputmode="decimal" name="precio_kg" required value="' + e(decTxt(pr.precio_kg)) + '"></label>\n'
      + '      <label><span>Velocidad relativa</span><input type="text" inputmode="decimal" name="ratio_prod" required value="' + e(decTxt(pr.ratio_prod)) + '"><small>Arena = 1. Ej.: 1,68 limpia 68 % más m² por hora.</small></label>\n'
      + '      <label><span>Consumo relativo por pasada</span><input type="text" inputmode="decimal" name="ratio_cons" required value="' + e(decTxt(pr.ratio_cons)) + '"><small>Arena = 1. Ej.: 0,78 gasta 22 % menos kg por m².</small></label>\n'
      + '      <label><span>Número de usos</span><input type="text" inputmode="decimal" name="usos" required value="' + e(decTxt(pr.usos)) + '"><small>1 si no se reutiliza.</small></label>\n'
      + '      <label><span>Sílice libre (texto de ficha)</span><input type="text" name="silice_libre" maxlength="60" value="' + e(pr.silice_libre) + '" placeholder="Ej.: menos de 1 %"></label>\n'
      + '      <label><span>Dureza</span><input type="text" name="dureza" maxlength="60" value="' + e(pr.dureza) + '"></label>\n'
      + '      <label><span>Norma</span><input type="text" name="norma" maxlength="80" value="' + e(pr.norma) + '"></label>\n'
      + '      <label><span>Polvo frente a la arena, %</span><input type="text" inputmode="decimal" name="polvo_pct_arena" value="' + e(decTxt(pr.polvo_pct_arena)) + '"><small>Vacío si no hay dato. Ej.: 24.</small></label>\n'
      + '      <label class="ancho-2"><span>Origen</span><input type="text" name="origen" maxlength="160" value="' + e(pr.origen) + '"><small>Si empieza por «Subproducto», la conclusión lo presenta como economía circular.</small></label>\n'
      + '      <label class="ancho-2"><span>Descripción para el cliente</span><textarea name="descripcion" rows="2" maxlength="400">' + e(pr.descripcion) + '</textarea></label>\n'
      + '      <label class="ancho-2"><span>Fuente de la velocidad y el consumo</span><textarea name="fuente_rend" rows="3" maxlength="900">' + e(pr.fuente_rend) + '</textarea><small>Sale en el PDF del cliente. Cítela siempre.</small></label>\n'
      + '      <label class="ancho-2"><span>Fuente de la ficha y del precio</span><textarea name="fuente_ficha" rows="3" maxlength="400">' + e(pr.fuente_ficha) + '</textarea></label>\n'
      + '    </div>\n    <div class="casillas-fila">\n'
      + '      <label class="casilla"><input type="checkbox" name="reutilizable" ' + chk(Number(pr.reutilizable)) + '><span>Es reutilizable</span></label>\n'
      + '      <label class="casilla"><input type="checkbox" name="datos_comparativos" ' + chk(Number(pr.datos_comparativos)) + '><span>La velocidad y el consumo tienen una fuente verificable</span></label>\n'
      + '      <label class="casilla"><input type="checkbox" name="activo" ' + chk(Number(pr.activo)) + '><span>Activo</span></label>\n'
      + '    </div>\n    <button class="btn btn--chico">' + (pid ? 'Guardar producto' : 'Agregar producto') + '</button>\n  </form>\n</details>\n';
  }
  h += pie();
  return html(ctx, h);
}

/* ---------------- Parámetros ---------------- */
async function parametros(ctx) {
  await exigirSesion(ctx);
  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const p = P(ctx);
    if (String(p.accion ?? '') === 'parametros') {
      const v = p.v && typeof p.v === 'object' ? p.v : {};
      const fu = p.f && typeof p.f === 'object' ? p.f : {};
      const mal = [];
      const sentencias = [];
      for (const [k, par] of Object.entries(ctx.parametros())) {
        const val = num(v[k] ?? null);
        if (val === null || val < 0 || (['trm_usd', 'trm_eur', 'flujo_arena_kg_h', 'horas_dia', 'boquillas', 'gal_jornada'].includes(k) && val <= 0)) {
          mal.push(par.etiqueta);
          continue;
        }
        sentencias.push(['UPDATE parametros SET valor = ?, fuente = ? WHERE clave = ?', [val, txt(fu[k] ?? par.fuente, 900), k]]);
      }
      if (sentencias.length) await ctx.db.lote(sentencias);
      mensajeFlash(ctx, mal.length ? 'Se guardó todo menos estos valores, que no son válidos: ' + mal.join('; ') + '.' : 'Parámetros guardados.', mal.length ? 'error' : 'ok');
    } else if (String(p.accion ?? '') === 'rendimiento') {
      const r = p.r && typeof p.r === 'object' ? p.r : {};
      let ok = true;
      const sentencias = [];
      for (const g of Object.keys(GRADOS)) {
        for (const c of Object.keys(CORROSIONES)) {
          const val = num((r[g] || {})[c] ?? null);
          if (val !== null && val > 0) sentencias.push(['UPDATE rendimiento_arena SET m2h = ? WHERE grado = ? AND corrosion = ?', [val, g, c]]);
          else ok = false;
        }
      }
      if (sentencias.length) await ctx.db.lote(sentencias);
      await ctx.ajusteGuardar('fuente_rendimiento_arena', txt(p.fuente ?? '', 900));
      mensajeFlash(ctx, ok ? 'Tabla de rendimiento guardada.' : 'Algunos valores no eran números mayores que cero y se dejaron como estaban.', ok ? 'ok' : 'error');
    }
    return ir(ctx, 'parametros.php');
  }

  const grupos = {};
  for (const par of Object.values(ctx.parametros())) (grupos[par.grupo] = grupos[par.grupo] || []).push(par);
  const rend = {};
  for (const r of await ctx.db.todas('SELECT * FROM rendimiento_arena')) (rend[r.grado] = rend[r.grado] || {})[r.corrosion] = Number(r.m2h);

  let h = await cabecera(ctx, 'Parámetros del cálculo', 'parametros');
  h += '\n<p class="ayuda">Todo valor tiene una fuente. Si cambia un valor, actualice también su fuente: las fuentes de las bases técnicas se citan en el PDF del cliente. Los «costos por defecto del cliente» son los que el cliente ve prellenados y puede cambiar.</p>\n'
    + '<form method="post">\n  ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="parametros">\n';
  for (const [g, lista] of Object.entries(grupos)) {
    h += '  <section class="tarjeta">\n    <h2>' + e(g) + '</h2>\n    <div class="tabla-caja"><table class="tabla tabla--param">\n'
      + '      <thead><tr><th>Parámetro</th><th>Valor</th><th>Fuente</th></tr></thead>\n      <tbody>\n';
    for (const par of lista) {
      h += '        <tr>\n'
        + '          <td><label for="v-' + e(par.clave) + '">' + e(par.etiqueta) + '</label></td>\n'
        + '          <td class="nowrap"><input id="v-' + e(par.clave) + '" type="text" inputmode="decimal" name="v[' + e(par.clave) + ']" value="' + e(decTxt(par.valor)) + '" class="corto"> <span class="tenue">' + e(par.unidad) + '</span></td>\n'
        + '          <td><textarea name="f[' + e(par.clave) + ']" rows="2" maxlength="900" aria-label="Fuente de ' + e(par.etiqueta) + '">' + e(par.fuente) + '</textarea></td>\n'
        + '        </tr>\n';
    }
    h += '      </tbody>\n    </table></div>\n  </section>\n';
  }
  h += '  <button class="btn">Guardar parámetros</button>\n</form>\n\n'
    + '<section class="tarjeta">\n  <h2>Rendimiento base con arena sílice</h2>\n'
    + '  <p class="ayuda">Metros cuadrados por hora que limpia una boquilla con arena, según el grado de limpieza y el estado inicial de la superficie. Es el punto de partida: el rendimiento del abrasivo Fabcom sale de multiplicarlo por la «velocidad relativa» del producto. Si el cliente no indica grado o corrosión, se usa metal casi blanco y grado C.</p>\n'
    + '  <form method="post">\n    ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="rendimiento">\n'
    + '    <div class="tabla-caja"><table class="tabla">\n'
    + '      <thead><tr><th>Grado de limpieza</th>' + Object.keys(CORROSIONES).map((c) => '<th>Corrosión ' + c + ' (m²/h)</th>').join('') + '</tr></thead>\n      <tbody>\n';
  for (const [g, [nom, norma]] of Object.entries(GRADOS)) {
    h += '        <tr><td>' + e(nom) + '<br><span class="tenue">' + e(norma) + '</span></td>\n        '
      + Object.keys(CORROSIONES).map((c) => '<td><input type="text" inputmode="decimal" class="corto" name="r[' + g + '][' + c + ']" value="' + e(decTxt((rend[g] || {})[c] ?? 0)) + '" aria-label="' + e(nom + ', corrosión ' + c) + '"></td>').join('')
      + '</tr>\n';
  }
  h += '      </tbody>\n    </table></div>\n'
    + '    <div class="formulario formulario--ancho"><label><span>Fuente de la tabla</span><textarea name="fuente" rows="3" maxlength="900">' + e(ctx.ajuste('fuente_rendimiento_arena', '')) + '</textarea></label></div>\n'
    + '    <button class="btn btn--chico">Guardar tabla</button>\n  </form>\n</section>\n' + pie();
  return html(ctx, h);
}

/* ---------------- Ajustes ---------------- */
async function ajustes(ctx) {
  const yo = await exigirSesion(ctx);
  if (esPost(ctx)) {
    csrfVerificar(ctx);
    const p = P(ctx);
    const accion = String(p.accion ?? '');
    if (accion === 'general') {
      for (const [k, max] of Object.entries({ empresa_nombre: 120, empresa_direccion: 200, empresa_web: 120, empresa_telefono: 60, politica_datos_url: 250 })) {
        await ctx.ajusteGuardar(k, txt(p[k] ?? '', max));
      }
      await ctx.ajusteGuardar('whatsapp_numero', String(p.whatsapp_numero ?? '').replace(/\D+/g, ''));
      await ctx.ajusteGuardar('enviar_pdf_cliente', vacioPhp(p.enviar_pdf_cliente) ? '0' : '1');
      mensajeFlash(ctx, 'Ajustes guardados.');
    } else if (accion === 'correo') {
      for (const [k, max] of Object.entries({ correo_remitente: 160, correo_remitente_nombre: 120, smtp_host: 160, smtp_puerto: 6, smtp_usuario: 160 })) {
        await ctx.ajusteGuardar(k, txt(p[k] ?? '', max));
      }
      await ctx.ajusteGuardar('smtp_seguridad', ['tls', 'ssl', 'ninguna'].includes(p.smtp_seguridad) ? p.smtp_seguridad : 'tls');
      if (String(p.smtp_clave ?? '') !== '') await ctx.ajusteGuardar('smtp_clave', String(p.smtp_clave));
      mensajeFlash(ctx, 'Configuración de correo guardada. Envíe un correo de prueba para confirmarla.');
    } else if (accion === 'prueba') {
      const ok = await enviarCorreo(ctx, yo.email, yo.nombre, 'Correo de prueba del simulador Fabcom', plantillaCorreo(ctx, 'Correo de prueba', '<p style="margin:0">Si lee este mensaje, el envío de correos del simulador funciona.</p>'));
      if (ok) {
        mensajeFlash(ctx, 'Correo de prueba enviado a ' + yo.email + '. Revise también la carpeta de correo no deseado.');
      } else {
        const err = await ctx.db.valor('SELECT error FROM correos ORDER BY id DESC LIMIT 1');
        mensajeFlash(ctx, 'No se pudo enviar el correo de prueba. ' + (err || 'El servidor no informó el motivo.'), 'error');
      }
    }
    return ir(ctx, 'ajustes.php');
  }
  const ultimos = await ctx.db.todas('SELECT * FROM correos ORDER BY id DESC LIMIT 8');
  const a = (k, d = '') => e(ctx.ajuste(k, d));
  let h = await cabecera(ctx, 'Ajustes', 'ajustes');
  h += '\n<div class="rejilla rejilla--2 rejilla--arriba">\n<section class="tarjeta">\n  <h2>Empresa y contacto</h2>\n  <form method="post" class="formulario">\n'
    + '    ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="general">\n'
    + '    <label><span>Nombre de la empresa</span><input type="text" name="empresa_nombre" value="' + a('empresa_nombre') + '"></label>\n'
    + '    <label><span>Dirección</span><input type="text" name="empresa_direccion" value="' + a('empresa_direccion') + '"></label>\n'
    + '    <label><span>Sitio web</span><input type="text" name="empresa_web" value="' + a('empresa_web') + '" placeholder="www.ejemplo.com"></label>\n'
    + '    <label><span>Teléfono comercial</span><input type="text" name="empresa_telefono" value="' + a('empresa_telefono') + '"></label>\n'
    + '    <label><span>WhatsApp comercial</span><input type="text" name="whatsapp_numero" inputmode="numeric" value="' + a('whatsapp_numero') + '" placeholder="573001234567"><small>Con indicativo del país y sin signos. Mientras esté vacío, el botón de WhatsApp no aparece en el simulador.</small></label>\n'
    + '    <label><span>Enlace a la política de tratamiento de datos</span><input type="url" name="politica_datos_url" value="' + a('politica_datos_url') + '" placeholder="https://"><small>Se enlaza junto a la autorización del formulario (Ley 1581 de 2012).</small></label>\n'
    + '    <label class="casilla"><input type="checkbox" name="enviar_pdf_cliente" ' + chk(ctx.ajuste('enviar_pdf_cliente', '1') === '1') + '><span>Enviar el PDF al cliente automáticamente en su primera simulación</span></label>\n'
    + '    <button class="btn btn--chico">Guardar ajustes</button>\n  </form>\n</section>\n';
  h += '<section class="tarjeta">\n  <h2>Correo saliente</h2>\n'
    + '  <p class="ayuda">Los PDF y las alertas salen desde esta cuenta. Pida a quien administra el correo de Fabcom los datos SMTP de ' + a('correo_remitente') + '. En Vercel no hay correo propio del servidor: sin servidor SMTP no se envían el PDF ni las alertas.</p>\n'
    + '  <form method="post" class="formulario">\n    ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="correo">\n'
    + '    <label><span>Correo remitente</span><input type="email" name="correo_remitente" required value="' + a('correo_remitente') + '"></label>\n'
    + '    <label><span>Nombre del remitente</span><input type="text" name="correo_remitente_nombre" value="' + a('correo_remitente_nombre') + '"></label>\n'
    + '    <label><span>Servidor SMTP</span><input type="text" name="smtp_host" value="' + a('smtp_host') + '" placeholder="smtp.ejemplo.com"></label>\n'
    + '    <div class="rejilla rejilla--2">\n'
    + '      <label><span>Puerto</span><input type="text" name="smtp_puerto" inputmode="numeric" value="' + a('smtp_puerto', '587') + '"></label>\n'
    + '      <label><span>Seguridad</span><select name="smtp_seguridad">' + [['tls', 'STARTTLS (puerto 587)'], ['ssl', 'SSL (puerto 465)'], ['ninguna', 'Ninguna']].map(([k, t]) => '<option value="' + k + '" ' + sel(ctx.ajuste('smtp_seguridad', 'tls') === k) + '>' + t + '</option>').join('') + '</select></label>\n'
    + '    </div>\n'
    + '    <label><span>Usuario SMTP</span><input type="text" name="smtp_usuario" value="' + a('smtp_usuario') + '" autocomplete="off"></label>\n'
    + '    <label><span>Contraseña SMTP</span><input type="password" name="smtp_clave" autocomplete="new-password" placeholder="' + (ctx.ajuste('smtp_clave') ? 'Guardada. Escriba solo para cambiarla.' : '') + '"></label>\n'
    + '    <button class="btn btn--chico">Guardar correo</button>\n  </form>\n'
    + '  <form method="post" class="formulario">\n    ' + csrfCampo(ctx) + '<input type="hidden" name="accion" value="prueba">\n'
    + '    <button class="btn btn--plano btn--chico">Enviarme un correo de prueba</button>\n  </form>\n';
  if (ultimos.length) {
    h += '  <h3>Últimos envíos</h3>\n  <ul class="historial">\n    ' + ultimos.map(filaCorreo).join('') + '\n  </ul>\n';
  }
  h += '</section>\n</div>\n' + pie();
  return html(ctx, h);
}

module.exports = { index, salir, cuenta, usuarios, leads, exportar, lead, nueva, marketing, productos, parametros, ajustes };
