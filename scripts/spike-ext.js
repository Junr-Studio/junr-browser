'use strict';
// Diagnostic : installe une extension du Web Store (EXT_ID) et affiche les erreurs de son service worker avec leur emplacement.
//   EXT_ID=<id> node scripts/run.js scripts/spike-ext.js
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

exports.makeConfig = () => ({ unloadAfterMs: 300000, clients: [{ id: 'a', name: 'A', color: '#d00', tools: [] }], globalTools: [] });

exports.run = async ({ sessions, extManager }) => {
  const { ses, ready } = sessions.getSession('a');
  await ready;
  ses.serviceWorkers.on('console-message', (e, d) => {
    if (d.level === 3 || d.level === 'error' || /junr-shim/.test(d.message)) console.log(`[sw ${d.level}]`, String(d.message).slice(0, 300), '@', String(d.sourceUrl).replace(/^chrome-extension:\/\/\w+/, ''), d.lineNumber);
  });
  const id = process.env.EXT_ID;
  await extManager.install(id);
  console.log('[installée]', id, extManager.records()[id].version);
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS || 10000)));
  if (process.env.DUMP) {
    const dir = extManager.extPath(extManager.records()[id]);
    console.log('[dossier]', dir);
    fs.writeFileSync(path.join(process.env.DUMP), dir);
  }
  app.exit(0);
};
