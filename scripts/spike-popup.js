'use strict';
// Diagnostic : installe une extension (EXT_ID), ouvre son popup et affiche le texte rendu ; capture d'écran dans SHOT si fourni.
//   EXT_ID=<id> [SHOT=chemin.png] node scripts/run.js scripts/spike-popup.js
const fs = require('node:fs');
const { app } = require('electron');

exports.makeConfig = (diag) => ({ unloadAfterMs: 300000, clients: [{ id: 'a', name: 'A', color: '#d00', tools: [{ name: 'T', url: diag }] }], globalTools: [] });

exports.run = async ({ state, tabs, extManager }) => {
  const popup = require('../src/extensions/popup');
  popup._setAutoClose(false);
  await new Promise((r) => setTimeout(r, 1500));
  await extManager.install(process.env.EXT_ID);
  await new Promise((r) => setTimeout(r, 3000));
  await tabs.activateTab(tabs.tabsOfSpace('a')[0].id);
  await popup.toggle(process.env.EXT_ID, 900);
  await new Promise((r) => setTimeout(r, 6000));
  const wc = popup._view()?.webContents;
  if (!wc) { console.log('POPUP: non ouvert'); app.exit(1); return; }
  console.log('POPUP_TEXT:', JSON.stringify(await wc.executeJavaScript('document.body.innerText').catch((e) => e.message)));
  console.log('POPUP_INPUTS:', JSON.stringify(await wc.executeJavaScript('[...document.querySelectorAll("input,button")].map((e) => (e.type || e.tagName) + ":" + (e.placeholder || e.innerText || e.name || "").slice(0, 30))').catch((e) => e.message)));
  if (process.env.SHOT) fs.writeFileSync(process.env.SHOT, (await wc.capturePage()).toPNG());
  app.exit(0);
};
