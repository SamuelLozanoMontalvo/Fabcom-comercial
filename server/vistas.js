'use strict';
/** Bloques de pantalla compartidos por las páginas del CRM (app/vistas.php). */
const { e, n, nAuto, dinero, SUPERFICIES, ESPACIOS, GRADOS, CORROSIONES, MONEDAS } = require('./util');
const { CLAVES_COSTO_CLIENTE, CLAVES_EN_DINERO } = require('./engine');

/** Valor de formulario como lo imprime PHP: floats sin ".0". */
function v2s(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '';
  return String(v);
}

/** Cifras completas de una simulación: solo para asesores. */
function vistaSimulacionInterna(ctx, sim, token) {
  const i = sim.interno;
  const c = sim.cliente;
  const mon = i.moneda;
  const a = i.arena;
  const f = i.fabcom;
  const dif = Number(i.dif_total_pct);
  const mostrado = { total: 'el ahorro en costo total', operacion: 'el ahorro en costo de operación, sin el abrasivo', ninguno: 'ninguna fila de costo' }[i.costo_mostrado_cliente] ?? '';
  let h = '';
  h += '\n    <div class="sim-resumen">\n'
    + '      <div><span>Abrasivo recomendado</span><b>' + e(i.producto) + '</b></div>\n'
    + '      <div><span>Cantidad</span><b>' + e(c.cantidad_estimada) + '</b></div>\n'
    + '      <div><span>Precio usado' + (i.precio_personalizado ? ' (ajustado)' : '') + '</span><b>' + e(dinero(i.precio_kg_cop, 'COP')) + '/kg</b></div>\n'
    + '      <div><span>Venta potencial</span><b>' + e(dinero(i.venta_potencial_cop, 'COP')) + '</b></div>\n'
    + '    </div>\n';
  h += '    <p class="sim-veredicto ' + (dif <= 0 ? 'es-bien' : 'es-alerta') + '">\n';
  if (dif <= 0) {
    h += '        El costo total con Fabcom es <strong>' + n(Math.abs(dif)) + ' % menor</strong> que con arena.\n';
  } else {
    const eq = Number(i.precio_equilibrio_cop_kg);
    h += '        El costo total con Fabcom es <strong>' + n(dif) + ' % mayor</strong> que con arena. Para igualarlo, el precio tendría que ser de <strong>' + e(dinero(Math.max(0, eq), 'COP')) + '/kg</strong>' + (eq <= 0 ? ' (no hay precio que lo iguale con estos datos)' : '') + '.\n';
  }
  h += '      El cliente vio ' + e(mostrado) + '.\n    </p>\n';
  if (!i.datos_comparativos) {
    h += '      <p class="nota-alerta">Este producto no tiene datos comparativos frente a la arena: la velocidad y el consumo se calcularon iguales. Cargue un resultado de prueba en Productos y precios.</p>\n';
  }
  h += '    <div class="tabla-caja"><table class="tabla tabla--densa">\n'
    + '      <thead><tr><th>Indicador</th><th class="num">Arena sílice</th><th class="num">Fabcom</th><th class="num">Diferencia</th><th>Lo ve el cliente</th></tr></thead>\n      <tbody>\n';
  for (const r of i.filas) {
    const visible = r.favorable && !(r.clave === 'costo_operacion' && i.costo_mostrado_cliente === 'total');
    h += '        <tr>\n          <td>' + e(r.etiqueta) + '</td><td class="num">' + e(r.arena) + '</td><td class="num"><strong>' + e(r.fabcom) + '</strong></td>\n'
      + '          <td class="num ' + (r.favorable ? 'bien' : 'mal') + '">' + (r.pct === null ? '' : (r.pct > 0 ? '+' : '−') + n(Math.abs(r.pct)) + ' %') + '</td>\n'
      + '          <td>' + (visible ? 'Sí' + (['costo_total', 'costo_operacion'].includes(r.clave) ? ', solo el porcentaje' : '') : '<span class="tenue">No: no favorece</span>') + '</td>\n        </tr>\n';
  }
  h += '      </tbody>\n    </table></div>\n';
  h += '    <div class="tabla-caja"><table class="tabla tabla--densa">\n'
    + '      <thead><tr><th>Desglose del costo (' + e(mon) + ')</th><th class="num">Arena sílice</th><th class="num">Fabcom</th></tr></thead>\n      <tbody>\n';
  for (const [k, t] of [['abrasivo', 'Abrasivo'], ['mano_obra', 'Mano de obra'], ['combustible', 'Combustible'], ['disposicion', 'Disposición del residuo'], ['total', 'Total']]) {
    h += '        <tr' + (k === 'total' ? ' class="total"' : '') + '><td>' + t + '</td><td class="num">' + e(dinero(a[k], mon)) + '</td><td class="num">' + e(dinero(f[k], mon)) + '</td></tr>\n';
  }
  h += '        <tr><td>Costo por m²</td><td class="num">' + e(dinero(a.costo_m2, mon)) + '</td><td class="num">' + e(dinero(f.costo_m2, mon)) + '</td></tr>\n';
  h += '        <tr><td>Consumo de abrasivo</td><td class="num">' + nAuto(a.kg_m2) + ' kg/m²</td><td class="num">' + nAuto(f.kg_m2) + ' kg/m²' + (f.usos > 1 ? ' (' + n(f.usos) + ' usos)' : '') + '</td></tr>\n';
  h += '      </tbody>\n    </table></div>\n';
  const cc = i.costos_cliente;
  const params = ctx.parametros();
  const cambios = i.costos_personalizados && i.costos_personalizados.length
    ? 'El cliente cambió: ' + e(i.costos_personalizados.map((k) => (params[k] ? params[k].etiqueta : k)).join('; ').toLowerCase()) + '.'
    : 'El cliente dejó los valores de referencia.';
  h += '    <p class="tenue">Costos del cliente: arena ' + e(dinero(cc.precio_arena_kg, mon)) + '/kg · mano de obra ' + e(dinero(cc.costo_mo_hora, mon)) + '/h · diésel ' + e(dinero(cc.precio_diesel_gal, mon)) + '/gal · ' + nAuto(cc.gal_jornada) + ' gal/jornada · ' + n(cc.boquillas) + ' boquilla(s) · ' + nAuto(cc.horas_dia) + ' h/jornada · disposición ' + e(dinero(cc.disposicion_ton, mon)) + '/t.\n'
    + '      ' + cambios + '\n'
    + '      Grado usado: ' + e(GRADOS[i.grado_usado][0]) + '; corrosión ' + e(i.corrosion_usada) + '.</p>\n';
  h += '    <p><a class="btn btn--plano btn--chico" href="../pdf.php?t=' + e(token) + '&amp;i=1" target="_blank" rel="noopener">Ver el PDF que recibe el cliente</a></p>\n';
  return h;
}

function sel(cond) {
  return cond ? 'selected' : '';
}

/** Campos del proyecto para los formularios internos (simular con un cliente, recalcular). */
function camposProyecto(v = {}) {
  const g = (k, d = '') => (v[k] !== undefined && v[k] !== null ? v[k] : d);
  const ton = v.toneladas_arena !== undefined && v.toneladas_arena !== null && v.toneladas_arena !== '';
  let h = '\n    <div class="rejilla rejilla--3">\n';
  h += '      <label><span>Tipo de superficie</span><select name="superficie" required>' + Object.entries(SUPERFICIES).map(([k, t]) => '<option value="' + k + '" ' + sel(g('superficie') === k) + '>' + e(t) + '</option>').join('') + '</select></label>\n';
  h += '      <label><span>Si es «Otro», ¿cuál?</span><input type="text" name="superficie_otro" value="' + e(v2s(g('superficie_otro'))) + '" maxlength="80"></label>\n';
  h += '      <label><span>Dato del tamaño</span><select name="dato_area"><option value="m2">Área en m²</option><option value="toneladas" ' + sel(ton) + '>Toneladas de arena</option></select></label>\n';
  h += '      <label><span>Área en m²</span><input type="text" name="area_m2" inputmode="decimal" value="' + e(ton ? '' : v2s(g('area_m2'))) + '"></label>\n';
  h += '      <label><span>Toneladas de arena</span><input type="text" name="toneladas_arena" inputmode="decimal" value="' + e(v2s(g('toneladas_arena'))) + '"><small>Solo si eligió «Toneladas de arena».</small></label>\n';
  h += '      <label><span>Espacio</span><select name="espacio" required>' + Object.entries(ESPACIOS).map(([k, t]) => '<option value="' + k + '" ' + sel(g('espacio') === k) + '>' + e(t) + '</option>').join('') + '</select></label>\n';
  h += '      <label><span>Grado de limpieza</span><select name="grado"><option value="">Sin definir</option>' + Object.entries(GRADOS).map(([k, t]) => '<option value="' + k + '" ' + sel(g('grado') === k) + '>' + e(t[0] + ' (' + t[1] + ')') + '</option>').join('') + '</select></label>\n';
  h += '      <label><span>Grado de corrosión</span><select name="corrosion"><option value="">Sin definir</option>' + Object.keys(CORROSIONES).map((k) => '<option value="' + k + '" ' + sel(g('corrosion') === k) + '>' + k + '</option>').join('') + '</select></label>\n';
  h += '      <label><span>Perfil de anclaje</span><input type="text" name="perfil_valor" inputmode="decimal" value="' + e(v2s(g('perfil_valor'))) + '"></label>\n';
  h += '      <label><span>Unidad del perfil</span><select name="perfil_unidad"><option value="mils">mils</option><option value="micrones" ' + sel(g('perfil_unidad') === 'micrones') + '>micrones</option></select></label>\n';
  h += '      <label><span>Moneda de los costos del cliente</span><select name="moneda">' + Object.entries(MONEDAS).map(([k, t]) => '<option value="' + k + '" ' + sel(g('moneda', 'COP') === k) + '>' + e(t) + '</option>').join('') + '</select></label>\n';
  h += '    </div>\n';
  return h;
}

function camposCostos(ctx, costos, moneda) {
  const params = ctx.parametros();
  let h = '<div class="rejilla rejilla--4">';
  for (const k of CLAVES_COSTO_CLIENTE) {
    const unidad = CLAVES_EN_DINERO.includes(k) ? params[k].unidad.split('COP').join(moneda) : params[k].unidad;
    h += '<label><span>' + e(params[k].etiqueta) + '</span><input type="text" inputmode="decimal" name="costos[' + k + ']" value="' + e(v2s(costos[k] ?? '').replace(/\./g, ',')) + '"><small>' + e(unidad) + '</small></label>';
  }
  h += '</div>';
  return h;
}

module.exports = { vistaSimulacionInterna, camposProyecto, camposCostos };
