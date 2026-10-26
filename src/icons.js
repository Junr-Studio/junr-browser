'use strict';
// Favicons des onglets et icônes d'extensions, servies à l'interface par le schéma privé « junr-icon:// ».
// L'interface a une CSP stricte (aucune image distante, aucun data:) : le processus principal récupère l'icône avec la session
// de l'onglet (cookies du client compris, comme la page) et la garde en mémoire ; l'interface ne voit qu'une adresse locale.
// Les icônes des outils sont aussi gardées sur disque : au démarrage, la barre montre tout de suite les bonnes icônes.
const fs = require('node:fs');
const path = require('node:path');
const { app, protocol } = require('electron');
const { state } = require('./state');

const SCHEME = 'junr-icon';
const MAX_BYTES = 256 * 1024;
const FETCH_MS = 6000;
const tabIcons = new Map(); // id d'onglet → { type, buf, v }
let counter = 0;

// À appeler avant « ready ».
const register = () => protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function guessType(url, header) {
  if (header && /^image\//.test(header)) return header.split(';')[0];
  if (/\.svg(\?|$)/i.test(url)) return 'image/svg+xml';
  if (/\.ico(\?|$)/i.test(url)) return 'image/x-icon';
  return 'image/png';
}

/* ---------- Copie sur disque des icônes d'outils ---------- */
const diskFile = (toolId) => path.join(app.getPath('userData'), 'favicons', `${String(toolId).replace(/[^A-Za-z0-9-]/g, '')}.json`);

function saveToDisk(toolId, hit) {
  try {
    fs.mkdirSync(path.dirname(diskFile(toolId)), { recursive: true });
    fs.writeFile(diskFile(toolId), JSON.stringify({ type: hit.type, b64: hit.buf.toString('base64') }), () => {});
  } catch { /* disque indisponible : l'icône reste en mémoire */ }
}

function loadFromDisk(tab) {
  if (!tab.toolId || tab.diskTried) return;
  tab.diskTried = true;
  try {
    const j = JSON.parse(fs.readFileSync(diskFile(tab.toolId), 'utf8'));
    const buf = Buffer.from(String(j.b64 || ''), 'base64');
    if (!buf.length || buf.length > MAX_BYTES || !/^image\//.test(String(j.type))) return;
    tabIcons.set(tab.id, { type: j.type, buf, v: ++counter });
    tab.iconV = counter;
  } catch { /* pas encore d'icône enregistrée */ }
}

// Lit le corps de la réponse avec un plafond : un flux sans fin n'est jamais chargé en entier.
async function readCapped(res) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { reader.cancel().catch(() => {}); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Choisit la favicon annoncée par la page (la première http(s) ; Chromium les classe par pertinence) et la met en cache.
async function update(tab, urls) {
  const url = (urls || []).find((u) => /^https?:/i.test(u));
  if (!url || !tab.view || tab.view.webContents.isDestroyed()) return;
  if (tab.iconUrl === url && tabIcons.has(tab.id)) return;
  tab.iconUrl = url;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_MS);
  try {
    const res = await tab.view.webContents.session.fetch(url, { bypassCustomProtocolHandlers: true, signal: ctl.signal });
    if (!res.ok) return;
    const buf = await readCapped(res);
    if (!buf || !buf.length) return;
    if (!state.tabs.has(tab.id)) return; // onglet fermé pendant le téléchargement : rien à garder
    const hit = { type: guessType(url, res.headers.get('content-type')), buf, v: ++counter };
    tabIcons.set(tab.id, hit);
    tab.iconV = counter;
    if (tab.toolId) saveToDisk(tab.toolId, hit);
    require('./tabs').pushSoon();
  } catch { /* hors ligne, bloqué ou trop lent : la lettre de repli reste affichée */ } finally { clearTimeout(timer); }
}

const drop = (tabId) => { tabIcons.delete(tabId); };
function urlOfTab(tab) {
  if (!tabIcons.has(tab.id)) loadFromDisk(tab);
  return tab.iconV && tabIcons.has(tab.id) ? `${SCHEME}://t/${tab.id}?v=${tab.iconV}` : null;
}
const urlOfExt = (ext) => (ext.icon ? `${SCHEME}://x/${ext.id}` : null);

function extIcon(id) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(require('./extensions/manager').list().find((e) => e.id === id)?.icon || '');
  if (!m) return null;
  return { type: m[1], buf: m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])) };
}

function install() {
  protocol.handle(SCHEME, (req) => {
    const u = new URL(req.url);
    const id = u.pathname.slice(1);
    const hit = u.hostname === 't' ? tabIcons.get(Number(id)) : u.hostname === 'x' ? extIcon(id) : null;
    if (!hit) return new Response('', { status: 404 });
    return new Response(hit.buf, { headers: { 'content-type': hit.type, 'cache-control': 'no-store' } });
  });
}

module.exports = { register, install, update, drop, urlOfTab, urlOfExt, _count: () => tabIcons.size };
