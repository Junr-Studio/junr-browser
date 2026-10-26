'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('junrAdmin', {
  call: (name, args) => ipcRenderer.invoke('admin', name, args),
  onSection: (cb) => ipcRenderer.on('settings:section', (e, s) => cb(s)),
});
