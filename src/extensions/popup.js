'use strict';
// Fenêtre de popup d'une extension (clic sur son icône dans la barre). Réalisée sans `electron-chrome-extensions`
// (licence GPL-3 ou licence payante « Patron » à trancher avant de l'intégrer) : popup simple, sans chrome.tabs complet.
const { WebContentsView } = require('electron');
const { state, SIDEBAR_W, TOPBAR_H } = require('../state');
const manager = require('./manager');

const W = 380, H = 560;
let view = null;
let extId = null;
let anchorX = 0;
let autoClose = true; // les mesures automatiques (fenêtre sans focus) désactivent la fermeture à la perte de focus

const isOpen = () => !!view;

function reposition() {
  if (!view || !state.win) return;
  const { width, height } = state.win.getContentBounds();
  const x = Math.max(SIDEBAR_W, Math.min(anchorX - W + 30, width - W - 8));
  view.setBounds({ x, y: TOPBAR_H, width: W, height: Math.min(H, height - TOPBAR_H - 8) });
}

function close() {
  if (!view) return;
  const v = view;
  view = null; extId = null;
  try { state.win.contentView.removeChildView(v); v.webContents.close(); } catch { /* déjà fermée */ }
}

// Ouvre le popup de l'extension dans la session du client affiché ; un second clic le referme.
async function toggle(id, x = 0) {
  if (view && extId === id) { close(); return false; }
  close();
  const rec = manager.records()[id];
  const rel = rec && manager.popupPath(rec);
  if (!rel) return false;
  const tab = state.tabs.get(state.activeTab);
  const entry = state.sessions.get(tab?.spaceId || state.activeSpace);
  if (!entry) return false;
  await entry.ready;
  view = new WebContentsView({ webPreferences: { session: entry.ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  extId = id; anchorX = x;
  view.setBackgroundColor('#ffffff');
  state.win.contentView.addChildView(view);
  reposition();
  view.webContents.on('blur', () => setTimeout(() => { if (autoClose && view && extId === id) close(); }, 150));
  view.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') close(); });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await view.webContents.loadURL(`chrome-extension://${id}/${rel.replace(/^\//, '')}`).catch(() => {});
  view?.webContents.focus();
  return true;
}

module.exports = { toggle, close, reposition, isOpen, _view: () => view, _setAutoClose: (v) => { autoClose = v; } };
