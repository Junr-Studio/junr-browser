'use strict';
// Vérifie qu'une extension installée, son stockage et les cookies d'un client survivent à un redémarrage complet.
//   npm run phase0:persistence
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junr-persist-'));

function launch(phase) {
  const env = { ...process.env, JUNR_SCRIPT: path.join(__dirname, 'phase0-persistence-run.js'), JUNR_USER_DATA: dir, PHASE: String(phase) };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = process.platform === 'linux' ? ['.', '--no-sandbox'] : ['.'];
  const r = spawnSync(electron, args, { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('PERSIST_RESULT '));
  if (!line) { console.error(r.stdout, r.stderr); throw new Error(`Phase ${phase} sans résultat`); }
  return JSON.parse(line.slice('PERSIST_RESULT '.length));
}

const p1 = launch(1);
console.log('Phase 1 (installation)  :', p1);
const p2 = launch(2);
console.log('Phase 2 (après arrêt)   :', p2);

const checks = [
  ['Extension enregistrée après redémarrage', p2.recordFound && p2.enabled],
  ['Extension rechargée dans la partition du client', p2.loadedInSession],
  ['Service worker redémarré', p2.swReported],
  ['Stockage de l\'extension conservé (chrome.storage.local)', p1.persistPrev === null && typeof p2.persistPrev === 'string'],
  ['Cookie httpOnly du client conservé', p2.cookiePersisted],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
