'use strict';
// Fonctions natives qui remplacent les extensions exigeant un état unique : blocage réseau, injection de
// scripts et de CSS, remplissage de mots de passe. Appliquées à toutes les partitions, sans état à synchroniser.
const crypto = require('node:crypto');
const secrets = require('./secrets');
const { state } = require('./state');
const dialog = require('./dialog');

const native = () => state.store.data.native;

/* ---------- Motifs d'URL ---------- */
const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// "ads.example.com" → l'hôte et ses sous-domaines ; sinon motif d'URL avec * (ex. "*://*/tracker.js").
function compilePattern(rule) {
  const r = String(rule).trim();
  if (!r) return null;
  if (!r.includes('://') && !r.includes('/') && !r.includes('*')) {
    return new RegExp(`^[a-z][a-z0-9+.-]*://([^/?#]*\\.)?${escapeRe(r.toLowerCase())}(:\\d+)?([/?#]|$)`, 'i');
  }
  return new RegExp('^' + r.split('*').map(escapeRe).join('.*') + '$', 'i');
}

let blockCache = { key: null, res: [] };
function blockRegexps() {
  const rules = native().blocking.rules;
  const key = rules.join('\n');
  if (blockCache.key !== key) blockCache = { key, res: rules.map(compilePattern).filter(Boolean) };
  return blockCache.res;
}

function shouldBlock(url) {
  const b = native().blocking;
  return b.enabled && blockRegexps().some((re) => re.test(url));
}

/* ---------- Blocage réseau ---------- */
function installBlocking(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    if (shouldBlock(details.url)) { state.blockedCount = (state.blockedCount || 0) + 1; cb({ cancel: true }); }
    else cb({});
  });
}

/* ---------- Injection de scripts et de CSS ---------- */
function attachInjection(wc) {
  wc.on('dom-ready', () => {
    const url = wc.getURL();
    if (!/^https?:/i.test(url)) return;
    for (const rule of native().injection) {
      if (!rule.enabled || !compilePattern(rule.match)?.test(url)) continue;
      if (rule.css) wc.insertCSS(rule.css).catch(() => {});
      if (rule.js) wc.executeJavaScript(rule.js).catch(() => {});
    }
  });
}

/* ---------- Réglages exposés à l'interface ---------- */
async function getConfig() {
  return { blocking: native().blocking, injection: native().injection, blockedCount: state.blockedCount || 0, passwordsAvailable: await secrets.available() };
}

function setBlocking({ enabled, rules }) {
  const b = native().blocking;
  if (typeof enabled === 'boolean') b.enabled = enabled;
  if (Array.isArray(rules)) b.rules = rules.map((r) => String(r).trim()).filter(Boolean);
  state.store.save();
}

function saveInjection(rule) {
  if (!rule.match || !String(rule.match).trim()) throw new Error('Motif d\'URL requis');
  if (!rule.css && !rule.js) throw new Error('CSS ou script requis');
  const list = native().injection;
  const clean = { id: rule.id || crypto.randomUUID(), name: String(rule.name || rule.match).slice(0, 80), match: String(rule.match).trim(), css: String(rule.css || ''), js: String(rule.js || ''), enabled: rule.enabled !== false };
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean; else list.push(clean);
  state.store.save();
  return clean;
}

function deleteInjection(id) {
  native().injection = native().injection.filter((r) => r.id !== id);
  state.store.save();
}

/* ---------- Mots de passe (chiffrés avec le coffre du système) ---------- */
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

function listPasswords() {
  return state.store.data.passwords.map(({ id, origin, username, spaceId }) => ({ id, origin, username, spaceId: spaceId || null }));
}

async function savePassword({ origin, username, password, spaceId = null }) {
  if (!(await secrets.available())) throw new Error('Coffre de chiffrement du système indisponible : mot de passe non enregistré');
  const o = originOf(origin);
  if (!o || !/^https?:/.test(o)) throw new Error('Adresse invalide');
  if (!password) throw new Error('Mot de passe vide');
  const list = state.store.data.passwords;
  const secret = await secrets.encrypt(password);
  const i = list.findIndex((p) => p.origin === o && p.username === username && (p.spaceId || null) === spaceId);
  const entry = { id: i >= 0 ? list[i].id : crypto.randomUUID(), origin: o, username: String(username || ''), spaceId, secret };
  if (i >= 0) list[i] = entry; else list.push(entry);
  state.store.save();
  return entry.id;
}

function deletePassword(id) {
  state.store.data.passwords = state.store.data.passwords.filter((p) => p.id !== id);
  state.store.save();
}

function fillScript(username, password) {
  return `(() => {
    const u = ${JSON.stringify(username)}, p = ${JSON.stringify(password)};
    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const pw = [...document.querySelectorAll('input[type=password]')].find(visible);
    if (!pw) return { ok: false, reason: 'no-password-field' };
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const scope = pw.form || document;
    const fields = [...scope.querySelectorAll('input')].filter((e) => visible(e) && /^(text|email|tel|)$/.test(e.type));
    const user = fields.filter((e) => e.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    if (user && u) set(user, u);
    set(pw, p);
    return { ok: true, username: !!(user && u) };
  })()`;
}

// Remplit la page active. Toujours déclenché par l'utilisateur (raccourci ou bouton), jamais automatiquement.
async function fillActive() {
  const tab = state.tabs.get(state.activeTab);
  if (!tab?.view) return { ok: false, reason: 'no-tab' };
  const wc = tab.view.webContents;
  const origin = originOf(wc.getURL());
  const cands = state.store.data.passwords.filter((p) => p.origin === origin && (!p.spaceId || p.spaceId === tab.spaceId));
  if (!cands.length) return { ok: false, reason: 'no-match' };
  let chosen = cands[0];
  if (cands.length > 1) {
    const id = await dialog.show({
      kind: 'picker', title: `Remplir avec quel compte ? (${origin})`,
      items: cands.map((c) => ({ id: c.id, label: c.username || '(sans identifiant)', hint: c.spaceId ? 'ce client' : 'tous les clients' })),
      buttons: [],
    });
    chosen = cands.find((c) => c.id === id);
    if (!chosen) return { ok: false, reason: 'cancelled' };
  }
  const password = await secrets.decrypt(chosen.secret);
  return wc.executeJavaScript(fillScript(chosen.username, password));
}

module.exports = {
  installBlocking, attachInjection, shouldBlock, compilePattern, getConfig, setBlocking, saveInjection, deleteInjection,
  listPasswords, savePassword, deletePassword, fillActive,
};
