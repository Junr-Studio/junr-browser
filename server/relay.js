'use strict';
// Relais Junr pour le partage d'espaces : transporte des paquets DÉJÀ chiffrés pour le destinataire (le serveur ne voit
// jamais cookies ni stockage). Il impose l'expiration et l'usage unique, supprime le paquet à la récupération et tient
// le journal des partages (qui, vers quelle empreinte, quand). Sans dépendance : `node server/relay.js`.
//
// Variables d'environnement (démarrage en ligne de commande) :
//   RELAY_TOKENS  "alice:jeton1,bob:jeton2"  collaborateurs autorisés (nom:jeton) ; jetons longs et aléatoires
//   RELAY_ADMIN   nom d'un collaborateur autorisé à lire le journal (optionnel)
//   RELAY_DIR     dossier de stockage (défaut ./relay-data) ; RELAY_PORT (défaut 8787) ; RELAY_HOST (défaut 127.0.0.1)
//   RELAY_MAX_MB  taille maximale d'un paquet (défaut 20)
// À placer derrière HTTPS (reverse proxy) en production : le paquet est chiffré, mais le jeton d'accès ne doit pas circuler en clair.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MAX_TTL_MS = 7 * 24 * 3600 * 1000;
const ID_RE = /^[0-9a-f-]{36}$/;
const FP_RE = /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/;

function create({ tokens, admin = null, dir, maxBytes = 20 * 1024 * 1024, now = () => Date.now() }) {
  fs.mkdirSync(path.join(dir, 'packets'), { recursive: true });
  const journalFile = path.join(dir, 'journal.jsonl');
  const tombstones = path.join(dir, 'retrieved.json'); // id → expiresAt : un paquet récupéré ne revient jamais
  let gone = {};
  try { gone = JSON.parse(fs.readFileSync(tombstones, 'utf8')); } catch { /* premier démarrage */ }
  const byToken = new Map(Object.entries(tokens).map(([name, token]) => [crypto.createHash('sha256').update(token).digest('hex'), name]));
  const hits = new Map(); // limitation de débit par collaborateur

  const meta = (id) => path.join(dir, 'packets', `${id}.json`);
  const blob = (id) => path.join(dir, 'packets', `${id}.bin`);
  const saveGone = () => fs.writeFileSync(tombstones, JSON.stringify(gone));
  const journal = (entry) => fs.appendFileSync(journalFile, JSON.stringify({ at: now(), ...entry }) + '\n');

  function sweep() {
    const t = now();
    for (const f of fs.readdirSync(path.join(dir, 'packets'))) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      let m;
      try { m = JSON.parse(fs.readFileSync(meta(id), 'utf8')); } catch { continue; }
      if (m.expiresAt <= t) { fs.rmSync(meta(id), { force: true }); fs.rmSync(blob(id), { force: true }); journal({ action: 'expired', id, from: m.from, to: m.to }); }
    }
    let changed = false;
    for (const [id, exp] of Object.entries(gone)) if (exp <= t) { delete gone[id]; changed = true; }
    if (changed) saveGone();
  }

  const who = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    return m ? byToken.get(crypto.createHash('sha256').update(m[1]).digest('hex')) || null : null;
  };

  function limited(user) {
    const t = now(), win = (hits.get(user) || []).filter((x) => x > t - 60000);
    win.push(t); hits.set(user, win);
    return win.length > 60; // 60 appels par minute et par collaborateur
  }

  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > maxBytes) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    try {
      sweep();
      const user = who(req);
      if (!user) return send(401, { error: 'unauthorized' });
      if (limited(user)) return send(429, { error: 'rate-limited' });
      const url = new URL(req.url, 'http://relay');
      const m = /^\/v1\/packets\/([^/]+)$/.exec(url.pathname);

      if (req.method === 'PUT' && m) {
        const id = m[1];
        if (!ID_RE.test(id)) return send(400, { error: 'bad-id' });
        if (fs.existsSync(meta(id)) || gone[id]) return send(409, { error: 'exists' });
        const body = await readBody(req);
        let header;
        try { header = JSON.parse(Buffer.from(JSON.parse(body.toString('utf8')).h, 'base64').toString('utf8')); } catch { return send(400, { error: 'not-a-junr-packet' }); }
        if (header.format !== 'junr-share' || header.id !== id || !FP_RE.test(header.to || '')) return send(400, { error: 'bad-header' });
        const expiresAt = Number(header.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt > now() + MAX_TTL_MS) return send(400, { error: 'bad-expiry' });
        fs.writeFileSync(blob(id), body);
        fs.writeFileSync(meta(id), JSON.stringify({ from: user, to: header.to, expiresAt, size: body.length }));
        journal({ action: 'upload', id, from: user, to: header.to, size: body.length });
        return send(201, { id, expiresAt });
      }

      if (req.method === 'GET' && m) {
        const id = m[1];
        if (!ID_RE.test(id)) return send(400, { error: 'bad-id' });
        if (gone[id]) return send(410, { error: 'already-retrieved' });
        if (!fs.existsSync(meta(id))) return send(404, { error: 'not-found' });
        const info = JSON.parse(fs.readFileSync(meta(id), 'utf8'));
        if (info.expiresAt <= now()) { sweep(); return send(404, { error: 'not-found' }); }
        // Contrôle d'empreinte facultatif : le destinataire annonce la sienne, le paquet n'est pas servi à une autre.
        const claimed = req.headers['x-junr-fingerprint'];
        if (claimed && claimed !== info.to) return send(403, { error: 'wrong-recipient' });
        const data = fs.readFileSync(blob(id));
        fs.rmSync(blob(id), { force: true }); fs.rmSync(meta(id), { force: true }); // supprimé à la récupération
        gone[id] = info.expiresAt; saveGone();
        journal({ action: 'download', id, from: info.from, to: info.to, by: user });
        return send(200, data, 'application/octet-stream');
      }

      if (req.method === 'DELETE' && m) { // l'expéditeur retire un paquet non encore récupéré
        const id = m[1];
        if (!ID_RE.test(id) || !fs.existsSync(meta(id))) return send(404, { error: 'not-found' });
        const info = JSON.parse(fs.readFileSync(meta(id), 'utf8'));
        if (info.from !== user) return send(403, { error: 'not-yours' });
        fs.rmSync(blob(id), { force: true }); fs.rmSync(meta(id), { force: true });
        journal({ action: 'revoked', id, from: info.from, to: info.to });
        return send(204, '');
      }

      if (req.method === 'GET' && url.pathname === '/v1/log') {
        if (!admin || user !== admin) return send(403, { error: 'admin-only' });
        const lines = fs.existsSync(journalFile) ? fs.readFileSync(journalFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
        return send(200, lines.slice(-500).reverse());
      }
      return send(404, { error: 'unknown' });
    } catch (e) {
      return send(e.status || 500, { error: e.status ? e.message : 'server-error' });
    }
  });

  return { server, sweep };
}

function listen(opts, port = 0, host = '127.0.0.1') {
  const r = create(opts);
  return new Promise((resolve) => r.server.listen(port, host, () => resolve({ ...r, port: r.server.address().port, close: () => new Promise((ok) => r.server.close(ok)) })));
}

if (require.main === module) {
  const tokens = Object.fromEntries((process.env.RELAY_TOKENS || '').split(',').filter(Boolean).map((p) => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; }));
  if (!Object.keys(tokens).length) { console.error('RELAY_TOKENS requis : "nom:jeton,nom2:jeton2"'); process.exit(2); }
  for (const [n, t] of Object.entries(tokens)) if (t.length < 24) { console.error(`Jeton de ${n} trop court (24 caractères minimum)`); process.exit(2); }
  listen({ tokens, admin: process.env.RELAY_ADMIN || null, dir: process.env.RELAY_DIR || './relay-data', maxBytes: Number(process.env.RELAY_MAX_MB || 20) * 1024 * 1024 },
    Number(process.env.RELAY_PORT || 8787), process.env.RELAY_HOST || '127.0.0.1').then((r) => console.log(`Relais Junr à l'écoute sur ${process.env.RELAY_HOST || '127.0.0.1'}:${r.port}`));
  setInterval(() => {}, 1 << 30);
}

module.exports = { create, listen };
