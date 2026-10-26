'use strict';
// Captures de l'interface (barre du haut, volets, Réglages, dialogue) dans plusieurs situations, pour revue visuelle.
//   SHOT_DIR=... node scripts/run.js scripts/ux-shot.js
// Les pages sont des vues natives : la capture de la barre ne les contient pas ; les volets sont capturés à part.
const fs = require('node:fs');
const path = require('node:path');
const signals = require('../src/signals');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = process.env.SHOT_DIR || path.join(__dirname, '..', 'docs', 'shots');

exports.makeConfig = (diag) => ({
  unloadAfterMs: 300000,
  clients: [
    { id: 'acme', name: 'Acme Corp', color: '#d9534f', tools: [{ name: 'Messagerie', url: diag }, { name: 'Compta', url: diag + '?c' }, { name: 'CRM', url: diag + '?crm' }, { name: 'Tickets', url: diag + '?t' }] },
    { id: 'globex', name: 'Globex', color: '#2f8f83', critical: true, tools: [{ name: 'Messagerie', url: diag + '?g1' }, { name: 'Wiki', url: diag + '?g2' }] },
    { id: 'initech', name: 'Initech', color: '#5b6fd6', tools: [{ name: 'Messagerie', url: diag + '?i1' }, { name: 'Visio', url: diag + '?i2' }, { name: 'Agenda', url: diag + '?i3' }] },
  ],
  globalTools: [{ name: 'Slack interne', url: diag + '?s' }, { name: 'ERP', url: diag + '?erp' }],
});

// La surface d'affichage d'une fenêtre masquée ou recouverte peut manquer un instant : on réessaie.
async function save(name, wc) {
  fs.mkdirSync(dir, { recursive: true });
  let img;
  for (let i = 0; ; i++) {
    try { img = await wc.capturePage(); break; } catch (e) { if (i >= 8) throw e; await wait(400); }
  }
  fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  console.log('SHOT', name);
}

exports.run = async (core) => {
  const { tabs, state } = core;
  const flyout = require('../src/flyout');
  const groups = require('../src/groups');
  const shell = async (name) => { tabs.pushNow(); await wait(500); await save(name, state.shell.webContents); };
  const fly = async (name, kind, rect) => { await flyout.open(kind, rect); await wait(900); await save(name, flyout._view().webContents); flyout.close(); };

  state.win.setAlwaysOnTop(true); // devant les autres fenêtres : sinon rien n'est affiché, donc rien n'est capturable
  await wait(2500);
  const acme = tabs.tabsOfSpace('acme');
  const msg = acme[0];
  await tabs.activateTab(msg.id);
  await wait(800);
  // Base du compteur, puis hausse pendant que l'on est ailleurs
  msg.title = 'Boîte de réception'; signals.observe(msg);
  await tabs.switchSpace('globex');
  await tabs.activateTab(tabs.tabsOfSpace('globex')[0].id);
  msg.title = '(3) Boîte de réception'; signals.observe(msg);
  tabs.tabsOfSpace('globex')[0].draft = true;
  await shell('1-globex-sensible');
  state.leftAt.acme = Date.now() - 134 * 60000;
  await tabs.switchSpace('acme');
  await wait(300);
  await shell('2-acme');
  await fly('2b-volet-clients', 'clients', { x: 8, right: 42 });

  const admin = groups.add('acme', 'Administratif');
  const dev = groups.add('acme', 'Développement');
  groups.assign(acme[1].id, admin.id); groups.assign(acme[0].id, admin.id); groups.assign(acme[2].id, dev.id);
  await shell('2c-groupes-tous');
  await tabs.selectGroup('acme', admin.id);
  await shell('2d-groupe-administratif');
  await fly('2e-volet-clients-groupes', 'clients', { x: 8, right: 42 });

  require('../src/spaces').pinExtension(core.extManager.list()[0]?.id || '', true);
  await fly('2f-volet-extensions', 'extensions', { x: 1180, right: 1290 });

  tabs.toggleVitrine(true);
  await shell('2g-vitrine');
  tabs.toggleVitrine(false);
  await tabs.activateTab(tabs.tabsOfSpace('global')[0].id);
  await shell('3-commun');
  await tabs.openInternal('settings');
  await wait(1200);
  const settings = [...state.tabs.values()].find((t) => t.internal);
  await save('4-reglages', settings.view.webContents);
  await tabs.switchSpace('acme');
  tabs.pickSpace();
  await wait(1200);
  const dv = require('../src/dialog')._view().webContents;
  await dv.executeJavaScript("const f = document.getElementById('filter'); f.value = 'ac'; f.dispatchEvent(new Event('input')); 1");
  await wait(300);
  await save('5-ctrlk', dv);
  process.exit(0);
};
