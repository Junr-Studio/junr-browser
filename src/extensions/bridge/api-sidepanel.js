'use strict';
// chrome.sidePanel : panneau d'extension ancré à droite des pages (une extension à la fois, dans la session du client affiché).
const { WebContentsView } = require('electron');
const { state, TOPBAR_H } = require('../../state');

const PANEL_W = 380;
const options = new Map();   // « client|extension » → { path, enabled }
const behavior = new Map();  // « client|extension » → { openPanelOnActionClick }
let panel = null;            // { view, extId, spaceId }

const key = (spaceId, extId) => `${spaceId}|${extId}`;
const defaultPath = (extId) => require('./index').manifestOf(extId)?.manifest.side_panel?.default_path;
const pathOf = (spaceId, extId) => options.get(key(spaceId, extId))?.path ?? defaultPath(extId);
const enabled = (spaceId, extId) => options.get(key(spaceId, extId))?.enabled !== false;

const width = () => (panel ? PANEL_W : 0);

function reposition() {
  if (!panel || !state.win) return;
  const { width: w, height: h } = state.win.getContentBounds();
  panel.view.setBounds({ x: Math.max(0, w - PANEL_W), y: TOPBAR_H, width: PANEL_W, height: Math.max(0, h - TOPBAR_H) });
}

function close() {
  if (!panel) return false;
  const p = panel;
  panel = null;
  try { state.win.contentView.removeChildView(p.view); p.view.webContents.close(); } catch { /* déjà fermé */ }
  require('../../tabs').layout();
  return true;
}

async function open(spaceId, extId) {
  const path = pathOf(spaceId, extId);
  if (!path || !enabled(spaceId, extId)) throw new Error('Aucun panneau latéral disponible pour cette extension');
  if (panel) close();
  const entry = state.sessions.get(spaceId);
  if (!entry) throw new Error('Client inconnu');
  await entry.ready;
  const view = new WebContentsView({ webPreferences: { session: entry.ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  view.setBackgroundColor('#ffffff');
  panel = { view, extId, spaceId };
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  state.win.contentView.addChildView(view);
  reposition();
  require('../../tabs').layout();
  await view.webContents.loadURL(`chrome-extension://${extId}/${String(path).replace(/^\//, '')}`).catch(() => {});
  return true;
}

async function toggle(spaceId, extId) {
  if (panel && panel.extId === extId && panel.spaceId === spaceId) return close() && false;
  return open(spaceId, extId);
}

module.exports = {
  ns: 'sidePanel',
  permission: 'sidePanel',
  events: [],
  methods: {
    async setOptions(ctx, o = {}) {
      const k = key(ctx.spaceId, ctx.extId);
      options.set(k, { ...(options.get(k) || {}), ...(o.path !== undefined ? { path: o.path } : {}), ...(o.enabled !== undefined ? { enabled: !!o.enabled } : {}) });
      if (panel && panel.extId === ctx.extId && o.enabled === false) close();
    },
    async getOptions(ctx) { return { enabled: enabled(ctx.spaceId, ctx.extId), path: pathOf(ctx.spaceId, ctx.extId) }; },
    async setPanelBehavior(ctx, b = {}) { behavior.set(key(ctx.spaceId, ctx.extId), { openPanelOnActionClick: !!b.openPanelOnActionClick }); },
    async getPanelBehavior(ctx) { return { openPanelOnActionClick: !!behavior.get(key(ctx.spaceId, ctx.extId))?.openPanelOnActionClick }; },
    async open(ctx) { await open(ctx.spaceId, ctx.extId); },
    async close(ctx) { if (panel && panel.extId === ctx.extId) close(); },
  },
  width, reposition, close, toggle, open,
  opensOnActionClick: (spaceId, extId) => !!behavior.get(key(spaceId, extId))?.openPanelOnActionClick,
  isOpen: () => (panel ? { extId: panel.extId, spaceId: panel.spaceId } : null),
  _view: () => panel?.view,
  onExtensionRemoved(extId) { if (panel?.extId === extId) close(); for (const m of [options, behavior]) for (const k of [...m.keys()]) if (k.endsWith('|' + extId)) m.delete(k); },
};
