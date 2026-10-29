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

// chrome.action.setPopup : une extension (Passbolt, une fois configurée) choisit son popup à l'exécution, sans default_popup dans le manifeste.
const overrides = new Map(); // extId → chemin dans l'extension ('' : plus de popup)
const clean = (p) => String(p || '').replace(/^chrome-extension:\/\/[a-p]{32}\//, '').replace(/^\//, '');
function setPopup(id, popup) { overrides.set(id, clean(popup)); }
// Popup à ouvrir pour cette extension : celui posé à l'exécution, sinon celui du manifeste.
function pathFor(id) {
  if (overrides.has(id)) return overrides.get(id) || null;
  const rec = manager.records()[id];
  return (rec && manager.popupPath(rec)) || null;
}

// Une extension qui ouvre son popup elle-même (chrome.action.openPopup, depuis son service worker) ne sait pas où est son icône :
// on retient le bord droit du dernier clic sur celle-ci, sinon le popup se colle au bord droit de la fenêtre, côté barre d'extensions.
const anchors = new Map(); // extId → bord droit de son icône, en pixels de la fenêtre
function noteAnchor(id, x) { if (x > 0) anchors.set(id, x); }

function reposition() {
  if (!view || !state.win) return;
  const { width, height } = state.win.getContentBounds();
  const x = Math.max(SIDEBAR_W, Math.min((anchorX || width) - W + 30, width - W - 8));
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
  const rel = pathFor(id);
  if (!rel) return false;
  const tab = state.tabs.get(state.activeTab);
  const spaceId = tab?.spaceId || state.activeSpace;
  const entry = state.sessions.get(spaceId);
  if (!entry) return false;
  await entry.ready;
  noteAnchor(id, x);
  view = new WebContentsView({ webPreferences: { session: entry.ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  extId = id; anchorX = anchors.get(id) || 0;
  // Le service worker doit savoir, avant que la page ne se connecte, que cette vue est un popup et non un onglet.
  const mine = view;
  await require('./bridge').popupTab(spaceId, id, mine.webContents.id);
  if (view !== mine) { if (!mine.webContents.isDestroyed()) mine.webContents.close(); return false; } // refermé ou remplacé pendant l'attente
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

module.exports = { toggle, close, setPopup, pathFor, noteAnchor, reposition, isOpen, _view: () => view, _setAutoClose: (v) => { autoClose = v; } };
