'use strict';
// Vérifie la version d'Electron installée : correctifs de sécurité connus, retard sur la dernière version stable.
//   npm run check:electron            (code de sortie 1 si la version est vulnérable ou en retard sur sa branche)
//   npm run check:electron -- --vuln-only   (CI : n'échoue que si la version est vulnérable ; un simple retard est signalé sans bloquer)
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Versions minimales corrigeant la faille des API d'extensions entre sessions (avis cité dans le plan de handoff,
// CVE-2026-70602) : 39.8.8, 40.9.0, 41.2.1, 42.0.0-beta.3. Toute version majeure ultérieure à 42 est corrigée.
const MIN_SAFE = { 39: '39.8.8', 40: '40.9.0', 41: '41.2.1', 42: '42.0.0-beta.3' };
const ADVISORY = 'https://advisories.gitlab.com/npm/electron/CVE-2026-70602/';

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(v);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? { tag: m[4], n: +m[5] } : null };
}
function cmp(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.n === b.pre.n ? 0 : a.pre.n < b.pre.n ? -1 : 1;
}

const installed = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version;
const cur = parse(installed);
let problems = 0;
const VULN_ONLY = process.argv.includes('--vuln-only');
console.log(`Electron installé : ${installed}`);

const min = MIN_SAFE[cur.major];
if (cur.major < 39) { console.log(`ÉCHEC  Version majeure ${cur.major} non maintenue et vulnérable (${ADVISORY})`); problems++; }
else if (min && cmp(cur, parse(min)) < 0) { console.log(`ÉCHEC  Vulnérable : mettre à jour vers ${min} ou plus (${ADVISORY})`); problems++; }
else console.log('OK     Correctifs de l\'avis CVE-2026-70602 présents');

try {
  const versions = JSON.parse(execFileSync('npm', ['view', 'electron', 'versions', '--json'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 60000 }));
  const stable = versions.map(parse).filter((v) => v && !v.pre).sort(cmp);
  const latest = stable[stable.length - 1];
  const sameMajor = stable.filter((v) => v.major === cur.major).pop();
  const fmt = (v) => `${v.major}.${v.minor}.${v.patch}`;
  console.log(`Dernière stable : ${fmt(latest)} · dernière de la branche ${cur.major} : ${sameMajor ? fmt(sameMajor) : '—'}`);
  if (sameMajor && cmp(cur, sameMajor) < 0) { console.log(`ATTENTION  Correctifs disponibles sur la branche ${cur.major} : ${fmt(sameMajor)}`); if (!VULN_ONLY) problems++; }
  if (latest.major > cur.major) console.log(`INFO   Nouvelle version majeure disponible (${latest.major}) : suivre docs/ELECTRON-UPDATES.md`);
} catch (e) {
  console.log(`INFO   Registre npm injoignable (${e.message.split('\n')[0]}) : retard non évalué`);
}
process.exit(problems ? 1 : 0);
