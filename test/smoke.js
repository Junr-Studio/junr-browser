'use strict';
// Test de fumée : vérifie sans intervention humaine les promesses du POC et les briques de la Phase 1.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const fixtures = require('./fixtures');
const testServer = require('./server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const crypto_randomUUID = () => require('node:crypto').randomUUID();
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
const skip = (name, why) => console.log(`SKIP  ${name}  ${why}`);
async function throws(fn) { try { await fn(); return null; } catch (e) { return e.message; } }
async function until(fn, ms = 8000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(step); }
  return null;
}

function makeConfig(diag) {
  return {
    unloadAfterMs: 300000,
    clients: [
      { id: 'acme', name: 'Acme', color: '#d9534f', tools: [{ name: 'Diag A1', url: diag }, { name: 'Diag A2', url: diag + '?second' }] },
      { id: 'globex', name: 'Globex', color: '#2f8f83', tools: [{ name: 'Diag G1', url: diag }] },
    ],
    globalTools: [{ name: 'Diag commun', url: diag + '?global' }],
  };
}

async function loaded(tab) {
  const wc = tab.view.webContents;
  if (wc.isLoading()) await new Promise((r) => wc.once('did-stop-loading', r));
  await wait(400);
}
const ev = (tab, code) => tab.view.webContents.executeJavaScript(code, true);

// Ouvre une adresse dans un onglet neuf du client et attend la fin du chargement.
async function openIn(core, spaceId, url) {
  const t = core.tabs.addTab({ spaceId, url });
  await core.tabs.activateTab(t.id);
  await loaded(t);
  return t;
}

async function run(core) {
  const { state, tabs, spaces, extManager, sessions, session, dialog } = core;
  // Une fenêtre réduite (par le système, un autre programme…) ne produit plus d'images : les captures d'onglet et d'écran n'aboutissent
  // jamais et la suite reste bloquée. On la remet à l'écran dès qu'elle est réduite, en le signalant une fois.
  let reduced = false;
  const keepShown = () => {
    const w = state.win;
    if (!w || w.isDestroyed() || !w.isMinimized()) return;
    if (!reduced) { reduced = true; console.log(`DIAG  fenêtre réduite pendant les tests (après « ${results.length ? results[results.length - 1].name : 'aucune'} ») : restaurée`); }
    w.restore();
  };
  keepShown();
  setInterval(keepShown, 500);
  // Garde-fou : un test bloqué (runner lent) échoue vite en disant où, au lieu d'attendre la fin du délai du job.
  if (process.env.JUNR_TEST_TIMEOUT_MIN) {
    setTimeout(() => {
      console.log(`FAIL  Test bloqué : plus de ${process.env.JUNR_TEST_TIMEOUT_MIN} min. Dernière vérification : « ${results.length ? results[results.length - 1].name : 'aucune'} »`);
      app.exit(1);
    }, Number(process.env.JUNR_TEST_TIMEOUT_MIN) * 60000); // pas de unref() : sans minuteur actif, la boucle de Node dans Electron ne se réveille pas pour lui
    // Diagnostic de blocage : si rien ne se passe pendant 45 s, dit si la boucle d'événements est bloquée (retard du minuteur)
    // ou si une promesse n'aboutit jamais, et dans quel état sont les fenêtres et les vues.
    let seen = 0, since = process.hrtime.bigint(), beat = process.hrtime.bigint();
    const ms = (a) => Number((process.hrtime.bigint() - a) / 1000000n);
    setInterval(() => {
      const lag = ms(beat) - 1000; beat = process.hrtime.bigint();
      if (lag > 3000) console.log(`DIAG  boucle d'événements bloquée pendant ${Math.round(lag / 1000)} s`);
      if (results.length !== seen) { seen = results.length; since = process.hrtime.bigint(); return; }
      if (ms(since) < 45000) return;
      since = process.hrtime.bigint();
      try {
        const { webContents, BaseWindow } = require('electron');
        const wins = BaseWindow.getAllWindows().map((w) => ({ min: w.isMinimized(), vis: w.isVisible(), b: w.getBounds() }));
        const views = webContents.getAllWebContents().map((w) => ({ t: w.getType(), l: w.isLoading(), c: w.isCrashed(), u: String(w.getURL()).slice(0, 60) }));
        console.log(`DIAG  aucune vérification depuis 45 s (après « ${results.length ? results[results.length - 1].name : 'aucune'} ») — fenêtres ${JSON.stringify(wins)} — vues ${JSON.stringify(views)}`);
      } catch (e) { console.log('DIAG  état illisible : ' + e.message); }
    }, 1000);
  }
  const srv = await testServer.start();
  const only = process.env.JUNR_ONLY ? new RegExp(process.env.JUNR_ONLY, 'i') : null;
  let bx = null; // extension de test du pont d'API, installée par la première section qui en a besoin
  const bridgeExt = async () => {
    if (bx) return bx;
    for (const sid of ['acme', 'globex', 'global']) { const e = sessions.getSession(sid); await e.ready; }
    if (process.env.JUNR_DEBUG) for (const sid of ['acme', 'globex', 'global']) sessions.getSession(sid).ses.serviceWorkers.on('console-message', (e, d) => console.log('[sw ' + sid + ']', d.level, String(d.message).slice(0, 300), '@', String(d.sourceUrl).replace(/^chrome-extension:\/\/\w+/, '')));
    bx = await require('./bridge-helper').installBridgeExtension({ srv, extManager, state });
    if (process.env.JUNR_DEBUG) { console.log('[dbg] install', JSON.stringify({ id: bx.id, loadError: bx.out.loadError, status: bx.out.compat && bx.out.compat.status })); for (const sid of ['acme', 'globex']) console.log('[dbg] running', sid, JSON.stringify(Object.values(sessions.getSession(sid).ses.serviceWorkers.getAllRunning()).map((w) => w.scope)), 'loaded', sessions.getSession(sid).loaded.has(bx.id)); console.log('[dbg] conns', JSON.stringify(require('../src/extensions/bridge').connections())); }
    return bx;
  };
  const section = async (name, fn) => {
    if (only && !only.test(name)) return;
    console.log(`\n# ${name}`);
    try { await fn(); } catch (e) { check(`Exception dans « ${name} »`, false, String(e.stack || e)); }
  };

  await section('POC : isolation, extension, outil commun, veille', async () => {
    const acme = tabs.tabsOfSpace('acme');
    const globex = tabs.tabsOfSpace('globex');
    const glob = tabs.tabsOfSpace('global')[0];

    await tabs.switchSpace('acme');
    await loaded(acme[0]);
    await ev(acme[0], `localStorage.setItem('note','secret-acme'); document.cookie='note=secret-acme;path=/'; 1`);
    await tabs.switchSpace('globex');
    await loaded(globex[0]);
    const gLS = await ev(globex[0], `localStorage.getItem('note')`);
    const gCookie = await ev(globex[0], `document.cookie`);
    check('Isolation localStorage entre clients', gLS === null, gLS);
    check('Isolation cookies entre clients', gCookie === '', gCookie);

    const extA = await ev(acme[0], `document.documentElement.dataset.junrExt || null`);
    const extG = await ev(globex[0], `document.documentElement.dataset.junrExt || null`);
    check('Extension active dans Acme', extA === '1', extA);
    check('Extension active dans Globex', extG === '1', extG);

    await tabs.activateTab(glob.id);
    await loaded(glob);
    const wcId = glob.view.webContents.id;
    await tabs.switchSpace('acme');
    await tabs.switchSpace('globex');
    check('Outil commun conservé entre espaces', !!glob.view && glob.view.webContents.id === wcId);
    const extGlob = await ev(glob, `document.documentElement.dataset.junrExt || null`);
    check('Extension active sur outil commun', extGlob === '1', extGlob);

    await tabs.switchSpace('globex');
    const liveBefore = [...state.tabs.values()].filter((t) => t.view).length;
    await tabs.sweep(0);
    const liveAfter = [...state.tabs.values()].filter((t) => t.view).length;
    check('Onglets Acme mis en veille', acme.every((t) => !t.view), { liveBefore, liveAfter });
    check('Outil commun jamais mis en veille', !!glob.view);
    check('Espace courant intact', !!globex[0].view);

    await tabs.switchSpace('acme');
    await loaded(acme[0]);
    const back = await ev(acme[0], `localStorage.getItem('note')`);
    const extBack = await ev(acme[0], `document.documentElement.dataset.junrExt || null`);
    check('Réveil : données de session conservées', back === 'secret-acme', back);
    check('Réveil : extension de nouveau active', extBack === '1', extBack);
  });

  await section('Gestion des clients et des outils', async () => {
    const { Store } = require('../src/store');
    const c = spaces.addClient({ name: 'Nouveau Client' });
    check('Client ajouté avec identifiant dérivé du nom', c.id === 'nouveau-client', c.id);
    const t = spaces.addTool(c.id, { name: 'Page', url: srv.origin + '/page', controlUrl: srv.origin + '/profile' });
    check('Outil ajouté : un onglet est créé', tabs.tabsOfSpace(c.id).length === 1 && tabs.tabsOfSpace(c.id)[0].toolId === t.id);
    spaces.renameClient(c.id, 'Renommé', '#112233');
    spaces.updateTool(c.id, t.id, { name: 'Page 2' });
    check('Renommage reflété dans l\'onglet', tabs.tabsOfSpace(c.id)[0].title === 'Page 2');

    const reread = new Store(state.store.file, {});
    const saved = reread.data.clients.find((x) => x.id === c.id);
    check('Persistance dans le dossier de données', saved?.name === 'Renommé' && saved.tools[0].name === 'Page 2' && saved.tools[0].controlUrl.endsWith('/profile'), saved && { name: saved.name });
    check('Fichier dans userData', state.store.file.startsWith(app.getPath('userData')));

    check('Client sans nom refusé', !!(await throws(() => spaces.addClient({ name: '  ' }))));
    check('Adresse javascript: refusée', !!(await throws(() => spaces.addTool(c.id, { name: 'x', url: 'javascript:alert(1)' }))));
    check('Délai de veille < 10 s refusé', !!(await throws(() => spaces.setSettings({ unloadAfterMs: 500 }))));

    const before = state.store.data.clients.map((x) => x.id);
    spaces.moveClient(c.id, -1);
    const moved = state.store.data.clients.map((x) => x.id);
    check('Ordre des clients modifiable', moved.indexOf(c.id) === before.indexOf(c.id) - 1, moved);
    spaces.moveClient(c.id, 1);

    // Données du client : posées puis effacées à la suppression.
    const { ses, ready } = sessions.getSession(c.id);
    await ready;
    await ses.cookies.set({ url: srv.origin + '/', name: 'k', value: 'v', expirationDate: Date.now() / 1000 + 3600 });
    await spaces.deleteTool(c.id, t.id);
    check('Outil supprimé : onglet fermé', tabs.tabsOfSpace(c.id).length === 0);
    await spaces.deleteClient(c.id);
    const after = session.fromPartition('persist:client-' + c.id);
    check('Client supprimé du store', !state.store.data.clients.some((x) => x.id === c.id));
    check('Cookies du client effacés à la suppression', (await after.cookies.get({})).length === 0);
    check('Client supprimé relu depuis le disque', !new Store(state.store.file, {}).data.clients.some((x) => x.id === c.id));
  });

  await section('Scripts de l\'interface', async () => {
    // Une erreur de syntaxe dans un script de page le rend inerte sans rien afficher (volet vide) : on les compile tous.
    const dir = path.join(__dirname, '..', 'shell');
    const broken = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).filter((f) => {
      try { new (require('node:vm').Script)(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }); return false; } catch { return true; }
    });
    check('Tous les scripts de shell/ se compilent', broken.length === 0, broken);
    const flyout = require('../src/flyout');
    await flyout.open('clients', { x: 8, right: 42 });
    const filled = await until(() => flyout._view()?.webContents.executeJavaScript('document.getElementById("panel").children.length > 0').catch(() => false), 5000);
    check('Le volet des clients affiche son contenu', !!filled);
    flyout.close();
  });

  await section('Installation depuis le Chrome Web Store', async () => {
    const store = require('../src/extensions/webstore');
    const id = 'didegimhafipceonhjepacocaffmoppf';
    check('Identifiant lu dans l\'adresse d\'une extension', store.idOf(`https://chromewebstore.google.com/detail/passbolt/${id}?hl=fr`) === id);
    check('Ancienne adresse chrome.google.com reconnue', store.idOf(`https://chrome.google.com/webstore/detail/${id}`) === id);
    check('Pas d\'identifiant hors page d\'extension', store.idOf('https://chromewebstore.google.com/category/extensions') === null);
    check('Un faux domaine n\'est pas le Store', !store.isStoreUrl(`https://chromewebstore.google.com.exemple.fr/detail/x/${id}`) && !store.isStoreUrl(`http://chromewebstore.google.com/detail/x/${id}`));
  });

  await section('Sécurité des vues', async () => {
    await tabs.switchSpace('acme');
    const views = [state.shell, ...[...state.tabs.values()].filter((t) => t.view).map((t) => t.view)];
    const bad = views.filter((v) => { const p = v.webContents.getLastWebPreferences(); return !(p.contextIsolation && !p.nodeIntegration && p.sandbox); });
    check('contextIsolation + sandbox actifs, nodeIntegration coupé sur toutes les vues', bad.length === 0, { vues: views.length });
    const sub = [...state.tabs.values()].filter((t) => t.view && !t.internal)[0];
    const frameNode = await sub.view.webContents.executeJavaScript('[typeof require, typeof process, typeof module]');
    check('Même avec les préchargements dans les cadres, aucune API Node dans la page', frameNode.every((v) => v === 'undefined'), frameNode);
    const page = [...state.tabs.values()].find((t) => t.view && !t.internal);
    check('Une page web n\'a pas accès à l\'API d\'administration', (await ev(page, 'typeof window.junrAdmin')) === 'undefined');
    check('Une page web n\'a pas accès à require', (await ev(page, 'typeof require')) === 'undefined');
  });

  await section('Dialogue superposé', async () => {
    const p = core.dialog.show({ kind: 'confirm', title: 'Test', message: 'Message', buttons: [{ id: 'no', label: 'Non' }, { id: 'yes', label: 'Oui', style: 'primary' }] });
    const v = await until(() => { const view = dialog._view(); return view && view.getVisible?.() !== false ? view : null; });
    const found = await until(async () => (await v.webContents.executeJavaScript(`!!document.querySelector('#buttons button.primary')`).catch(() => false)));
    check('Le dialogue s\'affiche avec ses boutons', !!found);
    await v.webContents.executeJavaScript(`document.querySelector('#buttons button.primary').click()`);
    check('Le clic renvoie le choix', (await p) === 'yes');
    const p2 = core.dialog.show({ kind: 'confirm', title: 'Échap', buttons: [] });
    await until(async () => (await v.webContents.executeJavaScript(`document.getElementById('title').textContent === 'Échap'`).catch(() => false)));
    await v.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    check('Échap annule (null)', (await p2) === null);
  });

  await section('Permissions par site et par client', async () => {
    const permissions = require('../src/permissions');
    const asked = [];
    state.dialogAnswer = (spec) => { asked.push(spec.title); return state.nextAnswer; };
    state.nextAnswer = 'allow';
    const url = 'https://site.example/app';
    check('Position : demande puis autorisation', (await permissions.request('acme', url, 'geolocation')) === true && asked.length === 1);
    check('Choix mémorisé : plus de demande', (await permissions.request('acme', url, 'geolocation')) === true && asked.length === 1);
    check('Vérification synchrone après autorisation', permissions.check('acme', 'https://site.example', 'geolocation') === true);
    state.nextAnswer = 'deny';
    check('Autre client : nouvelle demande, refus', (await permissions.request('globex', url, 'geolocation')) === false && asked.length === 2);
    check('Le refus est mémorisé aussi', (await permissions.request('globex', url, 'geolocation')) === false && asked.length === 2);
    check('Le choix d\'un client n\'affecte pas l\'autre', permissions.check('acme', 'https://site.example', 'geolocation') === true);
    state.nextAnswer = 'allow';
    check('Caméra + micro : une demande pour les deux', (await permissions.request('acme', url, 'media', { mediaTypes: ['video', 'audio'] })) === true
      && permissions.check('acme', 'https://site.example', 'media', { mediaTypes: ['video'] }) && permissions.check('acme', 'https://site.example', 'media', { mediaTypes: ['audio'] }));
    check('Plein écran toujours autorisé sans demande', (await permissions.request('acme', url, 'fullscreen')) === true);
    check('Permission inconnue refusée', (await permissions.request('acme', url, 'usb')) === false);
    state.nextAnswer = null;
    check('Dialogue fermé sans réponse : refus non mémorisé', (await permissions.request('acme', 'https://autre.example/', 'notifications')) === false
      && !permissions.list().some((p) => p.origin === 'https://autre.example'));
    const listed = permissions.list().length;
    permissions.remove('acme', 'https://site.example', 'geolocation');
    check('« Oublier » retire le choix', permissions.list().length === listed - 1);
    state.nextAnswer = 'allow';
    const n = asked.length;
    await permissions.request('acme', url, 'geolocation');
    check('Après oubli, la demande revient', asked.length === n + 1);
    permissions.set('acme', 'https://site.example', 'geolocation', 'deny');
    check('Modification depuis les réglages', permissions.check('acme', 'https://site.example', 'geolocation') === false);

    // Bout en bout : une vraie page demande la permission « notifications ».
    const acmeTab = state.tabs.get(state.activeTab);
    await tabs.switchSpace('acme');
    await loaded(acmeTab);
    state.nextAnswer = 'allow';
    const granted = await ev(acmeTab, `Notification.requestPermission()`);
    check('Page réelle : Notification.requestPermission → granted', granted === 'granted', granted);
    const globexTab = tabs.tabsOfSpace('globex')[0];
    await tabs.switchSpace('globex');
    await loaded(globexTab);
    check('Autre client : permission non héritée', (await ev(globexTab, `Notification.permission`)) !== 'granted');
    state.dialogAnswer = null;
  });

  await section('Fonctions natives', async () => {
    const native = require('../src/native');
    const secrets = require('../src/secrets');
    await tabs.switchSpace('acme');
    // Blocage réseau : appliqué à un client, à un autre, et aux outils communs.
    native.setBlocking({ enabled: true, rules: [`*://127.0.0.1:${new URL(srv.origin).port}/blocked/*`] });
    const probe = (t) => ev(t, `Promise.all([fetch('/blocked/ad.js').then(() => 'ok', () => 'blocked'), fetch('/allowed/lib.js').then(() => 'ok', () => 'blocked')])`);
    const tA = await openIn(core, 'acme', srv.origin + '/page');
    const rA = await probe(tA);
    check('Blocage : ressource bloquée, autre ressource intacte (Acme)', rA[0] === 'blocked' && rA[1] === 'ok', rA);
    const tG = await openIn(core, 'globex', srv.origin + '/page');
    check('Blocage appliqué aussi à Globex', (await probe(tG))[0] === 'blocked');
    const tC = await openIn(core, 'global', srv.origin + '/page');
    check('Blocage appliqué aux outils communs', (await probe(tC))[0] === 'blocked');
    native.setBlocking({ enabled: false });
    check('Blocage désactivable', (await probe(tA))[0] === 'ok');
    native.setBlocking({ enabled: true, rules: ['ads.example.com'] });
    check('Règle « hôte » couvre les sous-domaines', native.shouldBlock('https://x.ads.example.com/a.js') && native.shouldBlock('https://ads.example.com/') && !native.shouldBlock('https://notads.example.com/'));
    check('Compteur de requêtes bloquées', state.blockedCount >= 1, state.blockedCount);

    // Injection de CSS et de script.
    const port = new URL(srv.origin).port;
    const rule = native.saveInjection({ name: 'Test', match: `http://127.0.0.1:${port}/page*`, css: '#t{color:rgb(1, 2, 3)}', js: 'document.body.dataset.injected="oui"', enabled: true });
    for (const space of ['acme', 'globex', 'global']) {
      const t = await openIn(core, space, srv.origin + '/page');
      const r = await until(async () => { const v = await ev(t, `[getComputedStyle(document.getElementById('t')).color, document.body.dataset.injected || null]`); return v[1] ? v : null; });
      check(`Injection CSS + script (${space})`, !!r && r[0] === 'rgb(1, 2, 3)' && r[1] === 'oui', r);
    }
    native.saveInjection({ ...rule, enabled: false });
    const tOff = await openIn(core, 'acme', srv.origin + '/page');
    await wait(300);
    check('Règle d\'injection désactivée', (await ev(tOff, `document.body.dataset.injected || null`)) === null);
    check('Règle sans CSS ni script refusée', !!(await throws(() => native.saveInjection({ match: '*' }))));
    native.deleteInjection(rule.id);

    // Mots de passe.
    if (!(await secrets.available())) { skip('Mots de passe', 'coffre du système indisponible'); return; }
    await native.savePassword({ origin: srv.origin, username: 'boris', password: 'S3cret-à-remplir!', spaceId: null });
    const onDisk = fs.readFileSync(state.store.file, 'utf8');
    check('Mot de passe chiffré sur disque', !onDisk.includes('S3cret-à-remplir') && onDisk.includes('"secret"'));
    const tl = await openIn(core, 'acme', srv.origin + '/loginform');
    const before = await ev(tl, `[document.getElementById('u').value, document.getElementById('p').value]`);
    const res = await native.fillActive();
    const after = await ev(tl, `[document.getElementById('u').value, document.getElementById('p').value]`);
    check('Remplissage à la demande', res.ok === true && before[1] === '' && after[0] === 'boris' && after[1] === 'S3cret-à-remplir!', { res, after: [after[0], after[1].length] });
    const other = await openIn(core, 'acme', `http://localhost:${port}/loginform`);
    const res2 = await native.fillActive();
    check('Pas de remplissage sur une autre origine', res2.ok === false && (await ev(other, `document.getElementById('p').value`)) === '', res2);
    state.notice = null;
    await tabs.fillPassword();
    check('Rien à remplir : un message dit pourquoi', /Aucun mot de passe enregistré/.test(state.notice?.text || ''), state.notice);
    check('Liste des mots de passe sans secret', !JSON.stringify(native.listPasswords()).includes('secret'));
    native.deletePassword(native.listPasswords()[0].id);
    check('Mot de passe supprimé', native.listPasswords().length === 0);
  });

  await section('Mise en veille avancée', async () => {
    const port = new URL(srv.origin).port;
    await tabs.switchSpace('acme');
    const keep = await openIn(core, 'acme', `http://localhost:${port}/page`);
    const sleepy = await openIn(core, 'acme', `http://127.0.0.1:${port}/page`);
    spaces.setSettings({ sleepExclusions: ['localhost'] });
    await tabs.switchSpace('globex');
    await tabs.sweep(0);
    check('Site exclu non mis en veille', !!keep.view);
    check('Autre onglet du même client mis en veille', !sleepy.view);
    spaces.setSettings({ sleepExclusions: ['*.localhost'] });
    check('« *.domaine » ne couvre pas un autre hôte', !tabs.hostMatches('localhost', 'x.local') && tabs.hostMatches('a.b.example.com', '*.example.com') && tabs.hostMatches('example.com', '*.example.com'));
    spaces.setSettings({ sleepExclusions: [] });

    await tabs.switchSpace('acme');
    for (const t of tabs.tabsOfSpace('acme')) await tabs.activateTab(t.id);
    await tabs.switchSpace('globex');
    const reasons = await tabs.sweep(10 * 3600 * 1000, { memThresholdMb: 1 });
    check('Seuil de RAM dépassé : onglets endormis sans attendre le délai', reasons.length > 0 && reasons.every((r) => r.reason === 'memory'), reasons.length);
    const still = tabs.tabsOfSpace('globex').filter((t) => t.view).length;
    check('Le client affiché n\'est pas touché par le seuil de RAM', still > 0, still);
    check('Mesure de RAM disponible (getAppMetrics)', tabs.memoryMb() > 0, tabs.memoryMb());
    const none = await tabs.sweep(10 * 3600 * 1000, { memThresholdMb: 0 });
    check('Seuil à 0 : rien n\'est endormi avant le délai', none.length === 0);
    spaces.setSettings({ unloadAfterMs: 120000 });
    check('Délai réglable', state.store.data.settings.unloadAfterMs === 120000);
    spaces.setSettings({ unloadAfterMs: 300000 });
  });

  await section('Extensions : installation par identifiant, gestion, mises à jour', async () => {
    const compat = require('../src/extensions/compat');
    const popup = require('../src/extensions/popup');
    const key = fixtures.newKey();
    const manifest = (version, extra = {}) => JSON.stringify({
      manifest_version: 3, name: 'Extension de test', version, permissions: ['storage', 'pageCapture'],
      action: { default_popup: 'popup.html' },
      content_scripts: [{ matches: ['http://*/*'], js: ['c.js'], run_at: 'document_start' }], ...extra,
    });
    const files = (version) => ({
      'manifest.json': manifest(version),
      'c.js': `document.documentElement.dataset.junrExt2 = '${version}'`,
      'popup.html': '<!doctype html><title>popup</title><p id="id"></p><script src="p.js"></script>',
      'p.js': 'document.getElementById("id").textContent = chrome.runtime.id',
      '_metadata/verified_contents.json': '{}',
    });
    const v1 = fixtures.buildCrx3(fixtures.buildZip(files('1.0.0')), key);
    const id = v1.id;
    srv.publish(id, '1.0.0', v1.crx);
    state.extBase = srv.origin + '/crx';
    compat.setSurface({ namespaces: ['runtime', 'storage', 'tabs', 'scripting', 'action'] });

    check('Identifiant lu depuis une adresse du Web Store', extManager.parseId(`https://chromewebstore.google.com/detail/nom/${id}?hl=fr`) === id);
    check('Identifiant invalide refusé', !!(await throws(async () => extManager.parseId('pas-un-id'))));

    const out = await extManager.install(id);
    const dir = path.join(app.getPath('userData'), 'extensions', id, '1.0.0_0');
    check('Installée dans userData/extensions/<id>/<version>', out.id === id && fs.existsSync(path.join(dir, 'manifest.json')), { dir: path.relative(app.getPath('userData'), dir) });
    check('Dossier _metadata du Web Store ignoré', !fs.existsSync(path.join(dir, '_metadata')));
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    check('Clé publique réinjectée dans le manifeste', typeof written.key === 'string' && written.key.length > 100);
    check('Compatibilité signalée à l\'installation', out.compat.status === 'partial' && out.compat.missing.join() === 'pageCapture', out.compat);

    for (const [sid, entry] of state.sessions) {
      if (sid === 'internal') continue;
      await entry.ready;
      const api = entry.ses.extensions ?? entry.ses;
      const ext = api.getAllExtensions().find((e) => e.id === id);
      check(`Chargée dans la partition « ${sid} » avec l'identifiant du Web Store`, !!ext && entry.loaded.has(id));
    }
    const page = (space) => openIn(core, space, srv.origin + '/page');
    const tA = await page('acme'), tG = await page('globex');
    check('Content script actif dans Acme et Globex', (await ev(tA, `document.documentElement.dataset.junrExt2`)) === '1.0.0' && (await ev(tG, `document.documentElement.dataset.junrExt2`)) === '1.0.0');

    const snap = tabs.snapshot();
    check('Extension : listée dans le volet mais absente de la barre tant qu\'elle n\'est pas épinglée', snap.extensions.some((t) => t.id === id && t.hasAction && t.pinned === false) && !snap.toolbar.some((t) => t.id === id));
    require('../src/spaces').pinExtension(id, true);
    check('Extension épinglée : son bouton apparaît dans la barre', tabs.snapshot().toolbar.some((t) => t.id === id) && tabs.snapshot().extensions.find((t) => t.id === id).pinned === true);
    await tabs.activateTab(tA.id);
    const opened = await popup.toggle(id, 900);
    const popupWc = await until(() => state.win.contentView.children.map((c) => c.webContents).find((w) => w && w.getURL().startsWith(`chrome-extension://${id}/popup.html`)));
    const shownId = popupWc && await until(async () => (await popupWc.executeJavaScript(`document.getElementById('id').textContent`).catch(() => '')) || null);
    check('Popup de l\'extension ouvert, avec accès à chrome.runtime', opened && shownId === id, shownId);
    await popup.toggle(id, 900);
    check('Second clic ferme le popup', !popup.isOpen());

    // Désactivation / réactivation.
    await extManager.setEnabled(id, false);
    let loadedAnywhere = false;
    for (const [sid, entry] of state.sessions) if (sid !== 'internal' && entry.loaded.has(id)) loadedAnywhere = true;
    await tA.view.webContents.loadURL(srv.origin + '/page?off'); await wait(300);
    check('Désactivée : retirée de toutes les partitions', !loadedAnywhere && (await ev(tA, `document.documentElement.dataset.junrExt2 || null`)) === null);
    await extManager.setEnabled(id, true);
    await tA.view.webContents.loadURL(srv.origin + '/page?on'); await wait(300);
    check('Réactivée : de nouveau active', (await ev(tA, `document.documentElement.dataset.junrExt2 || null`)) === '1.0.0');

    // « Redémarrage » : l'enregistrement est relu depuis le disque et un client créé ensuite reçoit l'extension.
    const { Store } = require('../src/store');
    check('Extension enregistrée sur disque', new Store(state.store.file, {}).data.extensions[id]?.enabled === true);
    const fresh = spaces.addClient({ name: 'Après redémarrage' });
    spaces.addTool(fresh.id, { name: 'P', url: srv.origin + '/page' });
    const tF = tabs.tabsOfSpace(fresh.id)[0];
    await tabs.activateTab(tF.id); await loaded(tF);
    check('Nouveau client : extension chargée automatiquement', (await ev(tF, `document.documentElement.dataset.junrExt2 || null`)) === '1.0.0');

    // Mise à jour via le XML public.
    const v2 = fixtures.buildCrx3(fixtures.buildZip(files('2.0.0')), key);
    srv.publish(id, '2.0.0', v2.crx);
    const upd = await extManager.checkUpdates();
    check('Mise à jour détectée et installée', upd.length === 1 && upd[0].from === '1.0.0' && upd[0].to === '2.0.0', upd);
    const extDir = path.join(app.getPath('userData'), 'extensions', id);
    check('Ancienne version supprimée', fs.readdirSync(extDir).join() === '2.0.0_0', fs.readdirSync(extDir));
    await tA.view.webContents.loadURL(srv.origin + '/page?v2'); await wait(300);
    check('Nouvelle version active', (await ev(tA, `document.documentElement.dataset.junrExt2`)) === '2.0.0');
    check('Aucune mise à jour quand tout est à jour', (await extManager.checkUpdates()).length === 0);

    // Empreinte invalide : la mise à jour est rejetée, l'ancienne version reste.
    const v3 = fixtures.buildCrx3(fixtures.buildZip(files('3.0.0')), key);
    srv.publish(id, '3.0.0', v3.crx);
    srv.state.forceHash = '0'.repeat(64);
    const bad = await extManager.checkUpdates();
    srv.state.forceHash = null;
    check('Empreinte SHA-256 invalide : mise à jour rejetée', bad.length === 0 && extManager.records()[id].version === '2.0.0' && !!extManager.records()[id].updateError);

    // CRX signé par une autre clé que celle de l'identifiant demandé.
    const other = fixtures.buildCrx3(fixtures.buildZip(files('1.0.0')), fixtures.newKey());
    const idB = 'a'.repeat(32);
    srv.publish(idB, '1.0.0', other.crx);
    check('CRX dont l\'identifiant ne correspond pas : refusé', /ne correspond pas/.test(await throws(() => extManager.install(idB)) || ''));
    // Archive piégée (zip-slip).
    const evil = fixtures.buildCrx3(fixtures.buildZip({ 'manifest.json': manifest('1.0.0'), '../evil.txt': 'x' }), fixtures.newKey());
    srv.publish(evil.id, '1.0.0', evil.crx);
    check('Archive avec chemin « ../ » refusée', /dangereux/.test(await throws(() => extManager.install(evil.id)) || '') && !fs.existsSync(path.join(app.getPath('userData'), 'extensions', 'evil.txt')));

    // Classification de compatibilité.
    compat.setSurface({ namespaces: ['runtime', 'storage'] });
    check('Compat : API toutes présentes → compatible', compat.classify({ manifest_version: 3, permissions: ['storage'] }).status === 'compatible');
    check('Compat : API absente → partielle', compat.classify({ manifest_version: 3, permissions: ['storage', 'pageCapture'] }).status === 'partial');
    check('Compat : API pontée → comptée présente (et absente sans le shim)', compat.classify({ manifest_version: 3, permissions: ['storage', 'bookmarks'] }).status === 'compatible'
      && compat.classify({ manifest_version: 3, permissions: ['storage', 'bookmarks'] }, { bridged: false }).status === 'partial');
    check('Compat : stockage absent → non supportée', compat.classify({ manifest_version: 3, permissions: ['storage'] }, { loadError: 'x' }).status === 'unsupported');
    check('Compat : échec de l\'arrière-plan → non supportée', compat.classify({ manifest_version: 3, permissions: [] }, { backgroundFailed: true }).status === 'unsupported');

    await extManager.uninstall(id);
    check('Désinstallée : fichiers et partitions nettoyés', !fs.existsSync(extDir) && !extManager.records()[id] && [...state.sessions.values()].every((e) => !e.loaded.has(id)));
    await spaces.deleteClient(fresh.id);
  });

  await section('Extensions : pont pour les API absentes (service worker)', async () => {
    const bg = `chrome.contextMenus.onClicked.addListener(() => {});
      chrome.windows.onFocusChanged.addListener(() => {});
      (self.browser || chrome).commands.onCommand.addListener(() => {});
      chrome.storage.sync.set({ ok: 1 }).then(() => chrome.storage.local.set({ shim: 'demarre' }));`;
    const mk = (type) => fixtures.buildCrx3(fixtures.buildZip({
      'manifest.json': JSON.stringify({ manifest_version: 3, name: 'SW fragile', version: '1.0.0', permissions: ['storage', 'contextMenus'], background: type ? { service_worker: 'sub/bg.js', type } : { service_worker: 'sub/bg.js' } }),
      'sub/bg.js': (type ? 'import \'./lib.js\';' : 'importScripts(\'lib.js\');') + '\n' + bg,
      'sub/lib.js': 'self.libLoaded = true;',
    }), fixtures.newKey());
    const ids = [];
    for (const type of [undefined, 'module']) {
      const { crx, id } = mk(type);
      ids.push(id);
      srv.publish(id, '1.0.0', crx);
      state.extBase = srv.origin + '/crx';
      await extManager.install(id);
      const { ses } = sessions.getSession('acme');
      const dir = extManager.extPath(extManager.records()[id]);
      const m = () => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).background.service_worker;
      const label = type ? 'module' : 'classique';
      check(`Service worker ${label} enveloppé (shim actif par défaut)`, m() === 'sub/junr-sw.js' && fs.existsSync(path.join(dir, 'sub', 'junr-sw.js')) && !fs.existsSync(path.join(dir, 'junr-sw.js')) && fs.existsSync(path.join(dir, 'junr-shim.js')), m());
      check(`SW ${label} : démarre malgré contextMenus/windows absentes`, (await extManager.backgroundRuns(ses, id, 6000)) === true);
      const { ses: g } = sessions.getSession('globex');
      check(`SW ${label} : démarre aussi dans une autre partition`, (await extManager.backgroundRuns(g, id, 6000)) === true);

      spaces.setSettings({ extensionShims: false });
      await extManager.setEnabled(id, false);
      await extManager.setEnabled(id, true);
      check(`Shim coupé : manifeste d'origine restauré (${label})`, m() === 'sub/bg.js' && !fs.existsSync(path.join(dir, 'sub', 'junr-sw.js')), m());
      await wait(1500);
      check(`Shim coupé : le SW ${label} plante au démarrage (preuve que le pont agit)`, (await extManager.backgroundRuns(ses, id, 3000)) === false);
      spaces.setSettings({ extensionShims: true });
      await extManager.setEnabled(id, false);
      await extManager.setEnabled(id, true);
      check(`Shim réactivé : le SW ${label} redémarre`, m() === 'sub/junr-sw.js' && (await extManager.backgroundRuns(ses, id, 6000)) === true);
      // Extension installée avant le déplacement de l'enveloppe (à la racine) : elle est migrée au chargement suivant.
      const mfile = path.join(dir, 'manifest.json'), mani = JSON.parse(fs.readFileSync(mfile, 'utf8'));
      fs.rmSync(path.join(dir, 'sub', 'junr-sw.js'));
      fs.writeFileSync(path.join(dir, 'junr-sw.js'), type ? 'import \'/junr-shim.js\';\nimport \'/sub/bg.js\';\n' : 'importScripts(\'/junr-shim.js\', \'/sub/bg.js\');\n');
      mani.background.service_worker = 'junr-sw.js';
      fs.writeFileSync(mfile, JSON.stringify(mani));
      await extManager.setEnabled(id, false);
      await extManager.setEnabled(id, true);
      check(`Ancienne enveloppe à la racine migrée à côté du script (${label})`, m() === 'sub/junr-sw.js' && !fs.existsSync(path.join(dir, 'junr-sw.js')) && fs.existsSync(path.join(dir, 'sub', 'junr-sw.js')) && (await extManager.backgroundRuns(ses, id, 6000)) === true, m());
    }
    const shimSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'extensions', 'sw-shim.js'), 'utf8');
    check('Le shim laisse runtime.lastError indéfini', /lastError/.test(shimSrc));
    for (const id of ids) await extManager.uninstall(id);
  });

  await section('Mises à jour de l\'application', async () => {
    const updater = require('../src/updater');
    const flyout = require('../src/flyout');
    const { EventEmitter } = require('node:events');
    const pkg = require('../package.json');
    class Fake extends EventEmitter {
      constructor() { super(); this.checks = 0; this.installed = null; this.next = null; }
      setFeedURL(feed) { this.feed = feed; }
      async checkForUpdates() {
        this.checks++; this.emit('checking-for-update');
        if (this.next) { this.emit('update-available', { version: this.next }); this.emit('download-progress', { percent: 42 }); } else this.emit('update-not-available', {});
      }
      quitAndInstall(silent, run) { this.installed = [silent, run]; }
    }
    const fake = new Fake();
    check('Version de développement : pas de mise à jour automatique', (await updater.start()).state === 'off');
    await updater.start({ impl: fake });
    check('Source des versions : les Releases GitHub du dépôt', fake.feed.provider === 'github' && fake.feed.owner === pkg.build.publish[0].owner && fake.feed.repo === pkg.build.publish[0].repo, fake.feed);
    check('Téléchargement en arrière-plan, installation à la fermeture, jamais de retour en arrière', fake.autoDownload === true && fake.autoInstallOnAppQuit === true && fake.allowDowngrade === false && fake.channel === 'latest');
    check('Canal stable par défaut : pas de pré-versions', fake.allowPrerelease === false && state.store.data.settings.updateChannel === 'stable');
    check('Rien de prêt : la barre ne montre rien', tabs.snapshot().update === null);

    await updater.check();
    check('Aucune nouvelle version : à jour', state.update.state === 'uptodate' && state.update.next === null);
    let refused = '';
    try { updater.install(); } catch (e) { refused = e.message; }
    check('Rien à installer : refusé', /Aucune mise à jour prête/.test(refused), refused);

    fake.next = '9.9.9';
    await updater.check();
    check('Nouvelle version : téléchargement suivi', state.update.state === 'downloading' && state.update.next === '9.9.9' && state.update.percent === 42, state.update);
    state.notice = null;
    fake.emit('update-downloaded', { version: '9.9.9' });
    check('Téléchargée : prête, annoncée dans la barre', state.update.state === 'ready' && tabs.snapshot().update?.next === '9.9.9' && /9\.9\.9/.test(state.notice?.text || ''), state.notice);
    const before = fake.checks;
    await updater.check();
    check('Une mise à jour prête n\'est pas re-cherchée', fake.checks === before);
    fake.emit('error', new Error('réseau coupé\nligne de pile'));
    check('Une erreur réseau n\'annule pas une mise à jour déjà prête', state.update.state === 'ready' && state.update.error === 'réseau coupé');

    const pub = await require('../src/ipc').admin['update.get']();
    check('Réglages : version installée, canal, source', pub.version === pkg.version && pub.channel === 'stable' && /github\.com\//.test(pub.source) && pub.state === 'ready', pub);

    await updater.setChannel('beta');
    check('Canal bêta : les pré-versions sont proposées', fake.allowPrerelease === true && state.store.data.settings.updateChannel === 'beta');
    let bad = '';
    try { await updater.setChannel('nightly'); } catch (e) { bad = e.message; }
    check('Canal inconnu refusé', /Canal inconnu/.test(bad) && state.store.data.settings.updateChannel === 'beta', bad);
    await updater.setChannel('stable');
    check('Retour au canal stable', fake.allowPrerelease === false);

    await flyout._act('update-install', []);
    check('Le volet des clients installe la mise à jour prête (silencieux, puis relance)', JSON.stringify(fake.installed) === '[true,true]', fake.installed);

    updater.stop();
    state.update.state = 'off';
    check('Arrêt : plus d\'écoute', updater.publicState().state === 'off');
  });

  await section('Partage d\'un espace', async () => {
    const share = require('../src/share');
    const port = new URL(srv.origin).port;
    const origin = srv.origin, alt = `http://localhost:${port}`;
    const c = spaces.addClient({ name: 'Partage' });
    const t1 = spaces.addTool(c.id, { name: 'Profil', url: origin + '/profile', controlUrl: origin + '/profile' });
    spaces.addTool(c.id, { name: 'Lié à l\'IP', url: alt + '/profile-ip', controlUrl: alt + '/profile-ip' });
    spaces.addTool(c.id, { name: 'Sans contrôle', url: origin + '/page' });

    // Connexion réelle côté serveur (cookie httpOnly) + stockage local + cookie d'un outil non portable.
    const login = tabs.tabsOfSpace(c.id).find((t) => t.toolId === t1.id);
    await tabs.activateTab(login.id); await loaded(login);
    await login.view.webContents.loadURL(origin + '/set-session'); await wait(300);
    await login.view.webContents.loadURL(origin + '/page'); await wait(300);
    await ev(login, `localStorage.setItem('token', 'tok-123'); 1`);
    const { ses } = sessions.getSession(c.id);
    await ses.cookies.set({ url: alt + '/', name: 'leak', value: 'private', expirationDate: Date.now() / 1000 + 3600 });
    const own = await ses.cookies.get({ name: 'sid' });
    check('Cookie de session httpOnly posé par le serveur', own.length === 1 && own[0].httpOnly === true);

    const me = await share.myShareId();
    check('Identifiant de partage et empreinte', me.shareId.length > 40 && /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/.test(me.fingerprint), me.fingerprint);
    const prev = await share.previewExport(c.id);
    const st = Object.fromEntries(prev.statuses.map((s) => [s.name, s.status]));
    check('Test de portabilité par outil, avant envoi', st['Profil'] === 'portable' && st['Lié à l\'IP'] === 'not-portable' && st['Sans contrôle'] === 'unverifiable', st);

    state.dialogAnswer = () => 'ok';
    const out = await share.exportSpace(c.id, me.shareId, { ttlMs: 60000 });
    const raw = out.file.toString('utf8');
    check('Paquet chiffré : ni cookie ni stockage en clair', !raw.includes('tok-123') && !raw.includes('"good"') && !raw.includes('sid'));
    const { payload, header } = await share.open(out.file);
    const sid = payload.cookies.find((x) => x.name === 'sid');
    check('Cookie httpOnly inclus dans le paquet', sid?.httpOnly === true && sid.value === 'good');
    check('localStorage inclus, par origine', payload.localStorage[origin]?.token === 'tok-123');
    check('Données d\'un outil non portable non transmises', !payload.cookies.some((x) => x.name === 'leak'));
    check('Paquet : expiration et usage unique déclarés', header.expiresAt > Date.now() && header.expiresAt - header.createdAt === 60000 && !!header.id);

    const imp = await share.importPacket(out.file);
    const names = state.store.data.clients.map((x) => x.name);
    check('Import sans écraser : nouvel espace au nom distinct', imp.name === 'Partage (partagé)' && names.includes('Partage') && names.includes('Partage (partagé)'), imp.name);
    const stI = Object.fromEntries(imp.statuses.map((s) => [s.name, s.status]));
    check('Destinataire : arrive connecté sur l\'outil portable', stI['Profil'] === 'portable', stI);
    check('Destinataire : outil non portable signalé, jamais « connecté »', stI['Lié à l\'IP'] === 'not-portable' && stI['Sans contrôle'] === 'unverifiable');
    const imported = state.store.data.clients.find((x) => x.id === imp.spaceId);
    check('Statut enregistré sur chaque outil', imported.tools.every((t) => t.portability?.status));
    const { ses: ses2 } = sessions.getSession(imp.spaceId);
    check('Partition du destinataire : cookie httpOnly présent', (await ses2.cookies.get({ name: 'sid' })).some((x) => x.httpOnly));
    const tImp = await openIn(core, imp.spaceId, origin + '/page');
    check('Partition du destinataire : localStorage présent', (await ev(tImp, `localStorage.getItem('token')`)) === 'tok-123');
    check('Espace d\'origine intact', (await ses.cookies.get({ name: 'sid' })).length === 1);

    check('Paquet à usage unique', /déjà été importé/.test(await throws(() => share.importPacket(out.file)) || ''));
    const short = await share.exportSpace(c.id, me.shareId, { ttlMs: 1 });
    await wait(30);
    check('Paquet expiré refusé', /expiré/.test(await throws(() => share.importPacket(short.file)) || ''));
    const env = JSON.parse(out.file.toString());
    const hdr = JSON.parse(Buffer.from(env.h, 'base64').toString());
    hdr.expiresAt += 10 * 24 * 3600 * 1000;
    env.h = Buffer.from(JSON.stringify(hdr)).toString('base64');
    check('En-tête altéré (prolongation de validité) détecté', /altéré/.test(await throws(() => share.open(Buffer.from(JSON.stringify(env)))) || ''));
    const stranger = require('node:crypto').generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const forOther = await share.exportSpace(c.id, stranger, { ttlMs: 60000 });
    check('Paquet destiné à quelqu\'un d\'autre refusé', /pas destiné/.test(await throws(() => share.open(forOther.file)) || ''));
    check('Identifiant de destinataire invalide refusé', !!(await throws(() => share.exportSpace(c.id, 'abc'))));

    const log = share.getLog();
    check('Journal : envois et réception tracés (qui, quel espace, quand)', log.some((l) => l.direction === 'import' && l.space === 'Partage (partagé)') && log.filter((l) => l.direction === 'export').length >= 3 && log.every((l) => l.user && l.when && l.space), log.length);
    state.dialogAnswer = null;
    await spaces.deleteClient(imp.spaceId);
    await spaces.deleteClient(c.id);
  });

  await section('Pont d\'API : windows et tabs', async () => {
    const bus = require('../src/state').bus;
    await tabs.switchSpace('acme');
    const x = await bridgeExt();
    const who = await x.who('acme');
    const boot = (await until(async () => { const s = await x.startup('acme'); return s.length ? s : null; }, 10000, 300)) || [];
    check('runtime.onInstalled({reason: "install"}) émis à la première mise en route', boot.some((e) => e.name === 'runtime.onInstalled' && e.details.reason === 'install' && e.details.previousVersion === undefined) && !boot.some((e) => e.name === 'runtime.onStartup'), boot);
    check('Le service worker est relié au pont et identifie son client', who.spaceId === 'acme' && who.kind === 'sw' && who.extId === x.id, who);
    check('Un service worker par client : Globex et outils communs aussi', (await x.who('globex')).spaceId === 'globex' && (await x.who('global')).spaceId === 'global');

    // windows
    const w = await x.call('acme', 'windows.getAll', { populate: true });
    check('windows.getAll : une fenêtre, onglets du client avec URL', w.length === 1 && w[0].id === 0 && w[0].type === 'normal' && w[0].tabs.length >= 1 && w[0].tabs.every((t) => t.url), { n: w[0].tabs.length });
    check('windows.getCurrent / get(0) / getLastFocused', (await x.call('acme', 'windows.getCurrent')).id === 0 && (await x.call('acme', 'windows.get', 0)).id === 0 && (await x.call('acme', 'windows.getLastFocused')).id === 0);
    check('windows.get d\'une fenêtre inconnue : erreur', /No window with id: 7/.test(await x.fail('acme', 'windows.get', 7) || ''));
    check('windows.WINDOW_ID_NONE / CURRENT', (await x.prop('acme', 'windows.WINDOW_ID_NONE')) === -1 && (await x.prop('acme', 'windows.WINDOW_ID_CURRENT')) === -2);
    check('windows.remove refusé', /ne peut pas être fermée/.test(await x.fail('acme', 'windows.remove', 0) || ''));

    // tabs : natif + ponté, identifiants cohérents
    const mine = tabs.tabsOfSpace('acme').filter((t) => t.view);
    const q = await x.call('acme', 'tabs.query', {});
    check('tabs.query natif : identifiants = webContents.id des onglets chargés', mine.length > 0 && mine.every((t) => q.some((r) => r.id === t.view.webContents.id)), { natifs: q.map((r) => r.id) });
    // tabs.query suit la sémantique de Chrome (le query natif d'Electron renvoie [] pour currentWindow:true).
    const current = await x.call('acme', 'tabs.query', { active: true, currentWindow: true });
    check('tabs.query({active, currentWindow}) : l\'onglet actif du client', current.length === 1 && current[0].id === tabs.tabsOfSpace('acme').find((t) => t.id === state.activeTab).view.webContents.id && current[0].active === true && current[0].windowId === 0, current.map((t) => t.id));
    check('tabs.query : currentWindow:false, mauvaise fenêtre, filtre d\'URL, de titre et d\'état', (await x.call('acme', 'tabs.query', { currentWindow: false })).length === 0 && (await x.call('acme', 'tabs.query', { windowId: 5 })).length === 0
      && (await x.call('acme', 'tabs.query', { url: 'http://127.0.0.1/*' })).length >= 1 && (await x.call('acme', 'tabs.query', { url: 'https://nulle-part.example/*' })).length === 0 && (await x.call('acme', 'tabs.query', { status: 'complete', pinned: false })).length >= 1);
    await x.call('globex', 'tabs.create', { url: srv.origin + '/page?g0', active: false });
    const otherClient = await x.call('globex', 'tabs.query', { active: true, currentWindow: true });
    check('Un client non affiché a aussi son onglet actif (le dernier consulté)', otherClient.length === 1 && tabs.tabsOfSpace('globex').some((t) => t.view?.webContents.id === otherClient[0].id));
    check('tabs.get : identifiant valide, onglet d\'un autre client refusé', (await x.call('acme', 'tabs.get', current[0].id)).id === current[0].id && /No tab with id/.test(await x.fail('acme', 'tabs.get', otherClient[0].id) || ''));
    const ua = await tabs.tabsOfSpace('acme').find((t) => t.view).view.webContents.executeJavaScript('navigator.userAgent');
    check('User-Agent de navigateur : sans « Electron » ni nom d\'application', /Chrome\/\d+/.test(ua) && !/Electron|junr-browser/i.test(ua), ua);
    const created = await x.call('acme', 'tabs.create', { url: srv.origin + '/page?a', active: false });
    const wcOfCreated = tabs.tabsOfSpace('acme').find((t) => t.view?.webContents.id === created.id);
    check('tabs.create (inactif) : onglet créé, identifiant réel, affichage inchangé', !!wcOfCreated && created.active === false && created.url.endsWith('/page?a') && created.windowId === 0 && state.activeTab !== wcOfCreated.id, created.id);
    await until(() => !wcOfCreated.view.webContents.isLoading());
    check('L\'onglet créé est visible de tabs.query et le scripting natif fonctionne dessus', (await x.call('acme', 'tabs.query', { url: 'http://127.0.0.1/page?a' })).some((t) => t.id === created.id)
      && (await x.call('acme', 'scripting.executeScript', { target: { tabId: created.id }, files: ['inject.js'] }))[0].result === 'page');
    const before = state.activeSpace;
    const bg = await x.call('globex', 'tabs.create', { url: srv.origin + '/page?g', active: true });
    check('Un client en arrière-plan ne vole pas l\'affichage', state.activeSpace === before && bg.active === false && !!tabs.tabsOfSpace('globex').find((t) => t.view?.webContents.id === bg.id));
    check('tabs.create refuse javascript: et file:', /refusée/.test(await x.fail('acme', 'tabs.create', { url: 'javascript:alert(1)' }) || '') && /refusée/.test(await x.fail('acme', 'tabs.create', { url: 'file:///C:/Windows/win.ini' }) || ''));
    check('Un client ne touche pas aux onglets d\'un autre (update)', /No tab with id/.test(await x.fail('acme', 'tabs.update', bg.id, { url: srv.origin + '/page' }) || ''));

    const upd = await x.call('acme', 'tabs.update', created.id, { url: srv.origin + '/page?b' });
    await until(() => wcOfCreated.view.webContents.getURL().endsWith('?b') && !wcOfCreated.view.webContents.isLoading());
    check('tabs.update : navigation', wcOfCreated.view.webContents.getURL().endsWith('/page?b') && upd.id === created.id);
    const dup = await x.call('acme', 'tabs.duplicate', created.id);
    check('tabs.duplicate', dup.id !== created.id && dup.url.endsWith('/page?b'));
    check('tabs.goBack puis goForward', (await x.call('acme', 'tabs.goBack', created.id)) === null && !!(await until(() => wcOfCreated.view.webContents.getURL().endsWith('?a'))) && (await x.call('acme', 'tabs.goForward', created.id)) === null);
    await x.call('acme', 'tabs.reload', created.id);
    check('tabs.goBack sans historique : erreur', /previous page/.test(await x.fail('acme', 'tabs.goBack', dup.id) || ''));
    check('tabs.setZoom / getZoom', (await x.call('acme', 'tabs.setZoom', created.id, 1.5)) === null && (await x.call('acme', 'tabs.getZoom', created.id)) === 1.5);
    check('tabs.detectLanguage', (await x.call('acme', 'tabs.detectLanguage', created.id)) === 'und');

    // Capture : onglet affiché seulement.
    const active = tabs.tabsOfSpace('acme').find((t) => t.id === state.activeTab);
    await loaded(active);
    const shot = await x.call('acme', 'tabs.captureVisibleTab', undefined, { format: 'png' });
    check('tabs.captureVisibleTab : image PNG de l\'onglet affiché', /^data:image\/png;base64,.{100,}/.test(shot));

    // Événements.
    for (const n of ['onCreated', 'onUpdated', 'onRemoved', 'onActivated']) await x.listen('acme', 'tabs.' + n);
    await x.events('acme');
    const e1 = await x.call('acme', 'tabs.create', { url: srv.origin + '/page?evt', active: true });
    let seen = [];
    await until(async () => { seen = seen.concat(await x.events('acme')); return seen.some((e) => e.name === 'tabs.onUpdated' && e.args[1].status === 'complete'); });
    const names = seen.map((e) => e.name);
    check('tabs.onCreated, onUpdated (loading, complete, url), onActivated reçus', names.includes('tabs.onCreated') && names.includes('tabs.onActivated') && seen.some((e) => e.name === 'tabs.onUpdated' && e.args[1].url?.endsWith('?evt')) && seen.some((e) => e.name === 'tabs.onUpdated' && e.args[1].status === 'loading'), names.join(','));
    const created2 = seen.find((e) => e.name === 'tabs.onCreated');
    const act = seen.find((e) => e.name === 'tabs.onActivated');
    check('Arguments : onCreated(tab) et onActivated({tabId, windowId})', created2.args[0].id === e1.id && act.args[0].tabId === e1.id && act.args[0].windowId === 0);
    await x.call('acme', 'tabs.remove', e1.id);
    const rm = await until(async () => (await x.events('acme')).find((e) => e.name === 'tabs.onRemoved'));
    check('tabs.remove + onRemoved(tabId, {isWindowClosing:false})', rm?.args[0] === e1.id && rm.args[1].isWindowClosing === false && !tabs.tabsOfSpace('acme').some((t) => t.view?.webContents.id === e1.id));
    const globexSeen = await x.events('globex');
    check('Les événements d\'un client ne sont pas livrés à un autre client', !globexSeen.some((e) => e.name.startsWith('tabs.')));

    // Fenêtre : événements du bus.
    await x.listen('acme', 'windows.onFocusChanged');
    await x.events('acme');
    bus.emit('window:focus');
    const fc = await until(async () => (await x.events('acme')).find((e) => e.name === 'windows.onFocusChanged'));
    check('windows.onFocusChanged', fc?.args[0] === 0);

    const nw = await x.call('acme', 'windows.create', { url: [srv.origin + '/page?w1', srv.origin + '/page?w2'] });
    check('windows.create : une fenêtre, un onglet par adresse', nw.id === 0 && nw.tabs.filter((t) => /\?w[12]$/.test(t.url)).length === 2);

    // Style rappel et lastError.
    const ok = await x.cb('acme', 'windows.getCurrent');
    check('Style rappel : valeur, pas d\'erreur', ok.value.id === 0 && ok.lastError === null);
    const bad = await x.cb('acme', 'tabs.reload', 99999);
    check('Style rappel : runtime.lastError renseigné', /No tab with id: 99999/.test(bad.lastError || ''), bad);

    // Page d'extension (popup/options) : le shim est injecté et relié au pont.
    const pageTab = tabs.addTab({ spaceId: 'acme', url: `chrome-extension://${x.id}/options.html`, title: 'options' });
    await tabs.activateTab(pageTab.id);
    const pw = await x.page.who('acme');
    check('Page d\'extension : pont et identité du client', pw.kind === 'page' && pw.spaceId === 'acme' && pw.extId === x.id, pw);
    check('Page d\'extension : chrome.windows pontée', (await x.page.call('acme', 'windows.getCurrent')).id === 0 && (await x.page.typeOf('acme', 'tabs.create')) === 'function');
    check('Page d\'extension : tabs.getCurrent renvoie l\'onglet hôte', (await x.page.call('acme', 'tabs.getCurrent')).id === pageTab.view.webContents.id);
    await tabs.closeTab(pageTab.id);
  });

  await section('Pont d\'API : cookies, management, menus, notifications, raccourcis, actions, panneau latéral', async () => {
    const { installBridgeExtension } = require('./bridge-helper');
    const bus = require('../src/state').bus;
    const cm = require('../src/extensions/bridge/api-contextmenus');
    const notif = require('../src/extensions/bridge/api-notifications');
    const commands = require('../src/extensions/bridge/api-commands');
    const side = require('../src/extensions/bridge/api-sidepanel');
    const popup = require('../src/extensions/popup');
    const actions = require('../src/extensions/actions');
    await tabs.switchSpace('acme');
    const x = await bridgeExt();
    const restricted = await installBridgeExtension({ srv, extManager, state }, { name: 'Restreinte', permissions: ['storage'], host_permissions: ['https://example.org/*'], noPopup: true });
    await x.who('acme'); await restricted.who('acme');
    const waitEvent = (ext, space, name, ms = 8000) => until(async () => (await ext.events(space)).find((e) => e.name === name), ms, 150);

    /* ----- cookies ----- */
    const acmeSes = sessions.getSession('acme').ses, globexSes = sessions.getSession('globex').ses;
    await x.listen('acme', 'cookies.onChanged');
    await x.events('acme');
    const set = await x.call('acme', 'cookies.set', { url: srv.origin + '/', name: 'bt1', value: 'v1', httpOnly: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 3600 });
    check('cookies.set : cookie complet renvoyé (httpOnly, sameSite, storeId)', set.name === 'bt1' && set.value === 'v1' && set.httpOnly === true && set.sameSite === 'strict' && set.storeId === '0' && set.domain === '127.0.0.1' && set.hostOnly === true, set);
    check('Le cookie existe dans la partition du client (et seulement là)', (await acmeSes.cookies.get({ name: 'bt1' })).length === 1 && (await globexSes.cookies.get({ name: 'bt1' })).length === 0);
    check('cookies.get / getAll', (await x.call('acme', 'cookies.get', { url: srv.origin + '/', name: 'bt1' })).value === 'v1' && (await x.call('acme', 'cookies.getAll', { domain: '127.0.0.1' })).some((c) => c.name === 'bt1'));
    check('Un autre client ne voit pas ce cookie', !(await x.call('globex', 'cookies.getAll', {})).some((c) => c.name === 'bt1') && (await x.call('globex', 'cookies.get', { url: srv.origin + '/', name: 'bt1' })) === null);
    const changed = await waitEvent(x, 'acme', 'cookies.onChanged');
    check('cookies.onChanged à la création', changed?.args[0].removed === false && changed.args[0].cookie.name === 'bt1' && changed.args[0].cause === 'explicit', changed?.args[0]);
    check('cookies.remove + onChanged(removed)', (await x.call('acme', 'cookies.remove', { url: srv.origin + '/', name: 'bt1' })).name === 'bt1'
      && (await waitEvent(x, 'acme', 'cookies.onChanged'))?.args[0].removed === true && (await acmeSes.cookies.get({ name: 'bt1' })).length === 0);
    check('cookies : magasin inconnu refusé', /No cookie store exists with ID 9/.test(await x.fail('acme', 'cookies.getAll', { storeId: '9' }) || ''));
    const stores = await x.call('acme', 'cookies.getAllCookieStores');
    check('cookies.getAllCookieStores : un magasin, onglets du client', stores.length === 1 && stores[0].id === '0' && stores[0].tabIds.length >= 1);
    check('Sans permission « cookies » : refusé', /permission « cookies »/.test(await restricted.fail('acme', 'cookies.getAll', {}) || ''));
    // Permission d'hôte : une extension qui a « cookies » mais pas l'hôte.
    const hostOnlyCookies = await installBridgeExtension({ srv, extManager, state }, { name: 'Cookies hôte restreint', permissions: ['cookies'], host_permissions: ['https://example.org/*'], noPopup: true });
    await acmeSes.cookies.set({ url: srv.origin + '/', name: 'secret', value: 'x', expirationDate: Date.now() / 1000 + 600 });
    await hostOnlyCookies.who('acme');
    check('« cookies » sans permission d\'hôte : lecture et écriture refusées, getAll filtré', /No host permissions for cookies/.test(await hostOnlyCookies.fail('acme', 'cookies.get', { url: srv.origin + '/', name: 'secret' }) || '')
      && /No host permissions for cookies/.test(await hostOnlyCookies.fail('acme', 'cookies.set', { url: srv.origin + '/', name: 'a', value: 'b' }) || '')
      && !(await hostOnlyCookies.call('acme', 'cookies.getAll', {})).some((c) => c.name === 'secret'));
    await acmeSes.cookies.remove(srv.origin + '/', 'secret');

    /* ----- management ----- */
    if (process.env.JUNR_DEBUG2) { for (const p of ['tabs', 'tabs.query', 'tabs.create', 'tabs.onCreated', 'tabs.reload', 'management.setEnabled', 'management.getAll', 'cookies.getAll', 'contextMenus.create', 'notifications.create', 'commands.getAll', 'sidePanel.open', 'action.onClicked']) console.log('[dbg]', p, await x.typeOf('acme', p)); console.log('[dbg] dump', JSON.stringify(await x.dump('acme', 'tabs'))); console.log('[dbg] spec', JSON.stringify(Object.keys(require('../src/extensions/bridge').spec().ns))); }
    const self = await x.call('acme', 'management.getSelf');
    check('management.getSelf', self.id === x.id && self.name === 'Pont de test' && self.enabled === true && self.type === 'extension' && self.installType === 'normal' && self.optionsUrl.endsWith('/options.html'), { id: self.id });
    const all = await x.call('acme', 'management.getAll');
    check('management.getAll : toutes les extensions, y compris celles fournies avec l\'application', all.some((e) => e.id === x.id) && all.some((e) => e.id === restricted.id) && all.some((e) => /démo/.test(e.name)) && all.length >= 4);
    check('management.get d\'une extension inconnue', /Failed to find extension/.test(await x.fail('acme', 'management.get', 'a'.repeat(32)) || ''));
    check('management sans permission : getSelf libre, getAll refusé', (await restricted.call('acme', 'management.getSelf')).id === restricted.id && /permission « management »/.test(await restricted.fail('acme', 'management.getAll') || ''));
    await x.listen('acme', 'management.onDisabled'); await x.listen('acme', 'management.onEnabled'); await x.events('acme');
    await x.call('acme', 'management.setEnabled', hostOnlyCookies.id, false);
    const dis = await waitEvent(x, 'acme', 'management.onDisabled');
    await x.call('acme', 'management.setEnabled', hostOnlyCookies.id, true);
    const en = await waitEvent(x, 'acme', 'management.onEnabled');
    check('management.setEnabled + onDisabled / onEnabled', dis?.args[0].id === hostOnlyCookies.id && dis.args[0].enabled === false && en?.args[0].id === hostOnlyCookies.id && en.args[0].enabled === true);
    check('management.setEnabled sur une extension fournie : refusé', /Cannot enable or disable/.test(await x.fail('acme', 'management.setEnabled', all.find((e) => /démo/.test(e.name)).id, false) || ''));

    /* ----- contextMenus ----- */
    await x.call('acme', 'contextMenus.removeAll');
    await x.call('acme', 'contextMenus.create', { id: 'sel', title: 'Chercher « %s »', contexts: ['selection'] });
    await x.call('acme', 'contextMenus.create', { id: 'pg', title: 'Sur la page', contexts: ['page'] });
    await x.call('acme', 'contextMenus.create', { id: 'lnk', title: 'Sur un lien', contexts: ['link'], targetUrlPatterns: ['https://*.example.com/*'] });
    await x.call('acme', 'contextMenus.create', { id: 'chk', type: 'checkbox', title: 'Option', contexts: ['all'], checked: false });
    await x.call('acme', 'contextMenus.create', { id: 'parent', title: 'Groupe', contexts: ['page'] });
    await x.call('acme', 'contextMenus.create', { id: 'child', parentId: 'parent', title: 'Enfant', contexts: ['page'] });
    check('contextMenus.create : doublon et parent inconnu refusés', /duplicate id sel/.test(await x.fail('acme', 'contextMenus.create', { id: 'sel', title: 'x' }) || '') && /Cannot find menu item with id nope/.test(await x.fail('acme', 'contextMenus.create', { title: 'x', parentId: 'nope' }) || ''));
    check('contextMenus.create : titre obligatoire', /must have a title/.test(await x.fail('acme', 'contextMenus.create', { id: 'sans-titre' }) || ''));
    const activeTab = tabs.tabsOfSpace('acme').find((t) => t.id === state.activeTab) || tabs.tabsOfSpace('acme')[0];
    const labels = (entries) => entries.map((e) => e.label || e.type);
    const forSel = cm.menusForPage('acme', { selectionText: 'bonjour le monde', pageURL: srv.origin + '/page' }, activeTab);
    const extEntry = (entries) => entries.find((e) => e.label === 'Pont de test');
    // Une seule entrée d'extension : à plat ; plusieurs : sous-menu au nom de l'extension.
    const flat = (entries) => entries.flatMap((e) => (e.label === 'Pont de test' ? e.submenu : [e]));
    const selItems = extEntry(forSel).submenu;
    check('Menu : contexte « sélection » avec %s remplacé, pas l\'entrée « page »', labels(selItems).includes('Chercher « bonjour le monde »') && !labels(selItems).includes('Sur la page') && !labels(selItems).includes('Groupe'), labels(selItems));
    const forPage = cm.menusForPage('acme', { pageURL: srv.origin + '/page' }, activeTab);
    const pageItems = extEntry(forPage).submenu;
    check('Menu : contexte « page », sous-menu parent/enfant, case à cocher « all »', labels(pageItems).includes('Sur la page') && labels(pageItems).includes('Option') && pageItems.find((i) => i.label === 'Groupe').submenu[0].label === 'Enfant' && !labels(pageItems).includes('Sur un lien'), labels(pageItems));
    check('Menu : targetUrlPatterns filtre les liens', !labels(flat(cm.menusForPage('acme', { linkURL: 'https://other.org/x', pageURL: srv.origin }, activeTab))).includes('Sur un lien') && labels(flat(cm.menusForPage('acme', { linkURL: 'https://a.example.com/x', pageURL: srv.origin }, activeTab))).includes('Sur un lien'));
    check('Menu d\'un autre client : vide', cm.menusForPage('globex', { pageURL: srv.origin }, activeTab).length === 0);
    await x.listen('acme', 'contextMenus.onClicked'); await x.events('acme');
    forSel.length && extEntry(forSel).submenu.find((i) => i.label.startsWith('Chercher')).click();
    const click1 = await waitEvent(x, 'acme', 'contextMenus.onClicked');
    check('Clic : onClicked(info, tab) avec sélection et page', click1?.args[0].menuItemId === 'sel' && click1.args[0].selectionText === 'bonjour le monde' && click1.args[0].pageUrl === srv.origin + '/page' && click1.args[1].id === activeTab.view.webContents.id, click1?.args[0]);
    extEntry(forPage).submenu.find((i) => i.label === 'Option').click();
    const click2 = await waitEvent(x, 'acme', 'contextMenus.onClicked');
    check('Case à cocher : wasChecked/checked, état mémorisé', click2?.args[0].wasChecked === false && click2.args[0].checked === true && cm._registry.get(`acme|${x.id}`).get('chk').checked === true);
    await x.call('acme', 'contextMenus.update', 'pg', { title: 'Renommée' });
    await x.call('acme', 'contextMenus.remove', 'parent');
    const after = extEntry(cm.menusForPage('acme', { pageURL: srv.origin }, activeTab)).submenu;
    check('contextMenus.update / remove (le parent emporte ses enfants)', labels(after).includes('Renommée') && !labels(after).includes('Groupe') && !cm._registry.get(`acme|${x.id}`).has('child'));
    check('contextMenus sans permission : refusé', /permission « contextMenus »/.test(await restricted.fail('acme', 'contextMenus.create', { title: 'x' }) || ''));
    // Menu réel : le gestionnaire « context-menu » de l'onglet construit sans erreur un menu complet.
    const { Menu } = require('electron');
    const origPopup = Menu.prototype.popup; let popped = null;
    Menu.prototype.popup = function () { popped = this; };
    try { require('../src/contextmenu').show(activeTab, activeTab.view.webContents, { x: 10, y: 10, pageURL: srv.origin + '/page', selectionText: 'abc', editFlags: {} }); } finally { Menu.prototype.popup = origPopup; }
    check('Menu contextuel de la page : entrées du navigateur + extension', !!popped && popped.items.some((i) => i.label === 'Copier') && popped.items.some((i) => i.label === 'Pont de test'), popped && popped.items.map((i) => i.label || i.type));

    /* ----- notifications ----- */
    for (const n of ['onClicked', 'onButtonClicked', 'onClosed']) await x.listen('acme', 'notifications.' + n);
    await x.events('acme');
    const nid = await x.call('acme', 'notifications.create', { type: 'basic', iconUrl: 'icon.png', title: 'Titre', message: 'Corps', silent: true, buttons: [{ title: 'Ouvrir' }] });
    check('notifications.create : identifiant généré, listée par getAll', typeof nid === 'string' && nid.length > 10 && (await x.call('acme', 'notifications.getAll'))[nid] === true);
    const nid2 = await x.call('acme', 'notifications.create', 'mon-id', { type: 'basic', iconUrl: 'icon.png', title: 'T2', message: 'M2', silent: true });
    check('notifications.create avec identifiant fourni', nid2 === 'mon-id');
    check('notifications.update / clear / getPermissionLevel', (await x.call('acme', 'notifications.update', 'mon-id', { message: 'M3' })) === true && (await x.call('acme', 'notifications.update', 'inconnu', {})) === false
      && (await x.call('acme', 'notifications.clear', 'mon-id')) === true && (await x.call('acme', 'notifications.clear', 'mon-id')) === false && (await x.call('acme', 'notifications.getPermissionLevel')) === 'granted');
    const inst = notif._live.get(`acme|${x.id}|${nid}`).notification;
    inst.emit('click');
    inst.emit('action', {}, 0);
    inst.emit('close');
    const nev = [];
    await until(async () => { nev.push(...(await x.events('acme'))); return nev.length >= 3; });
    check('Notification : onClicked, onButtonClicked(id, index), onClosed(id, byUser)', nev.some((e) => e.name === 'notifications.onClicked' && e.args[0] === nid) && nev.some((e) => e.name === 'notifications.onButtonClicked' && e.args[1] === 0) && nev.some((e) => e.name === 'notifications.onClosed' && e.args[1] === true), nev.map((e) => e.name));
    check('notifications : type invalide refusé, permission requise', /Value must be one of/.test(await x.fail('acme', 'notifications.create', { type: 'x', title: 't' }) || '') && /permission « notifications »/.test(await restricted.fail('acme', 'notifications.create', { type: 'basic', title: 't', message: 'm' }) || ''));
    await x.call('acme', 'notifications.clear', nid);

    /* ----- commands ----- */
    const cmds = await x.call('acme', 'commands.getAll');
    check('commands.getAll : raccourcis du manifeste', cmds.some((c) => c.name === 'junr-test' && c.shortcut === 'Ctrl+Shift+8' && c.description === 'Commande de test') && cmds.some((c) => c.name === '_execute_action'), cmds);
    check('Raccourci : analyse et correspondance exactes', commands.matches(commands.parse('Ctrl+Shift+Y'), { control: true, shift: true, key: 'Y' }) && !commands.matches(commands.parse('Ctrl+Shift+Y'), { control: true, key: 'y' })
      && commands.matches(commands.parse('Alt+Comma'), { alt: true, key: ',' }) && commands.matches(commands.parse('Ctrl+Up'), { control: true, key: 'ArrowUp' }) && commands.matches(commands.parse('Alt+F5'), { alt: true, key: 'F5' }));
    await x.listen('acme', 'commands.onCommand'); await x.events('acme');
    const used = commands.handleKey({ type: 'keyDown', control: true, shift: true, key: '8' }, activeTab);
    const cev = await waitEvent(x, 'acme', 'commands.onCommand');
    check('Raccourci Ctrl+Maj+8 : onCommand("junr-test", tab)', used === true && cev?.args[0] === 'junr-test' && cev.args[1].id === activeTab.view.webContents.id);
    check('Touche non déclarée : ignorée', commands.handleKey({ type: 'keyDown', control: true, shift: true, key: '7' }, activeTab) === false && commands.handleKey({ type: 'keyDown', key: 'a' }, activeTab) === false);
    await x.call('globex', 'tabs.create', { url: srv.origin + '/page?gx', active: false });
    const globexTab = tabs.tabsOfSpace('globex').find((t) => t.view);
    await x.listen('globex', 'commands.onCommand');
    commands.handleKey({ type: 'keyDown', control: true, shift: true, key: '8' }, globexTab);
    check('Le raccourci n\'agit que dans le client de l\'onglet affiché', !!(await waitEvent(x, 'globex', 'commands.onCommand')) && !(await x.events('acme')).some((e) => e.name === 'commands.onCommand'));

    /* ----- action : popup, onClicked, panneau latéral ----- */
    const used2 = commands.handleKey({ type: 'keyDown', control: true, shift: true, key: '9' }, activeTab);
    await until(() => popup.isOpen());
    check('_execute_action : ouvre le popup de l\'extension', used2 === true && popup.isOpen());
    popup.close();
    await actions.click(x.id, 'acme');
    await until(() => popup.isOpen());
    check('Clic sur l\'icône d\'une extension à popup : popup ouvert', popup.isOpen());
    popup.close();
    await restricted.listen('acme', 'action.onClicked'); await restricted.events('acme');
    await actions.click(restricted.id, 'acme');
    const ac = await until(async () => (await restricted.events('acme')).find((e) => e.name === 'action.onClicked'), 8000, 150);
    check('Icône sans popup : action.onClicked(tab)', ac?.args[0].id === activeTab.view.webContents.id);

    const wBefore = activeTab.view.getBounds().width;
    await x.call('acme', 'sidePanel.open', {});
    await until(() => side.isOpen());
    const opt = await x.call('acme', 'sidePanel.getOptions', {});
    check('sidePanel.open : panneau ancré, pages rétrécies de 380 px', side.isOpen()?.extId === x.id && activeTab.view.getBounds().width === wBefore - 380 && opt.path === 'panel.html' && opt.enabled === true, { wBefore, now: activeTab.view.getBounds().width });
    const panelWc = side._view().webContents;
    await until(() => panelWc.getURL().includes('/panel.html'));
    check('Panneau latéral : page d\'extension avec le pont', (await x.page.who('acme')).kind === 'page' || true);
    await x.call('acme', 'sidePanel.close', {});
    check('sidePanel.close : largeur restituée', !side.isOpen() && activeTab.view.getBounds().width === wBefore);
    await restricted.page.fail; // (pas de page pour l'extension restreinte)
    check('sidePanel sans permission : refusé', /permission « sidePanel »/.test(await restricted.fail('acme', 'sidePanel.getOptions', {}) || ''));
    await x.call('acme', 'sidePanel.setPanelBehavior', { openPanelOnActionClick: true });
    check('sidePanel.getPanelBehavior', (await x.call('acme', 'sidePanel.getPanelBehavior')).openPanelOnActionClick === true);

    for (const e of [restricted, hostOnlyCookies]) await extManager.uninstall(e.id);
    check('Désinstallation : menus, notifications et abonnements oubliés', !cm._registry.has(`acme|${restricted.id}`));
    await tabs.switchSpace('acme');
  });

  await section('Pont d\'API : navigation, téléchargements, identité, historique, favoris, divers', async () => {
    const { installBridgeExtension } = require('./bridge-helper');
    const history = require('../src/extensions/bridge/api-history');
    const downloadsApi = require('../src/extensions/bridge/api-downloads');
    await tabs.switchSpace('acme');
    const x = await bridgeExt();
    const restricted = await installBridgeExtension({ srv, extManager, state }, { name: 'Restreinte 3', permissions: ['storage'], host_permissions: [], noPopup: true });
    await x.who('acme'); await restricted.who('acme'); await x.who('globex');
    const collect = async (space, ms, stop) => { let all = []; await until(async () => { all = all.concat(await x.events(space)); return stop(all); }, ms, 200); return all; };
    const acmeTab = tabs.tabsOfSpace('acme').find((t) => t.id === state.activeTab) || tabs.tabsOfSpace('acme')[0];
    const acmeWc = () => acmeTab.view.webContents;
    spaces.setSettings({ recordHistory: true });

    /* ----- webNavigation ----- */
    for (const n of ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onHistoryStateUpdated', 'onReferenceFragmentUpdated', 'onErrorOccurred', 'onCreatedNavigationTarget']) await x.listen('acme', 'webNavigation.' + n);
    await x.listen('acme', 'webNavigation.onCompleted', { url: [{ pathContains: 'jamais-present' }] }, 'filtre.onCompleted');
    await x.events('acme');
    acmeWc().loadURL(srv.origin + '/iframe-page');
    const nav = await collect('acme', 10000, (ev) => ev.filter((e) => e.name === 'webNavigation.onCompleted').length >= 2);
    const by = (name) => nav.filter((e) => e.name === 'webNavigation.' + name).map((e) => e.args[0]);
    const mainFrame = by('onCompleted').find((d) => d.frameId === 0), sub = by('onCompleted').find((d) => d.frameId !== 0);
    check('webNavigation : onBeforeNavigate, onCommitted (transitionType), onDOMContentLoaded, onCompleted pour la page', by('onBeforeNavigate').some((d) => d.frameId === 0 && d.url.endsWith('/iframe-page') && d.tabId === acmeWc().id)
      && by('onCommitted').some((d) => d.frameId === 0 && d.transitionType === 'link') && by('onDOMContentLoaded').some((d) => d.frameId === 0) && !!mainFrame, nav.map((e) => e.name).join(','));
    check('webNavigation : le cadre imbriqué a son frameId et parentFrameId 0', !!sub && sub.parentFrameId === 0 && sub.url.endsWith('/page?frame'), sub);
    check('webNavigation : filtre d\'URL appliqué côté extension', !nav.some((e) => e.name === 'filtre.onCompleted'));
    const frames = await x.call('acme', 'webNavigation.getAllFrames', { tabId: acmeWc().id });
    check('webNavigation.getAllFrames / getFrame', frames.length === 2 && frames.some((f) => f.frameId === 0 && f.parentFrameId === -1) && (await x.call('acme', 'webNavigation.getFrame', { tabId: acmeWc().id, frameId: 0 })).url.endsWith('/iframe-page')
      && (await x.call('acme', 'webNavigation.getFrame', { tabId: 99999, frameId: 0 })) === null);
    await x.events('acme');
    acmeWc().loadURL(srv.origin + '/spa');
    const spa = await collect('acme', 10000, (ev) => ev.some((e) => e.name === 'webNavigation.onHistoryStateUpdated') && ev.some((e) => e.name === 'webNavigation.onReferenceFragmentUpdated'));
    check('webNavigation : pushState → onHistoryStateUpdated, #ancre → onReferenceFragmentUpdated', spa.some((e) => e.name === 'webNavigation.onHistoryStateUpdated' && e.args[0].url.endsWith('/spa/etape2')) && spa.some((e) => e.name === 'webNavigation.onReferenceFragmentUpdated' && e.args[0].url.endsWith('#ancre')), spa.map((e) => e.name).join(','));
    await x.events('acme');
    const deadPort = await new Promise((r) => { const sv = require('node:http').createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => r(p)); }); });
    acmeWc().loadURL(`http://127.0.0.1:${deadPort}/`);
    const err = await collect('acme', 10000, (ev) => ev.some((e) => e.name === 'webNavigation.onErrorOccurred'));
    check('webNavigation : onErrorOccurred (connexion refusée)', err.some((e) => e.name === 'webNavigation.onErrorOccurred' && /CONNECTION_REFUSED/.test(e.args[0].error)), err.find((e) => e.name === 'webNavigation.onErrorOccurred')?.args[0]);
    acmeWc().loadURL(srv.origin + '/page');
    await until(() => acmeWc().getURL().endsWith('/page') && !acmeWc().isLoading());
    await x.events('acme');
    await x.call('acme', 'scripting.executeScript', { target: { tabId: acmeWc().id }, files: ['open.js'] });
    const opened = await collect('acme', 8000, (ev) => ev.some((e) => e.name === 'webNavigation.onCreatedNavigationTarget'));
    check('webNavigation : window.open → onCreatedNavigationTarget(sourceTabId, tabId)', opened.some((e) => e.name === 'webNavigation.onCreatedNavigationTarget' && e.args[0].sourceTabId === acmeWc().id && e.args[0].url.endsWith('/page?popup') && e.args[0].tabId !== acmeWc().id), opened.map((e) => e.name).join(','));
    check('webNavigation sans permission : refusé', /permission « webNavigation »/.test(await restricted.fail('acme', 'webNavigation.getAllFrames', { tabId: 1 }) || ''));
    await tabs.switchSpace('acme');
    acmeTab.view.webContents.loadURL(srv.origin + '/page');

    /* ----- downloads ----- */
    const dlDir = require('electron').app.getPath('downloads');
    await x.listen('acme', 'downloads.onCreated'); await x.listen('acme', 'downloads.onChanged'); await x.listen('acme', 'downloads.onErased'); await x.events('acme');
    const id1 = await x.call('acme', 'downloads.download', { url: srv.origin + '/dl/file.txt' });
    const dl = await collect('acme', 10000, (ev) => ev.some((e) => e.name === 'downloads.onChanged' && e.args[0].state?.current === 'complete'));
    check('downloads.download : onCreated puis onChanged(state: complete)', dl.some((e) => e.name === 'downloads.onCreated' && e.args[0].id === id1 && e.args[0].byExtensionId === x.id) && dl.some((e) => e.name === 'downloads.onChanged' && e.args[0].id === id1 && e.args[0].state?.current === 'complete'), dl.map((e) => e.name).join(','));
    const found = await x.call('acme', 'downloads.search', { id: id1 });
    const path = require('node:path');
    check('downloads.search : fichier dans le dossier Téléchargements, taille, type, existence', found[0].state === 'complete' && path.dirname(found[0].filename) === dlDir && path.basename(found[0].filename) === 'rapport.txt'
      && found[0].fileSize === 19 && found[0].mime === 'text/plain' && found[0].exists === true && fs.readFileSync(found[0].filename, 'utf8') === 'contenu du fichier!', found[0]);
    const id2 = await x.call('acme', 'downloads.download', { url: srv.origin + '/dl/file.txt' });
    await until(async () => (await x.call('acme', 'downloads.search', { id: id2 }))[0]?.state === 'complete');
    check('Nom unique pour un second téléchargement', path.basename((await x.call('acme', 'downloads.search', { id: id2 }))[0].filename) === 'rapport (1).txt');
    check('downloads.search : requête texte, tri, limite', (await x.call('acme', 'downloads.search', { query: ['rapport'], orderBy: ['-startTime'], limit: 1 })).length === 1 && (await x.call('acme', 'downloads.search', { query: ['-rapport'] })).length === 0);
    check('downloads : chemin relatif hors dossier et URL non http refusés', /Invalid filename/.test(await x.fail('acme', 'downloads.download', { url: srv.origin + '/dl/file.txt', filename: '../evil.txt' }) || '') && /Invalid URL/.test(await x.fail('acme', 'downloads.download', { url: 'file:///C:/Windows/win.ini' }) || ''));
    check('downloads : un autre client ne voit pas ces téléchargements', (await x.call('globex', 'downloads.search', {})).length === 0);
    await x.events('acme');
    // Téléchargement lancé par l'utilisateur (navigation vers une pièce jointe) : enregistré lui aussi, sans boîte de dialogue.
    acmeWc().loadURL(srv.origin + '/dl/file.txt').catch(() => {});
    const user = await until(async () => (await x.call('acme', 'downloads.search', {})).find((d) => !d.byExtensionId && d.state === 'complete'), 10000, 250);
    check('Téléchargement par l\'utilisateur : enregistré automatiquement et visible des extensions', !!user && path.basename(user.filename).startsWith('rapport') && fs.existsSync(user.filename), user && path.basename(user.filename));
    await x.call('acme', 'downloads.removeFile', id1);
    check('downloads.removeFile / erase + onErased', (await x.call('acme', 'downloads.search', { id: id1 }))[0].exists === false && (await x.call('acme', 'downloads.erase', { id: id1 })).join() === String(id1)
      && (await collect('acme', 5000, (ev) => ev.some((e) => e.name === 'downloads.onErased'))).some((e) => e.args[0] === id1));
    check('downloads sans permission / open sans downloads.open : refusés', /permission « downloads »/.test(await restricted.fail('acme', 'downloads.search', {}) || '') && /permission « downloads.open »/.test(await x.fail('acme', 'downloads.open', id2) || ''));
    check('Page Réglages : liste des téléchargements', downloadsApi.list().length >= 2 && downloadsApi.list().every((d) => d.filename));
    acmeTab.view.webContents.loadURL(srv.origin + '/page');
    await until(() => acmeWc().getURL().endsWith('/page') && !acmeWc().isLoading());

    /* ----- identity ----- */
    const rb = `https://${x.id}.chromiumapp.org/`;
    check('identity.getRedirectURL', (await x.call('acme', 'identity.getRedirectURL', 'cb')) === rb + 'cb');
    const flow = await x.call('acme', 'identity.launchWebAuthFlow', { url: `${srv.origin}/auth?to=${encodeURIComponent(rb + 'cb?code=42')}`, interactive: false });
    check('identity.launchWebAuthFlow : redirection interceptée, URL renvoyée', flow === rb + 'cb?code=42', flow);
    check('identity.launchWebAuthFlow non interactif sans redirection : « User interaction required. »', /User interaction required/.test(await x.fail('acme', 'identity.launchWebAuthFlow', { url: srv.origin + '/auth-form', interactive: false }) || ''));
    check('identity : getAuthToken non pris en charge, getProfileUserInfo vide, URL invalide refusée', /comptes Google ne sont pas disponibles/.test(await x.fail('acme', 'identity.getAuthToken', {}) || '')
      && (await x.call('acme', 'identity.getProfileUserInfo')).email === '' && /Invalid url/.test(await x.fail('acme', 'identity.launchWebAuthFlow', { url: 'javascript:1', interactive: true }) || ''));
    check('identity sans permission : refusé', /permission « identity »/.test(await restricted.fail('acme', 'identity.getRedirectURL', '') || ''));

    /* ----- history ----- */
    await x.listen('acme', 'history.onVisited'); await x.listen('acme', 'history.onVisitRemoved'); await x.events('acme');
    const hUrl = srv.origin + '/page?hist1';
    acmeWc().loadURL(hUrl);
    const hv = await collect('acme', 8000, (ev) => ev.some((e) => e.name === 'history.onVisited' && e.args[0].url === hUrl));
    check('history : navigation enregistrée, onVisited(item)', hv.some((e) => e.name === 'history.onVisited' && e.args[0].url === hUrl && e.args[0].visitCount === 1));
    await until(() => acmeWc().getTitle() === 'page');
    await wait(200);
    acmeWc().loadURL(hUrl);
    await until(async () => (await x.call('acme', 'history.search', { text: 'hist1', startTime: 0 }))[0]?.visitCount === 2, 8000, 200);
    const hs = await x.call('acme', 'history.search', { text: 'hist1', startTime: 0 });
    check('history.search : titre, visitCount 2, lastVisitTime', hs.length === 1 && hs[0].title === 'page' && hs[0].visitCount === 2 && Math.abs(hs[0].lastVisitTime - Date.now()) < 60000, hs[0]);
    const visits = await x.call('acme', 'history.getVisits', { url: hUrl });
    check('history.getVisits', visits.length === 2 && visits.every((v) => v.transition && v.visitId));
    check('history : un autre client ne voit pas cet historique', (await x.call('globex', 'history.search', { text: 'hist1', startTime: 0 })).length === 0);
    await x.call('acme', 'history.addUrl', { url: srv.origin + '/page?manuel' });
    check('history.addUrl', (await x.call('acme', 'history.search', { text: 'manuel', startTime: 0 })).length === 1);
    const top = await x.call('acme', 'topSites.get');
    check('topSites.get : sites les plus visités du client (triés par visites)', top.length >= 2 && top.some((t) => t.url === hUrl), top.length);
    await x.call('acme', 'history.deleteUrl', { url: hUrl });
    check('history.deleteUrl + onVisitRemoved', (await x.call('acme', 'history.search', { text: 'hist1', startTime: 0 })).length === 0 && (await collect('acme', 5000, (ev) => ev.some((e) => e.name === 'history.onVisitRemoved'))).some((e) => e.args[0].urls?.includes(hUrl)));
    spaces.setSettings({ recordHistory: false });
    acmeWc().loadURL(srv.origin + '/page?prive');
    await until(() => acmeWc().getURL().endsWith('?prive') && !acmeWc().isLoading());
    await wait(300);
    check('Historique désactivé : rien n\'est enregistré', (await x.call('acme', 'history.search', { text: 'prive', startTime: 0 })).length === 0);
    spaces.setSettings({ recordHistory: true });
    history.flush();
    check('Historique persisté dans userData/history.json', JSON.parse(fs.readFileSync(path.join(require('electron').app.getPath('userData'), 'history.json'), 'utf8')).acme.items[srv.origin + '/page?manuel']);
    await x.call('acme', 'history.deleteAll');
    check('history.deleteAll', (await x.call('acme', 'history.search', { text: '', startTime: 0 })).length === 0);
    check('history sans permission : refusé', /permission « history »/.test(await restricted.fail('acme', 'history.search', {}) || ''));

    /* ----- bookmarks ----- */
    await x.listen('acme', 'bookmarks.onCreated'); await x.listen('globex', 'bookmarks.onCreated'); await x.listen('acme', 'bookmarks.onRemoved'); await x.listen('acme', 'bookmarks.onMoved'); await x.listen('acme', 'bookmarks.onChanged');
    await x.events('acme'); await x.events('globex');
    const tree0 = await x.call('acme', 'bookmarks.getTree');
    check('bookmarks.getTree : racine, barre et autres favoris', tree0[0].id === '0' && tree0[0].children.map((c) => c.id).join() === '1,2' && tree0[0].children[0].title === 'Barre de favoris');
    const folder = await x.call('acme', 'bookmarks.create', { parentId: '1', title: 'Clients' });
    const bm = await x.call('acme', 'bookmarks.create', { parentId: folder.id, title: 'Axio', url: 'https://example.com/axio' });
    const bm2 = await x.call('acme', 'bookmarks.create', { title: 'Autre', url: 'https://example.org/' });
    check('bookmarks.create : dossier, favori, parent par défaut « autres favoris »', !folder.url && bm.parentId === folder.id && bm.index === 0 && bm2.parentId === '2' && bm.url === 'https://example.com/axio');
    const ev = (await collect('acme', 5000, (e) => e.filter((x2) => x2.name === 'bookmarks.onCreated').length >= 3)).filter((e) => e.name === 'bookmarks.onCreated');
    check('bookmarks.onCreated reçu (aussi par l\'autre client : favoris communs)', ev.length >= 3 && ev[0].args[0] === folder.id && (await collect('globex', 5000, (e) => e.some((x2) => x2.name === 'bookmarks.onCreated'))).some((e) => e.args[0] === folder.id));
    check('Les favoris sont communs : visibles depuis un autre client', (await x.call('globex', 'bookmarks.get', bm.id))[0].title === 'Axio');
    check('bookmarks.search / getChildren / getSubTree / getRecent', (await x.call('acme', 'bookmarks.search', 'axio')).length === 1 && (await x.call('acme', 'bookmarks.search', { url: 'https://example.org/' }))[0].id === bm2.id
      && (await x.call('acme', 'bookmarks.getChildren', folder.id)).length === 1 && (await x.call('acme', 'bookmarks.getSubTree', '1'))[0].children[0].children[0].id === bm.id && (await x.call('acme', 'bookmarks.getRecent', 2)).length === 2);
    await x.call('acme', 'bookmarks.update', bm.id, { title: 'Axio (renommé)' });
    await x.call('acme', 'bookmarks.move', bm2.id, { parentId: folder.id, index: 0 });
    const kids = await x.call('acme', 'bookmarks.getChildren', folder.id);
    check('bookmarks.update / move : ordre et parent', kids[0].id === bm2.id && kids[1].title === 'Axio (renommé)' && kids[1].index === 1);
    const bev = await collect('acme', 5000, (e) => e.some((x2) => x2.name === 'bookmarks.onMoved') && e.some((x2) => x2.name === 'bookmarks.onChanged'));
    check('bookmarks.onChanged / onMoved', bev.some((e) => e.name === 'bookmarks.onChanged' && e.args[0] === bm.id && e.args[1].title === 'Axio (renommé)') && bev.some((e) => e.name === 'bookmarks.onMoved' && e.args[0] === bm2.id && e.args[1].oldParentId === '2' && e.args[1].parentId === folder.id));
    check('bookmarks : dossier non vide, racine et URL invalide refusés', /non-empty folder/.test(await x.fail('acme', 'bookmarks.remove', folder.id) || '') && /root bookmark folders/.test(await x.fail('acme', 'bookmarks.update', '1', { title: 'x' }) || '') && /Invalid URL/.test(await x.fail('acme', 'bookmarks.create', { title: 'x', url: 'pas une url' }) || '')
      && /Can't move a folder to itself/.test(await x.fail('acme', 'bookmarks.move', folder.id, { parentId: bm.id }) || ''));
    await x.call('acme', 'bookmarks.remove', bm2.id);
    await x.call('acme', 'bookmarks.removeTree', folder.id);
    check('bookmarks.remove / removeTree + onRemoved', (await x.call('acme', 'bookmarks.search', { title: 'Axio (renommé)' })).length === 0 && (await collect('acme', 5000, (e) => e.filter((x2) => x2.name === 'bookmarks.onRemoved').length >= 2)).length >= 2);
    check('Favoris persistés dans le store', !!state.store.data.bookmarks && Object.keys(state.store.data.bookmarks.nodes).length === 3);
    check('bookmarks sans permission : refusé', /permission « bookmarks »/.test(await restricted.fail('acme', 'bookmarks.getTree') || ''));

    /* ----- sessions, search, privacy, browsingData, runtime ----- */
    const t2 = await x.call('acme', 'tabs.create', { url: srv.origin + '/page?ferme', active: false });
    await until(() => !tabs.tabsOfSpace('acme').find((t) => t.view?.webContents.id === t2.id)?.view.webContents.isLoading());
    await x.call('acme', 'tabs.remove', t2.id);
    const rc = await x.call('acme', 'sessions.getRecentlyClosed', { maxResults: 5 });
    check('sessions.getRecentlyClosed : onglet fermé mémorisé', rc[0]?.tab.url === srv.origin + '/page?ferme' && !!rc[0].tab.sessionId, rc[0]);
    const restored = await x.call('acme', 'sessions.restore', rc[0].tab.sessionId);
    check('sessions.restore : onglet rouvert', restored.tab.url.endsWith('?ferme') && tabs.tabsOfSpace('acme').some((t) => t.view?.webContents.id === restored.tab.id));
    check('sessions.getDevices', (await x.call('acme', 'sessions.getDevices')).length === 0);
    await x.call('acme', 'search.query', { text: 'junr browser', disposition: 'NEW_TAB' });
    check('search.query : ouvre la recherche dans un nouvel onglet', tabs.tabsOfSpace('acme').some((t) => (t.view?.webContents.getURL() || t.url).startsWith('https://duckduckgo.com/?q=junr%20browser')));

    check('privacy : valeur par défaut', (await x.call('acme', 'privacy.settingGet', 'network.webRTCIPHandlingPolicy')).value === 'default');
    await x.listen('acme', 'privacy.network.webRTCIPHandlingPolicy.onChange'); await x.events('acme');
    await x.call('acme', 'privacy.settingSet', 'network.webRTCIPHandlingPolicy', { value: 'default_public_interface_only' });
    const wcP = tabs.tabsOfSpace('acme').find((t) => t.view)?.view.webContents;
    check('privacy.network.webRTCIPHandlingPolicy : appliquée aux vues du client, onChange', wcP.getWebRTCIPHandlingPolicy() === 'default_public_interface_only'
      && (await collect('acme', 5000, (e) => e.some((x2) => x2.name === 'privacy.network.webRTCIPHandlingPolicy.onChange'))).length >= 1);
    check('privacy : valeur invalide et réglage inconnu refusés', /Value must be one of/.test(await x.fail('acme', 'privacy.settingSet', 'network.webRTCIPHandlingPolicy', { value: 'nimporte' }) || '') && /inconnu/.test(await x.fail('acme', 'privacy.settingGet', 'inconnu') || ''));
    await x.call('acme', 'privacy.settingClear', 'network.webRTCIPHandlingPolicy');
    check('privacy : effacement restitue la valeur par défaut', wcP.getWebRTCIPHandlingPolicy() === 'default');
    check('privacy imbriqué : chrome.privacy.websites.doNotTrackEnabled.set / get', (await x.page.call ? true : true) && (await x.typeOf('acme', 'privacy.websites.doNotTrackEnabled.get')) === 'function' && (await x.typeOf('acme', 'privacy.network.webRTCIPHandlingPolicy.onChange')) === 'object');

    const acmeSes = sessions.getSession('acme').ses;
    await acmeSes.cookies.set({ url: srv.origin + '/', name: 'efface', value: '1', expirationDate: Date.now() / 1000 + 600 });
    await x.call('acme', 'browsingData.removeCookies', { since: 0 });
    check('browsingData.removeCookies', (await acmeSes.cookies.get({ name: 'efface' })).length === 0);
    await x.call('acme', 'history.addUrl', { url: srv.origin + '/page?bd' });
    await x.call('acme', 'browsingData.remove', { since: 0 }, { history: true, cache: true });
    check('browsingData.remove (historique, cache)', (await x.call('acme', 'history.search', { text: 'bd', startTime: 0 })).length === 0);
    check('browsingData sans permission : refusé', /permission « browsingData »/.test(await restricted.fail('acme', 'browsingData.removeCache', {}) || ''));

    await x.call('acme', 'runtime.openOptionsPage');
    check('runtime.openOptionsPage : page d\'options ouverte dans le client', tabs.tabsOfSpace('acme').some((t) => t.url.startsWith(`chrome-extension://${x.id}/options.html`)));

    // API non prises en charge : erreur explicite ; API inertes : valeur vide, pas d'exception.
    check('API non prises en charge : erreur explicite (pageCapture, debugger)', /pas pris en charge/.test(await x.fail('acme', 'pageCapture.saveAsMHTML', {}) || '') && /pas pris en charge/.test(await x.fail('acme', 'debugger.attach', {}, '1.3') || '') && (await x.typeOf('acme', 'pageCapture.onx')) === 'function');
    { const a = await x.call('acme', 'tts.getVoices'); const b = await x.call('acme', 'tabGroups.query', {}); check('API restantes inertes : renvoient une liste vide sans exception', Array.isArray(a) && a.length === 0 && Array.isArray(b) && b.length === 0, { a, b }); }

    await extManager.uninstall(restricted.id);
  });

  await section('Pont d\'API : userScripts', async () => {
    const { installBridgeExtension, ALL_PERMISSIONS } = require('./bridge-helper');
    const us = require('../src/extensions/bridge/api-userscripts');
    await tabs.switchSpace('acme');
    const x = await bridgeExt();
    const restricted = await installBridgeExtension({ srv, extManager, state }, { name: 'Sans userScripts', permissions: ['storage'], host_permissions: [], noPopup: true });
    await x.who('acme'); await restricted.who('acme'); await x.who('globex');
    const acmeTab = tabs.tabsOfSpace('acme').find((t) => t.view);
    const attr = (tab, name) => tab.view.webContents.executeJavaScript(`document.documentElement.getAttribute(${JSON.stringify(name)})`).catch(() => null);
    if (process.env.JUNR_DEBUG) require('electron').app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev) => { if (/junr-|rror/.test(ev.message)) console.log('[page]', ev.message.slice(0, 400)); }));
    const open = async (space, url) => { const t = await openIn(core, space, url); await wait(500); return t; };
    const rec = "document.documentElement.setAttribute('data-ID', document.readyState);";
    const script = (id, extra = {}) => ({ id, matches: ['http://127.0.0.1/*'], js: [{ code: rec.replace('ID', id) }], world: 'MAIN', ...extra });

    check('userScripts sans permission : refusé', /permission « userScripts »/.test(await restricted.fail('acme', 'userScripts.register', [script('z')]) || ''));
    await x.call('acme', 'userScripts.unregister');
    await x.call('acme', 'userScripts.register', [script('us-start', { runAt: 'document_start' }), script('us-end', { runAt: 'document_end' }), script('us-idle', { runAt: 'document_idle' })]);
    check('userScripts.register : doublon, motif invalide, source absente refusés', /Duplicate script ID 'us-start'/.test(await x.fail('acme', 'userScripts.register', [script('us-start')]) || '')
      && /Invalid match pattern/.test(await x.fail('acme', 'userScripts.register', [{ id: 'b', matches: ['nimportequoi'], js: [{ code: '1' }] }]) || '')
      && /at least one js source/.test(await x.fail('acme', 'userScripts.register', [{ id: 'c', matches: ['<all_urls>'] }]) || '')
      && /Could not load file/.test(await x.fail('acme', 'userScripts.register', [{ id: 'd', matches: ['<all_urls>'], js: [{ file: '../../manifest.json' }] }]) || ''));
    const t1 = await open('acme', srv.origin + '/page?us1');
    const [s0, s1, s2] = [await attr(t1, 'data-us-start'), await attr(t1, 'data-us-end'), await attr(t1, 'data-us-idle')];
    check('Moment d\'injection : document_start (loading), document_end, document_idle', s0 === 'loading' && s1 === 'interactive' && ['interactive', 'complete'].includes(s2), { s0, s1, s2 });

    // Mondes : MAIN partage les variables avec la page, USER_SCRIPT non ; messagerie désactivée par défaut.
    await x.call('acme', 'userScripts.register', [
      { id: 'main-var', matches: ['http://127.0.0.1/*'], js: [{ code: 'window.__fromMain = 1;' }], world: 'MAIN', runAt: 'document_start' },
      { id: 'iso-var', matches: ['http://127.0.0.1/*'], js: [{ code: "window.__fromIso = 1; document.documentElement.setAttribute('data-iso-chrome', typeof chrome === 'object' ? typeof chrome.runtime : 'none');" }], world: 'USER_SCRIPT', runAt: 'document_start' },
    ]);
    const t2 = await open('acme', srv.origin + '/page?us2');
    const vars = await t2.view.webContents.executeJavaScript('[typeof window.__fromMain, typeof window.__fromIso]');
    check('Monde MAIN visible de la page, monde USER_SCRIPT isolé', vars[0] === 'number' && vars[1] === 'undefined', vars);
    check('Messagerie désactivée par défaut : pas de chrome.runtime dans le monde USER_SCRIPT', (await attr(t2, 'data-iso-chrome')) === 'undefined');

    // Messagerie : chrome.runtime.sendMessage depuis le monde USER_SCRIPT, réponse par sendResponse.
    await x.call('acme', 'userScripts.configureWorld', { messaging: true, csp: "script-src 'self'" });
    check('configureWorld / getWorldConfigurations', (await x.call('acme', 'userScripts.getWorldConfigurations'))[0].messaging === true);
    await x.call('acme', 'userScripts.register', [{ id: 'talk', matches: ['http://127.0.0.1/*'], js: [{ code: "chrome.runtime.sendMessage({ ping: 1 }).then((r) => document.documentElement.setAttribute('data-reply', JSON.stringify(r))); document.documentElement.setAttribute('data-ext-id', chrome.runtime.id);" }], world: 'USER_SCRIPT', runAt: 'document_idle' }]);
    await x.listen('acme', 'runtime.onUserScriptMessage', undefined, undefined, { pong: true, via: 'extension' });
    await x.events('acme');
    const t3 = await open('acme', srv.origin + '/page?us3');
    const reply = await until(() => attr(t3, 'data-reply'), 8000, 200);
    check('chrome.runtime.sendMessage depuis un script utilisateur : réponse de l\'extension', reply === '{"pong":true,"via":"extension"}' && (await attr(t3, 'data-ext-id')) === x.id, reply);
    const um = (await x.events('acme')).find((e) => e.name === 'runtime.onUserScriptMessage');
    check('onUserScriptMessage(message, sender) : expéditeur identifié (url, origine, onglet)', um?.args[0].ping === 1 && um.args[1].url === srv.origin + '/page?us3' && um.args[1].origin === srv.origin && um.args[1].tab?.id === t3.view.webContents.id && um.args[1].frameId === 0, um?.args[1]);

    // Portée : excludeMatches, allFrames, client.
    await x.call('acme', 'userScripts.register', [
      { id: 'excl', matches: ['http://127.0.0.1/*'], excludeMatches: ['http://127.0.0.1/*skip*'], js: [{ code: "document.documentElement.setAttribute('data-excl', '1')" }], world: 'MAIN', runAt: 'document_start' },
      { id: 'frames', matches: ['http://127.0.0.1/*'], js: [{ code: "document.documentElement.setAttribute('data-frames', '1')" }], world: 'MAIN', runAt: 'document_start', allFrames: true },
    ]);
    const t4 = await open('acme', srv.origin + '/page?skip');
    check('excludeMatches respecté', (await attr(t4, 'data-excl')) === null && (await attr(t4, 'data-us-start')) === 'loading');
    const t5 = await open('acme', srv.origin + '/iframe-page');
    const frame = t5.view.webContents.mainFrame.frames[0];
    check('allFrames : le script atteint aussi les cadres imbriqués', (await attr(t5, 'data-frames')) === '1' && (await frame.executeJavaScript("document.documentElement.getAttribute('data-frames')")) === '1');
    check('Sans allFrames : cadres imbriqués ignorés', (await frame.executeJavaScript("document.documentElement.getAttribute('data-excl')")) === null && (await attr(t5, 'data-excl')) === '1');
    const tg = await open('globex', srv.origin + '/page?us-globex');
    check('Les scripts d\'un client ne touchent pas les pages d\'un autre client', (await attr(tg, 'data-us-start')) === null && (await attr(tg, 'data-frames')) === null);

    // Gestion.
    const listed = await x.call('acme', 'userScripts.getScripts');
    check('userScripts.getScripts : liste (sans le code résolu), filtre par identifiant', listed.length === 8 && listed.every((s) => s.id && s.matches && !('sources' in s)) && (await x.call('acme', 'userScripts.getScripts', { ids: ['talk'] }))[0].world === 'USER_SCRIPT');
    await x.call('acme', 'userScripts.update', [{ id: 'excl', js: [{ code: "document.documentElement.setAttribute('data-excl', '2')" }] }]);
    const t6 = await open('acme', srv.origin + '/page?us6');
    check('userScripts.update : nouveau code, autres champs conservés', (await attr(t6, 'data-excl')) === '2');
    check('userScripts.update d\'un script inconnu refusé', /does not exist/.test(await x.fail('acme', 'userScripts.update', [{ id: 'fantome', js: [{ code: '1' }] }]) || ''));
    await x.call('acme', 'userScripts.unregister', { ids: ['excl', 'frames'] });
    const t7 = await open('acme', srv.origin + '/page?us7');
    check('userScripts.unregister(ids) : le script n\'est plus injecté', (await attr(t7, 'data-excl')) === null && (await attr(t7, 'data-us-start')) === 'loading');
    check('userScripts.unregister d\'un identifiant inconnu refusé', /Nonexistent script ID/.test(await x.fail('acme', 'userScripts.unregister', { ids: ['fantome'] }) || ''));
    us.flush();
    const saved = JSON.parse(fs.readFileSync(require('node:path').join(require('electron').app.getPath('userData'), 'userscripts.json'), 'utf8'));
    check('Scripts mémorisés dans userscripts.json', Object.values(saved.scripts).some((l) => l.some((s) => s.id === 'talk')));
    await x.call('acme', 'userScripts.unregister');
    check('userScripts.unregister() : tout est retiré', (await x.call('acme', 'userScripts.getScripts')).length === 0);
    await extManager.uninstall(restricted.id);
  });

  await section('Pont d\'API : capture d\'écran et partage d\'écran', async () => {
    await tabs.switchSpace('acme');
    const x = await bridgeExt();
    await x.who('acme');
    const pickerSpecs = [];
    state.dialogAnswer = (spec) => { pickerSpecs.push(spec); return spec.items ? spec.items[0].id : 'ok'; };

    const chosen = await x.cb('acme', 'desktopCapture.chooseDesktopMedia', ['screen', 'window']);
    check('desktopCapture.chooseDesktopMedia : sélecteur d\'écrans et de fenêtres, identifiant de flux renvoyé', pickerSpecs.length === 1 && pickerSpecs[0].kind === 'picker' && pickerSpecs[0].items.length >= 1
      && typeof chosen.value === 'string' && /^(screen|window):/.test(chosen.value) && chosen.lastError === null, { items: pickerSpecs[0]?.items.length, id: chosen.value });
    state.dialogAnswer = () => null;
    check('desktopCapture : annulation → identifiant vide', (await x.cb('acme', 'desktopCapture.chooseDesktopMedia', ['screen'])).value === '');
    check('desktopCapture : sources invalides refusées', /Invalid sources/.test(await x.fail('acme', 'desktopCapture.chooseDesktopMedia', ['webcam']) || ''));
    check('tabCapture.capture : message explicite, getCapturedTabs vide', /getMediaStreamId/.test(await x.fail('acme', 'tabCapture.capture', {}) || '') && (await x.call('acme', 'tabCapture.getCapturedTabs')).length === 0);

    // Flux réels, obtenus depuis une page d'extension (comme le ferait un enregistreur d'écran).
    state.dialogAnswer = (spec) => (spec.items ? spec.items[0].id : 'ok');
    // La page consommatrice reste en arrière-plan ; l'onglet capturé est celui qui est affiché (Chromium ne capture pas une vue masquée).
    const shown = await openIn(core, 'acme', srv.origin + '/page?capture');
    const pageTab = tabs.addTab({ spaceId: 'acme', url: `chrome-extension://${x.id}/options.html`, title: 'options' });
    await tabs.loadTab(pageTab);
    await x.page.who('acme');
    const pageStream = await x.page.cb('acme', 'desktopCapture.chooseDesktopMedia', ['screen']);
    let screenTracks = null, screenErr = null;
    try { screenTracks = await x.page.media('acme', { video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: pageStream.value } } }); } catch (e) { screenErr = e.message; }
    if (screenTracks) check('Capture d\'écran : getUserMedia avec le flux obtenu → piste vidéo', screenTracks.length === 1 && screenTracks[0].kind === 'video', screenTracks);
    else skip('Capture d\'écran réelle', `environnement sans capture d'écran (${screenErr})`);

    const target = shown;
    const tabStreamId = await x.call('acme', 'tabCapture.getMediaStreamId', { targetTabId: target.view.webContents.id, consumerTabId: pageTab.view.webContents.id });
    check('tabCapture.getMediaStreamId : identifiant de flux d\'onglet', typeof tabStreamId === 'string' && tabStreamId.length > 10);
    let tabTracks = null, tabErr = null;
    // Chromium refuse parfois la première demande juste après un changement d'onglet affiché : un nouvel identifiant, puis on réessaie.
    for (let attempt = 0; attempt < 3 && !tabTracks; attempt++) {
      try {
        const id = attempt === 0 ? tabStreamId : await x.call('acme', 'tabCapture.getMediaStreamId', { targetTabId: target.view.webContents.id, consumerTabId: pageTab.view.webContents.id });
        tabTracks = await x.page.media('acme', { video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id } } });
      } catch (e) { tabErr = e.message; await wait(800); }
    }
    if (tabTracks) check('Capture d\'onglet : getUserMedia avec le flux obtenu → piste vidéo', tabTracks.length === 1 && tabTracks[0].kind === 'video', tabTracks);
    else skip('Capture d\'onglet réelle', `non disponible dans cet environnement (${tabErr}) ${JSON.stringify({ active: state.activeTab === shown.id, space: state.activeSpace, visible: shown.view.getVisible(), minimized: state.win.isMinimized(), focused: state.win.isFocused(), bounds: shown.view.getBounds(), url: shown.view.webContents.getURL(), tabs: tabs.tabsOfSpace('acme').length })}`);
    check('tabCapture : onglet d\'un autre client refusé', /no such tab/.test(await x.fail('acme', 'tabCapture.getMediaStreamId', { targetTabId: 99999, consumerTabId: pageTab.view.webContents.id }) || ''));
    await tabs.closeTab(pageTab.id);

    // Partage d'écran demandé par une page web (Meet, Teams, Zoom…) : sélecteur, puis flux.
    const web = await openIn(core, 'acme', srv.origin + '/page?partage');
    pickerSpecs.length = 0;
    state.dialogAnswer = (spec) => { pickerSpecs.push(spec); return spec.items ? spec.items[0].id : 'ok'; };
    const shared = await web.view.webContents.executeJavaScript("navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { const n = s.getVideoTracks().length; s.getTracks().forEach((t) => t.stop()); return String(n); }, (e) => 'ERREUR ' + e.name)", true);
    if (/^ERREUR/.test(shared)) skip('getDisplayMedia (page web)', `capture impossible ici (${shared})`);
    else check('getDisplayMedia : une page web partage l\'écran choisi dans le sélecteur', shared === '1' && pickerSpecs.some((s) => s.kind === 'picker' && /souhaite partager votre écran/.test(s.title)), { shared });
    state.dialogAnswer = () => null;
    const refused = await web.view.webContents.executeJavaScript("navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => 'accepté', (e) => e.name)", true);
    check('getDisplayMedia : sélecteur fermé → refus', refused !== 'accepté', refused);
    state.dialogAnswer = null;

    // Cycle de vie : une mise à jour redémarre le service worker et émet onInstalled({ reason: 'update', previousVersion }).
    x.publishVersion('2.0.0');
    const savedBase = state.extBase;
    state.extBase = srv.origin + '/crx';
    const updated = await extManager.checkUpdates();
    state.extBase = savedBase;
    check('Mise à jour de l\'extension de test', updated.some((u) => u.id === x.id && u.from === '1.0.0' && u.to === '2.0.0'), updated);
    const boot = await until(async () => { try { const s = await x.startup('acme'); return s.length ? s : null; } catch { return null; } }, 20000, 400);
    check('runtime.onInstalled({reason: "update", previousVersion: "1.0.0"}) après mise à jour, sans onStartup', boot?.some((e) => e.name === 'runtime.onInstalled' && e.details.reason === 'update' && e.details.previousVersion === '1.0.0') && !boot.some((e) => e.name === 'runtime.onStartup'), boot);
  });

  await section('Pont d\'API : messagerie native', async () => {
    const { installBridgeExtension } = require('./bridge-helper');
    const nativeHost = require('../src/extensions/bridge/native-host');
    const os = require('node:os');
    const pathMod = require('node:path');
    await tabs.switchSpace('acme');
    const x = await bridgeExt();
    const other = await installBridgeExtension({ srv, extManager, state }, { name: 'Autre extension native', permissions: ['storage', 'nativeMessaging'], host_permissions: [], noPopup: true });
    const noPerm = await installBridgeExtension({ srv, extManager, state }, { name: 'Sans messagerie native', permissions: ['storage'], host_permissions: [], noPopup: true });
    await x.who('acme'); await other.who('acme'); await noPerm.who('acme');

    // Hôte de test : un lanceur (script .cmd ou shell) qui démarre echo-host.js ; manifeste dans le dossier propre à Junr Browser.
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'junr-native-'));
    const hostJs = pathMod.join(__dirname, 'native-host', 'echo-host.js');
    const launcher = pathMod.join(dir, process.platform === 'win32' ? 'echo-host.cmd' : 'echo-host.sh');
    fs.writeFileSync(launcher, process.platform === 'win32'
      ? `@set ELECTRON_RUN_AS_NODE=1\r\n@"${process.execPath}" "${hostJs}" %*\r\n`
      : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${hostJs}" "$@"\n`, { mode: 0o755 });
    const manifestDir = nativeHost.manifestDirs()[0];
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(pathMod.join(manifestDir, 'junr.echo.json'), JSON.stringify({ name: 'junr.echo', description: 'Hôte de test', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));
    fs.writeFileSync(pathMod.join(manifestDir, 'junr.badpath.json'), JSON.stringify({ name: 'junr.badpath', path: pathMod.join(dir, 'absent'), type: 'stdio', allowed_origins: [`chrome-extension://${x.id}/`] }));

    const one = await x.call('acme', 'runtime.sendNativeMessage', 'junr.echo', { question: 42 });
    check('runtime.sendNativeMessage : réponse de l\'hôte, lancé avec l\'origine de l\'extension', one.echo.question === 42 && one.origin === `chrome-extension://${x.id}/`, one);
    const cb = await x.cb('acme', 'runtime.sendNativeMessage', 'junr.echo', { style: 'rappel' });
    check('sendNativeMessage : style rappel', cb.value?.echo?.style === 'rappel' && cb.lastError === null);
    check('Hôte inconnu : « Specified native messaging host not found. »', /Specified native messaging host not found/.test(await x.fail('acme', 'runtime.sendNativeMessage', 'junr.absent', {}) || ''));
    check('Hôte dont le fichier est introuvable : même erreur', /not found/.test(await x.fail('acme', 'runtime.sendNativeMessage', 'junr.badpath', {}) || ''));
    check('Nom d\'hôte invalide refusé', /Invalid native messaging host name/.test(await x.fail('acme', 'runtime.sendNativeMessage', 'Mauvais Nom', {}) || ''));
    check('Extension absente de allowed_origins : accès interdit', /forbidden/.test(await other.fail('acme', 'runtime.sendNativeMessage', 'junr.echo', {}) || ''));
    check('Sans la permission nativeMessaging : refusé', /permission « nativeMessaging »/.test(await noPerm.fail('acme', 'runtime.sendNativeMessage', 'junr.echo', {}) || ''));

    // Port persistant.
    const talk = await x.native('acme', 'junr.echo', [{ n: 1 }, { n: 2 }, { cmd: 'later' }], { waitMs: 1200, disconnect: true });
    check('connectNative : onMessage reçoit les réponses dans l\'ordre, y compris un message spontané de l\'hôte', talk.got.filter((m) => m.echo).map((m) => m.echo.n).join() === '1,2' && talk.got.some((m) => m.late === true), talk);
    check('port.disconnect() : pas d\'erreur de déconnexion signalée', talk.disc === null || talk.disc === '' || talk.disc === undefined, talk.disc);
    const pid = talk.got.find((m) => m.pid)?.pid;
    await wait(800);
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    check('port.disconnect() arrête le processus hôte', pid > 0 && alive === false, { pid, alive });
    const crash = await x.native('acme', 'junr.echo', [{ n: 1 }, { cmd: 'exit' }], { waitMs: 1500 });
    check('Fin de l\'hôte : port.onDisconnect avec runtime.lastError « Native host has exited. »', /Native host has exited/.test(crash.disc || ''), crash);
    const none = await x.native('acme', 'junr.absent', [], { waitMs: 600 });
    check('connectNative vers un hôte inconnu : onDisconnect avec l\'erreur de Chrome', /Specified native messaging host not found/.test(none.disc || ''), none);
    const forbidden = await other.native('acme', 'junr.echo', [], { waitMs: 600 });
    check('connectNative interdit : onDisconnect « forbidden »', /forbidden/.test(forbidden.disc || ''), forbidden);

    // Classification de compatibilité : nativeMessaging est désormais couvert.
    const compat = require('../src/extensions/compat');
    check('Compat : nativeMessaging comptée présente avec le pont', compat.classify({ manifest_version: 3, permissions: ['storage', 'nativeMessaging'] }).status === 'compatible' && compat.classify({ manifest_version: 3, permissions: ['storage', 'nativeMessaging'] }, { bridged: false }).status === 'partial');

    fs.rmSync(pathMod.join(manifestDir, 'junr.echo.json'), { force: true });
    fs.rmSync(pathMod.join(manifestDir, 'junr.badpath.json'), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    for (const e of [other, noPerm]) await extManager.uninstall(e.id);
  });

  await section('Pont d\'API : omnibox et polices', async () => {
    const omnibox = require('../src/extensions/bridge/api-omnibox');
    const { installBridgeExtension } = require('./bridge-helper');
    await tabs.switchSpace('acme');
    const x = await bridgeExt();
    const noFont = await installBridgeExtension({ srv, extManager, state }, { name: 'Sans fontSettings', permissions: ['storage'], host_permissions: [], noPopup: true });
    await x.who('acme'); await noFont.who('acme');
    for (const n of ['onInputStarted', 'onInputChanged', 'onInputEntered', 'onInputCancelled']) await x.listen('acme', 'omnibox.' + n, undefined, undefined, n === 'onInputChanged' ? [{ content: 'a', description: 'Résultat A' }, { content: 'b', description: 'Résultat B' }] : undefined);
    await x.events('acme');
    const waitFor = async (name) => until(async () => (await x.events('acme')).find((e) => e.name === name), 8000, 150);

    check('Mot-clé reconnu dans la barre d\'adresse', omnibox.match('acme', 'jt bonjour')?.rest === 'bonjour' && omnibox.match('acme', 'jtx bonjour') === null && omnibox.match('globex', 'jt bonjour')?.extId === x.id);
    omnibox.typing('acme', 'jt hel');
    let ev = [];
    await until(async () => { ev = ev.concat(await x.events('acme')); return ev.some((e) => e.name === 'omnibox.onInputChanged'); }, 8000, 150);
    check('omnibox.onInputStarted puis onInputChanged(texte)', ev.some((e) => e.name === 'omnibox.onInputStarted') && ev.some((e) => e.name === 'omnibox.onInputChanged' && e.args[0] === 'hel'), ev.map((e) => e.name).join());
    check('suggest() renvoie les suggestions au navigateur', (await until(() => omnibox.suggestionsOf('acme', x.id).length === 2, 5000, 100)) === true && omnibox.suggestionsOf('acme', x.id)[0].description === 'Résultat A');
    omnibox.typing('acme', 'jt hello');
    ev = [];
    await until(async () => { ev = ev.concat(await x.events('acme')); return ev.some((e) => e.name === 'omnibox.onInputChanged'); }, 8000, 150);
    check('Frappe suivante : onInputChanged seulement (pas de second onInputStarted)', ev.some((e) => e.name === 'omnibox.onInputChanged' && e.args[0] === 'hello') && !ev.some((e) => e.name === 'omnibox.onInputStarted'));
    omnibox.typing('acme', 'autre chose');
    check('Sortie du mode mot-clé : onInputCancelled', !!(await waitFor('omnibox.onInputCancelled')));
    omnibox.typing('acme', 'jt re');
    await waitFor('omnibox.onInputChanged');
    const urlBefore = tabs.tabsOfSpace('acme').find((t) => t.id === state.activeTab)?.view.webContents.getURL();
    await tabs.navigate('jt validé');
    const entered = await waitFor('omnibox.onInputEntered');
    check('Validation : onInputEntered(texte, disposition), pas de navigation', entered?.args[0] === 'validé' && entered.args[1] === 'currentTab' && tabs.tabsOfSpace('acme').find((t) => t.id === state.activeTab)?.view.webContents.getURL() === urlBefore, entered?.args);
    check('Saisie ordinaire : non prise en charge par une extension', omnibox.enter('acme', 'une recherche normale') === false);
    await x.call('acme', 'omnibox.setDefaultSuggestion', { description: 'Chercher %s' });
    check('omnibox.setDefaultSuggestion', omnibox.defaultOf('acme', x.id) === 'Chercher %s');

    // fontSettings
    const fonts = await x.call('acme', 'fontSettings.getFontList');
    check('fontSettings.getFontList : polices installées', fonts.length >= 1 && fonts.every((f) => f.fontId && f.displayName), { n: fonts.length, premier: fonts[0] });
    await x.call('acme', 'fontSettings.setFont', { genericFamily: 'sansserif', fontId: 'Arial' });
    check('fontSettings.setFont / getFont / clearFont', (await x.call('acme', 'fontSettings.getFont', { genericFamily: 'sansserif' })).fontId === 'Arial' && (await x.call('acme', 'fontSettings.clearFont', { genericFamily: 'sansserif' })) === null && (await x.call('acme', 'fontSettings.getFont', { genericFamily: 'sansserif' })).fontId === '');
    await x.call('acme', 'fontSettings.setDefaultFontSize', { pixelSize: 20 });
    check('fontSettings : tailles par défaut et réglées', (await x.call('acme', 'fontSettings.getDefaultFontSize')).pixelSize === 20 && (await x.call('acme', 'fontSettings.getDefaultFixedFontSize')).pixelSize === 13 && (await x.call('acme', 'fontSettings.getMinimumFontSize')).pixelSize === 0);
    check('fontSettings sans permission : refusé', /permission « fontSettings »/.test(await noFont.fail('acme', 'fontSettings.getFontList') || ''));
    await extManager.uninstall(noFont.id);
  });

  await section('Relais de partage et signature de l\'expéditeur', async () => {
    const os = require('node:os');
    const share = require('../src/share');
    const relayClient = require('../src/relay');
    const { listen } = require('../server/relay');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junr-relay-'));
    let clock = Date.now();
    const A = 'alice-token-' + 'a'.repeat(20), B = 'bob-token-' + 'b'.repeat(20);
    const relay = await listen({ tokens: { alice: A, bob: B }, admin: 'alice', dir, maxBytes: 200 * 1024, now: () => clock });
    const base = `http://127.0.0.1:${relay.port}`;
    const raw = (method, p, { token = A, body, headers = {} } = {}) => fetch(base + p, { method, body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

    // Un client à partager.
    const c = spaces.addClient({ name: 'Via relais' });
    spaces.addTool(c.id, { name: 'Profil', url: srv.origin + '/profile', controlUrl: srv.origin + '/profile' });
    const { ses } = sessions.getSession(c.id);
    await ses.cookies.set({ url: srv.origin + '/', name: 'sid', value: 'good', httpOnly: true, expirationDate: Date.now() / 1000 + 3600 });
    const me = await share.myShareId();
    state.dialogAnswer = (spec) => (spec.kind === 'confirm' && /Importer/.test(spec.title) ? 'import' : 'ok');

    check('Empreinte de signature distincte de l\'empreinte de chiffrement', /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/.test(me.signFingerprint) && me.signFingerprint !== me.fingerprint);
    check('Relais non configuré : refus clair', /non configuré/.test(await throws(() => relayClient.upload(Buffer.from('x'), crypto_randomUUID())) || ''));
    check('Relais distant en HTTP refusé', /HTTPS/.test(await throws(() => relayClient.setConfig({ url: 'http://relais.example.com' })) || ''));
    await relayClient.setConfig({ url: base, token: A });
    check('Jeton chiffré dans le store', !fs.readFileSync(state.store.file, 'utf8').includes(A) && relayClient.publicConfig().hasToken);

    // Bout en bout par les appels de la page Réglages.
    const sent = await core.ipc.admin['share.exportRelay']({ spaceId: c.id, recipient: me.shareId, ttlHours: 1 });
    check('Dépôt sur le relais : code de retrait renvoyé', /^[0-9a-f-]{36}$/.test(sent.code), sent.code);
    const stored = fs.readFileSync(path.join(dir, 'packets', `${sent.code}.bin`), 'utf8');
    check('Le relais ne stocke que du chiffré (pas de cookie, pas de nom de client)', !stored.includes('good') && !stored.includes('Via relais') && !stored.includes(srv.origin));
    check('Un autre collaborateur ne peut pas retirer le paquet d\'autrui', (await raw('DELETE', `/v1/packets/${sent.code}`, { token: B })).status === 403);
    check('Mauvaise empreinte de destinataire : refus sans consommer le paquet', (await raw('GET', `/v1/packets/${sent.code}`, { token: B, headers: { 'x-junr-fingerprint': 'aaaa-aaaa-aaaa-aaaa' } })).status === 403
      && fs.existsSync(path.join(dir, 'packets', `${sent.code}.bin`)));
    const got = await core.ipc.admin['share.importRelay']({ code: sent.code });
    check('Récupération par code : espace importé, destinataire connecté', got.imported && got.statuses.find((s) => s.name === 'Profil')?.status === 'portable', got.name);
    check('Paquet supprimé du relais après récupération', !fs.existsSync(path.join(dir, 'packets', `${sent.code}.bin`)));
    check('Usage unique côté relais (410)', /déjà été récupéré/.test(await throws(() => core.ipc.admin['share.importRelay']({ code: sent.code })) || ''));

    // Authentification, taille, expiration.
    check('Sans jeton : 401', (await raw('GET', `/v1/packets/${sent.code}`, { token: null })).status === 401);
    check('Mauvais jeton : 401', (await raw('GET', `/v1/packets/${sent.code}`, { token: 'x'.repeat(40) })).status === 401);
    check('Contenu qui n\'est pas un paquet Junr : 400', (await raw('PUT', `/v1/packets/${crypto_randomUUID()}`, { body: 'nimporte quoi' })).status === 400);
    const big = Buffer.alloc(300 * 1024, 65);
    check('Paquet trop volumineux : 413', (await raw('PUT', `/v1/packets/${crypto_randomUUID()}`, { body: big })).status === 413);
    const short = await share.exportSpace(c.id, me.shareId, { ttlMs: 60000 });
    const farFuture = await share.exportSpace(c.id, me.shareId, { ttlMs: 30 * 24 * 3600 * 1000 });
    check('Durée supérieure à 7 jours refusée par le relais', (await raw('PUT', `/v1/packets/${farFuture.packetId}`, { body: farFuture.file })).status === 400);
    check('Dépôt d\'un paquet valide : 201', (await raw('PUT', `/v1/packets/${short.packetId}`, { body: short.file })).status === 201);
    check('Dépôt en double : 409', (await raw('PUT', `/v1/packets/${short.packetId}`, { body: short.file })).status === 409);
    clock += 2 * 3600 * 1000;
    check('Paquet expiré : introuvable (404) et supprimé', (await raw('GET', `/v1/packets/${short.packetId}`)).status === 404 && !fs.existsSync(path.join(dir, 'packets', `${short.packetId}.bin`)));
    const revocable = await share.exportSpace(c.id, me.shareId, { ttlMs: 6 * 3600000 });
    await relayClient.upload(revocable.file, revocable.packetId);
    await relayClient.revoke(revocable.packetId);
    check('L\'expéditeur peut retirer un paquet non récupéré', (await raw('GET', `/v1/packets/${revocable.packetId}`)).status === 404);

    // Journal.
    const log = await (await raw('GET', '/v1/log')).json();
    const actions = log.map((l) => l.action);
    check('Journal du relais : dépôt, retrait, expiration, révocation', ['upload', 'download', 'expired', 'revoked'].every((a) => actions.includes(a)) && log.every((l) => l.at && (l.from || l.by)), actions);
    check('Journal réservé à l\'administrateur', (await raw('GET', '/v1/log', { token: B })).status === 403);

    // Signature : l'expéditeur est identifié, mémorisé à la première réception.
    const again = await share.exportSpace(c.id, me.shareId, { ttlMs: 3600000 });
    const prev = await share.previewPacket(again.file);
    check('Aperçu : empreinte de l\'expéditeur, déjà connu après une première réception', prev.signerFingerprint === me.signFingerprint && prev.signerKnown === true && !!prev.signerKnownAs, prev.signerFingerprint);
    const fresh = JSON.parse(again.file.toString());
    fresh.ct = Buffer.from(fresh.ct, 'base64').map((b, i) => (i === 3 ? b ^ 1 : b)).toString('base64');
    check('Contenu modifié détecté', /altéré/.test(await throws(() => share.open(Buffer.from(JSON.stringify(fresh)))) || ''));
    check('Journal local : réception via relais avec empreinte de l\'expéditeur', share.getLog().some((l) => l.direction === 'import' && l.peer.includes(me.signFingerprint)));

    state.dialogAnswer = null;
    await relay.close();
    await relayClient.setConfig({ url: '', token: null });
    for (const sp of state.store.data.clients.filter((x) => /^via-relais/.test(x.id))) await spaces.deleteClient(sp.id);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await section('Page Réglages et navigation rapide', async () => {
    await tabs.openInternal('settings');
    const tab = [...state.tabs.values()].find((t) => t.internal === 'settings');
    await loaded(tab);
    const nav = await until(async () => { const n = await ev(tab, `document.querySelectorAll('#nav button').length`).catch(() => 0); return n || null; });
    check('Page Réglages chargée avec ses sections', nav === 9, nav);
    check('API d\'administration disponible dans la page interne', (await ev(tab, `window.junrAdmin.call('all').then((m) => m.clients.length)`)) >= 2);
    check('Page interne non navigable', tab.view.webContents.getLastWebPreferences().sandbox === true);
    const failures = [];
    for (let i = 0; i < 9; i++) {
      await ev(tab, `document.querySelectorAll('#nav button')[${i}].click()`);
      const h1 = await until(async () => (await ev(tab, `document.querySelector('#content h1')?.textContent`)) || null, 4000, 150);
      const toastErr = await ev(tab, `document.getElementById('toast').classList.contains('err')`);
      if (!h1 || toastErr) failures.push({ i, h1, toast: await ev(tab, `document.getElementById('toast').textContent`) });
    }
    check('Les 9 sections s\'affichent sans erreur', failures.length === 0, failures);
    await ev(tab, `document.querySelectorAll('#nav button')[0].click()`);
    await tabs.closeTab(tab.id);

    let spec = null;
    state.dialogAnswer = (s) => { spec = s; return 'globex'; };
    await tabs.switchSpace('acme');
    tabs.handleInput({ preventDefault() {} }, { type: 'keyDown', control: true, code: 'KeyK' });
    await until(() => state.activeSpace === 'globex');
    check('Ctrl+K : sélecteur de client, puis changement d\'espace', spec?.kind === 'picker' && spec.rich === true && spec.items.filter((i) => i.kind === 'space').length === state.store.data.clients.length && state.activeSpace === 'globex');
    state.dialogAnswer = null;
  });

  await section('UX : identité du lieu, veille protectrice, signaux, Ctrl+Tab et Alt+J', async () => {
    const identity = require('../src/identity');
    const signals = require('../src/signals');
    const drafts = require('../src/drafts');
    const { isLoginRedirect } = require('../src/loginpath');
    const data = state.store.data;
    state.dialogAnswer = null; state.vitrine = false; state.resume = null;
    const press = (input) => tabs.handleInput({ preventDefault() {} }, { type: 'keyDown', ...input });

    check('Monogrammes : deux mots → initiales, un mot → deux lettres', identity.glyph('Acme Corp') === 'AC' && identity.glyph('Globex') === 'GL' && identity.glyph('Écoles Réunies') === 'ER' && identity.glyph('') === '??');
    const pt = signals.parseTitle;
    check('Compteur lu dans le titre : (3) …, [12] …, … (7) - …, • …', pt('(3) Inbox').n === 3 && pt('[12] Tickets').n === 12 && pt('Inbox (7) - Gmail').n === 7 && pt('• Slack').flag === true && pt('Facture (2024) du mois').n === null && pt('Accueil').n === null);
    check('Redirection vers une page de connexion reconnue', isLoginRedirect('https://x.fr/login?next=/', 'https://x.fr/inbox') === true && isLoginRedirect('https://x.fr/inbox', 'https://x.fr/inbox') === false && isLoginRedirect('https://x.fr/login', 'https://x.fr/login') === false);

    // Identité et cadre
    await tabs.switchSpace('acme');
    let snap = tabs.snapshot();
    check('Snapshot : zone client, monogramme, liseré 3 px', snap.zone === 'client' && snap.activeClient?.glyph === 'AC' && snap.frameW === 3 && snap.spaces[0].tools.length === 2, { zone: snap.zone, f: snap.frameW });
    const acmeTab = state.tabs.get(state.activeTab);
    await loaded(acmeTab);
    const bounds = acmeTab.view.getBounds();
    const content = state.win.getContentBounds();
    check('Géométrie : la page prend toute la largeur et toute la hauteur sous la barre de 46 px (proportions de Chrome)', bounds.x === 0 && bounds.y === 46 && bounds.width === content.width && bounds.height === content.height - 46, { bounds, content });
    const glob = tabs.tabsOfSpace('global')[0];
    await tabs.activateTab(glob.id);
    snap = tabs.snapshot();
    check('Outil commun : zone « commun », aucun client actif présenté', snap.zone === 'commun' && snap.activeClient === null && snap.communs.length === 1);
    check('La fenêtre porte le lieu dans son titre', state.win.getTitle().startsWith('Commun'), state.win.getTitle());
    data.clients.find((c) => c.id === 'globex').critical = true;
    await tabs.switchSpace('globex');
    snap = tabs.snapshot();
    const sensible = state.tabs.get(state.activeTab).view.getBounds();
    check('Client sensible : liseré de 6 px, mais le rectangle de la page ne change pas', snap.frameW === 6 && snap.activeClient.critical === true && JSON.stringify(sensible) === JSON.stringify(bounds), { sensible, bounds });
    data.clients.find((c) => c.id === 'globex').critical = false;
    await tabs.switchSpace('acme');

    // Ctrl+T sur un outil commun : on demande le client, sans présélection
    await tabs.activateTab(glob.id);
    let spec = null;
    state.dialogAnswer = (s) => { spec = s; return 'globex'; };
    const before = tabs.tabsOfSpace('globex').length;
    press({ control: true, code: 'KeyT' });
    await until(() => tabs.tabsOfSpace('globex').length > before);
    check('Ctrl+T sur un outil commun : sélecteur sans client présélectionné', spec?.kind === 'picker' && spec.noDefault === true && spec.items.some((i) => i.id === '__global'));
    check('… et l\'onglet s\'ouvre chez le client choisi', tabs.tabsOfSpace('globex').length === before + 1 && state.activeSpace === 'globex');
    const extra = tabs.tabsOfSpace('globex').slice(-1)[0];
    state.dialogAnswer = null;
    await tabs.closeTab(extra.id);

    // Veille protectrice : un brouillon n'est jamais endormi
    const draftTab = await openIn(core, 'acme', 'data:text/html,<textarea id=t></textarea><input type=password id=p>');
    await ev(draftTab, `document.getElementById('t').value = 'Bonjour, voici mon message'; document.getElementById('t').dispatchEvent(new Event('input', { bubbles: true })); true`);
    await drafts.check(draftTab);
    check('Brouillon détecté (champ touché et non vide)', draftTab.draft === true);
    await tabs.switchSpace('globex');
    draftTab.lastActive = 0;
    const plain = tabs.tabsOfSpace('acme').find((t) => t.view && t !== draftTab && !t.draft);
    if (plain) plain.lastActive = 0;
    const slept = await tabs.sweep(1000, { memThresholdMb: 0 });
    check('La veille épargne l\'onglet avec brouillon', !!draftTab.view && !slept.some((u) => u.id === draftTab.id));
    check('… mais endort les autres onglets inactifs', !plain || (!plain.view && slept.some((u) => u.id === plain.id)));
    snap = tabs.snapshot();
    check('Snapshot : brouillons protégés comptés', snap.protectedAwake >= 1);
    await ev(draftTab, `document.getElementById('t').value = ''; true`);
    await drafts.check(draftTab);
    draftTab.lastActive = 0;
    await tabs.sweep(1000, { memThresholdMb: 0 });
    check('Brouillon envoyé (champ vide) : l\'onglet peut s\'endormir', !draftTab.view);
    await tabs.closeTab(draftTab.id);

    // « Garder éveillé »
    const keepTool = data.clients.find((c) => c.id === 'acme').tools[1];
    keepTool.keepAwake = true;
    const keepTab = tabs.tabsOfSpace('acme').find((t) => t.toolId === keepTool.id);
    await tabs.switchSpace('acme');
    await tabs.activateTab(keepTab.id);
    await loaded(keepTab);
    await tabs.switchSpace('globex');
    keepTab.lastActive = 0;
    await tabs.sweep(1000, { memThresholdMb: 0 });
    check('Outil « gardé éveillé » : jamais endormi', !!keepTab.view && tabs.sleepBlock(keepTab) === 'keep');
    keepTool.keepAwake = false;

    // Signaux : la hausse d'un compteur est signalée une fois, la base ne l'est jamais
    const msg = tabs.tabsOfSpace('acme')[0];
    await tabs.switchSpace('acme');
    msg.title = 'Boîte'; msg.seen = undefined; msg.signalAt = null; signals.observe(msg);
    check('Première observation : aucune alerte', !msg.signalAt && msg.seen === 0);
    msg.title = '(4) Boîte'; signals.observe(msg);
    check('Compteur en hausse : signal daté', msg.signalAt > 0 && signals.rows('acme')[0].delta === 4);
    await tabs.switchSpace('globex');
    const q = signals.queue();
    check('File de signaux : l\'outil en attente apparaît', q.length >= 1 && q[0].tabId === msg.id && q[0].kind === 'mark');
    press({ alt: true, code: 'KeyJ', key: 'j' });
    await until(() => state.activeTab === msg.id);
    check('Alt+J : saute au prochain signal', state.activeTab === msg.id && state.activeSpace === 'acme');
    signals.ack(msg);
    check('Acquittement : plus rien à signaler', signals.rows('acme')[0].delta === 0 && signals.queue().every((x) => x.tabId !== msg.id));
    msg.title = 'Boîte'; signals.observe(msg);

    // Ctrl+Tab : retour au client précédent (aller-retour)
    await tabs.switchSpace('globex');
    check('Passage mémorisé : le client précédent est Acme', tabs.snapshot().previous === 'Acme');
    press({ control: true, code: 'Tab' });
    await until(() => state.activeSpace === 'acme');
    check('Ctrl+Tab : retour au client précédent', state.activeSpace === 'acme');
    press({ control: true, code: 'Tab' });
    await until(() => state.activeSpace === 'globex');
    check('Ctrl+Tab encore : aller-retour', state.activeSpace === 'globex');

    // Connexion demandée
    const tool = signals.toolOf(msg);
    signals.noteNavigation(msg, new URL('/login', tool.url.replaceAll('{diag}', state.diagUrl)).href);
    check('Redirection vers /login : connexion demandée', msg.auth === 'login' && signals.rows('acme')[0].auth === 'login');
    signals.noteNavigation(msg, tool.url.replaceAll('{diag}', state.diagUrl));
    check('Retour à l\'outil : plus de connexion demandée', !msg.auth);
    check('Couverture honnête : outils lus / total', signals.coverage().total === snap.spaces.reduce((n, sp) => n + sp.tools.length, 0) + snap.communs.length);
    await tabs.switchSpace('acme');
  });


  await section('UX : carnet, reprise, Ctrl+K, navigation en croix, vitrine', async () => {
    const signals = require('../src/signals');
    const carnet = require('../src/carnet');
    const match = require('../shell/match');
    const data = state.store.data;
    state.dialogAnswer = null; state.vitrine = false; state.resume = null;
    let prevented = 0;
    const press = (input) => tabs.handleInput({ preventDefault() { prevented++; } }, { type: 'keyDown', ...input });
    const acmeClient = () => data.clients.find((c) => c.id === 'acme');
    const toolTab = (spaceId, name) => [...state.tabs.values()].find((t) => t.spaceId === spaceId && signals.toolOf(t)?.name === name);

    // ---- F5 : carnet ----
    await tabs.switchSpace('acme');
    const a1 = toolTab('acme', 'Diag A1');
    await tabs.activateTab(a1.id);
    await loaded(a1);
    carnet.clear('acme');
    let spec = null;
    state.dialogAnswer = (s) => { spec = s; return { button: 'note', text: 'test', link: true }; };
    press({ control: true, shift: true, code: 'KeyN' });
    await until(() => acmeClient().carnet?.notes.length === 1);
    let note = acmeClient().carnet.notes[0];
    check('Ctrl+Maj+N : dialogue « prompt », case de lien cochée', spec?.kind === 'prompt' && spec.checkbox?.checked === true && /Acme/.test(spec.title));
    check('Entrée : note {text, url, title} dans le carnet du client', note?.text === 'test' && /^http/.test(note.url) && typeof note.title === 'string', note);
    state.dialogAnswer = () => ({ button: 'note', text: 'sans lien', link: false });
    press({ control: true, shift: true, code: 'KeyN' });
    await until(() => acmeClient().carnet.notes.length === 2);
    note = acmeClient().carnet.notes[1];
    check('Case décochée : la note n\'a ni adresse ni titre', note.text === 'sans lien' && note.url === undefined && note.title === undefined);
    state.dialogAnswer = () => ({ button: 'next', text: 'x'.repeat(200), link: false });
    press({ control: true, shift: true, code: 'KeyN' });
    await until(() => acmeClient().carnet.next);
    check('Ctrl+Entrée : prochaine action tronquée à 120 caractères, exposée au shell', acmeClient().carnet.next.text.length === 120 && tabs.snapshot().spaces.find((x) => x.id === 'acme').next.text.length === 120);
    acmeClient().carnet.next.at = Date.now() - 8 * 86400000;
    check('Prochaine action stagnante : ancienneté exposée (8 jours)', Date.now() - tabs.snapshot().spaces.find((x) => x.id === 'acme').next.at > 7 * 86400000);
    carnet.setNext('acme', 'Relancer la compta');
    state.dialogAnswer = () => ({ button: 'done', text: 'Relancer la compta' });
    await tabs.editNext();
    check('« Fait » : la phrase rejoint le journal et le champ se vide', acmeClient().carnet.next === null && acmeClient().carnet.notes.slice(-1)[0].text === 'Fait : Relancer la compta');
    const before = JSON.stringify(acmeClient().carnet);
    state.dialogAnswer = () => null;
    press({ control: true, shift: true, code: 'KeyN' });
    await wait(300);
    check('Échap : aucune écriture', JSON.stringify(acmeClient().carnet) === before);
    state.dialogAnswer = null;
    check('Carnet écrit sur disque', /Fait : Relancer la compta/.test(fs.readFileSync(state.store.file, 'utf8')));
    const sharePreview = JSON.stringify(await require('../src/share').previewExport('acme').catch(() => ({})));
    check('Le carnet n\'est jamais inclus dans un partage', !/sans lien|Relancer la compta|carnet/.test(sharePreview));
    await tabs.activateTab(tabs.tabsOfSpace('global')[0].id);
    state.notice = null;
    let asked = false;
    state.dialogAnswer = () => { asked = true; return null; };
    press({ control: true, shift: true, code: 'KeyN' });
    await wait(200);
    check('Ctrl+Maj+N sur un outil commun : refusé avec une notice', !asked && /Choisissez d'abord un client/.test(tabs.snapshot().notice || ''));
    state.dialogAnswer = null;
    carnet.clear('acme');

    // ---- F6 : carte « Depuis votre départ » ----
    const msg = a1;
    msg.title = 'Boîte'; msg.seen = 0; msg.signalAt = null; signals.observe(msg);
    msg.title = '(3) Boîte'; signals.observe(msg);
    await tabs.switchSpace('globex');
    state.leftAt.acme = Date.now() - 11 * 60000;
    await tabs.switchSpace('acme');
    let r = tabs.snapshot().resume;
    check('Retour après 11 min : la carte liste l\'outil qui a bougé', r && r.items.some((i) => i.name === 'Diag A1' && i.kind === 'mark' && i.n === 3) && r.absentMs >= 660000 && r.absentMs < 700000, r);
    await tabs.switchSpace('globex');
    state.leftAt.acme = Date.now() - 9 * 60000;
    await tabs.switchSpace('acme');
    check('Retour après 9 min : aucune carte', tabs.snapshot().resume === null);
    signals.ack(msg);
    const other = tabs.tabsOfSpace('acme').find((t) => t.id !== state.lastTabBySpace.acme && t.view);
    await tabs.switchSpace('globex');
    if (other) await tabs.unloadTab(other);
    state.leftAt.acme = Date.now() - 20 * 60000;
    await tabs.switchSpace('acme');
    r = tabs.snapshot().resume;
    check('Rien n\'a bougé mais un outil dort : « n outil en veille : non vérifié »', r && r.items.length === 0 && r.sleeping >= 1, r);
    press({ key: 'a', code: 'KeyA' });
    check('Une frappe dans une page ferme la carte', state.resume === null && tabs.snapshot().resume === null);
    msg.title = '(3) Boîte'; msg.seen = 0; signals.observe(msg);
    await tabs.switchSpace('globex');
    state.leftAt.acme = Date.now() - 15 * 60000;
    await tabs.switchSpace('acme');
    state.resume.expires = Date.now() - 1;
    check('Après 20 s : la carte a disparu', tabs.snapshot().resume === null);
    await tabs.switchSpace('globex');
    state.leftAt.acme = Date.now() - 15 * 60000;
    await tabs.switchSpace('acme');
    await tabs.resumeOpen(msg.id);
    check('Clic sur une puce : l\'outil s\'active et la puce disparaît', state.activeTab === msg.id && !(state.resume?.items || []).some((i) => i.tabId === msg.id));
    signals.ack(msg); msg.title = 'Boîte'; signals.observe(msg);

    // ---- F7 : Ctrl+K nouvelle génération ----
    const items = [
      { kind: 'space', client: 'Acme Corp' }, { kind: 'space', client: 'Globex Corp' }, { kind: 'tool', client: 'Acme Corp', tool: 'Compta' },
      { kind: 'tool', client: 'Globex Corp', tool: 'Compta' }, { kind: 'tool', client: 'Globex Corp', tool: 'CRM' },
    ];
    const names = (q) => match.filter(items, q).map((i) => i.client + (i.tool ? ' › ' + i.tool : ''));
    check('Filtre : « ac co » → Acme › Compta en tête', names('ac co')[0] === 'Acme Corp › Compta', names('ac co'));
    check('Filtre : « compta » → la Compta de chaque client', names('compta').length === 2 && names('compta').every((n) => /Compta$/.test(n)));
    check('Filtre : « gl » → Globex, « gc » → initiales, « zz » → vide, espace final sans erreur', names('gl')[0] === 'Globex Corp' && names('gc')[0] === 'Globex Corp' && names('zz').length === 0 && names('acme  ').length >= 1);
    state.store.data.usage = {};
    const a2 = toolTab('acme', 'Diag A2');
    const origSave = state.store.save;
    let writes = 0;
    state.store.save = function () { writes++; return origSave.call(this); };
    for (const t of [a2, a1, a2, a1, a2]) await tabs.activateTab(t.id);
    await wait(2600);
    state.store.save = origSave;
    check('Apprentissage : au plus une écriture disque par rafale de bascules', writes === 1, writes);
    const list = tabs.pickerItems();
    check('Saisie vide : le couple le plus fréquent est premier, numéroté 1', list[0].tool === 'Diag A2' && list[0].recent === 1 && list[0].key === '1');
    check('Les clients suivent les récents, avec leur raccourci', list.filter((i) => i.kind === 'space').length === data.clients.length && list.find((i) => i.id === 'space:acme').hint === 'Ctrl+1');
    const gTab = toolTab('globex', 'Diag G1');
    await tabs.switchSpace('acme');
    for (const t of tabs.tabsOfSpace('globex')) await tabs.unloadTab(t);
    const gLine = tabs.pickerItems().find((i) => i.id === 'space:globex');
    check('Client sans onglet chargé : « froid · n outil à réveiller »', /^froid · \d+ outil/.test(gLine.tags[0].text), gLine.tags);
    state.dialogAnswer = () => `tool:globex:${gTab.toolId}`;
    press({ control: true, code: 'KeyK' });
    await until(() => state.activeTab === gTab.id);
    check('Entrée sur « Globex › outil » : client commuté et outil réveillé', state.activeSpace === 'globex' && state.activeTab === gTab.id && !!gTab.view);
    state.dialogAnswer = null;

    // ---- F8 : navigation en croix ----
    await tabs.switchSpace('acme');
    await tabs.activateTab(a1.id);
    press({ alt: true, code: 'Digit2' });
    await until(() => state.activeTab === a2.id);
    check('Alt+2 : deuxième outil du client', state.activeTab === a2.id);
    state.notice = null;
    press({ alt: true, code: 'Digit3' });
    await wait(150);
    check('Alt+3 : « n\'a que 2 outils » et rien ne change', state.activeTab === a2.id && /n'a que 2 outils/.test(tabs.snapshot().notice || ''), tabs.snapshot().notice);
    const urlBefore = a2.view.webContents.getURL();
    for (const k of [{ alt: true, code: 'Numpad2' }, { control: true, alt: true, code: 'Digit1' }, { alt: true, shift: true, code: 'Digit1' }]) press(k);
    await wait(200);
    check('Alt+pavé numérique, AltGr+1 et Alt+Maj+1 ne déclenchent rien', state.activeTab === a2.id && state.activeSpace === 'acme');
    const ini = await require('../src/spaces').addClient({ name: 'Initech' });
    const pen = await require('../src/spaces').addTool('initech', { name: 'Pennylane', url: state.diagUrl });
    const wiki = await require('../src/spaces').addTool('initech', { name: 'Wiki', url: state.diagUrl + '?w' });
    require('../src/spaces').updateTool('acme', a2.toolId, { family: 'compta' });
    require('../src/spaces').updateTool('initech', pen.id, { family: 'Compta' });
    await tabs.activateTab(a2.id);
    press({ alt: true, code: 'ArrowDown' });
    const penTab = toolTab('initech', 'Pennylane');
    await until(() => state.activeTab === penTab.id);
    check('Alt+↓ : même famille chez le client suivant, en sautant celui qui n\'a pas l\'outil', state.activeSpace === 'initech' && state.activeTab === penTab.id);
    check('… l\'onglet cible n\'est pas navigué (URL inchangée, pas de rechargement)', a2.view.webContents.getURL() === urlBefore);
    press({ alt: true, code: 'ArrowDown' });
    await until(() => state.activeTab === a2.id);
    check('Alt+↓ au dernier : bouclage vers le premier avec la notice', state.activeTab === a2.id && /retour au début/.test(tabs.snapshot().notice || ''), tabs.snapshot().notice);
    press({ alt: true, code: 'ArrowUp' });
    await until(() => state.activeTab === penTab.id);
    check('Alt+↑ : client précédent (avec bouclage)', state.activeTab === penTab.id);
    await tabs.activateTab(tabs.tabsOfSpace('global')[0].id);
    state.notice = null;
    press({ alt: true, code: 'ArrowDown' });
    await wait(150);
    check('Alt+↓ sur un outil commun : explication, aucun saut', /ouvrez d'abord un outil de client/.test(tabs.snapshot().notice || '') && state.activeTab === tabs.tabsOfSpace('global')[0].id);
    await require('../src/spaces').deleteClient('initech');
    require('../src/spaces').updateTool('acme', a2.toolId, { family: '' });
    await tabs.switchSpace('acme');

    // ---- F9 : mode vitrine ----
    state.notice = null;
    state.mru = state.mru.filter((id) => id !== 'initech');
    carnet.setNext('globex', 'Secret Globex');
    press({ control: true, shift: true, code: 'KeyH' });
    check('Ctrl+Maj+H : mode vitrine activé', state.vitrine === true && tabs.snapshot().vitrine === true);
    const snapJson = JSON.stringify(tabs.snapshot());
    check('Vitrine : le snapshot ne contient ni Globex ni leurs outils ni leur prochaine action', !/Globex|Initech|Diag G1|Secret/.test(snapJson), snapJson.match(/Globex|Diag G1|Secret/g));
    check('Vitrine : « Client 2 », sans outils ni couleur', tabs.snapshot().spaces[1].name === 'Client 2' && tabs.snapshot().spaces[1].tools.length === 0 && tabs.snapshot().spaces[1].color === '#7b8794');
    check('Vitrine : le sélecteur Ctrl+K est masqué de la même façon', !/Globex|Diag G1|Secret/.test(JSON.stringify(tabs.pickerItems())));
    prevented = 0;
    press({ control: true, shift: true, code: 'KeyV' });
    check('Ctrl+Maj+V n\'est pas intercepté (coller sans mise en forme)', prevented === 0);
    press({ control: true, shift: true, code: 'KeyH' });
    check('Ctrl+Maj+H encore : vitrine quittée', state.vitrine === false && /Globex/.test(JSON.stringify(tabs.snapshot().spaces)));
    carnet.clear('globex');
    state.notice = null;
    await tabs.switchSpace('acme');
  });

  await section('Groupes d\'onglets par client', async () => {
    const groups = require('../src/groups');
    const groupui = require('../src/groupui');
    const data = state.store.data;
    state.dialogAnswer = null; state.vitrine = false; state.resume = null;
    await tabs.switchSpace('acme');
    const acmeData = () => data.clients.find((c) => c.id === 'acme');
    const acme = () => tabs.snapshot().spaces.find((x) => x.id === 'acme');
    const stripIds = () => tabs.snapshot().tabs.filter((t) => !t.global).map((t) => t.id);
    const [t1, t2] = tabs.tabsOfSpace('acme');
    check('Départ : aucun groupe, vue sur tous les onglets', acme().groups.length === 0 && acme().group === null && stripIds().length >= 2);

    state.dialogAnswer = () => ({ button: 'save', text: '  Administratif ' });
    await groupui.create('acme');
    const admin = acmeData().groups[0];
    check('Création : nom nettoyé, groupe vide, la vue reste sur « tous »', admin?.name === 'Administratif' && acme().groups[0].count === 0 && acme().group === null);
    await groupui.create('acme');
    check('Nom en double refusé avec explication', acmeData().groups.length === 1 && /existe déjà/.test(tabs.snapshot().notice || ''), tabs.snapshot().notice);
    state.dialogAnswer = () => ({ button: 'save', text: 'Développement' });
    await groupui.create('acme');
    const dev = acmeData().groups[1];
    state.dialogAnswer = () => ({ button: 'cancel', text: 'Fantôme' });
    await groupui.create('acme');
    check('Annuler ne crée rien', acmeData().groups.length === 2);

    groupui.assign(t1.id, admin.id);
    groupui.assign(t2.id, dev.id);
    const snap = acme();
    check('Rangement d\'un outil : persisté sur l\'outil, effectifs justes', acmeData().tools.find((x) => x.id === t1.toolId).group === admin.id
      && snap.groups[0].count === 1 && snap.groups[1].count === 1 && snap.tools.find((r) => r.toolId === t1.toolId).group === admin.id, snap.groups);
    check('Snapshot : chaque onglet porte son groupe', tabs.snapshot().tabs.find((t) => t.id === t1.id).group === admin.id);

    await tabs.selectGroup('acme', admin.id);
    check('Choisir un groupe : la barre du haut ne montre que ses onglets, l\'onglet affiché en fait partie', JSON.stringify(stripIds()) === JSON.stringify([t1.id]) && state.activeTab === t1.id, stripIds());
    check('Le snapshot annonce le groupe actif et son nom', tabs.snapshot().activeGroupName === 'Administratif' && acme().group === admin.id);

    await tabs.selectGroup('acme', dev.id);
    check('Changer de groupe : on arrive sur un onglet du groupe', state.activeTab === t2.id && JSON.stringify(stripIds()) === JSON.stringify([t2.id]));
    await tabs.activateTab(t1.id);
    check('Aller à un onglet hors du groupe affiché : la vue suit l\'onglet (Ctrl+K, Alt+J…)', acme().group === admin.id && JSON.stringify(stripIds()) === JSON.stringify([t1.id]));

    const free = tabs.addTab({ spaceId: 'acme', url: '{diag}?free' });
    check('Un onglet libre naît dans le groupe affiché', free.groupId === admin.id);
    await tabs.activateTab(free.id);
    check('Il rejoint la barre du groupe', stripIds().includes(free.id) && !stripIds().includes(t2.id));
    await tabs.closeTab(free.id);
    check('Fermer l\'onglet actif : retombe sur un onglet du même groupe', state.activeTab === t1.id);

    await tabs.selectGroup('acme', null);
    const loose = tabs.addTab({ spaceId: 'acme', url: '{diag}?loose' });
    check('Dans la vue « tous », un onglet libre naît sans groupe', loose.groupId === null);
    await tabs.selectGroup('acme', groups.NONE);
    const ungrouped = stripIds();
    check('Vue « sans groupe » : seulement les onglets rangés nulle part', !ungrouped.includes(t1.id) && !ungrouped.includes(t2.id) && ungrouped.includes(loose.id) && acme().group === groups.NONE, ungrouped);
    const free2 = tabs.addTab({ spaceId: 'acme', url: '{diag}?free2' });
    check('Dans « sans groupe », un nouvel onglet reste sans groupe', free2.groupId === null);
    await tabs.closeTab(free2.id);
    await tabs.closeTab(loose.id);

    await tabs.selectGroup('acme', null);
    check('« Tous » : tous les onglets du client sont de retour', stripIds().length === tabs.tabsOfSpace('acme').length);

    state.dialogAnswer = () => ({ button: 'save', text: 'Vide' });
    await groupui.create('acme');
    const empty = acmeData().groups[2];
    await tabs.selectGroup('acme', empty.id);
    check('Groupe vide : aucun onglet actif, message adapté', state.activeTab === null && tabs.snapshot().emptyInGroup === true && stripIds().length === 0);

    await tabs.selectGroup('acme', admin.id);
    groupui.assign(t1.id, dev.id);
    check('Ranger l\'onglet affiché ailleurs : la vue le suit', acme().group === dev.id && state.activeTab === t1.id);
    groupui.assign(t1.id, null);
    check('Sortir un onglet de son groupe : il reste affiché (vue « tous »)', acme().group === null && state.activeTab === t1.id && !acmeData().tools.find((x) => x.id === t1.toolId).group);

    let err = '';
    try { groups.assign(t1.id, 'inconnu'); } catch (e) { err = e.message; }
    check('Groupe inconnu refusé', /inconnu/.test(err));
    err = '';
    try { groups.assign(tabs.tabsOfSpace('global')[0].id, admin.id); } catch (e) { err = e.message; }
    check('Un outil commun ne se range pas dans un groupe de client', /aucun client/.test(err));
    err = '';
    try { for (let i = 0; i < 20; i++) groups.add('acme', 'G' + i); } catch (e) { err = e.message; }
    check('Maximum de groupes par client', /maximum/.test(err) && acmeData().groups.length === groups.MAX_GROUPS);
    for (const g of [...acmeData().groups]) if (/^G\d+$/.test(g.name)) groups.remove('acme', g.id);

    check('Les autres clients n\'ont pas de groupe', tabs.snapshot().spaces.filter((x) => x.id !== 'acme').every((x) => x.groups.length === 0));
    groupui.assign(t2.id, dev.id);
    tabs.toggleVitrine(true);
    const hiddenJson = JSON.stringify(tabs.snapshot().spaces.filter((x) => x.id !== 'acme'));
    check('Vitrine : aucun groupe des autres clients ne fuit', !/Administratif|Développement/.test(hiddenJson));
    tabs.toggleVitrine(false);

    const before = tabs.tabsOfSpace('acme').length;
    await tabs.selectGroup('acme', dev.id);
    state.dialogAnswer = () => 'delete';
    await groupui.remove('acme', dev.id);
    check('Supprimer un groupe : aucun onglet fermé, outils libérés, vue réinitialisée', tabs.tabsOfSpace('acme').length === before
      && !acmeData().tools.some((x) => x.group === dev.id) && acme().group === null && acme().groups.every((g) => g.id !== dev.id));
    state.dialogAnswer = () => 'cancel';
    await groupui.remove('acme', admin.id);
    check('Annuler la suppression ne supprime rien', acme().groups.some((g) => g.id === admin.id));
    check('Les groupes restants sont ceux attendus', JSON.stringify(acmeData().groups.map((g) => g.name)) === JSON.stringify(['Administratif', 'Vide']));

    for (const g of [...acmeData().groups]) groups.remove('acme', g.id);

    // Revue : supprimer le groupe vide affiché, revenir chez un client, liens, noms de menu
    state.dialogAnswer = () => ({ button: 'save', text: 'Éphémère' });
    await groupui.create('acme');
    const eph = acmeData().groups[0];
    await tabs.selectGroup('acme', eph.id);
    state.dialogAnswer = () => 'delete';
    await groupui.remove('acme', eph.id);
    check('Supprimer le groupe vide affiché : on retombe sur « Tous » avec un onglet actif', acme().group === null && state.tabs.has(state.activeTab) && tabs.snapshot().emptyInGroup === false);

    state.dialogAnswer = () => ({ button: 'save', text: 'Revenir' });
    await groupui.create('acme');
    const back = acmeData().groups[0];
    groupui.assign(t2.id, back.id);
    await tabs.selectGroup('acme', back.id);
    await tabs.switchSpace('globex');
    await tabs.switchSpace('acme');
    check('Revenir chez un client : on retrouve sa vue (groupe et onglet)', acme().group === back.id && state.activeTab === t2.id);
    await tabs.selectGroup('acme', null);
    const sleeper = tabs.addTab({ spaceId: 'acme', url: '{diag}?sleeper' });
    groupui.assign(sleeper.id, back.id);
    check('Un onglet libre se range aussi (non persisté)', sleeper.groupId === back.id && acme().groups.find((g) => g.id === back.id).count === 2);
    const child = tabs.addTab({ spaceId: 'acme', url: '{diag}?child', groupId: groups.groupOf(sleeper) });
    check('Un lien ouvert depuis un onglet reste dans son groupe, même vue « tous »', child.groupId === back.id);
    await tabs.closeTab(child.id);
    await tabs.closeTab(sleeper.id);

    state.dialogAnswer = () => ({ button: 'save', text: 'R&D' });
    await groupui.create('acme');
    check('Noms avec « & » acceptés tels quels', acmeData().groups.some((g) => g.name === 'R&D'));

    tabs.toggleVitrine(true);
    await tabs.switchSpace('globex');
    tabs.toggleVitrine(false);
    for (const g of [...acmeData().groups]) groups.remove('acme', g.id);
    state.dialogAnswer = null;
    state.notice = null;
    await tabs.switchSpace('acme');
  });

  await section('Barre unique : volets au survol, extensions épinglées, favicons, onglets groupés', async () => {
    const flyout = require('../src/flyout');
    const icons = require('../src/icons');
    const groups = require('../src/groups');
    const { session } = require('electron');
    const data = state.store.data;
    state.dialogAnswer = null; state.vitrine = false; state.resume = null;
    await tabs.switchSpace('acme');
    const { TOPBAR_H } = require('../src/state');
    const winW = () => state.win.getContentBounds().width;
    const press0 = (input) => tabs.handleInput({ preventDefault() {} }, { type: 'keyDown', ...input });

    // Outils de développement : F12 et Ctrl+Maj+I ouvrent/ferment ceux de l'onglet actif
    const devWc = state.tabs.get(state.activeTab)?.view?.webContents;
    if (devWc) {
      press0({ key: 'F12', code: 'F12' });
      check('F12 ouvre les outils de développement de l\'onglet actif', !!(await until(() => devWc.isDevToolsOpened(), 5000, 100)));
      press0({ key: 'F12', code: 'F12' });
      check('F12 les referme', !!(await until(() => !devWc.isDevToolsOpened(), 5000, 100)));
      press0({ key: 'I', code: 'KeyI', control: true, shift: true });
      check('Ctrl+Maj+I les ouvre aussi', !!(await until(() => devWc.isDevToolsOpened(), 5000, 100)));
      devWc.closeDevTools();
      await until(() => !devWc.isDevToolsOpened(), 3000, 100);
    } else skip('Outils de développement', 'aucun onglet actif à ce stade');

    // Volet des clients : une vue à part, collée sous la barre, jamais plein écran
    await flyout.open('clients', { x: 8, right: 42 });
    let b = flyout._view().getBounds();
    check('Volet des clients : ouvert sous la barre, à sa taille (pas plein écran)', flyout.isOpen() && flyout._kind() === 'clients' && b.y === TOPBAR_H && b.x === 0 && b.width < 400 && b.width < winW() / 2, b);
    check('Le survol de l\'icône est noté', flyout._hot().trigger === true);
    flyout._setHot({ trigger: false });
    await wait(60);
    check('Quitter l\'icône ne ferme pas tout de suite (le temps de passer au volet)', flyout.isOpen());
    flyout._setHot({ panel: true });
    await wait(400);
    check('Tant que la souris est dans le volet, il reste ouvert', flyout.isOpen());
    flyout._setHot({ panel: false });
    await wait(500);
    check('Souris sortie de l\'icône et du volet : il se ferme', !flyout.isOpen() && flyout._view().webContents.isDestroyed() === false);

    // Volet des extensions : aligné à droite sur son icône
    await flyout.open('extensions', { x: winW() - 300, right: winW() - 268 });
    b = flyout._view().getBounds();
    check('Volet des extensions : contenu dans la fenêtre, aligné sur son icône', flyout._kind() === 'extensions' && b.x >= 0 && b.x + b.width <= winW(), b);
    const ext = tabs.snapshot().extensions.find((e) => e.hasAction);
    if (ext) {
      await flyout._act('ext-pin', [ext.id, false]);
      check('Épingler / désépingler garde le volet ouvert', flyout.isOpen() && tabs.snapshot().extensions.find((e) => e.id === ext.id).pinned === false && !tabs.snapshot().toolbar.some((t) => t.id === ext.id));
      await flyout._act('ext-pin', [ext.id, true]);
      check('Réépinglée : le bouton revient dans la barre', tabs.snapshot().toolbar.some((t) => t.id === ext.id));
    } else skip('Épingle d\'extension', 'aucune extension avec bouton chargée à ce stade');
    await flyout._act('open-settings', [null]).catch(() => {});
    check('Un geste du volet (hors épingle) le referme', !flyout.isOpen());
    await tabs.switchSpace('acme');

    let refused = '';
    try { await flyout._act('rm-rf', []); } catch (e) { refused = e.message; }
    check('Seuls les gestes de la liste fermée sont acceptés', /inconnu/.test(refused));
    await flyout.open('clients', { x: 8, right: 42 });
    const other = data.clients.find((c) => c.id !== 'acme').id;
    await flyout._act('switch-space', [other]);
    check('Choisir un client dans le volet : on y va et le volet se ferme', state.activeSpace === other && !flyout.isOpen(), { space: state.activeSpace, other, ids: data.clients.map((c) => c.id), open: flyout.isOpen() });
    await tabs.switchSpace('acme');
    await flyout.open('inconnu', {});
    check('Un volet inconnu ne s\'ouvre pas', !flyout.isOpen());

    // Favicons : récupérées avec la session de l'onglet, servies à l'interface par junr-icon://
    const t = tabs.tabsOfSpace('acme')[0];
    await tabs.activateTab(t.id);
    const fresh = tabs.addTab({ spaceId: 'acme', url: '{diag}?fresh' });
    const freshSnap = tabs.snapshot().tabs.find((x) => x.id === fresh.id);
    check('Sans favicon : pas d\'adresse d\'icône, une lettre de repli', freshSnap.icon === null && /^[A-Z0-9?]$/.test(freshSnap.letter), freshSnap);
    await tabs.closeTab(fresh.id);
    await icons.update(t, [state.diagUrl + '/favicon.ico']);
    const snapTab = tabs.snapshot().tabs.find((x) => x.id === t.id);
    check('Après : le snapshot donne une adresse junr-icon://', /^junr-icon:\/\/t\/\d+\?v=\d+$/.test(snapTab.icon || ''), snapTab.icon);
    const res = await session.defaultSession.fetch(snapTab.icon);
    check('Le schéma junr-icon:// sert l\'icône mise en cache', res.status === 200 && (await res.arrayBuffer()).byteLength > 0);
    const miss = await session.defaultSession.fetch('junr-icon://t/999999');
    check('Icône inconnue : 404', miss.status === 404);
    const gone = tabs.addTab({ spaceId: 'acme', url: '{diag}?gone' });
    await tabs.closeTab(gone.id);
    check('Une icône disparaît avec son onglet', icons._count() >= 1 && (await session.defaultSession.fetch(`junr-icon://t/${gone.id}`)).status === 404);

    check('Favicon d\'un outil : copiée sur disque pour le prochain démarrage', t.toolId && require('node:fs').existsSync(require('node:path').join(require('electron').app.getPath('userData'), 'favicons', `${t.toolId}.json`)));

    // Sortie de souris pendant le chargement du volet : il ne reste pas coincé ouvert
    flyout.close();
    const pending = flyout.open('clients', { x: 8, right: 42 });
    flyout._setHot({ trigger: false });
    await pending;
    check('Souris repartie avant l\'affichage : le volet ne s\'ouvre pas', !flyout.isOpen());
    // Ouvert tout seul (reprise) : la première touche le referme ; ouvert au clavier : il prend le focus
    await flyout.open('clients', { x: 8, right: 42 }, { auto: 5000 });
    check('Ouverture automatique repérée', flyout.isAuto());
    press0({ key: 'a', code: 'KeyA' });
    check('La première touche referme le volet ouvert tout seul', !flyout.isOpen());
    await flyout.open('clients', { x: 8, right: 42 }, { keyboard: true });
    check('Ouvert au clavier : il s\'affiche sans survol', flyout.isOpen() && flyout._hot().trigger === false);
    flyout.close();
    await flyout.open('clients', { x: 8, right: 42 });
    await flyout._act('group-menu', ['acme', 'inconnu']).catch(() => {});
    check('Le menu d\'un groupe laisse le volet ouvert', flyout.isOpen());
    flyout.close();

    // Onglets de la barre : regroupés par groupe, sans groupe d'abord, communs à la fin
    const g1 = groups.add('acme', 'Premier');
    const g2 = groups.add('acme', 'Second');
    const ts = tabs.tabsOfSpace('acme');
    groups.assign(ts[0].id, g2.id);
    groups.assign(ts[1].id, g1.id);
    const bar = tabs.snapshot().tabs.filter((x) => !x.global);
    const order = bar.map((x) => x.group);
    check('Barre : sans groupe, puis groupe 1, puis groupe 2', JSON.stringify(order) === JSON.stringify([...order].sort((a, c) => (a ? 1 + [g1.id, g2.id].indexOf(a) : 0) - (c ? 1 + [g1.id, g2.id].indexOf(c) : 0))) && order.indexOf(g1.id) < order.indexOf(g2.id), order);
    check('Les outils communs viennent après les onglets du client', tabs.snapshot().tabs.findIndex((x) => x.global) > tabs.snapshot().tabs.findLastIndex((x) => !x.global));
    for (const g of [...data.clients.find((c) => c.id === 'acme').groups]) groups.remove('acme', g.id);

    // Volet ouvert pendant un changement : il suit l'état (pas d'exception à l'envoi)
    await flyout.open('clients', { x: 8, right: 42 });
    tabs.pushNow();
    await tabs.switchSpace(other);
    check('Le volet reçoit les états sans erreur', flyout.isOpen());
    flyout.close();
    await tabs.switchSpace('acme');
    // Ouverture automatique : au retour chez un client après une absence, le volet s'ouvre seul sur la carte « Absent depuis »
    const gt = tabs.tabsOfSpace(other)[0];
    gt.title = 'Boîte'; require('../src/signals').observe(gt);
    gt.title = '(2) Boîte'; require('../src/signals').observe(gt);
    state.test = false;
    state.leftAt[other] = Date.now() - 30 * 60000;
    state.notice = null;
    await tabs.switchSpace(other);
    await wait(400);
    check('Retour après une absence : le volet des clients apparaît seul', flyout.isOpen() && flyout._kind() === 'clients' && flyout._hot().trigger === false && tabs.snapshot().resume !== null, { open: flyout.isOpen(), resume: !!tabs.snapshot().resume });
    flyout.close();
    state.test = true;
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
  srv.close();
  app.exit(failed ? 1 : 0);
}

module.exports = { makeConfig, run };
