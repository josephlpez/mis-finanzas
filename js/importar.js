// Importación de datos: copias de la propia app y el informe de Muse (finanzas-datos.json).
// Los registros del informe reciben identificadores estables (calculados a partir de su contenido),
// así el PC y el celular pueden importar el mismo informe sin duplicar nada al sincronizar.

import * as M from './modelo.js';
import { nuevoEstado, validarEstado, saldos, tasaPara, COLECCIONES } from './modelo.js';
import { enmascararTarjetas, redondear } from './util.js';

export const MAX_BYTES_IMPORTACION = 5 * 1024 * 1024;

/** Huella estable (FNV-1a de 64 bits) en hexadecimal. */
export function huella(texto) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export const CUENTAS_SEMILLA = {
  tarjeta: 'bancus-tarjeta',
  cripto: 'bancus-cripto',
  qvapay: 'qvapay',
};

function ambitoDesdeInforme(a) {
  if (a === 'negocio') return 'empresa';
  if (['personal', 'empresa', 'estudio', 'afiliados', 'cursos'].includes(a)) return a;
  return null;
}

/** Convierte el informe de Muse al formato de la app. */
export function desdeInformeMuse(inf) {
  const avisos = [];
  const sellado = Date.parse(inf.actualizado) || 0;
  const disp = 'informe';
  const base = (r) => ({ ...r, actualizado: sellado, dispositivo: disp });
  const fuente = `Informe de Muse (finanzas-datos.json, ${String(inf.actualizado || '').slice(0, 10)})`;
  const e = nuevoEstado();

  e.cuentas.push(
    base({ id: CUENTAS_SEMILLA.tarjeta, nombre: 'Bancus tarjeta', moneda: 'MXN', saldoInicial: 0, ultimos4: '', convertirConBancus: true, nota: 'Saldo en MXN; se muestra en $ con la tasa del panel de Bancus.' }),
    base({ id: CUENTAS_SEMILLA.cripto, nombre: 'Bancus cripto', moneda: 'USDT', saldoInicial: 0, convertirConBancus: false, nota: '1 USDT ≈ 1 $, sin conversión.' }),
    base({ id: CUENTAS_SEMILLA.qvapay, nombre: 'QvaPay', moneda: 'USD', saldoInicial: 0, convertirConBancus: false, nota: 'Saldo en $.' }),
  );

  // Tasas
  for (const [fecha, valor] of Object.entries(inf.tasas_bancus_mxn_usd || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    e.tasasBancus.push(base({ id: `tb-${fecha}`, fecha, valor: Number(valor), nota: 'Panel de Bancus' }));
  }
  const notasToque = inf.el_toque_notas || {};
  for (const [fecha, valor] of Object.entries(inf.el_toque_usd_cup || {})) {
    e.tasasToque.push(base({ id: `tt-${fecha}`, fecha, valor: Number(valor), nota: notasToque[fecha] || '' }));
  }

  // Movimientos: identificador estable = contenido + número de aparición (hay cargos idénticos repetidos)
  const vistos = new Map();
  const idEstable = (prefijo, m) => {
    const clave = `${prefijo}|${m.fecha}|${m.hora}|${m.detalle}|${m.cantidad}|${m.moneda}|${m.tipo}`;
    const n = (vistos.get(clave) || 0) + 1;
    vistos.set(clave, n);
    return `${prefijo}-${huella(`${clave}|${n}`)}`;
  };

  for (const m of inf.movimientos_bancus || []) {
    const esMXN = m.moneda === 'MXN';
    const interno = m.ambito === 'interno';
    const reg = {
      id: idEstable('bc', m),
      fecha: m.fecha,
      hora: m.hora || null,
      cuenta: esMXN ? CUENTAS_SEMILLA.tarjeta : CUENTAS_SEMILLA.cripto,
      tipo: m.tipo === 'entrada' ? 'entrada' : 'salida',
      monto: Number(m.cantidad),
      moneda: esMXN ? 'MXN' : 'USDT',
      interno,
      descripcion: enmascararTarjetas(m.detalle || ''),
      categoria: m.categoria || '',
      ambito: interno ? null : ambitoDesdeInforme(m.ambito),
      fuente,
      verificado: false,
      nota: '',
    };
    if (m.ambito === 'negocio') reg.nota = 'El informe dice «negocio»: revisa si es empresa, estudio u otro ámbito.';
    if (esMXN) {
      const t = tasaPara(e.tasasBancus, m.fecha);
      if (t) {
        reg.tasa = t.valor;
        if (!t.exacta) reg.nota = [reg.nota, `Tasa aproximada: no hay tasa de Bancus del ${m.fecha}; se usó la del ${t.fecha}.`].filter(Boolean).join(' ');
      } else {
        avisos.push(`Sin tasa de Bancus para el movimiento del ${m.fecha} (${m.detalle}).`);
      }
    }
    e.movimientos.push(base(reg));
  }

  for (const m of inf.movimientos_qvapay || []) {
    const detalle = enmascararTarjetas(m.detalle || '');
    const esP2P = /p2p/i.test(m.tipo || '');
    const esRetiro = /^retiro usdt/i.test(detalle);
    const bruto = (detalle.match(/bruto\s+(\d+(?:[.,]\d+)?)/i) || [])[1];
    const vendedor = esP2P ? (detalle.match(/\),?\s*([^,;]+?)\s+@/) || detalle.match(/,\s*([^,;@]+?)\s+@/) || [])[1] || null : null;
    const reg = {
      id: idEstable('qv', m),
      fecha: m.fecha,
      hora: m.hora || null,
      cuenta: CUENTAS_SEMILLA.qvapay,
      tipo: /entrada/i.test(m.tipo) ? 'entrada' : 'salida',
      monto: Number(m.cantidad),
      moneda: 'USD',
      // Retiros a Bancus = traspaso entre cuentas propias. Compras P2P = cambio de CUP en efectivo a $.
      interno: esRetiro || esP2P,
      descripcion: detalle,
      categoria: esRetiro ? 'Traspaso a Bancus (USDT)' : esP2P ? 'Cambio CUP → $ (P2P)' : 'Transferencia recibida',
      ambito: esRetiro || esP2P ? null : null,
      montoBruto: bruto ? Number(bruto.replace(',', '.')) : null,
      vendedor: vendedor ? vendedor.trim() : null,
      fuente: m.verificacion ? `${fuente}; según el informe, comprobado en el ${m.verificacion}` : fuente,
      verificado: false,
      nota: !esRetiro && !esP2P ? 'Asigna el ámbito: ¿pago, préstamo o regalo?' : '',
    };
    e.movimientos.push(base(reg));
  }

  // Suscripciones
  for (const s of inf.suscripciones || []) {
    const estadoTxt = String(s.estado || '');
    const estado = /^activa/i.test(estadoTxt) ? 'activa' : /^pendiente/i.test(estadoTxt) ? 'pendiente' : /cancel/i.test(estadoTxt) ? 'cancelada' : 'activa';
    e.suscripciones.push(base({
      id: `sus-${huella(s.nombre)}`,
      nombre: s.nombre,
      monto: Number(s.monto),
      moneda: s.moneda,
      frecuencia: s.periodo === 'anual' ? 'anual' : 'mensual',
      proximoCobro: s.proximo_cobro || null,
      avisoDias: s.periodo === 'anual' ? 15 : 5,
      estado,
      ambito: ambitoDesdeInforme(s.ambito),
      verificado: false,
      nota: enmascararTarjetas(estadoTxt),
    }));
  }

  // Panavana como nota de referencia
  if (inf.panavana) {
    const p = inf.panavana;
    const lineas = [
      p.casillero && `Casillero: ${p.casillero}`,
      p.direccion_miami && `Miami: ${p.direccion_miami}`,
      p.direccion_cuba && `Entrega: ${p.direccion_cuba}`,
      p.tarifa_barco_usd_lb && `Marítimo: ${p.tarifa_barco_usd_lb} $/lb`,
      p.tarifa_aereo_usd_lb && `Aéreo: ${p.tarifa_aereo_usd_lb} $/lb`,
      p.almacen_gratis_dias && `Almacén gratis: ${p.almacen_gratis_dias} días`,
      p.horario_almacen && `Horario: ${p.horario_almacen}`,
      p.telefono && `Teléfono: ${p.telefono}`,
      p.nota && `Nota: ${p.nota}`,
    ].filter(Boolean);
    e.notas.push(base({ id: 'panavana', titulo: 'Panavana', texto: lineas.join('\n') }));
  }

  // Comprobación: los saldos calculados deben coincidir con los del informe
  const calc = Object.fromEntries(saldos(e).map((x) => [x.cuenta.id, x.saldo]));
  const s = inf.saldos || {};
  const comprobar = (id, esperado, nombre) => {
    if (esperado === undefined || esperado === null) return;
    if (Math.abs(redondear(calc[id] - Number(esperado))) > 0.01) {
      avisos.push(`El saldo calculado de ${nombre} (${calc[id]}) no coincide con el del informe (${esperado}). Revisa los movimientos.`);
    }
  };
  comprobar(CUENTAS_SEMILLA.tarjeta, s.bancus?.tarjeta_mxn, 'Bancus tarjeta');
  comprobar(CUENTAS_SEMILLA.cripto, s.bancus?.cripto_usd, 'Bancus cripto');
  comprobar(CUENTAS_SEMILLA.qvapay, s.qvapay?.saldo_usd, 'QvaPay');

  return { estado: validarEstado(e), avisos };
}

// --- Novedades que deja Muse en Drive (Finanzas/Novedades) --------------------------------------
// Formato "finanzas-novedades-v1" (descrito en el segundo cerebro, jarvis/protocolo-finanzas-muse.md).

export const FORMATO_NOVEDADES = 'finanzas-novedades-v1';
const TABLA_TASA = { MXN: ['tasasBancus', 'tb'], CUP: ['tasasToque', 'tt'], EUR: ['tasasEUR', 'te'] };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Convierte unas novedades en registros de la app. Necesita el estado actual para reconocer
 * cuentas por nombre, poner la tasa del día y no duplicar lo que ya está.
 */
export function desdeNovedades(nov, actual) {
  if (!nov || nov.formato !== FORMATO_NOVEDADES) throw new Error('No es un archivo de novedades de finanzas.');
  const avisos = [];
  const omitidos = [];
  const sellado = Date.parse(nov.creado) || Date.now();
  const base = (r) => ({ ...r, actualizado: sellado, dispositivo: 'muse' });
  const e = M.nuevoEstado();
  const cuentas = M.vivos(actual.cuentas);
  const buscarCuenta = (v) => cuentas.find((c) => c.id === v) || cuentas.find((c) => norm(c.nombre) === norm(v));

  // Tasas primero (los movimientos las usan)
  for (const t of Array.isArray(nov.tasas) ? nov.tasas : []) {
    const destino = TABLA_TASA[t.moneda];
    if (!destino || !/^\d{4}-\d{2}-\d{2}$/.test(t.fecha || '') || !(Number(t.valor) > 0)) { avisos.push(`Tasa no válida: ${JSON.stringify(t).slice(0, 80)}`); continue; }
    e[destino[0]].push(base({ id: `${destino[1]}-${t.fecha}`, fecha: t.fecha, valor: Number(t.valor), nota: t.nota || t.fuente || '' }));
  }
  const conTasas = { ...actual, tasasBancus: [...actual.tasasBancus, ...e.tasasBancus], tasasToque: [...actual.tasasToque, ...e.tasasToque], tasasEUR: [...(actual.tasasEUR || []), ...e.tasasEUR] };

  const existentes = M.vivos(actual.movimientos);
  const vistos = new Map();
  for (const m of Array.isArray(nov.movimientos) ? nov.movimientos : []) {
    const cuenta = buscarCuenta(m.cuenta);
    const desc = enmascararTarjetas(String(m.descripcion || m.detalle || ''));
    if (!cuenta) { avisos.push(`Cuenta desconocida «${m.cuenta}» en «${desc}». No se añadió: crea la cuenta o corrige el nombre.`); continue; }
    const monto = Number(m.monto ?? m.cantidad);
    if (!(monto >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(m.fecha || '')) { avisos.push(`Movimiento sin fecha o importe válido: «${desc}».`); continue; }
    const tipo = /entrada|ingreso/i.test(m.tipo) ? 'entrada' : 'salida';
    const moneda = m.moneda || cuenta.moneda;
    // ¿Ya está? (misma referencia, o misma cuenta, fecha, hora, tipo, importe y descripción)
    const dup = existentes.find((x) => x.cuenta === cuenta.id && ((m.referencia && x.referencia === String(m.referencia)) ||
      (x.fecha === m.fecha && (x.hora || null) === (m.hora || null) && x.tipo === tipo && Number(x.monto) === monto && norm(x.descripcion) === norm(desc))));
    // También dentro del mismo archivo: una referencia repetida es el mismo movimiento.
    const dupLote = m.referencia && e.movimientos.some((x) => x.cuenta === cuenta.id && x.referencia === String(m.referencia));
    if (dup || dupLote) { omitidos.push(desc); continue; }
    const clave = m.referencia ? `${cuenta.id}|${m.referencia}` : `${cuenta.id}|${m.fecha}|${m.hora}|${tipo}|${monto}|${moneda}|${norm(desc)}`;
    const n = (vistos.get(clave) || 0) + 1;
    vistos.set(clave, n);
    let tasa = Number(m.tasa) > 0 ? Number(m.tasa) : null;
    let nota = String(m.nota || '');
    if (!tasa && moneda !== 'USD' && moneda !== 'USDT') {
      const t = M.tasaSugerida(conTasas, moneda, m.fecha);
      if (t) {
        tasa = t.valor;
        if (!t.exacta) nota = [nota, `Tasa aproximada: se usó la del ${t.fecha}.`].filter(Boolean).join(' ');
      } else {
        avisos.push(`Sin tasa del ${m.fecha} para ${moneda} en «${desc}»: añádela en Cambio → Tasas.`);
      }
    }
    e.movimientos.push(base({
      id: `nv-${huella(`${clave}|${n}`)}`,
      fecha: m.fecha,
      hora: m.hora || null,
      cuenta: cuenta.id,
      tipo,
      monto,
      moneda,
      tasa,
      interno: m.interno === true,
      descripcion: desc,
      categoria: m.categoria || '',
      tipo503020: m.tipo503020 || null,
      ambito: m.interno ? null : m.ambito === 'negocio' ? 'empresa' : m.ambito || null,
      montoBruto: m.montoBruto ?? null,
      cupPagados: m.cupPagados ?? null,
      vendedor: m.vendedor || null,
      referencia: m.referencia ? String(m.referencia) : null,
      fuente: m.fuente || `Muse (${String(nov.creado || '').slice(0, 16)})`,
      verificado: false,
      nota,
    }));
  }

  for (const f of Array.isArray(nov.facturas) ? nov.facturas : []) {
    if (!f.proveedor || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha || '')) { avisos.push(`Factura sin proveedor o fecha: ${JSON.stringify(f).slice(0, 80)}`); continue; }
    const id = f.archivoDrive ? `fac-drive-${String(f.archivoDrive).replace(/[^A-Za-z0-9_-]/g, '')}` : `fac-${huella(`${norm(f.proveedor)}|${f.numero}|${f.fecha}`)}`;
    // Jose une cada factura a su gasto a mano (petición del 18 nov): aquí NO se enlaza sola, solo se anota la pista.
    const pista = f.referenciaMovimiento ? ` Referencia del cargo según Muse: ${f.referenciaMovimiento}.` : '';
    if (f.base === null || f.base === undefined) avisos.push(`Factura de ${f.proveedor} (${f.fecha}) sin importe: complétala en la app.`);
    e.facturas.push(base({
      id,
      proveedor: f.proveedor,
      concepto: f.concepto || '',
      fecha: f.fecha,
      base: f.base ?? null,
      impuestos: f.impuestos ?? null,
      moneda: f.moneda || 'USD',
      numero: f.numero || '',
      enlace: f.archivoDrive ? `https://drive.google.com/file/d/${encodeURIComponent(f.archivoDrive)}/view` : f.enlace || null,
      movimiento: null,
      ambito: f.ambito === 'negocio' ? 'empresa' : f.ambito || null,
      verificado: false,
      nota: (f.nota || 'Añadida desde las novedades de Muse. Revisa importes y vincúlala a su cargo.') + pista,
    }));
  }

  // Cambios en suscripciones (por nombre): próxima fecha, importe o estado
  const subs = M.vivos(actual.suscripciones);
  for (const s of Array.isArray(nov.suscripciones) ? nov.suscripciones : []) {
    // Mismo nombre, o uno empieza por el otro («Google One» ↔ «Google One 200 GB»).
    const n = norm(s.nombre);
    const previa = n ? subs.find((x) => { const m = norm(x.nombre); return m && (m === n || m.startsWith(n) || n.startsWith(m)); }) : null;
    if (!previa && !(Number(s.monto) > 0)) {
      avisos.push(`Suscripción «${s.nombre || 'sin nombre'}» no existe en la app y no trae importe: no se añadió. Créala en Gastos fijos o pide a Muse el importe.`);
      continue;
    }
    const datos = Object.fromEntries(Object.entries(s).filter(([k]) => M.CAMPOS.suscripciones.some((c) => c.k === k)));
    if (previa) delete datos.nombre; // se conserva el nombre que ya tiene en la app
    // Un cambio de suscripción que avisa Muse es más reciente que lo que había: se marca con la hora actual.
    e.suscripciones.push({ ...(previa || { estado: 'activa', frecuencia: 'mensual', avisoDias: 5 }), ...datos, id: previa ? previa.id : `sus-${huella(norm(s.nombre))}`, actualizado: Date.now(), dispositivo: 'muse' });
  }

  return { estado: M.validarEstado(e), avisos, omitidos };
}

/** Lee un texto JSON y lo convierte en estado de la app, sea una copia de la app o un informe de Muse. */
/**
 * Lo que llega de Muse (informe, novedades, facturas de Drive) solo AÑADE registros nuevos: nunca cambia uno que
 * ya está en la app (Jose puede haberlo corregido) ni resucita uno que Jose borró. Solo los gastos fijos se
 * actualizan, porque Muse avisa justo de eso (próxima fecha, importe, estado).
 */
function soloNuevos(r, actual) {
  if (!actual || r.tipo === 'copia') return r;
  const estadoN = { ...r.estado };
  let ignorados = 0;
  for (const c of COLECCIONES) {
    if (c === 'suscripciones' || !Array.isArray(estadoN[c])) continue;
    const ya = new Set((actual[c] || []).map((x) => x.id));
    const antes = estadoN[c].length;
    estadoN[c] = estadoN[c].filter((x) => !ya.has(x.id));
    ignorados += antes - estadoN[c].length;
  }
  const avisos = ignorados ? [...r.avisos, `${ignorados} registros ya estaban en la app: se dejan como los tienes (con tus correcciones).`] : r.avisos;
  return { ...r, estado: estadoN, avisos };
}

export function importarTexto(texto, actual = null) {
  return soloNuevos(leerImportacion(texto, actual), actual);
}

function leerImportacion(texto, actual) {
  if (typeof texto !== 'string' || texto.length > MAX_BYTES_IMPORTACION) throw new Error('El archivo es demasiado grande o está vacío.');
  let obj;
  try {
    obj = JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (obj && Array.isArray(obj.movimientos_bancus)) return { ...desdeInformeMuse(obj), tipo: 'informe' };
  if (obj && obj.formato === FORMATO_NOVEDADES) {
    const r = desdeNovedades(obj, actual || M.nuevoEstado());
    return { estado: r.estado, avisos: [...r.avisos, ...(r.omitidos.length ? [`${r.omitidos.length} movimientos ya estaban y no se repiten.`] : [])], tipo: 'novedades' };
  }
  // Facturas nuevas que deja la tarea automática de Drive: solo facturas, solo se añaden.
  if (obj && obj.app === 'finanzas-jose' && obj.tipo === 'facturas-drive' && obj.datos) {
    // Sin enlazar: Jose une cada factura a su gasto a mano.
    const estado = validarEstado({ version: 1, facturas: (obj.datos.facturas || []).map((f) => ({ ...f, movimiento: null })) });
    const avisos = estado.facturas.filter((f) => f.base === null).map((f) => `${f.proveedor || 'Factura'} (${f.fecha || 'sin fecha'}): falta el importe; complétalo en la app.`);
    return { estado, avisos, tipo: 'facturas' };
  }
  if (obj && obj.app === 'finanzas-jose' && obj.datos) return { estado: validarEstado(obj.datos), avisos: [], tipo: 'copia' };
  if (obj && COLECCIONES.some((c) => Array.isArray(obj[c]))) return { estado: validarEstado(obj), avisos: [], tipo: 'copia' };
  throw new Error('No reconozco este archivo: no es una copia de la app ni un informe de Muse.');
}

/** Texto JSON de una copia completa de la app. */
export function exportarTexto(estado) {
  return JSON.stringify({ app: 'finanzas-jose', exportado: new Date().toISOString(), datos: estado }, null, 2);
}
