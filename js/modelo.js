// Modelo de datos, cálculos y mezcla entre dispositivos.
// Cada registro lleva: id, actualizado (milisegundos), dispositivo y, si se borra, borrado: true
// (el borrado se conserva como "lápida" para que los demás también lo borren).

import { uid, hoy, diasEntre, redondear, enmascararTarjetas } from './util.js';

export const VERSION_DATOS = 2;

export const AMBITOS = ['personal', 'empresa', 'estudio', 'afiliados', 'cursos', 'desarrollo de empresa y negocios', 'formación y desarrollo personal'];
export const MONEDAS = ['USD', 'USDT', 'MXN', 'EUR', 'CUP'];
// Tipo de cada gasto en el presupuesto (20-30-30-20 desde el 18 nov 2026). «necesidad» = necesidad personal.
export const TIPOS_503020 = ['necesidad', 'desarrollo de negocios', 'deseo', 'ahorro', 'no aplica'];
export const NOMBRES_TIPO = { necesidad: 'necesidad personal', 'desarrollo de negocios': 'desarrollo de negocios', deseo: 'deseo', ahorro: 'ahorro', 'no aplica': 'no aplica' };
// Para qué se destina cada ingreso. Cada parte del reparto lleva uno de estos destinos (u «otros» con texto).
export const DESTINOS = ['necesidades personales', 'desarrollo de negocios', 'desarrollo personal', 'pagado a mí', 'compra y venta', 'deseos', 'ahorro', 'meta', 'otros'];
export const MEDIOS_HORMIGA = ['efectivo', 'transferencia', 'deuda'];
export const CATEGORIAS = [
  'Vivienda', 'Comida', 'Transporte', 'Servicios', 'Suscripción', 'Salud', 'Ropa', 'Ocio',
  'Formación', 'Inversiones', 'Compra', 'Envíos', 'Trabajo / proyecto', 'Comisiones', 'Regalos', 'Otros',
];

export const COLECCIONES = [
  'cuentas', 'movimientos', 'suscripciones', 'facturas', 'paquetes',
  'tasasBancus', 'tasasToque', 'tasasEUR', 'personales', 'notas',
  'ahorros', 'metas', 'deudas', 'inversiones', 'activosPasivos', 'ajustes',
  'articulos', 'hormigas', 'gastosNegocio',
];

export const TIPOS_GASTO_NEGOCIO = ['formación', 'curso', 'anuncio o promoción pagada', 'herramienta o suscripción', 'otros'];
export const TIPOS_ANUNCIO = ['Instagram', 'Facebook', 'TikTok', 'Google', 'YouTube', 'WhatsApp', 'otro'];

export const CATEGORIAS_EXTRA = ['Formación personal', 'Formación para negocios', 'Pagado a mí', 'Gasto hormiga', 'Compra para revender'];

// Campos de cada colección: formularios, validación al importar y Excel.
export const CAMPOS = {
  cuentas: [
    { k: 'nombre', l: 'Nombre', t: 'text', req: true },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'saldoInicial', l: 'Saldo inicial', t: 'number' },
    { k: 'ultimos4', l: 'Últimos 4 dígitos de la tarjeta (solo 4)', t: 'text', max: 4, patron: '^\\d{0,4}$' },
    { k: 'convertirConBancus', l: 'Convertir a USD con la tasa de Bancus (solo cuentas en MXN)', t: 'checkbox' },
    { k: 'guardaAhorro', l: 'En esta cuenta guardo el ahorro y el dinero de las metas (avisa si gasto de más)', t: 'checkbox' },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  movimientos: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'hora', l: 'Hora', t: 'time' },
    { k: 'cuenta', l: 'Cuenta', t: 'cuenta', req: true },
    { k: 'tipo', l: 'Tipo', t: 'select', op: ['salida', 'entrada'], req: true },
    { k: 'monto', l: 'Monto', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda del movimiento', t: 'select', op: MONEDAS, req: true, ayuda: 'La moneda en que entró o salió el dinero. Una cuenta puede tener varias (p. ej. efectivo en CUP y en $).' },
    { k: 'tasa', l: 'Tasa del día (unidades por 1 $)', t: 'number', min: 0, ayuda: 'MXN: tasa del panel de Bancus. CUP: El Toque. EUR: euros por 1 $. Se congela: no se recalcula después.' },
    { k: 'interno', l: 'Movimiento interno entre cuentas propias (no cuenta como gasto ni ingreso)', t: 'checkbox' },
    { k: 'retencion', l: 'Retención de Bancus (se anula sola: no cuenta como gasto ni ingreso)', t: 'checkbox' },
    { k: 'descripcion', l: 'Descripción', t: 'text', req: true },
    { k: 'categoria', l: 'Categoría', t: 'text', sug: [...CATEGORIAS, ...CATEGORIAS_EXTRA] },
    { k: 'subcategoria', l: 'Detalle (qué tipo: p. ej. curso de inglés, software, sueldo)', t: 'text' },
    { k: 'tipo503020', l: 'Tipo de gasto en el presupuesto (solo salidas)', t: 'select', op: TIPOS_503020, etq: NOMBRES_TIPO, ayuda: 'Necesidad personal = imprescindible para ti. Desarrollo de negocios = inversión en el negocio. Deseo = prescindible. Ahorro = dinero que apartas.' },
    { k: 'reparto', l: 'Para qué va este ingreso (solo entradas)', t: 'reparto' },
    { k: 'ambito', l: 'Ámbito', t: 'select', op: AMBITOS },
    { k: 'deuda', l: 'Pago de una deuda', t: 'deuda' },
    { k: 'p2p', l: 'Estos CUP pagaron la compra P2P', t: 'p2p', ayuda: 'Si esta salida de CUP pagó una compra P2P de QvaPay, elígela aquí.' },
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
    { k: 'tipo503020', l: 'Tipo de gasto en el presupuesto', t: 'select', op: TIPOS_503020, etq: NOMBRES_TIPO },
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
  articulos: [
    { k: 'nombre', l: 'Artículo', t: 'text', req: true },
    { k: 'cantidad', l: 'Cantidad', t: 'number', min: 0 },
    { k: 'fechaCompra', l: 'Fecha de compra', t: 'date', req: true },
    { k: 'tienda', l: 'Dónde se compró (tienda o proveedor)', t: 'text' },
    { k: 'costo', l: 'Costo de compra', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'movimientoCompra', l: 'Pago de la compra (movimiento de salida)', t: 'movimiento' },
    { k: 'peso', l: 'Peso (libras) que indica el taquillero de Panavana', t: 'number', min: 0 },
    { k: 'costoEnvio', l: 'Costo del envío que indica Panavana ($)', t: 'number', min: 0 },
    { k: 'montoFacturaPanavana', l: 'Monto final de la factura de Panavana ($)', t: 'number', min: 0, ayuda: 'Debe coincidir con la factura de Panavana registrada en Facturas cuando llegue.' },
    { k: 'facturaPanavana', l: 'Factura de Panavana registrada', t: 'factura' },
    { k: 'cliente', l: 'Cliente', t: 'text' },
    { k: 'precioVenta', l: 'Precio de venta (total)', t: 'number', min: 0 },
    { k: 'anticipo', l: 'Anticipo', t: 'number', min: 0 },
    { k: 'anticipoPone', l: 'Quién pone el anticipo', t: 'select', op: ['cliente', 'yo'] },
    { k: 'cobrado', l: 'Cobrado al cliente además del anticipo', t: 'number', min: 0 },
    { k: 'fechaVenta', l: 'Fecha de venta', t: 'date' },
    { k: 'estado', l: 'Estado', t: 'select', op: ['en stock', 'vendido', 'parcialmente vendido'] },
    { k: 'movimientoVenta', l: 'Cobro de la venta (movimiento de entrada)', t: 'entrada' },
    { k: 'ambito', l: 'Ámbito', t: 'select', op: AMBITOS },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  hormigas: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'concepto', l: 'Concepto (café, transporte, merienda…)', t: 'text', req: true },
    { k: 'monto', l: 'Importe', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'tasa', l: 'Tasa del día (unidades por 1 $)', t: 'number', min: 0 },
    { k: 'medio', l: 'Cómo lo pagaste', t: 'select', op: MEDIOS_HORMIGA, req: true, ayuda: 'Efectivo o transferencia: sale de la cuenta que elijas. Deuda: se apunta sola en Deudas.' },
    { k: 'cuenta', l: 'Cuenta (si pagaste en efectivo o transferencia)', t: 'cuenta' },
    { k: 'acreedor', l: 'A quién le debes (si te endeudaste)', t: 'text' },
    { k: 'fechaPagoDeuda', l: 'Cuándo piensas pagar la deuda', t: 'date' },
    { k: 'ambito', l: 'Ámbito', t: 'select', op: AMBITOS },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  gastosNegocio: [
    { k: 'fecha', l: 'Fecha', t: 'date', req: true },
    { k: 'negocio', l: 'Negocio', t: 'text', req: true, sug: ['Afiliados Insenia', 'Philocalia Studio', 'Philocalia Group', 'Cursos'], ayuda: 'Para qué negocio es este gasto.' },
    { k: 'tipoGasto', l: 'Tipo de gasto', t: 'select', op: TIPOS_GASTO_NEGOCIO, req: true },
    { k: 'tipoAnuncio', l: 'Tipo de anuncio (si es anuncio o promoción)', t: 'text', sug: TIPOS_ANUNCIO },
    { k: 'concepto', l: 'Concepto (qué curso, qué campaña…)', t: 'text', req: true },
    { k: 'monto', l: 'Gasto', t: 'number', req: true, min: 0 },
    { k: 'moneda', l: 'Moneda', t: 'select', op: MONEDAS, req: true },
    { k: 'tasa', l: 'Tasa del día (unidades por 1 $)', t: 'number', min: 0 },
    { k: 'cuenta', l: 'Pagado desde la cuenta', t: 'cuenta', req: true },
    { k: 'ambito', l: 'Ámbito', t: 'select', op: AMBITOS },
    { k: 'nota', l: 'Nota', t: 'textarea' },
  ],
  ajustes: [
    { k: 'pctNecesidades', l: 'Presupuesto: % necesidades personales', t: 'number', min: 0 },
    { k: 'pctNegocio', l: 'Presupuesto: % desarrollo de negocios', t: 'number', min: 0 },
    { k: 'pctDeseos', l: 'Presupuesto: % deseos', t: 'number', min: 0 },
    { k: 'pctAhorro', l: 'Presupuesto: % ahorro', t: 'number', min: 0 },
    { k: 'metaAhorroMensual', l: 'Meta de ahorro de cada mes ($)', t: 'number', min: 0 },
    { k: 'fondoEmergenciaMeses', l: 'Fondo de emergencia: meses de gastos a cubrir', t: 'number', min: 0 },
  ],
};

export const AJUSTES_POR_DEFECTO = { id: 'ajustes', pctNecesidades: 20, pctNegocio: 30, pctDeseos: 30, pctAhorro: 20, metaAhorroMensual: null, fondoEmergenciaMeses: 6 };

export function nuevoEstado() {
  const e = { version: VERSION_DATOS };
  for (const c of COLECCIONES) e[c] = [];
  return e;
}

export function sello(registro, dispositivo, ahora = Date.now()) {
  return { ...registro, id: registro.id || uid(), actualizado: ahora, dispositivo };
}

export const vivos = (lista) => (lista || []).filter((r) => !r.borrado);
export function ajustes(estado) {
  const guardados = vivos(estado.ajustes).find((a) => a.id === 'ajustes') || {};
  const r = { ...AJUSTES_POR_DEFECTO };
  for (const [k, v] of Object.entries(guardados)) if (v !== null && v !== undefined && v !== '') r[k] = v;
  // Ajustes de antes del 18 nov 2026 (50-30-20, sin casilla de negocio): pasan al reparto nuevo 20-30-30-20.
  if (guardados.pctNegocio === null || guardados.pctNegocio === undefined || guardados.pctNegocio === '') {
    Object.assign(r, { pctNecesidades: 20, pctNegocio: 30, pctDeseos: 30, pctAhorro: 20 });
  }
  return r;
}

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

/** Tasa sugerida para congelar en un movimiento: la del día o, si falta, la verificada más cercana (exacta: false). */
export function tasaSugerida(estado, moneda, fecha) {
  const tabla = TABLA_DE[moneda];
  if (!tabla) return null;
  return tasaPara(estado[tabla], fecha);
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

/**
 * Saldo de cada cuenta, separado por moneda: disponible = saldo inicial + entradas − salidas en cada moneda.
 * Una cuenta puede tener varias monedas (p. ej. efectivo en CUP y en $): cada una se convierte a $ con su tasa.
 */
export function saldos(estado) {
  return vivos(estado.cuentas).map((c) => {
    const movs = vivos(estado.movimientos).filter((m) => m.cuenta === c.id);
    const porMoneda = { [c.moneda]: Number(c.saldoInicial || 0) };
    for (const m of movs) {
      const mon = m.moneda || c.moneda;
      porMoneda[mon] = (porMoneda[mon] || 0) + signo(m) * Number(m.monto || 0);
    }
    const monedas = Object.entries(porMoneda).map(([moneda, s]) => {
      const saldoM = redondear(s);
      const t = TABLA_DE[moneda] ? ultimaTasa(estado[TABLA_DE[moneda]]) : null;
      return { moneda, saldo: saldoM, usd: aUSDHoy(estado, saldoM, moneda), tasa: t };
    }).filter((x) => x.moneda === c.moneda || Math.abs(x.saldo) >= 0.005);
    const principal = monedas.find((x) => x.moneda === c.moneda);
    const sinTasa = monedas.filter((x) => x.usd === null && x.saldo !== 0).map((x) => x.moneda);
    const usd = monedas.every((x) => x.usd === null) && monedas.some((x) => x.saldo !== 0) ? null : redondear(monedas.reduce((a, x) => a + (x.usd || 0), 0));
    return { cuenta: c, saldo: principal.saldo, usd, tasa: principal.tasa, monedas, sinTasa, movimientos: movs.length };
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

/** De dólares a otra moneda con la última tasa conocida (para metas en EUR, CUP o MXN). */
export function desdeUSD(estado, usd, moneda) {
  if (usd === null || usd === undefined) return null;
  if (moneda === 'USD' || moneda === 'USDT') return redondear(usd);
  const t = TABLA_DE[moneda] ? ultimaTasa(estado[TABLA_DE[moneda]]) : null;
  return t ? redondear(usd * t.valor) : null;
}

/** Partes del reparto de un ingreso, cada una con su importe en la moneda del movimiento y en $. */
export function repartoMovimiento(m) {
  if (m.tipo !== 'entrada' || !Array.isArray(m.reparto) || !m.reparto.length) return [];
  const total = Number(m.monto || 0);
  return m.reparto.map((p) => {
    const monto = Number(p.monto) > 0 ? Number(p.monto) : Number(p.pct) > 0 ? redondear((total * Number(p.pct)) / 100) : 0;
    return { ...p, montoMoneda: monto, usd: aUSD(monto, m.moneda, m.tasa) };
  }).filter((p) => p.montoMoneda > 0);
}

/** Ids de los movimientos unidos a compras y ventas de reventa (no cuentan como gasto ni ingreso normal). */
function idsReventa(estado) {
  const s = new Set();
  for (const a of vivos(estado.articulos)) {
    if (a.movimientoCompra) s.add(a.movimientoCompra);
    if (a.movimientoVenta) s.add(a.movimientoVenta);
  }
  return s;
}

/** Cuenta para el mes solo lo real: ni traspasos internos ni retenciones de Bancus. */
const cuentaEnMes = (m) => !m.interno && !m.retencion;

/** Totales de un mes (AAAA-MM) en USD, sin movimientos internos ni retenciones. */
export function mes(estado, mesTxt) {
  const r = {
    ingresos: 0, gastos: 0, gananciaReventa: 0, hormigaDeuda: 0,
    porTipo: { necesidad: 0, 'desarrollo de negocios': 0, deseo: 0, ahorro: 0, 'no aplica': 0, 'sin clasificar': 0 },
    porCategoria: {}, detalle: {}, porDestino: {}, sinConvertir: 0, sinClasificar: [],
  };
  const reventa = idsReventa(estado);
  const sumarDetalle = (tipo, cat, sub, usd) => {
    r.detalle[tipo] ||= {};
    r.detalle[tipo][cat] ||= { total: 0, sub: {} };
    r.detalle[tipo][cat].total += usd;
    if (sub) r.detalle[tipo][cat].sub[sub] = (r.detalle[tipo][cat].sub[sub] || 0) + usd;
  };
  for (const m of vivos(estado.movimientos)) {
    if (!cuentaEnMes(m) || String(m.fecha).slice(0, 7) !== mesTxt || reventa.has(m.id)) continue;
    if (String(m.deuda || '').startsWith('hd-')) continue; // pago de un gasto hormiga a crédito: ya contó al hacerlo
    const usd = usdMovimiento(m);
    if (usd === null) { r.sinConvertir++; continue; }
    const cat = m.categoria || 'Sin categoría';
    if (m.tipo === 'entrada' && esDevolucion(m)) {
      // Una devolución no es un ingreso: resta del gasto que anula.
      const t = m.tipo503020 || 'sin clasificar';
      r.gastos -= usd;
      r.porTipo[t] = (r.porTipo[t] || 0) - usd;
      r.porCategoria[cat] = (r.porCategoria[cat] || 0) - usd;
      sumarDetalle(t, cat, m.subcategoria, -usd);
      continue;
    }
    if (m.tipo === 'entrada') {
      r.ingresos += usd;
      for (const p of repartoMovimiento(m)) {
        const k = p.destino === 'otros' ? (p.texto || 'otros') : p.destino;
        r.porDestino[k] = (r.porDestino[k] || 0) + (p.usd || 0);
      }
      continue;
    }
    r.gastos += usd;
    const t = m.tipo503020 || 'sin clasificar';
    r.porTipo[t] = (r.porTipo[t] || 0) + usd;
    if (!m.tipo503020) r.sinClasificar.push(m);
    r.porCategoria[cat] = (r.porCategoria[cat] || 0) + usd;
    sumarDetalle(t, cat, m.subcategoria, usd);
  }
  // Gastos hormiga pagados a crédito: son gasto del mes en que se hacen (la deuda se paga después).
  for (const g of vivos(estado.hormigas)) {
    if (g.medio !== 'deuda' || String(g.fecha).slice(0, 7) !== mesTxt) continue;
    const usd = aUSD(g.monto, g.moneda, g.tasa) ?? aUSDHoy(estado, g.monto, g.moneda);
    if (usd === null) { r.sinConvertir++; continue; }
    r.gastos += usd;
    r.hormigaDeuda += usd;
    r.porTipo.deseo += usd;
    r.porCategoria['Gasto hormiga'] = (r.porCategoria['Gasto hormiga'] || 0) + usd;
    sumarDetalle('deseo', 'Gasto hormiga', `${g.concepto} (a crédito)`, usd);
  }
  // La ganancia de lo que se revende entra como ingreso el mes de la venta.
  for (const a of vivos(estado.articulos)) {
    const e = estadoArticulo(estado, a);
    if (!e.vendido || String(a.fechaVenta || '').slice(0, 7) !== mesTxt || e.gananciaUSD === null) continue;
    r.ingresos += e.gananciaUSD;
    r.gananciaReventa += e.gananciaUSD;
  }
  const red = (o) => { for (const k of Object.keys(o)) o[k] = redondear(o[k]); };
  r.ingresos = redondear(r.ingresos);
  r.gastos = redondear(r.gastos);
  r.gananciaReventa = redondear(r.gananciaReventa);
  r.hormigaDeuda = redondear(r.hormigaDeuda);
  red(r.porTipo); red(r.porCategoria); red(r.porDestino);
  for (const t of Object.values(r.detalle)) for (const c of Object.values(t)) { c.total = redondear(c.total); red(c.sub); }
  return r;
}

// --- Ahorro, metas, deudas, inversiones y patrimonio ------------------------------------------

/** Lo que se aparta para ahorro o metas: aportes de Ahorro + partes «ahorro»/«meta» del reparto de los ingresos. */
function apartados(estado) {
  const lista = [];
  for (const a of vivos(estado.ahorros)) {
    const usd = aUSDHoy(estado, a.monto, a.moneda) || 0;
    lista.push({ fecha: a.fecha, destino: a.destino || 'ahorro', meta: a.meta || null, usd: a.tipo === 'retiro' ? -usd : usd, monto: Number(a.monto || 0) * (a.tipo === 'retiro' ? -1 : 1), moneda: a.moneda });
  }
  for (const m of vivos(estado.movimientos)) {
    if (m.interno || m.retencion) continue;
    for (const p of repartoMovimiento(m)) {
      if (p.destino !== 'ahorro' && p.destino !== 'meta') continue;
      lista.push({ fecha: m.fecha, destino: p.destino, meta: p.meta || null, usd: p.usd || 0, monto: p.montoMoneda, moneda: m.moneda, desdeIngreso: true });
    }
  }
  return lista;
}

export function ahorroMes(estado, mesTxt) {
  return redondear(apartados(estado).filter((a) => String(a.fecha).slice(0, 7) === mesTxt).reduce((s, a) => s + a.usd, 0));
}

/** Presupuesto 20-30-30-20 de un mes: objetivo por %, gastado y lo asignado con el destino de los ingresos. */
export function presupuesto(estado, mesTxt) {
  const aj = ajustes(estado);
  const m = mes(estado, mesTxt);
  const ahorroReal = redondear(ahorroMes(estado, mesTxt) + (m.porTipo.ahorro || 0));
  const asignado = (claves) => redondear(claves.reduce((s, k) => s + (m.porDestino[k] || 0), 0));
  const filas = [
    { clave: 'necesidad', nombre: 'Necesidades personales', pct: aj.pctNecesidades, real: m.porTipo.necesidad || 0, asignado: asignado(['necesidades personales', 'pagado a mí']) },
    { clave: 'desarrollo de negocios', nombre: 'Desarrollo de negocios', pct: aj.pctNegocio, real: m.porTipo['desarrollo de negocios'] || 0, asignado: asignado(['desarrollo de negocios', 'compra y venta']) },
    { clave: 'deseo', nombre: 'Deseos', pct: aj.pctDeseos, real: m.porTipo.deseo || 0, asignado: asignado(['deseos']) },
    { clave: 'ahorro', nombre: 'Ahorro', pct: aj.pctAhorro, real: ahorroReal, asignado: asignado(['ahorro', 'meta']) },
  ].map((f) => {
    const objetivo = redondear((m.ingresos * Number(f.pct || 0)) / 100);
    return { ...f, objetivo, diferencia: redondear(objetivo - f.real), pctReal: m.ingresos > 0 ? redondear((f.real / m.ingresos) * 100) : null };
  });
  const formacion = redondear((m.porCategoria['Formación'] || 0) + (m.porCategoria['Formación personal'] || 0) + (m.porCategoria['Formación para negocios'] || 0));
  const inversion = redondear(m.porCategoria['Inversiones'] || 0);
  return { ...m, filas, formacion, inversion, balance: redondear(m.ingresos - m.gastos) };
}

export function totalesAhorro(estado) {
  const r = { ahorro: 0, 'fondo de emergencia': 0, meta: 0 };
  for (const a of apartados(estado)) r[a.destino] = redondear((r[a.destino] || 0) + a.usd);
  return { ...r, total: redondear(r.ahorro + r['fondo de emergencia'] + r.meta) };
}

/**
 * Alerta de la cuenta donde se guarda el ahorro (Bancus): si su saldo baja de lo que tendría que estar apartado
 * para ahorro y metas, se está gastando dinero de más.
 */
export function alertaAhorro(estado) {
  const marcadas = vivos(estado.cuentas).filter((c) => c.guardaAhorro);
  const cuentas = marcadas.length ? marcadas : vivos(estado.cuentas).filter((c) => /bancus/i.test(c.nombre || ''));
  const ids = new Set(cuentas.map((c) => c.id));
  const saldo = redondear(saldos(estado).filter((s) => ids.has(s.cuenta.id)).reduce((a, s) => a + (s.usd || 0), 0));
  const apartado = totalesAhorro(estado).total;
  return { cuentas, saldo, apartado, falta: redondear(Math.max(0, apartado - saldo)), alerta: cuentas.length > 0 && apartado > 0 && saldo < apartado };
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
  // Aportes: los de Ahorro y las partes «meta» del reparto de los ingresos. En otra moneda se pasan con la tasa.
  const aportes = apartados(estado).filter((a) => a.meta === meta.id).map((a) => ({
    fecha: a.fecha, moneda: meta.moneda, tipo: 'aporte',
    monto: a.moneda === meta.moneda ? a.monto : desdeUSD(estado, a.usd, meta.moneda),
  }));
  const ahorradoMoneda = redondear(Number(meta.ahorradoInicial || 0) + aportes.reduce((s, a) => s + Number(a.monto || 0), 0));
  const aportesOtraMoneda = aportes.filter((a) => a.monto === null).length;
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

/** Compras P2P (con CUP pagados) que todavía no tienen registrada la salida de CUP que las pagó. */
export function p2pSinOrigen(estado) {
  const pagadas = new Set(vivos(estado.movimientos).filter((m) => m.p2p).map((m) => m.p2p));
  return vivos(estado.movimientos).filter((m) => Number(m.cupPagados) > 0 && !pagadas.has(m.id));
}

// --- Triple reporte de Bancus ---------------------------------------------------------------------

const comercio = (m) => String(m.descripcion || '').toUpperCase().replace(/^(COMPRA|DEPOSITO|DEPÓSITO|REVERSA|DEPOSITO REVERSA)\s+/g, '').replace(/REVERSA\s+/g, '').replace(/[^A-Z0-9]/g, '').slice(0, 12);

/**
 * Bancus reporta algunas compras en 3 movimientos: retención (salida), liberación (entrada) y pago oficial (salida),
 * con el mismo importe, el mismo comercio y el mismo día. Solo el último es el gasto real.
 * Devuelve los grupos sin marcar todavía: { retencion: [salida, entrada], oficial }.
 */
export function triplesBancus(estado) {
  const grupos = new Map();
  for (const m of vivos(estado.movimientos)) {
    if (!m.fecha || !(Number(m.monto) > 0)) continue;
    const k = `${m.cuenta}|${m.fecha}|${Number(m.monto).toFixed(2)}|${comercio(m)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(m);
  }
  const r = [];
  for (const lista of grupos.values()) {
    const salidas = lista.filter((m) => m.tipo === 'salida');
    const entradas = lista.filter((m) => m.tipo === 'entrada');
    if (salidas.length !== 2 || entradas.length !== 1) continue;
    const orden = (m) => `${m.hora || ''}|${m.actualizado || 0}`;
    salidas.sort((a, b) => (orden(a) < orden(b) ? -1 : 1));
    const [primera, oficial] = salidas;
    const yaMarcado = primera.retencion && entradas[0].retencion && !oficial.retencion && !oficial.interno;
    if (!yaMarcado) r.push({ retencion: [primera, entradas[0]], oficial });
  }
  return r;
}

// --- Compra para revender ---------------------------------------------------------------------------

/** Cuentas de un artículo para revender: costo total (compra + envío Panavana), cobrado, lo que falta y la ganancia. */
export function estadoArticulo(estado, a) {
  const aUSDa = (monto, moneda) => (monto === null || monto === undefined || monto === '' ? 0 : aUSDHoy(estado, Number(monto), moneda));
  const costoUSD = aUSDa(a.costo, a.moneda);
  const envioUSD = Number(a.costoEnvio || 0);
  const costoTotalUSD = costoUSD === null ? null : redondear(costoUSD + envioUSD);
  const precioUSD = aUSDa(a.precioVenta, a.moneda);
  const anticipoCliente = a.anticipoPone === 'yo' ? 0 : Number(a.anticipo || 0);
  const cobrado = redondear(anticipoCliente + Number(a.cobrado || 0));
  const faltaCobrar = Number(a.precioVenta) > 0 ? redondear(Math.max(0, Number(a.precioVenta) - cobrado)) : null;
  const vendido = a.estado === 'vendido' || (Number(a.precioVenta) > 0 && faltaCobrar === 0 && !!a.fechaVenta);
  const gananciaUSD = Number(a.precioVenta) > 0 && costoTotalUSD !== null && precioUSD !== null ? redondear(precioUSD - costoTotalUSD) : null;
  const pctGanancia = gananciaUSD !== null && costoTotalUSD > 0 ? redondear((gananciaUSD / costoTotalUSD) * 100) : null;
  // La factura de Panavana registrada debe coincidir con el monto que apuntaste aquí.
  const factura = a.facturaPanavana ? vivos(estado.facturas).find((f) => f.id === a.facturaPanavana) : null;
  const totalFacturaUSD = factura ? aUSDHoy(estado, totalFactura(factura).total, factura.moneda) : null;
  const facturaCuadra = factura && Number(a.montoFacturaPanavana) > 0 && totalFacturaUSD !== null ? Math.abs(totalFacturaUSD - Number(a.montoFacturaPanavana)) < 0.01 : null;
  return { costoUSD, envioUSD, costoTotalUSD, precioUSD, cobrado, faltaCobrar, vendido, gananciaUSD, pctGanancia, factura, totalFacturaUSD, facturaCuadra };
}

export function totalesReventa(estado) {
  const r = { invertido: 0, recuperado: 0, enStock: 0, ganancia: 0, faltaCobrar: 0 };
  for (const a of vivos(estado.articulos)) {
    const e = estadoArticulo(estado, a);
    r.invertido += e.costoTotalUSD || 0;
    r.recuperado += aUSDHoy(estado, e.cobrado, a.moneda) || 0;
    if (!e.vendido) r.enStock += e.costoTotalUSD || 0;
    if (e.vendido) r.ganancia += e.gananciaUSD || 0;
    r.faltaCobrar += aUSDHoy(estado, e.faltaCobrar || 0, a.moneda) || 0;
  }
  for (const k of Object.keys(r)) r[k] = redondear(r[k]);
  return r;
}

// --- Gastos de negocio ----------------------------------------------------------------------------

/** Gastos de negocio agrupados por negocio y tipo (en $). */
export function resumenNegocio(estado, mesTxt = null) {
  const r = { total: 0, porNegocio: {}, sinConvertir: 0 };
  for (const g of vivos(estado.gastosNegocio)) {
    if (mesTxt && String(g.fecha).slice(0, 7) !== mesTxt) continue;
    const usd = aUSD(g.monto, g.moneda, g.tasa) ?? aUSDHoy(estado, g.monto, g.moneda);
    if (usd === null) { r.sinConvertir++; continue; }
    const n = g.negocio || 'Sin negocio';
    r.porNegocio[n] ||= { total: 0, porTipo: {} };
    r.porNegocio[n].total = redondear(r.porNegocio[n].total + usd);
    const t = g.tipoGasto === 'anuncio o promoción pagada' && g.tipoAnuncio ? `anuncio · ${g.tipoAnuncio}` : g.tipoGasto || 'otros';
    r.porNegocio[n].porTipo[t] = redondear((r.porNegocio[n].porTipo[t] || 0) + usd);
    r.total = redondear(r.total + usd);
  }
  return r;
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
const TIPOS_REFERENCIA = new Set(['cuenta', 'movimiento', 'deuda', 'meta', 'p2p', 'factura', 'entrada']);

/** Reparto de un ingreso: lista de { destino, texto, meta, monto, pct } (máximo 12 partes). */
function limpiarReparto(v) {
  if (!Array.isArray(v)) return null;
  const partes = v.slice(0, 12).map((p) => ({
    destino: DESTINOS.includes(p && p.destino) ? p.destino : 'otros',
    texto: p && p.texto ? enmascararTarjetas(String(p.texto).slice(0, 80)) : null,
    meta: p && RE_ID.test(String(p.meta || '')) ? String(p.meta) : null,
    monto: p && Number(p.monto) > 0 && Number.isFinite(Number(p.monto)) ? Number(p.monto) : null,
    pct: p && Number(p.pct) > 0 && Number(p.pct) <= 100 ? Number(p.pct) : null,
  })).filter((p) => p.monto || p.pct);
  return partes.length ? partes : null;
}

function limpiarValor(campo, v) {
  if (v === null || v === undefined || v === '') return campo.t === 'checkbox' ? false : null;
  if (campo.t === 'reparto') return limpiarReparto(v);
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
    const suma = ['pctNecesidades', 'pctNegocio', 'pctDeseos', 'pctAhorro'].reduce((s, k) => s + Number(datos[k] || 0), 0);
    if (Math.abs(suma - 100) > 0.001) errores.push(`Los cuatro porcentajes deben sumar 100 (ahora suman ${suma}).`);
  }
  if (coleccion === 'movimientos' && datos.tipo === 'entrada' && Array.isArray(datos.reparto) && datos.reparto.length) {
    const partes = repartoMovimiento({ ...datos, tasa: null });
    const suma = redondear(partes.reduce((s, p) => s + p.montoMoneda, 0));
    if (suma > Number(datos.monto || 0) + 0.005) errores.push(`El reparto (${suma}) es mayor que el ingreso (${datos.monto}).`);
    if (datos.reparto.some((p) => p.destino === 'meta' && !p.meta)) errores.push('En el reparto, elige a qué meta va la parte «meta».');
  }
  if (coleccion === 'hormigas') {
    if (datos.medio === 'deuda' && !datos.acreedor) errores.push('Escribe a quién le debes este gasto.');
    if (datos.medio !== 'deuda' && !datos.cuenta) errores.push('Elige de qué cuenta salió el dinero.');
  }
  if (coleccion === 'articulos' && Number(datos.anticipo) > 0 && !datos.anticipoPone) errores.push('Indica quién pone el anticipo: tú o el cliente.');
  return errores;
}
