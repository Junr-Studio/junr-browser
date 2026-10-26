'use strict';
// chrome.webNavigation : événements de navigation de chaque onglet, issus des événements des vues web d'Electron.
const { webFrameMain } = require('electron');
const { bus } = require('../../state');
const model = require('./model');

const isMain = (frame, wc) => !frame || frame === wc.mainFrame || !frame.parent;
const frameIdOf = (frame, wc) => (isMain(frame, wc) ? 0 : frame.frameTreeNodeId);
const parentIdOf = (frame, wc) => (isMain(frame, wc) ? -1 : (frame.parent === wc.mainFrame || !frame.parent.parent ? 0 : frame.parent.frameTreeNodeId));
const frameOf = (pid, rid) => { try { return webFrameMain.fromId(pid, rid) || null; } catch { return null; } };

function details(wc, frame, url, extra = {}) {
  return { tabId: wc.id, frameId: frameIdOf(frame, wc), parentFrameId: parentIdOf(frame, wc), url, processId: frame ? frame.processId : -1, timeStamp: Date.now(), ...extra };
}

function watch(tab, emit) {
  const wc = tab.view.webContents;
  const send = (name, d) => emit(`webNavigation.${name}`, [d], { spaceId: tab.spaceId });
  let lastUrl = '';
  let transition = 'link';
  wc.on('did-start-navigation', (e) => {
    const d = e.url !== undefined ? e : {};
    if (d.isSameDocument) return;
    if (!/^(https?|about|chrome-extension):/i.test(d.url || '')) return;
    send('onBeforeNavigate', details(wc, d.frame, d.url));
  });
  wc.on('did-frame-navigate', (e, url, code, text, main, pid, rid) => {
    const frame = frameOf(pid, rid);
    send('onCommitted', details(wc, frame, url, { transitionType: transition, transitionQualifiers: [] }));
    if (main) lastUrl = url;
    transition = 'link';
  });
  wc.on('did-navigate-in-page', (e, url, main, pid, rid) => {
    const frame = frameOf(pid, rid);
    let fragmentOnly = false;
    try { const a = new URL(lastUrl), b = new URL(url); fragmentOnly = a.href.split('#')[0] === b.href.split('#')[0]; } catch { /* URL non analysable */ }
    send(fragmentOnly ? 'onReferenceFragmentUpdated' : 'onHistoryStateUpdated', details(wc, frame, url, { transitionType: 'link', transitionQualifiers: [] }));
    if (main) lastUrl = url;
  });
  wc.on('dom-ready', () => send('onDOMContentLoaded', details(wc, wc.mainFrame, wc.getURL())));
  wc.on('did-frame-finish-load', (e, main, pid, rid) => {
    const frame = main ? wc.mainFrame : frameOf(pid, rid);
    send('onCompleted', details(wc, frame, frame ? frame.url : wc.getURL()));
  });
  wc.on('did-fail-load', (e, code, desc, url, main, pid, rid) => {
    if (code === -3) return; // annulation volontaire
    send('onErrorOccurred', details(wc, main ? wc.mainFrame : frameOf(pid, rid), url, { error: desc }));
  });
  wc.on('will-navigate', (e, url, inPlace, main) => { if (main && !inPlace) transition = 'link'; });
}

function frameInfo(wc, frame) {
  return { errorOccurred: false, url: frame.url, parentFrameId: parentIdOf(frame, wc), processId: frame.processId, documentLifecycle: 'active', frameType: isMain(frame, wc) ? 'outermost_frame' : 'sub_frame' };
}

module.exports = {
  ns: 'webNavigation',
  permission: 'webNavigation',
  events: ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated', 'onTabReplaced', 'onHistoryStateUpdated'],
  methods: {
    async getFrame(ctx, d = {}) {
      const tab = model.resolveTab(ctx, d.tabId);
      if (!tab || d.tabId === undefined) return null;
      const wc = tab.view.webContents;
      const frame = d.frameId === 0 ? wc.mainFrame : wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId === d.frameId);
      return frame ? frameInfo(wc, frame) : null;
    },
    async getAllFrames(ctx, d = {}) {
      const tab = d.tabId === undefined ? null : model.resolveTab(ctx, d.tabId);
      if (!tab) return null;
      const wc = tab.view.webContents;
      return wc.mainFrame.framesInSubtree.map((f) => ({ ...frameInfo(wc, f), frameId: frameIdOf(f, wc) }));
    },
  },
  install({ emit }) {
    bus.on('tab:created', (tab) => { if (!tab.internal && tab.view) watch(tab, emit); });
    bus.on('tab:opened', (source, created, url) => {
      if (!source.view || !created.view) return;
      emit('webNavigation.onCreatedNavigationTarget', [{ sourceTabId: source.view.webContents.id, sourceFrameId: 0, sourceProcessId: -1, url, tabId: created.view.webContents.id, timeStamp: Date.now() }], { spaceId: source.spaceId });
    });
  },
};
