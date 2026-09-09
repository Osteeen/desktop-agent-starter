import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('overlay', {
  setInteractive: (on: boolean) => ipcRenderer.invoke('overlay:set-interactive', !!on),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  appInfo: () => ipcRenderer.invoke('app:info'),
});
