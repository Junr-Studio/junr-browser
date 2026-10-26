'use strict';
// Fabrique de CRX/ZIP pour les tests (écriture ZIP « stored », en-tête CRX3 minimal avec clé publique).
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { extensionIdFromKey } = require('../src/extensions/crx');

function buildZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nm = Buffer.from(name);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const varint = (n) => { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
const field = (num, data) => Buffer.concat([varint(num * 8 + 2), varint(data.length), data]);

// → { crx, id, publicKey }
function buildCrx3(zip, publicKeyDer) {
  const id = extensionIdFromKey(publicKeyDer);
  const crxIdBytes = crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const proof = field(1, publicKeyDer); // signature omise : le navigateur ne la vérifie pas
  const header = Buffer.concat([field(2, proof), field(10000, field(1, crxIdBytes))]);
  const pre = Buffer.alloc(12);
  pre.write('Cr24', 0, 'latin1'); pre.writeUInt32LE(3, 4); pre.writeUInt32LE(header.length, 8);
  return { crx: Buffer.concat([pre, header, zip]), id, publicKey: publicKeyDer };
}

function newKey() {
  return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' });
}

module.exports = { buildZip, buildCrx3, newKey };
