'use strict';
// Serveur local des tests : faux « outil » avec session par cookie, formulaire de connexion, ressource à bloquer,
// et faux service de mise à jour du Chrome Web Store (CRX + XML).
const http = require('node:http');
const crypto = require('node:crypto');

function start() {
  const crx = new Map(); // id → { version, buf, hash? }
  const state = { crxHits: 0, updateHits: 0, forceHash: null };

  // Canal de commandes vers l'agent d'extension de test (test/bridge-extension/agent.js) : sondage long par (client, type).
  const queues = new Map(), parked = new Map(), waiters = new Map();
  let cmdId = 0;
  const deliver = (key) => {
    const q = queues.get(key), p = parked.get(key);
    if (q && q.length && p) { clearTimeout(p.timer); parked.delete(key); p.res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); p.res.end(JSON.stringify(q.shift())); }
  };
  const bridge = {
    send(space, cmd, kind = 'sw', ext = '', timeoutMs = 30000) {
      const id = ++cmdId, key = `${space}:${kind}:${ext}`;
      (queues.get(key) || queues.set(key, []).get(key)).push({ ...cmd, id });
      deliver(key);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(id); reject(new Error('Pas de réponse de l\'agent (' + key + ') : ' + JSON.stringify(cmd).slice(0, 120))); }, timeoutMs);
        waiters.set(id, { resolve, reject, timer });
      });
    },
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (process.env.JUNR_DEBUG) console.log('[srv]', req.method, req.url.slice(0, 70), req.headers.origin || '');
    const cookie = req.headers.cookie || '';
    const html = (body, code = 200, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(body); };

    if (url.pathname === '/set-session') return html('<title>ok</title>session', 200, { 'set-cookie': ['sid=good; Path=/; HttpOnly', 'pref=dark; Path=/'] });
    if (url.pathname === '/login') return html('<title>login</title><form><input name="user"><input type="password" name="pw"></form>');
    if (url.pathname === '/profile') return /(^|;\s*)sid=good/.test(cookie) ? html('<title>profil</title><h1>Mon profil</h1>') : html('', 302, { location: '/login' });
    if (url.pathname === '/profile-ip') return html('', 302, { location: '/login' }); // session liée à l'appareil : jamais portable
    if (url.pathname === '/robots.txt') return (res.writeHead(200, { 'content-type': 'text/plain' }), res.end('User-agent: *\n'));
    if (url.pathname === '/blocked/ad.js') return (res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }), res.end('window.__ad = 1;'));
    if (url.pathname === '/allowed/lib.js') return (res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }), res.end('window.__lib = 1;'));
    if (url.pathname === '/loginform') return html('<title>connexion</title><form id="f"><input id="u" type="text" name="user"><input id="p" type="password" name="pw"></form>');
    if (url.pathname === '/dl/file.txt') { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="rapport.txt"', 'content-length': 19 }); return res.end('contenu du fichier!'); }
    if (url.pathname === '/auth') return html('', 302, { location: url.searchParams.get('to') });
    if (url.pathname === '/auth-form') return html('<title>Connexion</title><form><input type="password"></form>');
    if (url.pathname === '/iframe-page') return html('<title>cadres</title><h1>Cadres</h1><iframe src="/page?frame" width="200" height="100"></iframe>');
    if (url.pathname === '/spa') return html('<title>spa</title><script>setTimeout(() => history.pushState({}, "", "/spa/etape2"), 400); setTimeout(() => { location.hash = "#ancre"; }, 900);</script>');
    if (url.pathname === '/page') return html('<title>page</title><body><p id="t">texte</p></body>');

    if (url.pathname === '/crx' && url.searchParams.get('response') === 'updatecheck') {
      state.updateHits++;
      let apps = '';
      for (const raw of url.searchParams.getAll('x')) {
        const p = new URLSearchParams(raw);
        const id = p.get('id'), have = p.get('v');
        const e = crx.get(id);
        if (e && e.version !== have) {
          const hash = state.forceHash || crypto.createHash('sha256').update(e.buf).digest('hex');
          apps += `<app appid="${id}" status="ok"><updatecheck codebase="http://127.0.0.1:${server.address().port}/crx?response=redirect&amp;x=id%3D${id}%26uc" hash_sha256="${hash}" status="ok" version="${e.version}"/></app>`;
        } else apps += `<app appid="${id}" status="ok"><updatecheck status="noupdate"/></app>`;
      }
      res.writeHead(200, { 'content-type': 'text/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">${apps}</gupdate>`);
    }
    if (url.pathname === '/crx') {
      const x = new URLSearchParams(url.searchParams.get('x') || '');
      const id = x.get('id');
      const entry = crx.get(id);
      if (url.searchParams.get('response') === 'redirect') {
        state.crxHits++;
        if (!entry) return html('not found', 404);
        res.writeHead(200, { 'content-type': 'application/x-chrome-extension' });
        return res.end(entry.buf);
      }
      return html('', 400);
    }
    if (url.pathname === '/bridge/poll') {
      const key = `${url.searchParams.get('space')}:${url.searchParams.get('kind')}:${url.searchParams.get('ext')}`;
      const old = parked.get(key);
      if (old) { clearTimeout(old.timer); old.res.writeHead(204, { 'access-control-allow-origin': '*' }); old.res.end(); }
      const timer = setTimeout(() => { parked.delete(key); res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end(); }, 15000);
      parked.set(key, { res, timer });
      res.on('close', () => { if (parked.get(key)?.res === res) { clearTimeout(timer); parked.delete(key); } });
      return deliver(key);
    }
    if (url.pathname === '/bridge/result' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end();
        const out = JSON.parse(body), w = waiters.get(out.id);
        if (w) { clearTimeout(w.timer); waiters.delete(out.id); out.ok ? w.resolve(out.value) : w.reject(new Error(out.error)); }
      });
      return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': '*' }); return res.end(); }
    res.writeHead(404); res.end('404');
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    resolve({
      origin, state, server, bridge,
      publish: (id, version, buf) => crx.set(id, { version, buf }),
      close: () => server.close(),
    });
  }));
}

module.exports = { start };
