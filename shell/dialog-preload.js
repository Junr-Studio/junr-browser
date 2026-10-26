'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('junrDialog', {
  onShow: (cb) => ipcRenderer.on('dialog:show', (e, spec) => cb(spec)),
  answer: (result) => ipcRenderer.invoke('dialog:answer', result),
});
