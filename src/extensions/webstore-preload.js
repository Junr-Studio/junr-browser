'use strict';
// Préchargement des pages du Chrome Web Store : il s'exécute avant les scripts de la page, donc son écouteur passe en premier.
// Le bouton « Ajouter à Chrome » appelle chrome.webstorePrivate, absent d'Electron : on le remplace par une demande d'installation.
const { ipcRenderer } = require('electron');

(() => {
  if (window !== window.top) return;
  if (!/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//.test(location.href)) return;
  // Le texte du bouton suit la langue (« Ajouter à Chrome », « Add to Chrome »…). « Installer Chrome », qui télécharge le navigateur, n'a pas le verbe d'ajout.
  const add = /(ajouter|add|hinzufügen|añadir|aggiungi|adicionar|toevoegen).*chrome/i;
  window.addEventListener('click', (e) => {
    // Le clic tombe sur un <div> du bouton : on remonte de quelques niveaux, en ne retenant que des éléments courts (pas la page entière).
    let el = e.target instanceof Element ? e.target : null;
    let hit = false;
    for (let i = 0; el && i < 4 && !hit; i += 1, el = el.parentElement) {
      const text = el.innerText || '';
      hit = text.length < 60 && add.test(text);
    }
    if (!hit) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ipcRenderer.send('junr:webstore-install');
  }, true);
})();
