'use strict';
// chrome.desktopCapture et chrome.tabCapture : fournissent à l'extension un identifiant de flux à passer à
// navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' | 'tab', chromeMediaSourceId } } })
// dans l'une de ses pages (popup, document hors écran). tabCapture.capture (flux renvoyé directement) n'est pas possible
// à travers le pont : utiliser getMediaStreamId, seule voie des extensions MV3.
const model = require('./model');
const { chooseSource } = require('../../displaymedia');

let nextRequest = 1;
const open = new Set();

const desktopCapture = {
  ns: 'desktopCapture',
  permission: 'desktopCapture',
  events: [],
  methods: {
    // chooseDesktopMedia(sources, [targetTab], callback) : le rappel reçoit (streamId, options) — « $args » est la convention du shim.
    async chooseDesktopMedia(ctx, sources = []) {
      const kinds = [].concat(sources);
      const bad = kinds.filter((k) => !['screen', 'window', 'tab', 'audio'].includes(k));
      if (!kinds.length || bad.length) throw new Error('Invalid sources: ' + (bad.join(', ') || 'liste vide'));
      const types = kinds.filter((k) => k === 'screen' || k === 'window');
      const requestId = nextRequest++;
      open.add(requestId);
      const source = types.length ? await chooseSource(`${ctx.ext.name} souhaite partager votre écran`, { types }) : null;
      if (!open.delete(requestId)) return { $args: ['', {}] }; // annulée
      return { $args: [source ? source.id : '', { canRequestAudioTrack: process.platform === 'win32' && kinds.includes('audio') }] };
    },
    async cancelChooseDesktopMedia(ctx, requestId) { open.delete(requestId); },
  },
};

const tabCapture = {
  ns: 'tabCapture',
  permission: 'tabCapture',
  events: ['onStatusChanged'],
  methods: {
    // getMediaStreamId({ targetTabId?, consumerTabId? }) : identifiant valable pour la page « consommatrice » (par défaut la page appelante).
    async getMediaStreamId(ctx, o = {}) {
      const target = model.resolveTab(ctx, o.targetTabId);
      if (!target) throw new Error('Error getting media stream id: no such tab');
      const wc = target.view.webContents;
      if (!(ctx.has('activeTab') || ctx.hostAllowed(wc.getURL()))) throw new Error('Extension has not been invoked for the current page (see activeTab permission).');
      const consumerWc = o.consumerTabId !== undefined ? (model.tabByWcId(Number(o.consumerTabId))?.view.webContents) : ctx.conn.wc;
      if (!consumerWc) throw new Error('Un consumerTabId est requis depuis un service worker');
      return wc.getMediaSourceId(consumerWc);
    },
    async capture() { throw new Error('tabCapture.capture n\'est pas disponible : utilisez tabCapture.getMediaStreamId puis getUserMedia (Manifest V3)'); },
    async getCapturedTabs() { return []; },
    async captureOffscreenTab() { throw new Error('captureOffscreenTab n\'est pas pris en charge par Junr Browser'); },
  },
};

module.exports = [desktopCapture, tabCapture];
