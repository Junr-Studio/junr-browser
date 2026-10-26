'use strict';
// Identité visuelle d'un lieu de travail : monogramme du client, zone (client / commun / interne), épaisseur du cadre.
const { state, FRAME_W, FRAME_CRITICAL_W } = require('./state');

// Deux lettres : initiales des deux premiers mots (« Acme Corp » → AC), sinon les deux premières lettres (« Globex » → GL).
function glyph(name) {
  const words = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return '??';
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}

// « client » : un onglet d'un client ; « commun » : un outil partagé (aucun client) ; « interne » : une page de l'application.
function zoneOf(tab) {
  if (!tab) return 'client';
  if (tab.internal) return 'interne';
  return tab.spaceId === 'global' ? 'commun' : 'client';
}

const clientOf = (spaceId) => state.store.data.clients.find((c) => c.id === spaceId) || null;

// Liseré d'identité en haut de la barre : plus épais pour un client marqué « sensible » (n'entame jamais la page).
function frameW() {
  const tab = state.tabs.get(state.activeTab);
  const c = zoneOf(tab) === 'client' ? clientOf(tab ? tab.spaceId : state.activeSpace) : null;
  return c?.critical ? FRAME_CRITICAL_W : FRAME_W;
}

module.exports = { glyph, zoneOf, clientOf, frameW };
