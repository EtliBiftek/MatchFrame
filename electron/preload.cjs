const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('matchframe', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  demo: {
    open: () => ipcRenderer.invoke('demo:open'),
    launch: (path) => ipcRenderer.invoke('demo:launch', path)
  },
  radar: {
    load: (mapName) => ipcRenderer.invoke('radar:load', mapName)
  },
  pov: {
    prepare: (mapName) => ipcRenderer.invoke('pov:prepare', mapName)
  },
  voice: {
    prepare: (path) => ipcRenderer.invoke('voice:prepare', path)
  },
  core: {
    status: () => ipcRenderer.invoke('core:status'),
    command: (command) => ipcRenderer.invoke('core:command', command),
    request: (action, payload = {}) => ipcRenderer.invoke('core:request', action, payload)
  }
});
