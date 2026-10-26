'use strict';
// Permissions web par site et par client : demande à l'utilisateur, choix mémorisé dans le store.
const { state } = require('./state');
const dialog = require('./dialog');

// « display-capture » : le sélecteur d'écran (src/displaymedia.js) est la demande, le choix de l'utilisateur est le consentement.
const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'display-capture']);
const PROMPTED = new Set(['geolocation', 'notifications', 'clipboard-read', 'midi', 'camera', 'microphone']);

const LABELS = {
  geolocation: 'connaître votre position',
  notifications: 'vous envoyer des notifications',
  'clipboard-read': 'lire le presse-papiers',
  midi: 'utiliser des périphériques MIDI',
  camera: 'utiliser votre caméra',
  microphone: 'utiliser votre micro',
};

const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };
const table = (spaceId, origin) => ((state.store.data.permissions[spaceId] ||= {})[origin] ||= {});

// Traduit une demande Electron en liste de clés de permission (media → camera / microphone).
function keysFor(permission, details = {}) {
  if (permission === 'media') {
    const types = details.mediaTypes || (details.mediaType ? [details.mediaType] : []);
    const keys = [];
    if (types.includes('video')) keys.push('camera');
    if (types.includes('audio')) keys.push('microphone');
    return keys.length ? keys : ['camera', 'microphone'];
  }
  return [permission];
}

function stored(spaceId, origin, key) {
  return state.store.data.permissions[spaceId]?.[origin]?.[key];
}

function remember(spaceId, origin, key, decision) {
  table(spaceId, origin)[key] = decision;
  state.store.save();
}

// Vérification synchrone (Electron n'autorise pas de dialogue ici) : seul un « autoriser » mémorisé passe.
// Une page d'extension peut utiliser caméra/micro/capture sans demande si son manifeste déclare la permission correspondante.
function extensionAllows(extId, keys) {
  let m;
  try { m = require('./extensions/bridge').manifestOf(extId)?.manifest; } catch { return false; }
  const perms = new Set(m?.permissions || []);
  // getUserMedia({ chromeMediaSource: 'desktop' | 'tab' }) arrive ici comme une demande « media » vidéo/audio : on ne peut pas la
  // distinguer d'une caméra ; une extension déclarant desktopCapture/tabCapture y a donc aussi droit.
  const ok = { camera: ['videoCapture', 'desktopCapture', 'tabCapture'], microphone: ['audioCapture', 'desktopCapture', 'tabCapture'] };
  return keys.length > 0 && keys.every((k) => (ok[k] || []).some((p) => perms.has(p)));
}

function check(spaceId, origin, permission, details) {
  if (ALWAYS_ALLOWED.has(permission)) return true;
  if (origin && origin.startsWith('chrome-extension://')) return extensionAllows(origin.slice('chrome-extension://'.length).replace(/\/.*$/, ''), keysFor(permission, details));
  const keys = keysFor(permission, details);
  if (!keys.every((k) => PROMPTED.has(k))) return false;
  return !!origin && keys.every((k) => stored(spaceId, origin, k) === 'allow');
}

const inflight = new Map();

// Demande asynchrone : consulte le choix mémorisé, sinon interroge l'utilisateur.
async function request(spaceId, requestingUrl, permission, details) {
  if (ALWAYS_ALLOWED.has(permission)) return true;
  const keys = keysFor(permission, details);
  if (!keys.every((k) => PROMPTED.has(k))) return false;
  const origin = originOf(requestingUrl);
  if (origin && new URL(origin).protocol === 'chrome-extension:') return extensionAllows(new URL(origin).hostname, keys);
  if (!origin || !/^https?:$/.test(new URL(origin).protocol)) return false;

  if (keys.some((k) => stored(spaceId, origin, k) === 'deny')) return false;
  const unknown = keys.filter((k) => !stored(spaceId, origin, k));
  if (!unknown.length) return true;

  const flight = `${spaceId}|${origin}|${unknown.join(',')}`;
  if (inflight.has(flight)) return inflight.get(flight);
  const p = (async () => {
    const space = state.store.data.clients.find((c) => c.id === spaceId);
    const what = unknown.map((k) => LABELS[k]).join(' et ');
    const answer = await dialog.show({
      kind: 'confirm',
      title: `${origin} souhaite ${what}`,
      message: `${space ? `Client : ${space.name}.\n` : ''}Le choix est mémorisé pour ce site dans ce client ; il se modifie dans Réglages › Permissions.`,
      buttons: [{ id: 'deny', label: 'Refuser' }, { id: 'allow', label: 'Autoriser', style: 'primary' }],
    });
    // Fermer le dialogue sans répondre refuse cette fois-ci sans mémoriser.
    if (answer !== 'allow' && answer !== 'deny') return false;
    for (const k of unknown) remember(spaceId, origin, k, answer);
    return answer === 'allow';
  })().finally(() => inflight.delete(flight));
  inflight.set(flight, p);
  return p;
}

function install(ses, spaceId) {
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    request(spaceId, details?.requestingUrl || wc?.getURL(), permission, details).then(cb, () => cb(false));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    const origin = originOf(requestingOrigin) || originOf(details?.requestingUrl || '');
    return check(spaceId, origin, permission, details);
  });
}

function list() {
  const out = [];
  for (const [spaceId, origins] of Object.entries(state.store.data.permissions)) {
    for (const [origin, perms] of Object.entries(origins)) {
      for (const [permission, decision] of Object.entries(perms)) out.push({ spaceId, origin, permission, decision });
    }
  }
  return out;
}

function set(spaceId, origin, permission, decision) {
  if (!['allow', 'deny'].includes(decision)) throw new Error('décision invalide');
  remember(spaceId, origin, permission, decision);
}

function remove(spaceId, origin, permission) {
  const o = state.store.data.permissions[spaceId]?.[origin];
  if (!o) return;
  delete o[permission];
  if (!Object.keys(o).length) delete state.store.data.permissions[spaceId][origin];
  state.store.save();
}

function removeSpace(spaceId) {
  delete state.store.data.permissions[spaceId];
  state.store.save();
}

module.exports = { install, request, check, list, set, remove, removeSpace, LABELS };
