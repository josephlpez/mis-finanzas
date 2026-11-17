// Modelo de datos, cálculos y mezcla entre dispositivos.
// Cada registro lleva: id, actualizado (milisegundos), dispositivo y, si se borra, borrado: true
// (el borrado se conserva como "lápida" para que los demás también lo borren).

import { uid, hoy, diasEntre, redondear, enmascararTarjetas } from './util.js';

export const VERSION_DATOS = 2;

export const AMBITOS = ['personal', 'empresa', 'estudio', 'afiliados', 'cursos'];
export const MONEDAS = ['USD', 'USDT', 'MXN', 'EUR', 'CUP'];
export const TIPOS_503020 = ['necesidad', 'deseo', 'ahorro', 'no aplica'];
export const CATEGORIAS = [
  'Vivienda', 'Comida', 'Transporte', 'Servicios', 'Suscripción', 'Salud', 'Ropa', 'Ocio',
  'Formación', 'Inversiones', 'Compra', 'Envíos', 'Trabajo / proyecto', 'Comisiones', 'Regalos', 'Otros',
];

export const COLECCIONES = [
  'cuentas', 'movimientos', 'suscripciones', 'facturas', 'paquetes',
  'tasasBancus', 'tasasToque', 'tasasEUR', 'personales', 'notas',
  'ahorros', 'metas', 'deudas', 'inversiones', 'activosPasivos', 'ajustes',
];

// Campos de cada colección: formularios, validación al importar y Excel.
export const CAMPOS = {
  cuentas: [
    { k: 'nombre', l: 'Nombre', t: 'text', req: true },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'saldoInicial', l: 'Saldo inicial', t: 'number' },
    { k: 'ultimos4', l: 'Últimos 4 dígitos de la tarjeta (solo 4)', t: 'text', max: 4, patron: '^\\d{0,4}$' },
    { k: 'convertirConBancus', l: 'Convertir a USD con la tasa de Bancus', t: 'checkbox' },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  movimientos: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'hora', l: 'Hora', t: 'time' },
    { k: 'cuenta', l: 'Cuenta', t: 'cuenta', req: true },
    { k: 'tipo', l: 'Tipo', t: 'select', op: ['salida', 'entrada'], req: true },
    { k: 'monto', l: 'Monto (en la moneda de la cuenta)', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'tasa', l: 'Tasa del día (unidades por 1 $)', t: 'number', min: 0, ayuda: 'MXN: tasa del panel de Bancus. CUP: El Toque. EUR: euros por 1 $. Se congela: no se recalcula después.' },
    { k: 'interno', l: 'Movimiento interno entre cuentas propias (no cuenta como gasto ni ingreso)', t: 'checkbox' },
    { k: 'descripcion', l: 'Descripción', t: 'text', req: true },
    { k: 'categoria', l: 'Categoría', t: 'text', sug: CATEGORIAS },
    { k: 'tipo503020', l: 'Tipo 50-30-20 (solo gastos)', t: 'select', op: TIPOS_503020, ayuda: 'Necesidad = imprescindible. Deseo = prescindible. Ahorro = dinero que apartas.' },
    { k: 'ambito', l: 'Ámbito', t: 'select', op: AMBITOS },
    { k: 'deuda', l: 'Pago de una deuda', t: 'deuda' },
    { k: 'montoBruto', l: 'P2P: $ comprados (bruto, antes de comisión)', t: 'number', min: 0 },
    { k: 'cupPagados', l: 'P2P: CUP pagados', t: 'number', min: 0 },
    { k: 'vendedor', l: 'P2P: vendedor', t: 'text' },
    { k: 'referencia', l: 'Referencia de la operación (banco o app)', t: 'text' },
    { k: 'fuente', l: 'Fuente del dato', t: 'text' },
    { k: 'verificado', l: 'Verificado', t: 'checkbox' },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  suscripciones: [
    { k: 'nombre', l: 'Concepto', t: 'text', req: true },
    { k: 'categoria', l: 'Categoría', t: 'text', sug: CATEGORIAS },
    { k: 'monto', l: 'Importe', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'frecuencia', l: 'Frecuencia', t: 'select', op: ['mensual', 'anual', 'semanal'], req: true },
    { k: 'proximoCobro', l: 'Próximo cobro', t: 'date' },
    { k: 'avisoDias', l: 'Avisar con cuántos días', t: 'number', min: 0 },
    { k: 'estado', l: 'Estado', t: 'select', op: ['activa', 'pendiente', 'pausada', 'cancelada'] },
    { k: 'tipo503020', l: 'Tipo 50-30-20', t: 'select', op: TIPOS_503020 },
    { k: 'ambito', l: 'Ámbito', t: 'select', op: AMBITOS },
    { k: 'cuenta', l: 'Se cobra en', t: 'cuenta' },
    { k: 'verificado', l: 'Verificado', t: 'checkbox' },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  facturas: [
    { k: 'proveedor', l: 'Proveedor (servicio)', t: 'text', req: true },
    { k: 'concepto', l: 'Concepto', t: 'text' },
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'base', l: 'Precio del producto o servicio', t: 'number', req: true, min: 0 },
    { k: 'impuestos', l: 'Impuestos (vacío = pendiente)', t: 'number', min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'numero', l: 'N.º de documento o pedido', t: 'text' },
    { k: 'enlace', l: 'Enlace al archivo (Drive)', t: 'url' },
    { k: 'movimiento', l: 'Cargo en la cuenta', t: 'movimiento' },
    { k: 'ambito', l: 'Ámbito', t: 'select', op: AMBITOS },
    { k: 'verificado', l: 'Verificado', t: 'checkbox' },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  paquetes: [
    { k: 'tienda', l: 'Tienda', t: 'text', req: true },
    { k: 'pedido', l: 'Pedido', t: 'text' },
    { k: 'tracking', l: 'Tracking', t: 'text' },
    { k: 'fecha', l: 'Fecha', t: 'date' },
    { k: 'libras', l: 'Libras', t: 'number', min: 0 },
    { k: 'via', l: 'Traslado', t: 'select', op: ['marítimo', 'aéreo'] },
    { k: 'costo', l: 'Costo del traslado ($)', t: 'number', min: 0 },
    { k: 'estado', l: 'Estado', t: 'select', op: ['pedido', 'en camino a Miami', 'en Miami', 'en camino a Cuba', 'entregado'] },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  tasasBancus: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'valor', l: 'MXN por 1 $ (panel de Bancus)', t: 'number', req: true, min: 0 },
    { k: 'nota', l: 'Nota', t: 'text' },
  ],
  tasasToque: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'valor', l: 'CUP por 1 $ (El Toque)', t: 'number', req: true, min: 0 },
    { k: 'nota', l: 'Nota', t: 'text' },
  ],
  tasasEUR: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'valor', l: 'EUR por 1 $', t: 'number', req: true, min: 0 },
    { k: 'nota', l: 'Fuente o nota', t: 'text' },
  ],
  personales: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'tipo', l: 'Tipo', t: 'select', op: ['gasto', 'ingreso'], req: true },
    { k: 'monto', l: 'Monto', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'concepto', l: 'Concepto', t: 'text', req: true },
    { k: 'categoria', l: 'Categoría', t: 'text' },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  notas: [
    { k: 'titulo', l: 'Título', t: 'text', req: true },
    { k: 'texto', l: 'Texto', t: 'textarea' },
  ],
  ahorros: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'concepto', l: 'Concepto', t: 'text', req: true },
    { k: 'tipo', l: 'Tipo', t: 'select', op: ['aporte', 'retiro'], req: true },
    { k: 'destino', l: 'Destino', t: 'select', op: ['ahorro', 'fondo de emergencia', 'meta'], req: true },
    { k: 'meta', l: 'Meta (si el destino es una meta)', t: 'meta' },
    { k: 'monto', l: 'Importe', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  metas: [
    { k: 'nombre', l: 'Meta', t: 'text', req: true },
    { k: 'objetivo', l: 'Importe objetivo', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'ahorradoInicial', l: 'Ya ahorrado antes de usar la app', t: 'number', min: 0 },
    { k: 'fechaLimite', l: 'Fecha límite', t: 'date' },
    { k: 'gastosMensuales', l: 'Plan: tus gastos mensuales (vacío = los calcula la app)', t: 'number', min: 0 },
    { k: 'estado', l: 'Estado', t: 'select', op: ['activa', 'cumplida', 'pausada'] },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  deudas: [
    { k: 'acreedor', l: 'Acreedor / concepto', t: 'text', req: true },
    { k: 'importeTotal', l: 'Importe total', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'interesAnual', l: 'Interés anual (%)', t: 'number', min: 0 },
    { k: 'cuotaMensual', l: 'Cuota mensual', t: 'number', min: 0 },
    { k: 'pagadoInicial', l: 'Pagado antes de usar la app', t: 'number', min: 0 },
    { k: 'fechaFin', l: 'Fecha fin prevista', t: 'date' },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  inversiones: [
    { k: 'activo', l: 'Activo / inversión', t: 'text', req: true },
    { k: 'tipo', l: 'Tipo', t: 'select', op: ['Acción', 'Fondo / ETF', 'Cripto', 'Negocio', 'Inmueble', 'Depósito', 'Otro'] },
    { k: 'fechaCompra', l: 'Fecha de compra', t: 'date' },
    { k: 'montoInvertido', l: 'Monto invertido', t: 'number', req: true, min: 0 },
    { k: 'cantidad', l: 'Cantidad (participaciones, monedas…)', t: 'number', min: 0 },
    { k: 'precioCompra', l: 'Precio de compra', t: 'number', min: 0 },
    { k: 'precioActual', l: 'Precio actual', t: 'number', min: 0 },
    { k: 'dividendoAnual', l: 'Dividendo o interés anual', t: 'number', min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  activosPasivos: [
    { k: 'tipo', l: 'Tipo', t: 'select', op: ['activo', 'pasivo'], req: true },
    { k: 'concepto', l: 'Concepto', t: 'text', req: true },
    { k: 'valor', l: 'Valor', t: 'number', req: true, min: 0 },
    { k: 'ingresoMensual', l: 'Ingreso mensual que genera', t: 'number', min: 0 },
    { k: 'costeMensual', l: 'Coste mensual que quita', t: 'number', min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  ajustes: [
    { k: 'pctNecesidades', l: 'Presupuesto: % necesidades', t: 'number', min: 0 },
    { k: 'pctDeseos', l: 'Presupuesto: % deseos', t: 'number', min: 0 },
    { k: 'pctAhorro', l: 'Presupuesto: % ahorro', t: 'number', min: 0 },
    { k: 'metaAhorroMensual', l: 'Meta de ahorro de cada mes ($)', t: 'number', min: 0 },
    { k: 'fondoEmergenciaMeses', l: 'Fondo de emergencia: meses de gastos a cubrir', t: 'number', min: 0 },
  ],
};

export const AJUSTES_POR_DEFECTO = { id: 'ajustes', pctNecesidades: 50, pctDeseos: 30, pctAhorro: 20, metaAhorroMensual: null, fondoEmergenciaMeses: 6 };

export function nuevoEstado() {
  const e = { version: VERSION_DATOS };
  for (const c of COLECCIONES) e[c] = [];
  return e;
}

export function sello(registro, dispositivo, ahora = Date.now()) {
  return { ...registro, id: registro.id || uid(), actualizado: ahora, dispositivo };
}

export const vivos = (lista) => (lista || []).filter((r) => !r.borrado);
export const ajustes = (estado) => ({ ...AJUSTES_POR_DEFECTO, ...(vivos(estado.ajustes).find((a) => a.id === 'ajustes') || {}) });

// --- Tasas ------------------------------------------------------------------------------

/** Tasa de una tabla para una fecha: exacta o la más cercana. */
export function tasaPara(tabla, fecha) {
  const t = vivos(tabla).filter((x) => Number(x.valor) > 0);
  if (!t.length || !fecha) return null;
  const exacta = t.find((x) => x.fecha === fecha);
  if (exacta) return { valor: Number(exacta.valor), fecha: exacta.fecha, exacta: true };
  let mejor = null;
  for (const x of t) {
    const d = Math.abs(diasEntre(x.fecha, fecha));
    if (!mejor || d < mejor.d || (d === mejor.d && x.fecha < mejor.fecha)) mejor = { d, valor: Number(x.valor), fecha: x.fecha };
  }
  return { valor: mejor.valor, fecha: mejor.fecha, exacta: false };
}

export function ultimaTasa(tabla) {
  const t = vivos(tabla).filter((x) => Number(x.valor) > 0).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return t[0] ? { valor: Number(t[0].valor), fecha: t[0].fecha } : null;
}

const TABLA_DE = { MXN: 'tasasBancus', CUP: 'tasasToque', EUR: 'tasasEUR' };

/** Tasa sugerida para congelar en un movimiento (MXN solo con tasa exacta del día). */
export function tasaSugerida(estado, moneda, fecha) {
  const tabla = TABLA_DE[moneda];
  if (!tabla) return null;
  const t = tasaPara(estado[tabla], fecha);
  if (!t) return null;
  if (moneda === 'MXN' && !t.exacta) return null;
  return t;
}

/** Equivalente en USD. USD y USDT valen 1:1. Otras monedas necesitan tasa (unidades por 1 $). */
export function aUSD(monto, moneda, tasa) {
  if (monto === null || monto === undefined || monto === '') return null;
  if (moneda === 'USD' || moneda === 'USDT') return Number(monto);
  if (Number(tasa) > 0) return redondear(Number(monto) / Number(tasa));
  return null;
}

/** Valor de hoy en USD con la última tasa conocida de esa moneda (para saldos, metas, deudas…). */
export function aUSDHoy(estado, monto, moneda) {
  if (monto === null || monto === undefined || monto === '') return null;
  if (moneda === 'USD' || moneda === 'USDT') return Number(monto);
  const t = TABLA_DE[moneda] ? ultimaTasa(estado[TABLA_DE[moneda]]) : null;
  return t ? aUSD(monto, moneda, t.valor) : null;
}

export function deUSDaEUR(estado, usd) {
  const t = ultimaTasa(estado.tasasEUR);
  return t && usd !== null ? redondear(usd * t.valor) : null;
}

export const usdMovimiento = (m) => aUSD(m.monto, m.moneda, m.tasa);
export const signo = (m) => (m.tipo === 'entrada' ? 1 : -1);

// --- Saldos -----------------------------------------------------------------------------

export function saldos(estado) {
  const tasaHoy = ultimaTasa(estado.tasasBancus);
  return vivos(estado.cuentas).map((c) => {
    const movs = vivos(estado.movimientos).filter((m) => m.cuenta === c.id);
    const saldo = redondear(movs.reduce((s, m) => s + signo(m) * Number(m.monto || 0), Number(c.saldoInicial || 0)));
    let usd = aUSD(saldo, c.moneda, null);
    let tasa = null;
    if (usd === null && c.moneda === 'MXN' && c.convertirConBancus && tasaHoy) {
      usd = aUSD(saldo, 'MXN', tasaHoy.valor);
      tasa = tasaHoy;
    } else if (usd === null) {
      usd = aUSDHoy(estado, saldo, c.moneda);
    }
    return { cuenta: c, saldo, usd, tasa, movimientos: movs.length };
  });
}

export const totalCuentasUSD = (estado) => redondear(saldos(estado).reduce((a, x) => a + (x.usd || 0), 0));

// --- Suscripciones y gastos fijos ----------------------------------------------------------

export function proximosCobros(estado, hoyF = hoy()) {
  return vivos(estado.suscripciones)
    .filter((s) => s.estado !== 'cancelada' && s.estado !== 'pausada' && s.proximoCobro)
    .map((s) => ({ s, dias: diasEntre(hoyF, s.proximoCobro), usd: aUSDHoy(estado, s.monto, s.moneda) }))
    .sort((a, b) => a.dias - b.dias);
}

/** Coste mensual equivalente de los gastos fijos activos (anual / 12, semanal × 52 / 12). */
export function gastosFijosMensuales(estado) {
  let total = 0;
  const sinTasa = [];
  for (const s of vivos(estado.suscripciones)) {
    if (s.estado !== 'activa') continue;
    const usd = aUSDHoy(estado, s.monto, s.moneda);
    if (usd === null) { sinTasa.push(s.nombre); continue; }
    total += s.frecuencia === 'anual' ? usd / 12 : s.frecuencia === 'semanal' ? (usd * 52) / 12 : usd;
  }
  return { total: redondear(total), sinTasa };
}

export function alertaSaldo(estado, hoyF = hoy(), horizonte = 30) {
  const disponible = totalCuentasUSD(estado);
  // Cuentan las activas y las pendientes con fecha (se espera el cobro); no las pausadas ni canceladas.
  const cobros = proximosCobros(estado, hoyF).filter((x) => x.dias >= 0 && x.dias <= horizonte && ['activa', 'pendiente', null, undefined].includes(x.s.estado));
  const necesario = redondear(cobros.reduce((s, x) => s + (x.usd || 0), 0));
  const sinTasa = cobros.filter((x) => x.usd === null).map((x) => x.s.nombre);
  return { disponible, necesario, falta: redondear(Math.max(0, necesario - disponible)), cobros, sinTasa };
}

// --- Gastos e ingresos (sin movimientos internos) -----------------------------------------

export const esReal = (m) => !m.interno && !m.borrado;
/** Reversas, reembolsos y devoluciones: entradas que anulan un gasto. */
export const esDevolucion = (m) => m.tipo === 'entrada' && /revers|reembols|devoluci|refund/i.test(`${m.categoria || ''} ${m.descripcion || ''}`);

export function resumenPorAmbito(estado, desde, hasta) {
  const r = {};
  for (const m of vivos(estado.movimientos)) {
    if (m.interno) continue;
    if (desde && m.fecha < desde) continue;
    if (hasta && m.fecha > hasta) continue;
    const a = m.ambito || 'sin ámbito';
    r[a] ||= { entradas: 0, salidas: 0, sinConvertir: 0 };
    const usd = usdMovimiento(m);
    if (usd === null) { r[a].sinConvertir++; continue; }
    if (m.tipo === 'entrada') r[a].entradas = redondear(r[a].entradas + usd);
    else r[a].salidas = redondear(r[a].salidas + usd);
  }
  return r;
}

/** Totales de un mes (AAAA-MM) en USD, sin movimientos internos. */
export function mes(estado, mesTxt) {
  const r = { ingresos: 0, gastos: 0, porTipo: { necesidad: 0, deseo: 0, ahorro: 0, 'no aplica': 0, 'sin clasificar': 0 }, porCategoria: {}, sinConvertir: 0, sinClasificar: [] };
  for (const m of vivos(estado.movimientos)) {
    if (m.interno || String(m.fecha).slice(0, 7) !== mesTxt) continue;
    const usd = usdMovimiento(m);
    if (usd === null) { r.sinConvertir++; continue; }
    if (m.tipo === 'entrada' && esDevolucion(m)) {
      // Una devolución no es un ingreso: resta del gasto que anula.
      r.gastos -= usd;
      r.porTipo[m.tipo503020 || 'sin clasificar'] -= usd;
      const cat = m.categoria || 'Sin categoría';
      r.porCategoria[cat] = (r.porCategoria[cat] || 0) - usd;
      continue;
    }
    if (m.tipo === 'entrada') { r.ingresos += usd; continue; }
    r.gastos += usd;
    const t = m.tipo503020 || 'sin clasificar';
    r.porTipo[t] += usd;
    if (!m.tipo503020) r.sinClasificar.push(m);
    const cat = m.categoria || 'Sin categoría';
    r.porCategoria[cat] = (r.porCategoria[cat] || 0) + usd;
  }
  r.ingresos = redondear(r.ingresos);
  r.gastos = redondear(r.gastos);
  for (const k of Object.keys(r.porTipo)) r.porTipo[k] = redondear(r.porTipo[k]);
  for (const k of Object.keys(r.porCategoria)) r.porCategoria[k] = redondear(r.porCategoria[k]);
  return r;
}

// --- Ahorro, metas, deudas, inversiones y patrimonio ------------------------------------------

export function ahorroMes(estado, mesTxt) {
  let total = 0;
  for (const a of vivos(estado.ahorros)) {
    if (String(a.fecha).slice(0, 7) !== mesTxt) continue;
    total += (a.tipo === 'retiro' ? -1 : 1) * (aUSDHoy(estado, a.monto, a.moneda) || 0);
  }
  return redondear(total);
}

/** Presupuesto 50-30-20 de un mes. */
export function presupuesto(estado, mesTxt) {
  const aj = ajustes(estado);
  const m = mes(estado, mesTxt);
  const ahorroReal = redondear(ahorroMes(estado, mesTxt) + m.porTipo.ahorro);
  const filas = [
    { clave: 'necesidad', nombre: 'Necesidades', pct: aj.pctNecesidades, real: m.porTipo.necesidad },
    { clave: 'deseo', nombre: 'Deseos', pct: aj.pctDeseos, real: m.porTipo.deseo },
    { clave: 'ahorro', nombre: 'Ahorro', pct: aj.pctAhorro, real: ahorroReal },
  ].map((f) => {
    const objetivo = redondear((m.ingresos * Number(f.pct || 0)) / 100);
    return { ...f, objetivo, diferencia: redondear(objetivo - f.real), pctReal: m.ingresos > 0 ? redondear((f.real / m.ingresos) * 100) : null };
  });
  const formacion = redondear(m.porCategoria['Formación'] || 0);
  const inversion = redondear(m.porCategoria['Inversiones'] || 0);
  return { ...m, filas, formacion, inversion, balance: redondear(m.ingresos - m.gastos) };
}

export function totalesAhorro(estado) {
  const r = { ahorro: 0, 'fondo de emergencia': 0, meta: 0 };
  for (const a of vivos(estado.ahorros)) {
    const usd = aUSDHoy(estado, a.monto, a.moneda) || 0;
    r[a.destino || 'ahorro'] = redondear((r[a.destino || 'ahorro'] || 0) + (a.tipo === 'retiro' ? -usd : usd));
  }
  return { ...r, total: redondear(r.ahorro + r['fondo de emergencia'] + r.meta) };
}

/** Promedios de los últimos meses con movimientos (sin el mes en curso si hay meses anteriores). */
export function promedios(estado, hoyF = hoy(), meses = 3) {
  const h = historial(estado).filter((x) => x.mes < hoyF.slice(0, 7));
  const base = (h.length ? h : historial(estado)).slice(0, meses);
  if (!base.length) return { ingresos: 0, gastos: 0, meses: 0 };
  return {
    ingresos: redondear(base.reduce((s, x) => s + x.ingresos, 0) / base.length),
    gastos: redondear(base.reduce((s, x) => s + x.gastos, 0) / base.length),
    meses: base.length,
  };
}

export function estadoMeta(estado, meta, hoyF = hoy()) {
  const aportes = vivos(estado.ahorros).filter((a) => a.meta === meta.id);
  const ahorradoMoneda = redondear(Number(meta.ahorradoInicial || 0) + aportes.reduce((s, a) => s + (a.tipo === 'retiro' ? -1 : 1) * Number(a.moneda === meta.moneda ? a.monto : 0), 0));
  const aportesOtraMoneda = aportes.filter((a) => a.moneda !== meta.moneda).length;
  const objetivo = Number(meta.objetivo || 0);
  const pendiente = redondear(Math.max(0, objetivo - ahorradoMoneda));
  const pct = objetivo > 0 ? redondear((ahorradoMoneda / objetivo) * 100) : 0;
  const mesesRestantes = meta.fechaLimite ? Math.max(1, Math.ceil(diasEntre(hoyF, meta.fechaLimite) / 30.44)) : null;
  const vencida = meta.fechaLimite ? diasEntre(hoyF, meta.fechaLimite) < 0 : false;
  const mensualNecesario = mesesRestantes ? redondear(pendiente / mesesRestantes) : null;
  const esteMes = redondear(aportes.filter((a) => String(a.fecha).slice(0, 7) === hoyF.slice(0, 7) && a.moneda === meta.moneda).reduce((s, a) => s + (a.tipo === 'retiro' ? -1 : 1) * Number(a.monto), 0));
  const estadoMes = !objetivo ? '' : pendiente === 0 ? 'Cumplida' : mensualNecesario === null ? 'Sin fecha límite' : esteMes >= mensualNecesario ? 'Cumple este mes' : esteMes === 0 ? 'Sin ahorro este mes' : 'Por debajo este mes';
  // Plan: ingreso necesario = gastos mensuales + ahorro mensual necesario (en USD)
  const prom = promedios(estado, hoyF);
  const gastosMes = meta.gastosMensuales !== null && meta.gastosMensuales !== undefined && meta.gastosMensuales !== '' ? aUSDHoy(estado, meta.gastosMensuales, meta.moneda) : prom.gastos;
  const mensualUSD = mensualNecesario !== null ? aUSDHoy(estado, mensualNecesario, meta.moneda) : null;
  const ingresoNecesario = mensualUSD !== null && gastosMes !== null ? redondear(gastosMes + mensualUSD) : null;
  const brecha = ingresoNecesario !== null ? redondear(ingresoNecesario - prom.ingresos) : null;
  return { ahorrado: ahorradoMoneda, pendiente, pct, mesesRestantes, vencida, mensualNecesario, esteMes, estadoMes, ingresoNecesario, ingresoActual: prom.ingresos, brecha, aportesOtraMoneda };
}

export function estadoDeuda(estado, d) {
  const pagos = vivos(estado.movimientos).filter((m) => m.deuda === d.id && m.tipo === 'salida');
  let pagadoApp = 0;
  let sinConvertir = 0;
  for (const p of pagos) {
    if (p.moneda === d.moneda) pagadoApp += Number(p.monto);
    else {
      const usd = usdMovimiento(p);
      const enMoneda = usd === null ? null : d.moneda === 'USD' || d.moneda === 'USDT' ? usd : null;
      if (enMoneda === null) sinConvertir++;
      else pagadoApp += enMoneda;
    }
  }
  const pagado = redondear(Number(d.pagadoInicial || 0) + pagadoApp);
  const pendiente = redondear(Math.max(0, Number(d.importeTotal || 0) - pagado));
  const mesesRestantes = Number(d.cuotaMensual) > 0 ? Math.ceil(pendiente / Number(d.cuotaMensual)) : null;
  const pct = Number(d.importeTotal) > 0 ? redondear((pagado / Number(d.importeTotal)) * 100) : 0;
  return { pagado, pendiente, mesesRestantes, pct, pagos: pagos.length, sinConvertir, pendienteUSD: aUSDHoy(estado, pendiente, d.moneda) };
}

export function estadoInversion(estado, inv) {
  const invertido = Number(inv.montoInvertido || 0);
  const valor = Number(inv.cantidad) > 0 && Number(inv.precioActual) > 0 ? redondear(Number(inv.cantidad) * Number(inv.precioActual)) : invertido;
  const ganancia = redondear(valor - invertido);
  const rentabilidad = invertido > 0 ? redondear((ganancia / invertido) * 100) : 0;
  return { invertido, valor, ganancia, rentabilidad, valorUSD: aUSDHoy(estado, valor, inv.moneda), invertidoUSD: aUSDHoy(estado, invertido, inv.moneda) };
}

export function rendimientoActivo(a) {
  const valor = Number(a.valor || 0);
  return valor > 0 ? redondear(((Number(a.ingresoMensual || 0) - Number(a.costeMensual || 0)) * 12 * 100) / valor) : 0;
}

/** Patrimonio neto en USD: cuentas + inversiones + activos − deudas pendientes − pasivos. */
export function patrimonio(estado) {
  const sinTasa = [];
  const usd = (monto, moneda, nombre) => {
    const v = aUSDHoy(estado, monto, moneda);
    if (v === null) sinTasa.push(nombre);
    return v || 0;
  };
  const cuentas = totalCuentasUSD(estado);
  const inversiones = redondear(vivos(estado.inversiones).reduce((s, i) => s + usd(estadoInversion(estado, i).valor, i.moneda, i.activo), 0));
  const activos = redondear(vivos(estado.activosPasivos).filter((a) => a.tipo === 'activo').reduce((s, a) => s + usd(a.valor, a.moneda, a.concepto), 0));
  const pasivos = redondear(vivos(estado.activosPasivos).filter((a) => a.tipo === 'pasivo').reduce((s, a) => s + usd(a.valor, a.moneda, a.concepto), 0));
  const deudas = redondear(vivos(estado.deudas).reduce((s, d) => s + usd(estadoDeuda(estado, d).pendiente, d.moneda, d.acreedor), 0));
  const totalActivos = redondear(cuentas + inversiones + activos);
  const totalPasivos = redondear(deudas + pasivos);
  return { cuentas, inversiones, activos, deudas, pasivos, totalActivos, totalPasivos, neto: redondear(totalActivos - totalPasivos), sinTasa };
}

/** Historial mensual calculado desde los movimientos (del más reciente al más antiguo). */
export function historial(estado) {
  const aj = ajustes(estado);
  const meses = new Set(vivos(estado.movimientos).filter((m) => !m.interno && m.fecha).map((m) => String(m.fecha).slice(0, 7)));
  return [...meses].sort().reverse().map((mesTxt) => {
    const m = mes(estado, mesTxt);
    const ahorro = redondear(m.ingresos - m.gastos);
    const pct = m.ingresos > 0 ? redondear((ahorro / m.ingresos) * 100) : null;
    const meta = aj.metaAhorroMensual !== null && aj.metaAhorroMensual !== undefined ? Number(aj.metaAhorroMensual) : null;
    return { mes: mesTxt, ingresos: m.ingresos, gastos: m.gastos, ahorro, pct, meta, cumple: meta === null ? null : ahorro >= meta, sinConvertir: m.sinConvertir };
  });
}

// --- Comparación P2P QvaPay vs El Toque -------------------------------------------------------

export function comparacionP2P(estado) {
  const filas = vivos(estado.movimientos)
    .filter((m) => Number(m.cupPagados) > 0)
    .map((m) => {
      const bruto = Number(m.montoBruto) > 0 ? Number(m.montoBruto) : Number(m.monto);
      const neto = Number(m.monto);
      const toque = tasaPara(estado.tasasToque, m.fecha);
      const tasaVendedor = redondear(m.cupPagados / bruto);
      const tasaEfectiva = redondear(m.cupPagados / neto);
      const pct = toque ? redondear((tasaVendedor / toque.valor - 1) * 100) : null;
      const pctEfectivo = toque ? redondear((tasaEfectiva / toque.valor - 1) * 100) : null;
      const deMas = toque ? redondear(m.cupPagados - bruto * toque.valor) : null;
      return { m, bruto, neto, toque, tasaVendedor, tasaEfectiva, pct, pctEfectivo, deMas };
    })
    .sort((a, b) => (a.m.fecha < b.m.fecha ? 1 : -1));
  const totalBruto = redondear(filas.reduce((s, f) => s + f.bruto, 0));
  const totalCup = redondear(filas.reduce((s, f) => s + Number(f.m.cupPagados), 0));
  const totalDeMas = redondear(filas.reduce((s, f) => s + (f.deMas || 0), 0));
  const totalRef = totalCup - totalDeMas;
  const pctPonderado = totalRef > 0 ? redondear((totalCup / totalRef - 1) * 100) : null;
  return { filas, totalBruto, totalCup, totalDeMas, pctPonderado };
}

// --- Facturas -------------------------------------------------------------------------------

export function totalFactura(f) {
  const imp = f.impuestos === null || f.impuestos === undefined || f.impuestos === '' ? null : Number(f.impuestos);
  return { total: redondear(Number(f.base || 0) + (imp || 0)), impuestosPendientes: imp === null };
}

/** Compara la factura con su cargo en la cuenta (en USD). */
export function conciliacion(estado, f) {
  const { total, impuestosPendientes } = totalFactura(f);
  const mov = f.movimiento ? vivos(estado.movimientos).find((m) => m.id === f.movimiento) : null;
  const totalUSD = aUSD(total, f.moneda, f.moneda === 'MXN' && mov ? mov.tasa : null) ?? aUSDHoy(estado, total, f.moneda);
  if (!mov) return { total, impuestosPendientes, mov: null, cargoUSD: null, diferencia: null, tasaAproximada: false, revisar: true };
  const cargoUSD = usdMovimiento(mov);
  const diferencia = totalUSD !== null && cargoUSD !== null ? redondear(cargoUSD - totalUSD) : null;
  // Si el cargo se convirtió con la tasa de otro día, una diferencia pequeña (≤ 1,5 %) es solo del cambio.
  const tasaAproximada = mov.moneda !== 'USD' && mov.moneda !== 'USDT' && /aproximada/i.test(mov.nota || '');
  const soloCambio = tasaAproximada && diferencia !== null && totalUSD > 0 && Math.abs(diferencia) <= totalUSD * 0.015;
  const revisar = impuestosPendientes || (diferencia !== null && Math.abs(diferencia) >= 0.01 && !soloCambio);
  return { total, impuestosPendientes, mov, cargoUSD, diferencia, tasaAproximada, soloCambio, revisar };
}

// --- Finanzas personales (sección antigua, se conserva por compatibilidad) ------------------------

export function totalesPersonales(estado) {
  const porMes = {};
  for (const p of vivos(estado.personales)) {
    const m = String(p.fecha).slice(0, 7);
    porMes[m] ||= {};
    porMes[m][p.moneda] ||= { gastos: 0, ingresos: 0 };
    const t = porMes[m][p.moneda];
    if (p.tipo === 'ingreso') t.ingresos = redondear(t.ingresos + Number(p.monto));
    else t.gastos = redondear(t.gastos + Number(p.monto));
  }
  return porMes;
}

// --- Mezcla entre dispositivos -------------------------------------------------------------------

function masNuevo(a, b) {
  if ((a.actualizado || 0) !== (b.actualizado || 0)) return (a.actualizado || 0) > (b.actualizado || 0) ? a : b;
  return String(a.dispositivo || '') >= String(b.dispositivo || '') ? a : b;
}

/**
 * Mezcla dos estados registro a registro: gana la versión más reciente de cada registro.
 * Nunca se pierde un registro que solo exista en uno de los dos lados.
 */
export function mezclar(local, remoto) {
  const salida = nuevoEstado();
  let cambiosDesdeRemoto = 0;
  let cambiosHaciaRemoto = 0;
  for (const c of COLECCIONES) {
    const mapa = new Map();
    for (const r of local[c] || []) mapa.set(r.id, { l: r });
    for (const r of remoto[c] || []) mapa.set(r.id, { ...(mapa.get(r.id) || {}), r });
    for (const { l, r } of mapa.values()) {
      if (l && r) {
        const g = masNuevo(l, r);
        const distintos = r.actualizado !== l.actualizado || r.dispositivo !== l.dispositivo;
        if (g === r && distintos) cambiosDesdeRemoto++;
        if (g === l && distintos) cambiosHaciaRemoto++;
        salida[c].push(g);
      } else if (l) {
        cambiosHaciaRemoto++;
        salida[c].push(l);
      } else {
        cambiosDesdeRemoto++;
        salida[c].push(r);
      }
    }
  }
  return { estado: salida, cambiosDesdeRemoto, cambiosHaciaRemoto };
}

// --- Validación de lo que se importa, llega del archivo o de Drive ------------------------------

const MAX_TEXTO = 2000;
const RE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const TIPOS_REFERENCIA = new Set(['cuenta', 'movimiento', 'deuda', 'meta']);

function limpiarValor(campo, v) {
  if (v === null || v === undefined || v === '') return campo.t === 'checkbox' ? false : null;
  switch (campo.t) {
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return v === true || v === 'true' || v === 1;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
    case 'time':
      return /^\d{2}:\d{2}$/.test(String(v)) ? String(v) : null;
    case 'select':
      return campo.op.includes(v) ? v : null;
    case 'url': {
      const s = String(v).slice(0, MAX_TEXTO);
      return /^https:\/\//i.test(s) ? s : null; // solo enlaces https
    }
    default: {
      if (TIPOS_REFERENCIA.has(campo.t)) return RE_ID.test(String(v)) ? String(v) : null;
      let s = enmascararTarjetas(String(v).slice(0, MAX_TEXTO));
      if (campo.k === 'ultimos4') s = s.replace(/\D/g, '').slice(-4);
      return s;
    }
  }
}

/** Devuelve un estado limpio (solo campos conocidos y valores válidos) o lanza un error en español. */
export function validarEstado(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('El archivo no tiene el formato de la app.');
  if (Number(obj.version) > VERSION_DATOS) throw new Error('El archivo es de una versión más nueva de la app. Actualiza la app primero.');
  const limpio = nuevoEstado();
  for (const c of COLECCIONES) {
    const lista = obj[c] ?? [];
    if (!Array.isArray(lista)) throw new Error(`La sección «${c}» no es una lista.`);
    if (lista.length > 50000) throw new Error(`La sección «${c}» es demasiado grande.`);
    for (const r of lista) {
      if (!r || typeof r !== 'object' || !RE_ID.test(String(r.id))) throw new Error(`Hay un registro sin identificador válido en «${c}».`);
      const n = { id: String(r.id), actualizado: Number(r.actualizado) || 0, dispositivo: String(r.dispositivo || '').slice(0, 64) };
      if (r.borrado) {
        n.borrado = true;
      } else {
        for (const campo of CAMPOS[c]) n[campo.k] = limpiarValor(campo, r[campo.k]);
      }
      limpio[c].push(n);
    }
  }
  return limpio;
}

/** Comprueba un registro antes de guardarlo desde un formulario. Devuelve una lista de errores. */
export function erroresRegistro(coleccion, datos) {
  const errores = [];
  for (const campo of CAMPOS[coleccion]) {
    const v = datos[campo.k];
    if (campo.req && (v === null || v === undefined || v === '')) errores.push(`Falta «${campo.l}».`);
    if (campo.t === 'number' && v !== null && v !== '' && v !== undefined) {
      if (!Number.isFinite(Number(v))) errores.push(`«${campo.l}» no es un número.`);
      else if (campo.min !== undefined && Number(v) < campo.min) errores.push(`«${campo.l}» no puede ser negativo.`);
    }
    if (campo.t === 'url' && v && !/^https:\/\//i.test(v)) errores.push(`«${campo.l}» debe empezar por https://`);
    if (campo.k === 'ultimos4' && v && !/^\d{4}$/.test(v)) errores.push('Escribe solo los 4 últimos dígitos de la tarjeta.');
  }
  if (coleccion === 'movimientos' && datos.moneda === 'MXN' && !(Number(datos.tasa) > 0)) {
    errores.push('Los movimientos en MXN necesitan la tasa de Bancus del día.');
  }
  if (coleccion === 'ahorros' && datos.destino === 'meta' && !datos.meta) errores.push('Elige a qué meta va este aporte.');
  if (coleccion === 'ajustes') {
    const suma = ['pctNecesidades', 'pctDeseos', 'pctAhorro'].reduce((s, k) => s + Number(datos[k] || 0), 0);
    if (Math.abs(suma - 100) > 0.001) errores.push(`Los tres porcentajes deben sumar 100 (ahora suman ${suma}).`);
  }
  return errores;
}
