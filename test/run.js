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
const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
process.exit(r.status ?? 1);
