'use strict';
// Pont d'API chrome.* : implémente dans le processus principal les API que Chromium/Electron n'expose pas aux
// extensions (windows, cookies, contextMenus, notifications, commands, webNavigation, downloads, identity, history,
// bookmarks…) et les rend visibles aux service workers et aux pages d'extension via le shim (sw-shim.js).
//
//  extension (SW ou page) ── chrome.X.méthode() ──► shim ──► __junr.invoke ──► ce module ──► api-X.js
//  api-X.js ── emit('X.onEvent', args) ──► conn.send ──► shim ──► écouteurs de l'extension
//
// Chaque appel est autorisé d'après le MANIFESTE de l'extension identifiée côté processus principal
// (portée du service worker ou URL de la frame), jamais d'après les arguments de l'appel.
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');
const { state } = require('../../state');
const { matchPattern, isHostPattern } = require('./match');

const PRELOAD = path.join(__dirname, 'preload.js');
const SHIM_SOURCE = path.join(__dirname, '..', 'sw-shim.js');
const API_FILES = ['windows', 'tabs', 'action', 'cookies', 'management', 'contextmenus', 'notifications', 'commands', 'webnavigation', 'downloads',
  'identity', 'history', 'bookmarks', 'sidepanel', 'userscripts', 'capture', 'omnibox', 'fontsettings', 'misc'];
const USERSCRIPTS_PRELOAD = path.join(__dirname, 'userscripts-preload.js');
// API que Junr Browser ne prendra pas en charge : appeler une fonction échoue explicitement (au lieu de ne rien faire).
const UNSUPPORTED = ['pageCapture', 'debugger', 'gcm', 'ttsEngine', 'printerProvider'];

let apis = null;
function load() {
  if (apis) return apis;
  apis = {};
  for (const f of API_FILES) {
    let mods;
    try { mods = require(`./api-${f}`); } catch (e) { if (e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(`api-${f}`)) continue; throw e; }
    for (const m of [].concat(mods)) apis[m.ns] = m;
  }
  return apis;
}

function spec() {
  const ns = {};
  for (const [name, m] of Object.entries(load())) ns[name] = { methods: Object.keys(m.methods || {}), events: m.events || [], constants: m.constants || {}, stubs: m.stubs || [], settings: m.settings || [] };
  return { ns, unsupported: UNSUPPORTED };
}

// Code du shim avec la spécification des API pontées en tête (écrit dans chaque extension installée, injecté dans les pages d'extension).
function shimSource() {
  return `globalThis.__JUNR_SPEC = ${JSON.stringify(spec())};\n` + fs.readFileSync(SHIM_SOURCE, 'utf8');
}

/* ---------- Extensions : manifeste, permissions ---------- */
const manifests = new Map();
function manifestOf(extId) {
  if (manifests.has(extId)) return manifests.get(extId);
  const manager = require('../manager');
  let dir = null;
  const rec = manager.records()[extId];
  if (rec) dir = manager.extPath(rec);
  else dir = manager.bundledExtensions().find((b) => b.id === extId)?.path || null;
  if (!dir) return null;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, '')); } catch { return null; }
  // Le shim remplace background.service_worker par son enveloppe : on restitue l'original pour les API qui le lisent.
  const entry = { manifest, dir, name: rec?.name || manifest.name, version: rec?.version || manifest.version, bundled: !rec };
  manifests.set(extId, entry);
  return entry;
}
function invalidate(extId) { manifests.delete(extId); }

function makeCtx(conn) {
  const m = manifestOf(conn.extId);
  if (!m) throw new Error('Extension inconnue');
  const manifest = m.manifest;
  const all = [...(manifest.permissions || []), ...(manifest.host_permissions || [])];
  const perms = new Set(all.filter((p) => !isHostPattern(p)));
  const hosts = all.filter(isHostPattern);
  return {
    conn, extId: conn.extId, spaceId: conn.spaceId, ses: conn.ses, manifest, dir: m.dir, ext: m,
    has: (p) => perms.has(p),
    hostAllowed: (url) => hosts.some((h) => matchPattern(h, url)),
    hosts,
  };
}

/* ---------- Connexions (service workers et pages d'extension) ---------- */
const conns = new Set();
const known = new Map();   // "espace|ext" → noms d'événements déjà abonnés (pour réveiller un service worker endormi)
const pending = new Map(); // "espace|ext" → événements en attente d'un service worker en cours de démarrage

function describeEvent(name) { const [ns, ...rest] = name.split('.'); return { ns, ev: rest.join('.'), mod: load()[ns] }; }

// Une connexion se ferme (service worker arrêté, page détruite, extension retirée) : les modules libèrent leurs ressources.
function closeConn(conn) {
  conns.delete(conn);
  for (const mod of Object.values(load())) mod.onConnectionClosed?.(conn);
}

function permissionOf(mod, method) {
  return typeof mod.permission === 'function' ? mod.permission(method) : mod.permission;
}

async function handleCall(conn, pathStr, args) {
  if (pathStr === '$subscribe' || pathStr === '$unsubscribe') {
    const name = String(args[0]);
    const { mod, ev } = describeEvent(name);
    if (!mod || !(mod.events || []).includes(ev)) throw new Error(`Événement inconnu : ${name}`);
    const perm = permissionOf(mod, ev);
    if (perm && !makeCtx(conn).has(perm)) throw new Error(`L'extension n'a pas la permission « ${perm} »`);
    if (pathStr === '$subscribe') { conn.subs.add(name); (known.get(conn.key) || known.set(conn.key, new Set()).get(conn.key)).add(name); mod.onSubscribe?.(makeCtx(conn), ev); }
    else conn.subs.delete(name);
    return null;
  }
  if (pathStr === '$whoami') return { kind: conn.kind, extId: conn.extId, spaceId: conn.spaceId }; // diagnostic et tests
  if (pathStr === '$reply') { const w = replies.get(args[0]); if (w) { clearTimeout(w.timer); replies.delete(args[0]); w.resolve(args[1]); } return null; }
  if (pathStr === '$ready') { conn.ready = true; flushPending(conn); lifecycle(conn); return null; }
  const dot = pathStr.indexOf('.');
  const ns = pathStr.slice(0, dot), method = pathStr.slice(dot + 1);
  const mod = load()[ns];
  const fn = mod?.methods?.[method];
  if (!fn) throw new Error(`chrome.${pathStr} n'est pas implémentée dans Junr Browser`);
  const ctx = makeCtx(conn);
  const perm = permissionOf(mod, method);
  if (perm && !ctx.has(perm)) throw new Error(`La permission « ${perm} » est requise pour chrome.${pathStr}`);
  return fn(ctx, ...(Array.isArray(args) ? args : []));
}

const keyOf = (spaceId, extId) => `${spaceId}|${extId}`;

// Cycle de vie façon Chrome, absent d'Electron : runtime.onInstalled (install / update) et runtime.onStartup. Chaque partition a sa propre
// instance de l'extension, donc ses propres événements. Déclenchés au premier « prêt » du service worker, quand ses écouteurs existent.
const startupDone = new Set();
function lifecycle(conn) {
  if (conn.kind !== 'sw') return;
  const m = manifestOf(conn.extId);
  if (!m) return;
  const seen = (state.store.data.extInstalled ||= {});
  const previous = seen[conn.key];
  if (previous !== m.version) {
    seen[conn.key] = m.version;
    state.store.save();
    startupDone.add(conn.key);
    if (conn.subs.has('runtime.onInstalled')) setTimeout(() => deliver(conn, 'runtime.onInstalled', [previous ? { reason: 'update', previousVersion: previous } : { reason: 'install' }]), 100);
  } else if (!startupDone.has(conn.key)) {
    startupDone.add(conn.key);
    if (conn.subs.has('runtime.onStartup')) deliver(conn, 'runtime.onStartup', []);
  }
}

function addConn(c) {
  c.subs = new Set();
  c.key = keyOf(c.spaceId, c.extId);
  conns.add(c);
  return c;
}

/* ---------- Service workers ---------- */
function attachSession(ses, spaceId) {
  ses.registerPreloadScript({ type: 'service-worker', filePath: PRELOAD });
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD });
  ses.registerPreloadScript({ type: 'frame', filePath: USERSCRIPTS_PRELOAD });
  for (const mod of Object.values(load())) mod.onSession?.(ses, spaceId, { emit });
  const byVersion = new Map();
  ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    let worker;
    try { worker = ses.serviceWorkers.getWorkerFromVersionID(versionId); } catch { worker = null; }
    const existing = byVersion.get(versionId);
    if (runningStatus === 'stopping' || runningStatus === 'stopped') {
      if (existing) { closeConn(existing); byVersion.delete(versionId); }
      return;
    }
    if (!worker || existing?.worker === worker) return;
    const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.scope || '');
    if (!m) return;
    if (existing) conns.delete(existing);
    const conn = addConn({ kind: 'sw', extId: m[1], spaceId, ses, worker, send: (msg) => { if (!worker.isDestroyed()) worker.send('junr:event', msg); } });
    byVersion.set(versionId, conn);
    // Le gestionnaire doit exister avant l'exécution du script : on l'enregistre dès l'état « starting ».
    worker.ipc.handle('junr:call', (e, p, a) => handleCall(conn, p, a));
  });
}

/* ---------- Pages d'extension (popup, options, panneau latéral) ---------- */
const spaceOfSession = (ses) => { for (const [id, e] of state.sessions) if (e.ses === ses) return id; return null; };
const pageConns = new Map();

function install() {
  ipcMain.handle('junr:call', (event, p, a) => {
    const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(event.senderFrame?.url || '');
    if (!m) throw new Error('Appel refusé');
    const spaceId = spaceOfSession(event.sender.session);
    if (!spaceId || spaceId === 'internal') throw new Error('Appel refusé');
    const key = `${event.sender.id}:${m[1]}`;
    let conn = pageConns.get(key);
    if (!conn) {
      const wc = event.sender;
      conn = addConn({ kind: 'page', extId: m[1], spaceId, ses: wc.session, wc, send: (msg) => { if (!wc.isDestroyed()) wc.send('junr:event', msg); } });
      pageConns.set(key, conn);
      wc.once('destroyed', () => { closeConn(conn); pageConns.delete(key); });
    }
    return handleCall(conn, p, a);
  });
  ipcMain.on('junr:shim-source', (e) => { e.returnValue = require('./../shim').enabled() ? shimSource() : ''; });
  for (const mod of Object.values(load())) mod.install?.({ emit, emitAll });
}

/* ---------- Événements vers les extensions ---------- */
function deliver(conn, name, args, replyId) { try { conn.send(replyId ? { name, args, replyId } : { name, args }); } catch { /* connexion fermée */ } }

const replies = new Map(); // identifiant de réponse → { resolve, timer }
let replySeq = 0;

// Événement avec réponse (sendResponse) : renvoie la valeur répondue par l'extension, ou undefined (aucun écouteur / délai de 60 s).
function request(name, args, opts = {}) {
  const id = `r${++replySeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { replies.delete(id); resolve(undefined); }, 60000);
    replies.set(id, { resolve, timer });
    emit(name, args, { ...opts, replyId: id });
    // Aucun destinataire connecté ni réveillable : réponse immédiate.
    setTimeout(() => { const w = replies.get(id); if (w && !opts.__sent && !hasTarget(name, opts)) { clearTimeout(w.timer); replies.delete(id); resolve(undefined); } }, 50);
  });
}
function hasTarget(name, { spaceId, extId }) {
  for (const c of conns) if ((spaceId === undefined || c.spaceId === spaceId) && (!extId || c.extId === extId) && c.subs.has(name)) return true;
  for (const [key, names] of known) { const [sp, ex] = key.split('|'); if (names.has(name) && (spaceId === undefined || sp === String(spaceId)) && (!extId || ex === extId)) return true; }
  return false;
}

// Remet à une extension un événement ; si son service worker dort, on le réveille puis on livre à son signal « prêt ».
// `args` : tableau, ou fonction (ctx) => tableau | null (null = ne pas livrer) pour des arguments dépendant des permissions du destinataire.
function emit(name, args, { spaceId, extId, filter, replyId } = {}) {
  const { mod } = describeEvent(name);
  const perm = mod && typeof mod.permission === 'string' ? mod.permission : null;
  const live = new Set();
  for (const conn of [...conns]) {
    if (spaceId !== undefined && conn.spaceId !== spaceId) continue;
    if (extId && conn.extId !== extId) continue;
    if (conn.kind === 'sw') live.add(conn.key);
    if (!conn.subs.has(name)) continue;
    let ctx;
    try { ctx = makeCtx(conn); } catch { continue; }
    if (perm && !ctx.has(perm)) continue;
    if (filter && !filter(ctx)) continue;
    const a = typeof args === 'function' ? args(ctx) : args;
    if (a) deliver(conn, name, a, replyId);
  }
  for (const [key, names] of known) {
    if (!names.has(name) || live.has(key)) continue;
    const [sp, ex] = key.split('|');
    if ((spaceId !== undefined && sp !== String(spaceId)) || (extId && ex !== extId)) continue;
    const entry = state.sessions.get(sp);
    if (!entry) continue;
    let ctx;
    try { ctx = makeCtx({ extId: ex, spaceId: sp, ses: entry.ses }); } catch { continue; }
    if (perm && !ctx.has(perm)) continue;
    if (filter && !filter(ctx)) continue;
    const a = typeof args === 'function' ? args(ctx) : args;
    if (!a) continue;
    const q = pending.get(key) || pending.set(key, []).get(key);
    if (q.length < 50) q.push({ name, args: a, replyId });
    entry.ses.serviceWorkers.startWorkerForScope(`chrome-extension://${ex}/`).catch(() => {});
  }
}
const emitAll = emit;

function flushPending(conn) {
  const q = pending.get(conn.key);
  if (!q?.length) return;
  pending.delete(conn.key);
  // Un court délai : un message envoyé à l'instant même où le service worker se déclare prêt peut être perdu.
  setTimeout(() => { for (const { name, args, replyId } of q) if (conn.subs.has(name)) deliver(conn, name, args, replyId); }, 100);
}

// L'extension est retirée ou désactivée : on oublie ses abonnements et ses éléments (menus, notifications…).
function forget(extId) {
  invalidate(extId);
  for (const k of [...known.keys()]) if (k.endsWith('|' + extId)) known.delete(k);
  for (const k of [...pending.keys()]) if (k.endsWith('|' + extId)) pending.delete(k);
  for (const c of [...conns]) if (c.extId === extId) closeConn(c);
  for (const mod of Object.values(load())) mod.onExtensionRemoved?.(extId);
}

// Extensions dont le service worker (ou une page) est connecté et abonné, pour les tests et le diagnostic.
const connections = () => [...conns].map((c) => ({ kind: c.kind, extId: c.extId, spaceId: c.spaceId, subs: [...c.subs] }));

module.exports = { install, attachSession, emit, request, emitAll, forget, invalidate, shimSource, spec, load, manifestOf, makeCtx, connections, UNSUPPORTED };
