/* Shim chrome.* de Junr Browser — s'exécute dans le service worker de l'extension (importé par `junr-sw.js`, avant le script
 * d'origine) et dans ses pages (popup, options…, injecté par le préchargement). Précédé de `globalThis.__JUNR_SPEC = {...}`.
 *
 *  1. API pontées (spec.ns) : méthodes et événements implémentés dans le processus principal (voir src/extensions/bridge) ;
 *  2. API non prises en charge (spec.unsupported) : les fonctions échouent avec un message explicite ;
 *  3. toute autre API absente d'Electron : objet inerte (écouteurs ignorés, fonctions sans effet) + avertissement.
 *  4. storage.sync → alias de storage.local (pas de synchronisation entre appareils).
 * Un objet inerte n'est PAS une implémentation : l'extension démarre mais la fonction concernée ne fait rien. */
(() => {
  'use strict';
  const G = globalThis;
  if (typeof chrome === 'undefined') return;
  const isPage = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!isPage && !String(G.location && G.location.href).startsWith('chrome-extension://')) return;
  if (G.__junrShimInstalled) return;
  G.__junrShimInstalled = true;

  const SPEC = G.__JUNR_SPEC || { ns: {}, unsupported: [] };
  const bridge = G.__junr; // exposé par le préchargement ; absent => API pontées indisponibles
  const root = chrome;

  const warned = new Set();
  const warn = (path) => {
    if (warned.has(path)) return;
    warned.add(path);
    console.warn(`[junr-shim] chrome.${path} n'est pas implémentée dans Junr Browser`);
  };

  /* ---------- Objets inertes (API absentes et non pontées) ---------- */
  const EMPTY_LIST = /^(getAll|query|search|getTree|getChildren|getRecent|getRecentlyClosed|getDevices|getTarget|getTargets|getFrames|getAllFrames|getContexts|getSubTree|getFontList|getVoices)/;
  const NOOP_EVENT = { addListener() {}, removeListener() {}, hasListener: () => false, hasListeners: () => false, addRules() {}, removeRules() {}, getRules(cb) { if (cb) cb([]); } };

  function stub(path) {
    const last = path.split('.').pop();
    return new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        if (prop === 'apply' || prop === 'call' || prop === 'bind' || prop === 'toString') return Function.prototype[prop]; // un objet inerte reste une vraie fonction
        if (prop in NOOP_EVENT) return NOOP_EVENT[prop];
        return stub(`${path}.${String(prop)}`);
      },
      apply(_t, _this, args) {
        warn(path);
        const value = EMPTY_LIST.test(last) ? [] : undefined;
        const cb = args[args.length - 1];
        if (typeof cb === 'function') { setTimeout(() => cb(value), 0); return undefined; }
        return Promise.resolve(value);
      },
    });
  }

  /* ---------- Appels vers le processus principal ---------- */
  let lastError = null; // visible par chrome.runtime.lastError pendant l'exécution d'un rappel
  const clean = (e) => new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));

  function invoke(path, args) {
    let cb = null;
    if (args.length && typeof args[args.length - 1] === 'function') cb = args.pop();
    const p = bridge ? bridge.invoke(path, args).catch((e) => { throw clean(e); }) : Promise.reject(new Error('Pont chrome.* indisponible dans ce contexte'));
    const multi = (v) => (v && typeof v === 'object' && Array.isArray(v.$args) ? v.$args : [v]);
    if (!cb) return p.then((v) => multi(v)[0]);
    p.then((v) => { try { cb(...multi(v)); } catch (e) { console.error(e); } }, (err) => {
      lastError = { message: err.message };
      try { cb(undefined); } catch (e) { console.error(e); } finally { lastError = null; }
    });
    return undefined;
  }

  /* ---------- Événements ---------- */
  const eventSets = new Map(); // « ns.nom » → Set<{ cb, filter }>

  function makeEvent(name) {
    const set = new Set();
    eventSets.set(name, set);
    return {
      addListener(cb, filter) {
        if (typeof cb !== 'function') return;
        for (const l of set) if (l.cb === cb) return;
        set.add({ cb, filter });
        if (set.size === 1 && bridge) bridge.subscribe(name).catch((e) => console.warn(`[junr-shim] abonnement à ${name} refusé :`, clean(e).message));
      },
      removeListener(cb) {
        for (const l of set) if (l.cb === cb) set.delete(l);
        if (!set.size && bridge) bridge.unsubscribe(name).catch(() => {});
      },
      hasListener(cb) { for (const l of set) if (l.cb === cb) return true; return false; },
      hasListeners: () => set.size > 0,
      addRules() {}, removeRules() {}, getRules(cb) { if (cb) cb([]); },
    };
  }

  // Filtre d'URL des événements webNavigation (UrlFilter) évalué côté extension.
  function urlFilterMatches(f, url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    const re = (s) => { try { return new RegExp(s); } catch { return null; } };
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    return ![
      f.hostEquals !== undefined && u.hostname !== f.hostEquals, f.hostContains !== undefined && !u.hostname.includes(f.hostContains),
      f.hostPrefix !== undefined && !u.hostname.startsWith(f.hostPrefix), f.hostSuffix !== undefined && !u.hostname.endsWith(f.hostSuffix),
      f.pathEquals !== undefined && u.pathname !== f.pathEquals, f.pathContains !== undefined && !u.pathname.includes(f.pathContains),
      f.pathPrefix !== undefined && !u.pathname.startsWith(f.pathPrefix), f.pathSuffix !== undefined && !u.pathname.endsWith(f.pathSuffix),
      f.queryEquals !== undefined && u.search.slice(1) !== f.queryEquals, f.queryContains !== undefined && !u.search.includes(f.queryContains),
      f.queryPrefix !== undefined && !u.search.slice(1).startsWith(f.queryPrefix), f.querySuffix !== undefined && !u.search.endsWith(f.querySuffix),
      f.urlEquals !== undefined && url !== f.urlEquals, f.urlContains !== undefined && !url.includes(f.urlContains),
      f.urlPrefix !== undefined && !url.startsWith(f.urlPrefix), f.urlSuffix !== undefined && !url.endsWith(f.urlSuffix),
      f.urlMatches !== undefined && !(re(f.urlMatches) && re(f.urlMatches).test(url)),
      f.originAndPathMatches !== undefined && !(re(f.originAndPathMatches) && re(f.originAndPathMatches).test(u.origin + u.pathname)),
      f.schemes !== undefined && !f.schemes.includes(u.protocol.slice(0, -1)),
      f.ports !== undefined && !f.ports.some((p) => (Array.isArray(p) ? port >= p[0] && port <= p[1] : port === p)),
    ].some(Boolean);
  }

  if (bridge) {
    bridge.onEvent((msg) => {
      const set = eventSets.get(msg.name);
      if (!set) { if (msg.replyId) bridge.invoke('$reply', [msg.replyId, undefined]).catch(() => {}); return; }
      if (msg.replyId) { // événement avec réponse : le premier écouteur qui appelle sendResponse (ou renvoie true puis répond) l'emporte
        let done = false, async = false;
        const send = (v) => { if (!done) { done = true; bridge.invoke('$reply', [msg.replyId, v]).catch(() => {}); } };
        for (const { cb } of [...set]) { try { if (cb(...msg.args, send) === true) async = true; } catch (e) { console.error(e); } if (done) return; }
        if (!async) send(undefined);
        return;
      }
      // omnibox.onInputChanged(texte, suggest) : suggest renvoie les propositions au navigateur
      if (msg.name === 'omnibox.onInputChanged') msg.args = [...msg.args, (results) => { invoke('omnibox.$suggest', [results]).catch(() => {}); }];
      for (const { cb, filter } of [...set]) {
        if (filter && filter.url && msg.args[0] && msg.args[0].url !== undefined && !filter.url.some((f) => urlFilterMatches(f, msg.args[0].url))) continue;
        try { cb(...msg.args); } catch (e) { console.error(e); }
      }
    });
  }

  /* ---------- Fabrication des espaces de noms ---------- */
  // Messagerie native : chrome.runtime.connectNative renvoie un Port ; les messages et la déconnexion arrivent par l'événement interne
  // « runtime.onNativeEvent » (voir src/extensions/bridge/native-host.js).
  const nativePorts = new Map();
  const localEvent = () => {
    const set = new Set();
    return {
      addListener(cb) { if (typeof cb === 'function') set.add(cb); }, removeListener(cb) { set.delete(cb); },
      hasListener: (cb) => set.has(cb), hasListeners: () => set.size > 0,
      _fire(...a) { for (const cb of [...set]) { try { cb(...a); } catch (e) { console.error(e); } } },
    };
  };
  let nativeReady = null;
  function connectNative(name) {
    const id = (G.crypto && G.crypto.randomUUID) ? G.crypto.randomUUID() : String(Math.random()).slice(2);
    let closed = false;
    const port = { name, sender: undefined, onMessage: localEvent(), onDisconnect: localEvent() };
    const finish = (err) => {
      if (closed) return;
      closed = true; nativePorts.delete(id);
      lastError = err ? { message: err } : null;
      try { port.onDisconnect._fire(port); } finally { lastError = null; }
    };
    let connected = Promise.resolve();
    // postMessage est permis dès le retour de connectNative : les envois attendent, dans l'ordre, que la connexion soit établie.
    port.postMessage = (m) => {
      if (closed) throw new Error('Attempting to use a disconnected port object');
      connected = connected.then(() => (closed ? undefined : invoke('runtime.$nativePost', [id, m]))).catch((e) => finish(clean(e).message));
    };
    port.disconnect = () => { if (closed) return; invoke('runtime.$nativeDisconnect', [id]).catch(() => {}); finish(null); };
    nativePorts.set(id, { port, finish });
    if (!nativeReady) {
      const ev = makeEvent('runtime.onNativeEvent');
      ev.addListener((portId, kind, payload) => { const p = nativePorts.get(portId); if (!p) return; if (kind === 'message') p.port.onMessage._fire(payload, p.port); else p.finish(payload); });
      nativeReady = bridge ? bridge.subscribe('runtime.onNativeEvent') : Promise.reject(new Error('Pont chrome.* indisponible'));
    }
    connected = nativeReady.then(() => invoke('runtime.$nativeConnect', [id, name])).catch((e) => finish(clean(e).message));
    return port;
  }

  const bridgedParts = {}; // ns → { méthodes, événements, constantes } partagés entre `chrome` et `browser`
  for (const [ns, def] of Object.entries(SPEC.ns)) {
    const part = { ...def.constants };
    for (const m of def.methods) part[m] = (...args) => invoke(`${ns}.${m}`, args);
    // Réglages imbriqués de type ChromeSetting (chrome.privacy.network.webRTCIPHandlingPolicy.get/set/clear/onChange).
    for (const name of def.settings || []) {
      const keys = name.split('.');
      let o = part;
      for (const k of keys.slice(0, -1)) o = o[k] || (o[k] = {});
      o[keys[keys.length - 1]] = {
        get: (...a) => invoke(`${ns}.settingGet`, [name, ...a]),
        set: (...a) => invoke(`${ns}.settingSet`, [name, ...a]),
        clear: (...a) => invoke(`${ns}.settingClear`, [name, ...a]),
        onChange: makeEvent(`${ns}.${name}.onChange`),
      };
    }
    for (const e of def.events) { if (!e.endsWith('.onChange') || !(def.settings || []).length) part[e] = makeEvent(`${ns}.${e}`); }
    if (ns === 'runtime') { part.connectNative = connectNative; delete part.$nativeConnect; delete part.$nativePost; delete part.$nativeDisconnect; delete part.onNativeEvent; }
    bridgedParts[ns] = part;
  }

  const unsupportedNs = (ns) => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (/^on[A-Z]/.test(String(prop))) return NOOP_EVENT;
      return (...args) => {
        const err = new Error(`chrome.${ns} n'est pas pris en charge par Junr Browser`);
        const cb = args[args.length - 1];
        if (typeof cb === 'function') { lastError = { message: err.message }; try { cb(undefined); } finally { lastError = null; } return undefined; }
        return Promise.reject(err);
      };
    },
  });

  // Espaces de noms que Chromium peut ne pas exposer : si ni pontés ni non pris en charge, objet inerte.
  const INERT = ['bookmarks', 'browsingData', 'commands', 'contentSettings', 'contextMenus', 'cookies', 'declarativeContent', 'downloads', 'fontSettings',
    'history', 'identity', 'management', 'notifications', 'omnibox', 'privacy', 'readingList', 'search', 'sessions', 'sidePanel', 'tabGroups', 'topSites',
    'tts', 'webNavigation', 'windows'];
  // Espaces natifs incomplets : un membre manquant devient inerte (ex. tabs.create), storage.sync devient storage.local.
  const PATCHED = ['tabs', 'runtime', 'storage', 'action', 'scripting', 'webRequest', 'declarativeNetRequest', 'alarms', 'permissions', 'idle', 'extension', 'i18n', 'system', 'offscreen'];

  // Chromium RÉ-INSTALLE ses liaisons natives (tabs, management…) après le démarrage et écrase toute propriété modifiée sur
  // `chrome`. On remplace donc `chrome` / `browser` eux-mêmes par des proxys qui résolvent chaque espace de noms à chaque accès.
  const wrapped = new WeakMap();   // objet natif → enveloppe
  const standalone = {};           // espace de noms sans objet natif → enveloppe
  const aux = new Map();           // objets inertes / non pris en charge, créés une fois

  function wrapNative(ns, native, part) {
    let w = wrapped.get(native);
    if (!w) {
      w = new Proxy(native, {
        get(t, prop) {
          if (ns === 'runtime' && prop === 'lastError' && lastError) return lastError;
          if (part && prop in part) return part[prop];
          if (ns === 'storage' && prop === 'sync') return t.local;
          const v = Reflect.get(t, prop);
          if (v !== undefined || typeof prop === 'symbol' || prop === 'lastError') return v;
          return stub(`${ns}.${String(prop)}`);
        },
        has(t, prop) { return (part && prop in part) || Reflect.has(t, prop); },
      });
      wrapped.set(native, w);
    }
    return w;
  }

  function bridged(ns, native) {
    if (native && typeof native === 'object') return wrapNative(ns, native, bridgedParts[ns]);
    return standalone[ns] || (standalone[ns] = new Proxy(bridgedParts[ns], {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        return stub(`${ns}.${String(prop)}`);
      },
    }));
  }

  const once = (key, make) => aux.get(key) || (aux.set(key, make()), aux.get(key));

  function proxyRoot(real) {
    return new Proxy(real, {
      get(t, prop) {
        if (typeof prop === 'symbol') return Reflect.get(t, prop);
        const v = Reflect.get(t, prop);
        if (Object.prototype.hasOwnProperty.call(bridgedParts, prop)) return bridged(prop, v);
        if (v === undefined) {
          if (SPEC.unsupported.includes(prop)) return once('u:' + prop, () => unsupportedNs(prop));
          if (INERT.includes(prop)) return once('i:' + prop, () => stub(prop));
        } else if (PATCHED.includes(prop) && v && typeof v === 'object') return wrapNative(prop, v, null);
        return v;
      },
      has(t, prop) {
        return Object.prototype.hasOwnProperty.call(bridgedParts, prop) || SPEC.unsupported.includes(prop) || INERT.includes(prop) || Reflect.has(t, prop);
      },
    });
  }

  const install = (name, real) => {
    try { Object.defineProperty(G, name, { value: proxyRoot(real), configurable: true, writable: true, enumerable: false }); } catch (e) { console.warn(`[junr-shim] ${name} : ${e && e.message}`); }
  };
  install('chrome', root);
  // Chromium expose aussi `browser`, objet distinct de `chrome`, que beaucoup d'extensions préfèrent.
  if (typeof G.browser === 'object' && G.browser && G.browser !== root) install('browser', G.browser);

  // Dans un service worker : « prêt » une fois le script d'origine évalué (livre les événements arrivés pendant le démarrage).
  if (!isPage && bridge) setTimeout(() => bridge.invoke('$ready', []).catch(() => {}), 0);
})();
