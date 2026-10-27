'use strict';
// Lance l'application en mode test. Sous Linux sans écran, passe par xvfb-run.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const args = ['.'];
let cmd = electron;
if (process.platform === 'linux') {
  args.push('--no-sandbox');
  if (!process.env.DISPLAY) { args.unshift(electron); cmd = 'xvfb-run'; args.unshift('-a'); }
}
const env = { ...process.env, JUNR_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE;
// Garde-fou externe (JUNR_TEST_TIMEOUT_MIN) : si l'application ne répond plus du tout (blocage natif, le chien de garde interne ne
// peut alors plus s'exécuter), elle est tuée. Seul un blocage est rejoué (JUNR_TEST_ATTEMPTS) : un échec de vérification ne l'est jamais.
const timeoutMs = process.env.JUNR_TEST_TIMEOUT_MIN ? Number(process.env.JUNR_TEST_TIMEOUT_MIN) * 60000 + 30000 : 0; // 30 s après le garde-fou interne
const attempts = Math.max(1, Number(process.env.JUNR_TEST_ATTEMPTS || 1));
for (let n = 1; n <= attempts; n++) {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' } : {}) });
  if (!(r.error && r.error.code === 'ETIMEDOUT')) process.exit(r.status ?? 1);
  console.log(`FAIL  Application bloquée : plus de ${Math.round(timeoutMs / 60000)} min sans fin (essai ${n}/${attempts})`);
  if (process.env.CI && process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/IM', 'electron.exe'], { stdio: 'ignore' });
}
process.exit(1);
