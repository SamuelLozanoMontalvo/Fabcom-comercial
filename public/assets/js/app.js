/* Simulador Fabcom — interfaz pública. Sin dependencias externas. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var nf = function (v, d) { return Number(v).toLocaleString('es-CO', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };

  var guardado = {
    leer: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    poner: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    quitar: function (k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };

  var estado = { cfg: null, token: guardado.leer('fabcom_token') || '', costosEditados: {}, resultado: null, correo: '' };
  var formC = $('#form-contacto'), formP = $('#form-proyecto'), cajaR = $('#resultado'), aviso = $('#aviso');

  function api(ruta, datos) {
    var opt = datos ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) } : {};
    return fetch(ruta, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'El servidor no respondió como se esperaba. Intente de nuevo.' }; });
    }).catch(function () {
      return { ok: false, error: 'No hay conexión con el servidor. Revise su internet e intente de nuevo.' };
    });
  }

  function avisar(texto, ok) {
    if (!texto) { aviso.hidden = true; return; }
    aviso.textContent = texto;
    aviso.className = 'aviso' + (ok ? ' es-ok' : '');
    aviso.hidden = false;
  }

  function irAPaso(n) {
    formC.hidden = n !== 1; formP.hidden = n !== 2; cajaR.hidden = n !== 3;
    $$('.pasos__item').forEach(function (li) {
      var p = Number(li.getAttribute('data-paso'));
      li.classList.toggle('es-actual', p === n);
      li.classList.toggle('es-hecho', p < n);
      if (p === n) { li.setAttribute('aria-current', 'step'); } else { li.removeAttribute('aria-current'); }
    });
    avisar('');
    var y = $('#simulador').getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  /* ---------- Carga de opciones ---------- */
  function opciones(sel, lista, conValor) {
    lista.forEach(function (o) {
      var op = document.createElement('option');
      op.value = conValor ? o[0] : o;
      op.textContent = conValor ? o[1] : o;
      sel.appendChild(op);
    });
  }

  function pintarCostos() {
    var c = estado.cfg, mon = formP.moneda.value, cont = $('#costos-campos');
    cont.innerHTML = '';
    c.campos_costo.forEach(function (f) {
      var def = c.costos[mon][f.clave];
      var val = Object.prototype.hasOwnProperty.call(estado.costosEditados, f.clave) ? estado.costosEditados[f.clave] : def;
      var unidad = f.dinero ? f.unidad.replace('COP', mon) : f.unidad;
      var lab = document.createElement('label');
      lab.className = 'campo';
      lab.innerHTML = '<span>' + esc(f.etiqueta) + '</span><input type="text" inputmode="decimal" data-costo="' + esc(f.clave) + '" value="' + esc(String(val).replace('.', ',')) + '"><small class="campo__sufijo">' + esc(unidad) + '</small>';
      cont.appendChild(lab);
    });
    $$('[data-costo]', cont).forEach(function (inp) {
      inp.addEventListener('input', function () { estado.costosEditados[inp.getAttribute('data-costo')] = inp.value; });
    });
  }

  function prepararCorrosion() {
    var fotos = $('#corrosion-fotos'), rango = $('#corrosion-rango'), texto = $('#corrosion-texto');
    var letras = ['A', 'B', 'C', 'D'];
    letras.forEach(function (l, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'corrosion__foto';
      b.setAttribute('aria-label', 'Grado de corrosión ' + l);
      b.innerHTML = '<img src="assets/img/corrosion-' + l + '.jpg" alt="" loading="lazy" width="290" height="540"><span>' + l + '</span>';
      b.addEventListener('click', function () { rango.value = String(i + 1); actualizar(); });
      fotos.appendChild(b);
    });
    function actualizar() {
      var v = Number(rango.value);
      fotos.classList.toggle('sin-eleccion', v === 0);
      $$('.corrosion__foto', fotos).forEach(function (b, i) { b.classList.toggle('es-activa', i + 1 === v); });
      if (v === 0) {
        texto.textContent = 'Mueva el control hasta la imagen que más se parece a su superficie.';
        rango.setAttribute('aria-valuetext', 'No sé');
      } else {
        texto.innerHTML = '<strong>Grado ' + letras[v - 1] + '.</strong> ' + esc(estado.cfg.corrosiones[letras[v - 1]]);
        rango.setAttribute('aria-valuetext', 'Grado ' + letras[v - 1]);
      }
    }
    rango.addEventListener('input', actualizar);
    actualizar();
    return { valor: function () { var v = Number(rango.value); return v === 0 ? '' : letras[v - 1]; }, fijar: function (l) { rango.value = String(letras.indexOf(l) + 1); actualizar(); } };
  }

  var corrosion = null;

  function iniciar(cfg) {
    estado.cfg = cfg;
    opciones(formC.sector, cfg.sectores);
    opciones(formC.area_cargo, cfg.areas);
    opciones(formC.asesor_id, (cfg.asesores || []).map(function (a) { return [String(a.id), a.nombre]; }), true);
    function verAsesor() { $('#campo-asesor').hidden = !$('input[name=tipo_cliente][value=actual]', formC).checked; }
    $$('input[name=tipo_cliente]', formC).forEach(function (r) { r.addEventListener('change', verAsesor); });
    formC.asesor_id.addEventListener('change', function () { var c = $('#campo-asesor'); c.classList.remove('tiene-error'); $('.campo__error', c).textContent = ''; });
    // Enlace personal del asesor: ?asesor=ID deja marcado «Sí, ya tengo asesor» con su nombre.
    var qa = new URLSearchParams(window.location.search).get('asesor');
    if (qa && $('option[value="' + qa.replace(/\D/g, '') + '"]', formC.asesor_id)) {
      $('input[name=tipo_cliente][value=actual]', formC).checked = true;
      formC.asesor_id.value = qa.replace(/\D/g, '');
    }
    verAsesor();
    function verDatoArea() {
      var ton = $('input[name=dato_area][value=toneladas]', formP).checked;
      $('#area-m2').hidden = ton; $('#toneladas-arena').hidden = !ton;
      $('#area-ayuda').textContent = ton ? 'Toneladas de arena sílice que consume hoy el proyecto. Con ese dato estimamos los m².' : 'Metros cuadrados por limpiar.';
    }
    $$('input[name=dato_area]', formP).forEach(function (r) { r.addEventListener('change', verDatoArea); });
    verDatoArea();
    opciones(formP.superficie, Object.keys(cfg.superficies).map(function (k) { return [k, cfg.superficies[k]]; }), true);
    opciones(formP.moneda, Object.keys(cfg.monedas).map(function (k) { return [k, cfg.monedas[k]]; }), true);
    opciones(formP.grado, cfg.grados.map(function (g) { return [g.clave, g.nombre + ' (' + g.norma + ')']; }), true);
    $$('[data-empresa]').forEach(function (n) { n.textContent = cfg.empresa; });
    if (cfg.politica_url) {
      $('#politica-enlace').innerHTML = ' y a la <a href="' + esc(cfg.politica_url) + '" target="_blank" rel="noopener">política de tratamiento de datos</a>';
    }
    $('#recargo').textContent = nf(cfg.recargo_nocturno);
    corrosion = prepararCorrosion();
    pintarCostos();
    formP.moneda.addEventListener('change', function () { estado.costosEditados = {}; pintarCostos(); });
    formP.superficie.addEventListener('change', function () { $('#campo-otro').hidden = formP.superficie.value !== 'otro'; });

    var q = new URLSearchParams(window.location.search);
    var r = q.get('r');
    if (r && /^[a-f0-9]{32}$/.test(r)) {
      api('api/resultado.php?t=' + r).then(function (d) {
        if (d.ok) {
          estado.token = r; guardado.poner('fabcom_token', r);
          estado.correo = d.correo;
          rellenarProyecto(d.entrada);
          mostrarResultado(d.resultado, d.pdf_url, null);
        }
      });
    } else if (estado.token) {
      irAPaso(2);
      window.scrollTo(0, 0);
    }
  }

  function rellenarProyecto(e) {
    if (!e) { return; }
    formP.superficie.value = e.superficie || '';
    $('#campo-otro').hidden = e.superficie !== 'otro';
    formP.superficie_otro.value = e.superficie_otro || '';
    var porTon = e.toneladas_arena !== null && e.toneladas_arena !== undefined;
    $('input[name=dato_area][value=' + (porTon ? 'toneladas' : 'm2') + ']', formP).checked = true;
    formP.toneladas_arena.value = porTon ? String(e.toneladas_arena).replace('.', ',') : '';
    formP.area_m2.value = (!porTon && e.area_m2) ? String(e.area_m2).replace('.', ',') : '';
    $('#area-m2').hidden = porTon; $('#toneladas-arena').hidden = !porTon;
    $$('input[name=espacio]', formP).forEach(function (r) { r.checked = r.value === e.espacio; });
    formP.moneda.value = e.moneda || 'COP';
    formP.grado.value = e.grado || '';
    if (e.corrosion) { corrosion.fijar(e.corrosion); }
    formP.perfil_valor.value = e.perfil_valor ? String(e.perfil_valor).replace('.', ',') : '';
    formP.perfil_unidad.value = e.perfil_unidad || 'mils';
    formP.nocturno.checked = !!e.nocturno;
    pintarCostos();
  }

  /* ---------- Paso 1 ---------- */
  function limpiarErrores(form) {
    $$('.campo', form).forEach(function (c) { c.classList.remove('tiene-error'); });
    $$('.campo__error', form).forEach(function (s) { s.textContent = ''; });
  }

  formC.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limpiarErrores(formC);
    var q = new URLSearchParams(window.location.search);
    var datos = {
      nombre: formC.nombre.value, email: formC.email.value, empresa: formC.empresa.value, telefono: formC.telefono.value,
      sector: formC.sector.value, area_cargo: formC.area_cargo.value, sitio_web: formC.sitio_web.value,
      acepta_datos: formC.acepta_datos.checked, acepta_marketing: formC.acepta_marketing.checked,
      tipo_cliente: ($('input[name=tipo_cliente]:checked', formC) || {}).value || '', asesor_id: formC.asesor_id.value,
      utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '',
      referrer: document.referrer || ''
    };
    var btn = $('button[type=submit]', formC);
    btn.disabled = true;
    api('api/lead.php', datos).then(function (d) {
      btn.disabled = false;
      if (!d.ok) {
        avisar(d.error || 'No pudimos guardar sus datos.');
        Object.keys(d.campos || {}).forEach(function (k) {
          var inp = formC.elements[k];
          var caja = inp && inp.closest ? inp.closest('.campo') : null;
          if (caja) { caja.classList.add('tiene-error'); $('.campo__error', caja).textContent = d.campos[k]; }
          var suelto = $('[data-error="' + k + '"]', formC);
          if (suelto) { suelto.textContent = d.campos[k]; }
        });
        var primero = $('.tiene-error input, .tiene-error select', formC);
        if (primero) { primero.focus(); }
        return;
      }
      estado.token = d.token; guardado.poner('fabcom_token', d.token);
      estado.correo = datos.email;
      irAPaso(2);
    });
  });


  /* ---------- Paso 2 ---------- */
  formP.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var esp = $('input[name=espacio]:checked', formP);
    var costos = {};
    $$('[data-costo]', formP).forEach(function (i) { costos[i.getAttribute('data-costo')] = i.value; });
    var datos = {
      token: estado.token,
      superficie: formP.superficie.value, superficie_otro: formP.superficie_otro.value,
      dato_area: ($('input[name=dato_area]:checked', formP) || {}).value || 'm2',
      area_m2: formP.area_m2.value, toneladas_arena: formP.toneladas_arena.value, espacio: esp ? esp.value : '', moneda: formP.moneda.value,
      grado: formP.grado.value, corrosion: corrosion.valor(),
      perfil_valor: formP.perfil_valor.value, perfil_unidad: formP.perfil_unidad.value,
      nocturno: formP.nocturno.checked, costos: costos
    };
    var btn = $('#btn-calcular');
    btn.disabled = true; btn.textContent = 'Calculando…';
    api('api/simular.php', datos).then(function (d) {
      btn.disabled = false; btn.textContent = 'Calcular comparativo';
      if (!d.ok) {
        if (d.reiniciar) { estado.token = ''; guardado.quitar('fabcom_token'); irAPaso(1); }
        avisar(d.error || 'No pudimos calcular la simulación.');
        return;
      }
      estado.correo = d.correo || estado.correo;
      mostrarResultado(d.resultado, d.pdf_url, d.correo_enviado);
    });
  });

  /* ---------- Paso 3 ---------- */
  function signo(p) { return (p > 0 ? '+' : '−') + nf(Math.abs(p)) + ' %'; }

  function titular(r) {
    var f = {};
    r.filas.forEach(function (x) { f[x.clave] = x; });
    if (f.costo_total) { return [nf(Math.abs(f.costo_total.pct)) + ' %', 'menos costo total estimado frente a la arena sílice']; }
    if (f.duracion) { return [nf(Math.abs(f.duracion.pct)) + ' %', 'menos tiempo de blasting que con arena sílice, aproximadamente']; }
    if (f.abrasivo) { return [nf(Math.abs(f.abrasivo.pct)) + ' %', 'menos abrasivo consumido y residuo por disponer']; }
    if (r.producto.silice_libre) { return [r.producto.silice_libre.charAt(0).toUpperCase() + r.producto.silice_libre.slice(1), 'de sílice cristalina libre en el abrasivo']; }
    return null;
  }

  function mostrarResultado(r, pdfUrl, correoEnviado) {
    estado.resultado = r;
    var p = r.producto, t = titular(r), h = '';

    h += '<div class="resultado__cabeza"><div><p class="sobre">Abrasivo recomendado para ' + esc(r.proyecto.area) + ' de ' + esc(r.proyecto.superficie.toLowerCase()) + ', espacio ' + esc(r.proyecto.espacio.toLowerCase()) + '</p>';
    h += '<h3>' + esc(p.nombre) + '</h3><p class="desc">' + esc(p.descripcion) + '</p><ul class="ficha">';
    if (p.silice_libre) { h += '<li>Sílice libre: <b>' + esc(p.silice_libre) + '</b></li>'; }
    if (p.dureza) { h += '<li>Dureza: <b>' + esc(p.dureza) + '</b></li>'; }
    if (p.norma) { h += '<li>Norma: <b>' + esc(p.norma) + '</b></li>'; }
    h += '</ul></div>';
    h += (t ? '<div class="titular"><strong>' + esc(t[0]) + '</strong><span>' + esc(t[1]) + '</span></div>' : '<div></div>') + '</div>';

    if (!r.filas.length) { h += '<div class="bloque"><h3>Cuadro comparativo</h3><p>Para este abrasivo aún no hay datos publicados que permitan compararlo en cifras con la arena sílice. Su asesor Fabcom le preparará el comparativo con resultados de prueba para su proyecto.</p></div>'; }
    else { h += '<div class="bloque"><h3>Cuadro comparativo</h3><table class="tabla"><thead><tr><th>Indicador</th><th>Arena sílice</th><th>Abrasivo Fabcom (aproximado)</th><th>Diferencia</th></tr></thead><tbody>';
    r.filas.forEach(function (f) {
      h += '<tr><td class="ind">' + esc(f.etiqueta) + (f.nota ? '<small>' + esc(f.nota) + '</small>' : '') + '</td><td class="arena" data-t="Arena sílice">' + esc(f.arena) + '</td><td class="fabcom" data-t="Abrasivo Fabcom">' + esc(f.fabcom) + '</td><td class="dif">' + (f.pct === null ? '' : signo(f.pct)) + '</td></tr>';
    });
    h += '</tbody></table></div>'; }

    if (r.graficos.length) {
      h += '<div class="bloque"><h3>El resultado en gráficos</h3><div class="leyenda"><span><i style="background:var(--serie-arena)"></i>Arena sílice</span><span><i style="background:var(--serie-fabcom)"></i>Abrasivo Fabcom</span></div><div class="graficos">';
      r.graficos.forEach(function (g) {
        var max = Math.max(g.arena, g.fabcom, 0.0001);
        var dec = (g.arena % 1 !== 0 || g.fabcom % 1 !== 0) ? 1 : 0;
        var barra = function (nombre, v, color) {
          return '<div class="barra" title="' + esc(nombre + ': ' + nf(v, dec) + ' ' + g.unidad) + '"><span>' + nombre + '</span><div class="barra__pista"><div class="barra__relleno" data-ancho="' + (v / max * 82).toFixed(1) + '" style="width:0;background:' + color + '"></div><span class="barra__valor">' + nf(v, dec) + '</span></div></div>';
        };
        h += '<div class="grafico"><div class="grafico__cab"><b>' + esc(g.titulo) + '</b><span>' + signo(g.pct) + '</span></div><div class="grafico__unidad">' + esc(g.unidad.length > 2 ? g.unidad.charAt(0).toUpperCase() + g.unidad.slice(1) : 'En ' + g.unidad) + '</div>' + barra('Arena sílice', g.arena, 'var(--serie-arena)') + barra('Fabcom', g.fabcom, 'var(--serie-fabcom)') + '</div>';
      });
      h += '</div></div>';
    }

    var ejes = [['costo', 'Costo'], ['tecnico', 'Desempeño técnico'], ['sostenibilidad', 'Sostenibilidad y salud']];
    h += '<div class="bloque"><h3>Conclusiones para su proyecto</h3><div class="ejes">';
    ejes.forEach(function (e) {
      var l = r.conclusion[e[0]] || [];
      if (!l.length) { return; }
      h += '<div class="eje"><h4>' + e[1] + '</h4><ul>' + l.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    });
    h += '</div></div>';

    h += '<div class="acciones"><h3>¿Seguimos con su proyecto?</h3><p>';
    h += correoEnviado ? 'Enviamos este comparativo en PDF a ' + esc(estado.correo) + '.' : 'Descargue el comparativo en PDF o pida que un asesor lo contacte.';
    h += '</p><div class="acciones__fila"><button class="boton" data-accion="cotizacion">Solicitar cotización</button>';
    if (estado.cfg.whatsapp) { h += '<button class="boton boton--verde" data-accion="whatsapp">Hablar por WhatsApp</button>'; }
    h += '<button class="boton boton--plano" data-accion="visita">Agendar visita técnica</button></div>';
    h += '<div class="acciones__secundarias"><a class="boton boton--plano boton--chico" href="' + esc(pdfUrl) + '" target="_blank" rel="noopener">Descargar PDF</a><button class="boton boton--plano boton--chico" data-accion="enviar_pdf">Enviar el PDF a mi correo</button><button class="boton boton--plano boton--chico" data-accion="editar">Volver</button></div></div>';

    h += '<details class="bloque notas"><summary>Supuestos y fuentes del cálculo</summary><h4>Supuestos</h4><ul>' + r.supuestos.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul><h4>Fuentes</h4><ul>' + r.fuentes.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></details>';

    cajaR.innerHTML = h;
    irAPaso(3);
    window.requestAnimationFrame(function () {
      window.setTimeout(function () {
        $$('.barra__relleno', cajaR).forEach(function (b) { b.style.width = b.getAttribute('data-ancho') + '%'; });
      }, 60);
    });
  }

  var dialogo = $('#dialogo'), dCuerpo = $('#dialogo-cuerpo');
  function abrirDialogo(html) {
    if (html.indexOf('class="agenda"') < 0) { dialogo.classList.remove('dialogo--ancho'); }
    dCuerpo.innerHTML = html;
    if (dialogo.showModal) { dialogo.showModal(); } else { dialogo.setAttribute('open', ''); }
  }
  function cerrarDialogo() { if (dialogo.close) { dialogo.close(); } else { dialogo.removeAttribute('open'); } }

  function enviarAccion(datos, btn) {
    datos.token = estado.token;
    if (btn) { btn.disabled = true; }
    return api('api/accion.php', datos).then(function (d) {
      if (btn) { btn.disabled = false; }
      return d;
    });
  }

  cajaR.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-accion]');
    if (!b) { return; }
    var a = b.getAttribute('data-accion');
    if (a === 'editar') { irAPaso(2); return; }
    if (a === 'enviar_pdf') {
      enviarAccion({ tipo: 'enviar_pdf' }, b).then(function (d) { avisar(d.ok ? d.mensaje : d.error, d.ok); aviso.scrollIntoView({ block: 'center' }); });
      return;
    }
    if (a === 'whatsapp') {
      var r = estado.resultado;
      var texto = 'Hola, hice el comparativo en el simulador de Fabcom para ' + r.proyecto.area + ' de ' + r.proyecto.superficie.toLowerCase() + ' (espacio ' + r.proyecto.espacio.toLowerCase() + '). Me recomendaron ' + r.producto.nombre + ' y quiero más información.';
      enviarAccion({ tipo: 'whatsapp' });
      window.open('https://wa.me/' + estado.cfg.whatsapp + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
      return;
    }
    if (a === 'cotizacion') {
      abrirDialogo('<h3>Solicitar cotización</h3><p>Un asesor te contactará y enviará la cotización. Confirma el correo al que debe llegar.</p><form id="f-cot"><label class="campo"><span>Correo</span><input type="email" name="email" id="cot-email" required maxlength="160" value="' + esc(estado.correo) + '"></label><label class="campo"><span>¿Algo que debamos saber? <em>opcional</em></span><textarea name="mensaje" id="cot-mensaje" rows="3" maxlength="800" placeholder="Fecha de inicio, lugar de entrega, granulometría…"></textarea></label><small class="campo__error" id="cot-error"></small><div class="panel__acciones"><button class="boton" type="submit">Confirmar y solicitar</button></div></form>');
      $('#f-cot').addEventListener('submit', function (e2) {
        e2.preventDefault();
        enviarAccion({ tipo: 'cotizacion', email: e2.target.email.value, mensaje: e2.target.mensaje.value }, $('button', e2.target)).then(function (d) {
          if (!d.ok) { $('#cot-error').textContent = d.error; return; }
          if (d.correo) { estado.correo = d.correo; }
          cerrarDialogo(); avisar(d.mensaje, true); aviso.scrollIntoView({ block: 'center' });
        });
      });
      return;
    }
    if (a === 'visita') {
      enviarAccion({ tipo: 'visita_calendario' }, b).then(function (d) {
        if (d.ok && d.calendario_url) { abrirAgenda(d.calendario_url, d.asesor); } else { abrirFormularioVisita(); }
      });
    }
  });

  function abrirAgenda(url, asesor) {
    dialogo.classList.add('dialogo--ancho');
    abrirDialogo('<h3>Agendar visita técnica</h3><p>Elija un horario disponible en la agenda de ' + esc(asesor || 'su asesor') + '. La cita queda en su Google Calendar. Si la agenda no carga, <a href="' + esc(url) + '" target="_blank" rel="noopener">ábrala en otra pestaña</a>.</p><iframe class="agenda" src="' + esc(url) + '" title="Agenda de visitas técnicas" loading="lazy"></iframe>');
  }

  function abrirFormularioVisita() {
    dialogo.classList.remove('dialogo--ancho');
    var hoy = new Date(); hoy.setMinutes(hoy.getMinutes() - hoy.getTimezoneOffset());
    abrirDialogo('<h3>Agendar visita técnica</h3><p>Proponga una fecha y un lugar. Su asesor se los confirmará.</p><form id="f-vis"><label class="campo"><span>Fecha que prefiere</span><input type="date" name="fecha" id="vis-fecha" required min="' + hoy.toISOString().slice(0, 10) + '"></label><label class="campo"><span>Ciudad o dirección</span><input type="text" name="lugar" id="vis-lugar" required maxlength="200"></label><small class="campo__error" id="vis-error"></small><div class="panel__acciones"><button class="boton" type="submit">Pedir la visita</button></div></form>');
    $('#f-vis').addEventListener('submit', function (e2) {
      e2.preventDefault();
      enviarAccion({ tipo: 'visita', fecha: e2.target.fecha.value, lugar: e2.target.lugar.value }, $('button', e2.target)).then(function (d) {
        if (!d.ok) { $('#vis-error').textContent = d.error; return; }
        cerrarDialogo(); avisar(d.mensaje, true); aviso.scrollIntoView({ block: 'center' });
      });
    });
  }

  api('api/config.php').then(function (c) {
    if (!c.ok) { avisar('No pudimos cargar el simulador. Recargue la página.'); return; }
    iniciar(c);
  });
})();
