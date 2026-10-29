'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bindWorkerCalls } = require('../../src/extensions/bridge/worker-calls');

// Un `ipc` qui se comporte comme celui d'Electron : `handle` lève si le canal est déjà pris
// (erreur « Attempted to register a second handler for 'junr:call' », exception non rattrapée du processus principal).
function electronLikeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle: (ch, fn) => { if (handlers.has(ch)) throw new Error(`Attempted to register a second handler for '${ch}'`); handlers.set(ch, fn); },
    removeHandler: (ch) => { handlers.delete(ch); },
  };
}

test('un service worker relancé accepte un nouveau gestionnaire', () => {
  const worker = { ipc: electronLikeIpc() };
  bindWorkerCalls(worker, { id: 1 }, () => {});
  assert.doesNotThrow(() => bindWorkerCalls(worker, { id: 2 }, () => {}));
});

test('le gestionnaire sert la connexion courante, pas l\'ancienne', async () => {
  const worker = { ipc: electronLikeIpc() };
  const seen = [];
  const call = (conn, p, a) => { seen.push([conn.id, p, a]); return 'réponse'; };
  bindWorkerCalls(worker, { id: 1 }, call);
  bindWorkerCalls(worker, { id: 2 }, call);
  const out = await worker.ipc.handlers.get('junr:call')({}, 'tabs.query', [{ active: true }]);
  assert.equal(out, 'réponse');
  assert.deepEqual(seen, [[2, 'tabs.query', [{ active: true }]]]);
});

test('un seul gestionnaire par worker, même après plusieurs relances', () => {
  const worker = { ipc: electronLikeIpc() };
  for (let i = 0; i < 5; i++) bindWorkerCalls(worker, { id: i }, () => {});
  assert.equal(worker.ipc.handlers.size, 1);
});
