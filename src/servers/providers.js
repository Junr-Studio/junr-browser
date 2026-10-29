'use strict';
// Contrat des fournisseurs de serveurs et registre. Le noyau (observer.js) ne connaît que ce contrat, jamais un fournisseur en particulier.
//
// Un fournisseur est un objet :
//   { id, label, secrets: [{ key, label }],
//     browse(creds, path)    -> [{ id, name, app?: { ref, label, project }, truncated? }]   (sans `app` : le nœud se déroule)
//     statuses(creds, refs, { deadline })  -> [{ state, detail, backoffMs?, skipped? }]   (même ordre que refs)
//         deadline   : ms depuis l'epoch (comparable à Date.now()) ; au-delà, on n'envoie plus rien
//         backoffMs  : le fournisseur demande de repousser le prochain relevé (quota atteint)
//         skipped    : app non tentée ; son dernier état connu reste valable (le noyau ne l'écrase pas)
//     validateRef?(ref)      -> lève si la référence d'une app est inutilisable }
// `creds` porte les secrets en clair, uniquement le temps d'un appel. `ref` est opaque pour le noyau.

const STATES = Object.freeze(['online', 'deploying', 'failed', 'unknown']);

const registry = new Map();

function register(provider) {
  if (!provider || !provider.id || typeof provider.browse !== 'function' || typeof provider.statuses !== 'function') throw new Error('Fournisseur invalide');
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
  return out.split('\n')[0].slice(0, 200);
}

const MAX_BACKOFF_MS = 3600000;
const backoffOf = (v) => (Number.isFinite(v) && v > 0 ? Math.min(v, MAX_BACKOFF_MS) : undefined);

// Ne lève jamais : un fournisseur en panne rend toutes ses apps « inconnu » avec le motif, sans toucher aux autres fournisseurs.
async function safeStatuses(provider, creds, refs, opts = {}) {
  try {
    const got = await provider.statuses(creds, refs, opts);
    return refs.map((_, i) => ({ state: normalize(got?.[i]?.state), detail: redact(got?.[i]?.detail, creds), backoffMs: backoffOf(got?.[i]?.backoffMs), skipped: got?.[i]?.skipped === true ? true : undefined }));
  } catch (e) {
    const detail = redact(e && e.message ? e.message : e, creds);
    return refs.map(() => ({ state: 'unknown', detail }));
  }
}

module.exports = { STATES, register, get, list, normalize, redact, safeStatuses };
