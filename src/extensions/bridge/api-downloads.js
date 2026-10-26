'use strict';
// chrome.downloads + gestion des téléchargements de l'application : tout téléchargement est enregistré dans le dossier
// « Téléchargements » du système (sans boîte de dialogue, nom unique) et suivi pour les extensions du même client.
const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');

const items = [];       // tous les téléchargements de la session de l'application
let nextId = 1;
const pending = [];     // demandes de chrome.downloads.download en attente de leur événement « will-download »
let emitFn = null;

const iso = (t) => new Date(t).toISOString();

function uniquePath(dir, name) {
  const safe = path.basename(String(name || 'telechargement')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'telechargement';
  const ext = path.extname(safe), stem = path.basename(safe, ext);
  let p = path.join(dir, safe), n = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${stem} (${n++})${ext}`);
  return p;
}

function toJson(d) {
  const it = d.item;
  const out = {
    id: d.id, url: d.url, finalUrl: d.finalUrl, referrer: d.referrer || '', filename: d.path, incognito: false, danger: 'safe',
    mime: d.mime, startTime: iso(d.startTime), state: d.state, paused: d.paused, canResume: d.canResume, bytesReceived: d.bytesReceived,
    totalBytes: d.totalBytes, fileSize: d.fileSize, exists: !!d.path && fs.existsSync(d.path),
  };
  if (d.endTime) out.endTime = iso(d.endTime);
  if (d.error) out.error = d.error;
  if (d.byExtensionId) out.byExtensionId = d.byExtensionId;
  void it;
  return out;
}

function snapshot(d) {
  const it = d.item;
  d.paused = it.isPaused(); d.canResume = it.canResume(); d.bytesReceived = it.getReceivedBytes();
  d.totalBytes = it.getTotalBytes() || -1; d.fileSize = d.totalBytes;
}

function track(spaceId, item) {
  const pend = pending.findIndex((p) => p.spaceId === spaceId && p.url === item.getURL());
  const req = pend >= 0 ? pending.splice(pend, 1)[0] : null;
  const chain = item.getURLChain();
  const d = {
    id: nextId++, spaceId, item, url: chain[0] || item.getURL(), finalUrl: item.getURL(), mime: item.getMimeType(), startTime: Date.now(), state: 'in_progress',
    paused: false, canResume: false, bytesReceived: 0, totalBytes: item.getTotalBytes() || -1, fileSize: -1, path: '', byExtensionId: req?.extId,
  };
  if (!req || !req.saveAs) {
    d.path = uniquePath(app.getPath('downloads'), req?.filename || item.getFilename());
    item.setSavePath(d.path);
  }
  items.push(d);
  if (items.length > 500) items.splice(0, items.length - 500);
  req?.resolve(d.id);
  emitFn?.('downloads.onCreated', [toJson(d)], { spaceId });

  const changed = (prev) => {
    const now = toJson(d), diff = { id: d.id };
    for (const k of ['url', 'finalUrl', 'filename', 'mime', 'paused', 'canResume', 'state', 'error', 'totalBytes', 'fileSize', 'exists', 'endTime']) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(now[k])) diff[k] = { previous: prev[k], current: now[k] };
    }
    if (Object.keys(diff).length > 1) emitFn?.('downloads.onChanged', [diff], { spaceId });
  };
  let last = toJson(d);
  item.on('updated', (e, state) => {
    snapshot(d);
    if (!d.path) { d.path = item.getSavePath(); }
    if (state === 'interrupted') d.error = 'NETWORK_FAILED';
    changed(last); last = toJson(d);
  });
  item.once('done', (e, state) => {
    snapshot(d);
    d.path = item.getSavePath() || d.path;
    d.endTime = Date.now();
    d.bytesReceived = item.getReceivedBytes(); d.fileSize = d.bytesReceived; d.totalBytes = d.bytesReceived || d.totalBytes;
    d.state = state === 'completed' ? 'complete' : 'interrupted';
    if (state === 'cancelled') d.error = 'USER_CANCELED'; else if (state === 'interrupted') d.error = 'NETWORK_FAILED';
    changed(last); last = toJson(d);
    if (state === 'completed') require('electron').app.emit('junr:download-complete', d);
  });
}

const mine = (ctx) => items.filter((d) => d.spaceId === ctx.spaceId);
const find = (ctx, id) => {
  const d = mine(ctx).find((x) => x.id === id);
  if (!d) throw new Error('Invalid downloadId');
  return d;
};

function matches(d, q) {
  const j = toJson(d);
  if (q.id !== undefined && j.id !== q.id) return false;
  if (q.url !== undefined && j.url !== q.url) return false;
  if (q.urlRegex !== undefined && !new RegExp(q.urlRegex).test(j.url)) return false;
  if (q.filename !== undefined && j.filename !== q.filename) return false;
  if (q.filenameRegex !== undefined && !new RegExp(q.filenameRegex).test(j.filename)) return false;
  if (q.state !== undefined && j.state !== q.state) return false;
  if (q.mime !== undefined && j.mime !== q.mime) return false;
  if (q.paused !== undefined && j.paused !== q.paused) return false;
  if (q.exists !== undefined && j.exists !== q.exists) return false;
  if (q.error !== undefined && j.error !== q.error) return false;
  if (q.startedBefore && !(new Date(j.startTime) < new Date(q.startedBefore))) return false;
  if (q.startedAfter && !(new Date(j.startTime) > new Date(q.startedAfter))) return false;
  if (q.totalBytesGreater !== undefined && !(j.totalBytes > q.totalBytesGreater)) return false;
  if (q.totalBytesLess !== undefined && !(j.totalBytes < q.totalBytesLess)) return false;
  for (const term of q.query || []) {
    const neg = term.startsWith('-'), t = (neg ? term.slice(1) : term).toLowerCase();
    const hit = j.url.toLowerCase().includes(t) || j.filename.toLowerCase().includes(t);
    if (neg ? hit : !hit) return false;
  }
  return true;
}

module.exports = {
  ns: 'downloads',
  permission: (m) => (m === 'open' ? 'downloads.open' : 'downloads'),
  events: ['onCreated', 'onErased', 'onChanged', 'onDeterminingFilename'],
  methods: {
    async download(ctx, o = {}) {
      let u;
      try { u = new URL(o.url); } catch { throw new Error('Invalid URL'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Invalid URL');
      const filename = o.filename && !path.isAbsolute(o.filename) && !String(o.filename).split(/[\\/]/).includes('..') ? o.filename : undefined;
      if (o.filename && !filename) throw new Error('Invalid filename');
      return new Promise((resolve, reject) => {
        const req = { spaceId: ctx.spaceId, extId: ctx.extId, url: u.href, filename, saveAs: !!o.saveAs, resolve };
        pending.push(req);
        setTimeout(() => { const i = pending.indexOf(req); if (i >= 0) { pending.splice(i, 1); reject(new Error('Download did not start')); } }, 15000);
        ctx.ses.downloadURL(u.href, o.headers ? { headers: Object.fromEntries(o.headers.map((h) => [h.name, h.value])) } : undefined);
      });
    },
    async search(ctx, q = {}) {
      let list = mine(ctx).filter((d) => matches(d, q));
      for (const key of q.orderBy || []) {
        const desc = key.startsWith('-'), f = desc ? key.slice(1) : key;
        list.sort((a, b) => { const x = toJson(a)[f], y = toJson(b)[f]; return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
      }
      list = list.slice(0, q.limit === 0 ? 0 : q.limit || 1000);
      return list.map(toJson);
    },
    async pause(ctx, id) { const d = find(ctx, id); if (d.state !== 'in_progress') throw new Error('Download must be in progress'); d.item.pause(); snapshot(d); },
    async resume(ctx, id) { const d = find(ctx, id); if (d.item.canResume()) d.item.resume(); else throw new Error('Download must be paused'); snapshot(d); },
    async cancel(ctx, id) { const d = find(ctx, id); if (d.state === 'in_progress') d.item.cancel(); },
    async erase(ctx, q = {}) {
      const gone = mine(ctx).filter((d) => matches(d, q));
      for (const d of gone) { items.splice(items.indexOf(d), 1); emitFn?.('downloads.onErased', [d.id], { spaceId: ctx.spaceId }); }
      return gone.map((d) => d.id);
    },
    async removeFile(ctx, id) { const d = find(ctx, id); if (d.path) await fs.promises.rm(d.path, { force: true }); },
    async show(ctx, id) { const d = find(ctx, id); if (d.path) shell.showItemInFolder(d.path); },
    async showDefaultFolder() { shell.openPath(app.getPath('downloads')); },
    async open(ctx, id) { const d = find(ctx, id); if (d.state !== 'complete') throw new Error('Download must be complete'); await shell.openPath(d.path); },
    async acceptDanger() {},
    async setShelfEnabled() {},
    async setUiOptions() {},
    async getFileIcon(ctx, id) { const d = find(ctx, id); return (await app.getFileIcon(d.path, { size: 'normal' })).toDataURL(); },
  },
  onSession(ses, spaceId, { emit }) {
    emitFn = emit;
    ses.on('will-download', (e, item) => track(spaceId, item));
  },
  // Liste complète pour la page Réglages (tous clients).
  list: () => items.map((d) => ({ ...toJson(d), spaceId: d.spaceId })).reverse(),
  open: async (id) => { const d = items.find((x) => x.id === id); if (d?.path) return shell.openPath(d.path); return 'introuvable'; },
  show: (id) => { const d = items.find((x) => x.id === id); if (d?.path) shell.showItemInFolder(d.path); },
  _items: items,
};
