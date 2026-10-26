'use strict';
// Chiffrement des secrets au repos avec le coffre du système (DPAPI, Keychain, libsecret) via safeStorage.
const { safeStorage } = require('electron');

let availableCache = null;

async function available() {
  if (availableCache === null) {
    try { availableCache = await safeStorage.isAsyncEncryptionAvailable(); } catch { availableCache = false; }
  }
  return availableCache;
}

async function encrypt(plain) {
  if (!(await available())) throw new Error('Coffre de chiffrement du système indisponible');
  return (await safeStorage.encryptStringAsync(String(plain))).toString('base64');
}

async function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  let { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(buf);
  // Clé renouvelée : un second appel renvoie la valeur au niveau de sécurité courant ; l'appelant peut ré-enregistrer.
  if (shouldReEncrypt) ({ result } = await safeStorage.decryptStringAsync(buf));
  return result;
}

module.exports = { available, encrypt, decrypt };
