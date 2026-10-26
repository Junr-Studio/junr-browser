'use strict';
// Signaux d'attention calmes : pour chaque outil, ce qui a bougé depuis le dernier passage, sans changer de client.
// Sources locales uniquement : compteur lu dans le titre de la page, son en cours, redirection vers une page de connexion.
// Honnêteté : un outil jamais ouvert ou endormi ne peut rien signaler ; on le dit (« jamais ouvert », « il y a 12 min »).
const { app } = require('electron');
const { state } = require('./state');
const { isLoginRedirect } = require('./loginpath');

const ACK_AFTER_MS = 2000;
const LOGIN_RECENT_MS = 7 * 24 * 3600 * 1000;

/* ---------- Lecture du titre ---------- */
// « (3) Boîte de réception » → 3 ; « [12] Tickets » → 12 ; « Inbox (7) - Gmail » → 7 ; « • Slack » → marqueur sans nombre.
function parseTitle(title) {
  const t = String(title || '');
  let m = /^\s*[(\[](\d{1,3})\+?[)\]]/.exec(t);
  if (m) return { n: Number(m[1]), flag: false };
  m = /^[^()[\]]{1,40}\((\d{1,3})\+?\)(\s[-–—|]|\s*$)/.exec(t);
  if (m) return { n: Number(m[1]), flag: false };
  if (/^\s*[•*●]\s/.test(t)) return { n: null, flag: true };
  return { n: null, flag: false };
}

const countOf = (tab) => (tab.n ?? (tab.flag ? 1 : 0));

/* ---------- Observation d'un onglet ---------- */
// Appelée à chaque changement de titre et au dom-ready. La première observation fixe la base : jamais d'alerte au démarrage.
function observe(tab) {
  if (!tab || tab.internal) return;
  const { n, flag } = parseTitle(tab.title);
  tab.n = n; tab.flag = flag;
  tab.observedAt = Date.now();
  const now = countOf(tab);
  if (tab.seen === undefined) { tab.seen = now; return; }
  if (now > tab.seen) { if (!tab.signalAt) tab.signalAt = Date.now(); }
  else { tab.seen = now; tab.signalAt = null; } // le compteur a baissé ou est revenu à sa base : plus rien à signaler
}

// Acquittement : l'onglet est resté affiché assez longtemps pour avoir été vu.
function ack(tab) {
  if (!tab) return;
  tab.seen = countOf(tab);
  tab.signalAt = null;
}

// Navigation d'un onglet : une redirection vers /login alors que l'outil n'est pas une page de connexion = connexion demandée.
function noteNavigation(tab, url) {
  const tool = toolOf(tab);
  tab.auth = tool && isLoginRedirect(url, tool.url.replaceAll('{diag}', state.diagUrl || 'http://x/')) ? 'login' : null;
}

// Famille d'un outil (Alt+↑/↓) : son nom normalisé, sauf si l'utilisateur en a choisi une dans les Réglages.
const normFamily = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const familyOf = (tool) => normFamily(tool.family) || normFamily(tool.name);

function toolOf(tab) {
  if (!tab?.toolId) return null;
  const d = state.store.data;
  const owner = tab.spaceId === 'global' ? { tools: d.globalTools } : d.clients.find((c) => c.id === tab.spaceId);
  return owner?.tools.find((t) => t.id === tab.toolId) || null;
}

/* ---------- Mémoire par outil (mise en cache 3 s : snapshot() est appelé très souvent) ---------- */
let metricsCache = { at: 0, byPid: new Map() };
function metricsByPid() {
  if (Date.now() - metricsCache.at < 3000) return metricsCache.byPid;
  const byPid = new Map();
  for (const m of app.getAppMetrics()) byPid.set(m.pid, Math.round((m.memory?.workingSetSize || 0) / 1024));
  metricsCache = { at: Date.now(), byPid };
  return byPid;
}
function memOf(tab) {
  if (!tab.view || tab.view.webContents.isDestroyed()) return null;
  try { return metricsByPid().get(tab.view.webContents.getOSProcessId()) ?? null; } catch { return null; }
}

/* ---------- Lignes d'outils ---------- */
function stateOf(tab) {
  if (!tab || !tab.loadedOnce) return 'never';
  return tab.view ? 'live' : 'sleep';
}

// Une ligne par outil déclaré d'un client (ou des communs), dans l'ordre des Réglages.
function rows(spaceId) {
  const d = state.store.data;
  const tools = spaceId === 'global' ? d.globalTools : d.clients.find((c) => c.id === spaceId)?.tools || [];
  return tools.map((tool) => {
    const tab = [...state.tabs.values()].find((t) => t.toolId === tool.id && t.spaceId === spaceId) || null;
    const st = stateOf(tab);
    const audible = !!(tab?.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.isCurrentlyAudible());
    const cnt = tab ? countOf(tab) : 0;
    return {
      toolId: tool.id, tabId: tab?.id ?? null, name: tool.name, family: familyOf(tool), state: st,
      n: tab?.n ?? null, flag: !!tab?.flag, delta: tab && tab.seen !== undefined ? Math.max(0, cnt - tab.seen) : 0, signalAt: tab?.signalAt || null,
      audible, draft: !!tab?.draft, auth: tab?.auth || null, keepAwake: !!tool.keepAwake,
      memMb: tab ? memOf(tab) : null, lastActive: tab?.lastActive || null, observedAt: tab?.observedAt || null,
    };
  });
}

// Tous les outils qui attendent quelque chose, par ordre de priorité : son, connexion demandée récemment, plus ancien changement.
function queue(excludeTabId = state.activeTab) {
  const out = [];
  const spaces = [...state.store.data.clients.map((c) => ({ id: c.id, name: c.name })), { id: 'global', name: 'Commun' }];
  for (const sp of spaces) {
    for (const r of rows(sp.id)) {
      if (r.tabId === null || r.tabId === excludeTabId) continue;
      const label = `${sp.name} · ${r.name}`;
      if (r.audible) out.push({ kind: 'audio', rank: 0, at: 0, spaceId: sp.id, toolId: r.toolId, tabId: r.tabId, label });
      else if (r.auth === 'login' && r.lastActive && Date.now() - r.lastActive < LOGIN_RECENT_MS) out.push({ kind: 'login', rank: 1, at: r.lastActive, spaceId: sp.id, toolId: r.toolId, tabId: r.tabId, label });
      else if (r.delta > 0 && r.signalAt) out.push({ kind: 'mark', rank: 2, at: r.signalAt, spaceId: sp.id, toolId: r.toolId, tabId: r.tabId, label });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.at - b.at);
}

// Combien d'outils sont lus par le moteur (éveillés ou endormis avec un compteur déjà observé), sur l'ensemble des outils.
function coverage() {
  const d = state.store.data;
  const all = [...d.clients.flatMap((c) => rows(c.id)), ...rows('global')];
  return { watched: all.filter((r) => r.state === 'live' || (r.state === 'sleep' && r.observedAt)).length, total: all.length };
}

module.exports = { parseTitle, observe, ack, noteNavigation, rows, queue, coverage, toolOf, familyOf, countOf, ACK_AFTER_MS };
