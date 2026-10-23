'use strict';
/**
 * Utilidades comunes: formato de números (es-CO), textos, fechas en hora de Bogotá
 * y constantes del simulador. Equivalen a las de app/bootstrap.php de la versión PHP.
 */

const APP_VERSION = '1.0.0';

const SUPERFICIES = {
  acero_carbono: 'Acero al carbón',
  acero_inoxidable: 'Acero inoxidable',
  aluminio: 'Aluminio',
  hierro: 'Hierro',
  vidrio: 'Vidrio',
  otro: 'Otro',
};
const ESPACIOS = { abierto: 'Abierto', cerrado: 'Cerrado' };
const GRADOS = {
  sp7: ['Brush-off', 'SSPC-SP 7 / NACE 4 / Sa 1'],
  sp6: ['Grado comercial', 'SSPC-SP 6 / NACE 3 / Sa 2'],
  sp10: ['Metal casi blanco', 'SSPC-SP 10 / NACE 2 / Sa 2½'],
  sp5: ['Metal blanco', 'SSPC-SP 5 / NACE 1 / Sa 3'],
};
const CORROSIONES = {
  A: 'Acero cubierto de cascarilla de laminación adherida, con poco o ningún óxido.',
  B: 'Acero que empieza a oxidarse y cuya cascarilla de laminación comienza a desprenderse.',
  C: 'La cascarilla se ha perdido por oxidación o puede rasparse; picaduras poco visibles.',
  D: 'La cascarilla se ha perdido por oxidación y hay picaduras considerables a simple vista.',
};
const SECTORES = ['Naval', 'Oil & gas', 'Metalmecánico', 'Construcción', 'Manufactura', 'Náutico', 'Estructuras', 'Tubería', 'Tanques', 'Mantenimiento', 'Industrial', 'Offshore', 'Otro'];
const AREAS_CARGO = ['Compras', 'Ingeniería / Proyectos', 'HSE / SST', 'Gerencia', 'Operaciones / Mantenimiento', 'Otro'];
const MONEDAS = { COP: 'Pesos colombianos (COP)', USD: 'Dólares (USD)', EUR: 'Euros (EUR)' };
const ESTADOS_LEAD = { nuevo: 'Nuevo', contactado: 'Contactado', cotizado: 'Cotizado', ganado: 'Ganado', perdido: 'Perdido' };

const tiene = (obj, k) => Object.prototype.hasOwnProperty.call(obj, String(k ?? ''));

/** HTML-escape, igual que htmlspecialchars con ENT_QUOTES. */
function e(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

/** Redondeo como PHP round(): mitades lejos de cero. */
function phpRound(v, dec = 0) {
  const f = Math.pow(10, dec);
  // Igual que PHP: se pre-redondea a 15 cifras significativas para absorber el error de coma flotante.
  const x = Number((Math.abs(Number(v)) * f).toPrecision(15));
  const r = Math.round(x) / f;
  return Number(v) < 0 ? -r : r;
}

/** number_format($v, $dec, ',', '.') */
function n(v, dec = 0) {
  const num = Number(v) || 0;
  const r = phpRound(Math.abs(num), dec);
  const partes = r.toFixed(dec).split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const s = partes.join(',');
  return num < 0 && r !== 0 ? '-' + s : s;
}

function nAuto(v) {
  const a = Math.abs(Number(v));
  const s = n(v, a >= 100 ? 0 : (a >= 10 ? 1 : 2));
  return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s;
}

function dinero(v, moneda = 'COP') {
  const dec = moneda === 'COP' ? 0 : 2;
  const sim = moneda === 'EUR' ? '€' : '$';
  return sim + ' ' + n(v, dec) + ' ' + moneda;
}

function cantidadAbrasivo(kg) {
  const sacos = Math.ceil(kg / 25);
  if (kg >= 1000) {
    return n(kg / 1000, kg >= 10000 ? 0 : 1) + ' t (' + n(sacos) + ' sacos de 25 kg)';
  }
  return n(kg) + ' kg (' + n(sacos) + ' sacos de 25 kg)';
}

function pesoTxt(kg) {
  return kg >= 1000 ? n(kg / 1000, kg >= 100000 ? 0 : 1) + ' t' : n(kg) + ' kg';
}

/** Texto limpio y recortado por caracteres (mb_substr). */
function txt(v, max = 200) {
  let s = String(v ?? '').trim();
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return Array.from(s).slice(0, max).join('');
}

function largo(s) {
  return Array.from(String(s ?? '')).length;
}

/** Número con coma o punto decimal; null si no es número. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/ /g, '').replace(/,/g, '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim())) return null;
  return parseFloat(s);
}

/** entero como (int) de PHP para valores de formulario. */
function int(v) {
  const x = parseInt(String(v ?? '0'), 10);
  return Number.isFinite(x) ? x : 0;
}

function vacio(v) {
  return v === undefined || v === null || v === '' || v === '0' || v === 0 || v === false;
}

function emailValido(s) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(String(s)) && String(s).length <= 254;
}

/** Como ucfirst/lcfirst de PHP: solo cambian letras ASCII (una «í» inicial queda igual). */
function ucfirst(s) {
  s = String(s);
  return /^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function lcfirst(s) {
  s = String(s);
  return /^[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/* ---------- Fechas: siempre hora de Bogotá (UTC-5, sin horario de verano) ---------- */
const OFFSET_BOGOTA_MS = -5 * 3600 * 1000;

function fechaBogota(ms = Date.now()) {
  return new Date(ms + OFFSET_BOGOTA_MS).toISOString().slice(0, 19).replace('T', ' ');
}
function ahora() {
  return fechaBogota();
}
function hoy() {
  return fechaBogota().slice(0, 10);
}
/** Convierte 'Y-m-d H:i:s' (hora Bogotá) a milisegundos UTC. */
function aMs(f) {
  if (!f) return NaN;
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - OFFSET_BOGOTA_MS;
}
function fechaCorta(f) {
  if (!f) return '';
  const ms = aMs(f);
  if (Number.isNaN(ms)) return String(f);
  const s = fechaBogota(ms);
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) + ' ' + s.slice(11, 16);
}
function fechaDMY(f, conAnio = true) {
  const ms = aMs(f);
  if (Number.isNaN(ms)) return String(f ?? '');
  const s = fechaBogota(ms);
  return s.slice(8, 10) + '/' + s.slice(5, 7) + (conAnio ? '/' + s.slice(0, 4) : '');
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fechaLarga(f) {
  let ms = aMs(f);
  if (Number.isNaN(ms)) ms = Date.now();
  const s = fechaBogota(ms);
  return parseInt(s.slice(8, 10), 10) + ' de ' + MESES[parseInt(s.slice(5, 7), 10) - 1] + ' de ' + s.slice(0, 4);
}

function tokenHex(bytes = 16) {
  return require('crypto').randomBytes(bytes).toString('hex');
}

/** Equivalente a iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE'). */
function ascii(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7F]/g, '');
}

module.exports = {
  APP_VERSION, SUPERFICIES, ESPACIOS, GRADOS, CORROSIONES, SECTORES, AREAS_CARGO, MONEDAS, ESTADOS_LEAD,
  tiene, e, phpRound, n, nAuto, dinero, cantidadAbrasivo, pesoTxt, txt, largo, num, int, vacio, emailValido,
  ucfirst, lcfirst, ahora, hoy, fechaBogota, aMs, fechaCorta, fechaDMY, fechaLarga, tokenHex, ascii,
};
