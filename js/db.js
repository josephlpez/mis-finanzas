// Almacenamiento local en el dispositivo (IndexedDB). Nada sale del dispositivo desde aquí.

const NOMBRE = 'finanzas-jose';
const ALMACEN = 'kv';
let abierta = null;

function abrir() {
  if (abierta) return abierta;
  abierta = new Promise((ok, mal) => {
    const pet = indexedDB.open(NOMBRE, 1);
    pet.onupgradeneeded = () => pet.result.createObjectStore(ALMACEN);
    pet.onsuccess = () => ok(pet.result);
    pet.onerror = () => mal(new Error('No se pudo abrir el almacenamiento del dispositivo.'));
  });
  return abierta;
}

async function operar(modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const tx = db.transaction(ALMACEN, modo);
    const res = fn(tx.objectStore(ALMACEN));
    tx.oncomplete = () => ok(res && 'result' in res ? res.result : undefined);
    tx.onerror = () => mal(tx.error || new Error('Error al guardar en el dispositivo.'));
    tx.onabort = () => mal(tx.error || new Error('Se canceló el guardado en el dispositivo.'));
  });
}

export const leer = (clave) => operar('readonly', (s) => s.get(clave));
export const guardar = (clave, valor) => operar('readwrite', (s) => s.put(valor, clave));
export const borrar = (clave) => operar('readwrite', (s) => s.delete(clave));

/** Guarda una copia de seguridad interna (se conservan las 10 últimas). */
export async function guardarRespaldo(estado, motivo) {
  const lista = (await leer('respaldos')) || [];
  lista.unshift({ fecha: new Date().toISOString(), motivo, estado });
  await guardar('respaldos', lista.slice(0, 10));
}

export const leerRespaldos = async () => (await leer('respaldos')) || [];

/** Pide al navegador que no borre los datos de la app aunque falte espacio. */
export async function pedirPersistencia() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {
    /* sin soporte */
  }
  return false;
}
