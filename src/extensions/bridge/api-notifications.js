'use strict';
// chrome.notifications : notifications du système (classe Notification d'Electron). Les clics et fermetures sont
// renvoyés à l'extension qui les a créées, en réveillant son service worker au besoin.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Notification, nativeImage, net } = require('electron');

const live = new Map(); // « client|extension|id » → { notification, options }

async function iconOf(ctx, url) {
  if (!url) return undefined;
  try {
    if (url.startsWith('data:')) return nativeImage.createFromDataURL(url);
    let rel = null;
    if (url.startsWith(`chrome-extension://${ctx.extId}/`)) rel = url.slice(`chrome-extension://${ctx.extId}/`.length);
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) rel = url.replace(/^\//, '');
    if (rel !== null) {
      const file = path.resolve(ctx.dir, rel.split('?')[0]);
      if (!file.startsWith(path.resolve(ctx.dir) + path.sep)) return undefined;
      return fs.existsSync(file) ? nativeImage.createFromPath(file) : undefined;
    }
    if (/^https?:/i.test(url)) {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(10000) });
      return res.ok ? nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())) : undefined;
    }
  } catch { /* icône facultative */ }
  return undefined;
}

function bodyOf(o) {
  const lines = [];
  if (o.message) lines.push(o.message);
  if (o.type === 'list' && Array.isArray(o.items)) for (const i of o.items) lines.push(`${i.title} ${i.message}`.trim());
  if (o.type === 'progress' && typeof o.progress === 'number') lines.push(`${o.progress} %`);
  if (o.contextMessage) lines.push(o.contextMessage);
  return lines.join('\n');
}

async function show(ctx, id, o, emit) {
  const key = `${ctx.spaceId}|${ctx.extId}|${id}`;
  live.get(key)?.notification.close();
  const n = new Notification({
    title: String(o.title ?? ''), body: bodyOf(o), icon: await iconOf(ctx, o.iconUrl), silent: !!o.silent,
    actions: (o.buttons || []).slice(0, 2).map((b) => ({ type: 'button', text: String(b.title) })), timeoutType: o.requireInteraction ? 'never' : 'default',
  });
  const send = (name, args) => emit(`notifications.${name}`, args, { spaceId: ctx.spaceId, extId: ctx.extId });
  n.on('click', () => send('onClicked', [id]));
  n.on('action', (e, index) => send('onButtonClicked', [id, index]));
  n.on('close', () => { if (live.get(key)?.notification === n) live.delete(key); send('onClosed', [id, true]); });
  live.set(key, { notification: n, options: o });
  if (Notification.isSupported()) n.show();
}

let emitFn = null;

module.exports = {
  ns: 'notifications',
  permission: 'notifications',
  events: ['onClosed', 'onClicked', 'onButtonClicked', 'onPermissionLevelChanged', 'onShowSettings'],
  methods: {
    // create(notificationId?, options) — l'identifiant est facultatif.
    async create(ctx, a, b) {
      const [given, options] = typeof a === 'object' && a !== null ? [undefined, a] : [a, b];
      if (!options || typeof options !== 'object') throw new Error('Invalid value for argument. Property \'options\': Expected object.');
      if (!['basic', 'image', 'list', 'progress'].includes(options.type)) throw new Error('Property \'type\': Value must be one of: [basic, image, list, progress].');
      if (!options.title) throw new Error('Unchecked runtime.lastError: Some of the required properties are missing: type, iconUrl, title and message.');
      const id = given ? String(given) : crypto.randomUUID();
      await show(ctx, id, options, emitFn);
      return id;
    },
    async update(ctx, id, options = {}) {
      const cur = live.get(`${ctx.spaceId}|${ctx.extId}|${id}`);
      if (!cur) return false;
      await show(ctx, id, { ...cur.options, ...options }, emitFn);
      return true;
    },
    async clear(ctx, id) {
      const key = `${ctx.spaceId}|${ctx.extId}|${id}`;
      const cur = live.get(key);
      if (!cur) return false;
      live.delete(key);
      cur.notification.close();
      return true;
    },
    async getAll(ctx) {
      const out = {};
      for (const k of live.keys()) { const [sp, ex, ...rest] = k.split('|'); if (sp === String(ctx.spaceId) && ex === ctx.extId) out[rest.join('|')] = true; }
      return out;
    },
    async getPermissionLevel() { return 'granted'; },
  },
  install({ emit }) { emitFn = emit; },
  onExtensionRemoved(extId) {
    for (const [k, v] of [...live]) if (k.split('|')[1] === extId) { live.delete(k); try { v.notification.close(); } catch { /* déjà fermée */ } }
  },
  _live: live,
};
