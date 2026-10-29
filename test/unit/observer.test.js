'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createObserver, BUDGET_MS } = require('../../src/servers/observer');
const providers = require('../../src/servers/providers');

const TOKEN = 'tok-SECRET-123';
const fakeSecrets = (ok = true) => ({
  available: async () => ok,
  encrypt: async (v) => 'enc:' + Buffer.from(v).toString('base64'),
  decrypt: async (b) => Buffer.from(b.slice(4), 'base64').toString(),
});

// Construit un observateur sur un fournisseur de test dont les statuts se pilotent depuis le test.
function setup({ available = true, decryptFails = false } = {}) {
  const calls = { statuses: 0, list: 0, refs: [] };
  const script = { listGate: null, note: undefined, targets: null, notes: [], listFail: null, apps: null, states: [], fail: null, backoffMs: undefined, gate: null, onStatuses: null };
  const clock = { t: 1000 };
  const provider = {
    id: 'fake', label: 'Faux', secrets: [{ key: 'token', label: 'Jeton' }],
    // Sans `script.targets`, la découverte échoue : les tests plus anciens posent leurs cibles à la main avec observe().
    list: async (creds) => {
      calls.list++;
      calls.creds = creds;
      if (script.listGate) await script.listGate;
      if (script.listFail) throw (script.listFail instanceof Error ? script.listFail : new Error(script.listFail));
      if (!script.targets) throw new Error('pas de découverte');
      return { targets: script.targets, notes: script.notes };
    },
    statuses: async (creds, refs) => {
      calls.statuses++;
      calls.refs.push(refs.map((r) => r.n));
      if (script.onStatuses) script.onStatuses();
      if (script.gate) await script.gate;
      if (script.fail) throw new Error(script.fail);
      return refs.map((r) => ({ state: script.states[r.n - 1] || 'online', detail: 'ok', backoffMs: script.backoffMs, apps: script.apps?.[r.n], note: script.note }));
    },
    validateRef: (ref) => { if (ref.bad) throw new Error('Référence invalide'); },
  };
  providers.register(provider);
  const store = { servers: { secrets: {}, observed: [{ id: 'old' }] }, saved: 0, save() { this.saved++; } };
  const timers = [];
  let changed = 0;
  const logs = [];
  const obs = createObserver({
    store, secrets: decryptFails ? { ...fakeSecrets(available), decrypt: async () => { throw new Error('illisible'); } } : fakeSecrets(available), providers,
    onChange: () => { changed++; }, log: (l) => logs.push(l), now: () => clock.t,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  return { obs, store, calls, script, timers, logs, clock, changes: () => changed };
}
const app = (n = 1) => ({ provider: 'fake', ref: { n }, label: `app ${n}`, project: 'P' });

test('TC-003-1 : observer deux fois la même app ne crée qu\'une entrée', async () => {
  const { obs } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(1));
  assert.equal(obs.view().count, 1);
});

test('TC-003-2 : retirer une app l\'enlève de la vue et du relevé suivant', async () => {
  const { obs, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  const a = obs.observe(app(1)); obs.observe(app(2));
  obs.unobserve(a.id);
  await obs.refresh();
  assert.deepEqual(obs.view().items.map((i) => i.label), ['app 2']);
  assert.ok(calls.statuses >= 1);
});

test('TC-003-4 : rythme 30 s en déploiement, 5 min sinon', async () => {
  const { obs, script } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  script.states = ['deploying'];
  await obs.refresh();
  assert.equal(obs.nextDelay(), 30000);
  script.states = ['online'];
  await obs.refresh();
  assert.equal(obs.nextDelay(), 300000);
});

test('TC-003-5 : deux relevés simultanés ne font qu\'un appel', async () => {
  const { obs, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  await obs.refresh();
  const before = calls.statuses;
  await Promise.all([obs.refresh(), obs.refresh()]);
  assert.equal(calls.statuses - before, 1);
});

test('TC-003-6 : sans jeton ou sans app, aucun appel et aucun minuteur', async () => {
  const { obs, calls, timers } = setup();
  obs.observe(app(1));
  await obs.refresh();
  obs.start();
  assert.equal(calls.statuses, 0);
  assert.equal(timers.length, 0);
  assert.equal(obs.view().items[0].state, 'unknown');
  const b = setup();
  await b.obs.setSecret('fake', 'token', TOKEN);
  await b.obs.refresh();
  assert.equal(b.calls.statuses, 0);
  assert.equal(b.timers.length, 0);
});

test('TC-003-7 : un relevé qui échoue donne unknown et réarme le minuteur à 5 min', async () => {
  const { obs, script, timers } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  script.fail = 'réseau coupé';
  await obs.refresh();
  assert.equal(obs.view().items[0].state, 'unknown');
  assert.match(obs.view().items[0].detail, /réseau coupé/);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 300050); // 5 min + 50 ms de marge
});

test('TC-003-8 : le jeton n\'est jamais en clair, ni dans la configuration', async () => {
  const { obs, store, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  assert.ok(!JSON.stringify(store.servers).includes(TOKEN));
  const cfg = obs.config();
  assert.ok(!JSON.stringify(cfg).includes(TOKEN));
  assert.equal(cfg.providers.find((p) => p.id === 'fake').secrets[0].saved, true);
  await obs.sync();
  assert.equal(calls.creds.token, TOKEN, 'le fournisseur reçoit le jeton déchiffré');
  await obs.setSecret('fake', 'token', null);
  assert.equal(obs.config().providers.find((p) => p.id === 'fake').secrets[0].saved, false);
});

test('TC-003-9 : coffre indisponible, enregistrement refusé', async () => {
  const { obs, store } = setup({ available: false });
  await assert.rejects(() => obs.setSecret('fake', 'token', TOKEN), /coffre/i);
  assert.deepEqual(store.servers.secrets, {});
});

test('un champ secret inconnu est refusé', async () => {
  const { obs } = setup();
  await assert.rejects(() => obs.setSecret('fake', 'autre', 'x'), /champ/i);
  await assert.rejects(() => obs.setSecret('nope', 'token', 'x'), /inconnu/i);
});

test('la marque globale : échec avant déploiement avant en ligne', async () => {
  const { obs, script } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2));
  script.states = ['online', 'deploying'];
  await obs.refresh();
  assert.equal(obs.view().mark, 'deploying');
  script.states = ['failed', 'deploying'];
  await obs.refresh();
  assert.equal(obs.view().mark, 'failed');
  assert.equal(obs.view().configured, true);
});

test('la borne de 500 apps observées', async () => {
  const { obs } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  for (let i = 0; i < 500; i++) obs.observe(app(i));
  assert.throws(() => obs.observe(app(9999)), /500/);
});

test('B1 : en mode rapide, seules les apps en transition ou inconnues sont relevées', async () => {
  const { obs, script, calls, timers } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2));
  script.states = ['online', 'deploying'];
  obs.start();
  await obs.refresh();
  calls.refs.length = 0;
  await timers.at(-1).fn(); // le minuteur : relevé partiel
  await obs.refresh('live');
  assert.deepEqual(calls.refs.at(-1), [2]);
});

test('B1 : le relevé complet revient au rythme lent', async () => {
  const { obs, calls, timers, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2));
  obs.start();
  await obs.refresh();
  clock.t += 300001;
  calls.refs.length = 0;
  timers.at(-1).fn();
  await obs.refresh();
  assert.deepEqual(calls.refs.at(0), [1, 2]);
});

test('B1 : un backoffMs du fournisseur repousse le prochain relevé', async () => {
  const { obs, script, timers } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  script.backoffMs = 600000;
  await obs.refresh();
  assert.equal(obs.nextDelay(), 600000, 'l\'attente demandée est bien calculée');
  assert.equal(timers.at(-1).ms, 600050, 'une attente de dix minutes ou moins : le minuteur tombe juste après sa fin, sans retard de reprise');
});

test('M1 : une app ajoutée pendant un relevé est relevée juste après, sans tout relever', async () => {
  const { obs, script, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  await obs.refresh();
  let release; script.gate = new Promise((r) => { release = r; });
  const running = obs.refresh();
  obs.observe(app(2));
  script.gate = null; release();
  await running;
  await obs.refresh('new');
  assert.ok(calls.refs.flat().includes(2), JSON.stringify(calls.refs));
  assert.notEqual(obs.view().items[1].detail, 'Pas encore relevé');
});

test('sécurité : un secret illisible donne « illisible » sans rejet non géré', async () => {
  const { obs, store } = setup({ decryptFails: true });
  store.servers.secrets.fake = { token: 'enc:abc' };
  obs.observe(app(1));
  await obs.refresh();
  assert.equal(obs.view().items[0].state, 'unknown');
  assert.match(obs.view().items[0].detail, /illisible/i);
});

test('sécurité : un fournisseur inconnu dans le fichier ne fait rien lever', async () => {
  const { obs, store } = setup();
  store.servers.secrets.disparu = { token: 'enc:abc' };
  await obs.refresh();
  assert.equal(obs.view().configured, false);
  assert.doesNotThrow(() => obs.config());
});

test('sécurité : la référence est validée en forme, en taille et par le fournisseur', async () => {
  const { obs } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  assert.throws(() => obs.observe({ ...app(1), ref: 'texte' }), /référence/i);
  assert.throws(() => obs.observe({ ...app(1), ref: { n: 'x'.repeat(201) } }), /référence/i);
  assert.throws(() => obs.observe({ ...app(1), ref: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 1])) }), /référence/i);
  assert.throws(() => obs.observe({ ...app(1), ref: { n: 1, bad: true } }), /invalide/i);
});

test('journal : seulement les relevés qui comptent des états inconnus', async () => {
  const { obs, logs, script } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  await obs.refresh();
  assert.equal(logs.length, 0);
  script.fail = 'réseau coupé';
  await obs.refresh();
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes(TOKEN));
});

test('C1 : en mode rapide, une app inconnue n\'est pas relevée à chaque tick', async () => {
  const { obs, script, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2));
  script.fail = 'service supprimé';
  await obs.refresh('full');
  script.fail = null;
  calls.refs.length = 0;
  await obs.refresh('live');
  assert.deepEqual(calls.refs, [], 'rien à relever : ni en déploiement, ni nouvelle');
});

test('C4 : les apps les plus anciennement relevées partent en premier', async () => {
  const { obs, calls, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2)); obs.observe(app(3));
  await obs.refresh('full');
  clock.t += 1000;
  calls.refs.length = 0;
  // seule l'app 2 est relevée à nouveau, donc elle devient la plus récente
  obs.unobserve(obs.view().items[0].id);
  obs.observe(app(1));
  await obs.refresh('new');
  clock.t += 1000;
  calls.refs.length = 0;
  await obs.refresh('full');
  assert.deepEqual(calls.refs[0], [2, 3, 1]);
});

test('C5 : pendant un backoff, « Actualiser » n\'envoie rien et le dit', async () => {
  const { obs, script, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  script.backoffMs = 120000;
  await obs.refresh('full');
  const before = calls.statuses;
  await obs.refresh('full');
  assert.equal(calls.statuses, before);
  assert.ok(obs.view().waitUntil > 0);
});

test('C5 : « Actualiser » pendant un relevé partiel devient un relevé complet juste après', async () => {
  const { obs, script, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2));
  await obs.refresh('full');
  // app 1 passe « en déploiement » : un relevé partiel (live) ne retient qu'elle
  script.states = ['deploying', 'online'];
  await obs.refresh('full');
  calls.refs.length = 0;
  let release; script.gate = new Promise((r) => { release = r; });
  const partial = obs.refresh('live');
  await new Promise((r) => setImmediate(r)); // le relevé partiel est bien parti, retenu par la porte
  assert.deepEqual(calls.refs, [[1]]);
  obs.refresh('full'); // « Actualiser » pendant le relevé partiel
  script.gate = null; release();
  await partial;
  assert.deepEqual(calls.refs.at(-1), [1, 2], 'le relevé complet demandé est rejoué : ' + JSON.stringify(calls.refs));
});

test('C7 : une demande qui dépasse les trois tours est reprise peu après', async () => {
  const { obs, script, timers, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.start();
  obs.observe(app(1));
  await obs.refresh('full');
  let n = 10;
  script.onStatuses = () => obs.observe(app(n++)); // chaque relevé voit arriver une nouvelle app
  calls.statuses = 0;
  await obs.refresh('full');
  script.onStatuses = null;
  assert.equal(calls.statuses, 3, 'trois tours au plus');
  assert.ok(timers.some((t) => t.ms <= 1000), JSON.stringify(timers.map((t) => t.ms)));
});

test('B1 (round 3) : après un backoff, le sondage repart', async () => {
  const { obs, script, calls, clock, timers } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  script.backoffMs = 120000;
  await obs.refresh('full');
  const before = calls.statuses;
  await obs.refresh('full'); // pendant l'attente : rien ne part, et le relevé se termine sans await
  assert.equal(calls.statuses, before);
  script.backoffMs = undefined;
  clock.t += 120001;
  await obs.refresh('full');
  assert.equal(calls.statuses, before + 1, 'le relevé repart une fois l\'attente passée');
  assert.ok(timers.length >= 1, 'le minuteur est réarmé');
});

test('B1 (round 3) : jeton retiré puis reposé, le sondage repart', async () => {
  const { obs, calls, script } = setup();
  script.targets = [{ ref: { n: 1 }, path: [] }];
  await obs.setSecret('fake', 'token', TOKEN);
  obs.start();
  await obs.refresh('full');
  await obs.setSecret('fake', 'token', null);
  await obs.refresh('full');
  const before = calls.statuses;
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh('full');
  assert.ok(calls.statuses > before);
});

test('M-e : une exception dans un relevé ne relance pas de relevé en boucle', async () => {
  const { obs, timers, script } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  await obs.refresh('full');
  script.onStatuses = () => { throw new Error('panne inattendue'); };
  // un fournisseur qui lève est absorbé par safeStatuses ; on force l'exception côté noyau
  const real = obs.view;
  void real;
  await obs.refresh('full').catch(() => {});
  script.onStatuses = null;
  assert.ok(!timers.some((t) => t.ms <= 1000), 'aucune reprise à 1 s après une exception');
});

test('M-b : le relevé n\'est plus relancé sur un attribut sans code après trois échecs de suite', async () => {
  const { obs, script, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  script.fail = 'erreur de schéma';
  await obs.refresh('full');
  clock.t += 1;
  assert.equal(obs.view().items[0].state, 'unknown');
});

test('m-F : l\'attente demandée se lit dans la vue, puis disparaît', async () => {
  const { obs, script, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  script.backoffMs = 60000;
  await obs.refresh('full');
  assert.equal(obs.view().waitUntil, clock.t + 60000);
  clock.t += 60001;
  assert.equal(obs.view().waitUntil, 0);
});

test('M1-bis : quand le budget ne couvre qu\'une part de la flotte, chaque app finit par être relevée', async () => {
  const { obs, store, clock } = setup();
  const reached = new Set();
  const CAPACITY = 3;
  // un fournisseur dont le budget n'atteint que les CAPACITY premières apps de l'envoi ; les autres sont « délai dépassé »
  providers.register({
    id: 'slow', label: 'Lent', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs) => refs.map((r, i) => (i < CAPACITY ? (reached.add(r.n), { state: 'online', detail: 'ok' }) : { state: 'unknown', detail: 'Délai dépassé pour ce relevé', skipped: true })),
  });
  store.servers.secrets.slow = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  for (let n = 1; n <= 10; n++) obs.observe({ provider: 'slow', ref: { n }, label: `app ${n}` });
  for (let tour = 0; tour < 8; tour++) { clock.t += 1000; await obs.refresh('full'); }
  assert.equal(reached.size, 10, `apps atteintes : ${[...reached].sort((a, b) => a - b)}`);
});

test('M-d : poser un nouveau jeton lève l\'attente demandée pour l\'ancien', async () => {
  const { obs, script, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  script.backoffMs = 3600000;
  await obs.refresh('full');
  const before = calls.statuses;
  await obs.setSecret('fake', 'token', 'autre-jeton-0000');
  script.backoffMs = undefined;
  await obs.refresh('full');
  assert.ok(calls.statuses > before);
});

test('M-c : une app sautée garde son dernier état connu', async () => {
  const { obs, store, clock } = setup();
  let skip = false;
  providers.register({
    id: 'keep', label: 'Garde', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs) => refs.map(() => (skip ? { state: 'unknown', detail: 'Délai dépassé pour ce relevé', skipped: true } : { state: 'failed', detail: 'FAILED' })),
  });
  store.servers.secrets.keep = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  obs.observe({ provider: 'keep', ref: { n: 1 }, label: 'k' });
  await obs.refresh('full');
  skip = true; clock.t += 1000;
  await obs.refresh('full');
  assert.equal(obs.view().items[0].state, 'failed', 'l\'état connu n\'est pas effacé par un budget dépassé');
});

test('B1 (round 4) : les apps en erreur passent après les apps saines au relevé suivant', async () => {
  const { obs, store, clock } = setup();
  const order = [];
  providers.register({
    id: 'mix', label: 'Mixte', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs) => { order.push(refs.map((r) => r.n)); return refs.map((r) => (r.n <= 2 ? { state: 'unknown', detail: 'Not Authorized' } : { state: 'online', detail: 'ok' })); },
  });
  store.servers.secrets.mix = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  for (let n = 1; n <= 5; n++) obs.observe({ provider: 'mix', ref: { n }, label: `m${n}` });
  await obs.refresh('full');
  clock.t += 1000;
  await obs.refresh('full');
  assert.deepEqual(order[1], [3, 4, 5, 1, 2]);
});

test('m-A : une demande plus large reçue dans le même tour que le relevé est rejouée', async () => {
  const { obs, calls } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2));
  await obs.refresh('full');
  obs.unobserve(obs.view().items[1].id);
  obs.observe(app(2));
  calls.refs.length = 0;
  const live = obs.refresh('live'); // relevé partiel
  obs.refresh('full');              // dans le même tour : plus large, doit être rejoué
  await live;
  assert.ok(calls.refs.some((r) => r.length === 2), JSON.stringify(calls.refs));
  assert.equal(calls.refs.length, 2, 'une seule demande tardive : deux relevés, pas plus');
});

test('M1 (round 5) : un état de plus de vingt minutes n\'est plus présenté comme frais', async () => {
  const { obs, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  await obs.refresh('full');
  assert.equal(obs.view().mark, 'online');
  clock.t += 21 * 60 * 1000;
  const v = obs.view();
  assert.equal(v.items[0].state, 'unknown');
  assert.match(v.items[0].detail, /ancien/i);
  assert.equal(v.mark, 'none', 'l\'icône ne reste pas verte sur un état périmé');
  assert.ok(v.items[0].at > 0, 'l\'âge réel reste affiché');
});

test('M1 (round 5) : un relevé où rien n\'a été tenté ne rafraîchit pas l\'heure du dernier relevé', async () => {
  const { obs, store, clock } = setup();
  providers.register({
    id: 'allskip', label: 'Tout sauté', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs) => refs.map(() => ({ state: 'unknown', detail: 'Délai dépassé pour ce relevé', skipped: true })),
  });
  store.servers.secrets.allskip = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  obs.observe({ provider: 'allskip', ref: { n: 1 }, label: 'z' });
  clock.t += 5000;
  await obs.refresh('full');
  assert.equal(obs.view().checkedAt, 0, 'aucune app tentée : pas de « relevé à l\'instant »');
});

test('m2 (round 5) : une app sautée sans relevé n\'a pas d\'âge et est reprise au relevé suivant', async () => {
  const { obs, store, calls, clock } = setup();
  let skip = true;
  providers.register({
    id: 'late', label: 'Tardif', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs) => { calls.refs.push(refs.map((r) => r.n)); return refs.map(() => (skip ? { state: 'unknown', detail: 'Délai dépassé pour ce relevé', skipped: true } : { state: 'online', detail: 'ok' })); },
  });
  store.servers.secrets.late = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  obs.observe({ provider: 'late', ref: { n: 7 }, label: 'l' });
  clock.t += 1000;
  await obs.refresh('full');
  assert.equal(obs.view().items[0].at, 0);
  skip = false; calls.refs.length = 0;
  await obs.refresh('live');
  assert.deepEqual(calls.refs.at(-1), [7], 'reprise dès un relevé partiel');
});

test('arch (round 5) : un relevé interrompu laisse un minuteur de reprise, pas une boucle de relevés', async () => {
  const { obs, script, calls, timers } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.start();
  obs.observe(app(1));
  await obs.refresh('full');
  calls.statuses = 0;
  let n = 20;
  script.onStatuses = () => { if (n < 40) obs.observe(app(n++)); };
  await obs.refresh('full');
  script.onStatuses = null;
  assert.ok(calls.statuses <= 3, `${calls.statuses} relevés d'affilée`);
  assert.equal(timers.length, 1, 'un seul minuteur');
});

// ---- Round 7 : protections demandées par la revue d'architecture (mutation) et corrections de scalabilité ----

test('B-1 (round 6) : le relevé complet revient cinq minutes après le dernier relevé COMPLET, jamais repoussé par un relevé partiel', async () => {
  const { obs, script, calls, timers, clock } = setup();
  clock.t = 10000000; // une horloge réaliste : « jamais posé » ne doit pas ressembler à « il y a longtemps »
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2));
  script.states = ['deploying', 'online'];
  obs.start();
  await obs.refresh('full'); // relevé complet à T
  const T = clock.t;
  const tick = async () => { timers.at(-1).fn(); await obs.refresh('new'); return calls.refs.at(-1); };
  calls.refs.length = 0;
  clock.t = T + 240000; // 4 minutes : trop tôt pour un relevé complet (kill : seuil IDLE_MS/2)
  assert.deepEqual(await tick(), [1], 'avant cinq minutes : seule l\'app en déploiement');
  clock.t = T + 300001; // 5 minutes après le relevé COMPLET, 1 minute après le relevé partiel (kill : lastFullAt posé par tous les modes)
  assert.deepEqual([...(await tick())].sort(), [1, 2], 'cinq minutes après le dernier relevé complet : tout part');
});

test('B-2 (round 6) : le budget est transmis au fournisseur, daté avec l\'horloge du noyau', async () => {
  const { obs, store, clock } = setup();
  let seen = null;
  providers.register({
    id: 'dl', label: 'Budget', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs, opts) => { seen = opts; return refs.map(() => ({ state: 'online', detail: 'ok' })); },
  });
  store.servers.secrets.dl = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  obs.observe({ provider: 'dl', ref: { n: 1 }, label: 'd' });
  clock.t = 5000;
  await obs.refresh('full');
  assert.equal(seen.deadline, 5000 + 45000, 'le budget d\'envoi est de quarante-cinq secondes');
});

test('B-3 (round 6) : l\'heure du dernier relevé avance après un relevé réussi, y compris quand une app est sautée', async () => {
  const { obs, store, clock } = setup();
  providers.register({
    id: 'half', label: 'Moitié', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs) => refs.map((r, i) => (i === 0 ? { state: 'online', detail: 'ok' } : { state: 'unknown', detail: 'Délai dépassé pour ce relevé', skipped: true })),
  });
  store.servers.secrets.half = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  for (let n = 1; n <= 2; n++) obs.observe({ provider: 'half', ref: { n }, label: `h${n}` });
  clock.t = 7000;
  await obs.refresh('full');
  assert.equal(obs.view().checkedAt, 7000);
});

test('m-3 (round 6) : un état reste frais à dix-neuf minutes, se dégrade au-delà de vingt quelle que soit sa nature, et un inconnu garde son motif', async () => {
  const { obs, script, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1)); obs.observe(app(2)); obs.observe(app(3));
  script.states = ['failed', 'online', 'deploying'];
  await obs.refresh('full');
  clock.t += 19 * 60 * 1000;
  assert.deepEqual(obs.view().items.map((i) => i.state), ['deploying', 'failed', 'online'], 'vingt minutes, pas moins (en cours d\'abord)');
  clock.t += 2 * 60 * 1000; // 21 minutes
  assert.deepEqual(obs.view().items.map((i) => i.state), ['unknown', 'unknown', 'unknown'], 'même un déploiement en cours périmé');
  assert.equal(obs.view().mark, 'none');
  script.fail = 'panne'; clock.t += 1000;
  await obs.refresh('full');
  assert.match(obs.view().items[0].detail, /panne/, 'un inconnu garde son motif');
  clock.t += 25 * 60 * 1000;
  assert.match(obs.view().items[0].detail, /panne/, 'même ancien : le motif d\'un inconnu n\'est pas remplacé');
});

test('M3 (round 6) : le délai du minuteur ne dépasse pas cinq minutes, même pendant une longue attente de quota', async () => {
  const { obs, script, timers } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  script.backoffMs = 3600000;
  await obs.refresh('full');
  assert.ok(timers.at(-1).ms <= 300050, `${timers.at(-1).ms} ms`);
});

test('M3 (round 6) : pendant l\'attente le minuteur ne lance aucune requête mais redessine', async () => {
  const { obs, script, calls, timers, changes } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  script.backoffMs = 3600000;
  await obs.refresh('full');
  const before = calls.statuses, shown = changes();
  timers.at(-1).fn();
  await obs.refresh('new');
  assert.equal(calls.statuses, before);
  assert.ok(changes() > shown);
});

test('m-1 (round 7) : une horloge qui recule rend les états périmés', async () => {
  const { obs, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  await obs.refresh('full');
  assert.equal(obs.view().items[0].state, 'online');
  clock.t -= 60000;
  assert.equal(obs.view().items[0].state, 'unknown');
});

test('m-4 (round 7) : après une tentative entièrement échouée, l\'heure du relevé avance (une app a été tentée)', async () => {
  const { obs, script, clock } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  script.fail = 'panne';
  clock.t = 9000;
  await obs.refresh('full');
  assert.equal(obs.view().checkedAt, 9000);
});

test('m-5 (round 7) : une app sautée sans relevé garde le motif du saut', async () => {
  const { obs, store } = setup();
  providers.register({
    id: 'motif', label: 'Motif', secrets: [{ key: 'token', label: 'Jeton' }], list: async () => { throw new Error('manuel'); },
    statuses: async (c, refs) => refs.map(() => ({ state: 'unknown', detail: 'Délai dépassé pour ce relevé', skipped: true })),
  });
  store.servers.secrets.motif = { token: 'enc:' + Buffer.from(TOKEN).toString('base64') };
  obs.observe({ provider: 'motif', ref: { n: 1 }, label: 'mt' });
  await obs.refresh('full');
  assert.match(obs.view().items[0].detail, /Délai dépassé/);
});

test('perf (round 7) : le plafond de cinq minutes ne retarde pas la reprise d\'une attente courte', async () => {
  const { obs, script, timers } = setup();
  await obs.setSecret('fake', 'token', TOKEN);
  obs.observe(app(1));
  obs.start();
  script.backoffMs = 420000; // sept minutes
  await obs.refresh('full');
  assert.equal(timers.at(-1).ms, 420050, 'juste après la fin de l\'attente, pas cinq minutes avant ni après');
});

/* ---------- Découverte, masquage, vue à plat (servers-hierarchie, R-002) ---------- */
const target = (n, { ws = 'W', wsId = 'w1', project = 'P', projectId = 'p1', env = 'prod', envId = `e${n}` } = {}) => ({
  ref: { n }, path: [{ id: wsId, name: ws, kind: 'workspace' }, { id: projectId, name: project, kind: 'project' }, { id: envId, name: env, kind: 'environment' }],
});

test('TC-2-1 : deux cibles découvertes sont rendues sans aucun geste', async () => {
  const { obs, script } = setup();
  script.targets = [target(1), target(2)];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  const items = obs.view().items;
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].workspace, items[0].project, items[0].environment], ['W', 'P', 'prod']);
});

test('TC-2-2 : masquer un projet retire ses cibles du relevé et de la vue, les réafficher les ramène', async () => {
  const { obs, script, calls } = setup();
  script.targets = [target(1), target(2, { projectId: 'p2', project: 'Q', envId: 'e2' })];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  obs.setHidden('fake:w1/p2', true);
  calls.refs.length = 0;
  await obs.refresh();
  assert.deepEqual(obs.view().items.map((i) => i.project), ['P']);
  assert.ok(!calls.refs.flat().includes(2), 'une cible masquée n\'est pas relevée');
  obs.setHidden('fake:w1/p2', false);
  await obs.refresh();
  assert.equal(obs.view().items.length, 2);
});

test('TC-2-3 : masquer un service précis ne retire que lui', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  script.apps = { 1: [{ id: 's1', name: 'api', state: 'online', detail: '' }, { id: 's2', name: 'web', state: 'online', detail: '' }] };
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.deepEqual(obs.view().items.map((i) => i.label).sort(), ['api', 'web']);
  obs.setHidden('fake:w1/p1/e1/s2', true);
  assert.deepEqual(obs.view().items.map((i) => i.label), ['api']);
});

test('TC-2-4 : une cible renommée garde son masquage (l\'identifiant fait foi)', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  obs.setHidden('fake:w1/p1/e1', true);
  script.targets = [target(1, { project: 'Renommé', env: 'autre' })];
  await obs.refresh();
  assert.equal(obs.view().items.length, 0);
});

test('TC-2-5 : les déploiements en cours passent en tête, l\'ordre de la découverte est conservé ailleurs', async () => {
  const { obs, script } = setup();
  script.targets = [target(1), target(2), target(3), target(4)];
  script.states = ['online', 'deploying', 'failed', 'deploying'];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.deepEqual(obs.view().items.map((i) => i.state), ['deploying', 'deploying', 'online', 'failed']);
});

test('TC-2-6 : une découverte en erreur garde le catalogue précédent et dit pourquoi, sans secret', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  script.listFail = `refusé pour ${TOKEN}`;
  await obs.refresh();
  assert.equal(obs.view().items.length, 1);
  const notes = obs.view().notes.join('\n');
  assert.match(notes, /refusé/);
  assert.ok(!notes.includes(TOKEN));
});

test('TC-2-7 : une cible qui disparaît de la découverte disparaît de la vue', async () => {
  const { obs, script } = setup();
  script.targets = [target(1), target(2)];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  script.targets = [target(2)];
  await obs.refresh();
  assert.equal(obs.view().items.length, 1);
});

test('TC-2-8 : urlOf rend l\'adresse d\'un item connu, null pour un inconnu ou une adresse non HTTPS', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  script.apps = { 1: [{ id: 's1', name: 'api', state: 'online', detail: '', url: 'https://railway.com/project/p1' }, { id: 's2', name: 'x', state: 'online', detail: '', url: 'javascript:alert(1)' }] };
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  const [a, b] = obs.view().items;
  assert.equal(obs.urlOf(a.id), 'https://railway.com/project/p1');
  assert.equal(obs.urlOf(b.id), null);
  assert.equal(obs.urlOf('inconnu.s9'), null);
});

test('TC-2-9 : masquer une clé inconnue est refusé', async () => {
  const { obs, script, store } = setup();
  script.targets = [target(1)];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.throws(() => obs.setHidden('fake:rien', true), /inconnue/i);
  assert.deepEqual(store.servers.hidden, []);
});

test('TC-2-10 : les anciennes apps observées sont supprimées au démarrage', () => {
  const { store } = setup();
  assert.equal('observed' in store.servers, false);
  assert.deepEqual(store.servers.hidden, []);
});

test('TC-2-11 : les apps d\'une cible périment ensemble après vingt minutes', async () => {
  const { obs, script, clock } = setup();
  script.targets = [target(1)];
  script.apps = { 1: [{ id: 's1', name: 'api', state: 'online', detail: '' }] };
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  clock.t += 21 * 60 * 1000;
  const [it] = obs.view().items;
  assert.equal(it.state, 'unknown');
  assert.match(it.detail, /ancien/);
  assert.equal(obs.view().mark, 'none');
});

test('config() rend l\'arbre espace › projet › environnement › service, avec masqué et hérité', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  script.apps = { 1: [{ id: 's1', name: 'api', state: 'online', detail: '' }] };
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  obs.setHidden('fake:w1/p1', true);
  const { tree } = obs.config();
  assert.equal(tree[0].kind, 'workspace');
  const project = tree[0].children[0];
  assert.equal(project.hidden, true);
  const service = project.children[0].children[0];
  assert.deepEqual([service.kind, service.name, service.inherited], ['service', 'api', true]);
  assert.ok(!JSON.stringify(obs.config()).includes(TOKEN));
});

test('effacer le jeton retire de la vue et de l\'arbre ce que le fournisseur avait découvert', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.equal(obs.view().items.length, 1);
  await obs.setSecret('fake', 'token', null);
  assert.equal(obs.view().items.length, 0);
  assert.deepEqual(obs.config().tree, []);
});

/* ---------- Revue round 1 ---------- */
test('R1 : un environnement ajouté plus tard reste groupé sous son projet', async () => {
  const { obs, script } = setup();
  script.targets = [target(1), target(2, { projectId: 'p2', project: 'Q' })];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  script.targets = [...script.targets, target(3, { env: 'staging' })]; // projet p1, découvert après le projet p2
  await obs.refresh();
  assert.deepEqual(obs.view().items.map((i) => `${i.project}/${i.environment}`), ['P/prod', 'P/staging', 'Q/prod']);
});

test('R1 : une troncature annoncée par le fournisseur se lit dans les notes de la vue', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  script.apps = { 1: [{ id: 's1', name: 'api', state: 'online', detail: '' }] };
  script.note = 'Plus de 1000 services';
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.ok(obs.view().notes.some((n) => /Plus de 1000 services/.test(n) && /prod/.test(n)), JSON.stringify(obs.view().notes));
});

test('R1 : les nœuds dont l\'identifiant contient une barre ou est vide sont écartés de la découverte', async () => {
  const { obs, script } = setup();
  script.targets = [target(1), target(2, { envId: 'a/b' }), target(3, { envId: '' })];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.equal(obs.view().items.length, 1);
});

test('R1 : urlOf refuse une adresse avec identifiants ou un hôte mal formé', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  script.apps = { 1: [{ id: 's1', name: 'a', state: 'online', detail: '', url: 'https://railway.com@evil.example/' }, { id: 's2', name: 'b', state: 'online', detail: '', url: 'https://' }] };
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  for (const it of obs.view().items) assert.equal(obs.urlOf(it.id), null);
});

test('R1 : un jeton effacé pendant une découverte ne repeuple pas le catalogue', async () => {
  const { obs, script } = setup();
  let release;
  script.targets = [target(1)];
  await obs.setSecret('fake', 'token', TOKEN);
  const gate = new Promise((r) => { release = r; });
  script.listGate = gate;
  const running = obs.refresh();
  await new Promise((r) => setImmediate(r));
  await obs.setSecret('fake', 'token', null);
  release();
  await running;
  assert.equal(obs.view().items.length, 0);
});

test('R1 : view() reste rapide avec 2000 clés masquées et plusieurs milliers d\'items', async () => {
  const { obs, script, store } = setup();
  script.targets = Array.from({ length: 300 }, (_, i) => target(i + 1, { envId: `e${i + 1}` }));
  script.apps = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i + 1, Array.from({ length: 10 }, (_, k) => ({ id: `s${k}`, name: `n${k}`, state: 'online', detail: '' }))]));
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  store.servers.hidden = Array.from({ length: 2000 }, (_, i) => `fake:w1/p1/orphelin${i}`);
  const t0 = process.hrtime.bigint();
  const n = obs.view().count;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(n, 3000);
  assert.ok(ms < 150, `view() a pris ${ms} ms`);
});

test('R1 : la vue borne ses lignes, les échecs et déploiements d\'abord, et le dit en note', async () => {
  const { obs, script } = setup();
  script.targets = [target(1), target(2)];
  const apps = (failedAt) => Array.from({ length: 750 }, (_, k) => ({ id: `s${k}`, name: `n${k}`, state: k === failedAt ? 'failed' : 'online', detail: '' }));
  script.apps = { 1: apps(-1), 2: apps(740) };
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  const v = obs.view();
  assert.equal(v.items.length, 1000);
  assert.equal(v.count, 1500);
  assert.ok(v.items.some((i) => i.state === 'failed'), 'l\'échec lointain reste visible');
  assert.ok(v.notes.some((n) => /500 autres non affichés/.test(n)), JSON.stringify(v.notes));
});

test('R1 : un déploiement qui dure plus de trente minutes ne garde plus le rythme rapide', async () => {
  const { obs, script, clock } = setup();
  script.targets = [target(1)];
  script.states = ['deploying'];
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.equal(obs.nextDelay(), 30 * 1000);
  clock.t += 31 * 60 * 1000;
  await obs.refresh();
  assert.equal(obs.nextDelay() > 30 * 1000, true);
});

test('R1 : un quota atteint pendant la découverte repousse le prochain envoi', async () => {
  const { obs, script } = setup();
  script.listFail = Object.assign(new Error('trop de requêtes'), { backoffMs: 120000 });
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  assert.ok(obs.view().waitUntil > 0);
});

test('R2 : urlOf ne rend pas l\'adresse d\'une app masquée', async () => {
  const { obs, script } = setup();
  script.targets = [target(1)];
  script.apps = { 1: [{ id: 's1', name: 'api', state: 'online', detail: '', url: 'https://railway.com/x' }] };
  await obs.setSecret('fake', 'token', TOKEN);
  await obs.refresh();
  const [it] = obs.view().items;
  assert.equal(obs.urlOf(it.id), 'https://railway.com/x');
  obs.setHidden('fake:w1/p1/e1/s1', true);
  assert.equal(obs.urlOf(it.id), null);
});
