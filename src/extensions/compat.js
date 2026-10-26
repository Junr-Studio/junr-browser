'use strict';
// Compatibilité d'une extension avec Electron : compare ce que le manifeste exige aux API réellement
// exposées par Electron. La liste des API vient d'une mesure (`npm run phase0:probe`), pas d'une supposition.
const fs = require('node:fs');
const path = require('node:path');

const SURFACE_FILE = path.join(__dirname, 'electron-api-surface.json');

let surface = null;
function setSurface(s) { surface = s; } // tests

function loadSurface() {
  if (surface) return surface;
  try { surface = JSON.parse(fs.readFileSync(SURFACE_FILE, 'utf8')); } catch { surface = { namespaces: null }; }
  return surface;
}

// Permissions du manifeste qui ne désignent pas une API chrome.* (hôtes, droits généraux).
const NOT_AN_API = new Set([
  'activeTab', 'unlimitedStorage', 'clipboardWrite', 'clipboardRead', 'background', 'declarativeNetRequestFeedback',
  'webRequestBlocking', 'webRequestAuthProvider', 'geolocation', 'favicon', 'storage.managed', '<all_urls>',
]);
// Permissions dont le nom diffère de l'espace de noms chrome.*.
const ALIAS = { declarativeNetRequestWithHostAccess: 'declarativeNetRequest', webRequestBlocking: 'webRequest', webRequestAuthProvider: 'webRequest' };

// APIs sans lesquelles l'extension ne fonctionne pas du tout.
const CORE = new Set(['runtime', 'storage']);

// Fonction native de l'application qui peut remplacer l'API manquante.
function shimActive() { try { return require('./shim').enabled(); } catch { return false; } }
function bridgedNamespaces() { try { return Object.keys(require('./bridge').spec().ns); } catch { return []; } }

const NATIVE_SUGGESTION = {
  declarativeNetRequest: 'blocage réseau natif (session.webRequest)',
  webRequest: 'blocage réseau natif (session.webRequest)',
  scripting: 'injection native de scripts et de CSS',
  nativeMessaging: 'remplissage de mots de passe intégré',
  contextMenus: null,
};

function requiredApis(manifest) {
  const apis = new Set();
  const perms = [...(manifest.permissions || [])];
  for (const p of perms) {
    if (typeof p !== 'string' || NOT_AN_API.has(p) && !ALIAS[p]) continue;
    if (p.includes('://') || p.startsWith('<')) continue;
    apis.add((ALIAS[p] || p).split('.')[0]); // « system.memory » → espace de noms « system »
  }
  if (manifest.action || manifest.browser_action || manifest.page_action) apis.add('action');
  if (manifest.commands) apis.add('commands');
  if (manifest.side_panel) apis.add('sidePanel');
  if (manifest.devtools_page) apis.add('devtools');
  if (manifest.declarative_net_request) apis.add('declarativeNetRequest');
  if (manifest.omnibox) apis.add('omnibox');
  if (manifest.background?.service_worker || manifest.background?.scripts || manifest.background?.page) apis.add('runtime');
  return [...apis];
}

function optionalApis(manifest) {
  return (manifest.optional_permissions || []).filter((p) => typeof p === 'string' && !p.includes('://') && !p.startsWith('<')).map((p) => (ALIAS[p] || p).split('.')[0]);
}

// → { status: 'compatible'|'partial'|'unsupported', missing: string[], optionalMissing: string[], notes: string[], suggestions: string[] }
function classify(manifest, runtime = {}) {
  const s = loadSurface();
  const notes = [];
  const missing = [];
  const optionalMissing = [];
  if (![2, 3].includes(manifest.manifest_version)) notes.push(`manifest_version ${manifest.manifest_version} non supporté`);
  if (s.namespaces) {
    // API natives d'Electron + API implémentées par le pont de Junr Browser (si le shim est actif pour cette extension).
    const have = new Set(s.namespaces);
    const bridged = runtime.bridged ?? shimActive();
    if (bridged) { for (const ns of bridgedNamespaces()) have.add(ns); have.add('nativeMessaging'); }
    const untested = new Set(s.untested || []);
    for (const api of requiredApis(manifest)) {
      if (have.has(api)) continue;
      if (untested.has(api)) notes.push(`API ${api} non mesurée (non observable depuis un service worker)`);
      else missing.push(api);
    }
    for (const api of optionalApis(manifest)) if (!have.has(api) && !untested.has(api)) optionalMissing.push(api);
  } else {
    notes.push('Aucune mesure des API d\'Electron disponible : lancer `npm run phase0:probe`');
  }
  if (manifest.chrome_url_overrides) notes.push('Pages de remplacement (nouvel onglet, favoris) non appliquées');
  if (manifest.manifest_version === 2) notes.push('Manifest V2 : support à vérifier à l\'exécution');
  if (runtime.loadError) notes.push(`Chargement impossible : ${runtime.loadError}`);
  if (runtime.backgroundFailed) notes.push('Le service worker ne démarre pas');

  let status = missing.length ? 'partial' : 'compatible';
  if (missing.some((m) => CORE.has(m)) || runtime.loadError || runtime.backgroundFailed || ![2, 3].includes(manifest.manifest_version)) status = 'unsupported';
  const suggestions = [...new Set(missing.map((m) => NATIVE_SUGGESTION[m]).filter(Boolean))];
  return { status, missing, optionalMissing, notes, suggestions };
}

const LABEL = { compatible: 'Compatible', partial: 'Partiellement compatible', unsupported: 'Non supportée' };

module.exports = { setSurface, classify, requiredApis, LABEL, loadSurface, SURFACE_FILE };
