'use strict';
// Noyau de l'observation des serveurs : apps observées, secrets chiffrés, relevés et rythme. Il ne connaît aucun fournisseur
// (ADR-3) et ne dépend d'aucun module d'Electron : tout ce qui vient du système arrive par `deps` (voir index.js pour le câblage réel).
const crypto = require('node:crypto');

const FAST_MS = 30 * 1000;        // une app est en déploiement : on suit de près
const IDLE_MS = 5 * 60 * 1000;    // tout est stable : relevé espacé, et relevé complet au plus tous les IDLE_MS
const BUDGET_MS = 45 * 1000;      // durée maximale d'envoi d'un relevé ; au-delà, les apps restantes sont « inconnues »
const STALE_MS = 4 * IDLE_MS;     // au-delà, un état non confirmé est présenté « inconnu » ; la rotation d'un relevé limité par son budget (45 s) reste en deçà jusqu'à environ 1 s par requête avec 500 apps
const MAX_APPS = 500;
const MAX_REF_KEYS = 8;
const MAX_REF_VALUE = 200;

// Étendue d'un relevé : `new` = apps jamais relevées, `live` = en plus celles en déploiement, `full` = toutes.
const RANK = { new: 0, live: 1, full: 2 };

// deps : store { servers: { secrets, observed }, save() }, secrets { available, encrypt, decrypt }, providers (contrat de providers.js),
//        clients() -> [{ id, name }], onChange(), log(ligne), now(), setTimer(fn, ms), clearTimer(t)
function createObserver(deps) {
  const { store, secrets, providers } = deps;
  const now = deps.now || Date.now;
  const setTimer = deps.setTimer || ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
  const clearTimer = deps.clearTimer || clearTimeout;
  const changed = () => { try { deps.onChange?.(); } catch { /* l'interface n'est pas prête */ } };

  const readings = new Map(); // id d'app -> { state, detail, at }
  let timer = null;
  let inflight = null;
  let pending = null;         // étendue à relever dès la fin du relevé en cours (app ajoutée, jeton changé)
  let current = 'new';        // étendue du relevé en cours
  let running = false;
  let checkedAt = 0;
  let lastFullAt = 0;
  let backoffUntil = 0;       // le fournisseur a demandé d'attendre (quota atteint)

  const observed = () => store.servers.observed;
  const keyOf = (a) => `${a.provider}:${JSON.stringify(a.ref)}`;

  // Un relevé lancé sans que personne n'attende son résultat : une panne inattendue se lit dans le journal au lieu de disparaître.
  const detached = (promise) => promise.catch((e) => deps.log?.(`${new Date(now()).toISOString()} relevé en erreur : ${String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200)}`));

  function providerOf(id) {
    try { return providers.get(id); } catch { return null; } // fournisseur retiré d'une version à l'autre : traité comme absent
  }

  async function credsOf(providerId) {
    const saved = store.servers.secrets[providerId] || {};
    const out = {};
    for (const [k, v] of Object.entries(saved)) if (v) out[k] = await secrets.decrypt(v);
    return out;
  }

  // Le fournisseur a tous ses champs secrets : sans eux, rien ne part sur le réseau.
  function hasSecrets(providerId) {
    const p = providerOf(providerId);
    const saved = store.servers.secrets[providerId] || {};
    return !!p && p.secrets.every((s) => !!saved[s.key]);
  }

  const active = () => observed().some((a) => hasSecrets(a.provider));

  function nextDelay() {
    const base = observed().some((a) => readings.get(a.id)?.state === 'deploying') ? FAST_MS : IDLE_MS;
    return Math.max(base, backoffUntil - now());
  }

  function schedule() {
    if (timer) { clearTimer(timer); timer = null; }
    if (!running || !active()) return;
    // Au rythme lent le relevé est complet ; au rythme rapide, seules les apps en déploiement ou jamais relevées sont relevées.
    // +50 ms : un minuteur qui partirait un peu avant la fin d'une attente demandée sauterait un cycle entier.
    // Pendant une longue attente de quota (plus de deux fois IDLE_MS) le minuteur se déclenche quand même toutes les IDLE_MS : le relevé
    // ne part pas, il redessine seulement, de sorte qu'un état devenu ancien soit présenté comme tel sans attendre une heure. Une attente
    // plus courte n'est pas plafonnée : le minuteur tombe juste après sa fin, la reprise n'est pas retardée.
    const delay = nextDelay();
    timer = setTimer(() => { timer = null; detached(refresh(now() - lastFullAt >= IDLE_MS ? 'full' : 'live')); }, (delay > 2 * IDLE_MS ? IDLE_MS : delay) + 50);
  }

  // `live` ne retient que ce qui peut changer d'ici le prochain tick : les apps en déploiement et celles jamais relevées. Une app
  // durablement inconnue (service supprimé, aucun déploiement) attend le relevé complet, sinon elle consommerait le quota à chaque tick.
  const wanted = (a, mode) => {
    if (mode === 'full') return true;
    const r = readings.get(a.id);
    if (!r || !r.triedAt) return true; // jamais tentée (y compris sautée sans relevé)
    return mode === 'live' && r.state === 'deploying';
  };

  // Quand le budget ne permet pas de tout relever, les apps tentées il y a le plus longtemps passent d'abord : le relevé suivant reprend
  // là où celui-ci s'est arrêté au lieu de repartir de la première app. `triedAt` ne bouge que sur une vraie tentative ; une app sautée
  // (budget, coupure) garde sa date, sans quoi toutes les apps non atteintes seraient à égalité. À date égale, les apps dont la dernière
  // réponse est une erreur passent après les autres : quelques apps cassées ne doivent pas ouvrir chaque relevé.
  const staleFirst = (a, b) => {
    const ra = readings.get(a.id), rb = readings.get(b.id);
    return (ra?.triedAt ?? 0) - (rb?.triedAt ?? 0) || (ra?.state === 'unknown') - (rb?.state === 'unknown');
  };

  const stamp = (a, reading, t) => readings.set(a.id, { ...reading, at: t, triedAt: t });

  // Rend { unknown, tried } : combien d'apps sont restées sans état, combien ont réellement été tentées.
  async function pollProvider(providerId, apps, deadline) {
    const t = now();
    const provider = providerOf(providerId);
    if (!provider) { for (const a of apps) stamp(a, { state: 'unknown', detail: 'Fournisseur inconnu' }, t); return { unknown: apps.length, tried: apps.length }; }
    if (!hasSecrets(providerId)) { for (const a of apps) stamp(a, { state: 'unknown', detail: 'Jeton non enregistré' }, t); return { unknown: 0, tried: 0 }; }
    let creds;
    try { creds = await credsOf(providerId); } catch {
      // Profil copié sur une autre machine, trousseau réinitialisé : le jeton chiffré n'est plus lisible.
      for (const a of apps) stamp(a, { state: 'unknown', detail: 'Jeton illisible, ressaisissez-le' }, t);
      return { unknown: apps.length, tried: apps.length };
    }
    const got = await providers.safeStatuses(provider, creds, apps.map((a) => a.ref), { deadline });
    const done = now(); // une seule date pour tout le lot : les apps d'un même relevé restent à égalité pour le tri
    let unknown = 0;
    let tried = 0;
    apps.forEach((a, i) => {
      if (got[i].backoffMs) backoffUntil = Math.max(backoffUntil, now() + got[i].backoffMs);
      // App non tentée (budget dépassé, coupure) : son dernier état connu reste valable, avec son âge. Sans état connu elle n'a pas d'âge
      // (`at` à 0 : « jamais relevé ») et sera reprise dès le prochain relevé.
      if (got[i].skipped) { if (!readings.has(a.id)) readings.set(a.id, { state: 'unknown', detail: got[i].detail, at: 0, triedAt: 0 }); return; }
      tried++;
      if (got[i].state === 'unknown') unknown++;
      stamp(a, got[i], done);
    });
    return { unknown, tried };
  }

  async function poll(mode) {
    const started = now();
    const deadline = started + BUDGET_MS;
    const byProvider = new Map();
    for (const a of [...observed()].sort(staleFirst)) if (wanted(a, mode)) byProvider.set(a.provider, [...(byProvider.get(a.provider) || []), a]);
    // Fournisseurs en parallèle : un fournisseur lent ne retarde pas les autres.
    const results = await Promise.all([...byProvider].map(([id, apps]) => pollProvider(id, apps, deadline)));
    const live = new Set(observed().map((a) => a.id));
    for (const id of readings.keys()) if (!live.has(id)) readings.delete(id);
    if (mode === 'full') lastFullAt = now();
    const tried = results.reduce((n, r) => n + r.tried, 0);
    // L'heure du dernier relevé n'avance que si une app a réellement été tentée : un relevé coupé avant sa première requête ne
    // doit pas afficher « relevé à l'instant » sur des états qui datent d'avant.
    if (tried) checkedAt = now();
    const errors = results.reduce((n, r) => n + r.unknown, 0);
    // Le journal ne garde que les relevés qui comptent des états inconnus : il reste lisible, et il ne grossit pas au rythme du sondage.
    if (errors) deps.log?.(`${new Date(now()).toISOString()} relevé ${mode} : ${tried} app(s) tentée(s), ${errors} inconnue(s), ${now() - started} ms`);
  }

  // Un seul relevé à la fois : une demande reçue pendant un relevé en cours reprend son résultat. Si elle est plus large que le relevé
  // en cours (« Actualiser » pendant un relevé partiel), elle est rejouée juste après.
  function refresh(mode = 'full') {
    if (inflight) {
      if (RANK[mode] > RANK[current] && (pending === null || RANK[mode] > RANK[pending])) pending = mode;
      return inflight;
    }
    current = mode; // dès maintenant : une demande plus large reçue avant le premier tour doit être comparée à CE relevé
    pending = null;
    const run = (async () => {
      await null; // le corps ne s'exécute qu'après l'affectation de `inflight` : un relevé sans attente ne doit pas se terminer avant d'être enregistré
      let next = mode;
      try {
        for (let turn = 0; next && turn < 3; turn++) {
          current = next;
          next = null;
          // Pendant une attente demandée par le fournisseur (quota), rien ne part, même sur demande : chaque essai prolongerait l'attente.
          if (active() && now() >= backoffUntil) await poll(current);
          next = pending; // une app ou un jeton est arrivé pendant le relevé : on relève ce qui a changé juste après
          pending = null;
        }
      } finally {
        if (inflight === run) inflight = null;
        pending = null;
        schedule();
        // Demande restée en attente après trois tours : reprise dans la seconde plutôt qu'au prochain tick.
        if (next && running) { clearTimer(timer); timer = setTimer(() => { timer = null; detached(refresh(next)); }, 1000); }
        changed();
      }
    })();
    inflight = run;
    return run;
  }

  // Demande venue d'un changement de configuration : en cours de relevé, elle est rejouée à la fin au lieu d'être perdue.
  function request(mode) {
    if (inflight) { if (pending === null || RANK[mode] > RANK[pending]) pending = mode; return; }
    if (running) detached(refresh(mode)); else changed();
  }

  function start() { running = true; if (active()) detached(refresh('full')); }
  function stop() { running = false; if (timer) { clearTimer(timer); timer = null; } }

  /* ---------- Secrets ---------- */
  const fieldOf = (providerId, key) => {
    const field = providers.get(providerId).secrets.find((s) => s.key === key);
    if (!field) throw new Error('Champ secret inconnu');
    return field;
  };

  async function setSecret(providerId, key, value) {
    fieldOf(providerId, key);
    if (value === null || value === '') delete store.servers.secrets[providerId]?.[key];
    else {
      if (!(await secrets.available())) throw new Error('Coffre de chiffrement du système indisponible : jeton non enregistré');
      (store.servers.secrets[providerId] ||= {})[key] = await secrets.encrypt(String(value).trim());
      backoffUntil = 0; // un nouveau jeton (autre compte, autre quota) lève l'attente demandée pour l'ancien
    }
    store.save();
    request('full');
  }

  async function browse(providerId, path = []) {
    const provider = providers.get(providerId);
    if (!hasSecrets(providerId)) throw new Error('Jeton non enregistré : posez-le d\'abord');
    let creds = {};
    try {
      creds = await credsOf(providerId);
      const nodes = await provider.browse(creds, path.map(String));
      // La clé d'identité d'une app appartient au noyau : l'interface la compare telle quelle, sans la recalculer.
      return nodes.map((n) => (n.app ? { ...n, app: { ...n.app, refKey: keyOf({ provider: providerId, ref: n.app.ref }) } } : n));
    } catch (e) {
      throw new Error(providers.redact(e && e.message ? e.message : e, creds));
    }
  }

  /* ---------- Apps observées ---------- */
  // Forme et taille bornées : `ref` est opaque pour le noyau, mais il est stocké et sérialisé dans chaque clé.
  function checkRef(ref) {
    const entries = ref && typeof ref === 'object' && !Array.isArray(ref) ? Object.entries(ref) : null;
    const scalar = (v) => ['string', 'number', 'boolean'].includes(typeof v) && String(v).length <= MAX_REF_VALUE;
    if (!entries || entries.length > MAX_REF_KEYS || !entries.every(([, v]) => scalar(v))) throw new Error('Référence d\'app invalide');
  }

  function observe({ provider, ref, label, project }) {
    const p = providers.get(provider);
    checkRef(ref);
    p.validateRef?.(ref);
    const entry = { id: '', provider, ref, label: String(label || '').slice(0, 120), project: String(project || '').slice(0, 120), clientId: null };
    const dup = observed().find((a) => keyOf(a) === keyOf(entry));
    if (dup) return dup;
    if (observed().length >= MAX_APPS) throw new Error(`Au plus ${MAX_APPS} apps observées`);
    entry.id = crypto.randomUUID();
    observed().push(entry);
    store.save();
    request('new'); // seule la nouvelle app est relevée, pas toute la flotte
    return entry;
  }

  function unobserve(id) {
    store.servers.observed = observed().filter((a) => a.id !== id);
    readings.delete(id);
    store.save();
    schedule();
    changed();
  }

  function assign(id, clientId) {
    const a = observed().find((x) => x.id === id);
    if (!a) throw new Error('App inconnue');
    if (clientId && !deps.clients().some((c) => c.id === clientId)) throw new Error('Client inconnu');
    a.clientId = clientId || null;
    store.save();
    changed();
  }

  /* ---------- Ce que l'interface voit ---------- */
  function config() {
    return {
      max: MAX_APPS,
      providers: providers.list().map((p) => ({ ...p, secrets: p.secrets.map((s) => ({ ...s, saved: !!store.servers.secrets[p.id]?.[s.key] })) })),
      observed: observed().map((a) => ({ id: a.id, provider: a.provider, label: a.label, project: a.project, clientId: a.clientId, refKey: keyOf(a) })),
    };
  }

  function view() {
    const clients = deps.clients();
    const labelOf = new Map(providers.list().map((p) => [p.id, p.label]));
    const t = now(); // une seule date pour tout l'appel : toutes les lignes sont jugées au même instant
    const items = observed().map((a) => {
      const client = clients.find((c) => c.id === a.clientId) || null;
      const r = readings.get(a.id) || { state: 'unknown', detail: 'Pas encore relevé', at: 0 };
      // Un état que plus aucun relevé n'a confirmé depuis STALE_MS (panne, quota, coupure) n'est plus présenté comme un état : l'âge réel reste affiché.
      const old = r.at > 0 && r.state !== 'unknown' && (t - r.at > STALE_MS || t < r.at); // une horloge qui recule rend l'âge négatif : périmé aussi
      return {
        id: a.id, label: a.label, project: a.project, provider: a.provider, providerLabel: labelOf.get(a.provider) || a.provider,
        clientId: client ? client.id : null, clientName: client ? client.name : null,
        state: old ? 'unknown' : r.state, detail: old ? 'Dernier relevé ancien' : r.detail, at: r.at,
      };
    });
    const has = (s) => items.some((i) => i.state === s);
    const mark = has('failed') ? 'failed' : has('deploying') ? 'deploying' : has('online') ? 'online' : 'none';
    return { configured: providers.list().some((p) => hasSecrets(p.id)), items, mark, count: items.length, checkedAt, waitUntil: backoffUntil > now() ? backoffUntil : 0 };
  }

  return { config, view, keyFor: (provider, ref) => keyOf({ provider, ref }), setSecret, browse, observe, unobserve, assign, refresh, start, stop, nextDelay };
}

module.exports = { createObserver, FAST_MS, IDLE_MS, BUDGET_MS, MAX_APPS };
