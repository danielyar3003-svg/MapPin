import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mappin', {
  pickGameFolder: () => ipcRenderer.invoke('pickGameFolder'),
  exists: (root: string, p: string) => ipcRenderer.invoke('exists', root, p),
  readFile: (root: string, p: string) => ipcRenderer.invoke('readFile', root, p),
  readRange: (root: string, p: string, offset: number, length: number) => ipcRenderer.invoke('readRange', root, p, offset, length),
  saveText: (name: string, text: string, filters: unknown) => ipcRenderer.invoke('saveText', name, text, filters),
  openText: (filters: unknown) => ipcRenderer.invoke('openText', filters),
  getSetting: (key: string) => ipcRenderer.invoke('getSetting', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('setSetting', key, value),
});
