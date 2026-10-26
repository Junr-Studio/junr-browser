'use strict';
// Gestionnaire d'extensions : installe, met à jour et active chaque extension UNE fois, puis la charge dans
// toutes les partitions (clients + outils communs). Electron lie une extension à une session : on la
// déploie donc dans chacune.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { state } = require('../state');
const { parseCrx, extractZip } = require('./crx');
const { bus } = require('../state');
const compat = require('./compat');
const shim = require('./shim');

const BUNDLED_DIR = path.join(__dirname, '..', '..', 'extensions');
const DEFAULT_BASE = 'https://clients2.google.com/service/update2/crx';
const MAX_DOWNLOAD = 300 * 1024 * 1024;

const root = () => path.join(app.getPath('userData'), 'extensions');
const records = () => state.store.data.extensions;
const base = () => state.extBase || process.env.JUNR_EXT_BASE || DEFAULT_BASE;
const bundled = new Map(); // id → { id, name, version, path }

/* ---------- Utilitaires ---------- */
function parseId(input) {
  const m = /[a-p]{32}/.exec(String(input || '').trim());
  if (!m) throw new Error('Identifiant d\'extension invalide (32 lettres a–p, ou adresse du Chrome Web Store)');
  return m[0];
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0), pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_DOWNLOAD) throw new Error('Fichier trop volumineux');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error('Fichier trop volumineux');
  return buf;
}

const downloadUrl = (id) => `${base()}?response=redirect&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=${encodeURIComponent(`id=${id}&uc`)}`;

function localizedName(dir, manifest) {
  const m = /^__MSG_(.+)__$/.exec(manifest.name || '');
  if (!m) return manifest.name || '(sans nom)';
  for (const loc of [manifest.default_locale, 'en', 'en_US']) {
    if (!loc) continue;
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8').replace(/^﻿/, ''));
      const key = Object.keys(msgs).find((k) => k.toLowerCase() === m[1].toLowerCase());
      if (key && msgs[key].message) return msgs[key].message;
    } catch { /* locale absente */ }
  }
  return m[1];
}

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
}

const extPath = (rec) => path.join(root(), rec.id, rec.dir);

/* ---------- Chargement dans les sessions ---------- */
const apiOf = (ses) => ses.extensions ?? ses;

async function loadOne(ses, dir, { installed = false } = {}) {
  if (installed) shim.apply(dir);
  return apiOf(ses).loadExtension(dir, { allowFileAccess: false });
}

// Charge les extensions fournies avec l'application puis les extensions installées et actives.
async function loadInto(ses) {
  const loaded = new Map();
  if (fs.existsSync(BUNDLED_DIR)) {
    for (const entry of fs.readdirSync(BUNDLED_DIR)) {
      const dir = path.join(BUNDLED_DIR, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      try {
        const ext = await loadOne(ses, dir);
        loaded.set(ext.id, ext);
        bundled.set(ext.id, { id: ext.id, name: ext.name, version: ext.version, path: dir });
      } catch (e) { console.error('Extension non chargée', entry, e.message); }
    }
  }
  for (const rec of Object.values(records())) {
    if (!rec.enabled) continue;
    try {
      const ext = await loadOne(ses, extPath(rec), { installed: true });
      loaded.set(ext.id, ext);
      if (rec.loadError) { delete rec.loadError; state.store.save(); }
    } catch (e) {
      rec.loadError = e.message;
      state.store.save();
      console.error('Extension non chargée', rec.id, e.message);
    }
  }
  return loaded;
}

const allSessions = () => [...state.sessions.values()];

async function unloadEverywhere(id) {
  require('./bridge').forget(id);
  for (const s of allSessions()) {
    await s.ready;
    if (s.loaded?.has(id)) { try { apiOf(s.ses).removeExtension(id); } catch { /* déjà retirée */ } s.loaded.delete(id); }
  }
}

async function loadEverywhere(rec) {
  await unloadEverywhere(rec.id);
  require('./bridge').invalidate(rec.id);
  let error = null;
  for (const s of allSessions()) {
    await s.ready;
    try { s.loaded.set(rec.id, await loadOne(s.ses, extPath(rec), { installed: true })); }
    catch (e) { error = e.message; }
  }
  if (error) rec.loadError = error; else delete rec.loadError;
  state.store.save();
}

// Attend que le service worker d'une extension tourne (preuve que l'arrière-plan démarre).
async function backgroundRuns(ses, id, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const running = ses.serviceWorkers.getAllRunning();
      if (Object.values(running).some((w) => String(w.scope || '').startsWith(`chrome-extension://${id}/`))) return true;
    } catch { return null; }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/* ---------- Installation ---------- */
async function installBuffer(buf, { expectedId = null, source = 'webstore' } = {}) {
  const crx = parseCrx(buf);
  if (source === 'webstore' && !crx.publicKey) throw new Error('Ce fichier n\'est pas un CRX signé');
  if (expectedId && crx.id !== expectedId) throw new Error(`L'identifiant du CRX (${crx.id}) ne correspond pas à celui demandé (${expectedId})`);
  const id = crx.id || expectedId;
  if (!id) throw new Error('Identifiant de l\'extension introuvable');

  const tmp = path.join(root(), '.tmp-' + crypto.randomBytes(6).toString('hex'));
  try {
    extractZip(crx.zip, tmp);
    const manifest = readManifest(tmp);
    if (!manifest.version) throw new Error('manifest.json sans version');
    // Electron calcule l'identifiant depuis le chemin sauf si le manifeste porte la clé publique :
    // on la réinjecte pour retrouver l'identifiant du Web Store (certaines extensions en dépendent).
    if (crx.publicKey && !manifest.key) {
      manifest.key = crx.publicKey.toString('base64');
      fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
    const dirName = `${manifest.version}_0`;
    const finalDir = path.join(root(), id, dirName);
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    fs.renameSync(tmp, finalDir);

    const prev = records()[id];
    const rec = {
      id, name: localizedName(finalDir, manifest), version: manifest.version, dir: dirName,
      enabled: prev ? prev.enabled : true, installedAt: prev?.installedAt || Date.now(), updatedAt: Date.now(), source,
    };
    records()[id] = rec;
    state.store.save();
    if (rec.enabled) await loadEverywhere(rec);

    // Anciennes versions : supprimées une fois la nouvelle chargée.
    for (const d of fs.readdirSync(path.join(root(), id))) if (d !== dirName) fs.rmSync(path.join(root(), id, d), { recursive: true, force: true });

    rec.compat = await assess(rec, manifest);
    state.store.save();
    bus.emit('ext:installed', rec.id);
    return { ...describe(rec), manifest: undefined };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Compatibilité = analyse statique du manifeste + contrôle d'exécution (chargement, démarrage de l'arrière-plan).
async function assess(rec, manifest = readManifest(extPath(rec))) {
  const runtime = {};
  if (rec.loadError) runtime.loadError = rec.loadError;
  else if (rec.enabled && manifest.background?.service_worker && !state.test) {
    const first = allSessions()[0];
    if (first) runtime.backgroundFailed = (await backgroundRuns(first.ses, rec.id)) === false;
  }
  return compat.classify(manifest, runtime);
}

async function installFromStore(input) {
  const id = parseId(input);
  return installBuffer(await fetchBuffer(downloadUrl(id)), { expectedId: id, source: 'webstore' });
}

/* ---------- Gestion ---------- */
function iconDataUrl(rec) {
  try {
    const dir = extPath(rec);
    const m = readManifest(dir);
    const icons = m.action?.default_icon || m.browser_action?.default_icon || m.icons;
    let rel = typeof icons === 'string' ? icons : null;
    if (icons && typeof icons === 'object') {
      const sizes = Object.keys(icons).map(Number).filter(Boolean).sort((a, b) => a - b);
      rel = icons[String(sizes.find((s) => s >= 32) ?? sizes[sizes.length - 1])];
    }
    if (!rel) return null;
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir) + path.sep)) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp' }[ext];
    return mime ? `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` : null;
  } catch { return null; }
}

function popupPath(rec) {
  try {
    const m = readManifest(extPath(rec));
    return (m.action || m.browser_action)?.default_popup || null;
  } catch { return null; }
}

function hasAction(rec) {
  try { const m = readManifest(extPath(rec)); return !!(m.action || m.browser_action || m.side_panel); } catch { return false; }
}

function describe(rec) {
  return {
    id: rec.id, name: rec.name, version: rec.version, enabled: rec.enabled, source: rec.source,
    installedAt: rec.installedAt, updatedAt: rec.updatedAt, loadError: rec.loadError || null,
    compat: rec.compat || null, hasPopup: !!popupPath(rec), hasAction: hasAction(rec), icon: iconDataUrl(rec), bundled: false,
  };
}

function list() {
  const out = [...bundled.values()].map((b) => ({
    id: b.id, name: b.name, version: b.version, enabled: true, source: 'bundled', bundled: true, hasPopup: false, icon: null, compat: null, loadError: null,
  }));
  for (const rec of Object.values(records())) out.push(describe(rec));
  return out;
}

async function setEnabled(id, enabled) {
  const rec = records()[id];
  if (!rec) throw new Error('Extension inconnue');
  rec.enabled = !!enabled;
  state.store.save();
  if (enabled) { await loadEverywhere(rec); rec.compat = await assess(rec); state.store.save(); bus.emit('ext:enabled', id); }
  else { await unloadEverywhere(id); bus.emit('ext:disabled', id); }
  return describe(rec);
}

async function uninstall(id) {
  const rec = records()[id];
  if (!rec) throw new Error('Extension inconnue');
  await unloadEverywhere(id);
  delete records()[id];
  state.store.save();
  fs.rmSync(path.join(root(), id), { recursive: true, force: true });
  bus.emit('ext:uninstalled', id);
}

// Relit le XML de mise à jour public et réinstalle les extensions dont une version plus récente existe.
async function checkUpdates() {
  const items = Object.values(records()).filter((r) => r.source === 'webstore');
  if (!items.length) return [];
  const xs = items.map((r) => 'x=' + encodeURIComponent(`id=${r.id}&v=${r.version}&uc`)).join('&');
  const res = await fetch(`${base()}?response=updatecheck&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&${xs}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Vérification des mises à jour impossible (HTTP ${res.status})`);
  const xml = await res.text();
  const updated = [];
  for (const m of xml.matchAll(/<app\b[^>]*\bappid="([a-p]{32})"[^>]*>([\s\S]*?)<\/app>/g)) {
    const rec = records()[m[1]];
    const uc = /<updatecheck\b([^>]*?)\/?>/.exec(m[2]);
    if (!rec || !uc) continue;
    const attr = (n) => new RegExp(`\\b${n}="([^"]*)"`).exec(uc[1])?.[1];
    if (attr('status') !== 'ok' || !attr('codebase') || !attr('version') || cmpVersion(attr('version'), rec.version) <= 0) continue;
    try {
      const buf = await fetchBuffer(attr('codebase').replaceAll('&amp;', '&'));
      const expected = attr('hash_sha256');
      if (expected && crypto.createHash('sha256').update(buf).digest('hex') !== expected.toLowerCase()) throw new Error('empreinte SHA-256 différente');
      const out = await installBuffer(buf, { expectedId: rec.id, source: 'webstore' });
      updated.push({ id: rec.id, from: rec.version, to: out.version });
    } catch (e) {
      console.error('Mise à jour échouée', rec.id, e.message);
      rec.updateError = e.message;
    }
  }
  state.store.data.extensionsCheckedAt = Date.now();
  state.store.save();
  return updated;
}

let timer = null;
function startUpdateTimer(everyMs = 6 * 3600 * 1000) {
  if (timer) return;
  timer = setInterval(() => checkUpdates().catch((e) => console.error('Mises à jour extensions :', e.message)), everyMs);
  timer.unref();
}

module.exports = {
  loadInto, install: installFromStore, installBuffer, list, setEnabled, uninstall, checkUpdates, startUpdateTimer,
  parseId, cmpVersion, popupPath, extPath, records, backgroundRuns, assess, bundledExtensions: () => [...bundled.values()],
};
