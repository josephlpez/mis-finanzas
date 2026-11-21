// Interfaz de la app. Todo el texto se pinta con textContent (nunca innerHTML con datos),
// así nada de lo que se escriba o se importe puede ejecutarse como código.

import * as M from './modelo.js';
import { hoy, dinero, numero, fechaLarga, diasEntre, sumarPeriodo, redondear, contieneTarjeta, uid } from './util.js';
import { importarTexto, exportarTexto } from './importar.js';
import { crearXlsx } from './xlsx.js';
import * as db from './db.js';
import * as sync from './sync.js';
import { derivarClave, nuevaSal, cifrar as cifrarDrive, descifrar as descifrarDrive, esSobreCifrado } from './cripto.js';
import { ID_CLIENTE_GOOGLE } from './ajustes-google.js';

// ---------------------------------------------------------------------------------------------
// Estado de la app
// ---------------------------------------------------------------------------------------------

let estado = M.nuevoEstado();
let config = { dispositivo: '', salDrive: '', ultimaSync: null };
let clave = null; // llave de la copia de Drive (CryptoKey no exportable): solo en memoria mientras la app está abierta
// PC: la app se abre con su servidor en 127.0.0.1. Celular: la app publicada, sin servidor.
const MODO_PC = ['127.0.0.1', 'localhost'].includes(location.hostname);
let recifrarPendiente = null;
let otraClaveEnDrive = false;
let grupo = 'resumen';
let vista = 'resumen';
let filtros = { cuenta: '', ambito: '', desde: '', hasta: '', texto: '', soloPendientes: false, mes: hoy().slice(0, 7) };
let sincronizando = false;
let temporizadorSync = null;
let archivo = { ok: false, guardando: false, ultima: null, error: null };
let temporizadorArchivo = null;
let repintarAlCerrar = false;
// Clave de la app: con ella, los datos solo viven cifrados en el archivo del PC y en la memoria de esta pestaña
// (nunca en el almacenamiento del navegador). pantalla = 'crear' | 'codigo' | 'bloqueo' | 'recuperar' | 'sinServidor' | null.
let proteccion = { protegida: false, abierta: true };
let pantalla = null;
let ultimaActividad = Date.now();
const MINUTOS_INACTIVIDAD = 15;
const MINUTOS_OCULTA = 3; // celular: al volver a la app tras este tiempo fuera, pide la clave

const $ = (sel) => document.querySelector(sel);

/** Crea un elemento de forma segura. Los hijos de texto se insertan como texto, nunca como HTML. */
function h(etiqueta, attrs = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'href') {
      if (/^https:\/\//i.test(String(v))) {
        el.setAttribute('href', v);
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
    } else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

function aviso(texto, tipo = 'ok') {
  const caja = $('#avisos');
  const a = h('div', { class: `aviso ${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, texto);
  caja.append(a);
  setTimeout(() => a.remove(), tipo === 'error' ? 9000 : 4500);
}

const etiqueta = (texto, tipo = '') => h('span', { class: `etiqueta ${tipo}` }, texto);
const cuentaPorId = (id) => M.vivos(estado.cuentas).find((c) => c.id === id);
const horaActual = () => new Date().toTimeString().slice(0, 5);
const nuevoMovimiento = (extra = {}) => abrirFormulario('movimientos', null, { fecha: hoy(), hora: horaActual(), tipo: 'salida', ...extra });
const usd = (n) => dinero(n, 'USD');
const pct = (n) => (n === null || n === undefined ? '—' : `${numero(n)} %`);

function barra(porcentaje, tipo = '') {
  const v = Math.max(0, Math.min(100, Number(porcentaje) || 0));
  const relleno = h('span', {});
  relleno.style.width = `${v}%`; // por CSSOM: la política de seguridad no permite estilos en línea
  return h('div', { class: `barra-progreso ${tipo}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(v)) }, relleno);
}

// ---------------------------------------------------------------------------------------------
// Guardado: navegador (siempre) + archivo del PC (si la app se abre con su servidor) + Drive (opcional)
// ---------------------------------------------------------------------------------------------

async function persistir() {
  if (!MODO_PC) {
    // Celular: los datos solo se guardan cifrados con la clave.
    if (clave && config.salDrive && proteccion.abierta) await db.guardar('estadoCifrado', await cifrarDrive(clave, config.salDrive, estado));
    return;
  }
  if (config.protegida) return; // con clave, los datos no se guardan en el navegador
  await db.guardar('estado', estado);
}

/** Copia interna en el navegador (solo sin clave: con clave, las copias diarias cifradas están en el PC). */
async function respaldoNavegador(motivo) {
  if (config.protegida) return;
  await db.guardarRespaldo(estado, motivo);
}

/** Borra del navegador cualquier copia en claro de los datos (al activar la clave o al abrir la app protegida). */
async function limpiarNavegador() {
  try {
    await db.borrar('estado');
    await db.borrar('respaldos');
  } catch { /* nada que borrar */ }
}

async function pedirAPI(ruta, cuerpo) {
  const r = await fetch(ruta, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { 'X-Finanzas': '1', ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `error ${r.status}`), { estado: r.status, bloqueada: !!j.bloqueada });
  return j;
}

async function guardarConfig() {
  await db.guardar('config', config);
}

function despuesDeCambiar() {
  programarArchivo();
  programarSync();
}

async function guardarRegistro(coleccion, datos) {
  const previo = estado[coleccion].find((r) => r.id === datos.id);
  const nuevo = M.sello({ ...(previo || {}), ...datos }, config.dispositivo);
  estado[coleccion] = [...estado[coleccion].filter((r) => r.id !== nuevo.id), nuevo];
  await persistir();
  despuesDeCambiar();
  return nuevo;
}

async function borrarRegistro(coleccion, id) {
  if (!estado[coleccion].some((r) => r.id === id)) return;
  // Lápida: el registro queda marcado como borrado para que el archivo y los demás dispositivos también lo borren.
  estado[coleccion] = [...estado[coleccion].filter((r) => r.id !== id), M.sello({ id, borrado: true }, config.dispositivo)];
  await persistir();
  despuesDeCambiar();
}

/**
 * Registros que se crean solos a partir de otros (y se borran con ellos):
 * - Gasto hormiga en efectivo o transferencia → movimiento de salida «hm-<id>».
 * - Gasto hormiga a crédito → deuda «hd-<id>» en Deudas.
 * - Gasto de negocio → movimiento de salida «gn-<id>» (desarrollo de negocios).
 * - Compra P2P con «cuenta de donde salieron los CUP» → salida de CUP «p2-<id>» en esa cuenta.
 * - Compra y venta con cuentas → pago de la compra «rv-c-<id>», del envío «rv-e-<id>» y cobro «rv-v-<id>».
 * Devuelve un texto para el aviso o null.
 */
async function sincronizarVinculados(coleccion, r) {
  const quitar = async (col, id) => { if (M.vivos(estado[col]).some((x) => x.id === id)) await borrarRegistro(col, id); };
  const tasaDe = (x) => (Number(x.tasa) > 0 ? Number(x.tasa) : M.tasaSugerida(estado, x.moneda, x.fecha)?.valor ?? null);
  if (coleccion === 'hormigas') {
    const idMov = `hm-${r.id}`;
    const idDeuda = `hd-${r.id}`;
    if (r.borrado) { await quitar('movimientos', idMov); await quitar('deudas', idDeuda); return null; }
    if (r.medio === 'deuda') {
      await quitar('movimientos', idMov);
      const previa = M.vivos(estado.deudas).find((d) => d.id === idDeuda) || {};
      await guardarRegistro('deudas', {
        ...previa, id: idDeuda, acreedor: r.acreedor || 'Sin nombre', importeTotal: r.monto, moneda: r.moneda,
        fechaFin: r.fechaPagoDeuda || previa.fechaFin || null,
        nota: `Gasto hormiga del ${r.fecha}: ${r.concepto}. Se creó solo desde Gastos hormiga.`,
      });
      return 'Apuntado también en Deudas.';
    }
    await quitar('deudas', idDeuda);
    await guardarRegistro('movimientos', {
      id: idMov, fecha: r.fecha, cuenta: r.cuenta, tipo: 'salida', monto: r.monto, moneda: r.moneda, tasa: tasaDe(r),
      descripcion: `${r.concepto} (gasto hormiga, ${r.medio})`, categoria: 'Gasto hormiga', tipo503020: 'deseo',
      ambito: r.ambito || 'personal', verificado: true, fuente: 'Gastos hormiga', nota: 'Se edita en Día a día → Gastos hormiga.',
    });
    return 'Apuntado también en Movimientos.';
  }
  if (coleccion === 'gastosNegocio') {
    const idMov = `gn-${r.id}`;
    if (r.borrado) { await quitar('movimientos', idMov); return null; }
    const categoria = { formación: 'Formación para negocios', curso: 'Formación para negocios', 'anuncio o promoción pagada': 'Publicidad', 'herramienta o suscripción': 'Suscripción' }[r.tipoGasto] || 'Otros';
    const detalle = [r.negocio, r.tipoGasto === 'anuncio o promoción pagada' ? r.tipoAnuncio : r.tipoGasto].filter(Boolean).join(' · ');
    await guardarRegistro('movimientos', {
      id: idMov, fecha: r.fecha, cuenta: r.cuenta, tipo: 'salida', monto: r.monto, moneda: r.moneda, tasa: tasaDe(r),
      descripcion: r.concepto, categoria, subcategoria: detalle, tipo503020: 'desarrollo de negocios',
      ambito: r.ambito || (/insenia|afiliad/i.test(r.negocio || '') ? 'afiliados' : 'desarrollo de empresa y negocios'),
      verificado: true, fuente: 'Gastos de negocio', nota: 'Se edita en Negocio → Gastos de negocio.',
    });
    return 'Apuntado también en Movimientos como gasto de desarrollo de negocios.';
  }
  if (coleccion === 'movimientos') {
    if (String(r.id).startsWith('p2-')) return null; // la propia salida creada sola
    const idMov = `p2-${r.id}`;
    const otra = M.vivos(estado.movimientos).some((m) => m.p2p === r.id && m.id !== idMov); // ya registrada a mano
    if (r.borrado || r.tipo !== 'entrada' || !r.cuentaCup || !(Number(r.cupPagados) > 0) || otra) { await quitar('movimientos', idMov); return null; }
    const previa = M.vivos(estado.movimientos).find((m) => m.id === idMov);
    const tasa = previa && previa.fecha === r.fecha ? previa.tasa : M.tasaSugerida(estado, 'CUP', r.fecha)?.valor ?? null;
    await guardarRegistro('movimientos', {
      ...(previa || {}), id: idMov, fecha: r.fecha, hora: r.hora || null, cuenta: r.cuentaCup, tipo: 'salida', monto: Number(r.cupPagados), moneda: 'CUP', tasa,
      interno: true, p2p: r.id, descripcion: `CUP para P2P ${r.vendedor || ''}`.trim(), categoria: 'Cambio de moneda',
      verificado: true, fuente: 'Compra P2P', nota: 'Se creó sola desde la compra P2P: se edita en esa compra.',
    });
    return 'La salida de CUP se apuntó sola en su cuenta.';
  }
  if (coleccion === 'articulos') {
    const vinc = [
      { id: `rv-c-${r.id}`, cuenta: r.cuentaCompra, ok: !r.movimientoCompra && Number(r.costo) > 0, tipo: 'salida', monto: Number(r.costo), moneda: r.moneda, fecha: r.fechaCompra, desc: `Compra para revender: ${r.nombre}` },
      { id: `rv-e-${r.id}`, cuenta: r.cuentaEnvio, ok: Number(r.costoEnvio) > 0, tipo: 'salida', monto: Number(r.costoEnvio), moneda: 'USD', fecha: r.fechaCompra, desc: `Envío Panavana: ${r.nombre}` },
      { id: `rv-v-${r.id}`, cuenta: r.cuentaVenta, ok: !r.movimientoVenta, tipo: 'entrada', monto: M.estadoArticulo(estado, r).cobrado, moneda: r.moneda, fecha: r.fechaVenta || r.fechaCompra, desc: `Cobro de la venta: ${r.nombre}${r.cliente ? ` (${r.cliente})` : ''}` },
    ];
    const hechos = [];
    for (const v of vinc) {
      if (r.borrado || !v.cuenta || !v.ok || !(v.monto > 0)) { await quitar('movimientos', v.id); continue; }
      const previa = M.vivos(estado.movimientos).find((m) => m.id === v.id);
      const tasa = previa && previa.fecha === v.fecha && previa.moneda === v.moneda ? previa.tasa : (v.moneda === 'USD' || v.moneda === 'USDT' ? null : M.tasaSugerida(estado, v.moneda, v.fecha)?.valor ?? null);
      await guardarRegistro('movimientos', {
        ...(previa || {}), id: v.id, fecha: v.fecha, cuenta: v.cuenta, tipo: v.tipo, monto: v.monto, moneda: v.moneda, tasa,
        descripcion: v.desc, categoria: 'Compra y venta', ambito: r.ambito || null, verificado: true, fuente: 'Compra y venta',
        nota: 'Se creó sola desde Compra y venta: se edita allí.',
      });
      hechos.push(v.tipo === 'entrada' ? 'el cobro' : v.id.startsWith('rv-e-') ? 'el envío' : 'el pago');
    }
    return hechos.length ? `Apuntado también en Movimientos: ${hechos.join(', ')}.` : null;
  }
  return null;
}

function repintar() {
  if ($('#dialogo').open) repintarAlCerrar = true;
  else pintar();
}

/** Trae el archivo del PC y lo mezcla con lo de este navegador. */
async function traerArchivo({ avisar = true } = {}) {
  if (pantalla || !MODO_PC) return;
  try {
    const r = await fetch('api/datos', { headers: { 'X-Finanzas': '1' }, cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) { mostrarBloqueo(); return; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `error ${r.status}`);
    const j = await r.json();
    const res = M.mezclar(estado, M.validarEstado(j.datos));
    archivo = { ...archivo, ok: true, error: null, ultima: new Date().toISOString() };
    estado = res.estado;
    await persistir();
    if (res.cambiosHaciaRemoto > 0) programarArchivo(300);
    if (res.cambiosDesdeRemoto > 0) {
      if (avisar) aviso(`Datos actualizados desde el archivo del PC (${res.cambiosDesdeRemoto} cambios).`);
      repintar();
    }
  } catch (e) {
    archivo = { ...archivo, ok: false, error: e.message };
  }
  pintarEstadoSync();
}

function programarArchivo(ms = 800) {
  if (!MODO_PC) return;
  clearTimeout(temporizadorArchivo);
  temporizadorArchivo = setTimeout(enviarArchivo, ms);
}

async function enviarArchivo() {
  if (pantalla) return; // bloqueada: lo pendiente se envía al desbloquear (sigue en la memoria de esta pestaña)
  if (archivo.guardando) { programarArchivo(500); return; }
  archivo.guardando = true;
  try {
    const r = await fetch('api/datos', {
      method: 'PUT',
      headers: { 'X-Finanzas': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ datos: estado }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (r.status === 401) { mostrarBloqueo(); return; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `error ${r.status}`);
    const j = await r.json();
    const res = M.mezclar(estado, M.validarEstado(j.datos));
    estado = res.estado;
    await persistir();
    archivo = { ...archivo, ok: true, error: null, ultima: new Date().toISOString() };
    if (res.cambiosDesdeRemoto > 0) repintar();
  } catch (e) {
    archivo = { ...archivo, ok: false, error: e.message };
  } finally {
    archivo.guardando = false;
    pintarEstadoSync();
  }
}

// --- Sincronización con el celular por Drive (cifrada con la clave de la app) ---

const syncConfigurada = () => !!(ID_CLIENTE_GOOGLE && config.salDrive && clave && proteccion.abierta && !pantalla);

function programarSync(ms = 15000) {
  clearTimeout(temporizadorSync);
  if (!syncConfigurada()) return;
  temporizadorSync = setTimeout(() => sincronizarAhora({ silencioso: true }), ms);
}

async function sincronizarAhora({ silencioso = false } = {}) {
  if (sincronizando || !syncConfigurada()) return;
  if (!navigator.onLine || !sync.hayAcceso()) {
    pintarEstadoSync();
    if (!silencioso && !sync.hayAcceso()) aviso('Conecta con Google Drive para sincronizar.', 'alerta');
    return;
  }
  sincronizando = true;
  pintarEstadoSync();
  try {
    if (recifrarPendiente) {
      estado = await sync.recifrar(estado, recifrarPendiente.vieja, clave, config.salDrive);
      recifrarPendiente = null;
    }
    const r = await sync.sincronizar(estado, clave, config.salDrive);
    estado = r.estado;
    otraClaveEnDrive = false;
    await persistir();
    if (r.desdeRemoto > 0) programarArchivo(300);
    config.ultimaSync = new Date().toISOString();
    await guardarConfig();
    if (!silencioso || r.desdeRemoto > 0) aviso(`Sincronizado con ${MODO_PC ? 'el celular' : 'el PC'}: ${r.desdeRemoto} cambios recibidos, ${r.haciaRemoto} enviados.`);
    repintar();
  } catch (e) {
    if (e instanceof sync.OtraClave) {
      if (MODO_PC) {
        otraClaveEnDrive = true;
        if (!silencioso) aviso('La copia de Drive está cifrada con otra clave. Mira Datos → Celular.', 'alerta');
        repintar();
      } else {
        salPendiente = e.sal;
        pantalla = 'claveNueva';
        if ($('#dialogo').open) $('#dialogo').close();
        pintar();
      }
    } else if (!silencioso || !(e instanceof sync.SinAcceso)) aviso(e.message, 'error');
  } finally {
    sincronizando = false;
    pintarEstadoSync();
  }
}

function pintarEstadoSync() {
  const el = $('#estado-sync');
  if (!el) return;
  const partes = [];
  if (pantalla) { el.replaceChildren(); return; }
  if (!MODO_PC) partes.push(etiqueta('Cifrado en este celular', 'ok'));
  else if (archivo.ok) partes.push(etiqueta(archivo.guardando ? 'Guardando…' : proteccion.protegida ? 'Guardado y cifrado en el PC' : 'Guardado en el PC', 'ok'));
  else partes.push(etiqueta('Solo en este navegador', archivo.error ? 'alerta' : ''));
  if (proteccion.protegida && proteccion.abierta) partes.push(h('button', { class: 'boton pequeno', onclick: () => bloquearAhora() }, 'Bloquear'));
  if (syncConfigurada()) {
    if (!navigator.onLine) partes.push(etiqueta('Drive: sin conexión', 'alerta'));
    else if (sincronizando) partes.push(etiqueta('Drive: sincronizando…'));
    else if (!sync.hayAcceso()) partes.push(h('button', { class: 'boton pequeno', onclick: async () => { if (await conectarDrive()) sincronizarAhora(); } }, 'Conectar Drive'));
  }
  el.replaceChildren(...partes);
}

// ---------------------------------------------------------------------------------------------
// Formulario genérico
// ---------------------------------------------------------------------------------------------

function opcionesMovimientos(seleccionado) {
  const movs = M.vivos(estado.movimientos).filter((m) => m.tipo === 'salida' && !m.interno).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return [h('option', { value: '' }, '— sin vincular —'), ...movs.map((m) => h('option', { value: m.id, selected: m.id === seleccionado }, `${m.fecha} · ${m.descripcion} · ${dinero(m.monto, m.moneda)}`))];
}

function selectReferencia(id, nombre, lista, etiquetaDe, valor) {
  return h('select', { id, name: nombre }, h('option', { value: '' }, '—'), lista.map((x) => h('option', { value: x.id, selected: x.id === valor }, etiquetaDe(x))));
}

/** Reparto de un ingreso en varias partes (destino + importe o %). Se lee con leerReparto(). */
function controlReparto(valor) {
  const caja = h('div', { class: 'reparto', 'data-reparto': '1' });
  const metas = M.vivos(estado.metas);
  const fila = (p = {}) => {
    const destino = h('select', { 'aria-label': 'Destino' }, M.DESTINOS.map((d) => h('option', { value: d, selected: d === (p.destino || 'necesidades personales') }, d)));
    const texto = h('input', { type: 'text', placeholder: 'Escribe el destino', maxlength: 80, 'aria-label': 'Otro destino' });
    texto.value = p.texto || '';
    const meta = h('select', { 'aria-label': 'Meta' }, h('option', { value: '' }, '— meta —'), metas.map((m) => h('option', { value: m.id, selected: m.id === p.meta }, m.nombre)));
    const monto = h('input', { type: 'number', step: 'any', min: 0, inputmode: 'decimal', placeholder: 'Importe', 'aria-label': 'Importe' });
    monto.value = p.monto ?? '';
    const pct = h('input', { type: 'number', step: 'any', min: 0, max: 100, inputmode: 'decimal', placeholder: '%', 'aria-label': 'Porcentaje' });
    pct.value = p.pct ?? '';
    const ajustar = () => { texto.hidden = destino.value !== 'otros'; meta.hidden = destino.value !== 'meta'; };
    destino.addEventListener('change', ajustar);
    ajustar();
    const quitar = h('button', { type: 'button', class: 'boton pequeno', 'aria-label': 'Quitar esta parte' }, '×');
    const f = h('div', { class: 'reparto-fila' }, destino, texto, meta, monto, pct, quitar);
    quitar.addEventListener('click', () => f.remove());
    f._leer = () => ({ destino: destino.value, texto: texto.value.trim() || null, meta: meta.value || null, monto: monto.value === '' ? null : Number(monto.value), pct: pct.value === '' ? null : Number(pct.value) });
    return f;
  };
  const filas = h('div', {});
  for (const p of Array.isArray(valor) ? valor : []) filas.append(fila(p));
  caja.append(filas, h('button', { type: 'button', class: 'boton pequeno', onclick: () => filas.append(fila()) }, '+ Añadir parte'),
    h('small', {}, 'Reparte el ingreso: en cada parte pon un importe o un %. Ahorro y meta pasan solos a Ahorro y a la meta; el resto se ve en el presupuesto.'));
  return caja;
}

const leerReparto = (form) => {
  const caja = form.querySelector('[data-reparto]');
  if (!caja) return null;
  const partes = [...caja.querySelectorAll('.reparto-fila')].map((f) => f._leer()).filter((p) => p.monto || p.pct);
  return partes.length ? partes : null;
};

function opcionesP2P(seleccionado) {
  const movs = M.vivos(estado.movimientos).filter((m) => Number(m.cupPagados) > 0).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return [h('option', { value: '' }, '—'), ...movs.map((m) => h('option', { value: m.id, selected: m.id === seleccionado }, `${m.fecha} · ${m.vendedor || m.descripcion} · ${dinero(m.cupPagados, 'CUP')}`))];
}

function campoFormulario(coleccion, campo, valor) {
  const id = `c-${campo.k}`;
  let control;
  if (campo.t === 'select') {
    control = h('select', { id, name: campo.k }, h('option', { value: '' }, '—'), campo.op.map((o) => h('option', { value: o, selected: o === valor }, (campo.etq && campo.etq[o]) || o)));
  } else if (campo.t === 'reparto') {
    control = controlReparto(valor);
  } else if (campo.t === 'p2p') {
    control = h('select', { id, name: campo.k }, opcionesP2P(valor));
  } else if (campo.t === 'factura') {
    control = selectReferencia(id, campo.k, M.vivos(estado.facturas).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)), (f) => `${f.fecha} · ${f.proveedor} · ${dinero(M.totalFactura(f).total, f.moneda)}`, valor);
  } else if (campo.t === 'entrada') {
    const movs = M.vivos(estado.movimientos).filter((m) => m.tipo === 'entrada' && !m.interno).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    control = selectReferencia(id, campo.k, movs, (m) => `${m.fecha} · ${m.descripcion} · ${dinero(m.monto, m.moneda)}`, valor);
  } else if (campo.t === 'cuenta') {
    control = selectReferencia(id, campo.k, M.vivos(estado.cuentas), (c) => `${c.nombre} (${c.moneda})`, valor);
  } else if (campo.t === 'deuda') {
    control = selectReferencia(id, campo.k, M.vivos(estado.deudas), (d) => d.acreedor, valor);
  } else if (campo.t === 'meta') {
    control = selectReferencia(id, campo.k, M.vivos(estado.metas), (m) => m.nombre, valor);
  } else if (campo.t === 'movimiento') {
    control = h('select', { id, name: campo.k }, opcionesMovimientos(valor));
  } else if (campo.t === 'textarea') {
    control = h('textarea', { id, name: campo.k, rows: 3, maxlength: 2000 });
    control.value = valor ?? '';
  } else if (campo.t === 'checkbox') {
    control = h('input', { id, name: campo.k, type: 'checkbox' });
    control.checked = !!valor;
  } else {
    const tipo = { number: 'number', date: 'date', time: 'time', url: 'url' }[campo.t] || 'text';
    control = h('input', { id, name: campo.k, type: tipo, maxlength: campo.max || 2000, autocomplete: 'off' });
    if (campo.t === 'number') {
      control.step = 'any';
      control.inputMode = 'decimal';
      if (campo.min !== undefined) control.min = campo.min;
    }
    if (campo.patron) control.pattern = campo.patron;
    if (campo.sug) control.setAttribute('list', `lista-${campo.k}`);
    control.value = valor ?? '';
  }
  if (campo.req && campo.t !== 'reparto') control.required = true;
  return h('div', { class: `campo ${campo.t === 'checkbox' ? 'campo-check' : ''}`, 'data-campo': campo.k },
    campo.t === 'checkbox' ? [control, h('label', { for: id }, campo.l)] : [h('label', { for: id }, campo.l, campo.req ? ' *' : ''), control],
    campo.sug ? h('datalist', { id: `lista-${campo.k}` }, campo.sug.map((s) => h('option', { value: s }))) : null,
    campo.ayuda ? h('small', {}, campo.ayuda) : null,
  );
}

function leerFormulario(form, coleccion) {
  const datos = {};
  for (const campo of M.CAMPOS[coleccion]) {
    if (campo.t === 'reparto') { datos[campo.k] = leerReparto(form); continue; }
    const el = form.elements[campo.k];
    if (!el) continue;
    if (campo.t === 'checkbox') datos[campo.k] = el.checked;
    else if (campo.t === 'number') datos[campo.k] = el.value === '' ? null : Number(el.value);
    else datos[campo.k] = el.value === '' ? null : el.value.trim();
  }
  return datos;
}

const TITULOS = {
  cuentas: 'cuenta', movimientos: 'movimiento', suscripciones: 'gasto fijo o suscripción', facturas: 'factura',
  paquetes: 'paquete', tasasBancus: 'tasa de Bancus', tasasToque: 'tasa de El Toque', tasasEUR: 'tasa del euro',
  personales: 'apunte personal', notas: 'nota', ahorros: 'aporte o retiro de ahorro', metas: 'meta', deudas: 'deuda',
  inversiones: 'inversión', activosPasivos: 'activo o pasivo', ajustes: 'ajustes',
  articulos: 'artículo para revender', hormigas: 'gasto hormiga', gastosNegocio: 'gasto de negocio',
};

function abrirFormulario(coleccion, registro = null, valoresIniciales = {}) {
  const dlg = $('#dialogo');
  const datos = { ...valoresIniciales, ...(registro || {}) };
  const form = h('form', { method: 'dialog', class: 'formulario', novalidate: true });
  form.append(h('h2', {}, `${registro && coleccion !== 'ajustes' ? 'Editar' : coleccion === 'ajustes' ? 'Cambiar' : 'Añadir'} ${TITULOS[coleccion]}`));
  for (const campo of M.CAMPOS[coleccion]) form.append(campoFormulario(coleccion, campo, datos[campo.k]));
  const errores = h('div', { class: 'errores', role: 'alert' });
  form.append(errores);

  let notaTasa = null; // si la tasa no es la del día exacto, se anota en la nota al guardar
  if (['movimientos', 'hormigas', 'gastosNegocio'].includes(coleccion)) {
    // Tasa del día según la moneda (se congela al guardar). Si falta la del día, la verificada más cercana, marcada.
    const ponerTasa = () => {
      const f = form.elements.fecha.value;
      const mon = form.elements.moneda.value;
      if (f && mon && !form.elements.tasa.value) {
        const t = M.tasaSugerida(estado, mon, f);
        if (t) {
          form.elements.tasa.value = t.valor;
          notaTasa = t.exacta ? null : `Tasa aproximada: no hay tasa de ${mon} del ${f}; se usó la del ${t.fecha}.`;
        }
      }
    };
    if (form.elements.cuenta && coleccion === 'movimientos') {
      form.elements.cuenta.addEventListener('change', () => {
        const c = cuentaPorId(form.elements.cuenta.value);
        if (c && !registro && !valoresIniciales.moneda) form.elements.moneda.value = c.moneda;
        ponerTasa();
      });
    }
    form.elements.fecha.addEventListener('change', ponerTasa);
    form.elements.moneda.addEventListener('change', () => { form.elements.tasa.value = ''; ponerTasa(); });
    queueMicrotask(ponerTasa);
  }
  if (coleccion === 'movimientos') {
    // Entradas: reparto del ingreso. Salidas: tipo de gasto en el presupuesto.
    const mostrar = () => {
      const entrada = form.elements.tipo.value === 'entrada';
      form.querySelector('[data-campo="reparto"]').hidden = !entrada;
      form.querySelector('[data-campo="tipo503020"]').hidden = entrada;
      form.querySelector('[data-campo="p2p"]').hidden = entrada;
      form.querySelector('[data-campo="cuentaCup"]').hidden = !entrada;
    };
    form.elements.tipo.addEventListener('change', mostrar);
    mostrar();
  }
  if (coleccion === 'gastosNegocio') {
    form.elements.negocio.addEventListener('change', () => {
      if (!form.elements.ambito.value) form.elements.ambito.value = /insenia|afiliad/i.test(form.elements.negocio.value) ? 'afiliados' : 'desarrollo de empresa y negocios';
    });
  }

  const borrable = registro && coleccion !== 'ajustes';
  form.append(h('div', { class: 'botones' },
    borrable ? h('button', { type: 'button', class: 'boton peligro', onclick: async () => {
      if (!confirm('¿Borrar este registro? Se borrará también en el archivo del PC.')) return;
      await borrarRegistro(coleccion, registro.id);
      await sincronizarVinculados(coleccion, { id: registro.id, borrado: true });
      dlg.close();
      pintar();
      aviso('Borrado.');
    } }, 'Borrar') : null,
    h('span', { class: 'espacio' }),
    h('button', { type: 'button', class: 'boton', onclick: () => dlg.close() }, 'Cancelar'),
    h('button', { type: 'submit', class: 'boton primario' }, 'Guardar'),
  ));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nuevos = leerFormulario(form, coleccion);
    const lista = M.erroresRegistro(coleccion, nuevos);
    if (Object.values(nuevos).filter((v) => typeof v === 'string').some(contieneTarjeta)) {
      lista.push('Has escrito un número de tarjeta completo. Por seguridad, deja solo los 4 últimos dígitos.');
    }
    if (lista.length) {
      errores.replaceChildren(...lista.map((t) => h('p', {}, t)));
      return;
    }
    if (coleccion === 'movimientos') {
      if (nuevos.tipo === 'entrada') { nuevos.tipo503020 = null; nuevos.p2p = null; } else { nuevos.reparto = null; nuevos.cuentaCup = null; }
    }
    if (notaTasa && Number(nuevos.tasa) > 0 && 'nota' in nuevos && !/aproximada/i.test(nuevos.nota || '')) nuevos.nota = [nuevos.nota, notaTasa].filter(Boolean).join(' ');
    const guardado = await guardarRegistro(coleccion, { ...nuevos, id: registro ? registro.id : datos.id || uid() });
    const extra = await sincronizarVinculados(coleccion, guardado);
    dlg.close();
    pintar(); // al momento: el Resumen y las listas reflejan lo guardado sin esperar a nada
    aviso(extra ? `Guardado. ${extra}` : 'Guardado.');
  });

  dlg.replaceChildren(form);
  dlg.showModal();
  const primero = form.querySelector('input, select, textarea');
  if (primero) primero.focus();
}

// ---------------------------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------------------------

function cabecera(titulo, ...acciones) {
  return h('div', { class: 'cabecera-vista' }, h('h1', {}, titulo), h('div', { class: 'acciones' }, acciones));
}

function tarjeta(titulo, ...contenido) {
  return h('section', { class: 'tarjeta' }, titulo ? h('h2', {}, titulo) : null, contenido);
}

const vacio = (texto) => h('p', { class: 'vacio' }, texto);
const explicacion = (texto) => h('p', { class: 'explicacion' }, texto);

function cifra(titulo, valor, detalle, tipo = '') {
  return h('div', { class: `cifra ${tipo}` }, h('span', { class: 'cifra-titulo' }, titulo), h('strong', {}, valor), detalle ? h('small', {}, detalle) : null);
}

function tabla(cabeceras, filas, pie = null) {
  return h('div', { class: 'desplazable' }, h('table', { class: 'tabla' },
    h('thead', {}, h('tr', {}, cabeceras.map((t) => h('th', {}, t)))),
    h('tbody', {}, filas),
    pie ? h('tfoot', {}, pie) : null,
  ));
}

function montoConUSD(monto, moneda, usdV, tasa, tasaNota) {
  const otra = moneda !== 'USD' && moneda !== 'USDT';
  return h('span', { class: 'monto' },
    h('strong', {}, dinero(monto, moneda)),
    otra && usdV !== null ? h('small', {}, ` ≈ ${usd(usdV)}${tasa ? ` (tasa ${numero(tasa, 4)})` : ''}${tasaNota ? ` ${tasaNota}` : ''}`) : null,
    otra && usdV === null ? h('small', { class: 'falta' }, ' sin tasa') : null,
  );
}

function selectorMes() {
  return h('input', { type: 'month', 'aria-label': 'Mes', value: filtros.mes, onchange: (e) => { filtros.mes = e.target.value || hoy().slice(0, 7); pintar(); } });
}

// ---------------------------------------------------------------------------------------------
// Vistas: Resumen
// ---------------------------------------------------------------------------------------------

function vistaBienvenida() {
  return h('div', { class: 'bienvenida' },
    h('h1', {}, 'Finanzas'),
    h('p', {}, 'Aún no hay datos. Elige cómo empezar:'),
    h('div', { class: 'botones-columna' },
      h('button', { class: 'boton primario', onclick: () => elegirArchivoImportar() }, 'Importar un archivo (informe de Muse o copia de la app)'),
      h('button', { class: 'boton', onclick: () => abrirFormulario('cuentas', null, { moneda: 'USD', saldoInicial: 0 }) }, 'Empezar creando una cuenta'),
    ),
  );
}

/** En qué se va el dinero del mes: tipo de gasto → categoría → detalle (p. ej. Formación personal → curso de inglés). */
function tarjetaEnQueSeVa(p, mesTxt) {
  const tipos = ['necesidad', 'desarrollo de negocios', 'deseo', 'ahorro', 'no aplica', 'sin clasificar'].filter((t) => p.detalle[t]);
  const destinos = Object.entries(p.porDestino).filter(([, v]) => v > 0);
  return tarjeta(`En qué se va el dinero (${mesTxt})`,
    tipos.length ? tipos.map((t) => h('details', { class: 'desglose' },
      h('summary', {}, h('span', {}, M.NOMBRES_TIPO[t] || t), h('strong', {}, usd(p.porTipo[t] || 0))),
      h('ul', { class: 'lista-simple' }, Object.entries(p.detalle[t]).sort((a, b) => b[1].total - a[1].total).map(([cat, c]) => h('li', { class: 'desglose-cat' },
        h('div', { class: 'linea-barra-texto' }, h('span', {}, cat), h('span', {}, usd(c.total))),
        Object.keys(c.sub).length ? h('ul', { class: 'desglose-sub' }, Object.entries(c.sub).sort((a, b) => b[1] - a[1]).map(([s, v]) => h('li', {}, h('span', {}, s), h('span', {}, usd(v))))) : null))))) : vacio('Sin gastos este mes.'),
    p.gananciaReventa ? explicacion(`Ganancia de compra y venta sumada a tus ingresos: ${usd(p.gananciaReventa)}.`) : null,
    destinos.length ? [h('h3', {}, 'Destino de tus ingresos'), h('ul', { class: 'lista-simple' }, destinos.map(([d, v]) => h('li', {}, h('span', {}, d), h('span', {}, usd(v)))))] : null,
  );
}

function vistaResumen() {
  const hoyF = hoy();
  const s = M.saldos(estado);
  const total = M.totalCuentasUSD(estado);
  const eur = M.deUSDaEUR(estado, total);
  const alerta = M.alertaSaldo(estado, hoyF, 30);
  const cobros = M.proximosCobros(estado, hoyF);
  const vencidos = cobros.filter((c) => c.dias < 0 && c.s.estado === 'activa');
  const proximos = cobros.filter((c) => c.dias >= 0 && c.dias <= 60);
  const pres = M.presupuesto(estado, hoyF.slice(0, 7));
  const pat = M.patrimonio(estado);
  const metas = M.vivos(estado.metas).filter((m) => m.estado !== 'cumplida').slice(0, 4);
  const facturasRevisar = M.vivos(estado.facturas).map((f) => ({ f, c: M.conciliacion(estado, f) })).filter(({ c }) => c.revisar);
  const ahorroAl = M.alertaAhorro(estado);

  return h('div', {},
    cabecera('Resumen', h('button', { class: 'boton primario', onclick: () => nuevoMovimiento() }, '+ Movimiento')),
    ahorroAl.alerta ? h('div', { class: 'banda peligro', role: 'alert' }, h('strong', {}, `Estás gastando dinero de tu ahorro. `),
      `En ${ahorroAl.cuentas.map((c) => c.nombre).join(' + ')} hay ${usd(ahorroAl.saldo)}, pero tendrías que tener ${usd(ahorroAl.apartado)} guardados para ahorro y metas. Te has pasado en ${usd(ahorroAl.falta)}.`) : null,
    alerta.falta > 0 ? h('div', { class: 'banda peligro', role: 'alert' }, h('strong', {}, 'Saldo insuficiente para los próximos cobros. '), `En los próximos 30 días se cobran ${usd(alerta.necesario)} y hay ${usd(alerta.disponible)}. Faltan ${usd(alerta.falta)}.`) : null,
    alerta.sinTasa.length ? h('div', { class: 'banda alerta' }, `Cobros sin conversión a $ (no entran en la alerta): ${alerta.sinTasa.join(', ')}. Añade la tasa en Cambio y envíos → Tasas.`) : null,
    h('div', { class: 'cifras' },
      cifra('En tus cuentas', usd(total), eur !== null ? `≈ ${dinero(eur, 'EUR')}` : null),
      cifra('Patrimonio neto', usd(pat.neto), 'cuentas + inversiones + activos − deudas', pat.neto < 0 ? 'negativo' : ''),
      cifra(`Ingresos ${hoyF.slice(0, 7)}`, usd(pres.ingresos)),
      cifra(`Gastos ${hoyF.slice(0, 7)}`, usd(pres.gastos), pres.balance < 0 ? `Balance ${usd(pres.balance)}` : `Balance ${usd(pres.balance)}`, pres.balance < 0 ? 'negativo' : ''),
    ),
    h('div', { class: 'rejilla' },
      tarjeta('Saldos',
        h('ul', { class: 'lista-simple' }, s.map((x) => h('li', {},
          h('span', {}, x.cuenta.nombre, ahorroAl.alerta && ahorroAl.cuentas.some((c) => c.id === x.cuenta.id) ? etiqueta('por debajo del ahorro', 'alerta') : null),
          // Cada moneda con su propio valor en $; si la cuenta tiene varias, el total de la cuenta va aparte.
          h('span', {}, x.monedas.map((mo, i) => [i ? h('br', {}) : null, dinero(mo.saldo, mo.moneda),
            mo.moneda === 'USD' ? null : h('small', {}, mo.usd !== null ? ` ≈ ${usd(mo.usd)}` : ' · sin tasa')]),
          x.monedas.length > 1 ? [h('br', {}), h('small', {}, `Total de la cuenta ≈ ${x.usd !== null ? usd(x.usd) : '—'}`)] : null)))),
        ahorroAl.apartado > 0 ? explicacion(`Apartado para ahorro y metas: ${usd(ahorroAl.apartado)} (debe quedar en ${ahorroAl.cuentas.map((c) => c.nombre).join(' + ') || 'la cuenta de ahorro'}).`) : null,
      ),
      tarjetaEnQueSeVa(pres, hoyF.slice(0, 7)),
      tarjeta('Próximos cobros',
        vencidos.length ? h('div', { class: 'banda alerta' }, 'Cobros con la fecha pasada (¿se cobraron?):', h('ul', {}, vencidos.map((c) => h('li', {}, `${c.s.nombre} · ${fechaLarga(c.s.proximoCobro)} `, h('button', { class: 'boton pequeno', onclick: () => marcarCobrado(c.s) }, 'Sí, pasar al siguiente'))))) : null,
        proximos.length ? h('ul', { class: 'lista-simple' }, proximos.map((c) => h('li', { class: c.dias <= (c.s.avisoDias ?? 5) ? 'pronto' : '' },
          h('span', {}, c.s.nombre, c.s.estado !== 'activa' ? etiqueta(c.s.estado, 'alerta') : null),
          h('span', {}, dinero(c.s.monto, c.s.moneda), h('small', {}, c.dias === 0 ? ' · hoy' : ` · en ${c.dias} días`))))) : vacio('No hay cobros en los próximos 60 días.'),
      ),
      tarjeta(`Presupuesto 20-30-30-20 de ${hoyF.slice(0, 7)}`,
        pres.ingresos > 0 ? pres.filas.map((f) => h('div', { class: 'linea-barra' },
          h('div', { class: 'linea-barra-texto' }, h('span', {}, `${f.nombre} (${numero(f.pct)} %)`), h('span', {}, `${usd(f.real)} de ${usd(f.objetivo)}`)),
          barra(f.objetivo > 0 ? (f.real / f.objetivo) * 100 : 0, f.clave !== 'ahorro' && f.real > f.objetivo ? 'peligro' : ''))) : vacio('Sin ingresos registrados este mes.'),
        pres.sinClasificar.length ? h('p', {}, h('button', { class: 'enlace', onclick: () => irA('diario', 'presupuesto') }, `${pres.sinClasificar.length} gastos sin clasificar`)) : null,
      ),
      tarjeta('Metas',
        metas.length ? metas.map((m) => {
          const e = M.estadoMeta(estado, m, hoyF);
          return h('div', { class: 'linea-barra' }, h('div', { class: 'linea-barra-texto' }, h('span', {}, m.nombre), h('span', {}, `${pct(e.pct)} · ${e.estadoMes}`)), barra(e.pct, 'ok'));
        }) : vacio('Sin metas. Añádelas en Ahorro y patrimonio → Metas.'),
      ),
      tarjeta('Facturas por revisar',
        facturasRevisar.length ? h('ul', { class: 'lista-simple' }, facturasRevisar.map(({ f, c }) => h('li', {},
          h('span', {}, `${f.proveedor} · ${fechaLarga(f.fecha)}`),
          h('span', {},
            c.impuestosPendientes ? etiqueta('impuestos pendientes', 'alerta') : null,
            !c.mov ? etiqueta('sin cargo vinculado', 'alerta') : null,
            c.diferencia && !c.soloCambio ? etiqueta(`diferencia ${usd(c.diferencia)}${c.tasaAproximada ? ' (tasa aproximada)' : ''}`, 'alerta') : null)))) : vacio('Todas las facturas cuadran con su cargo.'),
      ),
    ),
  );
}

async function marcarCobrado(s) {
  const siguiente = sumarPeriodo(s.proximoCobro, s.frecuencia);
  await guardarRegistro('suscripciones', { ...s, proximoCobro: siguiente });
  aviso(`${s.nombre}: próximo cobro movido al ${fechaLarga(siguiente)}.`);
  repintar();
}

// ---------------------------------------------------------------------------------------------
// Vistas: Día a día
// ---------------------------------------------------------------------------------------------

function filaMovimiento(m) {
  const c = cuentaPorId(m.cuenta);
  const usdV = M.usdMovimiento(m);
  const abrir = () => abrirFormulario('movimientos', m);
  return h('li', { class: `fila ${m.tipo}`, tabindex: 0, onclick: abrir, onkeydown: (e) => { if (e.key === 'Enter') abrir(); } },
    h('div', { class: 'fila-principal' },
      h('span', { class: 'fecha' }, fechaLarga(m.fecha), m.hora ? ` ${m.hora}` : ''),
      h('span', { class: 'descripcion' }, m.descripcion),
      h('span', { class: `importe ${m.tipo}` }, m.tipo === 'entrada' ? '+' : '−', montoConUSD(m.monto, m.moneda, usdV, m.tasa)),
    ),
    h('div', { class: 'fila-detalle' },
      c ? etiqueta(c.nombre) : etiqueta('sin cuenta', 'alerta'),
      m.retencion ? etiqueta('retención de Bancus (no cuenta)') : m.interno ? etiqueta('interno') : m.ambito ? etiqueta(m.ambito) : etiqueta('sin ámbito', 'alerta'),
      m.categoria ? etiqueta(m.categoria) : null,
      m.subcategoria ? etiqueta(m.subcategoria) : null,
      !m.interno && !m.retencion && m.tipo === 'salida' ? (m.tipo503020 ? etiqueta(M.NOMBRES_TIPO[m.tipo503020] || m.tipo503020) : etiqueta('sin tipo de gasto', 'alerta')) : null,
      M.repartoMovimiento(m).map((p) => etiqueta(`→ ${p.destino === 'otros' ? p.texto || 'otros' : p.destino === 'meta' ? `meta ${(M.vivos(estado.metas).find((x) => x.id === p.meta) || {}).nombre || ''}` : p.destino}: ${dinero(p.montoMoneda, m.moneda)}`, 'ok')),
      m.deuda ? etiqueta('pago de deuda') : null,
      m.verificado ? etiqueta('verificado', 'ok') : etiqueta('no verificado'),
      m.dispositivo === 'muse' ? etiqueta('vía Muse') : null,
      /aproximada/i.test(m.nota || '') ? etiqueta('tasa aproximada', 'alerta') : null,
    ),
  );
}

/** Triple reporte de Bancus: retención + liberación + pago oficial. Solo el pago oficial es gasto. */
function avisoTriples() {
  const triples = M.triplesBancus(estado);
  if (!triples.length) return null;
  return h('div', { class: 'banda alerta' },
    h('strong', {}, 'Posible triple reporte de Bancus. '),
    'Bancus a veces apunta una compra 3 veces: retención, liberación y pago oficial. Solo el último es el gasto real. Revisa y confirma:',
    h('ul', {}, triples.map((t) => h('li', {},
      `${fechaLarga(t.oficial.fecha)} · ${t.oficial.descripcion} · ${dinero(t.oficial.monto, t.oficial.moneda)} `,
      h('button', { class: 'boton pequeno', onclick: async () => {
        for (const m of t.retencion) await guardarRegistro('movimientos', { ...m, retencion: true, interno: false });
        await guardarRegistro('movimientos', { ...t.oficial, retencion: false, interno: false });
        aviso('Hecho: queda solo el pago oficial como gasto.');
        repintar();
      } }, 'Sí, contar solo el pago oficial')))));
}

function vistaMovimientos() {
  const lista = M.vivos(estado.movimientos)
    .filter((m) => !filtros.cuenta || m.cuenta === filtros.cuenta)
    .filter((m) => !filtros.ambito || (filtros.ambito === 'interno' ? m.interno : m.ambito === filtros.ambito))
    .filter((m) => !filtros.desde || m.fecha >= filtros.desde)
    .filter((m) => !filtros.hasta || m.fecha <= filtros.hasta)
    .filter((m) => !filtros.soloPendientes || !m.verificado)
    .filter((m) => !filtros.destino || M.repartoMovimiento(m).some((p) => p.destino === filtros.destino))
    .filter((m) => !filtros.texto || `${m.descripcion} ${m.categoria} ${m.nota}`.toLowerCase().includes(filtros.texto.toLowerCase()))
    .sort((a, b) => (`${a.fecha} ${a.hora || ''}` < `${b.fecha} ${b.hora || ''}` ? 1 : -1));
  const cambiar = (k) => (e) => { filtros[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; pintar(); };
  return h('div', {},
    cabecera('Movimientos', h('button', { class: 'boton primario', onclick: () => nuevoMovimiento() }, '+ Añadir')),
    h('div', { class: 'filtros' },
      h('select', { 'aria-label': 'Cuenta', onchange: cambiar('cuenta') }, h('option', { value: '' }, 'Todas las cuentas'), M.vivos(estado.cuentas).map((c) => h('option', { value: c.id, selected: filtros.cuenta === c.id }, c.nombre))),
      h('select', { 'aria-label': 'Ámbito', onchange: cambiar('ambito') }, h('option', { value: '' }, 'Todos los ámbitos'), [...M.AMBITOS, 'interno'].map((a) => h('option', { value: a, selected: filtros.ambito === a }, a))),
      h('input', { type: 'date', 'aria-label': 'Desde', value: filtros.desde, onchange: cambiar('desde') }),
      h('input', { type: 'date', 'aria-label': 'Hasta', value: filtros.hasta, onchange: cambiar('hasta') }),
      h('input', { type: 'search', placeholder: 'Buscar…', 'aria-label': 'Buscar', value: filtros.texto, onchange: cambiar('texto') }),
      h('select', { 'aria-label': 'Destino del ingreso', onchange: cambiar('destino') }, h('option', { value: '' }, 'Cualquier destino'), M.DESTINOS.map((d) => h('option', { value: d, selected: filtros.destino === d }, d))),
      h('label', { class: 'campo-check' }, h('input', { type: 'checkbox', checked: filtros.soloPendientes, onchange: cambiar('soloPendientes') }), 'Solo no verificados'),
    ),
    avisoTriples(),
    h('p', { class: 'contador' }, `${lista.length} movimientos`),
    lista.length ? h('ul', { class: 'filas' }, lista.map(filaMovimiento)) : vacio('No hay movimientos con estos filtros.'),
  );
}

function vistaFacturas() {
  const texto = (filtros.textoFacturas || '').toLowerCase();
  const lista = M.vivos(estado.facturas)
    .filter((f) => !texto || `${f.proveedor} ${f.concepto} ${f.numero} ${f.nota}`.toLowerCase().includes(texto))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const grupos = new Map();
  for (const f of lista) {
    const k = f.proveedor || 'Sin proveedor';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  return h('div', {},
    cabecera('Facturas', h('button', { class: 'boton primario', onclick: () => abrirFormulario('facturas', null, { fecha: hoy(), moneda: 'USD' }) }, '+ Añadir')),
    explicacion('Agrupadas por servicio, igual que las carpetas de Drive (Finanzas/Facturas). Las que sube Muse llegan solas cuando Jarvis las procesa.'),
    h('div', { class: 'filtros' }, h('input', { type: 'search', placeholder: 'Buscar proveedor, concepto o número…', 'aria-label': 'Buscar facturas', value: filtros.textoFacturas || '', onchange: (e) => { filtros.textoFacturas = e.target.value; pintar(); } })),
    grupos.size ? [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([prov, fs]) => tarjeta(`${prov} (${fs.length})`,
      h('ul', { class: 'filas' }, fs.map((f) => {
        const c = M.conciliacion(estado, f);
        return h('li', { class: 'fila', tabindex: 0, onclick: () => abrirFormulario('facturas', f) },
          h('div', { class: 'fila-principal' },
            h('span', { class: 'fecha' }, fechaLarga(f.fecha)),
            h('span', { class: 'descripcion' }, f.concepto || f.proveedor, f.numero ? h('small', {}, ` · ${f.numero}`) : null),
            h('span', { class: 'importe' }, h('strong', {}, dinero(c.total, f.moneda))),
          ),
          h('div', { class: 'fila-detalle' },
            h('small', {}, `Producto ${dinero(f.base, f.moneda)} + impuestos ${c.impuestosPendientes ? 'pendientes' : dinero(f.impuestos, f.moneda)} = ${dinero(c.total, f.moneda)}`),
            c.impuestosPendientes ? etiqueta('impuestos pendientes', 'alerta') : null,
            c.mov ? etiqueta(`cargo ${usd(c.cargoUSD)}`, 'ok') : etiqueta('sin cargo vinculado', 'alerta'),
            c.diferencia && c.impuestosPendientes && c.diferencia > 0 ? etiqueta(`diferencia con el cargo ${usd(c.diferencia)}: probablemente los impuestos${c.tasaAproximada ? ' (tasa aproximada)' : ''}`, 'alerta') : null,
            c.diferencia && c.soloCambio && !c.impuestosPendientes ? etiqueta(`diferencia ${usd(c.diferencia)} por tasa aproximada`) : null,
            c.diferencia && !c.soloCambio && !c.impuestosPendientes ? etiqueta(`diferencia con el cargo ${usd(c.diferencia)}${c.tasaAproximada ? ' (tasa aproximada)' : ''}`, 'alerta') : null,
            f.ambito ? etiqueta(f.ambito) : null,
            f.dispositivo === 'muse' || f.dispositivo === 'tarea-facturas' ? etiqueta('vía Muse') : null,
            f.enlace ? h('a', { href: f.enlace, class: 'boton pequeno', onclick: (e) => e.stopPropagation() }, 'Abrir archivo') : null,
          ),
        );
      })))) : vacio('No hay facturas.'),
  );
}

function vistaFijos() {
  const hoyF = hoy();
  const lista = M.vivos(estado.suscripciones).sort((a, b) => String(a.proximoCobro || '9999').localeCompare(String(b.proximoCobro || '9999')));
  const mensual = M.gastosFijosMensuales(estado);
  return h('div', {},
    cabecera('Gastos fijos y suscripciones', h('button', { class: 'boton primario', onclick: () => abrirFormulario('suscripciones', null, { frecuencia: 'mensual', estado: 'activa', avisoDias: 5, moneda: 'USD', tipo503020: 'necesidad' }) }, '+ Añadir')),
    h('div', { class: 'cifras' }, cifra('Coste fijo al mes (activos)', usd(mensual.total), 'los anuales se reparten entre 12 meses')),
    mensual.sinTasa.length ? h('div', { class: 'banda alerta' }, `Sin tasa para convertir a $: ${mensual.sinTasa.join(', ')}.`) : null,
    lista.length ? h('ul', { class: 'filas' }, lista.map((s) => {
      const dias = s.proximoCobro ? diasEntre(hoyF, s.proximoCobro) : null;
      return h('li', { class: 'fila', tabindex: 0, onclick: () => abrirFormulario('suscripciones', s) },
        h('div', { class: 'fila-principal' },
          h('span', { class: 'descripcion' }, s.nombre),
          h('span', {}, `${dinero(s.monto, s.moneda)} / ${s.frecuencia === 'anual' ? 'año' : s.frecuencia === 'semanal' ? 'semana' : 'mes'}`),
        ),
        h('div', { class: 'fila-detalle' },
          etiqueta(s.estado || 'activa', s.estado === 'activa' ? 'ok' : 'alerta'),
          s.categoria ? etiqueta(s.categoria) : null,
          s.tipo503020 ? etiqueta(s.tipo503020) : null,
          s.ambito ? etiqueta(s.ambito) : null,
          s.proximoCobro ? etiqueta(dias < 0 ? `fecha pasada (${fechaLarga(s.proximoCobro)})` : dias === 0 ? 'se cobra hoy' : `próximo cobro ${fechaLarga(s.proximoCobro)} · faltan ${dias} días`, dias !== null && dias <= (s.avisoDias ?? 5) ? 'alerta' : '') : etiqueta('fecha de cobro sin confirmar', 'alerta'),
          s.nota ? h('small', { class: 'nota' }, s.nota) : null,
          s.proximoCobro && dias <= 0 ? h('button', { class: 'boton pequeno', onclick: (e) => { e.stopPropagation(); marcarCobrado(s); } }, 'Marcar cobrado') : null,
        ),
      );
    })) : vacio('No hay gastos fijos ni suscripciones.'),
  );
}

function vistaPresupuesto() {
  const p = M.presupuesto(estado, filtros.mes);
  const aj = M.ajustes(estado);
  return h('div', {},
    cabecera('Presupuesto 20-30-30-20', selectorMes(), h('button', { class: 'boton', onclick: () => abrirFormulario('ajustes', { ...aj }, {}) }, 'Cambiar porcentajes')),
    explicacion(`De lo que ingresas en el mes: ${numero(aj.pctNecesidades)} % necesidades personales, ${numero(aj.pctNegocio)} % desarrollo de negocios, ${numero(aj.pctDeseos)} % deseos y ${numero(aj.pctAhorro)} % ahorro. Cada gasto se clasifica en su movimiento («Tipo de gasto»); cada ingreso puede repartirse («Para qué va este ingreso»). No cuentan los movimientos internos, las retenciones de Bancus ni las compras y ventas para revender (su ganancia sí entra como ingreso).`),
    h('div', { class: 'cifras' }, cifra('Ingresos del mes', usd(p.ingresos)), cifra('Gastos del mes', usd(p.gastos)), cifra('Balance', usd(p.balance), null, p.balance < 0 ? 'negativo' : '')),
    p.sinConvertir ? h('div', { class: 'banda alerta' }, `${p.sinConvertir} movimientos sin tasa no entran en las cuentas.`) : null,
    tarjeta('Objetivo y real',
      tabla(['Partida', '% objetivo', 'Objetivo', 'Asignado a los ingresos', 'Gastado / apartado', '% real', 'Diferencia', ''], p.filas.map((f) => h('tr', {},
        h('td', {}, f.nombre), h('td', {}, pct(f.pct)), h('td', {}, usd(f.objetivo)), h('td', {}, usd(f.asignado)), h('td', {}, usd(f.real)), h('td', {}, pct(f.pctReal)),
        h('td', { class: f.clave !== 'ahorro' && f.diferencia < 0 ? 'negativo' : '' }, usd(f.diferencia)),
        h('td', { class: 'celda-barra' }, barra(f.objetivo > 0 ? (f.real / f.objetivo) * 100 : 0, f.clave !== 'ahorro' && f.real > f.objetivo ? 'peligro' : ''))))),
      explicacion(`«Asignado» = lo que repartiste de tus ingresos a cada partida (necesidades incluye «pagado a mí»; negocios incluye «compra y venta»). Ahorro real = lo apartado en Ahorro + partes «ahorro» y «meta» de los ingresos + gastos marcados como ahorro. Formación: ${usd(p.formacion)} · inversiones ${usd(p.inversion)}.`),
    ),
    tarjetaEnQueSeVa(p, filtros.mes),
    tarjeta(`Gastos sin clasificar (${p.sinClasificar.length})`,
      p.sinClasificar.length ? h('ul', { class: 'lista-simple' }, p.sinClasificar.map((m) => h('li', {},
        h('span', {}, `${fechaLarga(m.fecha)} · ${m.descripcion} · ${usd(M.usdMovimiento(m))}`),
        h('span', { class: 'botones-linea' }, M.TIPOS_503020.map((t) => h('button', { class: 'boton pequeno', onclick: async () => { await guardarRegistro('movimientos', { ...m, tipo503020: t }); repintar(); } }, M.NOMBRES_TIPO[t] || t)))))) : vacio('Todos los gastos del mes están clasificados.'),
    ),
    tarjeta('Por categoría',
      Object.keys(p.porCategoria).length ? tabla(['Categoría', 'Gasto'], Object.entries(p.porCategoria).sort((a, b) => b[1] - a[1]).map(([c, v]) => h('tr', {}, h('td', {}, c), h('td', {}, usd(v))))) : vacio('Sin gastos este mes.'),
    ),
  );
}

function vistaPersonal() {
  const totales = M.totalesPersonales(estado);
  const lista = M.vivos(estado.personales).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return h('div', {},
    cabecera('Apuntes personales (antiguos)', h('button', { class: 'boton primario', onclick: () => abrirFormulario('personales', null, { fecha: hoy(), tipo: 'gasto', moneda: 'USD' }) }, '+ Apunte')),
    explicacion('Esta sección se conserva para los apuntes antiguos. Lo nuevo va en Movimientos con el ámbito «personal».'),
    tarjeta('Totales por mes', Object.keys(totales).length ? tabla(['Mes', 'Moneda', 'Ingresos', 'Gastos', 'Resultado'],
      Object.entries(totales).sort((a, b) => b[0].localeCompare(a[0])).flatMap(([mesTxt, porMoneda]) => Object.entries(porMoneda).map(([mon, t]) =>
        h('tr', {}, h('td', {}, mesTxt), h('td', {}, mon), h('td', {}, dinero(t.ingresos, mon)), h('td', {}, dinero(t.gastos, mon)), h('td', {}, dinero(redondear(t.ingresos - t.gastos), mon))))))
      : vacio('Sin apuntes.')),
    lista.length ? h('ul', { class: 'filas' }, lista.map((p) => h('li', { class: `fila ${p.tipo === 'ingreso' ? 'entrada' : 'salida'}`, tabindex: 0, onclick: () => abrirFormulario('personales', p) },
      h('div', { class: 'fila-principal' }, h('span', { class: 'fecha' }, fechaLarga(p.fecha)), h('span', { class: 'descripcion' }, p.concepto), h('span', { class: 'importe' }, p.tipo === 'ingreso' ? '+' : '−', dinero(p.monto, p.moneda)))))) : null,
  );
}

// ---------------------------------------------------------------------------------------------
// Vistas: Ahorro y patrimonio
// ---------------------------------------------------------------------------------------------

function vistaAhorro() {
  const t = M.totalesAhorro(estado);
  const aj = M.ajustes(estado);
  const prom = M.promedios(estado);
  const objetivoFondo = prom.gastos > 0 ? redondear(prom.gastos * Number(aj.fondoEmergenciaMeses || 6)) : null;
  const lista = M.vivos(estado.ahorros).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const metas = Object.fromEntries(M.vivos(estado.metas).map((m) => [m.id, m.nombre]));
  return h('div', {},
    cabecera('Ahorro y fondo de emergencia', h('button', { class: 'boton primario', onclick: () => abrirFormulario('ahorros', null, { fecha: hoy(), tipo: 'aporte', destino: 'ahorro', moneda: 'USD' }) }, '+ Aporte o retiro')),
    explicacion('Aquí apuntas el dinero que apartas. No se suma otra vez al patrimonio: ese dinero sigue estando en tus cuentas.'),
    h('div', { class: 'cifras' },
      cifra('Ahorro total apartado', usd(t.total)),
      cifra('Fondo de emergencia', usd(t['fondo de emergencia']), objetivoFondo ? `objetivo ${usd(objetivoFondo)} (${numero(aj.fondoEmergenciaMeses)} meses de gastos)` : 'el objetivo se calcula con tus gastos de meses anteriores'),
      cifra('Para metas', usd(t.meta)),
      cifra(`Este mes (${hoy().slice(0, 7)})`, usd(M.ahorroMes(estado, hoy().slice(0, 7)))),
    ),
    objetivoFondo ? tarjeta('Fondo de emergencia', barra((t['fondo de emergencia'] / objetivoFondo) * 100, 'ok'), explicacion(`${pct(redondear((t['fondo de emergencia'] / objetivoFondo) * 100))} del objetivo.`)) : null,
    tarjeta('Aportes y retiros',
      lista.length ? h('ul', { class: 'filas' }, lista.map((a) => h('li', { class: `fila ${a.tipo === 'retiro' ? 'salida' : 'entrada'}`, tabindex: 0, onclick: () => abrirFormulario('ahorros', a) },
        h('div', { class: 'fila-principal' }, h('span', { class: 'fecha' }, fechaLarga(a.fecha)), h('span', { class: 'descripcion' }, a.concepto), h('span', { class: 'importe' }, a.tipo === 'retiro' ? '−' : '+', dinero(a.monto, a.moneda))),
        h('div', { class: 'fila-detalle' }, etiqueta(a.destino || 'ahorro'), a.meta && metas[a.meta] ? etiqueta(metas[a.meta]) : null)))) : vacio('Aún no has apuntado ahorros.'),
    ),
  );
}

function vistaMetas() {
  const hoyF = hoy();
  const lista = M.vivos(estado.metas);
  return h('div', {},
    cabecera('Metas', h('button', { class: 'boton primario', onclick: () => abrirFormulario('metas', null, { moneda: 'USD', estado: 'activa' }) }, '+ Meta')),
    explicacion('Cada meta calcula cuánto te falta, cuánto ahorrar al mes y qué ingreso mensual necesitas (gastos + ahorro) frente a tu ingreso medio de los últimos meses. Los aportes se apuntan en Ahorro con destino «meta».'),
    lista.length ? h('div', { class: 'rejilla' }, lista.map((m) => {
      const e = M.estadoMeta(estado, m, hoyF);
      return tarjeta(m.nombre,
        h('div', { class: 'linea-barra-texto' }, h('span', {}, `${dinero(e.ahorrado, m.moneda)} de ${dinero(m.objetivo, m.moneda)}`), h('strong', {}, pct(e.pct))),
        barra(e.pct, 'ok'),
        h('ul', { class: 'lista-simple' },
          h('li', {}, h('span', {}, 'Pendiente'), h('strong', {}, dinero(e.pendiente, m.moneda))),
          h('li', {}, h('span', {}, 'Fecha límite'), h('span', {}, m.fechaLimite ? `${fechaLarga(m.fechaLimite)}${e.vencida ? ' (vencida)' : ` · ${e.mesesRestantes} meses`}` : 'sin fecha')),
          h('li', {}, h('span', {}, 'Ahorro mensual necesario'), h('span', {}, e.mensualNecesario !== null ? dinero(e.mensualNecesario, m.moneda) : '—')),
          h('li', {}, h('span', {}, 'Ahorrado este mes'), h('span', {}, dinero(e.esteMes, m.moneda), ' ', e.estadoMes ? etiqueta(e.estadoMes, /Cumpl/.test(e.estadoMes) ? 'ok' : 'alerta') : null)),
          h('li', {}, h('span', {}, 'Plan: ingreso necesario al mes'), h('span', {}, e.ingresoNecesario !== null ? usd(e.ingresoNecesario) : '—')),
          h('li', {}, h('span', {}, 'Ingreso medio actual'), h('span', {}, usd(e.ingresoActual))),
          h('li', {}, h('span', {}, 'Brecha al mes'), h('strong', { class: e.brecha > 0 ? 'negativo' : '' }, e.brecha !== null ? usd(e.brecha) : '—')),
        ),
        e.aportesOtraMoneda ? explicacion(`${e.aportesOtraMoneda} aportes en otra moneda no se suman a esta meta.`) : null,
        h('div', { class: 'botones' },
          h('button', { class: 'boton pequeno primario', onclick: () => abrirFormulario('ahorros', null, { fecha: hoy(), tipo: 'aporte', destino: 'meta', meta: m.id, moneda: m.moneda, concepto: `Aporte a ${m.nombre}` }) }, '+ Aporte'),
          h('button', { class: 'boton pequeno', onclick: () => abrirFormulario('metas', m) }, 'Editar')),
      );
    })) : vacio('Aún no hay metas.'),
  );
}

function vistaDeudas() {
  const lista = M.vivos(estado.deudas);
  const totalUSD = redondear(lista.reduce((s, d) => s + (M.estadoDeuda(estado, d).pendienteUSD || 0), 0));
  return h('div', {},
    cabecera('Deudas', h('button', { class: 'boton primario', onclick: () => abrirFormulario('deudas', null, { moneda: 'USD' }) }, '+ Deuda')),
    explicacion('Los pagos se apuntan como movimientos de salida con el campo «Pago de una deuda»: así descuentan de lo pendiente.'),
    h('div', { class: 'cifras' }, cifra('Pendiente total', usd(totalUSD), null, totalUSD > 0 ? 'negativo' : '')),
    lista.length ? h('div', { class: 'rejilla' }, lista.map((d) => {
      const e = M.estadoDeuda(estado, d);
      return tarjeta(d.acreedor,
        h('div', { class: 'linea-barra-texto' }, h('span', {}, `Pagado ${dinero(e.pagado, d.moneda)} de ${dinero(d.importeTotal, d.moneda)}`), h('strong', {}, pct(e.pct))),
        barra(e.pct, 'ok'),
        h('ul', { class: 'lista-simple' },
          h('li', {}, h('span', {}, 'Pendiente'), h('strong', {}, dinero(e.pendiente, d.moneda))),
          h('li', {}, h('span', {}, 'Cuota mensual'), h('span', {}, d.cuotaMensual ? dinero(d.cuotaMensual, d.moneda) : '—')),
          h('li', {}, h('span', {}, 'Meses que faltan (a esa cuota)'), h('span', {}, e.mesesRestantes ?? '—')),
          h('li', {}, h('span', {}, 'Interés anual'), h('span', {}, d.interesAnual ? pct(d.interesAnual) : '—')),
          h('li', {}, h('span', {}, 'Fecha fin prevista'), h('span', {}, fechaLarga(d.fechaFin))),
        ),
        e.sinConvertir ? explicacion(`${e.sinConvertir} pagos en otra moneda no se pudieron descontar.`) : null,
        h('div', { class: 'botones' },
          h('button', { class: 'boton pequeno primario', onclick: () => nuevoMovimiento({ deuda: d.id, descripcion: `Pago ${d.acreedor}`, moneda: d.moneda, monto: d.cuotaMensual || null, tipo503020: 'necesidad' }) }, 'Registrar pago'),
          h('button', { class: 'boton pequeno', onclick: () => abrirFormulario('deudas', d) }, 'Editar')),
      );
    })) : vacio('Sin deudas apuntadas.'),
  );
}

function vistaInversiones() {
  const lista = M.vivos(estado.inversiones);
  const filas = lista.map((i) => ({ i, e: M.estadoInversion(estado, i) }));
  const invUSD = redondear(filas.reduce((s, x) => s + (x.e.invertidoUSD || 0), 0));
  const valUSD = redondear(filas.reduce((s, x) => s + (x.e.valorUSD || 0), 0));
  const gan = redondear(valUSD - invUSD);
  return h('div', {},
    cabecera('Inversiones', h('button', { class: 'boton primario', onclick: () => abrirFormulario('inversiones', null, { moneda: 'USD', fechaCompra: hoy() }) }, '+ Inversión')),
    h('div', { class: 'cifras' }, cifra('Invertido', usd(invUSD)), cifra('Valor actual', usd(valUSD)), cifra('Ganancia', usd(gan), invUSD > 0 ? pct(redondear((gan / invUSD) * 100)) : null, gan < 0 ? 'negativo' : '')),
    filas.length ? tarjeta(null, tabla(['Activo', 'Tipo', 'Invertido', 'Valor actual', 'Ganancia', 'Rentabilidad', 'Dividendo/año'], filas.map(({ i, e }) => h('tr', { class: 'clicable', onclick: () => abrirFormulario('inversiones', i) },
      h('td', {}, i.activo), h('td', {}, i.tipo || '—'), h('td', {}, dinero(e.invertido, i.moneda)), h('td', {}, dinero(e.valor, i.moneda)),
      h('td', { class: e.ganancia < 0 ? 'negativo' : '' }, dinero(e.ganancia, i.moneda)), h('td', {}, pct(e.rentabilidad)), h('td', {}, i.dividendoAnual ? dinero(i.dividendoAnual, i.moneda) : '—'))))) : vacio('Sin inversiones apuntadas.'),
    explicacion('Valor actual = cantidad × precio actual (si no los pones, se toma lo invertido). Actualiza el precio cuando quieras ver cómo va.'),
  );
}

function vistaPatrimonio() {
  const p = M.patrimonio(estado);
  const lista = M.vivos(estado.activosPasivos);
  return h('div', {},
    cabecera('Activos y pasivos', h('button', { class: 'boton primario', onclick: () => abrirFormulario('activosPasivos', null, { tipo: 'activo', moneda: 'USD' }) }, '+ Activo o pasivo')),
    h('div', { class: 'cifras' }, cifra('Lo que tienes', usd(p.totalActivos)), cifra('Lo que debes', usd(p.totalPasivos)), cifra('Patrimonio neto', usd(p.neto), null, p.neto < 0 ? 'negativo' : '')),
    tarjeta('De dónde sale',
      tabla(['Concepto', 'Importe'], [
        h('tr', {}, h('td', {}, 'Cuentas'), h('td', {}, usd(p.cuentas))),
        h('tr', {}, h('td', {}, 'Inversiones (valor actual)'), h('td', {}, usd(p.inversiones))),
        h('tr', {}, h('td', {}, 'Otros activos'), h('td', {}, usd(p.activos))),
        h('tr', {}, h('td', {}, 'Deudas pendientes'), h('td', { class: 'negativo' }, `− ${usd(p.deudas)}`)),
        h('tr', {}, h('td', {}, 'Otros pasivos'), h('td', { class: 'negativo' }, `− ${usd(p.pasivos)}`)),
      ]),
      p.sinTasa.length ? h('div', { class: 'banda alerta' }, `Sin tasa para convertir a $: ${p.sinTasa.join(', ')}.`) : null,
    ),
    tarjeta('Otros activos y pasivos',
      explicacion('Un activo te da dinero o vale dinero (un local alquilado, un equipo); un pasivo te quita dinero cada mes. Rendimiento anual = (ingreso − coste mensual) × 12 ÷ valor.'),
      lista.length ? tabla(['Tipo', 'Concepto', 'Valor', 'Ingreso/mes', 'Coste/mes', 'Rendimiento anual'], lista.map((a) => h('tr', { class: 'clicable', onclick: () => abrirFormulario('activosPasivos', a) },
        h('td', {}, a.tipo), h('td', {}, a.concepto), h('td', {}, dinero(a.valor, a.moneda)), h('td', {}, dinero(a.ingresoMensual || 0, a.moneda)), h('td', {}, dinero(a.costeMensual || 0, a.moneda)), h('td', {}, pct(M.rendimientoActivo(a)))))) : vacio('Sin activos ni pasivos adicionales.'),
    ),
  );
}

function vistaHistorial() {
  const h0 = M.historial(estado);
  const aj = M.ajustes(estado);
  const prom = M.promedios(estado);
  return h('div', {},
    cabecera('Historial mensual', h('button', { class: 'boton', onclick: () => abrirFormulario('ajustes', { ...aj }, {}) }, 'Meta de ahorro mensual')),
    explicacion('Se calcula solo con tus movimientos (sin los internos). Ahorro = ingresos − gastos del mes.'),
    h('div', { class: 'cifras' }, cifra('Ingreso medio', usd(prom.ingresos), `${prom.meses} meses`), cifra('Gasto medio', usd(prom.gastos)), cifra('Meta de ahorro al mes', aj.metaAhorroMensual ? usd(aj.metaAhorroMensual) : 'sin meta')),
    h0.length ? tarjeta(null, tabla(['Mes', 'Ingresos', 'Gastos', 'Ahorro', '% ahorro', '¿Cumplió la meta?'], h0.map((x) => h('tr', {},
      h('td', {}, x.mes), h('td', {}, usd(x.ingresos)), h('td', {}, usd(x.gastos)), h('td', { class: x.ahorro < 0 ? 'negativo' : '' }, usd(x.ahorro)), h('td', {}, pct(x.pct)),
      h('td', {}, x.cumple === null ? '—' : x.cumple ? etiqueta('sí', 'ok') : etiqueta('no', 'alerta')))))) : vacio('Aún no hay meses con movimientos.'),
  );
}

// ---------------------------------------------------------------------------------------------
// Vistas: Cambio y envíos
// ---------------------------------------------------------------------------------------------

function vistaP2P() {
  const c = M.comparacionP2P(estado);
  const sinCup = M.vivos(estado.movimientos).filter((m) => /p2p/i.test(m.categoria || '') && !(Number(m.cupPagados) > 0));
  const sinOrigen = M.p2pSinOrigen(estado);
  return h('div', {},
    cabecera('QvaPay vs El Toque'),
    explicacion('Tasa del vendedor = CUP pagados ÷ $ comprados (bruto). Tasa efectiva = CUP pagados ÷ $ recibidos (neto, tras la comisión de QvaPay). El % compara con la tasa de El Toque de ese día.'),
    sinCup.length ? h('div', { class: 'banda alerta' }, `${sinCup.length} compras P2P sin «CUP pagados». Ábrelas y escribe lo que pagaste.`,
      h('ul', {}, sinCup.map((m) => h('li', {}, h('button', { class: 'enlace', onclick: () => abrirFormulario('movimientos', m) }, `${fechaLarga(m.fecha)} · ${m.vendedor || m.descripcion}`))))) : null,
    sinOrigen.length ? h('div', { class: 'banda alerta' },
      h('strong', {}, `${sinOrigen.length} compras P2P sin la salida de CUP que las pagó. `),
      'El CUP tuvo que salir de BANDEC o del efectivo: regístralo para que el saldo de CUP cuadre (será un traspaso interno, no un gasto).',
      h('ul', {}, sinOrigen.map((m) => h('li', {}, `${fechaLarga(m.fecha)} · ${m.vendedor || m.descripcion} · ${dinero(m.cupPagados, 'CUP')} `,
        h('button', { class: 'boton pequeno', onclick: () => nuevoMovimiento({ fecha: m.fecha, hora: m.hora, tipo: 'salida', moneda: 'CUP', monto: m.cupPagados, interno: true, p2p: m.id, descripcion: `CUP para P2P ${m.vendedor || ''}`.trim(), categoria: 'Cambio de moneda' }) }, 'Registrar la salida de CUP'))))) : null,
    tarjeta('Compras',
      c.filas.length ? tabla(['Fecha', 'Vendedor', '$ bruto', '$ neto', 'CUP pagados', 'Tasa vendedor', 'Tasa efectiva', 'El Toque', '% sobre El Toque', 'CUP de más'],
        c.filas.map((f) => h('tr', { onclick: () => abrirFormulario('movimientos', f.m), class: 'clicable' },
          h('td', {}, fechaLarga(f.m.fecha)), h('td', {}, f.m.vendedor || '—'), h('td', {}, usd(f.bruto)), h('td', {}, usd(f.neto)), h('td', {}, dinero(f.m.cupPagados, 'CUP')),
          h('td', {}, numero(f.tasaVendedor)), h('td', {}, numero(f.tasaEfectiva)),
          h('td', {}, f.toque ? `${numero(f.toque.valor)}${f.toque.exacta ? '' : ` (del ${fechaLarga(f.toque.fecha)})`}` : 'sin tasa'),
          h('td', {}, f.pct !== null ? `${f.pct >= 0 ? '+' : ''}${numero(f.pct)} % (efectivo ${f.pctEfectivo >= 0 ? '+' : ''}${numero(f.pctEfectivo)} %)` : '—'),
          h('td', {}, f.deMas !== null ? dinero(f.deMas, 'CUP') : '—'))),
        h('tr', {}, h('td', { colspan: 2 }, 'Total'), h('td', {}, usd(c.totalBruto)), h('td', {}), h('td', {}, dinero(c.totalCup, 'CUP')), h('td', { colspan: 3 }), h('td', {}, c.pctPonderado !== null ? `+${numero(c.pctPonderado)} % ponderado` : ''), h('td', {}, dinero(c.totalDeMas, 'CUP'))))
        : vacio('Aún no hay compras P2P con CUP pagados.'),
    ),
  );
}

function listaTasas(coleccion, titulo, unidad) {
  const lista = M.vivos(estado[coleccion]).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return tarjeta(titulo,
    h('button', { class: 'boton', onclick: () => abrirFormulario(coleccion, null, { fecha: hoy() }) }, '+ Añadir tasa del día'),
    lista.length ? h('ul', { class: 'lista-simple' }, lista.slice(0, 40).map((t) => h('li', { class: 'clicable', onclick: () => abrirFormulario(coleccion, t) }, h('span', {}, fechaLarga(t.fecha)), h('span', {}, `${numero(t.valor, 4)} ${unidad}`, t.nota ? h('small', {}, ` · ${t.nota}`) : null)))) : vacio('Sin tasas todavía.'),
  );
}

function vistaTasas() {
  return h('div', {},
    cabecera('Tasas de cambio'),
    explicacion('Todo se muestra en $. Cada movimiento guarda la tasa del día y no se recalcula. Bancus: solo la tarjeta en MXN. El Toque: CUP. Euro: para ver el equivalente en € y convertir movimientos en EUR.'),
    h('div', { class: 'rejilla' },
      listaTasas('tasasBancus', 'Bancus (MXN por 1 $, del panel)', 'MXN'),
      listaTasas('tasasToque', 'El Toque (CUP por 1 $)', 'CUP'),
      listaTasas('tasasEUR', 'Euro (EUR por 1 $)', 'EUR'),
    ),
  );
}

function tarifaDeNota(texto, via) {
  const re = via === 'aéreo' ? /a[ée]reo:\s*([\d.,]+)/i : /mar[íi]timo:\s*([\d.,]+)/i;
  const m = String(texto || '').match(re);
  return m ? Number(m[1].replace(',', '.')) : null;
}

function vistaPanavana() {
  const nota = M.vivos(estado.notas).find((n) => n.id === 'panavana');
  const paquetes = M.vivos(estado.paquetes).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const resultado = h('p', { class: 'total' }, '—');
  const libras = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', 'aria-label': 'Libras', placeholder: 'Libras' });
  const via = h('select', { 'aria-label': 'Traslado' }, h('option', { value: 'marítimo' }, 'Marítimo'), h('option', { value: 'aéreo' }, 'Aéreo'));
  const tarifa = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', 'aria-label': 'Tarifa en $ por libra', placeholder: '$ por libra' });
  const calcular = () => {
    const t = Number(tarifa.value);
    const l = Number(libras.value);
    resultado.textContent = t > 0 && l > 0 ? `Costo estimado: ${usd(redondear(t * l))}` : 'Escribe libras y tarifa.';
  };
  const ponerTarifa = () => {
    const t = tarifaDeNota(nota && nota.texto, via.value);
    if (t) tarifa.value = t;
    calcular();
  };
  via.addEventListener('change', ponerTarifa);
  libras.addEventListener('input', calcular);
  tarifa.addEventListener('input', calcular);
  queueMicrotask(ponerTarifa);
  return h('div', {},
    cabecera('Panavana', h('button', { class: 'boton primario', onclick: () => abrirFormulario('paquetes', null, { fecha: hoy(), estado: 'pedido', via: 'marítimo' }) }, '+ Paquete')),
    h('div', { class: 'rejilla' },
      tarjeta('Calculadora de traslado', h('div', { class: 'filtros' }, libras, via, tarifa), resultado),
      tarjeta('Datos del casillero', nota ? h('pre', { class: 'nota-larga' }, nota.texto) : vacio('Sin datos.'),
        h('button', { class: 'boton pequeno', onclick: () => abrirFormulario('notas', nota || null, { id: 'panavana', titulo: 'Panavana' }) }, nota ? 'Editar' : 'Añadir')),
    ),
    tarjeta('Paquetes',
      paquetes.length ? h('ul', { class: 'filas' }, paquetes.map((p) => h('li', { class: 'fila', tabindex: 0, onclick: () => abrirFormulario('paquetes', p) },
        h('div', { class: 'fila-principal' }, h('span', { class: 'fecha' }, fechaLarga(p.fecha)), h('span', { class: 'descripcion' }, `${p.tienda}${p.pedido ? ` · ${p.pedido}` : ''}`), h('span', {}, p.costo ? usd(p.costo) : '')),
        h('div', { class: 'fila-detalle' }, etiqueta(p.estado || '—'), p.via ? etiqueta(p.via) : null, p.libras ? etiqueta(`${p.libras} lb`) : null, p.tracking ? h('small', {}, ` tracking ${p.tracking}`) : null)))) : vacio('No hay paquetes registrados.'),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Datos: almacenamiento, copias, importación y ajustes
// ---------------------------------------------------------------------------------------------

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = h('a', {});
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportarJSON() {
  descargar(`finanzas-copia-${hoy()}.json`, exportarTexto(estado), 'application/json');
  aviso('Copia descargada. Contiene tus datos sin cifrar: guárdala en un sitio privado.');
}

const NOMBRES_HOJA = {
  cuentas: 'Cuentas', movimientos: 'Movimientos', suscripciones: 'Gastos fijos', facturas: 'Facturas', paquetes: 'Panavana',
  tasasBancus: 'Tasas Bancus', tasasToque: 'Tasas El Toque', tasasEUR: 'Tasas EUR', personales: 'Personal (antiguo)', notas: 'Notas',
  ahorros: 'Ahorro', metas: 'Metas', deudas: 'Deudas', inversiones: 'Inversiones', activosPasivos: 'Activos y pasivos', ajustes: 'Ajustes',
  articulos: 'Compra y venta', hormigas: 'Gastos hormiga', gastosNegocio: 'Gastos de negocio',
};

function exportarExcel() {
  const nombreMeta = (v) => M.vivos(estado.metas).find((m) => m.id === v)?.nombre;
  const refs = {
    cuenta: (v) => cuentaPorId(v)?.nombre, deuda: (v) => M.vivos(estado.deudas).find((d) => d.id === v)?.acreedor, meta: nombreMeta,
    reparto: (v) => (Array.isArray(v) ? v.map((p) => `${p.destino === 'otros' ? p.texto || 'otros' : p.destino === 'meta' ? `meta ${nombreMeta(p.meta) || ''}` : p.destino}: ${p.monto ?? `${p.pct} %`}`).join('; ') : ''),
  };
  const hojas = M.COLECCIONES.filter((c) => M.vivos(estado[c]).length).map((c) => {
    const campos = M.CAMPOS[c];
    const filas = [campos.map((x) => x.l)];
    for (const r of M.vivos(estado[c])) filas.push(campos.map((x) => (refs[x.t] ? refs[x.t](r[x.k]) || r[x.k] || '' : r[x.k])));
    if (c === 'movimientos') {
      filas[0].push('Equivalente en $');
      M.vivos(estado.movimientos).forEach((m, i) => filas[i + 1].push(M.usdMovimiento(m)));
    }
    return { nombre: NOMBRES_HOJA[c], filas };
  });
  hojas.push({ nombre: 'Historial mensual', filas: [['Mes', 'Ingresos $', 'Gastos $', 'Ahorro $', '% ahorro'], ...M.historial(estado).map((x) => [x.mes, x.ingresos, x.gastos, x.ahorro, x.pct])] });
  descargar(`finanzas-${hoy()}.xlsx`, crearXlsx(hojas), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  aviso('Excel descargado.');
}

function elegirArchivoImportar() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      if (f.size > 5 * 1024 * 1024) throw new Error('El archivo es demasiado grande.');
      let texto = await f.text();
      let obj = null;
      try { obj = JSON.parse(texto); } catch { /* importarTexto lo explicará */ }
      if (obj && esSobreCifrado(obj)) {
        texto = await abrirCopiaCifrada(obj);
        if (texto === null) return;
      }
      confirmarImportacion(importarTexto(texto, estado), f.name);
    } catch (e) {
      if (e.bloqueada) { mostrarBloqueo(); return; }
      aviso(e.message, 'error');
    }
  });
  input.click();
}

// --- Copia cifrada para pasar datos entre el PC y el celular a mano (por Drive) ---

/** Pide una clave en una ventanita. Devuelve el texto o null si se cancela. */
function pedirClaveDialogo(titulo, texto) {
  return new Promise((resolver) => {
    const dlg = $('#dialogo');
    let resuelto = false;
    const fin = (v) => { if (!resuelto) { resuelto = true; resolver(v); } };
    const form = h('form', { class: 'formulario', novalidate: true },
      h('h2', {}, titulo), h('p', { class: 'explicacion' }, texto),
      campoClave('copia', 'Clave', 'current-password'),
      h('div', { class: 'botones' }, h('span', { class: 'espacio' }),
        h('button', { type: 'button', class: 'boton', onclick: () => dlg.close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'boton primario' }, 'Continuar')));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = form.elements.copia.value; fin(v); dlg.close(); });
    dlg.addEventListener('close', () => fin(null), { once: true });
    dlg.replaceChildren(form);
    dlg.showModal();
    form.elements.copia.focus();
  });
}

/** Llave de la copia cifrada: la que ya está abierta o, si no, la que sale de la clave que escribe Jose. */
async function obtenerLlave() {
  if (clave) return clave;
  if (llavePromesa) { const k = await llavePromesa; if (k) return k; }
  const texto = await pedirClaveDialogo('Escribe tu clave', 'Con ella se cifra la copia. Es la misma clave con la que abres la app.');
  if (texto === null) return null;
  if (MODO_PC) await pedirAPI('api/clave/comprobar', { clave: texto });
  if (!config.salDrive) { config.salDrive = nuevaSal(); await guardarConfig(); }
  clave = await derivarClave(texto, config.salDrive);
  return clave;
}

async function exportarCifrada() {
  try {
    const k = await obtenerLlave();
    if (!k) return;
    const sobre = await cifrarDrive(k, config.salDrive, JSON.parse(exportarTexto(estado)));
    const nombre = 'finanzas-copia-cifrada-' + hoy() + '-' + horaActual().replace(':', '') + '.json';
    const contenido = JSON.stringify(sobre);
    if (!MODO_PC && typeof File === 'function' && navigator.canShare) {
      const archivoCopia = new File([contenido], nombre, { type: 'application/json' });
      if (navigator.canShare({ files: [archivoCopia] })) {
        try {
          await navigator.share({ files: [archivoCopia], title: 'Copia cifrada de Finanzas' });
          aviso('Listo. Guárdala en tu Drive, carpeta Finanzas → Copia cifrada.');
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
    }
    descargar(nombre, contenido, 'application/json');
    aviso('Copia cifrada descargada. Súbela a tu Drive, carpeta Finanzas → Copia cifrada.');
  } catch (e) {
    if (e.bloqueada) { mostrarBloqueo(); return; }
    aviso(e.message, 'error');
  }
}

/** Abre una copia cifrada que viene del otro aparato. Devuelve el texto de la copia, o null si se cancela. */
async function abrirCopiaCifrada(sobre) {
  if (clave && sobre.kdf.sal === config.salDrive) {
    try { return JSON.stringify(await descifrarDrive(clave, sobre)); } catch { /* se pide la clave */ }
  }
  const texto = await pedirClaveDialogo('Clave de la copia', 'Esta copia se hizo en el otro aparato o antes de cambiar la clave. Escribe la clave con la que se hizo.');
  if (texto === null) return null;
  frenoLocal();
  const k = await derivarClave(texto, sobre.kdf.sal, sobre.kdf.iteraciones);
  let datos;
  try { datos = await descifrarDrive(k, sobre); } catch { throw falloLocal(); }
  fallosLocales = 0;
  if (!MODO_PC) {
    // El celular pasa a usar la llave del PC: así las próximas copias se abren sin volver a escribir la clave.
    clave = k;
    config.salDrive = sobre.kdf.sal;
    await guardarConfig();
  }
  return JSON.stringify(datos);
}

function confirmarImportacion(r, nombre) {
  const dlg = $('#dialogo');
  const cuenta = (c) => M.vivos(r.estado[c]).length;
  const hayDatos = M.COLECCIONES.some((c) => M.vivos(estado[c]).length);
  const form = h('form', { method: 'dialog', class: 'formulario' },
    h('h2', {}, 'Importar datos'),
    h('p', {}, `Archivo: ${nombre} (${{ informe: 'informe de Muse', facturas: 'facturas nuevas desde Drive', novedades: 'novedades de Muse', copia: 'copia de la app' }[r.tipo]})`),
    r.tipo !== 'copia' ? explicacion('Solo se añaden o actualizan registros: no se borra nada de lo que ya tienes.') : null,
    h('ul', {}, M.COLECCIONES.filter((c) => cuenta(c)).map((c) => h('li', {}, `${cuenta(c)} · ${NOMBRES_HOJA[c]}`))),
    r.avisos.length ? h('div', { class: 'banda alerta' }, h('strong', {}, 'Avisos:'), h('ul', {}, r.avisos.map((a) => h('li', {}, a)))) : null,
    hayDatos && !config.protegida ? h('p', {}, 'Antes de importar se guarda una copia interna de lo que hay ahora (Datos → Copias internas).') : null,
    h('div', { class: 'botones' },
      h('button', { type: 'button', class: 'boton', onclick: () => dlg.close() }, 'Cancelar'),
      hayDatos && r.tipo === 'copia' ? h('button', { type: 'button', class: 'boton peligro', onclick: () => aplicarImportacion(r, 'reemplazar') }, 'Reemplazar todo') : null,
      h('button', { type: 'button', class: 'boton primario', onclick: () => aplicarImportacion(r, 'mezclar') }, hayDatos ? 'Añadir y actualizar (recomendado)' : 'Importar'),
    ),
  );
  dlg.replaceChildren(form);
  dlg.showModal();
}

async function aplicarImportacion(r, modo) {
  await respaldoNavegador(`antes de importar (${modo})`);
  if (modo === 'reemplazar') {
    // Lo que no esté en el archivo queda marcado como borrado (también en el archivo del PC).
    const nuevos = new Set(M.COLECCIONES.flatMap((c) => r.estado[c].map((x) => `${c}:${x.id}`)));
    const lapidas = M.nuevoEstado();
    for (const c of M.COLECCIONES) for (const x of estado[c]) if (!nuevos.has(`${c}:${x.id}`)) lapidas[c].push(M.sello({ id: x.id, borrado: true }, config.dispositivo));
    estado = M.mezclar(lapidas, r.estado).estado;
  } else {
    estado = M.mezclar(estado, r.estado).estado;
  }
  await persistir();
  $('#dialogo').close();
  aviso('Datos importados.');
  programarArchivo(200);
  programarSync(2000);
  grupo = 'resumen';
  vista = 'resumen';
  pintar();
}

function vistaDatos() {
  const aj = M.ajustes(estado);
  const respaldos = h('ul', { class: 'lista-simple' }, h('li', {}, 'Cargando…'));
  db.leerRespaldos().then((lista) => {
    respaldos.replaceChildren(...(lista.length ? lista.map((r) => h('li', {},
      h('span', {}, `${new Date(r.fecha).toLocaleString('es-ES')} · ${r.motivo}`),
      h('button', { class: 'boton pequeno', onclick: async () => {
        if (!confirm('¿Volver a esta copia? Lo de ahora se guarda antes como otra copia interna.')) return;
        await respaldoNavegador('antes de restaurar');
        const restaurado = M.validarEstado(r.estado);
        const ahora = Date.now();
        for (const c of M.COLECCIONES) restaurado[c] = restaurado[c].map((x) => ({ ...x, actualizado: ahora, dispositivo: config.dispositivo }));
        const vivosRest = new Set(M.COLECCIONES.flatMap((c) => restaurado[c].map((x) => `${c}:${x.id}`)));
        for (const c of M.COLECCIONES) for (const x of estado[c]) if (!vivosRest.has(`${c}:${x.id}`)) restaurado[c].push(M.sello({ id: x.id, borrado: true }, config.dispositivo, ahora));
        estado = restaurado;
        await persistir();
        programarArchivo(200);
        aviso('Copia restaurada.');
        pintar();
      } }, 'Restaurar'))) : [h('li', {}, 'No hay copias internas todavía.')]));
  });

  return h('div', {},
    cabecera('Datos'),
    !MODO_PC ? null : tarjeta('Dónde se guardan tus datos',
      archivo.ok
        ? h('p', {}, etiqueta('Guardado en el PC', 'ok'), ' En el archivo de datos de este PC, con una copia diaria (ver LEEME). Lo que llega de los avisos automáticos se añade ahí y la app lo muestra solo.')
        : h('p', {}, etiqueta('Solo en este navegador', 'alerta'), ' Abre la app con «Abrir app de finanzas (este PC).cmd» para que se guarde en el archivo del PC y Jarvis pueda actualizarla.'),
      archivo.ok ? explicacion(`Última lectura del archivo: ${archivo.ultima ? new Date(archivo.ultima).toLocaleTimeString('es-ES') : '—'}`) : null,
      h('div', { class: 'botones' }, h('button', { class: 'boton', onclick: () => traerArchivo() }, 'Volver a leer el archivo')),
    ),
    tarjeta('Ajustes',
      h('ul', { class: 'lista-simple' },
        h('li', {}, h('span', {}, 'Presupuesto'), h('span', {}, `${numero(aj.pctNecesidades)} / ${numero(aj.pctDeseos)} / ${numero(aj.pctAhorro)} %`)),
        h('li', {}, h('span', {}, 'Meta de ahorro mensual'), h('span', {}, aj.metaAhorroMensual ? usd(aj.metaAhorroMensual) : '—')),
        h('li', {}, h('span', {}, 'Fondo de emergencia'), h('span', {}, `${numero(aj.fondoEmergenciaMeses)} meses de gastos`))),
      h('button', { class: 'boton', onclick: () => abrirFormulario('ajustes', { ...aj }, {}) }, 'Cambiar ajustes'),
    ),
    tarjeta('Copias y Excel',
      h('div', { class: 'botones' },
        h('button', { class: 'boton', onclick: exportarJSON }, 'Descargar copia (JSON)'),
        h('button', { class: 'boton', onclick: exportarExcel }, 'Descargar Excel'),
        h('button', { class: 'boton primario', onclick: elegirArchivoImportar }, 'Importar archivo'),
      ),
      explicacion('Importar acepta el informe de Muse, las novedades de Muse y las copias de esta app. Nada se duplica al importar dos veces.'),
    ),
    tarjetaClave(),
    config.protegida ? null : tarjeta('Copias internas (este navegador)', respaldos),
    tarjeta('Cuentas',
      h('button', { class: 'boton', onclick: () => abrirFormulario('cuentas', null, { moneda: 'USD', saldoInicial: 0 }) }, '+ Añadir cuenta'),
      h('ul', { class: 'lista-simple' }, M.vivos(estado.cuentas).map((c) => h('li', { class: 'clicable', onclick: () => abrirFormulario('cuentas', c) }, h('span', {}, c.nombre, c.ultimos4 ? ` ·••• ${c.ultimos4}` : ''), h('span', {}, `${c.moneda} · id: ${c.id}`)))),
      explicacion('El «id» de cada cuenta es el nombre que usa Muse para avisar de movimientos.'),
    ),
    tarjeta('Notas',
      h('button', { class: 'boton', onclick: () => abrirFormulario('notas') }, '+ Añadir nota'),
      h('ul', { class: 'lista-simple' }, M.vivos(estado.notas).map((n) => h('li', { class: 'clicable', onclick: () => abrirFormulario('notas', n) }, h('span', {}, n.titulo)))),
    ),
    tarjetaCelular(),
    config.protegida ? null : tarjeta('Zona de peligro',
      h('button', { class: 'boton peligro', onclick: async () => {
        if (!confirm('¿Borrar los datos de ESTE NAVEGADOR? El archivo del PC no se toca: al recargar, los datos vuelven desde el archivo.')) return;
        await respaldoNavegador('antes de borrar el navegador');
        estado = M.nuevoEstado();
        await persistir();
      } }, 'Borrar los datos de este navegador'),
      explicacion(`Dispositivo: ${config.dispositivo}`),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Navegación por grupos
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Vistas nuevas (18 nov 2026): gastos hormiga, gastos de negocio y compra para revender
// ---------------------------------------------------------------------------------------------

const usdDe = (monto, moneda, tasa) => M.aUSD(monto, moneda, tasa) ?? M.aUSDHoy(estado, monto, moneda);

function vistaHormigas() {
  const lista = M.vivos(estado.hormigas).filter((g) => String(g.fecha).slice(0, 7) === filtros.mes).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const porMedio = { efectivo: 0, transferencia: 0, deuda: 0 };
  for (const g of lista) porMedio[g.medio] = (porMedio[g.medio] || 0) + (usdDe(g.monto, g.moneda, g.tasa) || 0);
  const total = Object.values(porMedio).reduce((a, b) => a + b, 0);
  return h('div', {},
    cabecera('Gastos hormiga', selectorMes(), h('button', { class: 'boton primario', onclick: () => abrirFormulario('hormigas', null, { fecha: hoy(), medio: 'efectivo', moneda: 'CUP', ambito: 'personal' }) }, '+ Gasto hormiga')),
    explicacion('Los gastos pequeños de cada día (café, transporte, merienda…). Si pagas en efectivo o por transferencia, se apuntan solos en Movimientos; si te endeudas, se apuntan solos en Deudas con su acreedor y fecha.'),
    h('div', { class: 'cifras' },
      cifra('Total del mes', usd(total), `${lista.length} gastos`),
      cifra('En efectivo', usd(porMedio.efectivo)), cifra('Por transferencia', usd(porMedio.transferencia)), cifra('A crédito (deudas)', usd(porMedio.deuda), null, porMedio.deuda > 0 ? 'negativo' : '')),
    lista.length ? h('ul', { class: 'filas' }, lista.map((g) => h('li', { class: 'fila salida', tabindex: 0, onclick: () => abrirFormulario('hormigas', g) },
      h('div', { class: 'fila-principal' }, h('span', { class: 'fecha' }, fechaLarga(g.fecha)), h('span', { class: 'descripcion' }, g.concepto), h('span', { class: 'importe salida' }, '−', montoConUSD(g.monto, g.moneda, usdDe(g.monto, g.moneda, g.tasa), g.tasa))),
      h('div', { class: 'fila-detalle' }, etiqueta(g.medio, g.medio === 'deuda' ? 'alerta' : ''), g.medio === 'deuda' ? etiqueta(`debes a ${g.acreedor}`) : cuentaPorId(g.cuenta) ? etiqueta(cuentaPorId(g.cuenta).nombre) : null, g.ambito ? etiqueta(g.ambito) : null)))) : vacio('Sin gastos hormiga este mes.'),
  );
}

function vistaNegocio() {
  const r = M.resumenNegocio(estado, filtros.mes);
  const lista = M.vivos(estado.gastosNegocio).filter((g) => String(g.fecha).slice(0, 7) === filtros.mes).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return h('div', {},
    cabecera('Gastos de negocio', selectorMes(), h('button', { class: 'boton primario', onclick: () => abrirFormulario('gastosNegocio', null, { fecha: hoy(), negocio: 'Afiliados Insenia', tipoGasto: 'anuncio o promoción pagada', moneda: 'USD', ambito: 'afiliados' }) }, '+ Gasto de negocio')),
    explicacion('Formación, cursos, anuncios y promociones pagadas, herramientas… de cada negocio. Se apuntan solos en Movimientos como gasto de «desarrollo de negocios» (los de Insenia, con el ámbito «afiliados»).'),
    h('div', { class: 'cifras' }, cifra('Gasto de negocio del mes', usd(r.total), `${lista.length} gastos`)),
    Object.keys(r.porNegocio).length ? h('div', { class: 'rejilla' }, Object.entries(r.porNegocio).map(([n, x]) => tarjeta(`${n}: ${usd(x.total)}`,
      h('ul', { class: 'lista-simple' }, Object.entries(x.porTipo).sort((a, b) => b[1] - a[1]).map(([t, v]) => h('li', {}, h('span', {}, t), h('span', {}, usd(v)))))))) : null,
    lista.length ? tarjeta('Detalle', h('ul', { class: 'filas' }, lista.map((g) => h('li', { class: 'fila salida', tabindex: 0, onclick: () => abrirFormulario('gastosNegocio', g) },
      h('div', { class: 'fila-principal' }, h('span', { class: 'fecha' }, fechaLarga(g.fecha)), h('span', { class: 'descripcion' }, g.concepto), h('span', { class: 'importe salida' }, '−', montoConUSD(g.monto, g.moneda, usdDe(g.monto, g.moneda, g.tasa), g.tasa))),
      h('div', { class: 'fila-detalle' }, etiqueta(g.negocio), etiqueta(g.tipoGasto), g.tipoAnuncio ? etiqueta(g.tipoAnuncio) : null, g.ambito ? etiqueta(g.ambito) : null))))) : vacio('Sin gastos de negocio este mes.'),
  );
}

function vistaReventa() {
  const t = M.totalesReventa(estado);
  const lista = M.vivos(estado.articulos).sort((a, b) => (String(a.fechaCompra) < String(b.fechaCompra) ? 1 : -1));
  return h('div', {},
    cabecera('Compra y venta', h('button', { class: 'boton primario', onclick: () => abrirFormulario('articulos', null, { fechaCompra: hoy(), moneda: 'USD', cantidad: 1, estado: 'en stock', ambito: 'desarrollo de empresa y negocios' }) }, '+ Artículo')),
    explicacion('Lo que compras para revender (zapatos, ventiladores…). La compra no cuenta como gasto del mes ni la venta como ingreso normal: cuando lo vendes, la ganancia (venta − compra − envío de Panavana) entra en tus ingresos.'),
    h('div', { class: 'cifras' },
      cifra('Invertido (compra + envío)', usd(t.invertido)), cifra('Cobrado', usd(t.recuperado)), cifra('Falta por cobrar', usd(t.faltaCobrar), null, t.faltaCobrar > 0 ? 'negativo' : ''),
      cifra('En stock (a costo)', usd(t.enStock)), cifra('Ganancia total', usd(t.ganancia), 'ya sumada a tus ingresos', t.ganancia < 0 ? 'negativo' : '')),
    lista.length ? h('div', { class: 'rejilla' }, lista.map((a) => {
      const e = M.estadoArticulo(estado, a);
      return tarjeta(`${a.nombre}${Number(a.cantidad) > 1 ? ` ×${numero(a.cantidad)}` : ''}`,
        h('ul', { class: 'lista-simple' },
          h('li', {}, h('span', {}, 'Compra'), h('span', {}, dinero(a.costo, a.moneda), a.tienda ? h('small', {}, ` · ${a.tienda}`) : null)),
          h('li', {}, h('span', {}, 'Envío Panavana'), h('span', {}, a.costoEnvio ? usd(a.costoEnvio) : '—', a.peso ? h('small', {}, ` · ${numero(a.peso)} lb`) : null)),
          h('li', {}, h('span', {}, 'Factura de Panavana'), h('span', {}, a.montoFacturaPanavana ? usd(a.montoFacturaPanavana) : '—', ' ',
            e.factura ? (e.facturaCuadra ? etiqueta('coincide con la factura', 'ok') : etiqueta(`no coincide: la factura dice ${usd(e.totalFacturaUSD)}`, 'alerta')) : a.montoFacturaPanavana ? etiqueta('falta unir la factura', 'alerta') : null)),
          h('li', {}, h('span', {}, 'Costo total'), h('strong', {}, e.costoTotalUSD !== null ? usd(e.costoTotalUSD) : '—')),
          h('li', {}, h('span', {}, 'Venta'), h('span', {}, a.precioVenta ? dinero(a.precioVenta, a.moneda) : '—', a.cliente ? h('small', {}, ` · ${a.cliente}`) : null)),
          a.anticipo ? h('li', {}, h('span', {}, 'Anticipo'), h('span', {}, dinero(a.anticipo, a.moneda), h('small', {}, a.anticipoPone === 'yo' ? ' · lo pusiste tú' : ' · lo pagó el cliente'))) : null,
          h('li', {}, h('span', {}, 'Cobrado / falta'), h('span', {}, dinero(e.cobrado, a.moneda), ' / ', e.faltaCobrar !== null ? dinero(e.faltaCobrar, a.moneda) : '—')),
          h('li', {}, h('span', {}, 'Ganancia'), h('strong', { class: e.gananciaUSD < 0 ? 'negativo' : '' }, e.gananciaUSD !== null ? `${usd(e.gananciaUSD)}${e.pctGanancia !== null ? ` (${pct(e.pctGanancia)})` : ''}` : '—'))),
        h('div', { class: 'fila-detalle' }, etiqueta(e.vendido ? 'vendido' : a.estado || 'en stock', e.vendido ? 'ok' : ''), a.ambito ? etiqueta(a.ambito) : null, e.vendido && a.fechaVenta ? etiqueta(`ganancia en ingresos de ${a.fechaVenta.slice(0, 7)}`, 'ok') : null),
        h('div', { class: 'botones' }, h('button', { class: 'boton pequeno', onclick: () => abrirFormulario('articulos', a) }, 'Editar')));
    })) : vacio('Aún no hay artículos para revender.'),
  );
}

const VISTAS = {
  resumen: ['Resumen', vistaResumen],
  movimientos: ['Movimientos', vistaMovimientos],
  facturas: ['Facturas', vistaFacturas],
  fijos: ['Gastos fijos', vistaFijos],
  presupuesto: ['Presupuesto 20-30-30-20', vistaPresupuesto],
  hormigas: ['Gastos hormiga', vistaHormigas],
  negocio: ['Gastos de negocio', vistaNegocio],
  reventa: ['Compra y venta', vistaReventa],
  personal: ['Personal (antiguo)', vistaPersonal],
  ahorro: ['Ahorro', vistaAhorro],
  metas: ['Metas', vistaMetas],
  deudas: ['Deudas', vistaDeudas],
  inversiones: ['Inversiones', vistaInversiones],
  patrimonio: ['Activos y pasivos', vistaPatrimonio],
  historial: ['Historial', vistaHistorial],
  p2p: ['P2P', vistaP2P],
  tasas: ['Tasas', vistaTasas],
  panavana: ['Panavana', vistaPanavana],
  datos: ['Datos', vistaDatos],
};

function grupos() {
  return [
    { id: 'resumen', t: 'Resumen', vistas: ['resumen'] },
    { id: 'diario', t: 'Día a día', vistas: ['movimientos', 'hormigas', 'facturas', 'fijos', 'presupuesto', ...(M.vivos(estado.personales).length ? ['personal'] : [])] },
    { id: 'negocio', t: 'Negocio', vistas: ['negocio', 'reventa'] },
    { id: 'ahorro', t: 'Ahorro y patrimonio', vistas: ['ahorro', 'metas', 'deudas', 'inversiones', 'patrimonio', 'historial'] },
    { id: 'cambio', t: 'Cambio y envíos', vistas: ['p2p', 'tasas', 'panavana'] },
    { id: 'datos', t: 'Datos', vistas: ['datos'] },
  ];
}

function irA(g, v) {
  grupo = g;
  vista = v || grupos().find((x) => x.id === g).vistas[0];
  pintar();
  window.scrollTo(0, 0);
}

function pintarNavegacion() {
  const nav = $('#navegacion');
  nav.replaceChildren(...grupos().map((g) => h('button', {
    class: `pestana ${grupo === g.id ? 'activa' : ''}`,
    'aria-current': grupo === g.id ? 'page' : null,
    onclick: () => irA(g.id, g.id === grupo ? vista : null),
  }, g.t)));
}

function subpestanas() {
  const g = grupos().find((x) => x.id === grupo);
  if (!g || g.vistas.length < 2) return null;
  return h('nav', { class: 'subpestanas', 'aria-label': `Secciones de ${g.t}` }, g.vistas.map((v) => h('button', {
    class: `chip ${vista === v ? 'activa' : ''}`,
    'aria-current': vista === v ? 'page' : null,
    onclick: () => irA(grupo, v),
  }, VISTAS[v][0])));
}

function pintar() {
  repintarAlCerrar = false;
  if (pantalla) { pintarPantallaClave(); return; }
  $('#navegacion').hidden = false;
  const g = grupos().find((x) => x.id === grupo);
  if (!g || !g.vistas.includes(vista)) { grupo = 'resumen'; vista = 'resumen'; }
  pintarNavegacion();
  pintarEstadoSync();
  const sinDatos = !M.COLECCIONES.some((c) => M.vivos(estado[c]).length);
  const main = $('#vista');
  try {
    main.replaceChildren(...(sinDatos && grupo !== 'datos' ? [vistaBienvenida()] : [subpestanas(), VISTAS[vista][1]()].filter(Boolean)));
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div', { class: 'banda peligro' }, `Algo falló al mostrar esta pantalla: ${e.message}`));
  }
}

// ---------------------------------------------------------------------------------------------
// Clave de la app
// PC (con su ventana negra): la clave la comprueba el servidor y los datos se guardan cifrados en el PC.
// Celular (app publicada): no hay servidor; los datos se guardan cifrados en el propio celular
// con la misma clave y llegan del PC a través de la copia cifrada en Drive.
// ---------------------------------------------------------------------------------------------

let codigoMostrado = null;
let sobreInicial = null; // copia de Drive que se abre la primera vez en el celular
let salPendiente = null; // la clave cambió en el PC: sal de la copia nueva de Drive
let fallosLocales = 0;
let esperaLocalHasta = 0;
let ocultaDesde = 0;

function campoClave(nombre, texto, autocompletar, ayuda) {
  const id = `clave-${nombre}`;
  return h('div', { class: 'campo' },
    h('label', { for: id }, texto),
    h('input', { id, name: nombre, type: 'password', autocomplete: autocompletar, required: true, maxlength: 200 }),
    ayuda ? h('small', {}, ayuda) : null);
}

/** Formulario de clave: muestra errores y deja el botón en «Comprobando…» mientras se trabaja. */
function formularioClave(titulo, explicaciones, campos, textoBoton, alEnviar, extra = null) {
  const errores = h('div', { class: 'errores', role: 'alert' });
  const boton = h('button', { type: 'submit', class: 'boton primario' }, textoBoton);
  const form = h('form', { class: 'formulario', novalidate: true }, h('h1', {}, titulo), explicaciones.map((t) => h('p', { class: 'explicacion' }, t)), campos, errores, h('div', { class: 'botones' }, boton), extra);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errores.replaceChildren();
    boton.disabled = true;
    boton.textContent = 'Comprobando…';
    try {
      await alEnviar(form.elements);
    } catch (e) {
      errores.replaceChildren(h('p', {}, e.message));
      boton.disabled = false;
      boton.textContent = textoBoton;
    }
  });
  queueMicrotask(() => { const p = form.querySelector('input'); if (p) p.focus(); });
  return h('section', { class: 'tarjeta pantalla-clave' }, form);
}

function comprobarNueva(nueva, repetida) {
  if (nueva.length < 10) throw new Error('La clave debe tener al menos 10 caracteres.');
  if (nueva !== repetida) throw new Error('Las dos claves no coinciden.');
}

/** En el celular: frena a quien prueba claves (como el servidor del PC). */
function frenoLocal() {
  const falta = Math.ceil((esperaLocalHasta - Date.now()) / 1000);
  if (falta > 0) throw new Error(`Demasiados intentos. Espera ${falta} segundos.`);
}
function falloLocal() {
  fallosLocales++;
  if (fallosLocales >= 5) esperaLocalHasta = Date.now() + Math.min(300000, 5000 * 2 ** (fallosLocales - 5));
  return new Error('Clave incorrecta.');
}

let llavePromesa = null;
/** Tras escribir la clave en el PC: prepara en segundo plano la llave de la copia cifrada. */
function prepararLlave(claveTexto) {
  if (!MODO_PC || !claveTexto) return;
  const listo = config.salDrive ? Promise.resolve() : (config.salDrive = nuevaSal(), guardarConfig());
  llavePromesa = listo
    .then(() => derivarClave(claveTexto, config.salDrive))
    .then((k) => { if (proteccion.abierta) { clave = k; programarSync(1500); } return k; })
    .catch(() => null);
}

async function entrar(claveTexto = '') {
  proteccion = { protegida: true, abierta: true };
  if (!config.protegida) { config.protegida = true; await guardarConfig(); }
  await limpiarNavegador();
  pantalla = null;
  codigoMostrado = null;
  sobreInicial = null;
  ultimaActividad = Date.now();
  fallosLocales = 0;
  pintar();
  if (MODO_PC) {
    prepararLlave(claveTexto);
    await traerArchivo({ avisar: false });
    pintar();
  } else {
    await persistir();
    if (sync.hayAcceso()) sincronizarAhora({ silencioso: true });
  }
}

async function conectarDrive() {
  try {
    await sync.conectar(ID_CLIENTE_GOOGLE);
    aviso('Conectado con Google Drive.');
    pintarEstadoSync();
    return true;
  } catch (e) {
    aviso(e.message, 'error');
    return false;
  }
}

function pantallaSimple(titulo, parrafos, botones) {
  return h('section', { class: 'tarjeta pantalla-clave' },
    h('h1', {}, titulo), parrafos.map((p) => (p instanceof Node ? p : h('p', {}, p))),
    h('div', { class: 'botones' }, botones));
}

function pintarPantallaClave() {
  $('#navegacion').replaceChildren();
  $('#navegacion').hidden = true;
  pintarEstadoSync();
  let contenido;
  if (pantalla === 'sinServidor') {
    contenido = pantallaSimple('Abre la app desde el escritorio',
      ['La app tiene clave y necesita su ventana negra para abrir tus datos. Haz doble clic en el icono «App de finanzas» del escritorio.'],
      [h('button', { class: 'boton primario', onclick: () => location.reload() }, 'Reintentar')]);
  } else if (pantalla === 'conectarCelular') {
    const errores = h('div', { class: 'errores', role: 'alert' });
    const elegir = () => {
      errores.replaceChildren();
      const input = h('input', { type: 'file', accept: 'application/json,.json' });
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          if (f.size > 5 * 1024 * 1024) throw new Error('El archivo es demasiado grande.');
          let obj;
          try { obj = JSON.parse(await f.text()); } catch { throw new Error('Ese archivo no es una copia de la app.'); }
          if (!esSobreCifrado(obj)) throw new Error('Ese archivo no es una copia cifrada. En el PC usa Datos → Celular → «Exportar copia cifrada».');
          sobreInicial = obj;
          pantalla = 'primeraClave';
          pintar();
        } catch (e) {
          errores.replaceChildren(h('p', {}, e.message));
        }
      });
      input.click();
    };
    contenido = pantallaSimple('Finanzas en este celular',
      ['Para empezar, trae tus datos del PC:',
        h('ol', {},
          h('li', {}, 'En el PC: Datos → Celular → «Exportar copia cifrada».'),
          h('li', {}, 'Sube ese archivo a tu Drive (carpeta Finanzas → Copia cifrada).'),
          h('li', {}, 'Aquí: pulsa el botón y elige el archivo en Drive.')),
        'La copia va cifrada con tu clave: sin ella nadie puede leerla.', errores],
      [h('button', { class: 'boton primario', onclick: elegir }, 'Elegir la copia cifrada')]);
  } else if (pantalla === 'primeraClave') {
    contenido = formularioClave('Escribe tu clave',
      ['Es la misma clave con la que abres la app en el PC. Tus datos se guardarán cifrados en este celular.'],
      [campoClave('clave', 'Clave', 'current-password')],
      'Abrir',
      async (el) => {
        frenoLocal();
        const k = await derivarClave(el.clave.value, sobreInicial.kdf.sal, sobreInicial.kdf.iteraciones);
        let datos;
        try { datos = await descifrarDrive(k, sobreInicial); } catch { throw falloLocal(); }
        estado = M.validarEstado(datos && datos.app === 'finanzas-jose' ? importarTexto(JSON.stringify(datos)).estado : datos);
        clave = k;
        config.salDrive = sobreInicial.kdf.sal;
        config.ultimaSync = new Date().toISOString();
        await guardarConfig();
        await entrar();
      });
  } else if (pantalla === 'claveNueva') {
    contenido = formularioClave('Escribe tu clave nueva',
      ['La clave se cambió en el PC. Escribe la clave nueva para seguir sincronizando este celular.'],
      [campoClave('clave', 'Clave nueva', 'current-password')],
      'Continuar',
      async (el) => {
        frenoLocal();
        const k = await derivarClave(el.clave.value, salPendiente);
        let r;
        try {
          r = await sync.sincronizar(estado, k, salPendiente);
        } catch (e) {
          if (e instanceof sync.OtraClave) throw falloLocal();
          throw e;
        }
        estado = r.estado;
        clave = k;
        config.salDrive = salPendiente;
        config.ultimaSync = new Date().toISOString();
        salPendiente = null;
        await guardarConfig();
        await entrar();
      },
      h('p', {}, h('button', { type: 'button', class: 'enlace', onclick: () => bloquearAhora() }, 'Ahora no (bloquear)')));
  } else if (pantalla === 'crear') {
    contenido = formularioClave('Ponle una clave a la app',
      ['Con la clave, tus datos se guardan cifrados en el PC: sin ella nadie puede verlos, ni abriendo la app ni abriendo el archivo.',
        'Usa al menos 10 caracteres. Mejor una frase que recuerdes, por ejemplo cuatro palabras sueltas. No uses la misma clave que en otros sitios.'],
      [campoClave('nueva', 'Clave nueva', 'new-password'), campoClave('repetida', 'Repite la clave', 'new-password')],
      'Crear clave',
      async (el) => {
        comprobarNueva(el.nueva.value, el.repetida.value);
        const j = await pedirAPI('api/clave/crear', { clave: el.nueva.value, datos: estado });
        config.protegida = true;
        await guardarConfig();
        await limpiarNavegador();
        proteccion = { protegida: true, abierta: true };
        codigoMostrado = j.codigo;
        pantalla = 'codigo';
        pintar();
      });
  } else if (pantalla === 'codigo') {
    const casilla = h('input', { type: 'checkbox', id: 'codigo-guardado' });
    const seguir = h('button', { class: 'boton primario', disabled: true, onclick: () => entrar() }, 'Entrar en la app');
    casilla.addEventListener('change', () => { seguir.disabled = !casilla.checked; });
    contenido = h('section', { class: 'tarjeta pantalla-clave' },
      h('h1', {}, 'Tu código de recuperación'),
      h('p', {}, 'Si algún día olvidas la clave, este código es la única forma de volver a entrar. Solo se muestra ahora.'),
      h('p', { class: 'codigo-recuperacion' }, codigoMostrado || '—'),
      h('div', { class: 'banda alerta' }, 'Apúntalo en papel y guárdalo en un sitio seguro, o en tu gestor de contraseñas. No lo envíes por chat ni por correo. Sin la clave y sin este código, nadie (tampoco tú ni Claude) podrá abrir los datos.'),
      h('div', { class: 'campo campo-check' }, casilla, h('label', { for: 'codigo-guardado' }, 'Lo he apuntado y guardado')),
      h('div', { class: 'botones' }, seguir));
  } else if (pantalla === 'recuperar') {
    contenido = formularioClave('Entrar con el código de recuperación',
      ['Escribe el código que apuntaste al crear la clave y elige una clave nueva. El código seguirá sirviendo después.'],
      [h('div', { class: 'campo' }, h('label', { for: 'clave-codigo' }, 'Código de recuperación'), h('input', { id: 'clave-codigo', name: 'codigo', type: 'text', autocomplete: 'off', spellcheck: false, required: true, maxlength: 60 })),
        campoClave('nueva', 'Clave nueva', 'new-password'), campoClave('repetida', 'Repite la clave nueva', 'new-password')],
      'Cambiar la clave y entrar',
      async (el) => {
        comprobarNueva(el.nueva.value, el.repetida.value);
        await pedirAPI('api/recuperar', { codigo: el.codigo.value, claveNueva: el.nueva.value });
        aviso('Clave cambiada.');
        await entrar(el.nueva.value);
      },
      h('p', {}, h('button', { type: 'button', class: 'enlace', onclick: () => { pantalla = 'bloqueo'; pintar(); } }, 'Volver')));
  } else if (!MODO_PC) {
    contenido = formularioClave('App bloqueada',
      ['Escribe tu clave para ver tus finanzas.'],
      [campoClave('clave', 'Clave', 'current-password')],
      'Abrir',
      async (el) => {
        frenoLocal();
        const sobre = await db.leer('estadoCifrado');
        if (!sobre || !config.salDrive) { pantalla = 'conectarCelular'; pintar(); return; }
        const k = await derivarClave(el.clave.value, config.salDrive, sobre.kdf && sobre.kdf.iteraciones);
        let datos;
        try { datos = await descifrarDrive(k, sobre); } catch { throw falloLocal(); }
        estado = M.validarEstado(datos);
        clave = k;
        await entrar();
      },
      h('p', { class: 'explicacion' }, '¿Olvidaste la clave? Recupérala en el PC con tu código de recuperación; después escribe aquí la clave nueva.'));
  } else {
    contenido = formularioClave('App bloqueada',
      ['Escribe tu clave para ver tus finanzas.'],
      [campoClave('clave', 'Clave', 'current-password')],
      'Abrir',
      async (el) => {
        await pedirAPI('api/desbloquear', { clave: el.clave.value });
        await entrar(el.clave.value);
      },
      h('p', {}, h('button', { type: 'button', class: 'enlace', onclick: () => { pantalla = 'recuperar'; pintar(); } }, '¿Olvidaste la clave? Usa el código de recuperación')));
  }
  $('#vista').replaceChildren(contenido);
}

/** El servidor dice que la app está bloqueada (se cerró la ventana negra o pasó mucho tiempo sin usarla). */
function mostrarBloqueo() {
  if (pantalla) return;
  proteccion.abierta = false;
  clave = null;
  llavePromesa = null;
  pantalla = 'bloqueo';
  if ($('#dialogo').open) $('#dialogo').close();
  pintar();
}

async function bloquearAhora(motivo) {
  if (pantalla && pantalla !== 'claveNueva') return;
  if (MODO_PC) {
    clearTimeout(temporizadorArchivo);
    try { await enviarArchivo(); } catch { /* se intentó */ }
    try { await pedirAPI('api/bloquear', {}); } catch { /* el servidor ya no está: igualmente se borra de la pantalla */ }
  } else if (clave && !pantalla) {
    try { await persistir(); } catch { /* se intentó */ }
  }
  clearTimeout(temporizadorSync);
  estado = M.nuevoEstado();
  clave = null;
  llavePromesa = null;
  salPendiente = null;
  proteccion.abierta = false;
  pantalla = 'bloqueo';
  if ($('#dialogo').open) $('#dialogo').close();
  pintar();
  if (motivo) aviso(motivo, 'alerta');
}

function cambiarClaveDialogo() {
  const dlg = $('#dialogo');
  const errores = h('div', { class: 'errores', role: 'alert' });
  const form = h('form', { class: 'formulario', novalidate: true },
    h('h2', {}, 'Cambiar la clave'),
    campoClave('actual', 'Clave actual', 'current-password'),
    campoClave('nueva', 'Clave nueva', 'new-password', 'Al menos 10 caracteres. El código de recuperación sigue siendo el mismo. Si usas el celular, allí te pedirá la clave nueva.'),
    campoClave('repetida', 'Repite la clave nueva', 'new-password'),
    errores,
    h('div', { class: 'botones' }, h('span', { class: 'espacio' }),
      h('button', { type: 'button', class: 'boton', onclick: () => dlg.close() }, 'Cancelar'),
      h('button', { type: 'submit', class: 'boton primario' }, 'Cambiar')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const nueva = form.elements.nueva.value;
      comprobarNueva(nueva, form.elements.repetida.value);
      await pedirAPI('api/clave/cambiar', { actual: form.elements.actual.value, nueva });
      if (config.salDrive) {
        // La copia de Drive pasa a la clave nueva (ahora o en la próxima sincronización).
        const salNueva = nuevaSal();
        const kNueva = await derivarClave(nueva, salNueva);
        recifrarPendiente = { vieja: clave };
        clave = kNueva;
        config.salDrive = salNueva;
        await guardarConfig();
        sincronizarAhora({ silencioso: true });
      }
      dlg.close();
      aviso('Clave cambiada.');
    } catch (e) {
      if (e.bloqueada) { dlg.close(); mostrarBloqueo(); return; }
      errores.replaceChildren(h('p', {}, e.message));
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
  form.elements.actual.focus();
}

function tarjetaClave() {
  if (!proteccion.protegida || !MODO_PC) return null;
  return tarjeta('Clave de la app',
    h('p', {}, etiqueta('Activada', 'ok'), ' Tus datos y sus copias diarias están cifrados en el PC. Sin la clave (o el código de recuperación) no se pueden abrir.'),
    explicacion(`La app se bloquea sola tras ${MINUTOS_INACTIVIDAD} minutos sin usarla, al cerrar la pestaña y al cerrar la ventana negra. Lo que avisa Muse se añade en cuanto la desbloqueas.`),
    h('div', { class: 'botones' },
      h('button', { class: 'boton', onclick: () => cambiarClaveDialogo() }, 'Cambiar clave'),
      h('button', { class: 'boton', onclick: () => bloquearAhora() }, 'Bloquear ahora')));
}

// --- Celular: activar desde el PC ---

function activarCelularDialogo() {
  const dlg = $('#dialogo');
  const errores = h('div', { class: 'errores', role: 'alert' });
  const boton = h('button', { type: 'submit', class: 'boton primario' }, 'Activar');
  const form = h('form', { class: 'formulario', novalidate: true },
    h('h2', {}, 'Activar el celular'),
    h('p', { class: 'explicacion' }, 'Escribe tu clave. Con ella se cifra la copia que viaja por tu Drive hacia el celular. Google solo guarda un archivo ilegible en la carpeta oculta de la app.'),
    campoClave('clave', 'Clave de la app', 'current-password'),
    errores,
    h('div', { class: 'botones' }, h('span', { class: 'espacio' }),
      h('button', { type: 'button', class: 'boton', onclick: () => dlg.close() }, 'Cancelar'), boton));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errores.replaceChildren();
    boton.disabled = true;
    boton.textContent = 'Preparando…';
    try {
      const texto = form.elements.clave.value;
      await pedirAPI('api/clave/comprobar', { clave: texto });
      const { sobre } = await sync.leerRemoto();
      let sal = nuevaSal();
      let k = null;
      if (sobre) {
        const kRemota = await derivarClave(texto, sobre.kdf.sal, sobre.kdf.iteraciones);
        try { await descifrarDrive(kRemota, sobre); k = kRemota; sal = sobre.kdf.sal; } catch {
          if (!confirm('En tu Drive hay una copia anterior hecha con otra clave. ¿Sustituirla por los datos de este PC?')) throw new Error('No se ha cambiado nada.');
        }
      }
      if (!k) k = await derivarClave(texto, sal);
      if (sobre && sal !== sobre.kdf.sal) await sync.recifrar(estado, null, k, sal);
      clave = k;
      config.salDrive = sal;
      await guardarConfig();
      dlg.close();
      await sincronizarAhora();
      pintar();
    } catch (e) {
      if (e.bloqueada) { dlg.close(); mostrarBloqueo(); return; }
      errores.replaceChildren(h('p', {}, e.message));
      boton.disabled = false;
      boton.textContent = 'Activar';
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
  form.elements.clave.focus();
}

async function desactivarCelular() {
  if (!confirm('¿Dejar de sincronizar con el celular desde este PC? Tus datos no se borran. La copia cifrada que hay en Drive se queda, pero deja de actualizarse.')) return;
  clave = null;
  config.salDrive = '';
  config.ultimaSync = null;
  otraClaveEnDrive = false;
  sync.olvidarAcceso();
  await guardarConfig();
  pintar();
}

async function olvidarCelular() {
  if (!confirm('¿Borrar los datos de este celular? Siguen a salvo en el PC y en la copia cifrada de Drive: para volver a verlos aquí te pedirá conectar con Drive y tu clave.')) return;
  await db.borrar('estadoCifrado');
  config.salDrive = '';
  config.ultimaSync = null;
  await guardarConfig();
  sync.olvidarAcceso();
  estado = M.nuevoEstado();
  clave = null;
  proteccion.abierta = false;
  pantalla = 'conectarCelular';
  pintar();
}

function tarjetaCelular() {
  const botonesCopia = [
    h('button', { class: 'boton primario', onclick: () => exportarCifrada() }, 'Exportar copia cifrada'),
    h('button', { class: 'boton', onclick: () => elegirArchivoImportar() }, 'Importar copia'),
  ];
  const regla = 'Mejor anota en un solo aparato y pasa la copia antes de anotar en el otro. Si anotas en los dos, no se pierde nada: al importar se juntan sin duplicar.';
  if (!MODO_PC) {
    return tarjeta('Este celular',
      h('p', {}, etiqueta('Cifrado con tu clave', 'ok'), ' Los datos se guardan cifrados en este celular. Se bloquea sola tras ' + MINUTOS_INACTIVIDAD + ' minutos sin usarla o al salir de la app un rato.'),
      h('ol', {},
        h('li', {}, 'Para llevar lo anotado aquí al PC: «Exportar copia cifrada» y guárdala en tu Drive (Finanzas → Copia cifrada). En el PC: Datos → Celular → «Importar copia».'),
        h('li', {}, 'Para traer lo del PC: en el PC «Exportar copia cifrada»; aquí «Importar copia» y elige el archivo en Drive.')),
      explicacion(regla),
      h('div', { class: 'botones' }, botonesCopia,
        h('button', { class: 'boton', onclick: () => bloquearAhora() }, 'Bloquear ahora'),
        h('button', { class: 'boton peligro', onclick: () => olvidarCelular() }, 'Borrar los datos de este celular')));
  }
  if (!proteccion.protegida) return null;
  return tarjeta('Celular',
    h('p', {}, 'Pasa tus datos al celular con una copia cifrada con tu clave: sin ella nadie puede leerla, ni siquiera Google.'),
    h('ol', {},
      h('li', {}, 'Para llevar lo del PC al celular: «Exportar copia cifrada», sube el archivo a tu Drive (Finanzas → Copia cifrada) y en el celular: Datos → «Importar copia».'),
      h('li', {}, 'Para traer lo anotado en el celular: allí «Exportar copia cifrada» a tu Drive; aquí «Importar copia».')),
    explicacion(regla),
    h('div', { class: 'botones' }, botonesCopia));
}

/** Pregunta al servidor si la app tiene clave y decide qué pantalla mostrar. */
async function comprobarProteccion() {
  if (!MODO_PC) {
    // Celular: siempre con clave y sin copias en claro.
    proteccion = { protegida: true, abierta: false };
    if (!config.protegida) { config.protegida = true; await guardarConfig(); }
    await limpiarNavegador();
    pantalla = (await db.leer('estadoCifrado')) && config.salDrive ? 'bloqueo' : 'conectarCelular';
    return;
  }
  try {
    proteccion = await pedirAPI('api/estado');
  } catch {
    // Sin servidor: si la app ya tenía clave, no se muestra nada; si no, sigue funcionando solo en el navegador.
    proteccion = { protegida: false, abierta: true };
    pantalla = config.protegida ? 'sinServidor' : null;
    return;
  }
  if (proteccion.protegida) {
    if (!config.protegida) { config.protegida = true; await guardarConfig(); }
    await limpiarNavegador();
    pantalla = proteccion.abierta ? null : 'bloqueo';
  } else {
    pantalla = 'crear';
  }
}

// ---------------------------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------------------------

async function arrancar() {
  // Protección: la app no funciona si alguien la mete dentro de otra página (para engañar con clics).
  if (window.top !== window.self) {
    document.body.textContent = 'Por seguridad, esta app no se puede abrir dentro de otra página.';
    return;
  }
  try {
    config = { ...config, ...((await db.leer('config')) || {}) };
    if (!config.dispositivo) {
      config.dispositivo = `${MODO_PC ? 'pc' : 'celular'}-${uid().slice(0, 6)}`;
      await guardarConfig();
    }
    await db.borrar('clave'); // versiones antiguas guardaban aquí la llave de Drive: ya no se guarda en ningún sitio
    await comprobarProteccion();
    if (!config.protegida) {
      const guardado = await db.leer('estado');
      if (guardado) estado = M.validarEstado(guardado);
    }
  } catch (e) {
    aviso(`No se pudieron leer los datos del navegador: ${e.message}`, 'error');
  }

  // Bloqueo por inactividad, al cerrar la pestaña y (en el celular) al salir de la app un rato.
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true });
  setInterval(() => {
    if (proteccion.protegida && !pantalla && Date.now() - ultimaActividad > MINUTOS_INACTIVIDAD * 60000) {
      bloquearAhora(`Se bloqueó tras ${MINUTOS_INACTIVIDAD} minutos sin usarla.`);
    }
  }, 30000);
  window.addEventListener('pagehide', () => {
    if (MODO_PC && proteccion.protegida && !pantalla) {
      fetch('api/bloquear', { method: 'POST', keepalive: true, headers: { 'X-Finanzas': '1', 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }).catch(() => {});
    }
  });

  // Al cerrar un formulario se repinta la pantalla con lo guardado (y con lo que haya llegado mientras tanto).
  $('#dialogo').addEventListener('close', () => pintar());
  db.pedirPersistencia();
  pintar();
  await traerArchivo({ avisar: false });
  pintar();

  // El archivo del PC se vuelve a leer cada 15 s y al volver a la app (así aparece lo que añade Jarvis).
  setInterval(() => { if (document.visibilityState === 'visible') traerArchivo(); }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { ocultaDesde = Date.now(); return; }
    if (!MODO_PC && proteccion.protegida && !pantalla && ocultaDesde && Date.now() - ocultaDesde > MINUTOS_OCULTA * 60000) {
      bloquearAhora();
      return;
    }
    traerArchivo();
    sincronizarAhora({ silencioso: true });
  });
  window.addEventListener('online', () => { pintarEstadoSync(); sincronizarAhora({ silencioso: true }); });
  window.addEventListener('offline', pintarEstadoSync);
  setInterval(() => sincronizarAhora({ silencioso: true }), 5 * 60 * 1000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

arrancar();
