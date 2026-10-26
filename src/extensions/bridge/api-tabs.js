'use strict';
// chrome.tabs : Electron fournit nativement sendMessage et scripting.executeScript (identifiant d'onglet = webContents.id)
// mais n'émet aucun événement, n'a ni create, remove, reload… et son query renvoie [] pour currentWindow:true.
// Ce module comble ces manques et remplace query/get pour qu'ils suivent la sémantique de Chrome.
const { state, bus } = require('../../state');
const model = require('./model');
const { matchPattern } = require('./match');

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const globRe = (g) => new RegExp('^' + String(g).split('*').map(escapeRe).join('.*') + '$', 'i');

// Filtres de chrome.tabs.query, évalués sur les onglets du client : sa « fenêtre courante » est celle de son client,
// et « active » désigne son onglet actif, affiché ou non.
function queryTabs(ctx, q = {}) {
  const winOk = (id) => id === undefined || id === model.WINDOW_ID || id === -2;
  if (q.windowId !== undefined && !winOk(q.windowId)) return [];
  if (q.currentWindow === false || q.lastFocusedWindow === false) return [];
  if (q.windowType !== undefined && q.windowType !== 'normal') return [];
  const urls = q.url === undefined ? null : [].concat(q.url);
  return model.tabsOfSpace(ctx.spaceId).sort((a, b) => a.id - b.id).map((t) => model.tabInfo(ctx, t)).filter((info) => {
    if (q.active !== undefined && !!q.active !== info.active) return false;
    if (q.highlighted !== undefined && !!q.highlighted !== info.highlighted) return false;
    if (q.audible !== undefined && !!q.audible !== info.audible) return false;
    if (q.muted !== undefined && !!q.muted !== info.mutedInfo.muted) return false;
    if (q.pinned) return false;
    if (q.discarded) return false;
    if (q.autoDiscardable !== undefined && !q.autoDiscardable) return false;
    if (q.groupId !== undefined && q.groupId !== -1) return false;
    if (q.index !== undefined && q.index !== info.index) return false;
    if (q.status !== undefined && q.status !== info.status) return false;
    // url et title ne se filtrent que si l'extension peut voir ces champs (permission « tabs » ou hôte autorisé)
    if (urls && !(info.url !== undefined && urls.some((p) => matchPattern(p, info.url)))) return false;
    if (q.title !== undefined && !(info.title !== undefined && globRe(q.title).test(info.title))) return false;
    return true;
  });
}

function mine(ctx, tabId) {
  const t = model.resolveTab(ctx, tabId);
  if (!t) throw new Error(`No tab with id: ${tabId}.`);
  return t;
}

// Écouteurs posés sur chaque vue web d'onglet pour produire tabs.onUpdated.
function watch(tab, emit) {
  const wc = tab.view.webContents;
  const update = (change) => emit('tabs.onUpdated', (ctx) => {
    const info = model.tabInfo(ctx, tab);
    if (!info) return null;
    const c = { ...change };
    if (!model.canSeeUrl(ctx, wc.getURL())) { delete c.url; delete c.title; delete c.favIconUrl; }
    return Object.keys(c).length ? [wc.id, c, info] : null;
  }, { spaceId: tab.spaceId });
  wc.on('did-start-loading', () => update({ status: 'loading' }));
  wc.on('did-stop-loading', () => update({ status: 'complete' }));
  wc.on('did-navigate', (e, url) => update({ url }));
  wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) update({ url }); });
  wc.on('page-title-updated', (e, title) => update({ title }));
  wc.on('page-favicon-updated', (e, favicons) => { tab.favIconUrl = favicons[0]; update({ favIconUrl: favicons[0] }); });
  wc.on('audio-state-changed', () => update({ audible: wc.isCurrentlyAudible() }));
}

module.exports = {
  ns: 'tabs',
  permission: null, // chaque méthode contrôle elle-même ce qu'elle expose (url, title…) d'après `tabs` et les hôtes autorisés
  events: ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onHighlighted', 'onMoved', 'onAttached', 'onDetached', 'onReplaced', 'onZoomChange'],
  methods: {
    async query(ctx, q) { return queryTabs(ctx, q); },
    async get(ctx, tabId) {
      const t = tabId === undefined ? null : model.resolveTab(ctx, tabId);
      if (!t) throw new Error(`No tab with id: ${tabId}.`);
      return model.tabInfo(ctx, t);
    },
    async create(ctx, props = {}) {
      const t = await model.createTab(ctx, { url: props.url, active: props.active, openerTabId: props.openerTabId });
      return model.tabInfo(ctx, t);
    },
    async update(ctx, a, b) {
      // update(tabId, props) ou update(props) : l'onglet actif du client.
      const [tabId, props] = typeof a === 'object' && a !== null ? [undefined, a] : [a, b || {}];
      const tab = mine(ctx, tabId);
      const wc = tab.view.webContents;
      if (props.url !== undefined) wc.loadURL(model.checkOpenableUrl(ctx, props.url)).catch(() => {});
      if (props.muted !== undefined) wc.setAudioMuted(!!props.muted);
      if (props.active || props.highlighted) {
        if (ctx.spaceId === 'global' || ctx.spaceId === state.activeSpace) await require('../../tabs').activateTab(tab.id);
      }
      return model.tabInfo(ctx, tab);
    },
    async remove(ctx, ids) {
      const list = [].concat(ids).map((id) => mine(ctx, id));
      for (const t of list) await require('../../tabs').closeTab(t.id);
    },
    async reload(ctx, tabId, props = {}) {
      const wc = mine(ctx, tabId).view.webContents;
      if (props.bypassCache) wc.reloadIgnoringCache(); else wc.reload();
    },
    async goBack(ctx, tabId) {
      const h = mine(ctx, tabId).view.webContents.navigationHistory;
      if (!h.canGoBack()) throw new Error('Cannot find a previous page in history');
      h.goBack();
    },
    async goForward(ctx, tabId) {
      const h = mine(ctx, tabId).view.webContents.navigationHistory;
      if (!h.canGoForward()) throw new Error('Cannot find a next page in history');
      h.goForward();
    },
    async duplicate(ctx, tabId) {
      const src = mine(ctx, tabId);
      const t = await model.createTab(ctx, { url: src.view.webContents.getURL() || src.url, active: false });
      return model.tabInfo(ctx, t);
    },
    async getCurrent(ctx) {
      // Appelée depuis une page d'extension ouverte comme onglet : on retrouve l'onglet qui l'héberge.
      const wc = ctx.conn.wc;
      const t = wc && model.tabByWcId(wc.id);
      return t ? model.tabInfo(ctx, t) : undefined;
    },
    async move(ctx, ids) { return Array.isArray(ids) ? ids.map((id) => model.tabInfo(ctx, mine(ctx, id))) : model.tabInfo(ctx, mine(ctx, ids)); },
    async highlight(ctx) { return model.windowInfo(ctx, true); },
    async discard(ctx, tabId) {
      const t = mine(ctx, tabId);
      if (t.id === state.activeTab) return undefined;
      await require('../../tabs').unloadTab(t);
      return undefined;
    },
    async detectLanguage() { return 'und'; },
    async captureVisibleTab(ctx, _windowId, options = {}) {
      const tab = model.resolveTab(ctx, undefined);
      if (!tab) throw new Error('Aucun onglet à capturer');
      const wc = tab.view.webContents;
      if (!(ctx.has('activeTab') || ctx.hostAllowed(wc.getURL()))) throw new Error('Either the "<all_urls>" or "activeTab" permission is required.');
      // Juste après un redimensionnement, la surface d'affichage peut manquer un instant : on réessaie brièvement.
      let image;
      for (let i = 0; ; i++) {
        try { image = await wc.capturePage(); break; } catch (e) { if (i >= 4) throw e; await new Promise((r) => setTimeout(r, 250)); }
      }
      return options.format === 'jpeg' ? `data:image/jpeg;base64,${image.toJPEG(options.quality ?? 90).toString('base64')}` : image.toDataURL();
    },
    async getZoom(ctx, tabId) { return mine(ctx, tabId).view.webContents.getZoomFactor(); },
    async setZoom(ctx, tabId, factor) { mine(ctx, tabId).view.webContents.setZoomFactor(factor || 1); },
    async getZoomSettings() { return { mode: 'automatic', scope: 'per-origin', defaultZoomFactor: 1 }; },
    async setZoomSettings() {},
  },
  install({ emit }) {
    bus.on('tab:created', (tab) => {
      if (tab.internal || !tab.view) return;
      watch(tab, emit);
      emit('tabs.onCreated', (ctx) => { const i = model.tabInfo(ctx, tab); return i ? [i] : null; }, { spaceId: tab.spaceId });
    });
    bus.on('tab:removed', (tab, wcId) => {
      if (tab.internal) return;
      emit('tabs.onRemoved', [wcId, { windowId: model.WINDOW_ID, isWindowClosing: false }], { spaceId: tab.spaceId });
    });
    bus.on('tab:activated', (tab, previous) => {
      if (tab.internal || !tab.view) return;
      const args = [{ tabId: tab.view.webContents.id, windowId: model.WINDOW_ID }];
      if (previous && previous.view && previous.spaceId === tab.spaceId) args[0].previousTabId = previous.view.webContents.id;
      emit('tabs.onActivated', args, { spaceId: tab.spaceId });
      emit('tabs.onHighlighted', [{ tabIds: [tab.view.webContents.id], windowId: model.WINDOW_ID }], { spaceId: tab.spaceId });
    });
  },
};
