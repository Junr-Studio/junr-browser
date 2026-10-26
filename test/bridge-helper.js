'use strict';
// Extension de test du pont d'API : fabrique le CRX, l'installe par le gestionnaire (donc dans toutes les partitions),
// puis pilote ses agents (service worker et page) via le serveur de test.
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');

const AGENT = fs.readFileSync(path.join(__dirname, 'bridge-extension', 'agent.js'), 'utf8');

const ALL_PERMISSIONS = ['activeTab', 'alarms', 'bookmarks', 'browsingData', 'contextMenus', 'cookies', 'downloads', 'history', 'identity', 'idle',
  'management', 'notifications', 'privacy', 'scripting', 'search', 'sessions', 'sidePanel', 'storage', 'tabs', 'topSites', 'webNavigation', 'webRequest', 'fontSettings', 'tts', 'declarativeContent', 'userScripts', 'desktopCapture', 'tabCapture', 'nativeMessaging'];

// options : { name, permissions, host_permissions, extra (champs de manifeste) }
async function installBridgeExtension({ srv, extManager, state }, options = {}) {
  const base = srv.origin;
  const manifest = {
    manifest_version: 3, name: options.name || 'Pont de test', version: '1.0.0',
    permissions: options.permissions || ALL_PERMISSIONS,
    host_permissions: options.host_permissions || ['<all_urls>'],
    background: { service_worker: 'sw.js' },
    options_page: 'options.html',
    action: options.noPopup ? { default_title: 'Pont' } : { default_title: 'Pont', default_popup: 'popup.html' },
    side_panel: { default_path: 'panel.html' },
    omnibox: { keyword: 'jt' },
    commands: { 'junr-test': { suggested_key: { default: 'Ctrl+Shift+8' }, description: 'Commande de test' }, _execute_action: { suggested_key: { default: 'Ctrl+Shift+9' } } },
    ...(options.extra || {}),
  };
  const agent = AGENT.replaceAll('__BASE__', base);
  const page = (title) => `<!doctype html><meta charset="utf-8"><title>${title}</title><script src="agent.js"></script>`;
  const key = fixtures.newKey();
  const files = (version) => ({
    'manifest.json': JSON.stringify({ ...manifest, version }), 'sw.js': agent, 'agent.js': agent,
    'inject.js': 'document.title',
    'options.html': page('options'), 'popup.html': page('popup'), 'panel.html': page('panel'),
    'hash.js': 'location.hash = "#depuis-script"; 1', 'open.js': 'window.open(location.origin + "/page?popup"); 1',
    'icon.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  });
  const { crx, id } = fixtures.buildCrx3(fixtures.buildZip(files('1.0.0')), key);
  srv.publish(id, '1.0.0', crx);
  const saved = state.extBase;
  state.extBase = base + '/crx';
  const out = await extManager.install(id);
  state.extBase = saved;

  const send = (space, cmd, kind) => srv.bridge.send(space, cmd, kind, id);
  const send_ = send;
  const api = {
    id, out,
    // Publie une nouvelle version de la même extension (même clé) sur le faux Web Store.
    publishVersion: (version) => srv.publish(id, version, fixtures.buildCrx3(fixtures.buildZip(files(version)), key).crx),
    call: (space, p, ...args) => send(space, { type: 'call', path: p, args }),
    // même appel, mais attendu comme un échec : renvoie le message d'erreur
    fail: async (space, p, ...args) => { try { await send(space, { type: 'call', path: p, args }); return null; } catch (e) { return e.message; } },
    cb: (space, p, ...args) => send(space, { type: 'callback', path: p, args }),
    listen: (space, name, filter, as, reply) => send(space, { type: 'listen', name, filter, as, reply }),
    events: (space, kind) => send(space, { type: 'events' }, kind),
    prop: (space, p, kind) => send(space, { type: 'prop', path: p }, kind),
    typeOf: (space, p, kind) => send(space, { type: 'typeof', path: p }, kind),
    native: (space, host, messages, opts = {}) => send_(space, { type: "native", host, send: messages, ...opts }),
    boot: (space) => send(space, { type: 'boot' }),
    startup: (space) => send(space, { type: 'startup' }),
    dump: (space, p) => send(space, { type: 'dump', path: p }),
    who: (space, kind) => send(space, { type: 'who' }, kind),
    page: {
      call: (space, p, ...args) => send(space, { type: 'call', path: p, args }, 'page'),
      fail: async (space, p, ...args) => { try { await send(space, { type: 'call', path: p, args }, 'page'); return null; } catch (e) { return e.message; } },
      typeOf: (space, p) => send(space, { type: 'typeof', path: p }, 'page'),
      cb: (space, p, ...args) => send(space, { type: 'callback', path: p, args }, 'page'),
      media: (space, constraints, display = false) => send(space, { type: 'media', constraints, display }, 'page'),
      who: (space) => send(space, { type: 'who' }, 'page'),
    },
  };
  return api;
}

module.exports = { installBridgeExtension, ALL_PERMISSIONS };
