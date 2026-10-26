'use strict';
// chrome.management : liste et pilote les extensions installées. getSelf est libre ; le reste exige « management ».
const { bus } = require('../../state');

function info(id) {
  const manager = require('../manager');
  const bridge = require('./index');
  const m = bridge.manifestOf(id);
  if (!m) return null;
  const rec = manager.records()[id];
  const mf = m.manifest;
  const perms = (mf.permissions || []).filter((p) => !/^(\*|https?|wss?|ftp|file):\/\/|^<all_urls>$/.test(p));
  const hosts = [...(mf.host_permissions || []), ...(mf.permissions || []).filter((p) => /^(\*|https?|wss?|ftp|file):\/\/|^<all_urls>$/.test(p))];
  const icons = Object.entries(mf.icons || {}).map(([size, p]) => ({ size: Number(size), url: `chrome-extension://${id}/${String(p).replace(/^\//, '')}` }));
  const options = mf.options_page || mf.options_ui?.page;
  return {
    id, name: m.name, shortName: m.name, description: mf.description || '', version: m.version, versionName: mf.version_name,
    mayDisable: !m.bundled, enabled: rec ? !!rec.enabled : true, isApp: false, type: 'extension', appLaunchUrl: undefined,
    homepageUrl: mf.homepage_url || '', updateUrl: rec?.source === 'webstore' ? 'https://clients2.google.com/service/update2/crx' : '',
    offlineEnabled: !!mf.offline_enabled, optionsUrl: options ? `chrome-extension://${id}/${String(options).replace(/^\//, '')}` : '',
    permissions: perms, hostPermissions: hosts, icons, installType: m.bundled ? 'development' : rec?.source === 'webstore' ? 'normal' : 'development',
    launchType: undefined, disabledReason: rec && !rec.enabled ? 'unknown' : undefined,
  };
}

function allIds() {
  const manager = require('../manager');
  return [...manager.bundledExtensions().map((b) => b.id), ...Object.keys(manager.records())];
}

const clean = (o) => JSON.parse(JSON.stringify(o));

module.exports = {
  ns: 'management',
  permission: (method) => (method === 'getSelf' || method === 'uninstallSelf' || method === 'getPermissionWarningsByManifest' ? null : 'management'),
  events: ['onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled'],
  methods: {
    async getAll() { return allIds().map((id) => clean(info(id))); },
    async get(ctx, id) { const i = info(id); if (!i) throw new Error(`Failed to find extension with id ${id}`); return clean(i); },
    async getSelf(ctx) { return clean(info(ctx.extId)); },
    async getPermissionWarningsById() { return []; },
    async getPermissionWarningsByManifest() { return []; },
    async setEnabled(ctx, id, enabled) {
      const manager = require('../manager');
      if (!manager.records()[id]) throw new Error('Cannot enable or disable this extension');
      await manager.setEnabled(id, !!enabled);
    },
    async uninstall(ctx, id) {
      const manager = require('../manager');
      if (!manager.records()[id]) throw new Error('Cannot uninstall this extension');
      await manager.uninstall(id);
    },
    async uninstallSelf(ctx) { await require('../manager').uninstall(ctx.extId); },
    async launchApp() { throw new Error('Les applications ne sont pas prises en charge'); },
    async createAppShortcut() {},
    async setLaunchType() {},
    async generateAppForLink() { throw new Error('Non pris en charge'); },
  },
  install({ emit }) {
    const send = (name) => (extId) => { const i = info(extId); if (i) emit(`management.${name}`, [clean(i)]); };
    bus.on('ext:installed', send('onInstalled'));
    bus.on('ext:enabled', send('onEnabled'));
    bus.on('ext:disabled', send('onDisabled'));
    bus.on('ext:uninstalled', (extId) => emit('management.onUninstalled', [extId]));
  },
};
