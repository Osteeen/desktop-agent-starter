import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('edge', {
  activated: () => ipcRenderer.invoke('edge:activated'),
});
