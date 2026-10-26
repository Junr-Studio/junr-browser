'use strict';
// Phase 0 : mesure de compatibilité d'un corpus d'extensions du Chrome Web Store avec Electron.
//   npm run phase0            (réseau requis ; ~20 téléchargements)
// Pour chaque extension : installation par ID, chargement dans deux partitions, démarrage de l'arrière-plan,
// ouverture du popup, effet sur une page. Sortie : docs/phase0-report.md et docs/phase0-results.json.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase0-corpus.json'), 'utf8'));
const surface = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'extensions', 'electron-api-surface.json'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Fonctions natives de l'application qui remplacent une API absente (voir la stratégie d'extensions du plan).
const NATIVE_REPLACES = {
  webRequest: 'blocage réseau natif', declarativeNetRequest: 'blocage réseau natif',
  scripting: 'injection native de scripts/CSS', nativeMessaging: 'remplissage de mots de passe intégré',
};
// API dont l'absence retire une fonction secondaire, pas le cœur de l'extension (jugement à confirmer à la main).
const SECONDARY = new Set(['contextMenus', 'commands', 'notifications', 'omnibox', 'tabGroups', 'fontSettings', 'sessions', 'topSites', 'tts', 'declarativeContent', 'readingList', 'contentSettings', 'search']);

exports.makeConfig = () => ({ unloadAfterMs: 300000, clients: [
  { id: 'a', name: 'Client A', color: '#d9534f', tools: [] }, { id: 'b', name: 'Client B', color: '#2f8f83', tools: [] },
], globalTools: [] });

const PAGE = '<!doctype html><title>cible</title><style>body{background:#fff;color:#111}</style><body><h1>Page cible</h1><p>Un paragraphe.</p><a href="/x">lien</a><input type="text"></body>';

function signature(wc) {
  return wc.executeJavaScript(`JSON.stringify({ html: document.documentElement.outerHTML.length, sheets: document.styleSheets.length,
    attrs: [...document.documentElement.attributes].map((a) => a.name).sort(), bg: getComputedStyle(document.body).backgroundColor, scripts: document.scripts.length })`, true);
}

async function loadPage(wc, url) {
  await Promise.race([wc.loadURL(url).catch(() => {}), wait(15000)]);
  await wait(1500);
}

exports.run = async ({ state, tabs, extManager, sessions, spaces }) => {
  const popup = require('../src/extensions/popup');
  const { classify } = require('../src/extensions/compat');
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${srv.address().port}/`;

  // Un onglet par client sert de cible (c'est aussi lui qui détermine la session du popup).
  const tabA = tabs.addTab({ spaceId: 'a', url: pageUrl });
  const tabB = tabs.addTab({ spaceId: 'b', url: pageUrl });
  await tabs.activateTab(tabB.id); await wait(1000);
  await tabs.activateTab(tabA.id); await wait(1000);
  const base = { a: JSON.parse(await signature(tabA.view.webContents)), b: JSON.parse(await signature(tabB.view.webContents)) };

  // Erreurs des service workers, par extension : un démarrage qui lève une exception est une panne réelle.
  const swErrors = new Map();
  for (const sid of ['a', 'b']) {
    state.sessions.get(sid).ses.serviceWorkers.on('console-message', (e, d) => {
      const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(d.sourceUrl || '');
      if (!m || (d.level !== 3 && d.level !== 'error')) return;
      (swErrors.get(m[1]) || swErrors.set(m[1], []).get(m[1])).push(String(d.message).slice(0, 200));
    });
  }

  popup._setAutoClose(false);
  const results = [];
  for (const entry of corpus) {
    const r = { id: entry.id, name: entry.name, families: entry.families, role: entry.role };
    console.log(`\n== ${entry.name} (${entry.id})`);
    try {
      const out = await extManager.install(entry.id);
      const rec = extManager.records()[entry.id];
      const manifest = JSON.parse(fs.readFileSync(path.join(extManager.extPath(rec), 'manifest.json'), 'utf8'));
      Object.assign(r, { installed: true, storeName: out.name, version: out.version, manifestVersion: manifest.manifest_version,
        permissions: manifest.permissions || [], hostPermissions: manifest.host_permissions || [], optionalPermissions: manifest.optional_permissions || [],
        hasServiceWorker: !!manifest.background?.service_worker, hasPopup: !!out.hasPopup, loadError: out.loadError, compat: classify(manifest) });

      r.loadedIn = {};
      for (const s of ['a', 'b']) { const e = state.sessions.get(s); await e.ready; r.loadedIn[s] = e.loaded.has(entry.id); }

      if (r.hasServiceWorker) {
        r.background = {};
        for (const s of ['a', 'b']) r.background[s] = await extManager.backgroundRuns(state.sessions.get(s).ses, entry.id, 8000);
      }

      // Effet sur une page, dans chacun des deux clients.
      r.pageEffect = {};
      for (const [s, tab] of [['a', tabA], ['b', tabB]]) {
        await tabs.activateTab(tab.id);
        await loadPage(tab.view.webContents, pageUrl);
        r.pageEffect[s] = (await signature(tab.view.webContents)) !== JSON.stringify(base[s]);
      }

      // Popup : s'ouvre-t-il sans erreur de script ?
      if (r.hasPopup) try {
        await tabs.activateTab(tabA.id);
        const errors = [];
        const started = popup.toggle(entry.id, 900);
        await wait(400);
        const v = popup._view();
        if (v) {
          v.webContents.on('console-message', (e) => { if ((e.level ?? e) === 'error' || e.level === 3) errors.push(String(e.message || '').slice(0, 160)); });
          v.webContents.on('render-process-gone', () => errors.push('processus de rendu arrêté'));
        }
        await started;
        await wait(3500);
        const text = v ? await v.webContents.executeJavaScript('document.body ? document.body.innerText.trim().length : -1').catch(() => -1) : -1;
        r.popup = { opened: !!v, textLength: text, consoleErrors: errors.slice(0, 5), errorCount: errors.length };
        popup.close();
      } catch (e) {
        r.popup = { opened: false, error: e.message, errorCount: 0, consoleErrors: [] };
        popup.close();
      }

      await wait(1500);
      r.swErrors = (swErrors.get(entry.id) || []).slice(0, 5);
      r.swErrorCount = (swErrors.get(entry.id) || []).length;

      // Verdict.
      const missing = r.compat.missing;
      const needsNative = missing.filter((m) => NATIVE_REPLACES[m]);
      const secondary = missing.filter((m) => SECONDARY.has(m));
      const hard = missing.filter((m) => !NATIVE_REPLACES[m] && !SECONDARY.has(m));
      const apiCrash = (swErrors.get(entry.id) || []).some((m) => /undefined|not a function|Cannot read|is not defined/i.test(m));
      // Panne franche : l'extension ne se charge pas, son arrière-plan ne démarre pas ou son popup lève des erreurs de script.
      const broken = r.loadError || Object.values(r.loadedIn).some((x) => !x) || (r.background && Object.values(r.background).some((x) => x === false))
        || (r.popup && r.popup.opened && r.popup.errorCount > 0);
      r.runtimeOk = !broken && !apiCrash;
      if (broken || r.compat.status === 'unsupported') r.verdict = 'ne-fonctionne-pas';
      else if (hard.length) r.verdict = 'ne-fonctionne-pas';
      // Le service worker tourne, aucune API n'est absente, mais il consigne des exceptions internes (souvent : pas de compte connecté).
      else if (apiCrash) r.verdict = 'a-verifier';
      else if (needsNative.length) r.verdict = 'fonction-native';
      else if (secondary.length) r.verdict = 'degradee';
      else r.verdict = 'fonctionne';
      r.verdictWhy = { hardMissing: hard, nativeReplaceable: needsNative.map((m) => `${m} → ${NATIVE_REPLACES[m]}`), secondaryMissing: secondary, runtimeBroken: !!broken };
    } catch (e) {
      r.installed = false; r.error = e.message; r.verdict = 'non-installee';
    }
    console.log(`   ${r.verdict}${r.error ? ' — ' + r.error : ''}${r.compat ? ` | manquantes : ${r.compat.missing.join(', ') || '—'}` : ''}`);
    results.push(r);
    try { await extManager.uninstall(entry.id); } catch { /* non installée */ }
  }

  // Synthèse.
  const measured = results.filter((r) => r.installed);
  const count = (v) => measured.filter((r) => r.verdict === v).length;
  const ok = count('fonctionne') + count('fonction-native');
  const pct = measured.length ? (100 * ok) / measured.length : 0;
  const summary = {
    generatedAt: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome,
    corpus: corpus.length, installed: measured.length, notInstalled: results.length - measured.length,
    fonctionne: count('fonctionne'), fonctionNative: count('fonction-native'), degradee: count('degradee'), aVerifier: count('a-verifier'), neFonctionnePas: count('ne-fonctionne-pas'),
    percentOk: Math.round(pct * 10) / 10, threshold: 99, thresholdMet: pct >= 99,
    // Borne haute : on ne retient que les pannes observées à l'exécution, pas les API déclarées absentes.
    // (aucune extension déclarée cassée : tout sauf « ne fonctionne pas »)
    runtimeOkCount: measured.length - count('ne-fonctionne-pas'),
    percentRuntimeOk: measured.length ? Math.round((1000 * (measured.length - count('ne-fonctionne-pas'))) / measured.length) / 10 : 0,
  };
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  const suffix = process.env.JUNR_NO_SHIM ? '-sans-pont' : '';
  summary.shim = !process.env.JUNR_NO_SHIM;
  fs.writeFileSync(path.join(ROOT, 'docs', `phase0-results${suffix}.json`), JSON.stringify({ summary, results }, null, 2));
  fs.writeFileSync(path.join(ROOT, 'docs', `phase0-report${suffix}.md`), report(summary, results));
  console.log('\n' + JSON.stringify(summary, null, 2));
  srv.close();
  app.exit(0);
};

const LABEL = { fonctionne: 'Fonctionne', 'fonction-native': 'Fonctionne avec une fonction native', degradee: 'Dégradée (fonction secondaire perdue)', 'a-verifier': 'À vérifier à la main (exceptions internes du service worker)', 'ne-fonctionne-pas': 'Ne fonctionne pas', 'non-installee': 'Non installée' };

function report(s, results) {
  const L = [];
  L.push('# Phase 0 — compatibilité des extensions du Chrome Web Store', '');
  L.push(`Généré par \`npm run phase0\` le ${s.generatedAt} — Electron ${s.electron} (Chromium ${s.chrome}). **Configuration : ${s.shim ? 'avec le pont d\'API (shim des service workers)' : 'Electron nu, sans pont (JUNR_NO_SHIM=1)'}.**`, '');
  L.push('## Résultat', '');
  L.push(`- Corpus : ${s.corpus} extensions, ${s.installed} installées par ID depuis le Web Store, ${s.notInstalled} non installées (identifiant introuvable ou erreur — voir le tableau).`);
  L.push(`- **Fonctionne** : ${s.fonctionne} · **Fonctionne avec une fonction native** : ${s.fonctionNative} · **Dégradée** : ${s.degradee} · **À vérifier à la main** : ${s.aVerifier ?? 0} · **Ne fonctionne pas** : ${s.neFonctionnePas}`);
  L.push(`- **Taux de réussite (fonctionne + fonction native) : ${s.percentOk} %** — seuil du plan : ${s.threshold} %. **Seuil ${s.thresholdMet ? 'atteint' : 'NON atteint'}.**`);
  L.push(`- Borne haute (tout sauf « ne fonctionne pas » : on suppose que « à vérifier » et « dégradée » fonctionnent) : ${s.runtimeOkCount}/${s.installed} = **${s.percentRuntimeOk} %**. La vérité fonctionnelle est entre les deux bornes ; seul l'essai manuel tranche.`);
  if (!s.thresholdMet) L.push('', '> Garde-fou du plan : sous le seuil, le fork de Chromium (seule voie qui garantit toutes les extensions) est remis à l\'étude. Voir la section « Que faire de ce résultat ».');
  L.push('', '## Méthode et limites', '');
  L.push('- Installation par ID via l\'URL de mise à jour publique, chargement dans deux partitions (Client A, Client B), démarrage du service worker, ouverture du popup, comparaison d\'une page de test avant/après.');
  L.push('- Ce test est **automatique et statique-dynamique** : il établit qu\'une extension se charge, que son arrière-plan démarre, que son popup s\'affiche sans erreur de script et que les API qu\'elle déclare existent dans Electron (voir `docs/electron-api-surface.md`). Il ne prouve pas qu\'elle fonctionne de bout en bout : la validation fonctionnelle (connexion à un compte, remplissage, capture…) reste manuelle — voir `docs/phase0-manual-checklist.md`.');
  L.push('- « Dégradée » = seules des API de confort manquent (menus contextuels, raccourcis, notifications…) ; elle n\'est **pas** comptée dans le taux. Le classement des API « de confort » est un jugement à confirmer extension par extension.');
  L.push('- Le taux se calcule sur les extensions installées. Une extension non installée ne prouve rien sur Electron.', '');
  L.push('## Tableau de compatibilité', '');
  L.push('| Extension | Familles d\'API | MV | Verdict | API absentes d\'Electron | Détail d\'exécution |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const run = [];
    if (r.installed) {
      run.push(`chargée A/B : ${r.loadedIn.a ? 'oui' : 'non'}/${r.loadedIn.b ? 'oui' : 'non'}`);
      if (r.background) run.push(`service worker : ${r.background.a ? 'démarre' : 'ne démarre pas'}`);
      if (r.swErrorCount) run.push(`${r.swErrorCount} erreur(s) dans le service worker${r.swErrors[0] ? ` (« ${r.swErrors[0].replace(/\|/g, '/').slice(0, 90)} »)` : ''}`);
      if (r.popup) run.push(`popup : ${r.popup.opened ? (r.popup.errorCount ? `${r.popup.errorCount} erreur(s) de script` : 'ok') : 'non ouvert'}`);
      run.push(`effet sur une page : ${r.pageEffect.a && r.pageEffect.b ? 'oui' : r.pageEffect.a || r.pageEffect.b ? 'partiel' : 'aucun visible'}`);
    }
    const why = r.verdictWhy;
    const extra = why ? [why.nativeReplaceable.length ? `remplaçable : ${why.nativeReplaceable.join(' ; ')}` : '', why.hardMissing.length ? `bloquant : ${why.hardMissing.join(', ')}` : ''].filter(Boolean).join(' ; ') : '';
    L.push(`| ${r.name}${r.installed && r.storeName !== r.name ? ` (${r.storeName})` : ''} | ${r.families.join(' ; ')} | ${r.manifestVersion ?? '—'} | ${LABEL[r.verdict]}${r.error ? ` — ${r.error}` : ''} | ${r.compat ? (r.compat.missing.join(', ') || '—') : '—'}${extra ? `<br>${extra}` : ''} | ${run.join(' ; ') || '—'} |`);
  }
  L.push('', '## API les plus souvent manquantes', '');
  const freq = {};
  for (const r of results) for (const m of r.compat?.missing || []) freq[m] = (freq[m] || 0) + 1;
  for (const [k, v] of Object.entries(freq).sort((a, b) => b[1] - a[1])) L.push(`- \`${k}\` : ${v} extension(s)${NATIVE_REPLACES[k] ? ` — remplaçable par ${NATIVE_REPLACES[k]}` : ''}`);
  L.push('', '## Que faire de ce résultat', '');
  L.push('Voir la section correspondante de `docs/phase0-conclusion.md` (rédigée à partir de ce rapport).', '');
  return L.join('\n');
}
