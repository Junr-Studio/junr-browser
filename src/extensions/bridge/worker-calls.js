'use strict';
// Lie les appels `junr:call` d'un service worker d'extension à sa connexion courante.
//
// Un worker arrêté puis relancé (même identifiant de version) garde le même `ipc`, donc son ancien gestionnaire, lié à une connexion
// fermée : `handle` lèverait « Attempted to register a second handler », une exception non rattrapée du processus principal.
// On retire l'ancien gestionnaire avant d'enregistrer le nouveau.
function bindWorkerCalls(worker, conn, call) {
  worker.ipc.removeHandler('junr:call');
  worker.ipc.handle('junr:call', (e, p, a) => call(conn, p, a));
}

module.exports = { bindWorkerCalls };
