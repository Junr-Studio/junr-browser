'use strict';
// Barre d'extensions : clic sur l'icône (popup, panneau latéral ou chrome.action.onClicked) et menu contextuel de l'icône.
const { Menu } = require('electron');
const { state } = require('./../state');
const bridge = require('./bridge');
const popup = require('./popup');
const model = require('./bridge/model');

function activeTab(spaceId) {
  const t = state.tabs.get(state.activeTab);
  return t && !t.internal && t.view && (spaceId === undefined || t.spaceId === spaceId) ? t : null;
}

// Espace dont dépend le clic : celui de l'onglet affiché (les outils communs ont leur propre instance d'extension).
async function click(extId, spaceId, x = 0) {
  const tab = activeTab();
  const space = spaceId ?? tab?.spaceId ?? state.activeSpace;
  const m = bridge.manifestOf(extId);
  if (!m) return false;
  if (popup.pathFor(extId)) return popup.toggle(extId, x);
  const side = require('./bridge/api-sidepanel');
  if (m.manifest.side_panel && side.opensOnActionClick(space, extId)) return side.toggle(space, extId);
  bridge.emit('action.onClicked', (ctx) => { const t = tab && tab.spaceId === space ? model.tabInfo(ctx, tab) : null; return t ? [t] : null; }, { spaceId: space, extId });
  return true;
}

// Menu du clic droit sur l'icône : entrées « action » de l'extension, options, gestion.
function contextMenu(extId, x, y) {
  const tab = activeTab();
  const space = tab?.spaceId ?? state.activeSpace;
  const m = bridge.manifestOf(extId);
  if (!m) return;
  const cm = require('./bridge/api-contextmenus');
  const items = cm.actionMenu(space, extId, (item) => cm.clicked(space, extId, item, {}, tab));
  const t = [{ label: m.name, enabled: false }, { type: 'separator' }];
  if (items.length) t.push(...items, { type: 'separator' });
  const options = m.manifest.options_page || m.manifest.options_ui?.page;
  if (options) t.push({ label: 'Options', click: () => openOptions(extId, space) });
  t.push({ label: 'Gérer les extensions', click: () => require('../tabs').openInternal('settings', 'extensions') });
  Menu.buildFromTemplate(t).popup({ window: state.win, x: Math.round(x), y: Math.round(y) });
}

async function openOptions(extId, spaceId) {
  const m = bridge.manifestOf(extId);
  const page = m?.manifest.options_page || m?.manifest.options_ui?.page;
  if (!page) throw new Error('Cette extension n\'a pas de page d\'options');
  const tabs = require('../tabs');
  const space = spaceId ?? state.activeSpace;
  const existing = [...state.tabs.values()].find((t) => t.spaceId === space && t.url.startsWith(`chrome-extension://${extId}/`));
  if (existing) return tabs.activateTab(existing.id);
  const t = tabs.addTab({ spaceId: space, url: `chrome-extension://${extId}/${String(page).replace(/^\//, '')}`, title: `${m.name} — Options` });
  return tabs.activateTab(t.id);
}

module.exports = { click, contextMenu, openOptions };
