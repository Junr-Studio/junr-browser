'use strict';
// Client du relais Junr (voir server/relay.js) : dépose un paquet chiffré, le récupère une seule fois grâce à son code.
const { state } = require('./state');
const secrets = require('./secrets');

const cfg = () => (state.store.data.relay ||= { url: '', tokenSecret: '' });

function publicConfig() {
  const c = cfg();
  return { url: c.url, hasToken: !!c.tokenSecret };
}

async function setConfig({ url, token }) {
  const c = cfg();
  if (url !== undefined) {
    const u = String(url).trim().replace(/\/+$/, '');
    if (u) {
      let p;
      try { p = new URL(u); } catch { throw new Error('Adresse du relais invalide'); }
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(p.hostname);
      if (p.protocol !== 'https:' && !local) throw new Error('Le relais doit être en HTTPS (le jeton d\'accès ne doit pas circuler en clair)');
    }
    c.url = u;
  }
  if (token !== undefined && token !== '') c.tokenSecret = await secrets.encrypt(token);
  if (token === null) c.tokenSecret = '';
  state.store.save();
}

async function call(method, path, { body, fingerprint } = {}) {
  const c = cfg();
  if (!c.url || !c.tokenSecret) throw new Error('Relais non configuré (adresse et jeton requis)');
  const res = await fetch(c.url + path, {
    method, body, signal: AbortSignal.timeout(60000),
    headers: { authorization: `Bearer ${await secrets.decrypt(c.tokenSecret)}`, ...(fingerprint ? { 'x-junr-fingerprint': fingerprint } : {}), ...(body ? { 'content-type': 'application/octet-stream' } : {}) },
  });
  if (res.ok) return res;
  const code = (await res.json().catch(() => ({}))).error;
  const msg = {
    401: 'Relais : jeton refusé', 403: code === 'wrong-recipient' ? 'Ce paquet est destiné à une autre installation' : 'Relais : accès refusé',
    404: 'Paquet introuvable ou expiré', 409: 'Ce paquet existe déjà sur le relais', 410: 'Ce paquet a déjà été récupéré (usage unique)',
    413: 'Paquet trop volumineux pour le relais', 429: 'Relais : trop de requêtes, réessayez dans une minute',
  }[res.status] || `Relais : erreur ${res.status}`;
  throw new Error(msg);
}

// Le code de retrait est l'identifiant du paquet (UUID aléatoire) ; le contenu reste illisible sans la clé du destinataire.
async function upload(fileBuf, packetId) {
  await call('PUT', `/v1/packets/${packetId}`, { body: fileBuf });
  return packetId;
}

async function download(code, fingerprint) {
  const id = String(code).trim();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Code de retrait invalide');
  return Buffer.from(await (await call('GET', `/v1/packets/${id}`, { fingerprint })).arrayBuffer());
}

async function revoke(code) {
  await call('DELETE', `/v1/packets/${String(code).trim()}`);
}

module.exports = { publicConfig, setConfig, upload, download, revoke };
