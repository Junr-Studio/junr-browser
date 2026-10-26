'use strict';
// Menu contextuel des pages : entrées usuelles du navigateur + entrées déclarées par les extensions du client (chrome.contextMenus).
const { Menu, clipboard } = require('electron');
const { state } = require('./state');

function show(tab, wc, params) {
  const tabs = require('./tabs');
  const open = (url) => { if (/^https?:/i.test(url)) tabs.activateTab(tabs.addTab({ spaceId: tab.spaceId, url, groupId: require('./groups').groupOf(tab) }).id); };
  const sep = { type: 'separator' };
  const t = [];
  const flags = params.editFlags || {};

  if (params.linkURL) {
    t.push({ label: 'Ouvrir le lien dans un nouvel onglet', click: () => open(params.linkURL) },
      { label: 'Copier l\'adresse du lien', click: () => clipboard.writeText(params.linkURL) }, sep);
  }
  if (params.mediaType === 'image' && params.srcURL) {
    t.push({ label: 'Ouvrir l\'image dans un nouvel onglet', click: () => open(params.srcURL) },
      { label: 'Copier l\'image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copier l\'adresse de l\'image', click: () => clipboard.writeText(params.srcURL) }, sep);
  }
  if (params.isEditable) {
    t.push({ label: 'Annuler', role: 'undo', enabled: flags.canUndo }, { label: 'Rétablir', role: 'redo', enabled: flags.canRedo }, sep,
      { label: 'Couper', role: 'cut', enabled: flags.canCut }, { label: 'Copier', role: 'copy', enabled: flags.canCopy },
      { label: 'Coller', role: 'paste', enabled: flags.canPaste }, { label: 'Tout sélectionner', role: 'selectAll', enabled: flags.canSelectAll });
  } else if (params.selectionText) {
    const q = params.selectionText.trim().slice(0, 40);
    t.push({ label: 'Copier', role: 'copy' },
      { label: `Rechercher « ${q} »`, click: () => open(`https://duckduckgo.com/?q=${encodeURIComponent(params.selectionText.trim())}`) });
  } else if (!params.linkURL) {
    const h = wc.navigationHistory;
    t.push({ label: 'Retour', enabled: h.canGoBack(), click: () => h.goBack() }, { label: 'Avancer', enabled: h.canGoForward(), click: () => h.goForward() },
      { label: 'Actualiser', click: () => wc.reload() });
  }

  const ext = require('./extensions/bridge/api-contextmenus').menusForPage(tab.spaceId, { ...params, pageURL: params.pageURL || wc.getURL() }, tab);
  if (ext.length) t.push(sep, ...ext);
  t.push(sep, { label: 'Inspecter', accelerator: 'F12', click: () => { if (tab.id === state.activeTab) tabs.toggleDevTools({ x: params.x, y: params.y }); else wc.openDevTools({ mode: 'detach' }); } });

  const b = tab.view.getBounds();
  Menu.buildFromTemplate(t.filter((x, i, a) => !(x.type === 'separator' && (i === 0 || a[i - 1].type === 'separator' || i === a.length - 1))))
    .popup({ window: state.win, x: Math.round(params.x + b.x), y: Math.round(params.y + b.y) });
}

module.exports = { show };
