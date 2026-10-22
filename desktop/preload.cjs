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
  'startLan',
  'stopLan',
  'lanStatus',
  'lanAdmin',
  'joinLan',
];
contextBridge.exposeInMainWorld(
  'table',
  Object.fromEntries(
    methods.map((method) => [method, (...args) => ipcRenderer.invoke('table:call', method, args)]),
  ),
);
