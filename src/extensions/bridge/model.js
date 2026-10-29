'use strict';
// Modèle d'onglets et de fenêtre tel que le voient les extensions (objets chrome.tabs.Tab et chrome.windows.Window).
// L'identifiant d'onglet est celui de la vue web (webContents.id), comme dans l'API native d'Electron : les appels natifs
// (tabs.query, tabs.sendMessage, scripting.executeScript) et les appels pontés désignent donc le même onglet.
const { state, HOME_URL } = require('../../state');

const WINDOW_ID = 0; // Electron numérote l'unique fenêtre 0 dans tabs.query : on reste cohérent

const wcOf = (tab) => (tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null);

// Onglets chargés (donc dotés d'une vue) d'un client ; les onglets en veille n'existent pas pour les extensions.
function tabsOfSpace(spaceId) {
  return [...state.tabs.values()].filter((t) => t.spaceId === spaceId && !t.internal && wcOf(t));
}

const tabByWcId = (id) => [...state.tabs.values()].find((t) => !t.internal && t.view && t.view.webContents.id === id) || null;

// Onglet désigné par l'extension : identifiant explicite (doit appartenir à sa session) ou onglet actif de son client.
function resolveTab(ctx, tabId) {
  if (tabId === undefined || tabId === null) {
    const active = state.tabs.get(state.activeTab);
    if (active && active.spaceId === ctx.spaceId && wcOf(active)) return active;
    const mine = tabsOfSpace(ctx.spaceId);
    const last = state.tabs.get(state.lastTabBySpace[ctx.spaceId]);
    return (last && wcOf(last) && last) || mine[0] || null;
  }
  const t = tabByWcId(Number(tabId));
  return t && t.spaceId === ctx.spaceId ? t : null;
}

function canSeeUrl(ctx, url) {
  if (!url) return true;
  if (ctx.has('tabs')) return true;
  if (url.startsWith(`chrome-extension://${ctx.extId}/`)) return true;
  return ctx.hostAllowed(url);
}

// Onglet actif de son client : celui qui est affiché si le client l'est, sinon le dernier consulté (chaque client a sa « fenêtre »).
function isActive(tab) {
  if (tab.spaceId === 'global' || state.activeSpace === tab.spaceId) return state.activeTab === tab.id;
  const last = state.tabs.get(state.lastTabBySpace[tab.spaceId]);
  if (last && wcOf(last)) return last.id === tab.id;
  // Client jamais affiché (ou dernier onglet en veille) : le premier onglet chargé fait office d'onglet actif, il y en a toujours un.
  const first = [...state.tabs.values()].filter((t) => t.spaceId === tab.spaceId && !t.internal && wcOf(t)).sort((a, b) => a.id - b.id)[0];
  return first?.id === tab.id;
}

function tabInfo(ctx, tab) {
  const wc = wcOf(tab);
  if (!wc) return null;
  const url = wc.getURL() || tab.url;
  const visible = canSeeUrl(ctx, url);
  const siblings = tabsOfSpace(tab.spaceId).sort((a, b) => a.id - b.id);
  const bounds = tab.view.getBounds();
  const info = {
    id: wc.id, index: Math.max(0, siblings.indexOf(tab)), windowId: WINDOW_ID, groupId: -1,
    active: isActive(tab), highlighted: isActive(tab), selected: isActive(tab),
    pinned: false, discarded: false, autoDiscardable: true, incognito: false,
    status: wc.isLoading() ? 'loading' : 'complete', audible: wc.isCurrentlyAudible(), mutedInfo: { muted: wc.audioMuted },
    width: bounds.width, height: bounds.height,
  };
  if (visible) { info.url = url; info.title = wc.getTitle() || tab.title || ''; if (tab.favIconUrl) info.favIconUrl = tab.favIconUrl; }
  return info;
}

function windowInfo(ctx, populate) {
  const w = state.win;
  const b = w.getBounds();
  const fullscreen = w.isFullScreen(), max = w.isMaximized(), min = w.isMinimized();
  const info = {
    id: WINDOW_ID, focused: w.isFocused(), alwaysOnTop: w.isAlwaysOnTop(), incognito: false, type: 'normal',
    state: fullscreen ? 'fullscreen' : min ? 'minimized' : max ? 'maximized' : 'normal',
    left: b.x, top: b.y, width: b.width, height: b.height, sessionId: undefined,
  };
  if (populate) info.tabs = tabsOfSpace(ctx.spaceId).sort((a, c) => a.id - c.id).map((t) => tabInfo(ctx, t));
  return info;
}

// Adresses qu'une extension peut ouvrir : http(s), about:blank, ses propres pages. Jamais javascript:, file:, data:…
function checkOpenableUrl(ctx, url) {
  const u = String(url);
  if (u === 'about:blank') return u;
  let p;
  try { p = new URL(u); } catch { throw new Error(`URL invalide : ${u}`); }
  if (/^https?:$/.test(p.protocol)) return p.href;
  if (p.protocol === 'chrome-extension:' && p.hostname === ctx.extId) return p.href;
  throw new Error(`Ouverture refusée : ${p.protocol}`);
}

module.exports = { isActive, WINDOW_ID, wcOf, tabsOfSpace, tabByWcId, resolveTab, tabInfo, windowInfo, canSeeUrl, checkOpenableUrl };

// Ouvre un onglet pour une extension. Un client en arrière-plan ne vole jamais l'affichage : l'onglet est chargé sans être activé.
async function createTab(ctx, { url, active = true, openerTabId } = {}) {
  const tabs = require('../../tabs');
  const target = checkOpenableUrl(ctx, url || HOME_URL);
  const t = tabs.addTab({ spaceId: ctx.spaceId, url: target, title: target });
  if (openerTabId !== undefined) t.openerWcId = openerTabId;
  const foreground = active && (ctx.spaceId === 'global' || ctx.spaceId === state.activeSpace);
  if (foreground) await tabs.activateTab(t.id); else await tabs.loadTab(t);
  return t;
}

module.exports.createTab = createTab;
