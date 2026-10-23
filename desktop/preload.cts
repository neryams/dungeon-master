import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, DesktopEvent } from '#desktop/contracts';
function invoke<K extends keyof Omit<DesktopApi, 'onUpdate'>>(
  method: K,
  ...args: Parameters<DesktopApi[K]>
): ReturnType<DesktopApi[K]> {
  // Main validates each request and implements DesktopApi; keep the transport assertion here.
  return ipcRenderer.invoke('table:call', method, args) as ReturnType<DesktopApi[K]>;
}
const api: DesktopApi = {
  onUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, update: DesktopEvent) => callback(update);
    ipcRenderer.on('table:update', listener);
    return () => ipcRenderer.removeListener('table:update', listener);
  },
  preferences: () => invoke('preferences'),
  localModels: (settings) => invoke('localModels', settings),
  configureLocal: (settings) => invoke('configureLocal', settings),
  selectProvider: (provider) => invoke('selectProvider', provider),
  detect: (path) => invoke('detect', path),
  models: () => invoke('models'),
  selectModel: (model) => invoke('selectModel', model),
  switchModel: (model) => invoke('switchModel', model),
  chooseExecutable: () => invoke('chooseExecutable'),
  chooseParent: () => invoke('chooseParent'),
  chooseCampaign: () => invoke('chooseCampaign'),
  open: (root) => invoke('open', root),
  create: (input) => invoke('create', input),
  connect: (fresh) => invoke('connect', fresh),
  submit: (input) => invoke('submit', input),
  beginSetup: () => invoke('beginSetup'),
  snapshot: () => invoke('snapshot'),
  map: (input) => invoke('map', input),
  speech: (input) => invoke('speech', input),
  speechStatus: () => invoke('speechStatus'),
  cancelSpeech: () => invoke('cancelSpeech'),
  speechSetupStatus: () => invoke('speechSetupStatus'),
  installSpeech: (input) => invoke('installSpeech', input),
  declineSpeech: () => invoke('declineSpeech'),
  cancelSpeechInstall: () => invoke('cancelSpeechInstall'),
  openSpeechLink: (link) => invoke('openSpeechLink', link),
  stop: () => invoke('stop'),
  startLan: () => invoke('startLan'),
  stopLan: () => invoke('stopLan'),
  lanStatus: () => invoke('lanStatus'),
  lanAdmin: (input) => invoke('lanAdmin', input),
  joinLan: (link) => invoke('joinLan', link),
};
contextBridge.exposeInMainWorld('table', api);
