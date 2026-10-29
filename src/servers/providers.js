'use strict';
// Contrat des fournisseurs de serveurs et registre. Le noyau (observer.js) ne connaît que ce contrat, jamais un fournisseur en particulier.
//
// Un fournisseur est un objet :
//   { id, label, secrets: [{ key, label }],
//     list(creds, { deadline })  -> { targets: [{ ref, path: [{ id, name, kind }] }], notes: [string] }
//         cible  : ce que le fournisseur lit en un appel (pour Railway, un environnement)
//         path   : la hiérarchie du fournisseur jusqu'à la cible (kind : workspace | project | environment) ; sert à ranger et à masquer
//     statuses(creds, refs, { deadline })  -> [{ state, detail, apps?, backoffMs?, skipped? }]   (même ordre que refs, une entrée par cible)
//         apps       : [{ id, name, state, detail, url? }], les apps (services) de la cible ; `url` doit être en HTTPS, sans identifiants
//         note       : texte affiché dans les notes de la vue (liste tronquée, limite atteinte)
//         deadline   : ms depuis l'epoch (comparable à Date.now()) ; au-delà, on n'envoie plus rien
//         backoffMs  : le fournisseur demande de repousser le prochain relevé (quota atteint)
//         skipped    : cible non tentée ; son dernier état connu reste valable (le noyau ne l'écrase pas)
//     validateRef?(ref)      -> lève si la référence d'une cible est inutilisable }
// `creds` porte les secrets en clair, uniquement le temps d'un appel. `ref` est opaque pour le noyau.

const STATES = Object.freeze(['online', 'deploying', 'failed', 'unknown']);
const MAX_APPS_PER_TARGET = 1000;
const MAX_TEXT = 200;

const registry = new Map();

// Identifiant de nœud ou d'app : sans barre (les clés de masquage les joignent par « / »), jamais vide.
const validId = (id) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);

// Adresse que le noyau accepte d'ouvrir : HTTPS, un hôte, aucun identifiant glissé devant l'hôte.
function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 1000) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? u.href : undefined;
  } catch { return undefined; }
}

function register(provider) {
  if (!provider || !provider.id || typeof provider.list !== 'function' || typeof provider.statuses !== 'function') throw new Error('Fournisseur invalide');
  registry.set(provider.id, provider);
}

function get(id) {
  const p = registry.get(id);
  if (!p) throw new Error(`Fournisseur inconnu : ${id}`);
  return p;
}

// Ce que l'interface a le droit de voir : jamais de fonction, jamais de secret.
const list = () => [...registry.values()].map(({ id, label, secrets }) => ({ id, label, secrets: secrets.map(({ key, label: l }) => ({ key, label: l })) }));

const normalize = (state) => (STATES.includes(state) ? state : 'unknown');

// Retire les secrets d'un texte avant qu'il ne soit affiché ou journalisé.
function redact(text, creds) {
  let out = String(text ?? '');
  for (const v of Object.values(creds || {})) if (typeof v === 'string' && v.length >= 4) out = out.split(v).join('[secret]');
  return out.split('\n')[0].slice(0, MAX_TEXT);
}

const MAX_BACKOFF_MS = 3600000;
const backoffOf = (v) => (Number.isFinite(v) && v > 0 ? Math.min(v, MAX_BACKOFF_MS) : undefined);

// Apps d'une cible : nombre et longueur des textes bornés, état dans le jeu commun, adresse gardée seulement si elle est en HTTPS
// (le noyau l'ouvre dans un onglet : un `javascript:` ou un `file:` venu d'un fournisseur ne doit jamais passer).
function cleanApps(apps, creds) {
  if (!Array.isArray(apps)) return undefined;
  return apps.filter((a) => validId(a?.id)).slice(0, MAX_APPS_PER_TARGET).map((a) => ({
    id: a.id,
    name: String(a?.name ?? '').slice(0, MAX_TEXT),
    state: normalize(a?.state),
    detail: redact(a?.detail, creds),
    url: httpsUrl(a?.url),
  }));
}

// Ne lève jamais : un fournisseur en panne rend toutes ses cibles « inconnu » avec le motif, sans toucher aux autres fournisseurs.
async function safeStatuses(provider, creds, refs, opts = {}) {
  try {
    const got = await provider.statuses(creds, refs, opts);
    return refs.map((_, i) => ({
      state: normalize(got?.[i]?.state), detail: redact(got?.[i]?.detail, creds), apps: cleanApps(got?.[i]?.apps, creds),
      note: got?.[i]?.note ? redact(got[i].note, creds) : undefined,
      backoffMs: backoffOf(got?.[i]?.backoffMs), skipped: got?.[i]?.skipped === true ? true : undefined,
    }));
  } catch (e) {
    const detail = redact(e && e.message ? e.message : e, creds);
    return refs.map(() => ({ state: 'unknown', detail }));
  }
}

module.exports = { STATES, validId, httpsUrl, register, get, list, normalize, redact, safeStatuses };
