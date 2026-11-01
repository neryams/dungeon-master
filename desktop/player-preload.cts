import { contextBridge, ipcRenderer } from 'electron';
import type { SpeechInputApi, SpeechSettingsState } from '#desktop/contracts';
const api: SpeechInputApi = {
  speechSettings: () => ipcRenderer.invoke('speech:input', 'speechSettings', []),
  transcribe: (input) => ipcRenderer.invoke('speech:input', 'transcribe', [input]),
  cancelTranscription: () => ipcRenderer.invoke('speech:input', 'cancelTranscription', []),
  setRecording: (active) => ipcRenderer.invoke('speech:input', 'setRecording', [active]),
  onSpeechChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SpeechSettingsState) =>
      callback(state);
    ipcRenderer.on('speech:settings', listener);
    return () => ipcRenderer.removeListener('speech:settings', listener);
  },
  onRecordingChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, active: boolean) => callback(active);
    ipcRenderer.on('speech:recording', listener);
    return () => ipcRenderer.removeListener('speech:recording', listener);
  },
};
contextBridge.exposeInMainWorld('speechInput', api);
