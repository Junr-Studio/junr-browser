'use strict';
// Petites API : topSites, sessions (onglets fermés récemment), search, privacy (réglages mémorisés ; seule
// webRTCIPHandlingPolicy a un effet réel), browsingData, runtime.openOptionsPage.
const { bus, state, SEARCH_URL } = require('../../state');
const model = require('./model');

/* ---------- topSites : sites les plus visités du client, d'après son historique ---------- */
const topSites = {
  ns: 'topSites',
  permission: 'topSites',
  events: [],
  methods: {
    async get(ctx) { return require('./api-history').topSites(ctx.spaceId).map((i) => ({ url: i.url, title: i.title })); },
  },
};

/* ---------- sessions : onglets fermés récemment ---------- */
const closed = new Map(); // client → [{ lastModified, tab }]
let seq = 1;
const sessionsApi = {
  ns: 'sessions',
  permission: 'sessions',
  constants: { MAX_SESSION_RESULTS: 25 },
  events: ['onChanged'],
  methods: {
    async getRecentlyClosed(ctx, filter = {}) { return (closed.get(ctx.spaceId) || []).slice(0, Math.min(filter.maxResults || 25, 25)); },
    async getDevices() { return []; },
    async restore(ctx, sessionId) {
      const list = closed.get(ctx.spaceId) || [];
      const i = sessionId === undefined ? 0 : list.findIndex((s) => s.tab.sessionId === sessionId);
      if (i < 0 || !list[i]) throw new Error(`Invalid session id: "${sessionId}".`);
      const [entry] = list.splice(i, 1);
      const t = await model.createTab(ctx, { url: entry.tab.url, active: true });
      return { lastModified: Math.floor(Date.now() / 1000), tab: { ...entry.tab, id: t.view.webContents.id } };
    },
  },
  install({ emit }) {
    bus.on('tab:closing', (tab) => {
      if (tab.internal || !tab.view || !/^https?:/i.test(tab.view.webContents.getURL())) return;
      const wc = tab.view.webContents;
      const list = closed.get(tab.spaceId) || closed.set(tab.spaceId, []).get(tab.spaceId);
      list.unshift({ lastModified: Math.floor(Date.now() / 1000), tab: { sessionId: String(seq++), url: wc.getURL(), title: wc.getTitle(), favIconUrl: tab.favIconUrl, index: 0, windowId: 0, active: false, highlighted: false, pinned: false, incognito: false, selected: false } });
      list.splice(25);
      emit('sessions.onChanged', [], { spaceId: tab.spaceId });
    });
  },
};

/* ---------- search ---------- */
const searchApi = {
  ns: 'search',
  permission: 'search',
  events: [],
  methods: {
    async query(ctx, q = {}) {
      const text = typeof q === 'string' ? q : q.text;
      if (!text) throw new Error('Text is required.');
      const url = SEARCH_URL + encodeURIComponent(text);
      const dispo = typeof q === 'object' ? q.disposition || 'CURRENT_TAB' : 'CURRENT_TAB';
      if (dispo === 'CURRENT_TAB') {
        const tab = model.resolveTab(ctx, typeof q === 'object' ? q.tabId : undefined);
        if (tab) { tab.view.webContents.loadURL(url).catch(() => {}); return; }
      }
      await model.createTab(ctx, { url, active: true });
    },
  },
};

/* ---------- privacy ---------- */
const SETTINGS = {
  'network.networkPredictionEnabled': true, 'network.webRTCIPHandlingPolicy': 'default', 'network.webRTCUDPPortRange': '',
  'services.autofillAddressEnabled': true, 'services.autofillCreditCardEnabled': true, 'services.passwordSavingEnabled': true, 'services.safeBrowsingEnabled': true,
  'services.safeBrowsingExtendedReportingEnabled': false, 'services.searchSuggestEnabled': true, 'services.spellingServiceEnabled': false, 'services.translationServiceEnabled': true,
  'websites.thirdPartyCookiesAllowed': true, 'websites.hyperlinkAuditingEnabled': true, 'websites.referrersEnabled': true, 'websites.doNotTrackEnabled': false,
  'websites.protectedContentEnabled': true, 'websites.topicsEnabled': true, 'websites.fledgeEnabled': true, 'websites.adMeasurementEnabled': true, 'websites.relatedWebsiteSetsEnabled': true,
};
const WEBRTC = ['default', 'default_public_and_private_interfaces', 'default_public_interface_only', 'disable_non_proxied_udp'];
const stored = new Map(); // « client|extension|réglage » → valeur
let privacyEmit = null;

function applyWebRtc(spaceId) {
  const entries = [...stored].filter(([k]) => k.startsWith(`${spaceId}|`) && k.endsWith('|network.webRTCIPHandlingPolicy'));
  const policy = entries.length ? entries[entries.length - 1][1] : 'default';
  for (const t of model.tabsOfSpace(spaceId)) { try { t.view.webContents.setWebRTCIPHandlingPolicy(policy); } catch { /* vue détruite */ } }
}

const checkSetting = (name) => { if (!(name in SETTINGS)) throw new Error(`Réglage de confidentialité inconnu : ${name}`); };

const privacy = {
  ns: 'privacy',
  permission: 'privacy',
  events: Object.keys(SETTINGS).map((n) => `${n}.onChange`),
  settings: Object.keys(SETTINGS),
  methods: {
    async settingGet(ctx, name) {
      checkSetting(name);
      const v = stored.get(`${ctx.spaceId}|${ctx.extId}|${name}`);
      return { value: v === undefined ? SETTINGS[name] : v, levelOfControl: 'controllable_by_this_extension' };
    },
    async settingSet(ctx, name, details = {}) {
      checkSetting(name);
      if (name === 'network.webRTCIPHandlingPolicy' && !WEBRTC.includes(details.value)) throw new Error(`Value must be one of: [${WEBRTC.join(', ')}].`);
      stored.set(`${ctx.spaceId}|${ctx.extId}|${name}`, details.value);
      if (name === 'network.webRTCIPHandlingPolicy') applyWebRtc(ctx.spaceId);
      privacyEmit?.(`privacy.${name}.onChange`, [{ value: details.value, levelOfControl: 'controlled_by_this_extension' }], { spaceId: ctx.spaceId, extId: ctx.extId });
    },
    async settingClear(ctx, name) {
      checkSetting(name);
      stored.delete(`${ctx.spaceId}|${ctx.extId}|${name}`);
      if (name === 'network.webRTCIPHandlingPolicy') applyWebRtc(ctx.spaceId);
    },
  },
  install({ emit }) {
    privacyEmit = emit;
    bus.on('tab:created', (tab) => { if (!tab.internal) applyWebRtc(tab.spaceId); });
  },
  onExtensionRemoved(extId) {
    const spaces = new Set();
    for (const k of [...stored.keys()]) { const [sp, ex] = k.split('|'); if (ex === extId) { stored.delete(k); spaces.add(sp); } }
    for (const sp of spaces) applyWebRtc(sp);
  },
};

/* ---------- browsingData ---------- */
const STORAGE = { cookies: 'cookies', fileSystems: 'filesystem', indexedDB: 'indexdb', localStorage: 'localstorage', serviceWorkers: 'serviceworkers', webSQL: 'websql', cacheStorage: 'cachestorage' };

async function removeData(ctx, options = {}, what = {}) {
  const ses = ctx.ses;
  const since = Number(options.since) || 0;
  const origins = options.origins || null;
  const storages = Object.keys(STORAGE).filter((k) => what[k]).map((k) => STORAGE[k]);
  if (storages.length) {
    if (origins) for (const origin of origins) await ses.clearStorageData({ origin, storages });
    else await ses.clearStorageData({ storages });
  }
  if (what.cache) await ses.clearCache();
  if (what.history) require('./api-history').deleteRange(ctx.spaceId, since, Date.now() + 1);
}

const browsingData = {
  ns: 'browsingData',
  permission: 'browsingData',
  events: [],
  methods: {
    remove: async (ctx, options, what) => removeData(ctx, options, what),
    ...Object.fromEntries(['Cache', 'Cookies', 'FileSystems', 'History', 'IndexedDB', 'LocalStorage', 'ServiceWorkers', 'WebSQL', 'CacheStorage'].map((n) => {
      const key = n === 'IndexedDB' ? 'indexedDB' : n === 'WebSQL' ? 'webSQL' : n[0].toLowerCase() + n.slice(1);
      return [`remove${n}`, async (ctx, options) => removeData(ctx, options, { [key]: true })];
    })),
    async removeDownloads() {}, async removeFormData() {}, async removePasswords() {}, async removePluginData() {}, async removeAppcache() {},
    async settings() { return { options: { since: 0 }, dataToRemove: {}, dataRemovalPermitted: { cache: true, cookies: true, history: true, localStorage: true, indexedDB: true, serviceWorkers: true } }; },
  },
};

/* ---------- runtime : méthodes absentes d'Electron ---------- */
const nativePorts = new Map(); // « client|extension|port » → hôte
const portKey = (ctx, id) => `${ctx.spaceId}|${ctx.extId}|${id}`;
const runtimeApi = {
  ns: 'runtime',
  permission: (m) => (m === 'sendNativeMessage' || String(m).startsWith('$native') || m === 'onNativeEvent' ? 'nativeMessaging' : null),
  events: ['onUserScriptMessage', 'onInstalled', 'onStartup', 'onNativeEvent'],
  onConnectionClosed(conn) { // le service worker s'arrête : ses ports natifs se ferment (comme dans Chrome)
    for (const [k, h] of [...nativePorts]) if (k.startsWith(`${conn.spaceId}|${conn.extId}|`) && h.owner === conn) { h.kill(); nativePorts.delete(k); }
  },
  methods: {
    async sendNativeMessage(ctx, host, message) { return require('./native-host').sendOnce(host, ctx.extId, message); },
    async $nativeConnect(ctx, id, host) {
      const bridge = require('./index');
      const send = (kind, payload) => bridge.emit('runtime.onNativeEvent', [id, kind, payload], { spaceId: ctx.spaceId, extId: ctx.extId });
      try {
        const h = require('./native-host').launch(host, ctx.extId, {
          onMessage: (m) => send('message', m),
          onExit: (code) => { nativePorts.delete(portKey(ctx, id)); send('disconnect', 'Native host has exited.'); void code; },
        });
        h.owner = ctx.conn;
        nativePorts.set(portKey(ctx, id), h);
      } catch (e) { send('disconnect', e.message); }
    },
    async $nativePost(ctx, id, message) {
      const h = nativePorts.get(portKey(ctx, id));
      if (!h) throw new Error('Attempting to use a disconnected port object');
      h.send(message);
    },
    async $nativeDisconnect(ctx, id) { nativePorts.get(portKey(ctx, id))?.kill(); nativePorts.delete(portKey(ctx, id)); },
    async openOptionsPage(ctx) { await require('../actions').openOptions(ctx.extId, ctx.spaceId); },
  },
};

void state;
module.exports = [topSites, sessionsApi, searchApi, privacy, browsingData, runtimeApi];
