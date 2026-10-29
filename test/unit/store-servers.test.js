'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../../src/store');

test('TC-2-12 : un fichier sans clé hidden donne une liste vide, les secrets sont conservés', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junr-store-'));
  const file = path.join(dir, 'junr-data.json');
  fs.writeFileSync(file, JSON.stringify({ servers: { secrets: { railway: { token: 'enc:x' } }, observed: [] } }));
  const store = new Store(file);
  assert.deepEqual(store.data.servers.hidden, []);
  assert.deepEqual(store.data.servers.secrets, { railway: { token: 'enc:x' } });
  fs.rmSync(dir, { recursive: true, force: true });
});
