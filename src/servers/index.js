'use strict';
// Câblage réel de l'observation des serveurs : store de l'application, coffre du système, journal dans userData, rafraîchissement de la barre.
// Les modules du dossier ne dépendent pas d'Electron ; seul ce fichier le fait.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { state } = require('../state');
const secrets = require('../secrets');
const providers = require('./providers');
const { createRailway } = require('./railway');
const { createObserver } = require('./observer');

const LOG_MAX = 200 * 1024;
let observer = null;

// Journal des relevés (userData/servers.log, remplacé par servers.log.1 au-delà de 200 Ko) : une application installée n'a pas de console. Jamais de jeton.
function log(line) {
  try {
    const file = path.join(app.getPath('userData'), 'servers.log');
    try { if (fs.statSync(file).size > LOG_MAX) fs.renameSync(file, file + '.1'); } catch { /* pas encore de journal */ }
    fs.appendFileSync(file, line + '\n');
  } catch { /* journal indisponible : le relevé continue */ }
}

function get() {
  if (observer) return observer;
  providers.register(createRailway());
  observer = createObserver({
    store: { get servers() { return state.store.data.servers; }, save: () => state.store.save() },
    secrets,
    providers,
    clients: () => state.store.data.clients.map((c) => ({ id: c.id, name: c.name })),
    onChange: () => { require('../tabs').push(); },
    log,
  });
  return observer;
}

// Le snapshot de la barre est calculé très souvent : avant le démarrage du store, ou sans observateur, on rend un état vide sans rien créer.
const EMPTY = Object.freeze({ configured: false, items: [], mark: 'none', count: 0, checkedAt: 0, waitUntil: 0 });
const view = () => (state.store ? get().view() : EMPTY);

module.exports = {
  view,
  config: () => get().config(),
  setSecret: (provider, key, value) => get().setSecret(provider, key, value),
  browse: (provider, pth) => get().browse(provider, pth),
  observe: (app_) => get().observe(app_),
  unobserve: (id) => get().unobserve(id),
  assign: (id, clientId) => get().assign(id, clientId),
  refresh: () => get().refresh(),
  start: () => get().start(),
  stop: () => { if (observer) observer.stop(); },
};
