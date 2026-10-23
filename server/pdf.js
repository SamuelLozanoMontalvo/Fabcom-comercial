'use strict';
/**
 * Informe PDF para el cliente (app/pdf_report.php), con la identidad visual de Fabcom
 * (azul #193C6C, turquesa #58BEC5, tipografía Poppins). Solo usa el bloque "cliente":
 * nunca precios de Fabcom.
 *
 * Para conservar el mismo diseño, se usa una pequeña capa con las mismas operaciones de
 * FPDF (Cell, MultiCell, Rect, Line, Image) sobre pdfkit, en milímetros.
 */
const path = require('path');
const PDFDocument = require('pdfkit');
const { n, ucfirst, fechaLarga } = require('./util');

const REC = path.join(__dirname, 'recursos');
const K = 72 / 25.4; // puntos por milímetro

const AZUL = [25, 60, 108];
const TURQ = [88, 190, 197];
const TINTA = [26, 41, 64];
const GRIS = [96, 110, 128];
const LINEA = [221, 228, 236];
const ARENA = [194, 133, 47];
const SERIE = [67, 122, 188];

/** Capa mínima con la semántica de FPDF (unidades en mm, A4 vertical). */
class Hoja {
  constructor(info) {
    this.doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, info, font: path.join(REC, 'fonts', 'Poppins-Regular.ttf') });
    this.doc.registerFont('Poppins', path.join(REC, 'fonts', 'Poppins-Regular.ttf'));
    this.doc.registerFont('PoppinsB', path.join(REC, 'fonts', 'Poppins-SemiBold.ttf'));
    this.doc.registerFont('PoppinsBold', path.join(REC, 'fonts', 'Poppins-Bold.ttf'));
    this.w = 210;
    this.h = 297;
    this.lMargin = 16;
    this.tMargin = 16;
    this.rMargin = 16;
    this.cMargin = 1.000125; // FPDF: márgenes de 10 mm → cMargin = 1 mm
    this.trigger = this.h - 20;
    this.x = this.lMargin;
    this.y = this.tMargin;
    this.lasth = 0;
    this.page = 0;
    this.fuente = 'Poppins';
    this.tam = 9;
    this.textColor = [0, 0, 0];
    this.fillColor = [0, 0, 0];
    this.drawColor = [0, 0, 0];
    this.lineWidth = 0.567 / K;
    this.anchos = new Map();
    this.encabezado = null;
  }

  get fontSize() {
    return this.tam / K;
  }

  setFont(familia, estilo = '', tam = null) {
    this.fuente = familia === 'PoppinsBold' ? 'PoppinsBold' : (estilo === 'B' ? 'PoppinsB' : 'Poppins');
    if (tam !== null) this.tam = tam;
  }

  anchoTexto(s) {
    this.doc.font(this.fuente).fontSize(this.tam);
    return this.doc.widthOfString(s) / K;
  }

  anchoCar(c) {
    const clave = this.fuente + '|' + this.tam + '|' + c;
    let w = this.anchos.get(clave);
    if (w === undefined) {
      w = this.anchoTexto(c);
      this.anchos.set(clave, w);
    }
    return w;
  }

  addPage() {
    this.doc.addPage({ size: 'A4', margin: 0 });
    this.page += 1;
    this.x = this.lMargin;
    this.y = this.tMargin;
    if (this.encabezado) {
      this.enCabecera = true;
      this.encabezado(this);
      this.enCabecera = false;
    }
  }

  setXY(x, y) {
    this.setY(y);
    this.x = x;
  }
  setX(x) {
    this.x = x >= 0 ? x : this.w + x;
  }
  setY(y) {
    this.x = this.lMargin;
    this.y = y >= 0 ? y : this.h + y;
  }
  ln(h = null) {
    this.x = this.lMargin;
    this.y += h === null ? this.lasth : h;
  }

  rect(x, y, w, h, color) {
    this.doc.rect(x * K, y * K, w * K, h * K).fill(color);
  }

  line(x1, y1, x2, y2) {
    this.doc.save().moveTo(x1 * K, y1 * K).lineTo(x2 * K, y2 * K).lineWidth(this.lineWidth * K).strokeColor(this.drawColor).stroke().restore();
  }

  image(archivo, x, y, w) {
    this.doc.image(archivo, x * K, y * K, { width: w * K });
  }

  /** Cell de FPDF: texto alineado dentro de una celda de ancho w y alto h. */
  cell(w, h, texto = '', ln = 0, align = 'L', fill = null) {
    if (this.y + h > this.trigger && !this.enCabecera && !this.enPie) {
      const x = this.x;
      this.addPage();
      this.x = x;
    }
    if (w === 0) w = this.w - this.rMargin - this.x;
    if (fill) this.rect(this.x, this.y, w, h, fill);
    if (texto !== '') {
      const sw = this.anchoTexto(texto);
      let dx = this.cMargin;
      if (align === 'R') dx = w - this.cMargin - sw;
      else if (align === 'C') dx = (w - sw) / 2;
      const base = this.y + 0.5 * h + 0.3 * this.fontSize;
      this.doc.font(this.fuente).fontSize(this.tam).fillColor(this.textColor)
        .text(texto, (this.x + dx) * K, base * K, { lineBreak: false, baseline: 'alphabetic' });
    }
    this.lasth = h;
    if (ln > 0) {
      this.y += h;
      if (ln === 1) this.x = this.lMargin;
    } else {
      this.x += w;
    }
  }

  /** Corte de líneas idéntico al de MultiCell en FPDF. */
  lineas(w, texto) {
    if (w === 0) w = this.w - this.rMargin - this.x;
    const wmax = w - 2 * this.cMargin;
    const s = String(texto).replace(/\r/g, '');
    const car = Array.from(s);
    const out = [];
    let sep = -1;
    let i = 0;
    let j = 0;
    let l = 0;
    while (i < car.length) {
      const c = car[i];
      if (c === '\n') {
        out.push(car.slice(j, i).join(''));
        i++;
        sep = -1;
        j = i;
        l = 0;
        continue;
      }
      if (c === ' ') sep = i;
      l += this.anchoCar(c);
      if (l > wmax) {
        if (sep === -1) {
          if (i === j) i++;
          out.push(car.slice(j, i).join(''));
        } else {
          out.push(car.slice(j, sep).join(''));
          i = sep + 1;
        }
        sep = -1;
        j = i;
        l = 0;
      } else {
        i++;
      }
    }
    out.push(car.slice(j, i).join(''));
    return out;
  }

  nLineas(w, texto) {
    return this.lineas(w, texto).length;
  }

  multiCell(w, h, texto, align = 'L') {
    if (w === 0) w = this.w - this.rMargin - this.x;
    for (const linea of this.lineas(w, texto)) {
      this.cell(w, h, linea, 2, align);
    }
    this.x = this.lMargin;
  }
}

/** Sustituciones de caracteres que hacía la versión PHP antes de escribir en el PDF. */
function t(s) {
  const mapa = { '₂': '2', '≤': 'máx. ', '≥': 'mín. ', '−': '-', '’': "'", '“': '"', '”': '"' };
  return String(s ?? '').replace(/[₂≤≥−’“”]/g, (c) => mapa[c]);
}

function construir(ctx, lead, cli, fecha, asesor) {
  const empresa = ctx.ajuste('empresa_nombre', 'Fabcom S.A.S.');
  const pie = empresa + ' · ' + ctx.ajuste('empresa_direccion', '');
  const pdf = new Hoja({ Title: 'Comparativo de limpieza abrasiva - ' + lead.empresa, Author: empresa });

  pdf.encabezado = (p) => {
    if (p.page === 1) return;
    p.image(path.join(REC, 'img', 'logo-fabcom.png'), 16, 9, 26);
    p.drawColor = LINEA;
    p.lineWidth = 0.2;
    p.line(16, 18, 194, 18);
    p.setY(24);
  };

  const titulo = (s) => {
    if (pdf.y > 250) pdf.addPage();
    pdf.ln(3);
    pdf.setFont('Poppins', 'B', 12);
    pdf.textColor = AZUL;
    pdf.cell(0, 7, t(s), 1);
    const y = pdf.y;
    pdf.rect(16, y, 14, 0.9, TURQ);
    pdf.ln(3.5);
  };
  const parrafo = (s, size = 9, color = TINTA, lh = 4.6) => {
    pdf.setFont('Poppins', '', size);
    pdf.textColor = color;
    pdf.multiCell(0, lh, t(s));
  };
  const vineta = (s, size = 9) => {
    pdf.setFont('Poppins', '', size);
    pdf.textColor = TINTA;
    const x = pdf.x;
    let y = pdf.y;
    if (y > 272) {
      pdf.addPage();
      y = pdf.y;
    }
    pdf.rect(x + 0.6, y + 1.6, 1.5, 1.5, TURQ);
    pdf.setX(x + 5);
    pdf.multiCell(173, 4.6, t(s));
    pdf.ln(1.2);
  };

  pdf.addPage();

  /* ---- Portada: banda azul con logo ---- */
  pdf.rect(0, 0, 210, 52, AZUL);
  pdf.rect(0, 52, 210, 1.6, TURQ);
  pdf.image(path.join(REC, 'img', 'logo-fabcom-blanco.png'), 16, 11, 42);
  pdf.setXY(16, 27);
  pdf.setFont('PoppinsBold', '', 19);
  pdf.textColor = [255, 255, 255];
  pdf.cell(0, 9, t('Arena sílice frente a abrasivo libre de sílice'), 1);
  pdf.setX(16);
  pdf.setFont('Poppins', '', 10);
  pdf.textColor = [214, 232, 240];
  pdf.cell(0, 6, t('Comparativo estimado para ' + lead.empresa + ' · ' + fecha), 1);
  pdf.setY(59);

  /* ---- Datos del proyecto ---- */
  const pr = cli.proyecto;
  const datos = [
    ['Preparado para', lead.nombre + ' · ' + lead.empresa],
    ['Superficie', pr.superficie + ' · espacio ' + String(pr.espacio).toLowerCase()],
    ['Área', pr.area + ((pr.toneladas_arena ?? '') !== '' ? ', estimada con ' + pr.toneladas_arena : '')],
  ];
  const opc = [
    pr.grado !== '' ? 'limpieza ' + String(pr.grado).toLowerCase() : '',
    pr.corrosion !== '' ? 'corrosión grado ' + pr.corrosion : '',
    pr.perfil !== '' ? 'perfil de anclaje ' + pr.perfil : '',
  ].filter(Boolean);
  if (opc.length) datos.push(['Condiciones', ucfirst(opc.join(', '))]);
  for (const [k, v] of datos) {
    pdf.setFont('Poppins', '', 8.5);
    pdf.textColor = GRIS;
    pdf.cell(32, 5.6, t(k), 0);
    pdf.setFont('Poppins', 'B', 9);
    pdf.textColor = TINTA;
    pdf.cell(0, 5.6, t(v), 1);
  }

  /* ---- Producto recomendado ---- */
  const p = cli.producto;
  pdf.ln(4);
  const y0 = pdf.y;
  pdf.setFont('Poppins', '', 8.6);
  const desc = t(p.descripcion);
  const alto = 17 + (desc !== '' ? pdf.nLineas(166, desc) * 4.4 : 0);
  pdf.rect(16, y0, 178, alto, [238, 247, 248]);
  pdf.rect(16, y0, 1.6, alto, TURQ);
  pdf.setXY(22, y0 + 3.5);
  pdf.textColor = GRIS;
  pdf.cell(0, 4.5, t('Abrasivo recomendado para su proyecto'), 1);
  pdf.setX(22);
  pdf.setFont('PoppinsBold', '', 13);
  pdf.textColor = AZUL;
  pdf.cell(0, 7, t(p.nombre), 1);
  if (desc !== '') {
    pdf.setX(22);
    pdf.setFont('Poppins', '', 8.6);
    pdf.textColor = TINTA;
    pdf.multiCell(166, 4.4, desc);
  }
  pdf.setY(y0 + alto + 2);

  /* ---- Cuadro comparativo ---- */
  titulo('Cuadro comparativo');
  if (!cli.filas.length) {
    parrafo('Para este abrasivo aún no hay datos publicados que permitan compararlo en cifras con la arena sílice. Su asesor Fabcom le preparará el comparativo con resultados de prueba para su proyecto.');
  }
  const w = [70, 36, 42, 30];
  if (cli.filas.length) {
    pdf.setFont('Poppins', 'B', 8.2);
    pdf.textColor = [255, 255, 255];
    pdf.cell(w[0], 8, t('  Indicador'), 0, 'L', AZUL);
    pdf.cell(w[1], 8, t('Arena sílice'), 0, 'L', AZUL);
    pdf.cell(w[2], 8, t('Abrasivo Fabcom (aprox.)'), 0, 'L', AZUL);
    pdf.cell(w[3], 8, t('Diferencia'), 1, 'R', AZUL);
  }
  let i = 0;
  for (const f of cli.filas) {
    pdf.setFont('Poppins', '', 8.4);
    const et = t(f.etiqueta);
    const a = t(f.arena);
    const b = t(f.fabcom);
    const lin = Math.max(pdf.nLineas(w[0] - 2, et), pdf.nLineas(w[1], a), pdf.nLineas(w[2], b));
    const nota = f.nota !== '' ? t(f.nota) : '';
    pdf.setFont('Poppins', '', 7.2);
    const linNota = nota !== '' ? pdf.nLineas(176, nota) : 0;
    const h = lin * 4.4 + 3.4 + linNota * 3.6 + (linNota ? 1 : 0);
    if (pdf.y + h > 275) pdf.addPage();
    const y = pdf.y;
    if (i % 2 === 1) pdf.rect(16, y, 178, h, [246, 249, 251]);
    pdf.setFont('Poppins', '', 8.4);
    pdf.textColor = TINTA;
    pdf.setXY(18, y + 1.7);
    pdf.multiCell(w[0] - 2, 4.4, et);
    pdf.setXY(16 + w[0], y + 1.7);
    pdf.textColor = GRIS;
    pdf.multiCell(w[1], 4.4, a);
    pdf.setXY(16 + w[0] + w[1], y + 1.7);
    pdf.setFont('Poppins', 'B', 8.4);
    pdf.textColor = AZUL;
    pdf.multiCell(w[2], 4.4, b);
    if (f.pct !== null) {
      pdf.setXY(16 + w[0] + w[1] + w[2], y + 1.7);
      pdf.setFont('Poppins', 'B', 8.4);
      pdf.textColor = [30, 122, 74];
      const signo = f.pct > 0 ? '+' : '-';
      pdf.cell(w[3] - 2, 4.4, t(signo + n(Math.abs(f.pct)) + ' %'), 0, 'R');
    }
    if (nota !== '') {
      pdf.setXY(18, y + 1.7 + lin * 4.4 + 0.6);
      pdf.setFont('Poppins', '', 7.2);
      pdf.textColor = GRIS;
      pdf.multiCell(176, 3.6, nota);
    }
    pdf.setY(y + h);
    i++;
  }
  pdf.drawColor = LINEA;
  pdf.line(16, pdf.y, 194, pdf.y);
  pdf.ln(2);

  /* ---- Gráficos ---- */
  if (cli.graficos.length) {
    const filasG = Math.ceil(cli.graficos.length / 2);
    if (pdf.y + 13 + filasG * 27 > 279) pdf.addPage();
    titulo('El resultado en gráficos');
    const yBase = pdf.y;
    cli.graficos.forEach((g, k) => {
      const x = 16 + (k % 2) * 92;
      const y = yBase + Math.floor(k / 2) * 27;
      grafico(pdf, x, y, 86, g);
    });
    pdf.setY(yBase + filasG * 27);
  }

  /* ---- Conclusiones ---- */
  pdf.addPage();
  pdf.setFont('PoppinsBold', '', 15);
  pdf.textColor = AZUL;
  pdf.cell(0, 9, t('Conclusiones para su proyecto'), 1);
  pdf.ln(1);
  for (const [k, tit] of [['costo', 'Costo'], ['tecnico', 'Desempeño técnico'], ['sostenibilidad', 'Sostenibilidad y salud']]) {
    if (!cli.conclusion[k] || !cli.conclusion[k].length) continue;
    titulo(tit);
    for (const s of cli.conclusion[k]) vineta(s);
  }

  /* ---- Contacto ---- */
  pdf.ln(3);
  if (pdf.y > 235) pdf.addPage();
  const y = pdf.y;
  pdf.rect(16, y, 178, 24, AZUL);
  pdf.setXY(22, y + 4);
  pdf.setFont('Poppins', 'B', 11);
  pdf.textColor = [255, 255, 255];
  pdf.cell(0, 6, t('Pida su cotización o una visita técnica'), 1);
  pdf.setX(22);
  pdf.setFont('Poppins', '', 8.8);
  pdf.textColor = [214, 232, 240];
  const contacto = [];
  if (asesor) contacto.push('Su asesor: ' + asesor.nombre + ' · ' + asesor.email);
  if (ctx.ajuste('empresa_telefono')) contacto.push('Tel. ' + ctx.ajuste('empresa_telefono'));
  if (ctx.ajuste('empresa_web')) contacto.push(ctx.ajuste('empresa_web'));
  pdf.multiCell(166, 4.8, t((contacto.length ? contacto : [ctx.ajuste('correo_remitente', '')]).join('\n')));
  pdf.setY(y + 28);

  /* ---- Supuestos y fuentes ---- */
  titulo('Supuestos del cálculo');
  for (const s of cli.supuestos) vineta(s, 8.2);
  titulo('Fuentes');
  for (const s of cli.fuentes) vineta(s, 7.6);
  pdf.ln(2);
  parrafo('Este documento es una estimación con fines informativos. Se calcula con los datos que usted suministró y con referencias públicas; los resultados reales dependen del equipo, del operario y del estado de la superficie. No es una cotización ni una garantía de desempeño: la oferta comercial la entrega su asesor de ' + empresa + '.', 7.4, GRIS, 3.9);

  /* ---- Pie de página en todas las hojas ---- */
  const rango = pdf.doc.bufferedPageRange();
  for (let pg = 0; pg < rango.count; pg++) {
    pdf.doc.switchToPage(rango.start + pg);
    pdf.enPie = true;
    pdf.setY(-14);
    pdf.setFont('Poppins', '', 7);
    pdf.textColor = GRIS;
    pdf.cell(140, 5, t(pie), 0);
    pdf.cell(0, 5, t('Página ' + (pg + 1) + ' de ' + rango.count), 0, 'R');
    pdf.enPie = false;
  }
  return pdf.doc;
}

function grafico(pdf, x, y, w, g) {
  pdf.setXY(x, y);
  pdf.setFont('Poppins', 'B', 8.6);
  pdf.textColor = TINTA;
  pdf.cell(w - 20, 5, t(g.titulo), 0);
  pdf.setFont('Poppins', 'B', 8.6);
  pdf.textColor = [30, 122, 74];
  pdf.cell(20, 5, t((g.pct > 0 ? '+' : '-') + n(Math.abs(g.pct)) + ' %'), 1, 'R');
  pdf.setX(x);
  pdf.setFont('Poppins', '', 7);
  pdf.textColor = GRIS;
  pdf.cell(w, 3.6, t(Array.from(g.unidad).length > 2 ? ucfirst(g.unidad) : 'En ' + g.unidad), 1);
  const max = Math.max(g.arena, g.fabcom, 0.0001);
  const wBar = w - 44;
  const dec = (Number(g.arena) % 1 !== 0 || Number(g.fabcom) % 1 !== 0) ? 1 : 0;
  [['Arena sílice', g.arena, ARENA], ['Fabcom', g.fabcom, SERIE]].forEach(([lab, val, col], j) => {
    const yy = y + 9.6 + j * 7.2;
    pdf.setXY(x, yy);
    pdf.setFont('Poppins', '', 7.6);
    pdf.textColor = TINTA;
    pdf.cell(22, 5.6, t(lab), 0);
    const len = Math.max(0.8, wBar * val / max);
    pdf.rect(x + 22, yy + 0.3, len, 5, col);
    pdf.setXY(x + 22 + len + 1.5, yy);
    pdf.setFont('Poppins', 'B', 7.8);
    pdf.cell(20, 5.6, t(n(val, dec)), 0);
  });
}

/** Genera el PDF del cliente y lo devuelve como Buffer. */
async function generarPdf(ctx, lead, cliente, fechaSim) {
  let asesor = null;
  if (lead.asesor_id) {
    asesor = await ctx.db.una('SELECT nombre, email FROM usuarios WHERE id = ?', [lead.asesor_id]);
  }
  const doc = construir(ctx, lead, cliente, fechaLarga(fechaSim), asesor);
  return new Promise((resolve, reject) => {
    const partes = [];
    doc.on('data', (b) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { generarPdf };
