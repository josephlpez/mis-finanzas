// Utilidades sin dependencias. Funcionan en el navegador y en Node (para las pruebas).

export function uid() {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Fecha local de hoy en formato AAAA-MM-DD. */
export function hoy(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function diasEntre(desde, hasta) {
  const a = Date.UTC(...partes(desde));
  const b = Date.UTC(...partes(hasta));
  return Math.round((b - a) / 86400000);
}

function partes(f) {
  const [y, m, d] = String(f).split('-').map(Number);
  return [y, m - 1, d];
}

/** Suma un periodo a una fecha AAAA-MM-DD (mensual, anual, semanal). */
export function sumarPeriodo(fecha, frecuencia) {
  const [y, m, d] = partes(fecha);
  let f;
  if (frecuencia === 'anual') f = new Date(Date.UTC(y + 1, m, d));
  else if (frecuencia === 'semanal') f = new Date(Date.UTC(y, m, d + 7));
  else {
    // mensual: si el día no existe en el mes siguiente, último día del mes
    const ultimo = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    f = new Date(Date.UTC(y, m + 1, Math.min(d, ultimo)));
  }
  return f.toISOString().slice(0, 10);
}

export function redondear(n, dec = 2) {
  const k = 10 ** dec;
  const r = Math.round((Number(n) + Number.EPSILON) * k) / k;
  return r === 0 ? 0 : r; // evita mostrar «-0,00»
}

const formato = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function dinero(n, moneda = 'USD') {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  const simbolo = { USD: '$', USDT: 'USDT', MXN: 'MXN', EUR: '€', CUP: 'CUP' }[moneda] || moneda;
  return `${formato.format(Number(n))} ${simbolo}`;
}

/** Número con formato español, sin símbolo (para tasas y porcentajes). */
export function numero(n, dec = 2) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec }).format(Number(n));
}

export function fechaLarga(f) {
  if (!f) return '—';
  const [y, m, d] = partes(f);
  return new Date(Date.UTC(y, m, d)).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// --- Protección de datos de tarjeta -------------------------------------------------
// Busca secuencias de 13 a 19 dígitos (con espacios o guiones) que pasen el algoritmo de Luhn.
const RE_POSIBLE_TARJETA = /\d(?:[ -]?\d){12,18}/g;

function luhn(digitos) {
  let suma = 0;
  let doble = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = digitos.charCodeAt(i) - 48;
    if (doble) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    suma += n;
    doble = !doble;
  }
  return suma % 10 === 0;
}

function esTarjeta(t) {
  const d = t.replace(/[ -]/g, '');
  return d.length >= 13 && d.length <= 19 && luhn(d);
}

export function contieneTarjeta(texto) {
  if (typeof texto !== 'string') return false;
  return (texto.match(RE_POSIBLE_TARJETA) || []).some(esTarjeta);
}

/** Sustituye cualquier número de tarjeta por •••• y sus 4 últimos dígitos. */
export function enmascararTarjetas(texto) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(RE_POSIBLE_TARJETA, (t) => (esTarjeta(t) ? `•••• ${t.replace(/[ -]/g, '').slice(-4)}` : t));
}

export function aBase64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function deBase64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
