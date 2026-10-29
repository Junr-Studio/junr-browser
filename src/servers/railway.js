'use strict';
// Fournisseur Railway, en lecture seule (ADR-1). Un seul chemin réseau, `gql()`, qui n'envoie que les requêtes figées de QUERIES :
// aucun texte saisi par l'utilisateur n'est jamais envoyé, et tout texte qui ressemble à une écriture est refusé avant l'envoi.
// Jeton attendu : jeton de compte (il faut `me` pour lister les espaces de travail), posé à la main dans les Réglages.
const crypto = require('node:crypto');
const { redact } = require('./providers');

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const TIMEOUT_MS = 20000;
const MAX_PROJECTS = 200;
const PARALLEL = 4;
const SOFT_LIMIT = 3;                  // échecs consécutifs (délai, erreur 5xx) qui coupent le relevé
const CODELESS_LIMIT = 10;             // erreurs propres à une requête, sans aucune réponse valable, qui coupent le relevé
const MAX_BODY = 5 * 1000 * 1000;      // une réponse annoncée plus grosse n'est pas lue ; une autre est refusée après lecture
const PROJECTS_TTL_MS = 60 * 1000;     // la liste des projets d'un espace ne change pas entre deux dépliages
const DEFAULT_BACKOFF_MS = 60 * 1000;  // 429 sans Retry-After

// Mise en forme volontairement serrée : les doubles de test reconnaissent une requête à un fragment de son texte.
const QUERIES = Object.freeze({
  workspaces: 'query Workspaces { me { workspaces { id name } } }',
  projects: `query Projects($w: String!) { projects(workspaceId: $w, first: ${MAX_PROJECTS}) { edges { node { id name environments { edges { node { id name } } } services { edges { node { id name } } } } } } }`,
  deployments: 'query Deployments($p: String!, $e: String!, $s: String!) { deployments(first: 5, input: { projectId: $p, environmentId: $e, serviceId: $s }) { edges { node { id status createdAt } } } }',
});

const WRITE_OPS = /\b(mutation|subscription)\b/i;

const STATE_OF = {
  SUCCESS: 'online',
  BUILDING: 'deploying', DEPLOYING: 'deploying', INITIALIZING: 'deploying', QUEUED: 'deploying', WAITING: 'deploying', NEEDS_APPROVAL: 'deploying',
  FAILED: 'failed', CRASHED: 'failed',
};
const IGNORED = new Set(['REMOVED', 'REMOVING', 'SKIPPED']); // un déploiement retiré ne dit rien de l'état courant : le suivant décide

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

  // Projets d'un espace de travail, gardés une minute. La clé porte l'empreinte du jeton, jamais le jeton ; la promesse est gardée,
  // donc deux dépliages simultanés ne font qu'une requête ; une requête en échec n'est pas gardée.
  const projectsCache = new Map(); // empreinte du jeton + espace de travail -> { at, promise }
  function projectsOf(creds, workspace) {
    const now = Date.now();
    for (const [k, v] of projectsCache) if (now - v.at >= PROJECTS_TTL_MS) projectsCache.delete(k);
    const key = `${crypto.createHash('sha256').update(creds.token).digest('hex')}:${workspace}`;
    const hit = projectsCache.get(key);
    if (hit) return hit.promise;
    const promise = gql('projects', { w: workspace }, creds).then((data) => nodes(data.projects));
    projectsCache.set(key, { at: now, promise });
    promise.catch(() => projectsCache.delete(key));
    return promise;
  }

  async function browse(creds, path = []) {
    if (path.length === 0) {
      try {
        const data = await gql('workspaces', {}, creds);
        return (data.me?.workspaces || []).map(({ id, name }) => ({ id, name }));
      } catch (e) {
        if (/jeton/.test(e.message)) throw e;
        throw new Error(`${e.message} (un jeton de compte est nécessaire pour lister les espaces de travail)`);
      }
    }
    const projects = await projectsOf(creds, path[0]);
    if (path.length === 1) {
      const out = projects.map(({ id, name }) => ({ id, name }));
      if (projects.length >= MAX_PROJECTS) out.push({ id: '__truncated', name: `Liste tronquée aux ${MAX_PROJECTS} premiers projets`, truncated: true });
      return out;
    }
    const project = projects.find((p) => p.id === path[1]);
    if (!project) throw new Error('Railway : projet introuvable');
    const envs = nodes(project.environments);
    const out = [];
    for (const service of nodes(project.services)) {
      for (const env of envs) {
        const label = `${service.name} (${env.name})`;
        out.push({ id: `${service.id}:${env.id}`, name: label, app: { ref: { projectId: project.id, environmentId: env.id, serviceId: service.id }, label, project: project.name } });
      }
    }
    return out;
  }

  // Le dernier déploiement qui compte décide ; un échec reste affiché tant qu'un déploiement plus récent n'a pas réussi.
  async function statusOf(creds, ref) {
    const data = await gql('deployments', { p: ref.projectId, e: ref.environmentId, s: ref.serviceId }, creds);
    const latest = nodes(data.deployments).find((d) => !IGNORED.has(d.status));
    if (!latest) return { state: 'unknown', detail: 'Aucun déploiement' };
    return { state: STATE_OF[latest.status] || 'unknown', detail: latest.status };
  }

  // Disjoncteur à trois vitesses :
  //  - jeton refusé, quota atteint (401, 403, 429) : concerne toute la flotte, coupe tout de suite, et chaque app porte le motif ;
  //  - délai dépassé ou erreur 5xx : coupe après SOFT_LIMIT échecs de suite (un incident isolé ne doit pas effacer la flotte) ;
  //  - erreur propre à une requête (service supprimé, accès retiré) : n'est jamais systémique, sauf si AUCUNE app n'a répondu après
  //    CODELESS_LIMIT essais (schéma refusé partout).
  // Une app non tentée (budget, coupure souple) est « sautée » : son dernier état connu reste valable.
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
          // Quota atteint : la requête refusée n'est pas une réponse de l'app, elle est sautée comme les autres (état et rang conservés).
          out[i] = { state: 'unknown', detail, backoffMs: e.backoffMs, skipped: e.code === 'rate' ? true : undefined };
          if (e.code === 'denied') stop = { detail, backoffMs: e.backoffMs };
          else if (e.code === 'rate') stop = { detail, backoffMs: e.backoffMs, skipped: true };
          else if (e.code) { if (++soft >= SOFT_LIMIT) stop = { detail, backoffMs: e.backoffMs, skipped: true }; }
          // Le motif des apps non tentées est neutre : l'erreur d'une app cassée ne doit pas s'afficher sur des apps qui n'ont rien à voir.
          else if (answered === 0 && ++codeless >= CODELESS_LIMIT) stop = { detail: 'Relevé interrompu : aucune app n\'a répondu', skipped: true };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, refs.length) }, worker));
    return out;
  }

  function validateRef(ref) {
    if (!ref || !ref.projectId || !ref.environmentId || !ref.serviceId) throw new Error('Référence Railway invalide : projet, environnement et service requis');
  }

  return {
    id: 'railway', label: 'Railway', secrets: [{ key: 'token', label: 'Jeton de compte' }],
    browse, statuses, validateRef,
    _gql: gql, _assertReadOnly: assertReadOnly, _cacheKeys: () => [...projectsCache.keys()],
  };
}

module.exports = { createRailway, ENDPOINT, QUERIES };
