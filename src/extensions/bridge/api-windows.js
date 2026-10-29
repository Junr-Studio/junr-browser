'use strict';
// chrome.windows : Junr Browser n'a qu'une fenêtre (identifiant 0, comme dans tabs.query natif d'Electron).
const { state, bus, HOME_URL } = require('../../state');
const model = require('./model');

const isCurrent = (id) => id === undefined || id === null || id === model.WINDOW_ID || id === -2;
function need(id) {
  if (!isCurrent(id)) throw new Error(`No window with id: ${id}.`);
}

module.exports = {
  ns: 'windows',
  permission: null,
  constants: { WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2 },
  events: ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'],
  methods: {
    async get(ctx, id, opts) { need(id); return model.windowInfo(ctx, opts && opts.populate); },
    async getCurrent(ctx, opts) { return model.windowInfo(ctx, opts && opts.populate); },
    async getLastFocused(ctx, opts) { return model.windowInfo(ctx, opts && opts.populate); },
    async getAll(ctx, opts) { return [model.windowInfo(ctx, opts && opts.populate)]; },
    // Une « nouvelle fenêtre » ouvre ses adresses dans de nouveaux onglets du client : il n'y a qu'une fenêtre.
    async create(ctx, data = {}) {
      const urls = [].concat(data.url || []);
      if (!urls.length) urls.push(HOME_URL);
      let first = true;
      for (const url of urls) { await model.createTab(ctx, { url, active: first && data.focused !== false }); first = false; }
      return model.windowInfo(ctx, true);
    },
    async update(ctx, id, info = {}) {
      need(id);
      const w = state.win;
      if (info.focused) w.focus();
      if (info.state === 'maximized') w.maximize();
      else if (info.state === 'minimized') w.minimize();
      else if (info.state === 'fullscreen') w.setFullScreen(true);
      else if (info.state === 'normal') { w.setFullScreen(false); w.unmaximize(); w.restore(); }
      const b = w.getBounds();
      if (['left', 'top', 'width', 'height'].some((k) => info[k] !== undefined)) {
        w.setBounds({ x: info.left ?? b.x, y: info.top ?? b.y, width: info.width ?? b.width, height: info.height ?? b.height });
      }
      return model.windowInfo(ctx, false);
    },
    async remove(ctx, id) { need(id); throw new Error('La fenêtre principale de Junr Browser ne peut pas être fermée par une extension'); },
  },
  install({ emit }) {
    bus.on('window:focus', () => emit('windows.onFocusChanged', [model.WINDOW_ID]));
    bus.on('window:blur', () => emit('windows.onFocusChanged', [-1]));
    bus.on('window:bounds', () => emit('windows.onBoundsChanged', (ctx) => [model.windowInfo(ctx, false)]));
  },
};
