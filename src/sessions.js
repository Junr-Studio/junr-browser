'use strict';
// Une partition persistante par client, une pour les outils communs, une éphémère pour les pages internes.
const { session } = require('electron');
const { state } = require('./state');
const permissions = require('./permissions');
const native = require('./native');
const extensions = require('./extensions/manager');
const bridge = require('./extensions/bridge');


const partitionName = (spaceId) => {
  if (spaceId === 'global') return 'persist:global';
  if (spaceId === 'internal') return 'junr-internal'; // mémoire seule : aucune donnée écrite
  return `persist:client-${spaceId}`;
};

function getSession(spaceId) {
  if (!state.sessions.has(spaceId)) {
    const ses = session.fromPartition(partitionName(spaceId));
    const entry = { ses, loaded: new Map(), ready: null };
    if (spaceId === 'internal') {
      const copyOnly = (p) => p === 'clipboard-sanitized-write';
      ses.setPermissionRequestHandler((wc, p, cb) => cb(copyOnly(p)));
      ses.setPermissionCheckHandler((wc, p) => copyOnly(p));
      entry.ready = Promise.resolve();
    } else {
      permissions.install(ses, spaceId);
      native.installBlocking(ses);
      bridge.attachSession(ses, spaceId);
      require('./displaymedia').install(ses);
      entry.ready = extensions.loadInto(ses).then((loaded) => { entry.loaded = loaded; });
    }
    state.sessions.set(spaceId, entry);
  }
  return state.sessions.get(spaceId);
}

// Efface les données d'un client supprimé (cookies, stockage, cache) puis oublie la session.
async function destroySession(spaceId) {
  const ses = session.fromPartition(partitionName(spaceId));
  await ses.clearStorageData();
  await ses.clearCache();
  state.sessions.delete(spaceId);
}

module.exports = { getSession, destroySession, partitionName };
