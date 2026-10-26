'use strict';
// Partage d'écran : navigator.mediaDevices.getDisplayMedia() des pages web et des extensions. Electron le refuse tant qu'aucun
// gestionnaire n'existe ; ici l'utilisateur choisit l'écran ou la fenêtre dans un sélecteur (le choix vaut consentement).
const { desktopCapturer } = require('electron');
const dialog = require('./dialog');
const { state } = require('./state');

// Liste les sources (écrans et fenêtres) et laisse l'utilisateur en choisir une ; null si annulé.
async function chooseSource(title, { types = ['screen', 'window'] } = {}) {
  const sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 0, height: 0 } });
  if (!sources.length) return null;
  const id = await dialog.show({
    kind: 'picker', title, buttons: [],
    items: sources.map((s) => ({ id: s.id, label: s.name || s.id, color: s.id.startsWith('screen') ? '#2456c7' : '#6b7686', hint: s.id.startsWith('screen') ? 'écran' : 'fenêtre' })),
  });
  return sources.find((s) => s.id === id) || null;
}

function install(ses) {
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const origin = (() => { try { return new URL(request.securityOrigin).host; } catch { return 'ce site'; } })();
      // Avant de partager : proposer de masquer les autres clients dans la barre latérale (ne couvre que les partages lancés ici).
      if (!state.vitrine && state.store.data.clients.length > 1) {
        const answer = await dialog.show({
          kind: 'confirm', title: 'Vous allez partager votre écran',
          message: "Masquer les autres clients dans la barre latérale ?\nCela ne masque ni les pages, ni les titres d'onglets, ni les notifications. Ne couvre que les partages lancés depuis Junr Browser.",
          buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'share', label: 'Partager sans masquer' }, { id: 'mask', label: 'Masquer et partager', style: 'primary' }],
        });
        if (answer === null || answer === 'cancel') { callback(null); return; }
        if (answer === 'mask') require('./tabs').toggleVitrine(true);
      }
      const source = await chooseSource(`${origin} souhaite partager votre écran`);
      if (!source) { callback(null); return; }
      callback({ video: source, ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    } catch { callback(null); }
  });
}

module.exports = { install, chooseSource };
