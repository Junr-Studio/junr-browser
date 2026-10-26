'use strict';
// chrome.omnibox : mot-clé d'extension dans la barre d'adresse. Taper « mot-clé » + espace ouvre le mode de l'extension :
// onInputStarted, onInputChanged(texte, suggest) à chaque frappe, onInputEntered(texte, disposition) à la validation,
// onInputCancelled si l'on quitte le mode. Les suggestions renvoyées par `suggest` sont mémorisées mais pas encore affichées
// (la barre d'adresse n'a pas de liste déroulante).
const { state } = require('../../state');

const defaults = new Map();     // « client|extension » → suggestion par défaut
const suggestions = new Map();  // « client|extension » → dernières suggestions
let active = null;              // { spaceId, extId }

// Extensions du client qui déclarent un mot-clé, et le texte restant après « mot-clé ».
function match(spaceId, text) {
  const entry = state.sessions.get(spaceId);
  if (!entry) return null;
  const bridge = require('./index');
  for (const extId of entry.loaded.keys()) {
    const kw = bridge.manifestOf(extId)?.manifest.omnibox?.keyword;
    if (kw && String(text).startsWith(kw + ' ')) return { extId, keyword: kw, rest: String(text).slice(kw.length + 1) };
  }
  return null;
}

function cancel() {
  if (!active) return;
  require('./index').emit('omnibox.onInputCancelled', [], active);
  active = null;
}

// Frappe dans la barre d'adresse.
function typing(spaceId, text) {
  const hit = match(spaceId, text);
  const bridge = require('./index');
  if (!hit) { cancel(); return false; }
  if (!active || active.extId !== hit.extId || active.spaceId !== spaceId) {
    cancel();
    active = { spaceId, extId: hit.extId };
    bridge.emit('omnibox.onInputStarted', [], active);
  }
  bridge.emit('omnibox.onInputChanged', [hit.rest], active);
  return true;
}

// Validation de la barre d'adresse : renvoie true si une extension a pris la saisie en charge.
function enter(spaceId, text, disposition = 'currentTab') {
  const hit = match(spaceId, text);
  if (!hit) { cancel(); return false; }
  require('./index').emit('omnibox.onInputEntered', [hit.rest, disposition], { spaceId, extId: hit.extId });
  active = null;
  return true;
}

module.exports = {
  ns: 'omnibox',
  permission: null,
  events: ['onInputStarted', 'onInputChanged', 'onInputEntered', 'onInputCancelled', 'onDeleteSuggestion'],
  methods: {
    async setDefaultSuggestion(ctx, s = {}) { defaults.set(`${ctx.spaceId}|${ctx.extId}`, String(s.description || '')); },
    // Appelée par le rappel `suggest` passé à onInputChanged.
    async $suggest(ctx, results) { suggestions.set(`${ctx.spaceId}|${ctx.extId}`, [].concat(results || []).slice(0, 8)); },
  },
  onExtensionRemoved(extId) { for (const m of [defaults, suggestions]) for (const k of [...m.keys()]) if (k.endsWith('|' + extId)) m.delete(k); if (active?.extId === extId) active = null; },
  typing, enter, cancel, match,
  suggestionsOf: (spaceId, extId) => suggestions.get(`${spaceId}|${extId}`) || [],
  defaultOf: (spaceId, extId) => defaults.get(`${spaceId}|${extId}`) || '',
};
