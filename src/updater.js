'use strict';
// Mise à jour de l'application. Le canal est maison : les Releases GitHub du dépôt (voir package.json → build.publish).
//   stable : releases publiées ; bêta : releases marquées « pré-version » en plus (le workflow de promotion les passe ensuite en stable).
// Le téléchargement se fait en arrière-plan ; l'installation a lieu à la fermeture de l'application ou sur demande, jamais d'office :
// des brouillons et des sessions clients peuvent être ouverts.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { state } = require('./state');

const CHANNELS = ['stable', 'beta'];
const GITHUB = { owner: 'Junr-Studio', repo: 'junr-browser' }; // mêmes valeurs que build.publish dans package.json
const FIRST_CHECK_MS = 20 * 1000;
const CHECK_EVERY_MS = 4 * 3600 * 1000;

const settings = () => state.store.data.settings;

let updater = null; // autoUpdater d'electron-updater (ou un faux, en test)
let timers = [];

state.update = { state: 'off', reason: 'Mises à jour non démarrées', next: null, percent: 0, error: '', checkedAt: 0 };
const set = (patch) => { Object.assign(state.update, patch); try { require('./tabs').push(); } catch { /* pas encore de fenêtre */ } };
const tabs = () => require('./tabs');

// Première ligne seulement : electron-updater cite parfois toute la réponse HTTP dans ses erreurs.
const clean = (e) => String((e && e.message) || e || 'erreur inconnue').split('\n')[0].slice(0, 200);

// Journal des mises à jour (userData/updater.log, tronqué au-delà de 200 Ko) : l'application n'a pas de console une fois installée.
function fileLogger() {
  const file = path.join(app.getPath('userData'), 'updater.log');
  try { if (fs.statSync(file).size > 200 * 1024) fs.rmSync(file); } catch { /* pas encore de journal */ }
  const write = (level) => (...a) => { try { fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${a.map((x) => (x && x.stack) || (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}
`); } catch { /* disque plein ou verrouillé : sans importance */ } };
  return { info: write('info'), warn: write('warn'), error: write('error'), debug: write('debug') };
}

/* ---------- Source des versions ---------- */
function feedOptions() {
  if (process.env.JUNR_UPDATE_URL) return { provider: 'generic', url: process.env.JUNR_UPDATE_URL }; // essais locaux ou serveur maison
  // En dur : electron-builder retire la clé « build » du package.json embarqué, on ne peut donc pas y relire `build.publish`.
  return { provider: 'github', owner: GITHUB.owner, repo: GITHUB.repo };
}

async function configure() {
  if (!updater) return;
  const feed = feedOptions();
  updater.setFeedURL(feed);
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  updater.channel = 'latest';
  updater.allowPrerelease = settings().updateChannel === 'beta';
}

function wire() {
  updater.on('checking-for-update', () => set({ state: 'checking', error: '' }));
  updater.on('update-available', (i) => set({ state: 'downloading', next: i.version, percent: 0 }));
  updater.on('update-not-available', () => set({ state: 'uptodate', next: null, checkedAt: Date.now() }));
  updater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (i) => {
    set({ state: 'ready', next: i.version, percent: 100, checkedAt: Date.now() });
    tabs().notify(`Mise à jour ${i.version} prête : elle s'installera à la fermeture (ou dans le volet des clients).`, 9000);
  });
  updater.on('error', (e) => set({ state: state.update.state === 'ready' ? 'ready' : 'error', error: clean(e), checkedAt: Date.now() }));
}

/* ---------- Cycle ---------- */
// `impl` : un autre autoUpdater (tests). Hors application empaquetée il n'y a rien à mettre à jour, sauf essai explicite via JUNR_UPDATE_URL.
async function start({ impl = null } = {}) {
  if (updater) return state.update;
  if (!impl && !app.isPackaged && !process.env.JUNR_UPDATE_URL) {
    set({ state: 'off', reason: 'Version de développement : pas de mise à jour automatique' });
    return state.update;
  }
  updater = impl || require('electron-updater').autoUpdater;
  if (!impl) updater.logger = fileLogger();
  wire();
  await configure();
  set({ state: 'idle', reason: '' });
  if (!impl) {
    const first = setTimeout(() => check().catch(() => {}), FIRST_CHECK_MS);
    const every = setInterval(() => check().catch(() => {}), CHECK_EVERY_MS);
    first.unref(); every.unref();
    timers = [first, every];
  }
  return state.update;
}

function stop() { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; updater = null; }

async function check({ manual = false } = {}) {
  if (!updater) return state.update;
  if (['checking', 'downloading', 'ready'].includes(state.update.state)) return state.update;
  set({ state: 'checking', error: '' });
  try { await updater.checkForUpdates(); }
  catch (e) {
    set({ state: 'error', error: clean(e), checkedAt: Date.now() });
    if (manual) tabs().notify(`Recherche de mise à jour impossible : ${state.update.error}`);
  }
  return state.update;
}

// Redémarre pour installer une mise à jour déjà téléchargée. Silencieux ; l'application se rouvre toute seule.
function install() {
  if (!updater || state.update.state !== 'ready') throw new Error('Aucune mise à jour prête');
  updater.quitAndInstall(true, true);
}

/* ---------- Réglages ---------- */
async function setChannel(channel) {
  if (!CHANNELS.includes(channel)) throw new Error('Canal inconnu (stable ou bêta)');
  settings().updateChannel = channel;
  state.store.save();
  await configure();
  if (!['downloading', 'ready'].includes(state.update.state)) check().catch(() => {});
}

function publicState() {
  const f = feedOptions();
  return {
    version: app.getVersion(), channel: settings().updateChannel,
    source: f.provider === 'github' ? `github.com/${f.owner}/${f.repo}` : f.url,
    ...state.update,
  };
}

// Ce que montre la barre : seulement ce qui demande un geste.
const brief = () => (state.update.state === 'ready' ? { state: 'ready', next: state.update.next } : null);

module.exports = { start, stop, check, install, setChannel, publicState, brief, CHANNELS };
