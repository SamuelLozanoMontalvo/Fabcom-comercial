'use strict';
/**
 * Base de datos: Turso (libSQL, compatible con SQLite).
 * En Vercel se conecta con TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.
 * En local, sin variables, usa el archivo datos/local.db.
 *
 * El esquema y los datos iniciales son los mismos de la versión PHP (app/db.php).
 */
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const { ahora, tokenHex, phpRound } = require('./util');

let cliente = null;
let instalado = null;

function conexion() {
  if (cliente) return cliente;
  let url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || '';
  if (!url) {
    if (process.env.VERCEL) {
      throw new Error('Falta la variable TURSO_DATABASE_URL. Configure la base de datos Turso en Vercel (ver LEEME.md).');
    }
    const dir = path.join(__dirname, '..', 'datos');
    fs.mkdirSync(dir, { recursive: true });
    url = 'file:' + path.join(dir, 'local.db');
  }
  cliente = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  return cliente;
}

function plano(rs) {
  return rs.rows.map((row) => {
    const o = {};
    rs.columns.forEach((c, i) => {
      const v = row[i];
      o[c] = typeof v === 'bigint' ? Number(v) : v;
    });
    return o;
  });
}

function limpiar(args) {
  return (args || []).map((a) => {
    if (a === undefined) return null;
    if (typeof a === 'boolean') return a ? 1 : 0;
    return a;
  });
}

async function todas(sql, args) {
  return plano(await conexion().execute({ sql, args: limpiar(args) }));
}
async function una(sql, args) {
  return (await todas(sql, args))[0] || null;
}
async function valor(sql, args) {
  const rs = await conexion().execute({ sql, args: limpiar(args) });
  if (!rs.rows.length) return null;
  const v = rs.rows[0][0];
  return typeof v === 'bigint' ? Number(v) : v;
}
async function ejec(sql, args) {
  const rs = await conexion().execute({ sql, args: limpiar(args) });
  return { id: rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : null, cambios: rs.rowsAffected };
}
async function lote(sentencias) {
  return conexion().batch(sentencias.map(([sql, args]) => ({ sql, args: limpiar(args) })), 'write');
}

const FUENTE_NIOSH = 'NIOSH / KTA-Tator, "Evaluation of Substitute Materials for Silica Sand in Abrasive Blasting" (contrato 200-95-2946), Fase 1 de laboratorio, promedios por tipo genérico, tabla 1.';
const FUENTE_GMA = 'GMA Garnet, tabla comparativa "Your Blasting Abrasive Matters" (valores generales de referencia del fabricante).';
const FUENTE_SIN_DATO = 'Sin dato comparativo publicado frente a arena sílice. Pendiente: ingresar resultado de prueba o caso real de Fabcom.';

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT,
  rol TEXT NOT NULL DEFAULT 'asesor',
  activo INTEGER NOT NULL DEFAULT 1,
  recibe_leads INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL,
  ultimo_acceso TEXT,
  calendario_url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS parametros (
  clave TEXT PRIMARY KEY,
  valor REAL NOT NULL,
  unidad TEXT NOT NULL DEFAULT '',
  etiqueta TEXT NOT NULL,
  grupo TEXT NOT NULL,
  fuente TEXT NOT NULL DEFAULT '',
  cliente INTEGER NOT NULL DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT '',
  marca TEXT NOT NULL DEFAULT '',
  precio_kg REAL NOT NULL DEFAULT 0,
  ratio_prod REAL NOT NULL DEFAULT 1,
  ratio_cons REAL NOT NULL DEFAULT 1,
  usos REAL NOT NULL DEFAULT 1,
  reutilizable INTEGER NOT NULL DEFAULT 0,
  polvo_pct_arena REAL,
  silice_libre TEXT NOT NULL DEFAULT '',
  dureza TEXT NOT NULL DEFAULT '',
  norma TEXT NOT NULL DEFAULT '',
  origen TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  fuente_rend TEXT NOT NULL DEFAULT '',
  fuente_ficha TEXT NOT NULL DEFAULT '',
  datos_comparativos INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS recomendacion (
  superficie TEXT NOT NULL,
  espacio TEXT NOT NULL,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  PRIMARY KEY (superficie, espacio)
);
CREATE TABLE IF NOT EXISTS rendimiento_arena (
  grado TEXT NOT NULL,
  corrosion TEXT NOT NULL,
  m2h REAL NOT NULL,
  PRIMARY KEY (grado, corrosion)
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  creado TEXT NOT NULL,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  empresa TEXT NOT NULL,
  telefono TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT '',
  area_cargo TEXT NOT NULL DEFAULT '',
  acepta_datos INTEGER NOT NULL DEFAULT 0,
  acepta_marketing INTEGER NOT NULL DEFAULT 0,
  asesor_id INTEGER REFERENCES usuarios(id),
  tipo_cliente TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'nuevo',
  origen TEXT NOT NULL DEFAULT 'web',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  dispositivo TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  visita_fecha TEXT NOT NULL DEFAULT '',
  visita_lugar TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE TABLE IF NOT EXISTS simulaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  creado TEXT NOT NULL,
  producto_id INTEGER,
  producto_nombre TEXT NOT NULL DEFAULT '',
  superficie TEXT NOT NULL DEFAULT '',
  espacio TEXT NOT NULL DEFAULT '',
  grado TEXT NOT NULL DEFAULT '',
  corrosion TEXT NOT NULL DEFAULT '',
  area_m2 REAL NOT NULL DEFAULT 0,
  moneda TEXT NOT NULL DEFAULT 'COP',
  kg_fabcom REAL NOT NULL DEFAULT 0,
  venta_potencial_cop REAL NOT NULL DEFAULT 0,
  dif_total_pct REAL,
  entrada TEXT NOT NULL,
  cliente TEXT NOT NULL,
  interno TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sim_lead ON simulaciones(lead_id);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  usuario_id INTEGER,
  creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ev_lead ON eventos(lead_id);
CREATE TABLE IF NOT EXISTS correos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  para TEXT NOT NULL,
  asunto TEXT NOT NULL,
  estado TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS limites (ip TEXT NOT NULL, accion TEXT NOT NULL, creado TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_limites ON limites(ip, accion, creado);
`;

function datosIniciales() {
  const f = ahora();
  const s = [];
  // Usuarios: el administrador define su contraseña en el primer ingreso.
  for (const [nombre, email, rol] of [
    ['Melissa Marimón', 'administrador@fabcomsas.com', 'admin'],
    ['Andrés Segrera', 'comercial@fabcomsas.com', 'asesor'],
    ['Jesús de las Aguas', 'comercial.2@fabcomsas.com', 'asesor'],
    ['Faruth Chadid', 'comercial.3@fabcomsas.com', 'asesor'],
  ]) {
    s.push(['INSERT INTO usuarios (nombre, email, rol, activo, recibe_leads, creado) VALUES (?,?,?,?,?,?)', [nombre, email, rol, 1, 1, f]]);
  }

  const ajustes = {
    empresa_nombre: 'Fabcom S.A.S.',
    empresa_direccion: 'Mamonal Km. 6, Cartagena de Indias, Colombia',
    empresa_web: '',
    empresa_telefono: '',
    whatsapp_numero: '',
    politica_datos_url: '',
    correo_remitente: 'administrador@fabcomsas.com',
    correo_remitente_nombre: 'Fabcom S.A.S.',
    smtp_host: '',
    smtp_puerto: '587',
    smtp_usuario: 'administrador@fabcomsas.com',
    smtp_clave: '',
    smtp_seguridad: 'tls',
    rotacion_ultimo: '0',
    enviar_pdf_cliente: '1',
    fuente_rendimiento_arena: 'Tabla de velocidades de limpieza basada en SSPC para boquilla n.º 7 a 90 psi (ft²/h convertidos a m²/h), publicada en "Blast Finishing – Blasting Technical Information" (mcfinishing.com). Correspondencia con ISO 8501-1: A = cascarilla adherida; B = cascarilla suelta; C y D = superficie picada (la tabla no distingue entre C y D).',
    // Clave para firmar las sesiones del CRM; se genera una sola vez al instalar.
    sesion_secreto: tokenHex(32),
  };
  for (const [k, v] of Object.entries(ajustes)) {
    s.push(['INSERT INTO ajustes (clave, valor) VALUES (?,?)', [k, v]]);
  }

  const smmlv = 1750905;
  const aux = 249095;
  const params = [
    ['precio_arena_kg', 350, 'COP/kg', 'Precio de la arena sílice', 'Costos por defecto del cliente', 'Referencia de mercado: arena de río/lavada en bulto de 40 kg, precio al público Homecenter Colombia, octubre de 2026 ($13.900–$14.900 por bulto). Ajustar al precio real de la zona.', 1, 10],
    ['costo_mo_hora', phpRound(2 * (smmlv + aux) / 182), 'COP/h', 'Costo de mano de obra (operario + ayudante)', 'Costos por defecto del cliente', 'Piso legal: 2 personas × (salario mínimo 2026 $1.750.905 + auxilio de transporte $249.095, Decretos 1469 y 1470 de 2025) ÷ 182 h/mes (jornada de 42 h semanales, Ley 2101 de 2021). No incluye prestaciones ni seguridad social: el cliente debe ajustarlo a su costo real.', 1, 20],
    ['gal_jornada', 52, 'gal/jornada', 'Consumo de diésel del compresor por jornada', 'Costos por defecto del cliente', 'Atlas Copco, hoja de referencia XAS 440 / XATS 400 JD T4F: 6,5 gal/h (24,5 L/h) al 100 % de carga, por una jornada de 8 horas = 52 gal. Es el consumo de un compresor (una boquilla).', 1, 30],
    ['precio_diesel_gal', 11256, 'COP/gal', 'Precio del diésel (ACPM)', 'Costos por defecto del cliente', 'Precio de referencia del ACPM en Cartagena, octubre de 2026: $11.256/gal (Ministerios de Minas y Energía y de Hacienda, publicado por Infobae el 1 de octubre de 2026).', 1, 40],
    ['horas_dia', 8, 'h', 'Horas efectivas de blasting por jornada', 'Costos por defecto del cliente', 'Supuesto operativo: una jornada de 8 horas. El cliente lo ajusta a su operación.', 1, 50],
    ['boquillas', 1, 'und', 'Boquillas (operarios) trabajando a la vez', 'Costos por defecto del cliente', 'Supuesto operativo: una boquilla. El cliente lo ajusta a su operación.', 1, 60],
    ['disposicion_ton', 0, 'COP/t', 'Costo de recolección y disposición del residuo', 'Costos por defecto del cliente', 'Dato propio del cliente. Por defecto 0: no se asume un costo si el cliente no lo declara.', 1, 80],
    ['flujo_arena_kg_h', 656.8, 'kg/h', 'Flujo de arena por boquilla n.º 7 (7/16") a 90 psi', 'Bases técnicas', 'Clemco Industries, tabla "Compressed Air and Abrasive Consumption": 1.448 lb/h con boquilla n.º 7 a 90 psi (240 cfm). Es la misma boquilla y presión de la tabla de rendimientos por grado de limpieza.', 0, 110],
    ['recargo_nocturno_pct', 35, '%', 'Recargo por trabajo nocturno', 'Bases técnicas', 'Código Sustantivo del Trabajo, art. 168: 35 % sobre la hora ordinaria. La jornada nocturna va de 7:00 p. m. a 6:00 a. m. desde el 25 de diciembre de 2025 (Ley 2466 de 2025, art. 10).', 0, 120],
    ['co2_kg_gal', 10.21, 'kg CO₂/gal', 'Emisión de CO₂ por galón de diésel', 'Bases técnicas', 'US EPA, GHG Emission Factors Hub (abril de 2022), tabla 2: diésel 10,21 kg CO₂ por galón.', 0, 130],
    ['silice_arena_min', 39, '%', 'Cuarzo en la arena sílice: mínimo medido', 'Bases técnicas', 'NIOSH / KTA-Tator, Fase 1, tabla 10: las arenas ensayadas contenían entre 39 % y 88 % de cuarzo.', 0, 140],
    ['silice_arena_max', 88, '%', 'Cuarzo en la arena sílice: máximo medido', 'Bases técnicas', 'NIOSH / KTA-Tator, Fase 1, tabla 10: las arenas ensayadas contenían entre 39 % y 88 % de cuarzo.', 0, 150],
    ['trm_usd', 3218.75, 'COP por USD', 'Tasa de cambio del dólar', 'Tasas de cambio', 'TRM oficial del 9 de octubre de 2026 (Portafolio). Actualizar periódicamente.', 0, 210],
    ['trm_eur', 3608.51, 'COP por EUR', 'Tasa de cambio del euro', 'Tasas de cambio', 'Cotización de referencia del 9 de octubre de 2026 (Portafolio). Actualizar periódicamente.', 0, 220],
  ];
  for (const r of params) {
    s.push(['INSERT INTO parametros (clave, valor, unidad, etiqueta, grupo, fuente, cliente, orden) VALUES (?,?,?,?,?,?,?,?)', r]);
  }

  // Rendimiento base con arena (tabla SSPC, boquilla n.º 7 a 90 psi, ft²/h → m²/h).
  const ft2 = { sp5: [140, 170, 85], sp10: [146, 180, 90], sp6: [270, 420, 200], sp7: [835, 840, 830] };
  for (const [g, v] of Object.entries(ft2)) {
    for (const [c, x] of [['A', v[0]], ['B', v[1]], ['C', v[2]], ['D', v[2]]]) {
      s.push(['INSERT INTO rendimiento_arena (grado, corrosion, m2h) VALUES (?,?,?)', [g, c, phpRound(x * 0.092903, 1)]]);
    }
  }

  const precio = 'Lista de precios Fabcom 2026, versión 02 (octubre de 2026), sin IVA, en bodega.';
  const r3 = (x) => phpRound(x, 3);
  const productos = [
    ['silicato_hierro', 'Silicato de hierro NAstra® / Abragrit', 'Escoria de cobre (silicato de hierro)', 'EP Power Grit',
      3179, r3(52 / 31), r3(17.82 / 13.43), 1, 0, null,
      'menos de 1 %', 'más de 7 Mohs', 'ISO 11126-3', 'Subproducto de la fundición de cobre, granulado con agua (Alemania y Bélgica)',
      'Grano anguloso, duro y denso (3,7 kg/dm³) que corta rápido. Apto para Sa 1 a Sa 3. Cloruros solubles por debajo de 0,0025 % y conductividad menor de 250 µS/cm.',
      FUENTE_NIOSH + ' Escoria de cobre: 52 ft²/h y 17,82 lb/ft²; arena sílice: 31 ft²/h y 13,43 lb/ft². Nota: en la Fase 2 de campo, con un solo producto por tipo, la escoria de cobre limpió 102 ft²/h frente a 127 ft²/h de la arena.',
      'Fichas técnicas NAstra® y Abragrit (EP Power Grit). ' + precio, 1, 1],
    ['silicato_aluminio', 'Silicato de aluminio Asilikos® NEW', 'Silicato de aluminio', 'EP Power Grit',
      3974, r3(34 / 31), r3(10.44 / 13.43), 1, 0, null,
      '1 % o menos', '7 Mohs o más', 'ISO 11126-4 e ISO 11126-11', 'Granulado de cámara de fusión y lava volcánica (Alemania y Países Bajos)',
      'Abrasivo mineral anguloso de baja densidad (2,4–3,0 kg/dm³), con cloruros solubles por debajo de 0,001 %. Sirve en chorro seco, húmedo y cabinas de succión.',
      FUENTE_NIOSH + ' Escoria de carbón (silicato de aluminio): 34 ft²/h y 10,44 lb/ft²; arena sílice: 31 ft²/h y 13,43 lb/ft².',
      'Ficha técnica Asilikos® NEW 01.2025 (EP Power Grit). ' + precio, 1, 1],
    ['granate', 'Granate GMA ClassicCut™', 'Granate almandino', 'GMA Garnet',
      4730, r3(44 / 31), r3(9.46 / 13.43), 1, 0, null,
      'menos de 0,1 %', '7,5–8 Mohs', '', 'Mineral natural (Australia)',
      'Mineral natural inerte, no ferroso, con cloruros de 10 a 25 ppm. No contamina con hierro el acero inoxidable ni el aluminio.',
      FUENTE_NIOSH + ' Granate: 44 ft²/h y 9,46 lb/ft²; arena sílice: 31 ft²/h y 13,43 lb/ft².',
      'Fichas GMA ClassicCut™ 80 y 120. ' + precio, 1, 1],
    ['granalla_acero', 'Granalla de acero Sinto', 'Granalla de acero angular o esférica', 'Sinto',
      6890, r3(35 / 31), r3(24.94 / 13.43), 25, 1, 24,
      'no contiene sílice libre', '40–61 HRC o más', 'SAE J444, J827 y J1993', 'Acero fabricado en Brasil',
      'Abrasivo metálico reutilizable. Requiere espacio cerrado con sistema de recuperación.',
      FUENTE_NIOSH + ' Granalla de acero: 35 ft²/h y 24,94 lb/ft² por pasada, con 25 usos (límite del ensayo; la Fase 2 de campo asumió 100 usos); arena sílice: 31 ft²/h y 13,43 lb/ft². Polvo: EPA AP-42, sección 13.2.6: la granalla angular emite cerca del 24 % del material particulado total de la arena.',
      'Información técnica Sinto. ' + precio, 1, 1],
    ['oxido_aluminio', 'Óxido de aluminio marrón Sinabuddy', 'Óxido de aluminio fundido', 'Sinabuddy',
      9800, 1, 0.3, 4, 1, null,
      '', '9 Mohs o más', 'GB / FEPA / JIS / ANSI', 'Fusión de bauxita en horno de arco eléctrico (China)',
      'Óxido de aluminio marrón muy duro y reutilizable (94,5 % Al₂O₃) para perfilar y preparar superficies antes de recubrir.',
      FUENTE_GMA + ' Consumo: óxido de aluminio 2–4 lb/ft² frente a 8–12 lb/ft² de la arena sílice; reutilizable 4 a 5 veces. No hay dato numérico de velocidad frente a la arena: se asume igual.',
      'Ficha técnica Sinabuddy, óxido de aluminio marrón (BFA). Referencia F-16. ' + precio, 1, 1],
    ['oxido_aluminio_elfusa', 'Óxido de aluminio marrón Elfusa', 'Óxido de aluminio fundido', 'Elfusa',
      11200, 1, 0.3, 4, 1, null,
      '', '', 'FEPA / ANSI', 'Fusión reductora de bauxita en horno de arco eléctrico (Brasil)',
      'Óxido de aluminio marrón reutilizable (95,5 % Al₂O₃) para perfilar y preparar superficies antes de recubrir.',
      FUENTE_GMA + ' Consumo: óxido de aluminio 2–4 lb/ft² frente a 8–12 lb/ft² de la arena sílice; reutilizable 4 a 5 veces. No hay dato numérico de velocidad frente a la arena: se asume igual.',
      'Ficha técnica Elfusa BTRC (FP-4160-315). Referencias F-16, F-24, F-36 y F-60. ' + precio, 1, 1],
    ['microesfera_vidrio', 'Microesfera de vidrio', 'Microesfera de vidrio', 'Sinabuddy',
      7920, 1, 1, 1, 1, null,
      '', '', '', '',
      'Abrasivo esférico reutilizable para limpieza y acabado sin perfilar.',
      FUENTE_SIN_DATO,
      'Sin ficha técnica cargada. ' + precio, 0, 1],
    ['pyroblast', 'PyroBlast (piroxeno)', 'Piroxeno', 'GMA Garnet',
      3300, 1, 1, 1, 0, null,
      'menos de 0,5 %', '6–7 Mohs', '', 'Mineral natural procesado en EE. UU.',
      'Mineral natural inerte, no higroscópico, con cloruros por debajo de 3 ppm.',
      FUENTE_SIN_DATO,
      'Ficha GMA PyroBlast (2023-08). Precio informado por Fabcom el 23 de octubre de 2026: $3.300/kg sin IVA.', 0, 1],
  ];
  // Los id se asignan en orden de inserción (1, 2, 3...), así que la matriz los referencia por posición.
  const ids = {};
  productos.forEach((p, i) => {
    ids[p[0]] = i + 1;
    s.push(['INSERT INTO productos (id, clave, nombre, tipo, marca, precio_kg, ratio_prod, ratio_cons, usos, reutilizable, polvo_pct_arena, silice_libre, dureza, norma, origen, descripcion, fuente_rend, fuente_ficha, datos_comparativos, activo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [i + 1, ...p]]);
  });

  const matriz = {
    acero_carbono: ['silicato_hierro', 'granalla_acero'],
    hierro: ['silicato_hierro', 'granalla_acero'],
    acero_inoxidable: ['granate', 'oxido_aluminio'],
    aluminio: ['granate', 'microesfera_vidrio'],
    vidrio: ['oxido_aluminio', 'oxido_aluminio'],
    otro: ['silicato_aluminio', 'oxido_aluminio'],
  };
  for (const [sup, [ab, ce]] of Object.entries(matriz)) {
    s.push(['INSERT INTO recomendacion (superficie, espacio, producto_id) VALUES (?,?,?)', [sup, 'abierto', ids[ab]]]);
    s.push(['INSERT INTO recomendacion (superficie, espacio, producto_id) VALUES (?,?,?)', [sup, 'cerrado', ids[ce]]]);
  }
  s.push(["INSERT INTO ajustes (clave, valor) VALUES ('esquema_version', '1')", []]);
  return s;
}

/** Crea las tablas y los datos iniciales la primera vez. Se ejecuta una vez por instancia. */
function asegurarInstalacion() {
  if (!instalado) {
    instalado = (async () => {
      const c = conexion();
      let version = null;
      try {
        version = await valor("SELECT valor FROM ajustes WHERE clave = 'esquema_version'");
      } catch (err) {
        version = null;
      }
      if (version) return;
      await c.executeMultiple(ESQUEMA);
      try {
        await lote(datosIniciales());
      } catch (err) {
        // Otra instancia pudo instalar al mismo tiempo: si la versión ya existe, todo está bien.
        const v = await valor("SELECT valor FROM ajustes WHERE clave = 'esquema_version'");
        if (!v) throw err;
      }
    })().catch((err) => {
      instalado = null;
      throw err;
    });
  }
  return instalado;
}

module.exports = { conexion, todas, una, valor, ejec, lote, asegurarInstalacion };
