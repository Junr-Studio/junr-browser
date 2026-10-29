'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRailway, ENDPOINT, QUERIES } = require('../../src/servers/railway');

const TOKEN = 'tok-SECRET-9';
const creds = { token: TOKEN };

// Faux fetch : répond selon l'opération reconnue dans le texte de la requête.
function fakeFetch(handlers, { status = 200, retryAfter = null } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const key = Object.keys(handlers).find((k) => body.query.includes(k));
    const data = key ? await handlers[key](body.variables) : {};
    const payload = data && data.__errors ? { errors: data.__errors } : { data };
    const text = JSON.stringify(payload);
    return { ok: status >= 200 && status < 300, status, headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? retryAfter : k.toLowerCase() === 'content-length' ? (data && data.__bigHeader ? '9000000' : null) : null) }, text: async () => (data && data.__huge ? 'x'.repeat(5000001) : text), json: async () => payload };
  };
  f.calls = calls;
  return f;
}
const edges = (nodes) => ({ edges: nodes.map((node) => ({ node })) });
const deployments = (statuses) => ({ deployments: edges(statuses.map((status, i) => ({ id: `d${i}`, status, createdAt: '2026-01-01T00:00:00Z' }))) });
const ref = { projectId: 'p', environmentId: 'e', serviceId: 's' };
const stateFor = async (statuses) => {
  const r = createRailway({ fetch: fakeFetch({ deployments: () => deployments(statuses) }) });
  return (await r.statuses(creds, [ref]))[0];
};

test('TC-002-1 : SUCCESS donne online', async () => assert.equal((await stateFor(['SUCCESS'])).state, 'online'));

test('TC-002-2 : les états transitoires donnent deploying', async () => {
  for (const s of ['BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED', 'WAITING', 'NEEDS_APPROVAL']) assert.equal((await stateFor([s])).state, 'deploying', s);
});

test('TC-002-3 : FAILED et CRASHED donnent failed', async () => {
  for (const s of ['FAILED', 'CRASHED']) assert.equal((await stateFor([s])).state, 'failed', s);
});

test('TC-002-4 : REMOVED, REMOVING, SKIPPED sont ignorés', async () => {
  assert.equal((await stateFor(['REMOVED', 'SUCCESS'])).state, 'online');
  assert.equal((await stateFor(['SKIPPED', 'REMOVING', 'FAILED'])).state, 'failed');
  assert.equal((await stateFor(['SKIPPED'])).state, 'unknown');
  assert.equal((await stateFor([])).state, 'unknown');
  assert.equal((await stateFor(['MYSTERY'])).state, 'unknown');
});

test('TC-002-5 : parcours espaces, projets, apps ; liste tronquée à 200 projets', async () => {
  const projects = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, name: `Projet ${i}`, environments: edges([{ id: 'e1', name: 'production' }]), services: edges([{ id: 's1', name: 'api' }]) }));
  const r = createRailway({ fetch: fakeFetch({ 'me {': () => ({ me: { workspaces: [{ id: 'w1', name: 'Acme' }] } }), 'projects(': () => ({ projects: edges(projects) }) }) });
  assert.deepEqual(await r.browse(creds, []), [{ id: 'w1', name: 'Acme' }]);
  const list = await r.browse(creds, ['w1']);
  assert.equal(list.length, 201);
  assert.equal(list[200].truncated, true);
  const apps = await r.browse(creds, ['w1', 'p0']);
  assert.deepEqual(apps, [{ id: 's1:e1', name: 'api (production)', app: { ref: { projectId: 'p0', environmentId: 'e1', serviceId: 's1' }, label: 'api (production)', project: 'Projet 0' } }]);
});

test('TC-002-6 : jeton refusé, message sans le jeton', async () => {
  const r = createRailway({ fetch: fakeFetch({}, { status: 401 }) });
  await assert.rejects(() => r.browse(creds, []), (e) => /jeton refusé/.test(e.message) && !e.message.includes(TOKEN));
});

test('TC-002-7 : erreur GraphQL ou réseau donne unknown avec le motif', async () => {
  const gqlErr = createRailway({ fetch: fakeFetch({ deployments: () => ({ __errors: [{ message: 'Problem processing request' }] }) }) });
  const a = (await gqlErr.statuses(creds, [ref]))[0];
  assert.equal(a.state, 'unknown');
  assert.match(a.detail, /Problem processing request/);
  const net = createRailway({ fetch: async () => { throw new Error('ECONNRESET'); } });
  const b = (await net.statuses(creds, [ref]))[0];
  assert.equal(b.state, 'unknown');
  assert.match(b.detail, /ECONNRESET/);
});

test('TC-002-8 : seules les requêtes figées partent, vers l\'adresse officielle', async () => {
  const f = fakeFetch({ 'me {': () => ({ me: { workspaces: [] } }) });
  const r = createRailway({ fetch: f });
  await r.browse(creds, []);
  assert.equal(f.calls[0].url, ENDPOINT);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(Object.values(QUERIES).includes(f.calls[0].body.query));
  assert.ok(Object.isFrozen(QUERIES));
  await assert.rejects(() => r._gql('nope', {}, creds), /requête inconnue/i);
  await assert.rejects(() => createRailway({ fetch: f }).browse({}, []), /jeton/i);
  assert.throws(() => createRailway({ fetch: f, endpoint: 'http://backboard.railway.com/graphql/v2' }), /HTTPS/);
  assert.equal(f.calls.length, 1, 'aucune requête refusée n\'est partie');
});

test('TC-002-8b : une requête qui contient mutation ou subscription est refusée avant envoi', async () => {
  const f = fakeFetch({});
  const r = createRailway({ fetch: f });
  for (const q of ['mutation { serviceDelete(id: "x") }', 'query { a } subscription { b }', 'MUTATION{x}']) {
    assert.throws(() => r._assertReadOnly(q), /lecture seule/i, q);
  }
  assert.equal(f.calls.length, 0);
});

test('TC-002-9 : le source du fournisseur ne contient aucune écriture hors de la garde', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'servers', 'railway.js'), 'utf8');
  const withoutGuard = src.split('\n').filter((l) => !l.includes('lecture seule') && !/\/\^?\\?b?\(?mutation/i.test(l) && !l.trim().startsWith('//')).join('\n');
  assert.ok(!/\b(mutation|subscription)\b/i.test(withoutGuard.replace(/GARDE_LECTURE[^\n]*\n/g, '')));
  for (const q of Object.values(QUERIES)) assert.match(q.trim(), /^query\b/);
});

test('TC-002-10 : un message d\'erreur ne contient jamais le jeton', async () => {
  const f = fakeFetch({ 'me {': () => ({ __errors: [{ message: `Invalid token ${TOKEN}` }] }) });
  const r = createRailway({ fetch: f });
  await assert.rejects(() => r.browse(creds, []), (e) => !e.message.includes(TOKEN));
});

test('B1 : un 429 coupe le relevé, repousse le prochain de Retry-After et n\'envoie plus rien', async () => {
  const f = fakeFetch({}, { status: 429, retryAfter: '30' });
  const r = createRailway({ fetch: f });
  const out = await r.statuses(creds, [ref, ref, ref, ref, ref, ref]);
  assert.equal(f.calls.length, 4, 'seules les requêtes déjà parties (4 en parallèle) ont été envoyées');
  assert.ok(out.every((o) => o.state === 'unknown' && o.backoffMs === 30000), JSON.stringify(out));
  assert.match(out[5].detail, /trop de requêtes/i);
});

test('B1 : un 429 sans Retry-After repousse d\'une minute', async () => {
  const r = createRailway({ fetch: fakeFetch({}, { status: 429 }) });
  assert.equal((await r.statuses(creds, [ref]))[0].backoffMs, 60000);
});

test('B1 : un jeton refusé coupe le relevé aussi', async () => {
  const f = fakeFetch({}, { status: 401 });
  const out = await createRailway({ fetch: f }).statuses(creds, Array(10).fill(ref));
  assert.ok(f.calls.length <= 4);
  assert.ok(out.every((o) => o.state === 'unknown' && /jeton refusé/.test(o.detail)));
});

test('M2 : au-delà du budget de temps, les apps restantes sont inconnues sans requête', async () => {
  const f = fakeFetch({ deployments: () => deployments(['SUCCESS']) });
  const out = await createRailway({ fetch: f }).statuses(creds, [ref, ref], { deadline: Date.now() - 1 });
  assert.equal(f.calls.length, 0);
  assert.ok(out.every((o) => o.state === 'unknown' && /délai/i.test(o.detail)));
});

test('M4 : la liste des projets d\'un espace n\'est demandée qu\'une fois par minute', async () => {
  const projects = [{ id: 'p0', name: 'P', environments: edges([{ id: 'e1', name: 'prod' }]), services: edges([{ id: 's1', name: 'api' }]) }];
  const f = fakeFetch({ 'projects(': () => ({ projects: edges(projects) }) });
  const r = createRailway({ fetch: f });
  await r.browse(creds, ['w1']); await r.browse(creds, ['w1', 'p0']); await r.browse(creds, ['w1', 'p0']);
  assert.equal(f.calls.length, 1);
});

test('M5 : pas de redirection suivie, réponse trop volumineuse refusée', async () => {
  const f = fakeFetch({ 'me {': () => ({ me: { workspaces: [] } }) });
  await createRailway({ fetch: f }).browse(creds, []);
  assert.equal(f.calls[0].init.redirect, 'error');
  const huge = createRailway({ fetch: fakeFetch({ 'me {': () => ({ __huge: true }) }) });
  await assert.rejects(() => huge.browse(creds, []), /volumineuse/i);
});

test('une référence d\'app doit porter les trois identifiants', () => {
  const r = createRailway({ fetch: fakeFetch({}) });
  assert.doesNotThrow(() => r.validateRef(ref));
  assert.throws(() => r.validateRef({ projectId: 'p' }), /référence/i);
});

test('C2 : un seul délai dépassé ne coupe pas le relevé', async () => {
  let n = 0;
  const f = async (url, init) => {
    n++;
    if (n === 2) { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }
    const payload = { data: deployments(['SUCCESS']) };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
  };
  const out = await createRailway({ fetch: f }).statuses(creds, Array(8).fill(ref));
  assert.equal(n, 8, 'tous les envois ont eu lieu');
  assert.equal(out.filter((o) => o.state === 'online').length, 7);
  assert.match(out.find((o) => o.state === 'unknown').detail, /délai/);
});

test('C2 : trois échecs consécutifs (délai ou 5xx) coupent le relevé', async () => {
  const f = fakeFetch({}, { status: 503 });
  const out = await createRailway({ fetch: f }).statuses(creds, Array(20).fill(ref));
  assert.ok(f.calls.length < 20, `${f.calls.length} requêtes`);
  assert.ok(out.every((o) => o.state === 'unknown'));
  assert.ok(out.some((o) => o.skipped === true), 'les apps non tentées sont sautées, pas écrasées');
});

test('C2 : des échecs isolés entre deux succès ne coupent pas le relevé', async () => {
  let n = 0;
  const f = async () => {
    n++;
    if (n % 3 === 0) return { ok: false, status: 502, headers: { get: () => null }, text: async () => '{}' };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: deployments(['SUCCESS']) }) };
  };
  await createRailway({ fetch: f }).statuses(creds, Array(12).fill(ref));
  assert.equal(n, 12, 'un échec isolé de temps en temps ne coupe jamais le relevé');
});

test('sécurité : une réponse annonçant plus de 5 Mo est refusée sans être lue', async () => {
  let read = false;
  const f = async () => ({ ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-length' ? '9000000' : null) }, text: async () => { read = true; return '{}'; } });
  await assert.rejects(() => createRailway({ fetch: f }).browse(creds, []), /volumineuse/i);
  assert.equal(read, false);
});

test('sécurité : le cache des projets ne garde jamais le jeton en clair', async () => {
  const f = fakeFetch({ 'projects(': () => ({ projects: edges([]) }) });
  const r = createRailway({ fetch: f });
  await r.browse(creds, ['w1']);
  assert.ok(r._cacheKeys().length === 1 && r._cacheKeys().every((k) => !k.includes(TOKEN)));
});

test('C8 : deux dépliages simultanés ne font qu\'une requête', async () => {
  const f = fakeFetch({ 'projects(': () => ({ projects: edges([]) }) });
  const r = createRailway({ fetch: f });
  await Promise.all([r.browse(creds, ['w1']), r.browse(creds, ['w1'])]);
  assert.equal(f.calls.length, 1);
});

test('M-b : des erreurs GraphQL répétées coupent aussi le relevé', async () => {
  const f = fakeFetch({ deployments: () => ({ __errors: [{ message: 'Cannot query field' }] }) });
  const out = await createRailway({ fetch: f }).statuses(creds, Array(30).fill(ref));
  assert.ok(f.calls.length < 30, `${f.calls.length} requêtes envoyées`);
  assert.ok(out.every((o) => o.state === 'unknown'));
});

test('sécurité : une réponse sans content-length est lue par morceaux et abandonnée au-delà de la limite', async () => {
  let chunks = 0, cancelled = false;
  const body = { getReader: () => ({ read: async () => { chunks++; return { done: false, value: new Uint8Array(1000 * 1000) }; }, cancel: async () => { cancelled = true; } }) };
  const f = async () => ({ ok: true, status: 200, headers: { get: () => null }, body });
  await assert.rejects(() => createRailway({ fetch: f }).browse(creds, []), /volumineuse/i);
  assert.ok(cancelled && chunks <= 7, `${chunks} morceaux lus`);
});

test('sécurité : un JSON invalide ne cite pas le début de la réponse', async () => {
  const f = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => `<html>${TOKEN}` });
  await assert.rejects(() => createRailway({ fetch: f }).browse(creds, []), (e) => /illisible/.test(e.message) && !e.message.includes(TOKEN.slice(0, 5)));
});

test('délai pendant la lecture du corps : même code qu\'un délai de requête', async () => {
  const f = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; } });
  const out = await createRailway({ fetch: f }).statuses(creds, [ref]);
  assert.match(out[0].detail, /délai/);
});

// Faux serveur dont certains services échouent sans code HTTP (erreur GraphQL), comme un service ou un accès supprimé.
const mixedFetch = (isBad) => {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.variables.s);
    const payload = isBad(body.variables.s) ? { errors: [{ message: 'Not Authorized' }] } : { data: deployments(['SUCCESS']) };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
  };
  f.calls = calls;
  return f;
};
const refOf = (s) => ({ projectId: 'p', environmentId: 'e', serviceId: s });

test('B1 (round 4) : quelques apps cassées en tête ne coupent pas le relevé des apps saines', async () => {
  const f = mixedFetch((s) => s.startsWith('bad'));
  const refs = [...Array(4).fill(0).map((_, i) => refOf(`bad${i}`)), ...Array(20).fill(0).map((_, i) => refOf(`ok${i}`))];
  const out = await createRailway({ fetch: f }).statuses(creds, refs);
  assert.equal(f.calls.length, 24, 'toutes les apps ont été tentées');
  assert.equal(out.filter((o) => o.state === 'online').length, 20);
  assert.ok(out.slice(0, 4).every((o) => o.state === 'unknown' && !o.skipped));
});

test('B1 (round 4) : un schéma refusé partout coupe le relevé, les apps non tentées sont marquées sautées', async () => {
  const f = mixedFetch(() => true);
  const out = await createRailway({ fetch: f }).statuses(creds, Array(40).fill(0).map((_, i) => refOf(`s${i}`)));
  assert.ok(f.calls.length < 20, `${f.calls.length} requêtes`);
  assert.ok(out.filter((o) => o.skipped).length > 15);
  assert.ok(out.every((o) => o.state === 'unknown'));
});

test('M-c : un budget dépassé ou un disjoncteur souple marquent les apps non tentées comme sautées', async () => {
  const out = await createRailway({ fetch: fakeFetch({}) }).statuses(creds, [ref, ref], { deadline: Date.now() - 1 });
  assert.ok(out.every((o) => o.skipped === true));
  const denied = await createRailway({ fetch: fakeFetch({}, { status: 401 }) }).statuses(creds, Array(10).fill(ref));
  assert.ok(denied.every((o) => !o.skipped), 'un jeton refusé concerne toute la flotte : rien n\'est sauté');
});

test('m4 (round 5) : des erreurs réseau répétées coupent le relevé comme des délais', async () => {
  let n = 0;
  const f = async () => {
    n++;
    if (n === 1) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: deployments(['SUCCESS']) }) };
    throw new TypeError('fetch failed');
  };
  const out = await createRailway({ fetch: f }).statuses(creds, Array(40).fill(ref));
  assert.ok(n < 20, `${n} requêtes`);
  assert.ok(out.filter((o) => o.skipped).length > 15);
});

test('scalabilité (round 5) : sur un 429 les apps non tentées sont sautées et gardent leur rang, avec le délai demandé', async () => {
  let n = 0;
  const f = async () => {
    n++;
    if (n < 10) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: deployments(['SUCCESS']) }) };
    return { ok: false, status: 429, headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '45' : null) }, text: async () => '{}' };
  };
  const out = await createRailway({ fetch: f }).statuses(creds, Array(40).fill(ref));
  const skipped = out.filter((o) => o.skipped);
  assert.ok(skipped.length > 20, `${skipped.length} sautées`);
  assert.ok(skipped.every((o) => o.backoffMs === 45000 && /trop de requêtes/.test(o.detail)));
});

test('T-2 (round 5) : des apps cassées dispersées ne coupent pas le relevé tant que des apps répondent', async () => {
  const f = mixedFetch((s) => s.startsWith('bad'));
  // une app saine d'abord, puis 15 apps cassées d'affilée, puis des saines
  const refs = [refOf('ok-first'), ...Array(15).fill(0).map((_, i) => refOf(`bad${i}`)), ...Array(10).fill(0).map((_, i) => refOf(`ok${i}`))];
  const out = await createRailway({ fetch: f }).statuses(creds, refs);
  assert.equal(f.calls.length, 26, 'toutes les apps ont été tentées');
  assert.ok(out.every((o) => !o.skipped));
  assert.equal(out.filter((o) => o.state === 'online').length, 11);
});

test('perf (round 5) : le motif des apps non tentées par la coupure « aucune réponse » est neutre', async () => {
  const f = mixedFetch(() => true);
  const out = await createRailway({ fetch: f }).statuses(creds, Array(40).fill(0).map((_, i) => refOf(`s${i}`)));
  const skipped = out.filter((o) => o.skipped);
  assert.ok(skipped.length > 15);
  assert.ok(skipped.every((o) => !/Not Authorized/.test(o.detail)), 'ne reprend pas l\'erreur d\'une autre app');
});

// ---- Round 7 ----
const okResponse = () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: deployments(['SUCCESS']) }) });
const failing = (status) => ({ ok: false, status, headers: { get: () => null }, text: async () => '{}' });

test('m-2 (round 6) : exactement trois échecs de suite coupent le relevé', async () => {
  for (const [limit, status] of [[3, 500], [3, 502], [3, 503]]) {
    let n = 0;
    const f = async () => { n++; return failing(status); };
    const out = await createRailway({ fetch: f }).statuses(creds, Array(30).fill(ref));
    assert.ok(n <= limit + 3, `${n} requêtes (4 en vol au plus)`);
    assert.ok(out.filter((o) => o.skipped).length >= 20);
  }
});

test('m-2 (round 6) : un 403 coupe tout de suite comme un 401', async () => {
  let n = 0;
  const f = async () => { n++; return failing(403); };
  const out = await createRailway({ fetch: f }).statuses(creds, Array(20).fill(ref));
  assert.ok(n <= 4);
  assert.ok(out.every((o) => /jeton refusé/.test(o.detail) && !o.skipped));
});

test('M1 (round 6) : même les requêtes en vol refusées par un 429 sont sautées', async () => {
  const f = async () => ({ ok: false, status: 429, headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '30' : null) }, text: async () => '{}' });
  const out = await createRailway({ fetch: f }).statuses(creds, Array(10).fill(ref));
  assert.ok(out.every((o) => o.skipped === true && o.backoffMs === 30000));
});

test('m-2 (round 6) : jamais trois échecs de suite, le relevé n\'est jamais coupé (ordre des réponses maîtrisé)', async () => {
  const pending = [];
  const f = () => new Promise((resolve) => pending.push(resolve));
  const flush = () => new Promise((r) => setImmediate(r));
  const run = createRailway({ fetch: f }).statuses(creds, Array(8).fill(ref));
  // ordre des réponses : échec, échec, succès, échec, échec, succès, échec, succès
  const plan = ['F', 'F', 'O', 'F', 'F', 'O', 'F', 'O'];
  for (let k = 0; k < plan.length; k++) {
    await flush();
    pending[k](plan[k] === 'O' ? okResponse() : failing(503));
    await flush();
  }
  const out = await run;
  assert.equal(pending.length, 8, 'les huit apps ont été tentées');
  assert.ok(out.every((o) => !o.skipped));
  assert.equal(out.filter((o) => o.state === 'online').length, 3);
});

test('m-3 (round 7) : neuf apps cassées d\'affilée ne coupent pas le relevé, dix sans aucune réponse oui', async () => {
  const f9 = mixedFetch((s) => s.startsWith('bad'));
  const refs9 = [...Array(9).fill(0).map((_, i) => refOf(`bad${i}`)), refOf('ok'), refOf('ok2')];
  const out9 = await createRailway({ fetch: f9 }).statuses(creds, refs9);
  assert.equal(f9.calls.length, 11, 'toutes les apps ont été tentées');
  assert.ok(out9.every((o) => !o.skipped));
  const f10 = mixedFetch((s) => s.startsWith('bad'));
  const refs10 = [...Array(10).fill(0).map((_, i) => refOf(`bad${i}`)), ...Array(10).fill(0).map((_, i) => refOf(`ok${i}`))];
  const out10 = await createRailway({ fetch: f10 }).statuses(creds, refs10);
  assert.ok(out10.some((o) => o.skipped), 'dix échecs sans aucune réponse : relevé interrompu');
});
