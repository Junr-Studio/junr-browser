'use strict';
// Mesure de fin de Phase 1 : RAM avec 5 clients × 8 onglets, avant et après mise en veille.
//   npm run measure:ram            (réseau requis ; pages publiques)
//   JUNR_MEASURE_URLS="https://a,https://b,..." npm run measure:ram   (8 adresses de votre choix, ex. vos vrais outils)
// Sortie : docs/ram-measure.md et docs/ram-measure.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_URLS = [
  'https://en.wikipedia.org/wiki/Electron_(software)', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', 'https://example.com',
  'https://news.ycombinator.com', 'https://www.iana.org/domains/reserved', 'https://en.wikipedia.org/wiki/Chromium_(web_browser)',
  'https://developer.mozilla.org/en-US/docs/Web/CSS', 'https://www.rfc-editor.org/rfc/rfc9110.html',
];
const URLS = (process.env.JUNR_MEASURE_URLS ? process.env.JUNR_MEASURE_URLS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_URLS).slice(0, 8);
const COLORS = ['#d9534f', '#2f8f83', '#5b6fd6', '#c78a1b', '#8e5bd6'];

exports.makeConfig = () => ({
  unloadAfterMs: 300000,
  clients: COLORS.map((color, i) => ({ id: `c${i + 1}`, name: `Client ${i + 1}`, color, tools: URLS.map((url, j) => ({ name: `Onglet ${j + 1}`, url })) })),
  globalTools: [],
});

// Mémoire privée (hors pages partagées) quand le système la fournit, sinon working set.
function metrics() {
  const list = app.getAppMetrics();
  const kb = (m) => m.memory?.privateBytes ?? m.memory?.workingSetSize ?? 0;
  const byType = {};
  for (const m of list) { const t = byType[m.type] ||= { count: 0, mb: 0 }; t.count++; t.mb += kb(m) / 1024; }
  for (const t of Object.values(byType)) t.mb = Math.round(t.mb);
  return {
    processes: list.length, totalMb: Math.round(list.reduce((s, m) => s + kb(m), 0) / 1024),
    workingSetMb: Math.round(list.reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0) / 1024),
    usesPrivateBytes: list.some((m) => m.memory?.privateBytes !== undefined), byType,
  };
}

async function loadAndSettle(tab) {
  const wc = tab.view.webContents;
  const end = Date.now() + 30000;
  while (wc.isLoading() && Date.now() < end) await wait(250);
  await wait(800);
  return !wc.isDestroyed() && !wc.getURL().startsWith('chrome-error:');
}

exports.run = async ({ state, tabs }) => {
  await wait(3000);
  const shellOnly = metrics();
  console.log(`Application seule : ${shellOnly.totalMb} Mo, ${shellOnly.processes} processus`);

  let failed = 0;
  const clients = state.store.data.clients;
  for (const c of clients) {
    await tabs.switchSpace(c.id);
    for (const t of tabs.tabsOfSpace(c.id)) {
      await tabs.activateTab(t.id);
      if (!(await loadAndSettle(t))) failed++;
    }
    console.log(`${c.name} chargé (${tabs.tabsOfSpace(c.id).length} onglets)`);
  }
  await wait(6000);
  const before = metrics();
  const liveBefore = [...state.tabs.values()].filter((t) => t.view).length;
  console.log(`Avant mise en veille : ${before.totalMb} Mo, ${before.processes} processus, ${liveBefore} onglets actifs`);

  await tabs.switchSpace(clients[0].id);
  const unloaded = await tabs.sweep(0);
  await wait(10000);
  const after = metrics();
  const liveAfter = [...state.tabs.values()].filter((t) => t.view).length;
  console.log(`Après mise en veille : ${after.totalMb} Mo, ${after.processes} processus, ${liveAfter} onglets actifs (${unloaded.length} endormis)`);

  const result = {
    generatedAt: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome, os: `${os.platform()} ${os.release()}`,
    cpus: os.cpus().length, totalSystemRamGb: Math.round(os.totalmem() / 2 ** 30), urls: URLS, clients: clients.length, tabsPerClient: URLS.length,
    failedLoads: failed, shellOnly, before: { ...before, liveTabs: liveBefore }, after: { ...after, liveTabs: liveAfter }, sleptTabs: unloaded.length,
    savedMb: before.totalMb - after.totalMb, savedPercent: Math.round((100 * (before.totalMb - after.totalMb)) / before.totalMb),
    fixedOverheadMb: shellOnly.totalMb,
  };
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'ram-measure.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(ROOT, 'docs', 'ram-measure.md'), report(result));
  console.log(JSON.stringify({ shellOnly: shellOnly.totalMb, before: before.totalMb, after: after.totalMb, saved: result.savedMb, percent: result.savedPercent, failedLoads: failed }));
  app.exit(0);
};

function report(r) {
  const row = (name, m) => `| ${name} | ${m.liveTabs ?? 0} | ${m.processes} | ${m.totalMb} |`;
  const types = (m) => Object.entries(m.byType).map(([t, v]) => `${t} ×${v.count} (${v.mb} Mo)`).join(', ');
  return [
    '# Mesure de RAM — 5 clients × 8 onglets', '',
    `Généré par \`npm run measure:ram\` le ${r.generatedAt} — Electron ${r.electron} (Chromium ${r.chrome}), ${r.os}, ${r.cpus} cœurs, ${r.totalSystemRamGb} Go de RAM.`, '',
    `Mesure : ${r.usesPrivateBytes_label ?? (r.before.usesPrivateBytes ? 'mémoire privée des processus (privateBytes), sans les pages partagées' : 'working set (peut compter deux fois les pages partagées)')}, via \`app.getAppMetrics()\`.`, '',
    '| Étape | Onglets actifs | Processus | RAM totale (Mo) |', '| --- | --- | --- | --- |',
    row('Application seule (interface, sans onglet)', { ...r.shellOnly, liveTabs: 0 }), row('40 onglets chargés (avant veille)', r.before), row('Après mise en veille (1 client actif)', r.after), '',
    `- **Surcoût fixe d'Electron** (interface + processus Chromium sans aucun onglet) : **${r.fixedOverheadMb} Mo**.`,
    `- **Gain de la mise en veille** : ${r.savedMb} Mo (${r.savedPercent} %) — ${r.sleptTabs} onglets endormis, ${r.after.liveTabs} restent actifs.`,
    `- Chargements en échec : ${r.failedLoads} sur ${r.clients * r.tabsPerClient}.`, '',
    '## Détail par type de processus', '',
    `- Avant : ${types(r.before)}`, `- Après : ${types(r.after)}`, '',
    '## Pages mesurées', '', ...r.urls.map((u) => `- ${u}`), '',
    '> Pages publiques, plutôt légères : un vrai poste avec des outils SaaS (ERP, messagerie, tableaux de bord) consomme davantage par onglet, donc le gain de la mise en veille y est plus grand. Relancer avec `JUNR_MEASURE_URLS` pour mesurer les vrais outils.', '',
  ].join('\n');
}
