'use strict';
// Onglets, vues web, changement d'espace, mise en veille, état envoyé à l'interface, raccourcis.
const path = require('node:path');
const { app, WebContentsView } = require('electron');
const { state, bus, SIDEBAR_W, TOPBAR_H, HOME_URL, SEARCH_URL } = require('./state');
const { getSession } = require('./sessions');
const native = require('./native');
const dialog = require('./dialog');
const extManager = require('./extensions/manager');
const popup = require('./extensions/popup');
const identity = require('./identity');
const signals = require('./signals');
const drafts = require('./drafts');
const carnet = require('./carnet');
const groups = require('./groups');
const icons = require('./icons');

const SHELL_DIR = path.join(__dirname, '..', 'shell');
const INTERNAL_PAGES = {
  settings: { file: path.join(SHELL_DIR, 'settings.html'), title: 'Réglages' },
};

const cfg = () => state.store.data;
const tabsOfSpace = (spaceId) => [...state.tabs.values()].filter((t) => t.spaceId === spaceId);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www./, ''); } catch { return ''; } };
const resolveUrl = (url) => String(url).replaceAll('{diag}', state.diagUrl || 'about:blank');

/* ---------- Géométrie : la page prend toute la largeur et toute la hauteur sous la barre (mêmes proportions que Chrome) ---------- */
function layout() {
  if (!state.win) return;
  const { width, height } = state.win.getContentBounds();
  const side = require('./extensions/bridge/api-sidepanel').width();
  state.shell.setBounds({ x: 0, y: 0, width, height });
  for (const t of state.tabs.values()) {
    // Même rectangle pour tous les clients (sensibles compris) : l'identité vit dans la barre, jamais autour de la page.
    if (t.view) t.view.setBounds({ x: SIDEBAR_W, y: TOPBAR_H, width: Math.max(0, width - SIDEBAR_W - side), height: Math.max(0, height - TOPBAR_H) });
  }
  popup.reposition();
  require('./extensions/bridge/api-sidepanel').reposition();
  require('./flyout').reposition();
}

function addTab({ spaceId, url, title, toolId = null, internal = null, groupId }) {
  const tab = { id: state.nextId++, spaceId, url: resolveUrl(url), title: title || url, toolId, internal, view: null, lastActive: Date.now(), scrollY: 0, loadedOnce: false };
  // Un onglet libre naît dans le groupe affiché (les outils, eux, portent leur groupe dans la configuration).
  // (un lien ouvert depuis un onglet reste dans le groupe de cet onglet)
  if (!toolId && !internal && spaceId !== 'global') tab.groupId = groupId !== undefined ? groupId : groups.defaultFor(spaceId);
  state.tabs.set(tab.id, tab);
  return tab;
}

async function loadTab(tab) {
  const { ses, ready } = getSession(tab.internal ? 'internal' : tab.spaceId);
  await ready;
  // nodeIntegrationInSubFrames : sans effet sur l'accès à Node (sandbox + contextIsolation), il fait seulement exécuter les
  // préchargements dans les cadres imbriqués, nécessaire aux scripts utilisateur « allFrames » des extensions.
  const webPreferences = { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, ...(tab.internal ? {} : { nodeIntegrationInSubFrames: true }) };
  if (tab.internal) webPreferences.preload = path.join(SHELL_DIR, 'settings-preload.js');
  const view = new WebContentsView({ webPreferences });
  const wc = view.webContents;
  tab.view = view;
  tab.loadedOnce = true;

  if (tab.internal) {
    state.internalViews.add(wc.id);
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  } else {
    let restored = false;
    wc.on('page-title-updated', (e, title) => { tab.title = title; signals.observe(tab); pushSoon(); });
    wc.on('page-favicon-updated', (e, urls) => icons.update(tab, urls));
    wc.on('did-navigate', (e, url) => { tab.url = url; signals.noteNavigation(tab, url); pushSoon(); });
    wc.on('did-navigate-in-page', (e, url) => { tab.url = url; pushSoon(); });
    wc.on('audio-state-changed', () => pushSoon());
    wc.on('dom-ready', () => { signals.observe(tab); if (cfg().settings.protectDrafts !== false) drafts.install(wc); });
    wc.on('did-finish-load', () => {
      if (!restored && tab.scrollY > 0) wc.executeJavaScript(`window.scrollTo(0, ${tab.scrollY})`).catch(() => {});
      restored = true;
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        const opened = addTab({ spaceId: tab.spaceId, url, groupId: groups.groupOf(tab) });
        activateTab(opened.id).then(() => bus.emit('tab:opened', tab, opened, url));
      }
      return { action: 'deny' };
    });
    native.attachInjection(wc);
    wc.on('context-menu', (e, params) => require('./contextmenu').show(tab, wc, params));
  }
  wc.on('before-input-event', handleInput);
  view.setVisible(false);
  state.win.contentView.addChildView(view);
  require('./flyout').raise();
  dialog.raise(); // la vue ajoutée est au-dessus de tout : si un dialogue est ouvert, on le remet devant
  layout();
  bus.emit('tab:created', tab); // avant le premier chargement : le pont d'extensions s'attache à la vue
  wc.loadURL(tab.url).catch(() => {});
}

/* ---------- Passages entre clients : liste des derniers clients, notice calme ---------- */
// Toujours appelée AVANT l'écriture de state.activeSpace. « global » (outils communs) n'est jamais un lieu de passage.
function noteSpaceChange(to) {
  if (!to || to === 'global' || to === state.activeSpace) return;
  const from = state.activeSpace;
  state.resume = null;
  state.resumeFor = { spaceId: to, absentMs: state.leftAt[to] ? Date.now() - state.leftAt[to] : 0 };
  if (from) state.leftAt[from] = Date.now();
  state.mru = [to, ...state.mru.filter((id) => id !== to && cfg().clients.some((c) => c.id === id))];
  bus.emit('space:changed', to, from);
}

function notify(text, ms = 4000) {
  state.notice = { text, until: Date.now() + ms };
  pushNow();
  setTimeout(pushNow, ms + 60).unref?.();
}

// Carte « Depuis votre départ » : ce qui a bougé chez ce client pendant son absence. Calculée une fois à l'arrivée, sans contenu.
function settleResume() {
  const p = state.resumeFor;
  state.resumeFor = null;
  if (!p || p.spaceId !== state.activeSpace) return;
  if (p.absentMs < (cfg().settings.resumeAfterMs ?? 600000)) { state.resume = null; return; }
  const rows = signals.rows(p.spaceId);
  const items = [];
  for (const r of rows) {
    if (r.tabId === null) continue;
    const kind = r.auth === 'login' ? 'login' : r.audible ? 'audio' : r.delta > 0 ? 'mark' : null;
    if (kind) items.push({ toolId: r.toolId, tabId: r.tabId, name: r.name, kind, n: r.delta || null, shown: r.tabId === state.activeTab });
  }
  const sleeping = rows.filter((r) => r.state === 'sleep').length;
  state.resume = items.length || sleeping ? { spaceId: p.spaceId, absentMs: p.absentMs, expires: Date.now() + 20000, items, sleeping } : null;
  if (state.resume) setTimeout(pushNow, 20100).unref?.();
  // Au retour chez un client après une absence : le volet des clients s'ouvre seul (carte « Absent depuis… »), puis se referme.
  if (state.resume && !state.test) require('./flyout').open('clients', { x: 8, right: 42 }, { auto: 9000 }).catch(() => {});
}

// Clic sur une puce de la carte : on va à l'outil, la puce disparaît.
async function resumeOpen(tabId) {
  if (state.resume) state.resume.items = state.resume.items.filter((i) => i.tabId !== tabId);
  if (state.resume && !state.resume.items.length && !state.resume.sleeping) state.resume = null;
  await activateTab(tabId);
}

let ackTimer = null;
// Acquittement d'un signal : l'onglet doit être resté affiché 2 s, fenêtre au premier plan (traverser un client ne vide rien).
function armAck(tab) {
  clearTimeout(ackTimer);
  if (!tab || tab.internal) return;
  ackTimer = setTimeout(() => {
    if (state.activeTab === tab.id && tab.view && state.win && state.win.isFocused()) { signals.ack(tab); pushSoon(); }
  }, signals.ACK_AFTER_MS);
  ackTimer.unref?.();
}
bus.on('window:focus', () => armAck(state.tabs.get(state.activeTab)));

async function activateTab(id) {
  const tab = state.tabs.get(id);
  if (!tab) return;
  popup.close();
  if (!tab.view) await loadTab(tab);
  for (const t of state.tabs.values()) if (t.view) t.view.setVisible(false);
  tab.view.setVisible(true);
  tab.lastActive = Date.now();
  const previous = state.activeTab;
  state.activeTab = id;
  if (tab.spaceId !== 'global') {
    noteSpaceChange(tab.spaceId);
    state.activeSpace = tab.spaceId;
    state.lastTabBySpace[tab.spaceId] = id;
    // Aller à un onglet hors du groupe affiché (Ctrl+K, Alt+J…) : la barre du haut suit l'onglet.
    if (!groups.inView(tab)) { const g = groups.groupOf(tab); groups.setActive(tab.spaceId, g); }
  }
  layout();
  tab.view.webContents.focus();
  if (tab.toolId && tab.spaceId !== 'global') noteUsage(tab);
  settleResume();
  pushNow();
  armAck(tab);
  if (previous !== id) bus.emit('tab:activated', tab, state.tabs.get(previous) || null);
}

async function switchSpace(spaceId) {
  popup.close();
  const list = tabsOfSpace(spaceId);
  // On rouvre la vue du client telle qu'on l'a quittée ; une vue vide ne survit pas au départ.
  let view = list.filter(groups.inView);
  if (!view.length && list.length) { groups.setActive(spaceId, null); view = list; }
  const last = state.lastTabBySpace[spaceId];
  const target = last && view.some((t) => t.id === last) ? last : [...view].sort((a, b) => b.lastActive - a.lastActive)[0]?.id;
  noteSpaceChange(spaceId);
  state.activeSpace = spaceId;
  if (target) await activateTab(target);
  else { hideAll(); state.activeTab = null; layout(); settleResume(); pushNow(); }
}

// Choisit ce que la barre du haut montre d'un client : un groupe, « sans groupe » (groups.NONE) ou tout (null).
// L'onglet affiché est conservé s'il est dans la vue, sinon le dernier utilisé de la vue ; une vue vide ne montre aucune page.
async function selectGroup(spaceId, groupId) {
  if (!identity.clientOf(spaceId)) return;
  groups.setActive(spaceId, groupId || null);
  const inView = tabsOfSpace(spaceId).filter(groups.inView);
  const current = state.tabs.get(state.activeTab);
  if (state.activeSpace === spaceId && current && inView.includes(current)) { pushNow(); return; }
  const target = [...inView].sort((a, b) => b.lastActive - a.lastActive)[0];
  if (target) { await activateTab(target.id); return; }
  popup.close();
  if (state.activeSpace !== spaceId) noteSpaceChange(spaceId);
  state.activeSpace = spaceId;
  hideAll();
  state.activeTab = null;
  layout();
  settleResume();
  pushNow();
}

// Apprentissage de Ctrl+K : n pondéré par l'âge (demi-vie 14 jours), écrit avec temporisation.
function noteUsage(tab) {
  const d = cfg();
  d.usage ||= {};
  const k = `${tab.spaceId}:${tab.toolId}`;
  const u = d.usage[k] || { n: 0, last: 0 };
  d.usage[k] = { n: u.n * Math.pow(0.5, (Date.now() - u.last) / (14 * 864e5)) + 1, last: Date.now() };
  state.store.saveSoon();
}

function hideAll() {
  for (const t of state.tabs.values()) if (t.view) t.view.setVisible(false);
}

function destroyView(tab) {
  if (!tab.view) return;
  const wc = tab.view.webContents;
  bus.emit('tab:removed', tab, wc.id);
  state.internalViews.delete(wc.id);
  state.win.contentView.removeChildView(tab.view);
  wc.close();
  tab.view = null;
}

async function closeTab(id) {
  const tab = state.tabs.get(id);
  if (!tab) return;
  const wasActive = state.activeTab === id;
  bus.emit('tab:closing', tab); // pour « fermés récemment » (chrome.sessions)
  destroyView(tab);
  state.tabs.delete(id);
  icons.drop(id);
  if (wasActive) {
    const rest = tabsOfSpace(tab.spaceId === 'global' ? state.activeSpace : tab.spaceId);
    const next = rest.filter(groups.inView).slice(-1)[0] || rest.slice(-1)[0];
    if (next) await activateTab(next.id);
    else { state.activeTab = null; layout(); pushNow(); }
  } else pushNow();
}

// Sur un outil commun ou dans Réglages, « chez quel client ? » n'a pas de réponse évidente : on demande, sans rien présélectionner.
async function pickNewTabTarget() {
  const items = cfg().clients.slice(0, 9).map((c, i) => ({ id: c.id, label: shownName(c.id), color: hidden(c) ? HIDDEN_COLOR : c.color, hint: String(i + 1), key: String(i + 1) }));
  items.push({ id: '__global', label: 'Commun (outil partagé, sans client)', color: '#6b7684', hint: '0', key: '0' });
  const id = await dialog.show({
    kind: 'picker', title: 'Nouvel onglet chez…', placeholder: 'Client, ou 0 pour Commun', hint: 'Aucun client n\'est présélectionné : choisissez-le.',
    noDefault: true, digitPick: true, items, buttons: [],
  });
  return id === '__global' ? 'global' : id || null;
}

async function newTab(url = HOME_URL) {
  const active = state.tabs.get(state.activeTab);
  let spaceId = state.activeSpace;
  if (identity.zoneOf(active) !== 'client' && active) {
    spaceId = await pickNewTabTarget();
    if (!spaceId) return;
  }
  if (!spaceId) return;
  const t = addTab({ spaceId, url });
  await activateTab(t.id);
  state.shell.webContents.send('focus-address');
}

async function openInternal(page = 'settings', section = null) {
  const def = INTERNAL_PAGES[page];
  if (!def) throw new Error('Page inconnue');
  let tab = [...state.tabs.values()].find((t) => t.internal === page);
  const fresh = !tab;
  if (!tab) tab = addTab({ spaceId: 'global', url: require('node:url').pathToFileURL(def.file).href, title: def.title, internal: page });
  await activateTab(tab.id);
  if (!section) return;
  // Page neuve : le message partirait avant que la page n'écoute, et la section demandée serait perdue.
  const wc = tab.view.webContents;
  if (fresh && (wc.isLoading() || !wc.getURL())) await new Promise((r) => { wc.once('did-finish-load', r); setTimeout(r, 5000).unref?.(); });
  wc.send('settings:section', section);
}

async function navigate(input) {
  if (state.activeSpace && require('./extensions/bridge/api-omnibox').enter(state.activeSpace, String(input))) return;
  const tab = state.tabs.get(state.activeTab);
  if (!tab || !tab.view || tab.internal) return;
  let url = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = /\s/.test(url) || !url.includes('.') ? SEARCH_URL + encodeURIComponent(url) : `https://${url}`;
  tab.view.webContents.loadURL(url).catch(() => {});
}

/* ---------- Mise en veille des onglets d'espaces inactifs ---------- */
async function unloadTab(tab) {
  if (!tab.view) return;
  const wc = tab.view.webContents;
  try { tab.scrollY = await wc.executeJavaScript('window.scrollY'); } catch { /* page non scriptable */ }
  tab.url = wc.getURL() || tab.url;
  destroyView(tab);
}

function hostMatches(host, pattern) {
  const p = String(pattern).trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith('*.')) return host === p.slice(2) || host.endsWith(p.slice(1));
  return host === p || host.endsWith('.' + p);
}

// Pourquoi un onglet ne doit pas être endormi : site exclu (réglage par hôte), outil « gardé éveillé », brouillon non envoyé.
function sleepBlock(tab) {
  let host = '';
  try { host = new URL(tab.view?.webContents.getURL() || tab.url).hostname.toLowerCase(); } catch { /* adresse illisible */ }
  if (host && cfg().settings.sleepExclusions.some((p) => hostMatches(host, p))) return 'host';
  if (signals.toolOf(tab)?.keepAwake) return 'keep';
  if (tab.draft && cfg().settings.protectDrafts !== false) return 'draft';
  return null;
}

function memoryMb() {
  const kb = app.getAppMetrics().reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0);
  return Math.round(kb / 1024);
}

const sleepCandidates = () => [...state.tabs.values()].filter(
  (t) => t.view && !t.internal && t.spaceId !== 'global' && t.spaceId !== state.activeSpace && !sleepBlock(t));

// Ne touche ni aux outils communs, ni à l'espace affiché, ni aux sites exclus, ni aux outils gardés éveillés, ni aux brouillons.
// 1) délai : tout onglet inactif depuis plus de `olderThanMs` ; 2) seuil de RAM : au-delà, on endort en plus
// les plus anciens (un quart des candidats restants par passage, la mémoire se libérant avec retard).
async function sweep(olderThanMs = cfg().settings.unloadAfterMs, { memThresholdMb = cfg().settings.memThresholdMb } = {}) {
  if (cfg().settings.protectDrafts !== false) await drafts.refreshAll(); // au plus ~1 s : un onglet muet garde sa dernière valeur
  const now = Date.now();
  const unloaded = [];
  for (const t of sleepCandidates()) {
    if (now - t.lastActive >= olderThanMs) { await unloadTab(t); unloaded.push({ id: t.id, reason: 'delay' }); }
  }
  if (memThresholdMb > 0 && memoryMb() > memThresholdMb) {
    const rest = sleepCandidates().sort((a, b) => a.lastActive - b.lastActive);
    for (const t of rest.slice(0, Math.max(1, Math.ceil(rest.length / 4)))) { await unloadTab(t); unloaded.push({ id: t.id, reason: 'memory' }); }
  }
  pushNow();
  return unloaded;
}

/* ---------- Mode vitrine : les autres clients n'existent plus que sous la forme « Client 2 » (masqué ici, jamais côté interface) ---------- */
const HIDDEN_COLOR = '#7b8794';
const hidden = (c) => !!state.vitrine && c.id !== state.activeSpace;
function shownName(id) {
  const i = cfg().clients.findIndex((c) => c.id === id);
  if (i < 0) return '';
  return hidden(cfg().clients[i]) ? `Client ${i + 1}` : cfg().clients[i].name;
}

// Serveurs observés. En vitrine, aucun nom ne sort : ni espace, ni projet, ni environnement, ni app (un nom peut désigner un client).
function serversView() {
  const v = require('./servers').view();
  if (!state.vitrine) return v;
  const items = v.items.map((i) => ({ ...i, label: '', project: '', workspace: '', environment: '', detail: '' }));
  return { ...v, items, notes: [] };
}

// La barre n'affiche que l'icône et sa marque : elle ne reçoit pas la liste des apps (jusqu'à 1000 lignes à chaque envoi d'état).
const serversSummary = ({ items, ...summary }) => summary;
const forBar = (s) => ({ ...s, servers: serversSummary(s.servers) });

function toggleVitrine(on = !state.vitrine) {
  state.vitrine = !!on;
  pushNow();
  notify(state.vitrine ? 'Mode vitrine : les autres clients sont masqués.' : 'Mode vitrine terminé.');
}

/* ---------- État envoyé à l'interface ---------- */
function snapshot() {
  const active = state.tabs.get(state.activeTab) || null;
  const zone = identity.zoneOf(active);
  const activeClient = zone === 'client' ? identity.clientOf(active ? active.spaceId : state.activeSpace) : null;
  const spaces = cfg().clients.map((c, i) => {
    const list = tabsOfSpace(c.id);
    if (hidden(c)) return { id: c.id, name: shownName(c.id), color: HIDDEN_COLOR, glyph: String(i + 1), critical: false, live: 0, total: 0, tools: [], marks: 0, next: null, hidden: true, groups: [], ungrouped: { count: 0, marks: 0 }, group: null };
    const tools = signals.rows(c.id).map((r) => { const g = c.tools.find((t) => t.id === r.toolId)?.group; return { ...r, group: g && groups.exists(c.id, g) ? g : null }; });
    return {
      id: c.id, name: c.name, color: c.color, glyph: identity.glyph(c.name), critical: !!c.critical,
      live: list.filter((t) => t.view).length, total: list.length, tools, marks: tools.filter((r) => r.delta > 0).length, next: carnet.nextOf(c),
      ...groups.summary(c.id, tools),
    };
  });
  const clientOfTab = (t) => (t.spaceId === 'global' ? null : cfg().clients.find((c) => c.id === t.spaceId));
  // La barre du haut ne montre que le groupe choisi ; l'onglet actif y figure toujours.
  // Barre du haut : les onglets du client regroupés par groupe (sans groupe d'abord), puis les outils communs.
  const gOrder = (t) => { const g = groups.groupOf(t); return g ? 1 + groups.listOf(t.spaceId).findIndex((x) => x.id === g) : 0; };
  const inBar = tabsOfSpace(state.activeSpace).filter((t) => groups.inView(t) || t.id === state.activeTab).map((t, i) => ({ t, i })).sort((a, b) => gOrder(a.t) - gOrder(b.t) || a.i - b.i).map((x) => x.t);
  const shown = [...inBar, ...tabsOfSpace('global')].map((t) => {
    const c = clientOfTab(t);
    return {
      id: t.id, group: groups.groupOf(t), icon: icons.urlOfTab(t), letter: String(signals.toolOf(t)?.name || hostOf(t.url) || t.title || '?').trim().slice(0, 1).toUpperCase(), title: t.title, url: t.internal ? `junr://${t.internal}` : t.url, global: t.spaceId === 'global', loaded: !!t.view, internal: !!t.internal,
      glyph: c ? identity.glyph(c.name) : null, color: c ? c.color : null, n: t.n ?? null, delta: t.seen !== undefined ? Math.max(0, signals.countOf(t) - t.seen) : 0,
      draft: !!t.draft, auth: t.auth || null, audible: !!(t.view && !t.view.webContents.isDestroyed() && t.view.webContents.isCurrentlyAudible()),
    };
  });
  const all = [...state.tabs.values()];
  const exts = extManager.list();
  const pinned = new Set(cfg().settings.pinnedExtensions || []);
  const tool = active ? signals.toolOf(active) : null;
  let host = '';
  try { host = new URL(active?.view?.webContents.getURL() || active?.url || '').hostname; } catch { /* pas d'adresse */ }
  const queue = signals.queue().map((q) => (state.vitrine && q.spaceId !== 'global' && q.spaceId !== state.activeSpace ? { ...q, label: shownName(q.spaceId) } : q));
  const mruNames = state.mru.map((id) => (cfg().clients.some((c) => c.id === id) ? shownName(id) : null)).filter(Boolean);
  const resume = state.resume && state.resume.spaceId === state.activeSpace && state.resume.expires > Date.now() ? state.resume : null;
  return {
    spaces, tabs: shown,
    activeSpace: state.activeSpace, activeTab: state.activeTab,
    live: all.filter((t) => t.view).length, sleeping: all.filter((t) => !t.view).length,
    memMb: memoryMb(), unloadAfterMs: cfg().settings.unloadAfterMs,
    // Extensions : toutes dans le volet, seules les épinglées ont leur bouton dans la barre.
    extensions: exts.filter((e) => e.enabled).map((e) => ({ id: e.id, name: e.name, icon: icons.urlOfExt(e), hasAction: !!e.hasAction, pinned: pinned.has(e.id) })),
    toolbar: exts.filter((e) => e.enabled && e.hasAction && pinned.has(e.id)).map((e) => ({ id: e.id, name: e.name, icon: icons.urlOfExt(e) })),
    // Identité du lieu courant
    // Pendant un changement de client, l'ancien onglet est encore actif alors que son client est déjà masqué par la vitrine.
    zone, frameW: identity.frameW(), host: activeClient && hidden(activeClient) ? '' : host,
    activeToolName: activeClient && hidden(activeClient) ? '' : tool?.name || (active ? active.title : ''),
    activeGroupName: activeClient && hidden(activeClient) ? null : groups.listOf(active?.spaceId).find((g) => g.id === groups.groupOf(active))?.name || null,
    emptyInGroup: !active && !!groups.activeOf(state.activeSpace),
    activeClient: activeClient ? (hidden(activeClient)
      ? { id: activeClient.id, name: shownName(activeClient.id), color: HIDDEN_COLOR, glyph: String(cfg().clients.indexOf(activeClient) + 1), critical: false }
      : { id: activeClient.id, name: activeClient.name, color: activeClient.color, glyph: identity.glyph(activeClient.name), critical: !!activeClient.critical }) : null,
    // Attention calme
    communs: signals.rows('global'), coverage: signals.coverage(), queue, queueCount: queue.length,
    notice: state.notice && state.notice.until > Date.now() ? state.notice.text : null,
    previous: zone === 'client' ? mruNames[1] || null : mruNames[0] || null,
    vitrine: !!state.vitrine, resume, update: require('./updater').brief(),
    servers: serversView(),
    protectedAwake: [...state.tabs.values()].filter((t) => t.view && !t.internal && t.spaceId !== 'global' && (t.draft || signals.toolOf(t)?.keepAwake)).length,
  };
}

let lastTitle = '';
function updateTitle(s) {
  if (!state.win || state.win.isDestroyed()) return;
  const title = s.zone === 'interne' ? 'Réglages — Junr' : s.zone === 'commun' ? `Commun · ${s.activeToolName} — Junr` : s.activeClient ? `${s.activeClient.name} · ${s.activeToolName} — Junr` : 'Junr Browser';
  if (title !== lastTitle) { lastTitle = title; state.win.setTitle(title); }
}

function pushNow() {
  if (state.shell && !state.shell.webContents.isDestroyed()) {
    const s = snapshot();
    state.shell.webContents.send('state', forBar(s));
    require('./flyout').update(s);
    updateTitle(s);
  }
}
// Les rafales (titres, audio, navigation) sont regroupées à 100 ms.
let pushTimer = null;
function pushSoon() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; pushNow(); }, 100);
  pushTimer.unref?.();
}
const push = pushNow;

/* ---------- Tournée : client précédent, prochain signal ---------- */
async function goPrevious() {
  if (cfg().clients.length < 2) { notify('Un seul client ouvert : rien à retrouver.'); return; }
  const zone = identity.zoneOf(state.tabs.get(state.activeTab));
  const target = zone === 'client' ? state.mru[1] : state.mru[0];
  const client = cfg().clients.find((c) => c.id === target);
  if (!client) { notify('Aucun client précédent pour l\'instant.'); return; }
  await switchSpace(client.id);
  notify(`Retour chez ${client.name}`);
}

async function goNextSignal() {
  const q = signals.queue();
  if (!q.length) { notify('Rien ne vous attend.'); return; }
  const item = q[0];
  await activateTab(item.tabId);
  notify(`${item.label} · 1 sur ${q.length} · Alt+J suivant · Ctrl+Tab retour`);
}

function ackTab(id) {
  const tab = state.tabs.get(id);
  if (tab) { signals.ack(tab); pushNow(); }
}

/* ---------- Sélecteur Ctrl+K : « ac co » → Acme › Compta ---------- */
const TAG_OF = { never: 'jamais ouvert', sleep: 'veille', live: 'éveillé' };

// Lignes déjà classées : les 9 couples client › outil les plus fréquentés (numérotés), les clients, puis le reste des outils.
function pickerItems() {
  const clients = cfg().clients;
  const usage = cfg().usage || {};
  const score = (k) => { const u = usage[k]; return u ? u.n * Math.pow(0.5, (Date.now() - u.last) / (14 * 864e5)) : 0; };
  const spaceLines = [];
  const toolLines = [];
  clients.forEach((c, i) => {
    if (hidden(c)) { spaceLines.push({ id: `space:${c.id}`, kind: 'space', client: shownName(c.id), glyph: String(i + 1), color: HIDDEN_COLOR, hint: i < 9 ? `Ctrl+${i + 1}` : '', tags: [] }); return; }
    const rows = signals.rows(c.id);
    const cold = rows.filter((r) => r.state !== 'live');
    const tags = [{ text: rows.some((r) => r.state === 'live') ? 'chaud' : `froid · ${cold.length} outil${cold.length > 1 ? 's' : ''} à réveiller` }];
    const marks = rows.reduce((n, r) => n + r.delta, 0);
    if (marks) tags.push({ text: `+${marks}`, hot: true });
    if (rows.some((r) => r.draft)) tags.push({ text: 'brouillon' });
    const nx = carnet.nextOf(c);
    spaceLines.push({ id: `space:${c.id}`, kind: 'space', client: c.name, glyph: identity.glyph(c.name), color: c.color, hint: i < 9 ? `Ctrl+${i + 1}` : '', tags, sub: nx ? `→ ${nx.text}` : '' });
    for (const r of rows) {
      const t = [{ text: TAG_OF[r.state] }];
      if (r.delta > 0) t.push({ text: r.n !== null ? `+${r.delta}` : 'a bougé', hot: true });
      if (r.audible) t.push({ text: 'audio', hot: true });
      if (r.draft) t.push({ text: 'brouillon' });
      if (r.auth === 'login') t.push({ text: 'connexion demandée', hot: true });
      toolLines.push({
        id: `tool:${c.id}:${r.toolId}`, kind: 'tool', client: c.name, tool: r.name, glyph: identity.glyph(c.name), color: c.color, tags: t, usage: score(`${c.id}:${r.toolId}`),
        title: r.state === 'live' ? '' : "Cet outil est endormi : il se rechargera à l'ouverture. Vous devrez peut-être vous reconnecter.",
      });
    }
  });
  const recents = toolLines.filter((l) => l.usage > 0).sort((a, b) => b.usage - a.usage).slice(0, 9);
  recents.forEach((l, i) => { l.recent = i + 1; l.key = String(i + 1); l.hint = String(i + 1); });
  const rest = toolLines.filter((l) => !l.recent);
  return [...recents, ...spaceLines, ...rest];
}

async function pickSpace() {
  const items = pickerItems();
  const id = await dialog.show({
    kind: 'picker', rich: true, digitPick: true, title: 'Aller à…', placeholder: 'Client puis outil : « ac co »', items, buttons: [],
    hint: 'Entrée : ouvrir · 1 à 9 : récents (champ vide) · Échap : annuler',
  });
  if (!id || typeof id !== 'string') return;
  const [kind, spaceId, toolId] = id.includes(':') ? id.split(':') : ['space', id];
  if (kind === 'space') { await switchSpace(spaceId); return; }
  const tab = [...state.tabs.values()].find((t) => t.spaceId === spaceId && t.toolId === toolId);
  if (tab) await activateTab(tab.id);
}

/* ---------- Carnet : capture en une ligne, prochaine action ---------- */
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

async function captureNote() {
  const active = state.tabs.get(state.activeTab);
  if (!active || identity.zoneOf(active) !== 'client') { notify("Choisissez d'abord un client."); return; }
  const client = identity.clientOf(active.spaceId);
  const url = active.view && !active.view.webContents.isDestroyed() ? active.view.webContents.getURL() : active.url;
  const linkable = /^https?:/i.test(url || '');
  const r = await dialog.show({
    kind: 'prompt', title: `Noter pour ${client.name}`, placeholder: 'Ce que vous voulez retrouver…',
    checkbox: linkable ? { label: `Lier cette page : « ${clip(active.title, 60)} »`, checked: true } : null,
    hint: 'Entrée : ajouter la note · Ctrl+Entrée : définir comme prochaine action · Échap : annuler',
    buttons: [{ id: 'next', label: 'Prochaine action' }, { id: 'note', label: 'Ajouter la note ↵', style: 'primary' }],
  });
  if (!r || !String(r.text || '').trim()) return;
  if (r.button === 'next') { carnet.setNext(client.id, r.text); notify('Prochaine action enregistrée.'); }
  else { carnet.addNote(client.id, { text: r.text, url: r.link ? url : undefined, title: active.title }); notify(`Note ajoutée chez ${client.name}.`); }
  pushNow();
}

async function editNext() {
  const client = identity.clientOf(state.activeSpace);
  if (!client) return;
  const r = await dialog.show({
    kind: 'prompt', title: `Prochaine action pour ${client.name}`, placeholder: 'La prochaine chose à faire chez ce client…', initial: carnet.nextOf(client)?.text || '',
    enter: 'save', ctrlEnter: 'save', hint: 'Entrée : enregistrer · « Fait » archive la phrase dans le journal · Échap : annuler',
    buttons: [{ id: 'done', label: 'Fait' }, { id: 'save', label: 'Enregistrer ↵', style: 'primary' }],
  });
  if (!r) return;
  if (r.button === 'done') carnet.done(client.id);
  else carnet.setNext(client.id, r.text);
  pushNow();
}

/* ---------- Navigation en croix : outil n° n du client, même outil chez le client suivant ---------- */
function currentToolContext() {
  const tab = state.tabs.get(state.activeTab);
  if (!tab || identity.zoneOf(tab) !== 'client') return null;
  return { tab, client: identity.clientOf(tab.spaceId), tool: signals.toolOf(tab) };
}
const tabOfTool = (spaceId, toolId) => [...state.tabs.values()].find((t) => t.spaceId === spaceId && t.toolId === toolId);

async function goToolIndex(n) {
  const cur = currentToolContext();
  if (!cur) { notify("Alt+1 à 9 : ouvrez d'abord un client."); return; }
  const tool = cur.client.tools[n - 1];
  if (!tool) { notify(`${cur.client.name} n'a que ${cur.client.tools.length} outil${cur.client.tools.length > 1 ? 's' : ''}.`); return; }
  const tab = tabOfTool(cur.client.id, tool.id);
  if (tab) await activateTab(tab.id);
}

async function goFamily(delta) {
  const cur = currentToolContext();
  if (!cur || !cur.tool) { notify("Alt+↑ / Alt+↓ : ouvrez d'abord un outil de client."); return; }
  const clients = cfg().clients;
  const family = signals.familyOf(cur.tool);
  const n = clients.length;
  const i0 = clients.indexOf(cur.client);
  for (let step = 1; step < n; step++) {
    const j = (((i0 + delta * step) % n) + n) % n;
    const tool = clients[j].tools.find((t) => signals.familyOf(t) === family);
    const tab = tool && tabOfTool(clients[j].id, tool.id);
    if (!tab) continue;
    const wrapped = delta > 0 ? j < i0 : j > i0;
    const from = cur.client.id;
    await activateTab(tab.id);
    notify(wrapped ? `${tool.name} · retour ${delta > 0 ? 'au début' : 'à la fin'} (${shownName(clients[j].id)})` : `${tool.name} · ${shownName(clients[j].id)} ‹ était ${shownName(from)}`);
    return;
  }
  notify(`Aucun autre client n'a « ${cur.tool.name} ».`);
}

/* ---------- Remplissage d'un mot de passe enregistré dans Junr (bouton 🔑 ou Ctrl+Maj+L) : dit pourquoi quand il ne remplit rien ---------- */
const FILL_WHY = {
  'no-tab': 'Aucun onglet à remplir.',
  'no-match': 'Aucun mot de passe enregistré dans Junr pour ce site (Réglages → Mots de passe).',
  'no-password-field': 'Aucun champ de mot de passe visible sur cette page.',
};
async function fillPassword() {
  const r = await native.fillActive().catch((e) => ({ ok: false, reason: 'error', message: e.message }));
  if (r && !r.ok && r.reason !== 'cancelled') notify(FILL_WHY[r.reason] || `Remplissage impossible : ${r.message || r.reason}`);
  return r;
}

/* ---------- Outils de développement de l'onglet actif (F12, Ctrl+Maj+I / J, « Inspecter » du clic droit) ---------- */
// Fenêtre détachée : une vue native n'a pas de cadre où se loger. `at` : coordonnées de la page à inspecter (clic droit).
function toggleDevTools(at = null) {
  const tab = state.tabs.get(state.activeTab);
  const wc = tab?.view?.webContents;
  if (!wc || wc.isDestroyed()) { notify('Aucun onglet à inspecter.'); return; }
  if (!at && wc.isDevToolsOpened()) { wc.closeDevTools(); return; }
  wc.openDevTools({ mode: 'detach' });
  if (at) wc.inspectElement(at.x, at.y);
}

/* ---------- Raccourcis ---------- */
function handleInput(event, input) {
  if (input.type !== 'keyDown') return;
  if (input.key === 'Escape' && popup.isOpen()) { popup.close(); return; }
  if (require('./flyout').isAuto()) require('./flyout').close(); // volet ouvert tout seul à la reprise : la première touche le referme
  if (state.resume) { state.resume = null; pushSoon(); } // première touche pressée : la carte « Depuis votre départ » a fait son travail
  const commands = () => require('./extensions/bridge/api-commands').handleKey(input, state.tabs.get(state.activeTab));
  if (!(input.control || input.meta)) {
    // Raccourcis déclarés par les extensions (chrome.commands) : une touche seule ne suffit jamais, il faut Alt ou une touche de fonction.
    if ((input.alt || /^F\d+$/.test(input.key)) && commands()) { event.preventDefault(); return; }
    if (input.key === 'F12' && !input.alt && !input.shift) { event.preventDefault(); toggleDevTools(); return; }
    // Raccourcis de Junr avec Alt seul (jamais Ctrl+Alt : c'est AltGr sur AZERTY) ; les extensions restent prioritaires (ci-dessus).
    if (input.alt && !input.shift) {
      const num = /^Digit([1-9])$/.exec(input.code); // les chiffres du pavé numérique sont « Numpad1 » : jamais interceptés
      if (input.code === 'KeyJ') { event.preventDefault(); goNextSignal(); }
      else if (num) { event.preventDefault(); goToolIndex(Number(num[1])); }
      else if (input.code === 'ArrowUp') { event.preventDefault(); goFamily(-1); }
      else if (input.code === 'ArrowDown') { event.preventDefault(); goFamily(1); }
    }
    return;
  }
  if (input.alt) { if (commands()) event.preventDefault(); return; } // Ctrl+Alt = AltGr : les raccourcis de Junr ne s'appliquent pas
  if (input.code === 'Tab' && !input.shift) { event.preventDefault(); goPrevious(); return; }
  if (input.shift) {
    if (input.code === 'KeyL') { event.preventDefault(); fillPassword(); }
    else if (input.code === 'KeyN') { event.preventDefault(); captureNote(); }
    else if (input.code === 'KeyH') { event.preventDefault(); toggleVitrine(); }
    else if (input.code === 'KeyI' || input.code === 'KeyJ') { event.preventDefault(); toggleDevTools(); }
    else if (commands()) event.preventDefault();
    return;
  }
  const digit = /^Digit([1-9])$/.exec(input.code);
  if (digit) {
    const c = cfg().clients[Number(digit[1]) - 1];
    if (c) { event.preventDefault(); switchSpace(c.id); }
  } else if (input.code === 'KeyT') { event.preventDefault(); newTab(); }
  else if (input.code === 'KeyW') { event.preventDefault(); if (state.activeTab) closeTab(state.activeTab); }
  else if (input.code === 'KeyL') { event.preventDefault(); state.shell.webContents.send('focus-address'); }
  else if (input.code === 'KeyK') { event.preventDefault(); pickSpace(); }
  else if (input.code === 'Comma') { event.preventDefault(); openInternal('settings'); }
  else if (commands()) event.preventDefault();
}

module.exports = {
  tabsOfSpace, layout, addTab, loadTab, activateTab, switchSpace, selectGroup, closeTab, newTab, navigate, openInternal, destroyView,
  sweep, unloadTab, push, pushNow, pushSoon, snapshot, pickSpace, handleInput, resolveUrl, memoryMb, hostMatches, sleepBlock,
  noteSpaceChange, notify, ackTab, goPrevious, goNextSignal, pickNewTabTarget, pickerItems, settleResume, resumeOpen,
  barSnapshot: () => forBar(snapshot()), toggleVitrine, captureNote, editNext, goFamily, goToolIndex, shownName, toggleDevTools, fillPassword,
};
