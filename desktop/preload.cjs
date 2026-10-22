const { contextBridge, ipcRenderer } = require('electron');
const methods = [
  'preferences',
  'detect',
  'chooseExecutable',
  'chooseParent',
  'chooseCampaign',
  'open',
  'create',
  'connect',
  'submit',
  'snapshot',
  'map',
  'stop',
];
contextBridge.exposeInMainWorld(
  'table',
  Object.fromEntries(
    methods.map((method) => [method, (...args) => ipcRenderer.invoke('table:call', method, args)]),
  ),
);
