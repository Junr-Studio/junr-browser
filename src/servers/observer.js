'use strict';
// Noyau de l'observation des serveurs : apps observées, secrets chiffrés, relevés et rythme. Il ne connaît aucun fournisseur
// (ADR-3) et ne dépend d'aucun module d'Electron : tout ce qui vient du système arrive par `deps` (voir index.js pour le câblage réel).
const crypto = require('node:crypto');
const { validId, httpsUrl } = require('./providers');

const FAST_MS = 30 * 1000;        // une app est en déploiement : on suit de près
const IDLE_MS = 5 * 60 * 1000;    // tout est stable : relevé espacé, et relevé complet au plus tous les IDLE_MS
const BUDGET_MS = 45 * 1000;      // durée maximale d'envoi d'un relevé ; au-delà, les apps restantes sont « inconnues »
const STALE_MS = 4 * IDLE_MS;     // au-delà, un état non confirmé est présenté « inconnu » ; la rotation d'un relevé limité par son budget (45 s) reste en deçà jusqu'à environ 1 s par requête avec 500 apps
const MAX_TARGETS = 500;
const MAX_HIDDEN = 2000;
const MAX_ITEMS = 1000;           // lignes rendues à l'interface ; au-delà, les déploiements en cours et les échecs passent d'abord
const FAST_MAX_MS = 30 * 60 * 1000; // un déploiement qui dure plus longtemps (file d'attente, approbation) ne garde pas le rythme rapide
const MAX_PATH = 6;
const MAX_REF_KEYS = 8;
const MAX_REF_VALUE = 200;

// Étendue d'un relevé : `new` = apps jamais relevées, `live` = en plus celles en déploiement, `full` = toutes.
const RANK = { new: 0, live: 1, full: 2 };

// deps : store { servers: { secrets, hidden }, save() }, secrets { available, encrypt, decrypt }, providers (contrat de providers.js),
//        onChange(), log(ligne), now(), setTimer(fn, ms), clearTimer(t)
function createObserver(deps) {
  const { store, secrets, providers } = deps;
  const now = deps.now || Date.now;
  const setTimer = deps.setTimer || ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
  const clearTimer = deps.clearTimer || clearTimeout;
  const changed = () => { try { deps.onChange?.(); } catch { /* l'interface n'est pas prête */ } };

  delete store.servers.observed; // anciennes données (apps cochées à la main, rattachements clients) : abandonnées
  store.servers.hidden ||= [];

  const catalog = new Map();  // id de cible -> { id, provider, ref, label, project, path } ; rempli par la découverte (sync)
  const notes = new Map();    // fournisseur -> notes de la dernière découverte
  const readings = new Map(); // id de cible -> { state, detail, at, triedAt, apps }
  let timer = null;
  let inflight = null;
  let pending = null;         // étendue à relever dès la fin du relevé en cours (app ajoutée, jeton changé)
  let current = 'new';        // étendue du relevé en cours
  let running = false;
  let checkedAt = 0;
  let lastFullAt = 0;
  let backoffUntil = 0;       // le fournisseur a demandé d'attendre (quota atteint)

  const keyOf = (a) => `${a.provider}:${JSON.stringify(a.ref)}`;
  const targetId = (provider, ref) => crypto.createHash('sha1').update(keyOf({ provider, ref })).digest('hex').slice(0, 12);
  const pathKey = (t) => `${t.provider}:${t.path.length ? t.path.map((n) => n.id).join('/') : t.id}`;
  const hiddenList = () => store.servers.hidden;
  // Ensemble reconstruit seulement quand la liste change ; une clé est masquée si elle ou l'un de ses ancêtres l'est.
  let hiddenSet = new Set();
  let hiddenSrc = null;
  let hiddenLen = -1;
  const hiddenKeys = () => {
    const list = hiddenList();
    if (list !== hiddenSrc || list.length !== hiddenLen) { hiddenSet = new Set(list); hiddenSrc = list; hiddenLen = list.length; }
    return hiddenSet;
  };
  const isHidden = (key) => {
    hiddenKeys();
    for (let k = key; k; k = k.slice(0, k.lastIndexOf('/'))) {
      if (hiddenSet.has(k)) return true;
      if (!k.includes('/')) break;
    }
    return false;
  };
  // Cibles relevées : celles du catalogue que ni elles ni un de leurs ancêtres ne masquent.
  const observed = () => [...catalog.values()].filter((t) => !isHidden(pathKey(t)));

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

  const active = () => providers.list().some((p) => hasSecrets(p.id));

  // Une cible est « en déploiement » si elle l'est ou si l'une de ses apps l'est (l'état de la cible est le pire de ses apps).
  const rawDeploying = (r) => !!r && (r.state === 'deploying' || (r.apps || []).some((x) => x.state === 'deploying'));
  const deploying = (r) => rawDeploying(r) && (r.since == null || now() - r.since < FAST_MAX_MS);

  function nextDelay() {
    const base = observed().some((a) => deploying(readings.get(a.id))) ? FAST_MS : IDLE_MS;
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
    return mode === 'live' && deploying(r);
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
      stamp(a, { ...got[i], since: rawDeploying(got[i]) ? readings.get(a.id)?.since ?? done : undefined }, done);
    });
    return { unknown, tried };
  }

  // Découverte : remplace le catalogue de chaque fournisseur configuré. Une erreur garde le catalogue précédent et se dit en note.
  async function sync(deadline) {
    await Promise.all(providers.list().filter((p) => hasSecrets(p.id)).map(async ({ id }) => {
      let creds = {};
      try {
        creds = await credsOf(id);
        const got = await providerOf(id).list(creds, { deadline });
        const targets = [];
        const found = new Map();
        for (const t of Array.isArray(got?.targets) ? got.targets : []) {
          try {
            checkRef(t.ref);
            providerOf(id).validateRef?.(t.ref);
            const path = (Array.isArray(t.path) ? t.path : []).slice(0, MAX_PATH).map((n) => ({ id: n?.id, name: String(n?.name ?? '').slice(0, 120), kind: String(n?.kind ?? '').slice(0, 20) }));
            if (!path.every((n) => validId(n.id))) continue; // identifiant vide ou contenant une barre : les clés de masquage seraient ambiguës
            const tid = targetId(id, t.ref);
            if (found.has(tid)) continue;
            const names = (kind) => path.find((n) => n.kind === kind)?.name || '';
            found.set(tid, { id: tid, provider: id, ref: t.ref, label: path.length ? path[path.length - 1].name : '', project: names('project'), path });
            targets.push(tid);
          } catch { /* cible illisible : ignorée, les autres restent */ }
        }
        if (!hasSecrets(id)) return; // jeton effacé pendant la découverte : on ne repeuple pas
        const list = (Array.isArray(got?.notes) ? got.notes : []).slice(0, 10).map((n) => providers.redact(n, creds));
        for (const [tid, t] of [...catalog]) if (t.provider === id && !found.has(tid)) { catalog.delete(tid); readings.delete(tid); }
        let kept = 0;
        for (const tid of targets) {
          if ([...catalog.values()].filter((t) => t.provider === id).length >= MAX_TARGETS && !catalog.has(tid)) { kept++; continue; }
          catalog.set(tid, found.get(tid));
        }
        if (kept) list.push(`Liste tronquée à ${MAX_TARGETS} environnements`);
        notes.set(id, list);
      } catch (e) {
        if (!hasSecrets(id)) return; // jeton effacé pendant la découverte : aucune note
        if (e && e.backoffMs) backoffUntil = Math.max(backoffUntil, now() + e.backoffMs);
        notes.set(id, [`Découverte impossible : ${providers.redact(e && e.message ? e.message : e, creds)}`]);
      }
    }));
  }

  async function poll(mode) {
    const started = now();
    const deadline = started + BUDGET_MS;
    if (mode === 'full' || catalog.size === 0) await sync(deadline);
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
    if (value === null || value === '') {
      delete store.servers.secrets[providerId]?.[key];
      // Plus de jeton : ce que ce fournisseur avait découvert ne se montre plus (ni dans la vue, ni dans l'arbre des Réglages).
      for (const [tid, t] of [...catalog]) if (t.provider === providerId) { catalog.delete(tid); readings.delete(tid); }
      notes.delete(providerId);
    } else {
      if (!(await secrets.available())) throw new Error('Coffre de chiffrement du système indisponible : jeton non enregistré');
      (store.servers.secrets[providerId] ||= {})[key] = await secrets.encrypt(String(value).trim());
      backoffUntil = 0; // un nouveau jeton (autre compte, autre quota) lève l'attente demandée pour l'ancien
    }
    store.save();
    request('full');
  }

  /* ---------- Cibles ---------- */
  // Forme et taille bornées : `ref` est opaque pour le noyau, mais il est stocké et sérialisé dans chaque clé.
  function checkRef(ref) {
    const entries = ref && typeof ref === 'object' && !Array.isArray(ref) ? Object.entries(ref) : null;
    const scalar = (v) => ['string', 'number', 'boolean'].includes(typeof v) && String(v).length <= MAX_REF_VALUE;
    if (!entries || entries.length > MAX_REF_KEYS || !entries.every(([, v]) => scalar(v))) throw new Error('Référence de cible invalide');
  }

  // Interne : la découverte et les tests ajoutent une cible au catalogue.
  function observe({ provider, ref, label, project, path }) {
    const p = providers.get(provider);
    checkRef(ref);
    p.validateRef?.(ref);
    const id = targetId(provider, ref);
    if (catalog.has(id)) return catalog.get(id);
    if (catalog.size >= MAX_TARGETS) throw new Error(`Au plus ${MAX_TARGETS} cibles`);
    const entry = { id, provider, ref, label: String(label || '').slice(0, 120), project: String(project || '').slice(0, 120), path: Array.isArray(path) ? path : [] };
    catalog.set(id, entry);
    request('new'); // seule la nouvelle cible est relevée, pas toute la flotte
    return entry;
  }

  function unobserve(id) {
    catalog.delete(id);
    readings.delete(id);
    schedule();
    changed();
  }

  /* ---------- Masquage ---------- */
  // Toutes les clés que l'interface peut masquer : chaque nœud du chemin d'une cible, et chaque app déjà lue.
  function knownKeys() {
    const keys = new Set();
    for (const t of catalog.values()) {
      const ids = t.path.length ? t.path.map((n) => n.id) : [t.id];
      for (let k = 1; k <= ids.length; k++) keys.add(`${t.provider}:${ids.slice(0, k).join('/')}`);
      for (const a of readings.get(t.id)?.apps || []) keys.add(`${pathKey(t)}/${a.id}`);
    }
    return keys;
  }

  function setHidden(key, hidden) {
    key = String(key);
    const list = hiddenList();
    if (!knownKeys().has(key) && !list.includes(key)) throw new Error('Clé inconnue');
    if (hidden) {
      if (!list.includes(key)) {
        if (list.length >= MAX_HIDDEN) throw new Error(`Au plus ${MAX_HIDDEN} éléments masqués`);
        list.push(key);
      }
    } else store.servers.hidden = list.filter((h) => h !== key);
    store.save();
    if (!hidden) request('new'); // une cible redevenue visible sans relevé est relevée
    else schedule();
    changed();
  }

  /* ---------- Ce que l'interface voit ---------- */
  function config() {
    const roots = [];
    const own = (key) => hiddenKeys().has(key);
    const inherit = (key) => key.includes('/') && isHidden(key.slice(0, key.lastIndexOf('/')));
    const child = (list, node) => {
      let found = list.find((c) => c.key === node.key);
      if (!found) { found = { ...node, hidden: own(node.key), inherited: inherit(node.key), children: [] }; list.push(found); }
      return found;
    };
    for (const t of catalog.values()) {
      const nodes = t.path.length ? t.path : [{ id: t.id, name: t.label, kind: 'environment' }];
      let level = roots;
      let prefix = `${t.provider}:`;
      let last = null;
      nodes.forEach((n, k) => {
        prefix += (k ? '/' : '') + n.id;
        last = child(level, { key: prefix, id: n.id, name: n.name, kind: n.kind });
        level = last.children;
      });
      for (const a of readings.get(t.id)?.apps || []) child(last.children, { key: `${prefix}/${a.id}`, id: a.id, name: a.name, kind: 'service' });
    }
    return {
      providers: providers.list().map((p) => ({ ...p, secrets: p.secrets.map((s) => ({ ...s, saved: !!store.servers.secrets[p.id]?.[s.key] })) })),
      tree: roots,
      notes: [...notes.values()].flat(),
    };
  }

  function view() {
    const labelOf = new Map(providers.list().map((p) => [p.id, p.label]));
    const t = now(); // une seule date pour tout l'appel : toutes les lignes sont jugées au même instant
    const items = [];
    const targetNotes = [];
    // Groupés par espace puis par projet (ordre de première apparition, par identifiant) : un environnement découvert plus tard reste sous son projet.
    const rank = new Map();
    const rankOf = (key) => { if (!rank.has(key)) rank.set(key, rank.size); return rank.get(key); };
    const grouped = observed().map((tg, i) => {
      const ws = tg.path.find((n) => n.kind === 'workspace')?.id ?? tg.id;
      const pr = tg.path.find((n) => n.kind === 'project')?.id ?? tg.id;
      return { tg, i, w: rankOf(`w:${tg.provider}:${ws}`), p: rankOf(`p:${tg.provider}:${ws}/${pr}`) };
    }).sort((a, b) => a.w - b.w || a.p - b.p || a.i - b.i).map((x) => x.tg);
    for (const target of grouped) {
      const r = readings.get(target.id) || { state: 'unknown', detail: 'Pas encore relevé', at: 0 };
      // Un état que plus aucun relevé n'a confirmé depuis STALE_MS (panne, quota, coupure) n'est plus présenté comme un état : l'âge réel reste affiché.
      const old = r.at > 0 && (r.state !== 'unknown' || r.apps?.length > 0) && (t - r.at > STALE_MS || t < r.at); // une horloge qui recule rend l'âge négatif : périmé aussi
      const ids = target.path;
      const named = (kind) => ids.find((n) => n.kind === kind)?.name || (kind === 'project' ? target.project : '');
      const base = { project: named('project'), workspace: named('workspace'), environment: named('environment'), provider: target.provider, providerLabel: labelOf.get(target.provider) || target.provider, at: r.at };
      const shown = (state, detail) => ({ state: old ? 'unknown' : state, detail: old ? 'Dernier relevé ancien' : detail });
      if (r.note) targetNotes.push(`${[base.project, base.environment].filter(Boolean).join(' › ') || target.label} : ${r.note}`);
      const apps = (r.apps || []).filter((a) => !isHidden(`${pathKey(target)}/${a.id}`));
      if (r.apps?.length) for (const a of apps) items.push({ ...base, id: `${target.id}.${a.id}`, label: a.name, ...shown(a.state, a.detail) });
      else items.push({ ...base, id: target.id, label: target.label, ...shown(r.state, r.detail) });
    }
    const total = items.length;
    // Au-delà de MAX_ITEMS, les déploiements en cours et les échecs passent d'abord : le reste est coupé dans l'ordre de la découverte.
    if (total > MAX_ITEMS) {
      const urgent = (i) => i.state === 'deploying' || i.state === 'failed';
      const keep = new Set([...items.filter(urgent), ...items.filter((i) => !urgent(i))].slice(0, MAX_ITEMS));
      items.splice(0, total, ...items.filter((i) => keep.has(i)));
      targetNotes.push(`${total - MAX_ITEMS} autres non affichés (limite de ${MAX_ITEMS} lignes) : masquez des projets pour les voir`);
    }
    // En cours de déploiement d'abord ; l'ordre de la découverte est conservé dans chaque groupe.
    items.sort((a, b) => (b.state === 'deploying') - (a.state === 'deploying'));
    const has = (s) => items.some((i) => i.state === s);
    const mark = has('failed') ? 'failed' : has('deploying') ? 'deploying' : has('online') ? 'online' : 'none';
    return {
      configured: providers.list().some((p) => hasSecrets(p.id)), items, mark, count: total, checkedAt, waitUntil: backoffUntil > now() ? backoffUntil : 0,
      notes: [...[...notes.values()].flat(), ...targetNotes],
    };
  }

  // Adresse de la page d'une app, produite par le fournisseur : jamais fournie par l'appelant, et seulement en HTTPS.
  function urlOf(itemId) {
    const [tid, ...rest] = String(itemId).split('.');
    const a = (readings.get(tid)?.apps || []).find((x) => x.id === rest.join('.'));
    return (a && !isHidden(`${pathKey(catalog.get(tid))}/${a.id}`) && httpsUrl(a.url)) || null;
  }

  return { config, view, urlOf, setSecret, setHidden, sync, observe, unobserve, refresh, start, stop, nextDelay };
}

module.exports = { createObserver, FAST_MS, IDLE_MS, BUDGET_MS, MAX_TARGETS };
