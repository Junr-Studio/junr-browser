'use strict';
// Partage d'un espace client : cookies (httpOnly inclus) + localStorage par origine, dans un paquet chiffré
// pour le destinataire. Format = fichier `.junrshare` ; un relais Junr pourra transporter le même fichier sans le changer.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, session, WebContentsView } = require('electron');
const { state } = require('./state');
const secrets = require('./secrets');
const sessions = require('./sessions');
const tabs = require('./tabs');
const spaces = require('./spaces');
const dialog = require('./dialog');

const FORMAT = 'junr-share';
const DEFAULT_TTL = 24 * 3600 * 1000;
const SESSION_COOKIE_TTL = 7 * 24 * 3600 * 1000; // un cookie de session importé devient persistant 7 jours
const { LOGIN_PATH } = require('./loginpath');

const data = () => state.store.data;
const originOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Identité de partage (clé X25519 de chiffrement + clé Ed25519 de signature du collaborateur) ---------- */
let identity = null;
const identityFile = () => path.join(app.getPath('userData'), 'share-identity.json');

async function getIdentity() {
  if (identity) return identity;
  const protectedByOs = await secrets.available();
  const wrap = async (b64) => (protectedByOs ? secrets.encrypt(b64) : b64);
  const unwrap = async (v, plain) => (plain ? v : secrets.decrypt(v));
  let f = null;
  try { f = JSON.parse(fs.readFileSync(identityFile(), 'utf8')); } catch { /* à créer */ }
  if (f) {
    try {
      identity = { privateKey: crypto.createPrivateKey({ key: Buffer.from(await unwrap(f.priv, f.plain), 'base64'), format: 'der', type: 'pkcs8' }), pub: f.pub };
      if (f.signPriv) {
        identity.signKey = crypto.createPrivateKey({ key: Buffer.from(await unwrap(f.signPriv, f.plain), 'base64'), format: 'der', type: 'pkcs8' });
        identity.signPub = f.signPub;
        return identity;
      }
    } catch { identity = null; f = null; }
  }
  const save = async (obj) => { fs.mkdirSync(path.dirname(identityFile()), { recursive: true }); fs.writeFileSync(identityFile(), JSON.stringify(obj), { mode: 0o600 }); };
  const sign = crypto.generateKeyPairSync('ed25519');
  const signPub = sign.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const signPkcs8 = sign.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  if (identity && f) { // identité de chiffrement existante : on ajoute seulement la clé de signature
    await save({ ...f, signPub, signPriv: f.plain ? signPkcs8 : await wrap(signPkcs8) });
    identity.signKey = sign.privateKey; identity.signPub = signPub;
    return identity;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  await save({ pub, priv: await wrap(pkcs8), signPub, signPriv: await wrap(signPkcs8), plain: !protectedByOs });
  identity = { privateKey, pub, signKey: sign.privateKey, signPub };
  return identity;
}

const fingerprintOf = (pubB64) => crypto.createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').slice(0, 16).replace(/(.{4})(?=.)/g, '$1-');

async function myShareId() {
  const { pub, signPub } = await getIdentity();
  return { shareId: pub, fingerprint: fingerprintOf(pub), signFingerprint: fingerprintOf(signPub) };
}

function parseRecipient(shareId) {
  let key;
  try {
    key = crypto.createPublicKey({ key: Buffer.from(String(shareId).trim(), 'base64'), format: 'der', type: 'spki' });
  } catch { throw new Error('Identifiant de partage invalide'); }
  if (key.asymmetricKeyType !== 'x25519') throw new Error('Identifiant de partage invalide (type de clé)');
  return key;
}

/* ---------- Chiffrement du paquet ---------- */
function deriveKey(shared, ephPubDer, recipientDer) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([ephPubDer, recipientDer]), 'junr-share-v1', 32));
}

async function seal(payload, recipientShareId, header) {
  const me = await getIdentity();
  const recipient = parseRecipient(recipientShareId);
  const recipientDer = recipient.export({ type: 'spki', format: 'der' });
  const eph = crypto.generateKeyPairSync('x25519');
  const ephPubDer = eph.publicKey.export({ type: 'spki', format: 'der' });
  const key = deriveKey(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), ephPubDer, recipientDer);
  const headerBytes = Buffer.from(JSON.stringify({ ...header, format: FORMAT, v: 2, to: fingerprintOf(recipientDer.toString('base64')), eph: ephPubDer.toString('base64') }));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(headerBytes); // l'en-tête (expiration, destinataire) est authentifié : toute altération fait échouer le déchiffrement
  // Signature de l'expéditeur : liée à l'en-tête (destinataire, expiration, identifiant) et au contenu.
  const body = JSON.stringify(payload);
  const digest = crypto.createHash('sha256').update(body).digest();
  const sig = crypto.sign(null, Buffer.concat([headerBytes, digest]), me.signKey).toString('base64');
  const ct = Buffer.concat([cipher.update(JSON.stringify({ body, signer: me.signPub, sig }), 'utf8'), cipher.final()]);
  return Buffer.from(JSON.stringify({ h: headerBytes.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') }));
}

async function open(fileBuf) {
  let env, header, headerBytes;
  try {
    env = JSON.parse(fileBuf.toString('utf8'));
    headerBytes = Buffer.from(env.h, 'base64');
    header = JSON.parse(headerBytes.toString('utf8'));
  } catch { throw new Error('Fichier de partage illisible'); }
  if (header.format !== FORMAT || header.v !== 2) throw new Error('Format de partage non reconnu');
  const me = await getIdentity();
  const myDer = Buffer.from(me.pub, 'base64');
  if (header.to !== fingerprintOf(me.pub)) throw new Error('Ce paquet n\'est pas destiné à cette installation');
  let plain;
  try {
    const ephPubDer = Buffer.from(header.eph, 'base64');
    const ephPub = crypto.createPublicKey({ key: ephPubDer, format: 'der', type: 'spki' });
    const key = deriveKey(crypto.diffieHellman({ privateKey: me.privateKey, publicKey: ephPub }), ephPubDer, myDer);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
    d.setAAD(headerBytes);
    d.setAuthTag(Buffer.from(env.tag, 'base64'));
    plain = JSON.parse(Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new Error('Paquet corrompu ou altéré'); }
  let payload, signer;
  try {
    const digest = crypto.createHash('sha256').update(plain.body).digest();
    const pub = crypto.createPublicKey({ key: Buffer.from(plain.signer, 'base64'), format: 'der', type: 'spki' });
    if (pub.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, Buffer.concat([headerBytes, digest]), pub, Buffer.from(plain.sig, 'base64'))) throw new Error('bad');
    payload = JSON.parse(plain.body);
    signer = { pub: plain.signer, fingerprint: fingerprintOf(plain.signer) };
  } catch { throw new Error('Signature de l\'expéditeur invalide'); }
  return { header, payload, signer };
}

/* ---------- Vue masquée : lecture / écriture du localStorage d'une origine ---------- */
async function withHiddenView(ses, url, fn, { settleMs = 0, timeoutMs = 20000 } = {}) {
  const view = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([wc.loadURL(url).catch(() => {}), wait(timeoutMs)]);
    if (settleMs) await wait(settleMs); // laisse passer les redirections côté client
    return await fn(wc);
  } finally {
    if (!wc.isDestroyed()) wc.close();
  }
}

// Document minimal de l'origine (texte brut) : même origine que le site, donc même localStorage.
const storageDoc = (origin) => `${origin}/robots.txt`;

async function readLocalStorage(ses, origin) {
  return withHiddenView(ses, storageDoc(origin), async (wc) => {
    if (originOf(wc.getURL()) !== origin) return null; // redirigé ailleurs : origine non lisible
    return wc.executeJavaScript('(() => { try { return Object.fromEntries(Object.entries(localStorage)); } catch { return null; } })()');
  });
}

async function writeLocalStorage(ses, origin, items) {
  return withHiddenView(ses, storageDoc(origin), async (wc) => {
    if (originOf(wc.getURL()) !== origin) return false;
    return wc.executeJavaScript(`(() => { try { const d = ${JSON.stringify(items)}; for (const k of Object.keys(d)) localStorage.setItem(k, d[k]); return true; } catch { return false; } })()`);
  });
}

/* ---------- Collecte et pose de l'état d'un espace ---------- */
function originsOfSpace(spaceId, cookies) {
  const client = data().clients.find((c) => c.id === spaceId);
  const urls = [];
  for (const t of client?.tools || []) urls.push(tabs.resolveUrl(t.url), t.controlUrl && tabs.resolveUrl(t.controlUrl));
  for (const t of tabs.tabsOfSpace(spaceId)) urls.push(t.view?.webContents.getURL() || t.url);
  const origins = [...new Set(urls.map((u) => u && originOf(u)).filter(Boolean))];
  // Un domaine de cookie dont l'hôte est déjà couvert par un outil n'ajoute pas d'origine à deviner.
  const hosts = new Set(origins.map((o) => new URL(o).hostname));
  for (const c of cookies) {
    const host = c.domain.replace(/^\./, '');
    if (!hosts.has(host)) { hosts.add(host); origins.push(`https://${host}`); }
  }
  return origins.slice(0, 60);
}

async function collect(spaceId) {
  const { ses, ready } = sessions.getSession(spaceId);
  await ready;
  const cookies = (await ses.cookies.get({})).map((c) => ({
    name: c.name, value: c.value, domain: c.domain, hostOnly: !!c.hostOnly, path: c.path || '/', secure: !!c.secure,
    httpOnly: !!c.httpOnly, session: !!c.session, expirationDate: c.expirationDate, sameSite: c.sameSite || 'unspecified',
  }));
  const localStorage = {};
  for (const origin of originsOfSpace(spaceId, cookies)) {
    const items = await readLocalStorage(ses, origin).catch(() => null);
    if (items && Object.keys(items).length) localStorage[origin] = items;
  }
  return { cookies, localStorage };
}

async function applyBundle(ses, bundle) {
  const warnings = [];
  for (const c of bundle.cookies) {
    const host = c.domain.replace(/^\./, '');
    const details = {
      url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`, name: c.name, value: c.value, path: c.path || '/',
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
      expirationDate: c.session || !c.expirationDate ? Date.now() / 1000 + SESSION_COOKIE_TTL / 1000 : c.expirationDate,
    };
    if (!c.hostOnly && !c.name.startsWith('__Host-')) details.domain = c.domain;
    try { await ses.cookies.set(details); } catch (e) { warnings.push(`cookie ${c.name} (${host}) : ${e.message}`); }
  }
  for (const [origin, items] of Object.entries(bundle.localStorage)) {
    const ok = await writeLocalStorage(ses, origin, items).catch(() => false);
    if (!ok) warnings.push(`localStorage de ${origin} non écrit`);
  }
  await ses.cookies.flushStore();
  return warnings;
}

/* ---------- Test de portabilité : l'outil affiche-t-il sa page de contrôle sans demander de connexion ? ---------- */
async function probeTool(ses, tool) {
  if (!tool.controlUrl) return { toolId: tool.id, name: tool.name, status: 'unverifiable', detail: 'aucune URL de contrôle déclarée' };
  const control = tabs.resolveUrl(tool.controlUrl);
  const view = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  let code = 0;
  wc.on('did-navigate', (e, url, httpResponseCode) => { code = httpResponseCode; });
  try {
    await Promise.race([wc.loadURL(control).catch(() => {}), wait(20000)]);
    await wait(1500); // laisse passer les redirections côté client
    const final = wc.getURL();
    const fu = new URL(final || control), cu = new URL(control);
    const hasPw = await wc.executeJavaScript('!!document.querySelector("input[type=password]")').catch(() => false);
    let status = 'portable', detail = '';
    if (!final) { status = 'not-portable'; detail = 'page non chargée'; }
    else if (code >= 400) { status = 'not-portable'; detail = `HTTP ${code}`; }
    else if (fu.origin !== cu.origin) { status = 'not-portable'; detail = `redirigé vers ${fu.origin}`; }
    else if (hasPw) { status = 'not-portable'; detail = 'formulaire de mot de passe affiché'; }
    else if (LOGIN_PATH.test(fu.pathname) && !LOGIN_PATH.test(cu.pathname)) { status = 'not-portable'; detail = `redirigé vers ${fu.pathname}`; }
    return { toolId: tool.id, name: tool.name, status, detail };
  } finally {
    if (!wc.isDestroyed()) wc.close();
  }
}

async function probeAll(ses, tools) {
  const out = [];
  for (const t of tools) out.push(await probeTool(ses, t));
  return out;
}

// Statut des outils d'un client dans SA partition (ce que voit l'expéditeur avant l'envoi, puis le destinataire après l'import).
async function checkSpacePortability(spaceId) {
  const client = data().clients.find((c) => c.id === spaceId);
  if (!client) throw new Error('Client inconnu');
  const { ses, ready } = sessions.getSession(spaceId);
  await ready;
  const results = await probeAll(ses, client.tools);
  for (const r of results) {
    const tool = client.tools.find((t) => t.id === r.toolId);
    if (tool) tool.portability = { status: r.status, detail: r.detail, at: Date.now() };
  }
  state.store.save();
  return results;
}

/* ---------- Journal ---------- */
function logShare(entry) {
  const log = data().shareLog;
  log.push({ id: crypto.randomUUID(), when: Date.now(), user: data().settings.userName || os.userInfo().username, ...entry });
  if (log.length > 500) log.splice(0, log.length - 500);
  state.store.save();
}

/* ---------- Export ---------- */
// Étapes : collecte → import dans une partition éphémère vierge → test de portabilité par outil
// → retrait des données des outils non portables → chiffrement pour le destinataire.
const PREPARED_TTL = 5 * 60 * 1000;
const prepared = new Map(); // spaceId → { at, client, bundle, statuses }

async function prepareExport(spaceId) {
  const client = data().clients.find((c) => c.id === spaceId);
  if (!client) throw new Error('Client inconnu');
  const bundle = await collect(spaceId);

  const probeSes = session.fromPartition(`junr-share-test-${crypto.randomUUID()}`); // mémoire seule
  probeSes.setPermissionRequestHandler((wc, p, cb) => cb(false));
  let statuses;
  try {
    await applyBundle(probeSes, bundle);
    statuses = await probeAll(probeSes, client.tools);
  } finally {
    await probeSes.clearStorageData().catch(() => {});
  }

  // Minimisation : on ne transmet pas les identifiants d'un outil dont on sait qu'ils ne suffisent pas à se connecter.
  const notPortable = client.tools.filter((t) => statuses.find((s) => s.toolId === t.id)?.status === 'not-portable');
  const keepHosts = new Set(client.tools.filter((t) => !notPortable.includes(t)).map((t) => new URL(tabs.resolveUrl(t.url)).hostname));
  const dropHosts = notPortable.map((t) => new URL(tabs.resolveUrl(t.url)).hostname).filter((h) => !keepHosts.has(h));
  const matches = (host, h) => host === h || host.endsWith('.' + h);
  bundle.cookies = bundle.cookies.filter((c) => !dropHosts.some((h) => matches(c.domain.replace(/^\./, ''), h)));
  for (const origin of Object.keys(bundle.localStorage)) if (dropHosts.some((h) => matches(new URL(origin).hostname, h))) delete bundle.localStorage[origin];

  const out = { at: Date.now(), client, bundle, statuses };
  prepared.set(spaceId, out);
  return out;
}

// Étape visible de l'expéditeur : statut de chaque outil avant tout envoi.
async function previewExport(spaceId) {
  const p = await prepareExport(spaceId);
  return { statuses: p.statuses.map(({ name, status, detail }) => ({ name, status, detail })), cookies: p.bundle.cookies.length, origins: Object.keys(p.bundle.localStorage).length };
}

async function exportSpace(spaceId, recipientShareId, { ttlMs = DEFAULT_TTL } = {}) {
  parseRecipient(recipientShareId);
  let p = prepared.get(spaceId);
  if (!p || Date.now() - p.at > PREPARED_TTL) p = await prepareExport(spaceId);
  prepared.delete(spaceId);
  const { client, bundle, statuses } = p;

  const id = crypto.randomUUID();
  const now = Date.now();
  const sender = data().settings.userName || os.userInfo().username;
  const payload = {
    sender,
    space: { name: client.name, color: client.color, tools: client.tools.map((t) => ({ name: t.name, url: t.url, controlUrl: t.controlUrl || '' })) },
    statuses: statuses.map(({ name, status, detail }) => ({ name, status, detail })),
    cookies: bundle.cookies,
    localStorage: bundle.localStorage,
  };
  const file = await seal(payload, recipientShareId, { id, createdAt: now, expiresAt: now + ttlMs });
  logShare({ direction: 'export', space: client.name, peer: fingerprintOf(parseRecipient(recipientShareId).export({ type: 'spki', format: 'der' }).toString('base64')), packetId: id, tools: payload.statuses });
  return { file, packetId: id, expiresAt: now + ttlMs, statuses: payload.statuses, cookies: bundle.cookies.length, origins: Object.keys(bundle.localStorage).length };
}

/* ---------- Import ---------- */
function usedIds() {
  const now = Date.now();
  data().usedPackets = data().usedPackets.filter((u) => u.expiresAt > now - 24 * 3600 * 1000); // purge d'après l'expiration
  return new Set(data().usedPackets.map((u) => u.id));
}

// Lecture sans effet : ce que le destinataire voit avant de confirmer.
const knownSenders = () => (data().knownSenders ||= {});

async function previewPacket(fileBuf) {
  const { header, payload, signer } = await open(fileBuf);
  const known = knownSenders()[signer.fingerprint];
  return {
    signerFingerprint: signer.fingerprint, signerKnown: !!known, signerKnownAs: known?.name || null,
    packetId: header.id, expiresAt: header.expiresAt, expired: header.expiresAt <= Date.now(), alreadyUsed: usedIds().has(header.id),
    sender: payload.sender, space: payload.space.name, tools: payload.statuses, cookies: payload.cookies.length, origins: Object.keys(payload.localStorage).length,
  };
}

async function importPacket(fileBuf) {
  const { header, payload, signer } = await open(fileBuf);
  if (header.expiresAt <= Date.now()) throw new Error('Ce paquet a expiré');
  if (usedIds().has(header.id)) throw new Error('Ce paquet a déjà été importé (usage unique)');

  // Jamais d'écrasement : un espace du même nom reste intact, le nouveau reçoit un nom distinct.
  const names = new Set(data().clients.map((c) => c.name.toLowerCase()));
  let name = payload.space.name, n = 1;
  while (names.has(name.toLowerCase())) name = `${payload.space.name} (partagé${n > 1 ? ` ${n}` : ''})`, n++;

  const client = spaces.addClient({ name, color: payload.space.color });
  let warnings = [];
  try {
    for (const t of payload.space.tools) spaces.addTool(client.id, t);
    const { ses, ready } = sessions.getSession(client.id);
    await ready;
    warnings = await applyBundle(ses, payload);
  } catch (e) {
    await spaces.deleteClient(client.id).catch(() => {});
    throw e;
  }
  data().usedPackets.push({ id: header.id, expiresAt: header.expiresAt });
  knownSenders()[signer.fingerprint] ||= { name: payload.sender, firstSeen: Date.now() }; // mémorisé à la première réception confirmée
  state.store.save();

  const statuses = await checkSpacePortability(client.id);
  logShare({
    direction: 'import', space: name, peer: `${payload.sender} (${signer.fingerprint})`, packetId: header.id,
    tools: statuses.map(({ name: n2, status, detail }) => ({ name: n2, status, detail })),
  });
  const toConnect = statuses.filter((s) => s.status !== 'portable');
  if (toConnect.length) {
    await dialog.show({
      kind: 'confirm', title: `Client « ${name} » importé`,
      message: `À connecter vous-même (la session partagée ne suffit pas) :\n${toConnect.map((s) => `• ${s.name} — ${s.status === 'unverifiable' ? 'non vérifiable' : s.detail || 'non portable'}`).join('\n')}`,
      buttons: [{ id: 'ok', label: 'Compris', style: 'primary' }],
    });
  }
  return { spaceId: client.id, name, statuses, warnings };
}

function getLog() {
  return [...data().shareLog].reverse();
}

module.exports = {
  myShareId, previewExport, exportSpace, previewPacket, importPacket, checkSpacePortability, getLog,
  // exposés pour les tests
  seal, open, parseRecipient, fingerprintOf, collect, applyBundle, probeTool,
};
