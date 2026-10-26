'use strict';
// Capture d'une page HTML locale en PNG (maquettes d'interface) :
//   node_modules/.bin/electron scripts/shot-html.js <page.html> <sortie.png> [largeur] [hauteur] [attente_ms]
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const [, , input, output, w = '1440', h = '900', wait = '700'] = process.argv;
if (!input || !output) { console.error('Usage : electron scripts/shot-html.js <page.html> <sortie.png> [largeur] [hauteur] [attente_ms]'); process.exit(2); }

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: Number(w), height: Number(h), show: false, useContentSize: true, webPreferences: { offscreen: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) console.log('console:', msg); });
  await win.loadFile(path.resolve(input));
  await new Promise((r) => setTimeout(r, Number(wait)));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), img.toPNG());
  console.log('OK', output, img.getSize().width + 'x' + img.getSize().height);
  app.exit(0);
});
