import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('perms', {
  status: () => ipcRenderer.invoke('permissions:status'),
  open: (pane: string) => ipcRenderer.invoke('permissions:open', pane),
  appInfo: () => ipcRenderer.invoke('app:info'),
});
