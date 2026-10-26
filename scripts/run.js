'use strict';
// Lance un script dans le processus principal d'Electron (dossier de données temporaire, sauf JUNR_USER_DATA).
//   node scripts/run.js scripts/phase0-probe.js
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const script = process.argv[2];
if (!script) { console.error('Usage : node scripts/run.js <script>'); process.exit(2); }

const root = path.join(__dirname, '..');
const args = ['.'];
let cmd = electron;
if (process.platform === 'linux') {
  args.push('--no-sandbox');
  if (!process.env.DISPLAY) { args.unshift(electron); cmd = 'xvfb-run'; args.unshift('-a'); }
}
const env = { ...process.env, JUNR_SCRIPT: path.resolve(script) };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
process.exit(r.status ?? 1);
