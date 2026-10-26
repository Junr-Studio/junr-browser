'use strict';
// Messagerie native (chrome.runtime.connectNative / sendNativeMessage) : lance l'application « hôte » déclarée par un fichier
// de manifeste d'hôte (mêmes emplacements que Chrome, Edge et Chromium) et dialogue avec elle sur stdin/stdout, messages JSON
// précédés de leur longueur (4 octets, ordre natif). Seule une extension listée dans « allowed_origins » peut s'y connecter.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { app } = require('electron');

const MAX_FROM_HOST = 1024 * 1024; // limite de Chrome pour un message de l'hôte
const MAX_TO_HOST = 1024 * 1024;   // plafond choisi (Chrome : 4 Go)
const NAME_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

// Dossiers de manifestes, par plateforme (le premier est propre à Junr Browser : pratique pour les tests et les déploiements).
function manifestDirs() {
  const own = path.join(app.getPath('userData'), 'NativeMessagingHosts');
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [own, ...['Google/Chrome', 'Chromium', 'Microsoft Edge'].map((b) => path.join(home, 'Library/Application Support', b, 'NativeMessagingHosts')),
      ...['Google/Chrome', 'Chromium', 'Microsoft Edge'].map((b) => path.join('/Library/Application Support', b, 'NativeMessagingHosts'))];
  }
  if (process.platform === 'linux') {
    return [own, ...['google-chrome', 'chromium', 'microsoft-edge'].map((b) => path.join(home, '.config', b, 'NativeMessagingHosts')),
      '/etc/opt/chrome/native-messaging-hosts', '/etc/chromium/native-messaging-hosts', '/etc/opt/edge/native-messaging-hosts'];
  }
  return [own];
}

// Windows : le manifeste est désigné par une clé de registre (HKCU puis HKLM).
function registryManifest(name) {
  const keys = [];
  for (const root of ['HKCU', 'HKLM']) for (const b of ['Google\\Chrome', 'Chromium', 'Microsoft\\Edge']) keys.push(`${root}\\Software\\${b}\\NativeMessagingHosts\\${name}`);
  for (const key of keys) {
    try {
      const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
      const m = /REG_SZ\s+(.+)\s*$/m.exec(out);
      if (m && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch { /* clé absente */ }
  }
  return null;
}

function findManifest(name) {
  for (const dir of manifestDirs()) {
    const f = path.join(dir, `${name}.json`);
    if (fs.existsSync(f)) return f;
  }
  return process.platform === 'win32' ? registryManifest(name) : null;
}

// → { manifest, exe, args } ou une erreur au vocabulaire de Chrome.
function resolveHost(name, extId) {
  if (!NAME_RE.test(String(name))) throw new Error('Invalid native messaging host name specified.');
  const file = findManifest(name);
  if (!file) throw new Error('Specified native messaging host not found.');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { throw new Error('Native host manifest is invalid.'); }
  if (manifest.name !== name || manifest.type !== 'stdio' || !manifest.path) throw new Error('Native host manifest is invalid.');
  if (!(manifest.allowed_origins || []).includes(`chrome-extension://${extId}/`)) throw new Error('Access to the specified native messaging host is forbidden.');
  const exe = path.isAbsolute(manifest.path) ? manifest.path : path.resolve(path.dirname(file), manifest.path);
  if (!fs.existsSync(exe)) throw new Error('Specified native messaging host not found.');
  return { manifest, exe, args: [`chrome-extension://${extId}/`, ...(process.platform === 'win32' ? ['--parent-window=0'] : [])] };
}

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_TO_HOST) throw new Error('Message too large for native messaging host.');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

// Processus hôte : onMessage(m), onExit(code, stderrTail). L'expéditeur envoie par send(m) ; kill() ferme.
function launch(name, extId, { onMessage, onExit }) {
  const { exe, args } = resolveHost(name, extId);
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
  const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: viaShell });
  let buf = Buffer.alloc(0), closed = false, tail = '';
  const finish = (code) => { if (closed) return; closed = true; onExit(code, tail.trim()); };
  child.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (len > MAX_FROM_HOST) { child.kill(); return finish(-1); }
      if (buf.length < 4 + len) break;
      let msg;
      try { msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')); } catch { child.kill(); return finish(-1); }
      buf = buf.subarray(4 + len);
      onMessage(msg);
    }
  });
  child.stderr.on('data', (c) => { tail = (tail + c).slice(-500); });
  child.on('error', () => finish(-1));
  child.on('exit', (code) => finish(code));
  child.stdin.on('error', () => {});
  return {
    send: (m) => { if (!closed) child.stdin.write(frame(m)); },
    kill: () => {
      try {
        if (viaShell && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); // le .cmd et l'hôte qu'il lance
        else child.kill();
      } catch { /* déjà terminé */ }
    },
    get closed() { return closed; },
  };
}

// Message unique : lance l'hôte, envoie, renvoie la première réponse puis arrête l'hôte (délai : 30 s).
function sendOnce(name, extId, message) {
  return new Promise((resolve, reject) => {
    let host, done = false;
    const end = (fn) => { if (done) return; done = true; clearTimeout(timer); host?.kill(); fn(); };
    const timer = setTimeout(() => end(() => reject(new Error('Native host did not respond.'))), 30000);
    try {
      host = launch(name, extId, {
        onMessage: (m) => end(() => resolve(m)),
        onExit: () => end(() => reject(new Error('Native host has exited.'))),
      });
      host.send(message);
    } catch (e) { end(() => reject(e)); }
  });
}

module.exports = { launch, sendOnce, resolveHost, manifestDirs, frame };
