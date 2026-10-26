'use strict';
// Volets qui s'ouvrent au survol de la barre du haut (liste des clients, extensions). Les pages sont des vues natives posées
// AU-DESSUS de l'interface : un volet qui déborde sur la page doit donc être une vue à part, ajustée à sa taille (jamais plein écran,
// pour ne pas voler les clics de la page).
const path = require('node:path');
const { WebContentsView, ipcMain } = require('electron');
const { state, TOPBAR_H } = require('./state');

const PAD = 10;                                  // marge transparente à gauche, à droite et en bas (ombre du volet)
const WIDTH = { clients: 340, extensions: 320 }; // largeur du volet
const LEAVE_MS = 240;                            // temps laissé pour passer de l'icône au volet sans le fermer

let view = null;
let loaded = null;
let kind = null;
let anchor = null;       // { x, right } de l'icône qui a ouvert le volet, en pixels de la fenêtre
let height = 160;
let hot = { trigger: false, panel: false };
let leaveTimer = null;
let autoTimer = null;
let auto = false;        // ouvert tout seul (reprise) : la première frappe le referme
let byKeyboard = false;  // ouvert au clavier : il prend le focus et se referme quand il le perd

const bounds = () => state.win.getContentBounds();
const isOpen = () => !!kind;

function ensureView() {
  if (view) return loaded;
  view = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, '..', 'shell', 'flyout-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor('#00000000');
  view.setVisible(false);
  view.webContents.on('will-navigate', (e) => e.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') close();
  });
  // Ouvert au clavier, il n'a pas de souris pour le refermer : perdre le focus le ferme.
  view.webContents.on('blur', () => { if (kind && byKeyboard) { hot.trigger = false; hot.panel = false; scheduleClose(); } });
  state.win.contentView.addChildView(view);
  loaded = view.webContents.loadFile(path.join(__dirname, '..', 'shell', 'flyout.html'));
  return loaded;
}

function reposition() {
  if (!view || !kind || !state.win) return;
  const { width: W, height: H } = bounds();
  const w = (WIDTH[kind] || 320) + 2 * PAD;
  const want = kind === 'extensions' && anchor ? anchor.right - w + PAD : (anchor ? anchor.x - PAD : 0);
  const x = Math.max(0, Math.min(want, W - w));
  view.setBounds({ x, y: TOPBAR_H, width: w, height: Math.max(40, Math.min(height + PAD, H - TOPBAR_H - 4)) });
}

function clearTimers() { clearTimeout(leaveTimer); clearTimeout(autoTimer); leaveTimer = null; autoTimer = null; }

function close() {
  clearTimers();
  hot = { trigger: false, panel: false };
  if (!kind) return;
  const hadFocus = !!view && view.webContents.isFocused();
  kind = null; auto = false; byKeyboard = false;
  if (view) view.setVisible(false);
  // Le volet masqué ne doit pas garder le clavier : la page active le reprend.
  if (hadFocus) {
    const a = state.tabs.get(state.activeTab);
    if (a?.view && !a.view.webContents.isDestroyed()) a.view.webContents.focus();
  }
}

function scheduleClose() {
  clearTimeout(leaveTimer);
  if (hot.trigger || hot.panel) return;
  leaveTimer = setTimeout(() => { if (!hot.trigger && !hot.panel) close(); }, LEAVE_MS);
  leaveTimer.unref?.();
}

// opts.auto : durée (ms) d'une ouverture automatique ; opts.keyboard : ouvert au clavier (le volet prend le focus).
async function open(wanted, rect = {}, { auto: autoMs = 0, keyboard = false } = {}) {
  if (!state.win || !WIDTH[wanted]) return;
  clearTimeout(leaveTimer);
  if (kind === wanted) { if (!autoMs) hot.trigger = !keyboard; return; }
  require('./extensions/popup').close();
  // L'état est posé AVANT le chargement (la première fois il prend du temps) : une sortie de souris reçue pendant ce temps est prise en compte.
  kind = wanted;
  anchor = { x: Math.round(rect.x || 0), right: Math.round(rect.right || 0) };
  hot = { trigger: !autoMs && !keyboard, panel: false };
  auto = !!autoMs; byKeyboard = !!keyboard;
  height = 160;
  await ensureView();
  // Fermé ou remplacé entre-temps (souris repartie, dialogue ouvert) : rien à montrer.
  const abandoned = kind !== wanted || require('./dialog').isOpen() || (!hot.trigger && !hot.panel && !autoMs && !keyboard);
  if (abandoned) {
    if (kind === wanted) { kind = null; auto = false; byKeyboard = false; }
    return;
  }
  // Tout en haut de la pile des vues, sous le dialogue éventuel.
  state.win.contentView.removeChildView(view);
  state.win.contentView.addChildView(view);
  reposition();
  view.setVisible(true);
  update();
  if (keyboard) view.webContents.focus();
  if (autoMs) { autoTimer = setTimeout(() => { if (!hot.panel && !hot.trigger) close(); }, autoMs); autoTimer.unref?.(); }
}

// Envoie l'état courant au volet ouvert (appelé à chaque envoi d'état à la barre).
function update(snapshot) {
  if (!view || !kind || view.webContents.isDestroyed()) return;
  const s = snapshot || require('./tabs').snapshot();
  view.webContents.send('flyout:state', { kind, s });
}

// Une page qui se charge pendant qu'un volet est ouvert est ajoutée au-dessus de lui : on le remet en haut.
function raise() {
  if (!view || !kind || !state.win) return;
  state.win.contentView.removeChildView(view);
  state.win.contentView.addChildView(view);
}

function register() {
  const fromShell = (e) => !!state.shell && e.sender === state.shell.webContents;
  const fromFlyout = (e) => !!view && e.sender === view.webContents;
  ipcMain.handle('flyout-open', (e, wanted, rect, keyboard) => { if (fromShell(e)) return open(String(wanted), rect || {}, { keyboard: !!keyboard }); });
  ipcMain.handle('flyout-leave', (e, which) => {
    if (!fromShell(e) || which !== kind) return;
    hot.trigger = false;
    scheduleClose();
  });
  ipcMain.handle('flyout:hover', (e, on) => {
    if (!fromFlyout(e)) return;
    hot.panel = !!on;
    if (on) { clearTimeout(leaveTimer); clearTimeout(autoTimer); } else scheduleClose();
  });
  ipcMain.handle('flyout:size', (e, h) => {
    if (!fromFlyout(e)) return;
    height = Math.max(40, Math.round(Number(h) || 160));
    reposition();
  });
  ipcMain.handle('flyout:do', async (e, name, args) => {
    if (!fromFlyout(e)) throw new Error('Appel refusé');
    return act(String(name), Array.isArray(args) ? args : []);
  });
}

const tabs = () => require('./tabs');
const keepOpen = new Set(['toggle-vitrine', 'ext-pin', 'group-menu']);
// La page ne reprend pas le clavier quand le geste ouvre sa propre fenêtre (un popup d'extension se refermerait aussitôt).
const noRefocus = new Set(['ext-action', 'ext-context']);
// Gestes autorisés depuis un volet (liste fermée). Sauf mention contraire, le volet se referme et la page reprend le clavier.
const actions = {
  'switch-space': (id) => tabs().switchSpace(String(id)),
  'select-group': (spaceId, groupId) => tabs().selectGroup(String(spaceId), groupId ? String(groupId) : null),
  'create-group': (spaceId) => require('./groupui').create(String(spaceId)),
  'group-menu': (spaceId, groupId) => require('./groupui').groupMenu(String(spaceId), String(groupId)),
  'select-tab': (id) => tabs().activateTab(Number(id)),
  'resume-open': (id) => tabs().resumeOpen(Number(id)),
  'previous-space': () => tabs().goPrevious(),
  'next-signal': () => tabs().goNextSignal(),
  'toggle-vitrine': () => tabs().toggleVitrine(),
  'pick-space': () => tabs().pickSpace(),
  'update-install': () => require('./updater').install(),
  'open-settings': (section) => tabs().openInternal('settings', section || null),
  'ext-action': (id) => require('./extensions/actions').click(String(id), undefined, anchor ? anchor.right : 0),
  'ext-pin': (id, pinned) => require('./spaces').pinExtension(String(id), !!pinned),
  'ext-context': (id, x, y) => { const b = view ? view.getBounds() : { x: 0, y: 0 }; return require('./extensions/actions').contextMenu(String(id), b.x + (Number(x) || 0), b.y + (Number(y) || 0)); },
};

async function act(name, args) {
  const fn = actions[name];
  if (!fn) throw new Error(`Geste inconnu : ${name}`);
  if (!keepOpen.has(name)) close();
  const r = await fn(...args);
  if (!keepOpen.has(name) && !noRefocus.has(name)) {
    const a = state.tabs.get(state.activeTab);
    if (a?.view && !a.view.webContents.isDestroyed()) a.view.webContents.focus();
  }
  return r;
}

module.exports = {
  register, open, close, update, raise, reposition, isOpen,
  isAuto: () => !!kind && auto && !hot.panel,
  // Accès pour les tests : le survol réel passe par l'IPC.
  _view: () => view, _kind: () => kind, _hot: () => ({ ...hot }), _act: act,
  _setHot: (patch) => { hot = { ...hot, ...patch }; if (!hot.trigger && !hot.panel) scheduleClose(); else clearTimeout(leaveTimer); },
};
