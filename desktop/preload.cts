import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '#desktop/contracts';
function invoke<K extends keyof DesktopApi>(
  method: K,
  ...args: Parameters<DesktopApi[K]>
): ReturnType<DesktopApi[K]> {
  // Main validates each request and implements DesktopApi; keep the transport assertion here.
  return ipcRenderer.invoke('table:call', method, args) as ReturnType<DesktopApi[K]>;
}
const api: DesktopApi = {
  preferences: () => invoke('preferences'),
  localModels: (settings) => invoke('localModels', settings),
  configureLocal: (settings) => invoke('configureLocal', settings),
  selectProvider: (provider) => invoke('selectProvider', provider),
  detect: (path) => invoke('detect', path),
  chooseExecutable: () => invoke('chooseExecutable'),
  chooseParent: () => invoke('chooseParent'),
  chooseCampaign: () => invoke('chooseCampaign'),
  open: (root) => invoke('open', root),
  create: (input) => invoke('create', input),
  connect: (fresh) => invoke('connect', fresh),
  submit: (input) => invoke('submit', input),
  snapshot: () => invoke('snapshot'),
  map: (input) => invoke('map', input),
  stop: () => invoke('stop'),
  startLan: () => invoke('startLan'),
  stopLan: () => invoke('stopLan'),
  lanStatus: () => invoke('lanStatus'),
  lanAdmin: (input) => invoke('lanAdmin', input),
  joinLan: (link) => invoke('joinLan', link),
};
contextBridge.exposeInMainWorld('table', api);
