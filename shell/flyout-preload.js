'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('junrFlyout', {
  onState: (cb) => ipcRenderer.on('flyout:state', (e, p) => cb(p)),
  hover: (on) => ipcRenderer.invoke('flyout:hover', !!on),
  size: (h) => ipcRenderer.invoke('flyout:size', h),
  act: (name, ...args) => ipcRenderer.invoke('flyout:do', name, args),
});
