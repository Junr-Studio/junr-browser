'use strict';
// Phase 0, étape 0 : mesure les API chrome.* réellement exposées par cette version d'Electron.
// Résultat : src/extensions/electron-api-surface.json (lu par compat.js) + docs/electron-api-surface.md.
//   npm run phase0:probe
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
// Espaces de noms que la sonde ne peut pas observer depuis un service worker.
const UNTESTED = ['devtools'];

exports.makeConfig = () => ({ unloadAfterMs: 300000, clients: [{ id: 'a', name: 'A', color: '#d9534f', tools: [] }], globalTools: [] });

exports.run = async ({ sessions }) => {
  const reports = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { reports.push(JSON.parse(body)); } catch { /* ignoré */ } res.writeHead(204); res.end(); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/probe`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junr-probe-'));
  fs.cpSync(path.join(ROOT, 'test', 'probe-extension'), tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sw.js'), `const PROBE_URL = ${JSON.stringify(url)};\n` + fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8'));

  const { ses, ready } = sessions.getSession('a');
  await ready;
  let ext;
  try { ext = await (ses.extensions ?? ses).loadExtension(tmp); } catch (e) { console.error('Chargement de la sonde impossible :', e.message); app.exit(1); return; }
  console.log(`Sonde chargée : ${ext.name} (${ext.id})`);
  const end = Date.now() + 30000;
  while (!reports.length && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
  if (!reports.length) { console.error('La sonde n\'a rien rapporté : le service worker ne démarre pas.'); app.exit(1); return; }
  const r = reports[0];

  const usable = [];
  const missingNs = [];
  for (const [ns, v] of Object.entries(r.namespaces)) {
    if (UNTESTED.includes(ns)) continue;
    const probes = Object.entries(r.calls).filter(([k]) => k.startsWith(ns + '.'));
    const present = !v.startsWith('missing');
    const allMissing = probes.length > 0 && probes.every(([, res]) => res.startsWith('missing'));
    if (present && !allMissing) usable.push(ns); else missingNs.push(ns);
  }
  const surface = {
    electron: process.versions.electron, chrome: process.versions.chrome, generatedAt: new Date().toISOString(),
    namespaces: usable.sort(), absent: missingNs.sort(), untested: UNTESTED, calls: r.calls, persistPrev: r.persistPrev,
  };
  fs.writeFileSync(path.join(ROOT, 'src', 'extensions', 'electron-api-surface.json'), JSON.stringify(surface, null, 2) + '\n');

  const lines = [
    '# API d\'extensions exposées par Electron', '',
    `Mesure faite par \`npm run phase0:probe\` : Electron ${surface.electron} (Chromium ${surface.chrome}), ${surface.generatedAt}.`, '',
    'Une extension MV3 de test déclare toutes les permissions connues ; son service worker liste les espaces de noms `chrome.*` et appelle une fonction représentative de chacun.', '',
    `**Utilisables (${usable.length})** : ${usable.map((x) => `\`${x}\``).join(', ')}`, '',
    `**Absents (${missingNs.length})** : ${missingNs.map((x) => `\`${x}\``).join(', ') || '—'}`, '',
    `**Non mesurables depuis un service worker** : ${UNTESTED.map((x) => `\`${x}\``).join(', ')}`, '',
    '## Détail des appels', '', '| Fonction | Résultat |', '| --- | --- |',
    ...Object.entries(r.calls).map(([k, v]) => `| \`chrome.${k}\` | ${v.replace(/\|/g, '\\|')} |`), '',
  ];
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'electron-api-surface.md'), lines.join('\n'));
  console.log(`Utilisables : ${usable.join(', ')}`);
  console.log(`Absents     : ${missingNs.join(', ')}`);
  server.close();
  app.exit(0);
};
