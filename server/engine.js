'use strict';
/**
 * Motor de simulación: arena sílice frente al abrasivo Fabcom recomendado.
 * Traducción directa de app/engine.php; los resultados son los mismos.
 *
 * Devuelve tres bloques:
 *   entrada  → datos normalizados del proyecto
 *   cliente  → lo único que ve el cliente: porcentajes, tiempos, residuos, CO₂. Nunca precios de Fabcom.
 *   interno  → cifras completas para el asesor (precios, costos, precio de equilibrio).
 */
const U = require('./util');
const { SUPERFICIES, ESPACIOS, GRADOS, CORROSIONES, MONEDAS, tiene, n, nAuto, dinero, pesoTxt, cantidadAbrasivo, txt, num, phpRound, ucfirst, lcfirst } = U;

const CLAVES_COSTO_CLIENTE = ['precio_arena_kg', 'costo_mo_hora', 'gal_jornada', 'precio_diesel_gal', 'horas_dia', 'boquillas', 'disposicion_ton'];
const CLAVES_EN_DINERO = ['precio_arena_kg', 'costo_mo_hora', 'precio_diesel_gal', 'disposicion_ton'];

function tasaMoneda(ctx, moneda) {
  if (moneda === 'USD') return Math.max(ctx.parametro('trm_usd'), 0.0001);
  if (moneda === 'EUR') return Math.max(ctx.parametro('trm_eur'), 0.0001);
  return 1.0;
}

/** Valores por defecto de los costos del cliente, en la moneda elegida. */
function costosPorDefecto(ctx, moneda) {
  const t = tasaMoneda(ctx, moneda);
  const out = {};
  for (const k of CLAVES_COSTO_CLIENTE) {
    let v = ctx.parametro(k);
    if (CLAVES_EN_DINERO.includes(k)) {
      v = v / t;
      v = moneda === 'COP' ? phpRound(v) : phpRound(v, 3);
    }
    out[k] = v;
  }
  return out;
}

function normalizarEntrada(ctx, inp) {
  inp = inp || {};
  const sup = tiene(SUPERFICIES, inp.superficie) ? String(inp.superficie) : '';
  const esp = tiene(ESPACIOS, inp.espacio) ? String(inp.espacio) : '';
  const grado = tiene(GRADOS, inp.grado) ? String(inp.grado) : '';
  const corr = tiene(CORROSIONES, inp.corrosion) ? String(inp.corrosion) : '';
  const moneda = tiene(MONEDAS, inp.moneda) ? String(inp.moneda) : 'COP';
  let area = num(inp.area_m2);
  const perfil = num(inp.perfil_valor);
  const unidad = inp.perfil_unidad === 'micrones' ? 'micrones' : 'mils';

  const errores = [];
  if (sup === '') errores.push('Elija el tipo de superficie.');
  if (esp === '') errores.push('Indique si el espacio es abierto o cerrado.');
  const porToneladas = inp.dato_area === 'toneladas';
  const ton = num(inp.toneladas_arena);
  if (porToneladas) {
    area = null;
    if (ton === null || ton <= 0) {
      errores.push('Escriba las toneladas de arena que consume el proyecto (un número mayor que cero).');
    } else if (ton > 1000000) {
      errores.push('La cantidad de arena es demasiado grande. Revise el valor.');
    }
  } else if (area === null || area <= 0) {
    errores.push('Escriba el área en m² (un número mayor que cero), o elija «Toneladas de arena» si no conoce el área.');
  } else if (area > 5000000) {
    errores.push('El área es demasiado grande. Revise el valor.');
  }

  const def = costosPorDefecto(ctx, moneda);
  const costos = {};
  const personalizados = [];
  const src = inp.costos && typeof inp.costos === 'object' && !Array.isArray(inp.costos) ? inp.costos : {};
  for (const k of CLAVES_COSTO_CLIENTE) {
    const v = num(src[k]);
    if (v === null || v < 0) {
      costos[k] = def[k];
    } else {
      costos[k] = v;
      if (Math.abs(v - def[k]) > 1e-9) personalizados.push(k);
    }
  }
  costos.boquillas = Math.max(1, Math.min(50, Math.trunc(phpRound(costos.boquillas))));
  costos.horas_dia = Math.max(1, Math.min(24, costos.horas_dia));

  const nocturno = !U.vacio(inp.nocturno);
  return {
    errores,
    superficie: sup,
    superficie_otro: sup === 'otro' ? txt(inp.superficie_otro, 80) : '',
    espacio: esp,
    area_m2: area ?? 0.0,
    toneladas_arena: porToneladas ? Number(ton) : null,
    grado,
    corrosion: corr,
    perfil_valor: perfil !== null && perfil > 0 ? perfil : null,
    perfil_unidad: unidad,
    moneda,
    nocturno,
    costos,
    costos_personalizados: personalizados,
  };
}

function pctCambio(a, f) {
  return a > 0 ? (f - a) / a * 100 : null;
}

function jornadasTxt(horas, horasDia) {
  const j = horas / horasDia;
  return nAuto(horas) + ' h (' + n(j, j >= 10 ? 0 : 1) + (j >= 1.05 || j < 0.95 ? ' jornadas' : ' jornada') + ')';
}

async function producto(ctx, id) {
  return ctx.db.una('SELECT * FROM productos WHERE id = ?', [id]);
}

async function productoRecomendado(ctx, superficie, espacio) {
  const p = await ctx.db.una('SELECT p.* FROM recomendacion r JOIN productos p ON p.id = r.producto_id WHERE r.superficie = ? AND r.espacio = ?', [superficie, espacio]);
  if (p && Number(p.activo) === 1) return p;
  return ctx.db.una('SELECT * FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
}

/**
 * @param e        entrada normalizada (sin errores)
 * @param prodForz producto elegido por el asesor; si es null se usa la matriz de recomendación
 * @param precioKg precio COP/kg para esta simulación; si es null se usa el del producto
 */
async function simular(ctx, entrada, prodForz = null, precioKg = null) {
  const e = { ...entrada };
  const p = prodForz || await productoRecomendado(ctx, e.superficie, e.espacio);
  if (!p) throw new Error('No hay productos activos configurados.');
  const moneda = e.moneda;
  const tasa = tasaMoneda(ctx, moneda);
  const c = e.costos;
  const P = (k) => ctx.parametro(k);

  const grado = e.grado !== '' ? e.grado : 'sp10';
  const corr = e.corrosion !== '' ? e.corrosion : 'C';
  const prodA = Number(await ctx.db.valor('SELECT m2h FROM rendimiento_arena WHERE grado = ? AND corrosion = ?', [grado, corr])) || 0;
  if (prodA <= 0) throw new Error('Falta el rendimiento base de la arena para ' + grado + ' / ' + corr + '.');

  const nb = c.boquillas;
  const hDia = c.horas_dia;
  const flujo = P('flujo_arena_kg_h');
  const consAbase = flujo / prodA;
  // Si el cliente dio toneladas de arena en vez de m², el área se estima con el consumo de arena por m².
  const area = e.toneladas_arena !== null ? e.toneladas_arena * 1000 / consAbase : e.area_m2;
  e.area_m2 = phpRound(area, 1);

  /* ----- Escenario arena sílice ----- */
  const consA = P('flujo_arena_kg_h') / prodA;
  const areaA = area;
  const horasA = areaA / (prodA * nb);
  const kgA = areaA * consA;

  /* ----- Escenario Fabcom ----- */
  const prodF = prodA * Number(p.ratio_prod);
  const usos = Math.max(1.0, Number(p.usos));
  const consPasadaF = consA * Number(p.ratio_cons);
  const consF = consPasadaF / usos;
  const horasF = area / (prodF * nb);
  const kgF = area * consF;

  const recargo = e.nocturno ? 1 + P('recargo_nocturno_pct') / 100 : 1.0;
  const precioCop = precioKg ?? Number(p.precio_kg);
  const precioF = precioCop / tasa;

  const costo = (horas, kg, precioAbr) => {
    const gal = horas * nb * c.gal_jornada / c.horas_dia;
    const r = {
      abrasivo: kg * precioAbr,
      mano_obra: horas * nb * c.costo_mo_hora * recargo,
      combustible: gal * c.precio_diesel_gal,
      disposicion: kg / 1000 * c.disposicion_ton,
    };
    r.operacion = r.mano_obra + r.combustible + r.disposicion;
    r.total = r.operacion + r.abrasivo;
    r.galones = gal;
    return r;
  };
  const cA = costo(horasA, kgA, c.precio_arena_kg);
  const cF = costo(horasF, kgF, precioF);

  const co2 = P('co2_kg_gal');
  const co2A = cA.galones * co2;
  const co2F = cF.galones * co2;

  const silA = n(P('silice_arena_min')) + '–' + n(P('silice_arena_max')) + ' %';
  const silAtxt = n(P('silice_arena_min')) + ' % y ' + n(P('silice_arena_max')) + ' %';

  /* ----- Filas comparativas (todas; se marca cuáles son favorables) ----- */
  const filas = {};
  const add = (clave, etiqueta, txtA, txtF, a, f, sentido, nota = '') => {
    const pct = a !== null && f !== null ? pctCambio(a, f) : null;
    const fav = pct === null ? true : (sentido === 'mayor' ? pct > 0.5 : pct < -0.5);
    filas[clave] = { clave, etiqueta, arena: txtA, fabcom: txtF, pct, sentido, favorable: fav, nota };
  };
  add('rendimiento', 'Velocidad de limpieza por boquilla', nAuto(prodA) + ' m²/h', nAuto(prodF) + ' m²/h', prodA, prodF, 'mayor');
  add('duracion', 'Duración del blasting', jornadasTxt(horasA, hDia), jornadasTxt(horasF, hDia), horasA, horasF, 'menor');
  add('combustible', 'Diésel del compresor', n(cA.galones) + ' gal', n(cF.galones) + ' gal', cA.galones, cF.galones, 'menor');
  add('co2', 'CO₂ emitido por el compresor', pesoTxt(co2A), pesoTxt(co2F), co2A, co2F, 'menor');
  add('abrasivo', 'Abrasivo consumido y residuo por disponer', pesoTxt(kgA), pesoTxt(kgF), kgA, kgF, 'menor',
    usos > 1 ? 'Con ' + n(usos) + ' usos del abrasivo mediante sistema de recuperación.' : '');
  if (p.polvo_pct_arena !== null && p.polvo_pct_arena !== '' && p.polvo_pct_arena !== undefined) {
    const idx = Number(p.polvo_pct_arena) * Number(p.ratio_cons) * (area / areaA);
    add('polvo', 'Polvo total emitido (arena = 100)', '100', n(idx), 100.0, idx, 'menor');
  }
  if (p.silice_libre !== '') {
    filas.silice = { clave: 'silice', etiqueta: 'Sílice cristalina libre en el abrasivo', arena: silA, fabcom: p.silice_libre, pct: null, sentido: 'menor', favorable: true, nota: '' };
  }
  add('costo_operacion', 'Costo de operación: mano de obra, combustible y disposición', dinero(cA.operacion, moneda), dinero(cF.operacion, moneda), cA.operacion, cF.operacion, 'menor');
  add('costo_total', 'Costo total del blasting, con abrasivo', dinero(cA.total, moneda), dinero(cF.total, moneda), cA.total, cF.total, 'menor');

  const favTotal = filas.costo_total.favorable;
  const favOper = filas.costo_operacion.favorable;

  /* ----- Vista del cliente: solo filas favorables y dinero de Fabcom como porcentaje ----- */
  const filasCliente = [];
  for (const [k, orig] of Object.entries(filas)) {
    if (!orig.favorable) continue;
    const f = { ...orig };
    if (k === 'costo_total' || k === 'costo_operacion') {
      if (k === 'costo_operacion' && favTotal) continue;
      f.fabcom = n(Math.abs(Number(f.pct))) + ' % menos';
      if (k === 'costo_operacion') f.nota = 'No incluye el valor del abrasivo: se cotiza según el volumen y las condiciones del proyecto.';
    }
    if (k !== 'silice') f.fabcom += ' aprox.';
    f.pct = f.pct === null ? null : phpRound(f.pct);
    delete f.favorable;
    filasCliente.push(f);
  }

  const graficos = [];
  const g = (clave, titulo, unidad, a, f, dec = 0) => {
    if (filas[clave] && filas[clave].favorable) {
      graficos.push({ clave, titulo, unidad, arena: phpRound(a, dec), fabcom: phpRound(f, dec), pct: phpRound(Number(filas[clave].pct)) });
    }
  };
  g('duracion', 'Duración del blasting', 'jornadas', horasA / hDia, horasF / hDia, 1);
  if (favTotal) {
    g('costo_total', 'Costo total del blasting', 'índice, arena = 100', 100, 100 + Number(filas.costo_total.pct));
  } else if (favOper) {
    g('costo_operacion', 'Costo de operación, sin abrasivo', 'índice, arena = 100', 100, 100 + Number(filas.costo_operacion.pct));
  }
  g('co2', 'CO₂ del compresor', co2A >= 1000 ? 't' : 'kg', co2A >= 1000 ? co2A / 1000 : co2A, co2A >= 1000 ? co2F / 1000 : co2F, co2A >= 1000 ? 1 : 0);
  g('abrasivo', 'Abrasivo consumido y residuo', kgA >= 1000 ? 't' : 'kg', kgA >= 1000 ? kgA / 1000 : kgA, kgA >= 1000 ? kgF / 1000 : kgF, kgA >= 1000 ? 1 : 0);

  /* ----- Conclusiones en tres ejes ----- */
  const nombre = p.nombre;
  const absPct = (k) => n(Math.abs(Number(filas[k] ? filas[k].pct ?? 0 : 0)));
  const costoTxt = [];
  if (favTotal) {
    costoTxt.push(`Con ${nombre}, el costo total estimado del blasting baja ${absPct('costo_total')} % frente a la arena sílice, contando abrasivo, mano de obra, combustible y disposición.`);
  } else if (favOper) {
    costoTxt.push(`El trabajo termina en ${absPct('duracion')} % menos tiempo, y por eso el costo de operación (mano de obra, combustible y disposición) baja ${absPct('costo_operacion')} %.`);
    costoTxt.push('El valor del abrasivo depende del volumen y de las condiciones del proyecto: su asesor Fabcom se lo cotiza.');
  } else {
    costoTxt.push('Su asesor Fabcom revisará con usted el costo según el volumen y las condiciones del proyecto.');
  }
  if (e.nocturno && filas.duracion.favorable) {
    costoTxt.push('Como el trabajo es nocturno, cada hora que se ahorra evita también el recargo del ' + n(P('recargo_nocturno_pct')) + ' %: son ' + nAuto(horasA - horasF) + ' horas nocturnas menos por boquilla.');
  }
  if (Number(p.reutilizable) === 1 && usos > 1) {
    costoTxt.push('El abrasivo es reutilizable: el cálculo considera ' + n(usos) + ' usos con sistema de recuperación.');
  } else if (Number(p.reutilizable) === 0) {
    costoTxt.push('Reutilizar el abrasivo puede ser posible según las condiciones de su proceso; su asesor lo evaluará con usted.');
  }

  const tecTxt = [];
  if (filas.rendimiento.favorable) {
    tecTxt.push(`Limpia ${absPct('rendimiento')} % más área por hora que la arena sílice: ` + nAuto(prodF) + ' m²/h por boquilla frente a ' + nAuto(prodA) + ' m²/h.');
    tecTxt.push('El blasting pasa de ' + jornadasTxt(horasA, hDia) + ' a ' + jornadasTxt(horasF, hDia) + '.');
  }
  const ficha = [];
  if (p.dureza !== '') ficha.push('dureza de ' + p.dureza);
  if (p.norma !== '') ficha.push('fabricado según ' + p.norma);
  if (ficha.length) tecTxt.push(ucfirst(ficha.join(' y ')) + '.');
  if (p.descripcion !== '') tecTxt.push(p.descripcion);
  if (e.perfil_valor !== null) {
    tecTxt.push('Para el perfil de anclaje de ' + nAuto(e.perfil_valor) + ' ' + e.perfil_unidad + ' que indicó, su asesor confirmará la granulometría adecuada.');
  }

  const sosTxt = [];
  if (p.silice_libre !== '') {
    sosTxt.push((p.silice_libre.toLowerCase().indexOf('no contiene') === 0 ? 'El abrasivo ' + p.silice_libre : `El abrasivo tiene ${p.silice_libre} de sílice cristalina libre`) + `; las arenas sílice ensayadas por NIOSH contenían entre ${silAtxt} de cuarzo.`);
  }
  sosTxt.push('La sílice cristalina respirable está clasificada como cancerígena para humanos (IARC, grupo 1) y causa silicosis, una enfermedad pulmonar irreversible. NIOSH recomienda desde 1974 no usar arena sílice en limpieza abrasiva.');
  sosTxt.push('En Colombia, la Resolución 2467 de 2022 del Ministerio del Trabajo incluye la limpieza con chorro de arena entre las actividades que deben tener un programa de control de sílice: mediciones, vigilancia médica y protección respiratoria.');
  if (filas.co2.favorable) {
    sosTxt.push('Al terminar antes, el compresor quema ' + n(cA.galones - cF.galones) + ' galones menos de diésel y deja de emitir ' + pesoTxt(co2A - co2F) + ` de CO₂ (${absPct('co2')} % menos).`);
  }
  if (filas.abrasivo.favorable) {
    sosTxt.push('Genera ' + pesoTxt(kgA - kgF) + ` menos de residuo por recoger y disponer (${absPct('abrasivo')} % menos).`);
  }
  if (filas.polvo && filas.polvo.favorable) {
    sosTxt.push(`Emite cerca de ${absPct('polvo')} % menos polvo total que la arena, según los factores de emisión de la EPA.`);
  }
  if (String(p.origen).toLowerCase().includes('subproducto')) {
    sosTxt.push('Es un material de economía circular: ' + lcfirst(p.origen) + '.');
  }

  /* ----- Supuestos y fuentes que se le muestran al cliente ----- */
  const sup = [];
  sup.push('Grado de limpieza: ' + GRADOS[grado][0] + ' (' + GRADOS[grado][1] + ')' + (e.grado === '' ? ', asumido porque no se indicó' : '') + '.');
  sup.push('Grado de corrosión inicial: ' + corr + (e.corrosion === '' ? ', asumido porque no se indicó' : '') + '.');
  if (e.toneladas_arena !== null) {
    sup.push('Área estimada a partir de ' + nAuto(e.toneladas_arena) + ' t de arena sílice: con un consumo de ' + nAuto(consAbase) + ' kg de arena por m² para este grado de limpieza y de corrosión, equivalen a unos ' + nAuto(area) + ' m².');
  }
  sup.push('Chorro seco con boquilla n.º 7 (7/16") a 90 psi; ' + n(nb) + (nb === 1 ? ' boquilla' : ' boquillas') + ' y ' + nAuto(hDia) + ' horas efectivas por jornada.');
  if (e.nocturno) {
    sup.push('Trabajo en jornada nocturna, con recargo del ' + n(P('recargo_nocturno_pct')) + ' % sobre la mano de obra en ambos escenarios.');
  }
  sup.push('El costo no incluye pintura, andamios, equipos de recuperación ni transporte del abrasivo.');

  const fuentes = [
    'Velocidad y consumo relativos por tipo de abrasivo: ' + p.fuente_rend,
    'Rendimiento base con arena: ' + ctx.ajuste('fuente_rendimiento_arena', ''),
    'Flujo de abrasivo por boquilla: Clemco Industries, tabla de consumo de aire y abrasivo.',
    'Emisiones de CO₂: US EPA, GHG Emission Factors Hub (10,21 kg CO₂ por galón de diésel).',
    'Salud: IARC, monografías 68 (1997) y 100C (2012); NIOSH, publicación 93-124; Resolución 2467 de 2022 del Ministerio del Trabajo de Colombia.',
    'Propiedades del producto: ' + String(p.fuente_ficha).replace(/ Lista de precios.*$/u, ''),
  ];

  const cliente = {
    producto: {
      nombre,
      tipo: p.tipo,
      marca: p.marca,
      descripcion: p.descripcion,
      dureza: p.dureza,
      norma: p.norma,
      silice_libre: p.silice_libre,
      origen: p.origen,
      reutilizable: Number(p.reutilizable) === 1,
    },
    proyecto: {
      superficie: SUPERFICIES[e.superficie] + (e.superficie_otro !== '' ? ': ' + e.superficie_otro : ''),
      espacio: ESPACIOS[e.espacio],
      area: (e.toneladas_arena !== null ? 'aprox. ' : '') + nAuto(area) + ' m²',
      toneladas_arena: e.toneladas_arena !== null ? nAuto(e.toneladas_arena) + ' t de arena' : '',
      grado: e.grado !== '' ? GRADOS[grado][0] : '',
      corrosion: e.corrosion,
      perfil: e.perfil_valor !== null ? nAuto(e.perfil_valor) + ' ' + e.perfil_unidad : '',
      moneda,
    },
    cantidad_estimada: cantidadAbrasivo(kgF),
    filas: filasCliente,
    graficos,
    conclusion: { costo: costoTxt, tecnico: tecTxt, sostenibilidad: sosTxt },
    supuestos: sup,
    fuentes,
  };

  const precioEq = kgF > 0 ? (cA.total - cF.operacion) / kgF * tasa : null;
  const interno = {
    moneda,
    tasa,
    producto_id: Number(p.id),
    producto: nombre,
    datos_comparativos: Number(p.datos_comparativos) === 1,
    precio_kg_cop: precioCop,
    precio_personalizado: precioKg !== null,
    grado_usado: grado,
    corrosion_usada: corr,
    arena: Object.assign({ m2h: prodA, kg_m2: consA, horas: horasA, kg: kgA, co2_kg: co2A, costo_m2: cA.total / area }, cA),
    fabcom: Object.assign({ m2h: prodF, kg_m2: consF, kg_m2_pasada: consPasadaF, usos, horas: horasF, kg: kgF, co2_kg: co2F, costo_m2: cF.total / area }, cF),
    dif_total_pct: filas.costo_total.pct,
    dif_operacion_pct: filas.costo_operacion.pct,
    precio_equilibrio_cop_kg: precioEq,
    venta_potencial_cop: kgF * precioCop,
    costos_cliente: c,
    costos_personalizados: e.costos_personalizados,
    filas: Object.values(filas),
    costo_mostrado_cliente: favTotal ? 'total' : (favOper ? 'operacion' : 'ninguno'),
  };

  return { entrada: e, cliente, interno, producto: p };
}

module.exports = { CLAVES_COSTO_CLIENTE, CLAVES_EN_DINERO, tasaMoneda, costosPorDefecto, normalizarEntrada, simular, producto, productoRecomendado };
