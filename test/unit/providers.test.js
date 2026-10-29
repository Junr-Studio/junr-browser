'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../../src/servers/providers');

const fake = { id: 'fake', label: 'Faux', secrets: [{ key: 'token', label: 'Jeton' }], browse: async () => [], statuses: async () => [] };

test('TC-001-1 : le registre expose nom et champs secrets, sans fonctions', () => {
  providers.register(fake);
  const found = providers.list().find((p) => p.id === 'fake');
  assert.deepEqual(found, { id: 'fake', label: 'Faux', secrets: [{ key: 'token', label: 'Jeton' }] });
});

test('TC-001-2 : un statut hors du jeu commun devient unknown', () => {
  assert.equal(providers.normalize('WHATEVER'), 'unknown');
  assert.equal(providers.normalize('online'), 'online');
  assert.deepEqual([...providers.STATES], ['online', 'deploying', 'failed', 'unknown']);
});

test('TC-001-3 : un fournisseur qui échoue donne unknown avec le motif, sans lever', async () => {
  const bad = { ...fake, id: 'bad', statuses: async () => { throw new Error('réseau coupé'); } };
  const out = await providers.safeStatuses(bad, { token: 'secret-123' }, [{}, {}]);
  assert.equal(out.length, 2);
  assert.equal(out[0].state, 'unknown');
  assert.match(out[0].detail, /réseau coupé/);
});

test('TC-001-3b : le motif ne contient jamais un secret', async () => {
  const bad = { ...fake, id: 'bad2', statuses: async () => { throw new Error('refus de secret-123'); } };
  const out = await providers.safeStatuses(bad, { token: 'secret-123' }, [{}]);
  assert.ok(!out[0].detail.includes('secret-123'));
});

test('un fournisseur inconnu est refusé', () => {
  assert.throws(() => providers.get('nope'), /inconnu/i);
});

test('backoffMs traverse safeStatuses, borné et numérique', async () => {
  const p = { ...fake, id: 'slow', statuses: async () => [{ state: 'unknown', detail: 'x', backoffMs: 30000 }, { state: 'unknown', detail: 'y', backoffMs: 'abc' }, { state: 'unknown', detail: 'z', backoffMs: 9e9 }] };
  const out = await providers.safeStatuses(p, {}, [{}, {}, {}]);
  assert.equal(out[0].backoffMs, 30000);
  assert.equal(out[1].backoffMs, undefined);
  assert.equal(out[2].backoffMs, 3600000);
});

test('skipped traverse safeStatuses', async () => {
  const p = { ...fake, id: 'skip', statuses: async () => [{ state: 'unknown', detail: 'x', skipped: true }, { state: 'online', detail: 'y' }] };
  const out = await providers.safeStatuses(p, {}, [{}, {}]);
  assert.equal(out[0].skipped, true);
  assert.equal(out[1].skipped, undefined);
});
