'use strict';
// Préchargement commun (service worker d'extension ET pages d'extension : popup, options, panneau latéral).
// Il expose au monde principal `__junr` (appels vers le processus principal + événements) ; pour les pages d'extension,
// il y injecte aussi le shim chrome.* (pour les service workers, le shim est importé par `junr-sw.js`).
const { contextBridge, ipcRenderer, webFrame } = require('electron');

(() => {
  const inPage = typeof window !== 'undefined';
  if (inPage && !String(location.protocol).startsWith('chrome-extension')) return; // jamais sur un site web

  const listeners = new Set();
  ipcRenderer.on('junr:event', (e, msg) => { for (const l of listeners) { try { l(msg); } catch { /* écouteur défaillant */ } } });
  const invoke = (path, args) => ipcRenderer.invoke('junr:call', path, args);
  contextBridge.exposeInMainWorld('__junr', {
    invoke,
    subscribe: (name) => invoke('$subscribe', [name]),
    unsubscribe: (name) => invoke('$unsubscribe', [name]),
    onEvent: (cb) => { listeners.add(cb); },
  });
  if (inPage) webFrame.executeJavaScript(ipcRenderer.sendSync('junr:shim-source')).catch(() => {});
})();
