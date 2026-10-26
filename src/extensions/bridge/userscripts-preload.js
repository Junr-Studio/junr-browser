'use strict';
// Préchargement des pages web : injecte les scripts utilisateur (chrome.userScripts) enregistrés par les extensions du client.
// S'exécute avant les scripts de la page. Rien ne se passe sur les pages d'extension ni sans script correspondant.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  const isTop = window.top === window;
  let list;
  try { list = ipcRenderer.sendSync('junr:userscripts', location.href, isTop); } catch { return; }
  if (!Array.isArray(list) || !list.length) return;

  // Chaque couple (extension, worldId) a son monde isolé ; les numéros 2000+ évitent ceux d'Electron.
  const worldIds = new Map();
  const worldOf = (s) => {
    const k = `${s.extId}|${s.worldId}`;
    if (!worldIds.has(k)) worldIds.set(k, 2000 + worldIds.size);
    return worldIds.get(k);
  };

  const exposed = new Set();
  function runIn(s) {
    // Dans le monde USER_SCRIPT, chrome.runtime vient du pont (clé distincte : exposer une clé « chrome » plante le moteur de rendu).
    const prelude = s.messaging ? "try { Object.defineProperty(globalThis, 'chrome', { value: Object.assign({}, globalThis.chrome, { runtime: globalThis.__junrUs.runtime }), configurable: true, writable: true }); } catch (e) {}\n" : '';
    const sources = s.sources.map((code, i) => ({ code: (i === 0 ? prelude : '') + code }));
    const fail = (e) => console.error(`[junr-userscripts] ${s.id} : ${e && e.message}`);
    if (s.world === 'MAIN') { webFrame.executeJavaScript(s.sources.join('\n;\n')).catch(fail); return; }
    const world = worldOf(s);
    if (!exposed.has(world)) { webFrame.setIsolatedWorldInfo(world, { name: `Junr USER_SCRIPT ${s.extId}` }); } // crée le monde avant d'y exposer quoi que ce soit
    if (s.messaging && !exposed.has(world)) {
      exposed.add(world);
      // Dans ce monde seulement : chrome.runtime.sendMessage et chrome.runtime.id, comme dans le monde USER_SCRIPT de Chrome.
      contextBridge.exposeInIsolatedWorld(world, '__junrUs', {
        runtime: {
          id: s.extId,
          sendMessage: (message, callback) => {
            const p = ipcRenderer.invoke('junr:usermsg', s.extId, s.id, message);
            if (typeof callback === 'function') { p.then((r) => callback(r), () => callback(undefined)); return undefined; }
            return p;
          },
        },
      });
    }
    webFrame.executeJavaScriptInIsolatedWorld(world, sources).catch(fail);
  }

  const at = { document_start: [], document_end: [], document_idle: [] };
  for (const s of list) at[s.runAt]?.push(s);
  // Comme dans Chrome, « document_start » s'exécute quand l'élément racine existe déjà (avant tout autre contenu et avant les
  // scripts de la page : l'observateur est servi avant l'exécution du premier script inséré par l'analyseur).
  const startNow = () => { for (const s of at.document_start.splice(0)) runIn(s); };
  if (at.document_start.length) {
    if (document.documentElement) startNow();
    else new MutationObserver((_records, obs) => { if (document.documentElement) { obs.disconnect(); startNow(); } }).observe(document, { childList: true });
  }
  if (at.document_end.length || at.document_idle.length) {
    const ready = () => { for (const s of at.document_end.splice(0)) runIn(s); setTimeout(() => { for (const s of at.document_idle.splice(0)) runIn(s); }, 0); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
  }
})();
