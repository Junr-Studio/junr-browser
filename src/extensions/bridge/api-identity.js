'use strict';
// chrome.identity : launchWebAuthFlow (OAuth dans une fenêtre dédiée, redirection interceptée sur https://<id>.chromiumapp.org/)
// et getRedirectURL. Les jetons Google (getAuthToken) ne sont pas disponibles : Junr Browser n'a pas de compte Google.
const { BrowserWindow } = require('electron');
const { state } = require('../../state');

const redirectBase = (extId) => `https://${extId}.chromiumapp.org/`;

function launch(ctx, details) {
  const { url, interactive = false } = details || {};
  let target;
  try { target = new URL(url); } catch { throw new Error('Invalid url.'); }
  if (!/^https?:$/.test(target.protocol)) throw new Error('Invalid url.');
  const base = redirectBase(ctx.extId);
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520, height: 720, show: !!interactive, parent: state.win || undefined, autoHideMenuBar: true, title: `Connexion — ${ctx.ext.name}`,
      webPreferences: { session: ctx.ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const wc = win.webContents;
    let settled = false;
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); if (!win.isDestroyed()) win.destroy(); fn(); };
    const intercept = (e, u) => { if (String(u).startsWith(base)) { e.preventDefault?.(); finish(() => resolve(String(u))); } };
    wc.on('will-redirect', (e) => intercept(e, e.url));
    wc.on('will-navigate', (e) => intercept(e, e.url));
    wc.setWindowOpenHandler(({ url: u }) => { if (String(u).startsWith(base)) finish(() => resolve(String(u))); return { action: 'deny' }; });
    win.on('closed', () => finish(() => reject(new Error('The user did not approve access.'))));
    wc.on('did-fail-load', (e, code, desc, u) => { if (String(u).startsWith(base)) finish(() => resolve(String(u))); });
    // Mode non interactif : si la page de connexion s'affiche sans redirection, l'utilisateur devrait intervenir.
    const timer = setTimeout(() => finish(() => reject(new Error(interactive ? 'Authorization page could not be loaded.' : 'User interaction required.'))), Number(details.timeoutMsForNonInteractive) || (interactive ? 300000 : 15000));
    if (!interactive) wc.once('did-finish-load', () => setTimeout(() => finish(() => reject(new Error('User interaction required.'))), 500));
    wc.loadURL(target.href).catch(() => { /* did-fail-load / délai prennent le relais */ });
  });
}

module.exports = {
  ns: 'identity',
  permission: 'identity',
  events: ['onSignInChanged'],
  methods: {
    async getRedirectURL(ctx, path = '') { return redirectBase(ctx.extId) + String(path).replace(/^\//, ''); },
    launchWebAuthFlow: async (ctx, details) => launch(ctx, details),
    async getAuthToken() { throw new Error('OAuth2 : les comptes Google ne sont pas disponibles dans Junr Browser (utilisez launchWebAuthFlow)'); },
    async getProfileUserInfo() { return { email: '', id: '' }; },
    async getAccounts() { return []; },
    async removeCachedAuthToken() {},
    async clearAllCachedAuthTokens() {},
  },
};
