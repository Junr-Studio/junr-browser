'use strict';
// Installation depuis la page du Chrome Web Store. Le bouton « Ajouter à Chrome » appelle chrome.webstorePrivate, que fournit la couche
// navigateur de Chrome et que l'Electron embarqué n'a pas : le bouton ne fait donc rien. Un préchargement (webstore-preload.js) intercepte
// le clic et le signale ici ; on installe alors l'extension par son identifiant, comme le fait Réglages › Extensions.
const path = require('node:path');
const { ipcMain } = require('electron');

const PRELOAD = path.join(__dirname, 'webstore-preload.js');
const STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//;

const isStoreUrl = (url) => STORE.test(String(url || ''));
const idOf = (url) => (isStoreUrl(url) ? /\/detail\/(?:[^/?#]+\/)?([a-p]{32})(?:[/?#]|$)/.exec(String(url))?.[1] || null : null);

function attachSession(ses) {
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD });
}

// L'identifiant vient toujours de l'adresse de l'onglet qui a envoyé la demande, jamais de son contenu.
function register({ install, notify }) {
  ipcMain.on('junr:webstore-install', (e) => {
    if (e.senderFrame !== e.sender.mainFrame) return;
    const id = idOf(e.sender.getURL());
    if (!id) { notify('Ouvrez la page d\'une extension pour l\'installer.'); return; }
    notify('Installation en cours…', 30000);
    install(id).then(
      (rec) => notify(`Extension installée : ${rec.name || id}`),
      (err) => notify(`Installation impossible : ${String(err.message || err).split('\n')[0].slice(0, 160)}`, 9000),
    );
  });
}

module.exports = { attachSession, register, isStoreUrl, idOf };
