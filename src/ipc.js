'use strict';
// Canaux IPC. Chaque canal vérifie l'émetteur : l'interface du navigateur ne répond qu'à la vue `shell`,
// l'API d'administration ne répond qu'aux pages internes (jamais à un site web).
const fs = require('node:fs');
const { app, ipcMain, dialog: nativeDialog } = require('electron');
const secrets = require('./secrets');
const { state } = require('./state');
const tabs = require('./tabs');
const spaces = require('./spaces');
const permissions = require('./permissions');
const native = require('./native');
const share = require('./share');
const carnet = require('./carnet');
const dialog = require('./dialog');
const groupui = require('./groupui');
const flyout = require('./flyout');
const relay = require('./relay');
const servers = require('./servers');
const extManager = require('./extensions/manager');
const popup = require('./extensions/popup');

const fromShell = (e) => !!state.shell && e.sender === state.shell.webContents;
const fromInternal = (e) => state.internalViews.has(e.sender.id);

function shellHandle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromShell(e)) throw new Error('Appel refusé');
    return fn(...args);
  });
}

const fmtDate = (t) => new Date(t).toLocaleString('fr-FR');

// Table des appels d'administration, appelés depuis la page Réglages.
const admin = {
  'all': async () => ({
    clients: state.store.data.clients,
    globalTools: state.store.data.globalTools,
    settings: state.store.data.settings,
    activeSpace: state.activeSpace,
  }),
  'downloads.list': () => require('./extensions/bridge/api-downloads').list().slice(0, 100),
  'downloads.open': (a) => require('./extensions/bridge/api-downloads').open(Number(a.id)),
  'downloads.show': (a) => require('./extensions/bridge/api-downloads').show(Number(a.id)),
  'history.stats': () => require('./extensions/bridge/api-history').stats(),
  'history.clear': (a) => { const h = require('./extensions/bridge/api-history'); if (a.spaceId) h.clearSpace(a.spaceId); else h.clearAll(); },
  'bridge.coverage': () => {
    const b = require('./extensions/bridge');
    const spec = b.spec();
    const inert = ['bookmarks', 'browsingData', 'commands', 'contentSettings', 'contextMenus', 'cookies', 'declarativeContent', 'downloads', 'fontSettings', 'history', 'identity', 'management', 'notifications', 'omnibox', 'privacy', 'readingList', 'search', 'sessions', 'sidePanel', 'tabGroups', 'topSites', 'tts', 'webNavigation', 'windows'].filter((n) => !spec.ns[n]);
    return { enabled: !!state.store.data.settings.extensionShims, bridged: Object.keys(spec.ns), unsupported: spec.unsupported, inert };
  },
  'about': async () => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, userData: app.getPath('userData'), secrets: await secrets.available() }),
  'client.add': (a) => spaces.addClient(a),
  'client.rename': (a) => spaces.renameClient(a.id, a.name, a.color, a.critical),
  'client.delete': (a) => spaces.deleteClient(a.id),
  'client.move': (a) => spaces.moveClient(a.id, a.delta),
  'tool.add': (a) => spaces.addTool(a.spaceId, a.tool),
  'tool.update': (a) => spaces.updateTool(a.spaceId, a.toolId, a.tool),
  'tool.delete': (a) => spaces.deleteTool(a.spaceId, a.toolId),
  'carnet.get': () => state.store.data.clients.map((c) => ({ id: c.id, name: c.name, color: c.color, carnet: carnet.get(c.id) })),
  'carnet.deleteNote': (a) => { carnet.deleteNote(a.spaceId, a.id); tabs.push(); },
  'carnet.clear': (a) => { carnet.clear(a.spaceId); tabs.push(); },
  'carnet.openLink': async (a) => {
    if (!/^https?:/i.test(String(a.url))) throw new Error('Adresse invalide');
    const t = tabs.addTab({ spaceId: a.spaceId, url: String(a.url) });
    await tabs.activateTab(t.id);
  },
  'usage.clear': () => { state.store.data.usage = {}; state.store.save(); },
  'settings.set': (a) => spaces.setSettings(a),

  'ext.list': () => extManager.list(),
  'ext.install': (a) => extManager.install(a.input),
  'ext.setEnabled': (a) => extManager.setEnabled(a.id, a.enabled),
  'ext.uninstall': (a) => extManager.uninstall(a.id),
  'ext.checkUpdates': async () => ({ updated: await extManager.checkUpdates() }),

  'perm.list': () => permissions.list(),
  'perm.set': (a) => permissions.set(a.spaceId, a.origin, a.permission, a.decision),
  'perm.remove': (a) => permissions.remove(a.spaceId, a.origin, a.permission),

  'native.get': () => native.getConfig(),
  'native.setBlocking': (a) => native.setBlocking(a),
  'native.saveInjection': (a) => native.saveInjection(a),
  'native.deleteInjection': (a) => native.deleteInjection(a.id),
  'pw.list': () => native.listPasswords(),
  'pw.save': (a) => native.savePassword(a),
  'pw.delete': (a) => native.deletePassword(a.id),

  'servers.config': () => servers.config(),
  'servers.setSecret': (a) => servers.setSecret(String(a.provider), String(a.key), a.value === null ? null : String(a.value ?? '')),
  'servers.setHidden': (a) => servers.setHidden(String(a.key), !!a.hidden),
  'servers.refresh': () => servers.refresh(),

  'share.me': () => share.myShareId(),
  'share.preview': (a) => share.previewExport(a.spaceId),
  'share.check': (a) => share.checkSpacePortability(a.spaceId),
  'share.log': () => share.getLog(),
  'share.export': async (a) => {
    const out = await share.exportSpace(a.spaceId, a.recipient, { ttlMs: a.ttlHours ? a.ttlHours * 3600 * 1000 : undefined });
    const client = state.store.data.clients.find((c) => c.id === a.spaceId);
    const pick = await nativeDialog.showSaveDialog(state.win, {
      title: 'Enregistrer le paquet de partage', defaultPath: `${client.name}.junrshare`, filters: [{ name: 'Paquet Junr', extensions: ['junrshare'] }],
    });
    if (pick.canceled || !pick.filePath) return { saved: false, ...summary(out) };
    fs.writeFileSync(pick.filePath, out.file);
    return { saved: true, path: pick.filePath, ...summary(out) };
  },
  'share.import': async () => {
    const pick = await nativeDialog.showOpenDialog(state.win, { title: 'Importer un paquet de partage', filters: [{ name: 'Paquet Junr', extensions: ['junrshare'] }], properties: ['openFile'] });
    if (pick.canceled || !pick.filePaths[0]) return { imported: false };
    return confirmAndImport(fs.readFileSync(pick.filePaths[0]));
  },
  'update.get': () => require('./updater').publicState(),
  'update.check': async () => { await require('./updater').check({ manual: true }); return require('./updater').publicState(); },
  'update.install': () => require('./updater').install(),
  'update.channel': (a) => require('./updater').setChannel(String(a.channel)),
  'relay.get': () => relay.publicConfig(),
  'relay.set': (a) => relay.setConfig(a),
  'share.exportRelay': async (a) => {
    const out = await share.exportSpace(a.spaceId, a.recipient, { ttlMs: a.ttlHours ? a.ttlHours * 3600 * 1000 : undefined });
    const code = await relay.upload(out.file, out.packetId);
    return { code, ...summary(out) };
  },
  'share.importRelay': async (a) => {
    const me = await share.myShareId();
    return confirmAndImport(await relay.download(a.code, me.fingerprint));
  },
  'share.revokeRelay': (a) => relay.revoke(a.code),
};

// Aperçu sans effet, confirmation explicite (expéditeur annoncé, empreinte, nouveauté), puis import.
async function confirmAndImport(buf) {
  const info = await share.previewPacket(buf);
  if (info.expired) throw new Error('Ce paquet a expiré');
  if (info.alreadyUsed) throw new Error('Ce paquet a déjà été importé (usage unique)');
  const who = info.signerKnown ? `Expéditeur déjà reçu sous le nom « ${info.signerKnownAs} ».` : 'Première réception de cet expéditeur : vérifiez son empreinte auprès de lui.';
  const answer = await dialog.show({
    kind: 'confirm', title: `Importer le client « ${info.space} » ?`,
    message: `Envoyé par : ${info.sender} — empreinte ${info.signerFingerprint}\n${who}\nExpire : ${fmtDate(info.expiresAt)}\nContenu : ${info.cookies} cookies, ${info.origins} origine(s) de stockage local\n\n`
      + 'Ce paquet donne accès aux comptes de l\'expéditeur sur ces outils. N\'importez que ce que vous attendez.',
    buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'import', label: 'Importer', style: 'primary' }],
  });
  if (answer !== 'import') return { imported: false };
  return { imported: true, ...(await share.importPacket(buf)) };
}

const summary = (o) => ({ statuses: o.statuses, expiresAt: o.expiresAt, cookies: o.cookies, origins: o.origins });

function register() {
  flyout.register();
  require('./extensions/webstore').register({ install: (id) => extManager.install(id), notify: (text, ms) => tabs.notify(text, ms) });
  shellHandle('switch-space', (id) => tabs.switchSpace(id));
  shellHandle('select-tab', (id) => tabs.activateTab(id));
  shellHandle('close-tab', (id) => tabs.closeTab(id));
  shellHandle('new-tab', () => tabs.newTab());
  shellHandle('navigate', (input) => tabs.navigate(String(input)));
  shellHandle('get-state', () => tabs.barSnapshot());
  shellHandle('open-settings', (section) => tabs.openInternal('settings', section));
  shellHandle('address-input', (text) => require('./extensions/bridge/api-omnibox').typing(state.activeSpace, String(text)));
  shellHandle('pick-space', () => tabs.pickSpace());
  shellHandle('ext-action', (id, x) => require('./extensions/actions').click(String(id), undefined, Number(x) || 0));
  shellHandle('ext-context', (id, x, y) => require('./extensions/actions').contextMenu(String(id), Number(x) || 0, Number(y) || 0));
  shellHandle('resume-open', (id) => tabs.resumeOpen(Number(id)));
  shellHandle('edit-next', () => tabs.editNext());
  shellHandle('toggle-vitrine', () => tabs.toggleVitrine());
  shellHandle('previous-space', () => tabs.goPrevious());
  shellHandle('next-signal', () => tabs.goNextSignal());
  shellHandle('ack-tab', (id) => tabs.ackTab(Number(id)));
  shellHandle('fill-password', () => tabs.fillPassword());
  shellHandle('select-group', (spaceId, groupId) => tabs.selectGroup(String(spaceId), groupId ? String(groupId) : null));
  shellHandle('create-group', (spaceId) => groupui.create(String(spaceId)));
  shellHandle('assign-tab', (tabId, groupId) => groupui.assign(Number(tabId), groupId ? String(groupId) : null));
  shellHandle('group-menu', (spaceId, groupId) => groupui.groupMenu(String(spaceId), String(groupId)));
  shellHandle('tab-menu', (tabId) => groupui.tabMenu(Number(tabId)));

  ipcMain.handle('admin', async (e, name, args) => {
    if (!fromInternal(e)) throw new Error('Appel refusé');
    const fn = admin[name];
    if (!fn) throw new Error(`Appel inconnu : ${name}`);
    return fn(args ?? {});
  });
}

module.exports = { register, admin };
