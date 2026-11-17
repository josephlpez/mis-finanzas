// Cifrado de la copia que viaja por Google Drive.
// AES-GCM de 256 bits con una clave derivada de la frase de Jose (PBKDF2-SHA-256, 600 000 vueltas).
// La frase nunca se guarda. En cada dispositivo se guarda solo la clave derivada como "no exportable",
// de forma que ningún código puede leerla en claro.

import { aBase64, deBase64 } from './util.js';

export const ITERACIONES = 600000;
export const FORMATO_CIFRADO = 'finanzas-jose-cifrado';

const sutil = () => globalThis.crypto.subtle;

export function nuevaSal() {
  const s = new Uint8Array(16);
  globalThis.crypto.getRandomValues(s);
  return aBase64(s);
}

export async function derivarClave(frase, salB64, iteraciones = ITERACIONES) {
  if (typeof frase !== 'string' || frase.length < 10) throw new Error('La frase debe tener al menos 10 caracteres.');
  const material = await sutil().importKey('raw', new TextEncoder().encode(frase), 'PBKDF2', false, ['deriveKey']);
  return sutil().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deBase64(salB64), iterations: iteraciones },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function cifrar(clave, salB64, objeto, iteraciones = ITERACIONES) {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const datos = new TextEncoder().encode(JSON.stringify(objeto));
  const cifrado = await sutil().encrypt({ name: 'AES-GCM', iv }, clave, datos);
  return {
    formato: FORMATO_CIFRADO,
    v: 1,
    kdf: { alg: 'PBKDF2-SHA-256', iteraciones, sal: salB64 },
    iv: aBase64(iv),
    datos: aBase64(cifrado),
  };
}

export function esSobreCifrado(o) {
  return !!o && o.formato === FORMATO_CIFRADO && typeof o.iv === 'string' && typeof o.datos === 'string' && o.kdf && typeof o.kdf.sal === 'string';
}

export async function descifrar(clave, sobre) {
  if (!esSobreCifrado(sobre)) throw new Error('La copia de Drive no tiene el formato esperado.');
  try {
    const plano = await sutil().decrypt({ name: 'AES-GCM', iv: deBase64(sobre.iv) }, clave, deBase64(sobre.datos));
    return JSON.parse(new TextDecoder().decode(plano));
  } catch {
    throw new Error('No se pudo abrir la copia: la frase no es la correcta o el archivo está dañado.');
  }
}
