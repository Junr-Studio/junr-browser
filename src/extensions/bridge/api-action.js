'use strict';
// chrome.action : Electron fournit setBadgeText, setTitle… mais n'émet jamais onClicked. Ce module ajoute onClicked
// (clic sur l'icône d'une extension sans popup, voir src/extensions/actions.js) et openPopup.
module.exports = {
  ns: 'action',
  permission: null,
  events: ['onClicked'],
  methods: {
    async setPopup(ctx, d = {}) { require('../popup').setPopup(ctx.extId, d.popup); },
    async getPopup(ctx) { return require('../popup').pathFor(ctx.extId) || ''; },
    async openPopup(ctx) {
      const ok = await require('../popup').toggle(ctx.extId, 0);
      if (!ok) throw new Error('Aucun popup à ouvrir pour cette extension');
    },
  },
};
