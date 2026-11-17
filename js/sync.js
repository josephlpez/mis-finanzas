// Sincronización entre el PC y el celular a través de Google Drive.
// - Usa la carpeta oculta de la app en el Drive de Jose (appDataFolder): solo esta app la ve
//   y el permiso que se pide (drive.appdata) no da acceso al resto del Drive.
// - Lo que se sube va cifrado con la clave de la app (ver cripto.js). Google solo guarda un archivo ilegible.
// - El permiso se pide en una ventanita de Google (oauth.html recibe la respuesta y la pasa a la app).
//   El acceso dura como mucho una hora y vive solo en la memoria de la sesión (sessionStorage).

import { cifrar, descifrar, esSobreCifrado } from './cripto.js';
import { mezclar, validarEstado } from './modelo.js';
import { uid } from './util.js';

const NOMBRE_ARCHIVO = 'finanzas-sync.json';
const ALCANCE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
const CLAVE_TOKEN = 'fj-token';

export class SinAcceso extends Error {
  constructor(msg = 'Hay que conectar con Google Drive.') {
    super(msg);
    this.name = 'SinAcceso';
  }
}

/** La copia de Drive está cifrada con otra clave (se cambió la clave en otro dispositivo). */
export class OtraClave extends Error {
  constructor(sal) {
    super('La copia de Drive está cifrada con otra clave.');
    this.name = 'OtraClave';
    this.sal = sal;
  }
}

export function urlRetorno() {
  const u = new URL('oauth.html', location.href);
  return u.origin + u.pathname;
}

export function validarIdCliente(id) {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(String(id || '').trim());
}

function guardarToken(p) {
  const concedido = (p.get('scope') || '').split(' ');
  if (!concedido.includes(ALCANCE)) throw new Error('No se concedió el permiso para la carpeta de la app en Drive.');
  const expira = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 - 60000;
  sessionStorage.setItem(CLAVE_TOKEN, JSON.stringify({ t: p.get('access_token'), expira }));
}

/** Abre la ventanita de Google y espera el permiso. Debe llamarse desde un clic. */
export function conectar(idCliente) {
  if (!validarIdCliente(idCliente)) return Promise.reject(new Error('Falta configurar el permiso de Google de la app.'));
  const estado = uid();
  const p = new URLSearchParams({
    client_id: idCliente.trim(),
    redirect_uri: urlRetorno(),
    response_type: 'token',
    scope: ALCANCE,
    include_granted_scopes: 'false',
    state: estado,
  });
  const ventana = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${p}`, 'finanzas-google', 'width=480,height=640');
  if (!ventana) return Promise.reject(new Error('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para esta app y vuelve a pulsar.'));
  return new Promise((ok, mal) => {
    const fin = (fn, v) => { window.removeEventListener('message', alRecibir); clearInterval(vigia); fn(v); };
    function alRecibir(ev) {
      if (ev.origin !== location.origin || ev.source !== ventana || !ev.data || ev.data.tipo !== 'finanzas-oauth') return;
      try { ventana.close(); } catch { /* ya cerrada */ }
      const r = new URLSearchParams(String(ev.data.hash || '').replace(/^#/, ''));
      if (r.get('state') !== estado) return fin(mal, new Error('La respuesta de Google no corresponde a esta app. Se ha ignorado.'));
      if (r.has('error')) return fin(mal, new Error(r.get('error') === 'access_denied' ? 'No diste permiso a la app en Google.' : `Google no dio acceso: ${r.get('error')}`));
      try { guardarToken(r); } catch (e) { return fin(mal, e); }
      return fin(ok, true);
    }
    window.addEventListener('message', alRecibir);
    const vigia = setInterval(() => { if (ventana.closed) fin(mal, new Error('Se cerró la ventana de Google sin dar permiso.')); }, 700);
  });
}

function token() {
  try {
    const x = JSON.parse(sessionStorage.getItem(CLAVE_TOKEN) || 'null');
    if (x && x.t && x.expira > Date.now()) return x.t;
  } catch {
    /* nada */
  }
  sessionStorage.removeItem(CLAVE_TOKEN);
  return null;
}

export const hayAcceso = () => !!token();
export const olvidarAcceso = () => sessionStorage.removeItem(CLAVE_TOKEN);

async function pedir(url, opciones = {}) {
  const t = token();
  if (!t) throw new SinAcceso();
  const r = await fetch(url, { ...opciones, headers: { ...(opciones.headers || {}), Authorization: `Bearer ${t}` }, cache: 'no-store' });
  if (r.status === 401 || r.status === 403) {
    olvidarAcceso();
    throw new SinAcceso('El acceso a Drive caducó. Vuelve a conectar.');
  }
  if (!r.ok) throw new Error(`Drive respondió con un error (${r.status}).`);
  return r;
}

async function buscarArchivo() {
  const q = encodeURIComponent(`name='${NOMBRE_ARCHIVO}' and trashed=false`);
  const r = await pedir(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  const j = await r.json();
  return j.files && j.files[0] ? j.files[0] : null;
}

/** Lee la copia remota cifrada (o null si aún no existe). */
export async function leerRemoto() {
  const f = await buscarArchivo();
  if (!f) return { archivo: null, sobre: null };
  const r = await pedir(`${API}/files/${encodeURIComponent(f.id)}?alt=media`);
  const sobre = await r.json();
  if (!esSobreCifrado(sobre)) throw new Error('La copia de Drive no está cifrada o está dañada. No se usará.');
  return { archivo: f, sobre };
}

async function escribirRemoto(archivo, sobre) {
  const cuerpo = JSON.stringify(sobre);
  if (archivo) {
    await pedir(`${SUBIDA}/files/${encodeURIComponent(archivo.id)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo,
    });
    return;
  }
  const limite = `fj${uid()}`;
  const multi = [
    `--${limite}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: NOMBRE_ARCHIVO, parents: ['appDataFolder'], mimeType: 'application/json' }),
    `--${limite}`,
    'Content-Type: application/json',
    '',
    cuerpo,
    `--${limite}--`,
  ].join('\r\n');
  await pedir(`${SUBIDA}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
    body: multi,
  });
}

/**
 * Sincroniza: baja la copia de Drive, la mezcla con la local registro a registro y sube el resultado.
 * Si la copia de Drive está cifrada con otra clave, lanza OtraClave (con su sal) sin tocar nada.
 * Devuelve { estado, desdeRemoto, haciaRemoto }.
 */
export async function sincronizar(estadoLocal, clave, sal) {
  const { archivo, sobre } = await leerRemoto();
  let remoto = { version: 1 };
  if (sobre) {
    if (sobre.kdf.sal !== sal) throw new OtraClave(sobre.kdf.sal);
    try {
      remoto = validarEstado(await descifrar(clave, sobre));
    } catch {
      throw new OtraClave(sobre.kdf.sal);
    }
  }
  const { estado, cambiosDesdeRemoto, cambiosHaciaRemoto } = mezclar(estadoLocal, remoto);
  if (!sobre || cambiosHaciaRemoto > 0) {
    await escribirRemoto(archivo, await cifrar(clave, sal, estado));
  }
  return { estado, desdeRemoto: cambiosDesdeRemoto, haciaRemoto: cambiosHaciaRemoto };
}

/**
 * Cambia la clave de la copia de Drive: la abre con la clave vieja (si puede), la mezcla con lo local
 * y la vuelve a subir cifrada con la nueva. Sin clave vieja (recuperación), la sustituye por lo local.
 */
export async function recifrar(estadoLocal, claveVieja, claveNueva, salNueva) {
  const { archivo, sobre } = await leerRemoto();
  let estado = estadoLocal;
  if (sobre && claveVieja) {
    try {
      estado = mezclar(estadoLocal, validarEstado(await descifrar(claveVieja, sobre))).estado;
    } catch { /* no se pudo abrir: se sustituye por lo local */ }
  }
  await escribirRemoto(archivo, await cifrar(claveNueva, salNueva, estado));
  return estado;
}
