'use strict';
// Fournisseur Railway, en lecture seule (ADR-1). Un seul chemin réseau, `gql()`, qui n'envoie que les requêtes figées de QUERIES :
// aucun texte saisi par l'utilisateur n'est jamais envoyé, et tout texte qui ressemble à une écriture est refusé avant l'envoi.
// Jeton attendu : jeton de compte (il faut `me` pour lister les espaces de travail), posé à la main dans les Réglages.
//
// Une cible est un environnement : un appel rend tous ses services avec leur dernier déploiement (ADR-7).
const { redact } = require('./providers');

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const DASHBOARD = 'https://railway.com';
const TIMEOUT_MS = 20000;
const MAX_PROJECTS = 500;              // limite demandée à l'API pour les projets d'un espace ; au-delà, la liste le dit
const PAGE_SIZE = 100;                 // services par page d'un environnement
const MAX_PAGES = 10;                  // au-delà de MAX_PAGES × PAGE_SIZE services, la cible le dit
const PARALLEL = 4;
const SOFT_LIMIT = 3;                  // échecs consécutifs (délai, erreur 5xx) qui coupent le relevé
const CODELESS_LIMIT = 10;             // erreurs propres à une requête, sans aucune réponse valable, qui coupent le relevé
const MAX_BODY = 5 * 1000 * 1000;      // une réponse annoncée plus grosse n'est pas lue ; une autre est refusée après lecture
const DEFAULT_BACKOFF_MS = 60 * 1000;  // 429 sans Retry-After

// Mise en forme volontairement serrée : les doubles de test reconnaissent une requête à un fragment de son texte.
const QUERIES = Object.freeze({
  tree: `query Tree { me { workspaces { id name projects(first: ${MAX_PROJECTS}) { edges { node { id name deletedAt environments { edges { node { id name canAccess } } } } } } } } }`,
  external: 'query External { externalWorkspaces { id name projects { id name deletedAt environments { edges { node { id name canAccess } } } } } }',
  instances: `query Instances($p: String!, $e: String!, $after: String) { environment(id: $e, projectId: $p) { id serviceInstances(first: ${PAGE_SIZE}, after: $after) { edges { node { serviceId serviceName latestDeployment { id status } } } pageInfo { hasNextPage endCursor } } } }`,
});

const WRITE_OPS = /\b(mutation|subscription)\b/i;

const STATE_OF = {
  SUCCESS: 'online',
  BUILDING: 'deploying', DEPLOYING: 'deploying', INITIALIZING: 'deploying', QUEUED: 'deploying', WAITING: 'deploying', NEEDS_APPROVAL: 'deploying',
  FAILED: 'failed', CRASHED: 'failed',
};
// REMOVED, REMOVING, SKIPPED et tout statut inconnu : `unknown`, avec le statut brut en détail.

// Pire état d'abord : l'état d'un environnement est celui de son service le moins bien portant.
const WORST_FIRST = ['failed', 'deploying', 'online', 'unknown'];

const nodes = (conn) => (conn?.edges || []).map((e) => e.node).filter(Boolean);

// Erreur qui coupe le relevé en cours : inutile d'envoyer le reste quand le jeton est refusé, que le quota est atteint ou que le réseau pend.
function fail(code, message, backoffMs) {
  const e = new Error(message);
  e.code = code;
  if (backoffMs) e.backoffMs = backoffMs;
  return e;
}

// Corps de la réponse, plafonné à MAX_BODY : refusé d'emblée si `content-length` l'annonce plus gros, sinon lu par morceaux et abandonné
// dès que la limite est franchie (un transfert fractionné ne peut pas remplir la mémoire).
async function readBody(res) {
  const tooBig = () => new Error('Railway : réponse trop volumineuse');
  if (Number(res.headers?.get?.('content-length')) > MAX_BODY) throw tooBig();
  if (!res.body?.getReader) {
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BODY) throw tooBig();
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw tooBig(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isLocal(host) { return ['127.0.0.1', 'localhost', '[::1]'].includes(host); }

// Page du service dans le tableau de bord de Railway : l'adresse est produite ici, à partir d'identifiants, jamais fournie par l'interface.
const serviceUrl = (ref, serviceId) => `${DASHBOARD}/project/${encodeURIComponent(ref.projectId)}/service/${encodeURIComponent(serviceId)}?environmentId=${encodeURIComponent(ref.environmentId)}`;

function createRailway({ fetch = globalThis.fetch, endpoint = ENDPOINT } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !isLocal(url.hostname)) throw new Error('Railway : l\'adresse doit être en HTTPS (le jeton ne circule jamais en clair)');

  function assertReadOnly(text) {
    if (WRITE_OPS.test(text)) throw new Error('Requête refusée : lecture seule');
  }

  async function gql(name, variables, creds) {
    const query = QUERIES[name];
    if (!query) throw new Error(`Requête inconnue : ${name}`);
    assertReadOnly(query);
    const token = creds && creds.token;
    if (!token) throw new Error('Railway : jeton non enregistré');
    // Le délai de 20 s couvre la requête ET la lecture du corps : les deux se traduisent de la même façon.
    const classified = (e) => {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return fail('timeout', 'Railway : délai dépassé');
      if (e && !e.code && e instanceof TypeError) return fail('network', e.message); // DNS, connexion refusée : compte comme un délai
      return e;
    };
    let res;
    let text;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error', // le jeton ne suit jamais une redirection
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401 || res.status === 403) throw fail('denied', 'Railway : jeton refusé');
      if (res.status === 429) {
        const wait = Number(res.headers?.get?.('retry-after')) * 1000;
        throw fail('rate', 'Railway : trop de requêtes, nouvel essai plus tard', Number.isFinite(wait) && wait > 0 ? wait : DEFAULT_BACKOFF_MS);
      }
      if (res.status >= 500) throw fail('server', `Railway : erreur ${res.status}`);
      if (!res.ok) throw new Error(`Railway : erreur ${res.status}`);
      text = await readBody(res);
    } catch (e) {
      throw classified(e);
    }
    let body;
    try { body = JSON.parse(text); } catch { throw new Error('Railway : réponse illisible'); } // le message natif cite le début de la réponse
    if (body.errors?.length) throw new Error(`Railway : ${redact(body.errors[0].message, creds)}`);
    return body.data;
  }

  /* ---------- Découverte : tous les environnements lisibles ---------- */
  async function list(creds) {
    let mine;
    try { mine = await gql('tree', {}, creds); } catch (e) {
      // Une erreur classée (jeton refusé, quota, délai) garde son code et son délai ; seule une erreur de schéma reçoit l'indication.
      if (e.code || /jeton/.test(e.message)) throw e;
      throw new Error(`${e.message} (un jeton de compte est nécessaire pour lister les espaces de travail)`);
    }
    const targets = [];
    const notes = [];
    const seen = new Set();
    const addProjects = (workspace, projects) => {
      for (const p of projects) {
        if (p.deletedAt) continue;
        for (const e of nodes(p.environments)) {
          if (e.canAccess === false || seen.has(e.id)) continue;
          seen.add(e.id);
          targets.push({
            ref: { projectId: p.id, environmentId: e.id },
            path: [{ id: workspace.id, name: workspace.name, kind: 'workspace' }, { id: p.id, name: p.name, kind: 'project' }, { id: e.id, name: e.name, kind: 'environment' }],
          });
        }
      }
    };
    for (const w of mine.me?.workspaces || []) {
      const projects = nodes(w.projects);
      if (projects.length >= MAX_PROJECTS) notes.push(`Liste tronquée aux ${MAX_PROJECTS} premiers projets de ${w.name}`);
      addProjects(w, projects);
    }
    // Espaces où l'on est invité : ils ne sont pas dans `me.workspaces`. Une erreur ici ne casse pas la liste, elle se dit.
    try {
      const guest = await gql('external', {}, creds);
      for (const w of guest.externalWorkspaces || []) addProjects(w, w.projects || []);
    } catch (e) {
      notes.push(`Espaces invités non lus : ${e.message}`);
    }
    return { targets, notes };
  }

  /* ---------- Lecture d'un environnement : ses services et leur dernier déploiement ---------- */
  const appOf = (ref, node) => {
    const d = node.latestDeployment;
    return {
      id: node.serviceId, name: node.serviceName,
      state: d ? STATE_OF[d.status] || 'unknown' : 'unknown',
      detail: d ? String(d.status) : 'Aucun déploiement',
      url: serviceUrl(ref, node.serviceId),
    };
  };

  async function statusOf(creds, ref) {
    const apps = [];
    let after = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await gql('instances', { p: ref.projectId, e: ref.environmentId, after }, creds);
      const env = data.environment;
      if (!env) return { state: 'unknown', detail: 'Environnement introuvable' };
      const conn = env.serviceInstances;
      for (const n of nodes(conn)) apps.push(appOf(ref, n));
      if (!conn?.pageInfo?.hasNextPage) {
        if (!apps.length) return { state: 'unknown', detail: 'Aucun service', apps };
        return { state: WORST_FIRST.find((s) => apps.some((a) => a.state === s)), detail: '', apps };
      }
      after = conn.pageInfo.endCursor;
    }
    return { state: 'unknown', detail: `Plus de ${MAX_PAGES * PAGE_SIZE} services`, note: `Plus de ${MAX_PAGES * PAGE_SIZE} services : les suivants ne sont pas lus`, apps };
  }

  // Disjoncteur à trois vitesses :
  //  - jeton refusé, quota atteint (401, 403, 429) : concerne toute la flotte, coupe tout de suite, et chaque cible porte le motif ;
  //  - délai dépassé ou erreur 5xx : coupe après SOFT_LIMIT échecs de suite (un incident isolé ne doit pas effacer la flotte) ;
  //  - erreur propre à une requête (environnement supprimé, accès retiré) : n'est jamais systémique, sauf si AUCUNE cible n'a répondu
  //    après CODELESS_LIMIT essais (schéma refusé partout).
  // Une cible non tentée (budget, coupure souple) est « sautée » : son dernier état connu reste valable.
  async function statuses(creds, refs, { deadline = Infinity } = {}) {
    const out = new Array(refs.length);
    let next = 0;
    let soft = 0;
    let codeless = 0;
    let answered = 0;
    let stop = null; // { detail, backoffMs, skipped } : posé une fois, le worker qui l'a posé remplit aussitôt tout le reste du tableau
    const worker = async () => {
      while (next < refs.length) {
        const i = next++;
        if (stop) { out[i] = { state: 'unknown', ...stop }; continue; }
        if (Date.now() > deadline) { out[i] = { state: 'unknown', detail: 'Délai dépassé pour ce relevé', skipped: true }; continue; }
        try {
          out[i] = await statusOf(creds, refs[i]);
          soft = 0;
          answered++;
        } catch (e) {
          const detail = redact(e.message, creds);
          // Quota atteint : la requête refusée n'est pas une réponse de la cible, elle est sautée comme les autres (état et rang conservés).
          out[i] = { state: 'unknown', detail, backoffMs: e.backoffMs, skipped: e.code === 'rate' ? true : undefined };
          if (e.code === 'denied') stop = { detail, backoffMs: e.backoffMs };
          else if (e.code === 'rate') stop = { detail, backoffMs: e.backoffMs, skipped: true };
          else if (e.code) { if (++soft >= SOFT_LIMIT) stop = { detail, backoffMs: e.backoffMs, skipped: true }; }
          // Le motif des cibles non tentées est neutre : l'erreur d'une cible cassée ne doit pas s'afficher sur des cibles qui n'ont rien à voir.
          else if (answered === 0 && ++codeless >= CODELESS_LIMIT) stop = { detail: 'Relevé interrompu : aucune cible n\'a répondu', skipped: true };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, refs.length) }, worker));
    return out;
  }

  function validateRef(ref) {
    if (!ref || !ref.projectId || !ref.environmentId) throw new Error('Référence Railway invalide : projet et environnement requis');
  }

  return {
    id: 'railway', label: 'Railway', secrets: [{ key: 'token', label: 'Jeton de compte' }],
    list, statuses, validateRef,
    _gql: gql, _assertReadOnly: assertReadOnly,
  };
}

module.exports = { createRailway, ENDPOINT, QUERIES };
