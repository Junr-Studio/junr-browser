'use strict';
// chrome.history + historique de navigation de l'application : un historique PAR CLIENT, enregistré dans userData/history.json
// (désactivable dans Réglages, effaçable, supprimé avec le client). Les extensions n'y voient que l'historique de leur client.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { state, bus } = require('../../state');

const MAX_ITEMS = 10000, MAX_VISITS = 50;
let db = null;       // { [client]: { items: { url: item }, visits: { url: [visite] }, seq: n } }
let timer = null;
let emitFn = null;

const file = () => path.join(app.getPath('userData'), 'history.json');
function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { db = {}; }
  return db;
}
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { fs.writeFileSync(file(), JSON.stringify(db)); } catch { /* disque plein ou protégé */ } }, 1500);
  timer.unref?.();
}
const space = (id) => (load()[id] ||= { items: {}, visits: {}, seq: 1 });
const recording = () => state.store?.data.settings.recordHistory !== false;

function record(spaceId, url, title, transition = 'link') {
  if (!recording() || !/^https?:/i.test(url)) return null;
  const s = space(spaceId);
  const now = Date.now();
  const item = s.items[url] || (s.items[url] = { id: String(s.seq++), url, title: title || '', lastVisitTime: now, visitCount: 0, typedCount: 0 });
  item.visitCount++; item.lastVisitTime = now;
  if (title) item.title = title;
  if (transition === 'typed') item.typedCount++;
  const v = s.visits[url] || (s.visits[url] = []);
  v.push({ id: item.id, visitId: String(s.seq++), visitTime: now, referringVisitId: '0', transition });
  if (v.length > MAX_VISITS) v.splice(0, v.length - MAX_VISITS);
  const urls = Object.keys(s.items);
  if (urls.length > MAX_ITEMS) {
    urls.sort((a, b) => s.items[a].lastVisitTime - s.items[b].lastVisitTime);
    for (const u of urls.slice(0, urls.length - MAX_ITEMS)) { delete s.items[u]; delete s.visits[u]; }
  }
  save();
  emitFn?.('history.onVisited', [item], { spaceId });
  return item;
}

function removeWhere(spaceId, pred) {
  const s = space(spaceId);
  const urls = Object.keys(s.items).filter((u) => pred(s.items[u]));
  for (const u of urls) { delete s.items[u]; delete s.visits[u]; }
  if (urls.length) { save(); emitFn?.('history.onVisitRemoved', [{ allHistory: false, urls }], { spaceId }); }
  return urls;
}

function clearSpace(spaceId) {
  delete load()[spaceId];
  save();
}

module.exports = {
  ns: 'history',
  permission: 'history',
  events: ['onVisited', 'onVisitRemoved'],
  methods: {
    async search(ctx, q = {}) {
      const text = String(q.text || '').toLowerCase();
      const start = q.startTime ?? Date.now() - 7 * 86400000, end = q.endTime ?? Date.now() + 1;
      const out = Object.values(space(ctx.spaceId).items)
        .filter((i) => i.lastVisitTime >= start && i.lastVisitTime < end && (!text || i.url.toLowerCase().includes(text) || (i.title || '').toLowerCase().includes(text)))
        .sort((a, b) => b.lastVisitTime - a.lastVisitTime);
      return out.slice(0, q.maxResults ?? 100);
    },
    async getVisits(ctx, d = {}) { return space(ctx.spaceId).visits[d.url] || []; },
    async addUrl(ctx, d = {}) {
      if (!/^https?:/i.test(String(d.url))) throw new Error('Url invalide');
      record(ctx.spaceId, d.url, '');
    },
    async deleteUrl(ctx, d = {}) { removeWhere(ctx.spaceId, (i) => i.url === d.url); },
    async deleteRange(ctx, r = {}) { removeWhere(ctx.spaceId, (i) => i.lastVisitTime >= r.startTime && i.lastVisitTime < r.endTime); },
    async deleteAll(ctx) { space(ctx.spaceId).items = {}; space(ctx.spaceId).visits = {}; save(); emitFn?.('history.onVisitRemoved', [{ allHistory: true }], { spaceId: ctx.spaceId }); },
  },
  install({ emit }) {
    emitFn = emit;
    bus.on('tab:created', (tab) => {
      if (tab.internal || !tab.view) return;
      const wc = tab.view.webContents;
      wc.on('did-navigate', (e, url) => record(tab.spaceId, url, wc.getTitle()));
      wc.on('page-title-updated', (e, title) => { const i = space(tab.spaceId).items[wc.getURL()]; if (i && title) { i.title = title; save(); } });
    });
  },
  onExtensionRemoved() {},
  record, clearSpace,
  clearAll() { db = {}; save(); },
  deleteRange: (spaceId, start, end) => removeWhere(spaceId, (i) => i.lastVisitTime >= start && i.lastVisitTime < end),
  topSites: (spaceId, n = 20) => Object.values(space(spaceId).items).sort((a, b) => b.visitCount - a.visitCount).slice(0, n),
  stats: () => Object.fromEntries(Object.entries(load()).map(([k, v]) => [k, Object.keys(v.items).length])),
  flush() { clearTimeout(timer); if (db) fs.writeFileSync(file(), JSON.stringify(db)); },
};
