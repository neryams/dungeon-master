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
  submitRoll: (input) => invoke('submitRoll', input),
  beginSetup: () => invoke('beginSetup'),
  snapshot: () => invoke('snapshot'),
  map: (input) => invoke('map', input),
  speech: (input) => invoke('speech', input),
  cancelSpeech: () => invoke('cancelSpeech'),
  speechSettings: () => invoke('speechSettings'),
  saveSpeechKey: (input) => invoke('saveSpeechKey', input),
  removeSpeechKey: () => invoke('removeSpeechKey'),
  previewSpeech: (input) => invoke('previewSpeech', input),
  transcribe: (input) => invoke('transcribe', input),
  cancelTranscription: () => invoke('cancelTranscription'),
  setRecording: (active) => invoke('setRecording', active),
  onSpeechChange: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: import('#desktop/contracts').SpeechSettingsState,
    ) => callback(state);
    ipcRenderer.on('speech:settings', listener);
    return () => ipcRenderer.removeListener('speech:settings', listener);
  },
  onRecordingChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, active: boolean) => callback(active);
    ipcRenderer.on('speech:recording', listener);
    return () => ipcRenderer.removeListener('speech:recording', listener);
  },
  openSpeechLink: (link) => invoke('openSpeechLink', link),
  stop: () => invoke('stop'),
  startLan: () => invoke('startLan'),
  stopLan: () => invoke('stopLan'),
  lanStatus: () => invoke('lanStatus'),
  lanAdmin: (input) => invoke('lanAdmin', input),
  joinLan: (link) => invoke('joinLan', link),
};
contextBridge.exposeInMainWorld('table', api);
