'use strict';
// chrome.userScripts : scripts enregistrés par une extension (Tampermonkey, uBlock Origin Lite…), injectés dans les pages
// de son client avant les scripts de la page (document_start) ou plus tard (document_end / document_idle), dans le monde
// principal (MAIN) ou dans un monde isolé « USER_SCRIPT » doté de chrome.runtime.sendMessage vers l'extension si la messagerie est activée.
// L'injection est faite par userscripts-preload.js, exécuté dans chaque frame des pages web du client.
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const { state } = require('../../state');
const { matchPattern } = require('./match');
const model = require('./model');

const registry = new Map();  // « client|extension » → Map(id → script)
const worlds = new Map();    // « client|extension » → Map(worldId ou '' → { csp, messaging })
let loaded = false;
let timer = null;

const file = () => path.join(app.getPath('userData'), 'userscripts.json');
const key = (spaceId, extId) => `${spaceId}|${extId}`;
const scriptsOf = (k) => registry.get(k) || registry.set(k, new Map()).get(k);

function restore() {
  if (loaded) return;
  loaded = true;
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    for (const [k, list] of Object.entries(d.scripts || {})) registry.set(k, new Map(list.map((s) => [s.id, s])));
    for (const [k, list] of Object.entries(d.worlds || {})) worlds.set(k, new Map(list));
  } catch { /* premier lancement */ }
}
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.writeFileSync(file(), JSON.stringify({
        scripts: Object.fromEntries([...registry].map(([k, m]) => [k, [...m.values()]])),
        worlds: Object.fromEntries([...worlds].map(([k, m]) => [k, [...m]])),
      }));
    } catch { /* disque protégé */ }
  }, 1000);
  timer.unref?.();
}

const RUN_AT = ['document_start', 'document_end', 'document_idle'];

function readSource(ctx, entry) {
  if (typeof entry.code === 'string') return entry.code;
  if (typeof entry.file === 'string') {
    const f = path.resolve(ctx.dir, entry.file.replace(/^\//, ''));
    if (!f.startsWith(path.resolve(ctx.dir) + path.sep)) throw new Error(`Could not load file: '${entry.file}'.`);
    try { return fs.readFileSync(f, 'utf8'); } catch { throw new Error(`Could not load file: '${entry.file}'.`); }
  }
  throw new Error('Each js entry must specify exactly one of code or file.');
}

function build(ctx, s, previous = {}) {
  const o = { ...previous };
  if (s.id !== undefined) o.id = String(s.id);
  if (!o.id || o.id.startsWith('_')) throw new Error(`Invalid script ID '${o.id}'.`);
  if (s.matches !== undefined) o.matches = [].concat(s.matches);
  if (!o.matches?.length) throw new Error('Scripts must specify at least one match pattern.');
  for (const m of o.matches) if (!/^(\*|https?|ftp|file):\/\//.test(m) && m !== '<all_urls>') throw new Error(`Invalid match pattern '${m}'.`);
  if (s.excludeMatches !== undefined) o.excludeMatches = [].concat(s.excludeMatches);
  if (s.js !== undefined) { o.js = s.js; o.sources = [].concat(s.js).map((e) => readSource(ctx, e)); }
  if (!o.js?.length) throw new Error('Scripts must specify at least one js source.');
  if (s.allFrames !== undefined) o.allFrames = !!s.allFrames;
  if (s.runAt !== undefined) { if (!RUN_AT.includes(s.runAt)) throw new Error(`Invalid runAt '${s.runAt}'.`); o.runAt = s.runAt; }
  if (s.world !== undefined) { if (!['MAIN', 'USER_SCRIPT'].includes(s.world)) throw new Error(`Invalid world '${s.world}'.`); o.world = s.world; }
  if (s.worldId !== undefined) o.worldId = String(s.worldId);
  o.runAt ||= 'document_idle';
  o.world ||= 'USER_SCRIPT';
  o.allFrames = !!o.allFrames;
  return o;
}

const toApi = (s) => { const { sources, ...rest } = s; void sources; return JSON.parse(JSON.stringify(rest)); };

// Scripts à injecter dans une frame (tous les clients ne partagent rien : on ne regarde que la session de la frame).
function scriptsFor(spaceId, url, isTop) {
  const out = [];
  for (const [k, scripts] of registry) {
    const [sp, extId] = k.split('|');
    if (sp !== String(spaceId)) continue;
    for (const s of scripts.values()) {
      if (!isTop && !s.allFrames) continue;
      if (!s.matches.some((m) => matchPattern(m, url))) continue;
      if ((s.excludeMatches || []).some((m) => matchPattern(m, url))) continue;
      const cfg = worlds.get(k)?.get(s.worldId || '') || worlds.get(k)?.get('') || {};
      out.push({ extId, id: s.id, world: s.world, worldId: s.worldId || '', runAt: s.runAt, sources: s.sources, messaging: !!cfg.messaging });
    }
  }
  return out;
}

module.exports = {
  ns: 'userScripts',
  permission: 'userScripts',
  events: [],
  methods: {
    async register(ctx, list) {
      restore();
      const scripts = scriptsOf(key(ctx.spaceId, ctx.extId));
      const built = [].concat(list).map((s) => build(ctx, s));
      for (const b of built) if (scripts.has(b.id)) throw new Error(`Duplicate script ID '${b.id}'`);
      for (const b of built) scripts.set(b.id, b);
      persist();
    },
    async update(ctx, list) {
      restore();
      const scripts = scriptsOf(key(ctx.spaceId, ctx.extId));
      const built = [].concat(list).map((s) => { const cur = scripts.get(String(s.id)); if (!cur) throw new Error(`Script with ID '${s.id}' does not exist.`); return build(ctx, s, cur); });
      for (const b of built) scripts.set(b.id, b);
      persist();
    },
    async unregister(ctx, filter = {}) {
      restore();
      const scripts = scriptsOf(key(ctx.spaceId, ctx.extId));
      if (!filter.ids) scripts.clear();
      else for (const id of filter.ids) { if (!scripts.has(String(id))) throw new Error(`Nonexistent script ID '${id}'`); scripts.delete(String(id)); }
      persist();
    },
    async getScripts(ctx, filter = {}) {
      restore();
      return [...scriptsOf(key(ctx.spaceId, ctx.extId)).values()].filter((s) => !filter.ids || filter.ids.includes(s.id)).map(toApi);
    },
    async configureWorld(ctx, props = {}) {
      restore();
      const w = worlds.get(key(ctx.spaceId, ctx.extId)) || worlds.set(key(ctx.spaceId, ctx.extId), new Map()).get(key(ctx.spaceId, ctx.extId));
      w.set(props.worldId === undefined ? '' : String(props.worldId), { csp: props.csp, messaging: !!props.messaging });
      persist();
    },
    async getWorldConfigurations(ctx) {
      restore();
      return [...(worlds.get(key(ctx.spaceId, ctx.extId)) || [])].map(([id, c]) => ({ ...(id ? { worldId: id } : {}), csp: c.csp, messaging: !!c.messaging }));
    },
    async resetWorldConfiguration(ctx, worldId) {
      restore();
      worlds.get(key(ctx.spaceId, ctx.extId))?.delete(worldId === undefined ? '' : String(worldId));
      persist();
    },
  },
  install() {
    restore();
    // Frames des pages web : quels scripts injecter ? (réponse synchrone, avant l'exécution des scripts de la page)
    ipcMain.on('junr:userscripts', (event, url, isTop) => {
      const spaceId = [...state.sessions].find(([, e]) => e.ses === event.sender.session)?.[0];
      event.returnValue = spaceId && spaceId !== 'internal' ? scriptsFor(spaceId, String(url), !!isTop) : [];
    });
    // Message d'un script du monde USER_SCRIPT vers son extension (chrome.runtime.sendMessage dans ce monde).
    ipcMain.handle('junr:usermsg', async (event, extId, scriptId, message) => {
      const spaceId = [...state.sessions].find(([, e]) => e.ses === event.sender.session)?.[0];
      const url = event.senderFrame?.url || '';
      const k = key(spaceId, extId);
      const s = registry.get(k)?.get(String(scriptId));
      if (!spaceId || !s || !s.matches.some((m) => matchPattern(m, url)) || !(worlds.get(k)?.get(s.worldId || '') || worlds.get(k)?.get(''))?.messaging) throw new Error('Messagerie non autorisée pour ce script');
      const tab = model.tabByWcId(event.sender.id);
      const bridge = require('./index');
      return bridge.request('runtime.onUserScriptMessage', (ctx) => [message, { id: extId, url, origin: (() => { try { return new URL(url).origin; } catch { return ''; } })(), frameId: event.senderFrame === event.sender.mainFrame ? 0 : event.senderFrame?.frameTreeNodeId ?? 0, tab: tab ? model.tabInfo(ctx, tab) : undefined }], { spaceId, extId });
    });
  },
  onExtensionRemoved(extId) {
    for (const k of [...registry.keys()]) if (k.endsWith('|' + extId)) registry.delete(k);
    for (const k of [...worlds.keys()]) if (k.endsWith('|' + extId)) worlds.delete(k);
    persist();
  },
  flush() { clearTimeout(timer); fs.writeFileSync(file(), JSON.stringify({ scripts: Object.fromEntries([...registry].map(([k, m]) => [k, [...m.values()]])), worlds: Object.fromEntries([...worlds].map(([k, m]) => [k, [...m]])) })); },
  _registry: registry, scriptsFor,
};
