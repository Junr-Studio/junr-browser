'use strict';
const { app, BaseWindow, WebContentsView, Menu, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// User-Agent de navigateur : sans « Electron/x » ni nom d'application. Des extensions (LastPass…) et des sites traitent un agent « Electron »
// comme une application de bureau intégrée (ou bloquent la connexion) ; Junr Browser est un navigateur.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|junr-browser)\/\S+/gi, '');

// Modes automatiques : données dans un dossier temporaire, jamais dans le profil réel.
const MODE = process.env.JUNR_TEST ? 'test' : process.env.JUNR_SCRIPT ? 'script' : null;
// JUNR_USER_DATA permet de relancer un mode automatique sur les mêmes données (tests de redémarrage).
if (MODE) app.setPath('userData', process.env.JUNR_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'junr-run-')));

const { state, TOPBAR_H } = require('./src/state');
const { Store } = require('./src/store');
const { startDiagServer } = require('./src/diag');
const tabs = require('./src/tabs');
const spaces = require('./src/spaces');
const dialog = require('./src/dialog');
const ipc = require('./src/ipc');
const extManager = require('./src/extensions/manager');
const sessions = require('./src/sessions');
const icons = require('./src/icons');

icons.register(); // schéma des favicons : à déclarer avant « ready »

state.test = MODE === 'test';

// Durcissement : aucune vue ne peut attacher de <webview> ni ouvrir de fenêtre non contrôlée.
app.on('web-contents-created', (e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

if (!MODE && !app.requestSingleInstanceLock()) app.quit();

function seedConfig(diagUrl) {
  const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
  return JSON.parse(raw);
}

async function start(seed) {
  if (MODE) app.setPath('downloads', path.join(app.getPath('userData'), 'downloads')); // les tests n'écrivent jamais dans le vrai dossier Téléchargements
  state.store = new Store(path.join(app.getPath('userData'), 'junr-data.json'), seed);
  Menu.setApplicationMenu(null);
  // Une seule barre en haut sert aussi de barre de titre : les boutons du système se posent par-dessus (même hauteur que la barre).
  state.win = new BaseWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 560, title: 'Junr Browser',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#111a25', symbolColor: '#d5dce6', height: TOPBAR_H },
  });
  state.shell = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'shell', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  state.win.contentView.addChildView(state.shell);
  state.shell.webContents.on('before-input-event', tabs.handleInput);
  state.shell.webContents.on('will-navigate', (e) => e.preventDefault());
  state.shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  state.win.on('resize', () => { tabs.layout(); dialog.layoutDialog(); });
  const { bus } = require('./src/state');
  state.win.on('focus', () => bus.emit('window:focus'));
  state.win.on('blur', () => bus.emit('window:blur'));
  for (const ev of ['resized', 'moved', 'maximize', 'unmaximize', 'minimize', 'restore']) state.win.on(ev, () => bus.emit('window:bounds'));

  require('./src/extensions/bridge').install();
  spaces.openAllTools();
  ipc.register();

  await state.shell.webContents.loadFile(path.join(__dirname, 'shell', 'index.html'));
  tabs.layout();
  const first = state.store.data.clients[0]?.id;
  if (first) await tabs.switchSpace(first);
  else tabs.push();
  setInterval(() => tabs.sweep().catch(() => {}), 15000).unref();
  setInterval(tabs.push, 5000).unref();
  if (!MODE) {
    extManager.startUpdateTimer();
    setTimeout(() => extManager.checkUpdates().catch(() => {}), 60000).unref();
  }
}

app.whenReady().then(async () => {
  icons.install();
  state.diagUrl = await startDiagServer();
  if (MODE === 'test') {
    const smoke = require('./test/smoke');
    await start(smoke.makeConfig(state.diagUrl));
    await smoke.run({ state, tabs, spaces, ipc, extManager, sessions, session, dialog, seed: seedConfig });
  } else if (MODE === 'script') {
    const script = require(path.resolve(process.env.JUNR_SCRIPT));
    await start(script.makeConfig ? script.makeConfig(state.diagUrl) : seedConfig(state.diagUrl));
    await script.run({ state, tabs, spaces, ipc, extManager, sessions, session, dialog });
  } else {
    await start(seedConfig(state.diagUrl));
    require('./src/updater').start().catch((e) => console.error('Mises à jour :', e.message));
  }
});
app.on('window-all-closed', () => app.quit());
