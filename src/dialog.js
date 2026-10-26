'use strict';
// Fenêtre modale superposée à la page (confirmation, demande de permission, sélecteur de client).
// Les vues de pages web sont au-dessus de l'interface : le dialogue est donc une vue à part, placée tout en haut.
const path = require('node:path');
const { WebContentsView, ipcMain } = require('electron');
const { state } = require('./state');

let view = null;
let current = null; // { spec, resolve }
const queue = [];

function ensureView() {
  if (view) return view;
  view = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, '..', 'shell', 'dialog-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor('#00000000');
  view.setVisible(false);
  state.win.contentView.addChildView(view);
  view.webContents.loadFile(path.join(__dirname, '..', 'shell', 'dialog.html'));
  ipcMain.handle('dialog:answer', (e, result) => {
    if (e.sender !== view.webContents) return;
    finish(result ?? null);
  });
  return view;
}

function layoutDialog() {
  if (!view || !state.win) return;
  const { width, height } = state.win.getContentBounds();
  view.setBounds({ x: 0, y: 0, width, height });
}

function finish(result) {
  const cur = current;
  current = null;
  if (view) view.setVisible(false);
  cur?.resolve(result);
  const active = state.tabs.get(state.activeTab);
  if (active?.view && !queue.length) active.view.webContents.focus();
  next();
}

async function next() {
  if (current || !queue.length) return;
  current = queue.shift();
  require('./flyout').close();
  const v = ensureView();
  const wc = v.webContents;
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  // Remet la vue tout en haut de la pile avant de l'afficher.
  state.win.contentView.removeChildView(v);
  state.win.contentView.addChildView(v);
  layoutDialog();
  v.setVisible(true);
  wc.send('dialog:show', current.spec);
  wc.focus();
}

// spec : { kind: 'confirm'|'picker', title, message?, buttons?, items? } → résultat choisi, ou null si annulé.
function show(spec) {
  if (state.dialogAnswer) return Promise.resolve(state.dialogAnswer(spec)); // tests
  return new Promise((resolve) => {
    queue.push({ spec, resolve });
    next();
  });
}

// Une page qui se charge pendant qu'un dialogue est ouvert est ajoutée AU-DESSUS de lui : on remet le dialogue en haut de la pile.
function raise() {
  if (!view || !current || !state.win) return;
  state.win.contentView.removeChildView(view);
  state.win.contentView.addChildView(view);
}

module.exports = { show, layoutDialog, raise, isOpen: () => !!current, _view: () => view };
