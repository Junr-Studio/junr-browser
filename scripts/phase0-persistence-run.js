'use strict';
// Exécuté deux fois sur les mêmes données (voir phase0-persistence.js) :
//  phase 1 : installe une extension, écrit dans son stockage, pose un cookie dans la partition d'un client ;
//  phase 2 (après arrêt complet de l'application) : l'extension est-elle toujours chargée, son stockage et le cookie sont-ils encore là ?
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, session } = require('electron');
const fixtures = require('../test/fixtures');

const ROOT = path.join(__dirname, '..');
const PHASE = Number(process.env.PHASE || 1);
const dataDir = process.env.JUNR_USER_DATA;
const portFile = path.join(dataDir, 'probe-port.txt');
const keyFile = path.join(dataDir, 'probe-key.der');

exports.makeConfig = () => ({ unloadAfterMs: 300000, clients: [{ id: 'a', name: 'Client A', color: '#d9534f', tools: [] }], globalTools: [] });

const emit = (o) => console.log('PERSIST_RESULT ' + JSON.stringify(o));

exports.run = async ({ state, extManager, sessions }) => {
  const reports = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { try { reports.push(JSON.parse(body)); } catch { /* ignoré */ } res.writeHead(204); res.end(); });
    } else { res.writeHead(200, { 'set-cookie': 'sid=persist; Max-Age=86400; Path=/; HttpOnly', 'content-type': 'text/html' }); res.end('<title>x</title>'); }
  });
  const wanted = PHASE === 2 && fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, 'utf8')) : 0;
  await new Promise((r, j) => { server.once('error', j); server.listen(wanted, '127.0.0.1', r); });
  const port = server.address().port;
  const { ses, ready } = sessions.getSession('a');
  await ready;

  if (PHASE === 1) {
    fs.writeFileSync(portFile, String(port));
    const key = fixtures.newKey();
    fs.writeFileSync(keyFile, key);
    const src = path.join(ROOT, 'test', 'probe-extension');
    const files = {};
    for (const f of fs.readdirSync(src)) files[f] = fs.readFileSync(path.join(src, f), 'utf8');
    files['sw.js'] = `const PROBE_URL = 'http://127.0.0.1:${port}/probe';\n` + files['sw.js'];
    const { crx } = fixtures.buildCrx3(fixtures.buildZip(files), key);
    const out = await extManager.installBuffer(crx, { source: 'webstore' });
    const { Notification, net } = require('electron');
    void Notification; void net;
    // Cookie posé comme le ferait un serveur d'outil.
    const wc = new (require('electron').WebContentsView)({ webPreferences: { session: ses } }).webContents;
    await wc.loadURL(`http://127.0.0.1:${port}/`);
    wc.close();
    await ses.cookies.flushStore();
    const end = Date.now() + 30000;
    while (!reports.length && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    emit({ phase: 1, installed: out.id, name: out.name, swReported: reports.length > 0, persistPrev: reports[0]?.persistPrev ?? null });
  } else {
    const rec = Object.values(extManager.records())[0];
    const end = Date.now() + 30000;
    while (!reports.length && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    const cookies = await ses.cookies.get({ name: 'sid' });
    emit({
      phase: 2, recordFound: !!rec, enabled: rec?.enabled, loadedInSession: !!rec && state.sessions.get('a').loaded.has(rec.id),
      swReported: reports.length > 0, persistPrev: reports[0]?.persistPrev ?? null, cookiePersisted: cookies.length === 1 && cookies[0].httpOnly,
    });
  }
  server.close();
  void os; void session;
  app.exit(0);
};
