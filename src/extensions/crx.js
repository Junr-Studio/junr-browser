'use strict';
// Lecture de fichiers CRX (Chrome Web Store) et ZIP sans dépendance externe.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_TOTAL = 600 * 1024 * 1024; // garde-fou contre les archives piégées (zip bomb)

/* ---------- Identifiant d'extension ---------- */
// ID Chrome = 16 premiers octets du SHA-256 de la clé publique (DER), chaque quartet écrit a..p.
function extensionIdFromKey(publicKeyDer) {
  const hash = crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  return [...hash.toString('hex')].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

/* ---------- Protobuf minimal (en-tête CRX3) ---------- */
function readVarint(buf, pos) {
  let result = 0, shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('CRX : en-tête tronqué');
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
  }
}

function parseProto(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8), wire = tag % 8;
    if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new Error('CRX : en-tête tronqué');
      fields.push({ field, data: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 0) { let v; [v, pos] = readVarint(buf, pos); fields.push({ field, value: v }); }
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new Error('CRX : en-tête illisible');
  }
  return fields;
}

// → { zip, publicKey|null, id|null, version }
function parseCrx(buf) {
  if (buf.length > 4 && buf.toString('latin1', 0, 2) === 'PK') return { zip: buf, publicKey: null, id: null, version: 0 };
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('Fichier CRX invalide');
  const version = buf.readUInt32LE(4);
  if (version === 2) {
    const keyLen = buf.readUInt32LE(8), sigLen = buf.readUInt32LE(12);
    const publicKey = buf.subarray(16, 16 + keyLen);
    return { zip: buf.subarray(16 + keyLen + sigLen), publicKey, id: extensionIdFromKey(publicKey), version };
  }
  if (version !== 3) throw new Error(`Version de CRX non supportée : ${version}`);
  const headerLen = buf.readUInt32LE(8);
  const header = buf.subarray(12, 12 + headerLen);
  const keys = [];
  let crxId = null;
  for (const f of parseProto(header)) {
    if ((f.field === 2 || f.field === 3) && f.data) {
      const key = parseProto(f.data).find((x) => x.field === 1)?.data;
      if (key) keys.push(Buffer.from(key));
    } else if (f.field === 10000 && f.data) {
      const id = parseProto(f.data).find((x) => x.field === 1)?.data;
      if (id) crxId = Buffer.from(id).toString('hex');
    }
  }
  const idHex = (k) => crypto.createHash('sha256').update(k).digest().subarray(0, 16).toString('hex');
  const publicKey = keys.find((k) => idHex(k) === crxId) || null;
  if (!publicKey) throw new Error('CRX3 : clé publique introuvable dans l\'en-tête');
  return { zip: buf.subarray(12 + headerLen), publicKey, id: extensionIdFromKey(publicKey), version };
}

/* ---------- ZIP ---------- */
function listZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP invalide (fin de répertoire introuvable)');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || pos === 0xffffffff) throw new Error('ZIP64 non supporté');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP invalide (répertoire central)');
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const csize = buf.readUInt32LE(pos + 20);
    const usize = buf.readUInt32LE(pos + 24);
    const nlen = buf.readUInt16LE(pos + 28), elen = buf.readUInt16LE(pos + 30), clen = buf.readUInt16LE(pos + 32);
    const offset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nlen);
    entries.push({ name, method, crc, csize, usize, offset });
    pos += 46 + nlen + elen + clen;
  }
  return entries;
}

function entryData(buf, e) {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('ZIP invalide (en-tête local)');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = raw;
  else if (e.method === 8) out = zlib.inflateRawSync(raw, { maxOutputLength: e.usize + 1 });
  else throw new Error(`Méthode de compression ZIP non supportée : ${e.method}`);
  if (out.length !== e.usize) throw new Error(`ZIP corrompu : taille inattendue pour ${e.name}`);
  if (zlib.crc32 && zlib.crc32(out) !== e.crc) throw new Error(`ZIP corrompu : CRC invalide pour ${e.name}`);
  return out;
}

// Extrait dans `dest`. Refuse tout chemin sortant de `dest`. Le dossier `_metadata/` du Web Store est ignoré.
function extractZip(buf, dest, { skip = (name) => name.startsWith('_metadata/') } = {}) {
  const entries = listZip(buf);
  if (entries.reduce((s, e) => s + e.usize, 0) > MAX_TOTAL) throw new Error('Archive trop volumineuse');
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  for (const e of entries) {
    if (e.name.endsWith('/') || skip(e.name)) continue;
    const target = path.resolve(root, e.name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Chemin dangereux dans l'archive : ${e.name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entryData(buf, e));
  }
}

module.exports = { parseCrx, extractZip, listZip, extensionIdFromKey };
