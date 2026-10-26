/* Service worker de sonde. Le script de lancement place en tête `const PROBE_URL = '...'` (copie temporaire). */
'use strict';

const NAMESPACES = [
  'action', 'alarms', 'bookmarks', 'browsingData', 'commands', 'contentSettings', 'contextMenus', 'cookies', 'debugger',
  'declarativeContent', 'declarativeNetRequest', 'desktopCapture', 'devtools', 'dns', 'downloads', 'extension', 'fontSettings', 'gcm',
  'history', 'i18n', 'identity', 'idle', 'management', 'notifications', 'offscreen', 'omnibox', 'pageCapture', 'permissions', 'power',
  'printerProvider', 'privacy', 'proxy', 'readingList', 'runtime', 'scripting', 'search', 'sessions', 'sidePanel', 'storage', 'system',
  'tabCapture', 'tabGroups', 'tabs', 'topSites', 'tts', 'ttsEngine', 'userScripts', 'webNavigation', 'webRequest', 'windows',
];

// [chemin, arguments] : appelle la fonction ; sans arguments (null), vérifie seulement qu'elle existe.
const PROBES = [
  ['runtime.getPlatformInfo', []], ['runtime.getManifest', 'sync'], ['runtime.connectNative', null], ['runtime.sendNativeMessage', ['junr.none', {}]],
  ['runtime.getContexts', [{}]], ['storage.local.get', ['x']], ['storage.sync.get', ['x']], ['storage.session.get', ['x']],
  ['tabs.query', [{}]], ['tabs.get', null], ['tabs.sendMessage', null], ['tabs.captureVisibleTab', null],
  ['windows.getAll', []], ['windows.getCurrent', []], ['cookies.getAll', [{}]], ['cookies.getAllCookieStores', []],
  ['alarms.getAll', []], ['scripting.getRegisteredContentScripts', []], ['scripting.executeScript', null],
  ['action.getBadgeText', [{}]], ['contextMenus.removeAll', []], ['declarativeNetRequest.getDynamicRules', []],
  ['declarativeNetRequest.updateDynamicRules', [{ addRules: [], removeRuleIds: [] }]],
  ['downloads.search', [{}]], ['history.search', [{ text: '' }]], ['bookmarks.getTree', []], ['sessions.getRecentlyClosed', []],
  ['topSites.get', []], ['management.getAll', []], ['notifications.getAll', []], ['permissions.getAll', []], ['commands.getAll', []],
  ['idle.queryState', [60]], ['i18n.getUILanguage', 'sync'], ['sidePanel.getOptions', [{}]], ['tabGroups.query', [{}]],
  ['webNavigation.getAllFrames', [{ tabId: 0 }]], ['identity.getRedirectURL', 'sync'], ['identity.launchWebAuthFlow', null],
  ['identity.getAuthToken', null], ['tabCapture.getCapturedTabs', []], ['desktopCapture.chooseDesktopMedia', null],
  ['proxy.settings.get', [{}]], ['privacy.services.autofillAddressEnabled.get', [{}]], ['browsingData.settings', []],
  ['system.memory.getInfo', []], ['system.cpu.getInfo', []], ['search.query', null], ['readingList.query', [{}]],
  ['offscreen.createDocument', null], ['declarativeContent.onPageChanged.addRules', null], ['webRequest.onBeforeRequest.addListener', null],
  ['webRequest.onBeforeSendHeaders.addListener', null], ['tts.getVoices', []], ['power.requestKeepAwake', null], ['dns.resolve', null],
  ['debugger.getTargets', []], ['gcm.register', null], ['fontSettings.getFontList', []], ['pageCapture.saveAsMHTML', null],
  ['contentSettings.cookies.get', null], ['omnibox.setDefaultSuggestion', null], ['userScripts.getScripts', []], ['userScripts.register', null],
];

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
const resolvePath = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), chrome);

async function probe([path, args]) {
  const parts = path.split('.');
  const fn = resolvePath(path);
  const thisArg = resolvePath(parts.slice(0, -1).join('.'));
  if (typeof fn !== 'function') return [path, `missing (${typeof fn})`];
  if (args === null) return [path, 'exists'];
  try {
    if (args === 'sync') { fn.call(thisArg); return [path, 'ok']; }
    await Promise.race([fn.apply(thisArg, args), timeout(3000)]);
    return [path, 'ok'];
  } catch (e) { return [path, `error: ${(e && e.message) || e}`]; }
}

(async () => {
  const out = { namespaces: {}, calls: {}, userAgent: navigator.userAgent, startedAt: Date.now() };
  for (const ns of NAMESPACES) {
    const v = chrome[ns];
    out.namespaces[ns] = v === undefined ? 'missing' : `present (${typeof v}, ${v && typeof v === 'object' ? Object.keys(v).length : 0} membres)`;
  }
  for (const p of PROBES) { const [k, v] = await probe(p); out.calls[k] = v; }
  try {
    out.persistPrev = (await chrome.storage.local.get('persist')).persist ?? null;
    await chrome.storage.local.set({ persist: String(Date.now()) });
  } catch (e) { out.persistError = String(e); }
  try { await fetch(PROBE_URL, { method: 'POST', body: JSON.stringify(out) }); } catch (e) { /* le script de lancement signalera l'absence de rapport */ }
})();
