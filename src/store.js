'use strict';
// Persistance JSON dans le dossier de données de l'application (écriture atomique).
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = {
  unloadAfterMs: 300000, // délai de veille des onglets des espaces inactifs
  memThresholdMb: 0,     // 0 = désactivé ; sinon veille forcée au-delà de ce seuil de RAM
  sleepExclusions: [],   // hôtes jamais mis en veille (ex. "mail.example.com", "*.slack.com")
  userName: '',          // nom affiché dans le journal des partages
  protectDrafts: true,   // un onglet contenant du texte non envoyé ne s'endort jamais
  recordHistory: true,   // historique de navigation par client (chrome.history), effaçable depuis les Réglages
  pinnedExtensions: [],  // extensions dont le bouton est épinglé dans la barre (les autres sont dans le volet « extensions »)
  extensionShims: true,  // objets inertes pour les API chrome.* absentes d'Electron (évite l'arrêt des service workers)
  updateChannel: 'stable', // mises à jour de l'application : 'stable' (releases publiées) ou 'beta' (+ pré-versions GitHub)
};

const DEFAULT_NATIVE = {
  blocking: { enabled: true, rules: [] },     // motifs d'URL avec * (ex. "*://ads.example.com/*")
  injection: [],                              // { id, name, match, css, js, enabled }
};

function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client';
}

class Store {
  constructor(file, seed) {
    this.file = file;
    let data = null;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* premier lancement ou fichier illisible */ }
    if (!data) {
      data = {
        clients: seed.clients,
        globalTools: seed.globalTools,
        settings: { ...DEFAULT_SETTINGS, unloadAfterMs: seed.unloadAfterMs ?? DEFAULT_SETTINGS.unloadAfterMs },
      };
    }
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    data.permissions ||= {};      // { [spaceId]: { [origin]: { [permission]: 'allow'|'deny' } } }
    data.extensions ||= {};       // { [id]: { id, name, version, enabled, installedAt, source, compat } }
    data.native = { ...DEFAULT_NATIVE, ...(data.native || {}) };
    data.native.blocking = { ...DEFAULT_NATIVE.blocking, ...data.native.blocking };
    data.passwords ||= [];        // { id, origin, username, secret(base64 chiffré) }
    data.shareLog ||= [];
    data.usedPackets ||= [];
    data.usage ||= {};            // Ctrl+K : { 'client:outil': { n, last } }
    this.data = data;
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Écriture regroupée (2 s) pour les données d'apprentissage, qui changent à chaque bascule d'onglet.
  saveSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, 2000);
    this.timer.unref?.();
  }

  uniqueClientId(name) {
    const base = slug(name);
    const ids = new Set(this.data.clients.map((c) => c.id));
    let id = base, n = 2;
    while (ids.has(id) || id === 'global' || id === 'internal') id = `${base}-${n++}`;
    return id;
  }
}

module.exports = { Store, slug };
