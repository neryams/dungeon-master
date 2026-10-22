import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const index = join(root, 'desktop/index.html');
const indexUrl = pathToFileURL(index).href;
let window,
  worker,
  quitting = false,
  counter = 0;
const pending = new Map();
const nodePath = process.env.DM_DESKTOP_NODE;
// XWayland works on desktops where Chromium's native Wayland startup stalls.
// A native Wayland session can opt in with DM_DESKTOP_OZONE=wayland.
if (process.platform === 'linux' && (process.env.DISPLAY || process.env.DM_DESKTOP_OZONE))
  app.commandLine.appendSwitch('ozone-platform', process.env.DM_DESKTOP_OZONE ?? 'x11');
if (!nodePath)
  throw new Error('Start the desktop with npm run desktop so its Node runtime is configured.');
app.setName('Dungeon Master');
app.setPath(
  'userData',
  process.env.DM_DESKTOP_USER_DATA ?? join(app.getPath('appData'), 'dungeon-master'),
);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      worker = fork(join(root, 'dist/desktop/worker.js'), [], {
        execPath: nodePath,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      });
      worker.stderr.on('data', () => {});
      worker.on('message', ({ id, result, error }) => {
        const call = pending.get(id);
        if (!call) return;
        pending.delete(id);
        clearTimeout(call.timer);
        error ? call.reject(new Error(error)) : call.resolve(result);
      });
      worker.on('exit', () => {
        for (const call of pending.values()) {
          clearTimeout(call.timer);
          call.reject(
            new Error(
              'The campaign process stopped. Reopen the app; saved actions will not be replayed.',
            ),
          );
        }
        pending.clear();
      });
      worker.on('error', () => {
        for (const call of pending.values())
          call.reject(new Error('Could not start the campaign runtime.'));
        pending.clear();
      });
      function call(method, ...args) {
        return new Promise((resolve, reject) => {
          if (!worker.connected)
            return reject(new Error('The campaign runtime is unavailable. Restart the app.'));
          const id = ++counter;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('Request timed out. Check saved state before trying again.'));
          }, 330000);
          pending.set(id, { resolve, reject, timer });
          worker.send({ id, method, args });
        });
      }
      const prefsPath = join(app.getPath('userData'), 'table-preferences.json');
      let prefs = {};
      try {
        prefs = JSON.parse(await readFile(prefsPath, 'utf8'));
      } catch {}
      async function savePrefs() {
        await mkdir(app.getPath('userData'), { recursive: true });
        await writeFile(prefsPath + '.tmp', JSON.stringify(prefs), { mode: 0o600 });
        await rename(prefsPath + '.tmp', prefsPath);
      }
      const actions = {
        preferences: async () => prefs,
        detect: async (path) => {
          const found = await call('detect', path);
          prefs.executable = found.path;
          await savePrefs();
          return found;
        },
        chooseExecutable: async () => {
          const r = await dialog.showOpenDialog(window, {
            title: 'Choose Antigravity CLI (agy)',
            properties: ['openFile'],
          });
          return r.canceled ? null : r.filePaths[0];
        },
        chooseParent: async () => {
          const r = await dialog.showOpenDialog(window, {
            title: 'Choose a home for your campaigns',
            properties: ['openDirectory', 'createDirectory'],
          });
          return r.canceled ? null : r.filePaths[0];
        },
        chooseCampaign: async () => {
          const r = await dialog.showOpenDialog(window, {
            title: 'Open a campaign folder',
            properties: ['openDirectory'],
          });
          return r.canceled ? null : r.filePaths[0];
        },
        open: async (path) => {
          const state = await call('open', path);
          prefs.recent = state.root;
          await savePrefs();
          return state;
        },
        create: async (input) => {
          const state = await call('create', input);
          prefs.recent = state.root;
          await savePrefs();
          return state;
        },
        connect: (fresh = false) => call('connect', prefs.executable, fresh),
        submit: (input) => call('submit', input),
        snapshot: () => call('snapshot'),
        map: (input) => call('map', input),
        stop: () => call('stop'),
      };
      ipcMain.handle('table:call', async (event, method, args) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== indexUrl
        )
          throw new Error('Untrusted window');
        if (!Object.hasOwn(actions, method) || !Array.isArray(args) || args.length > 2)
          throw new Error('Invalid desktop request');
        return actions[method](...args);
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      window = new BrowserWindow({
        title: 'Dungeon Master — The Table',
        width: 1440,
        height: 960,
        minWidth: 1000,
        minHeight: 720,
        backgroundColor: '#181f22',
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(root, 'desktop/preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      await window.loadFile(index);
      app.on('window-all-closed', () => app.quit());
      app.on('before-quit', (event) => {
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        if (!worker.connected) {
          app.quit();
          return;
        }
        // IPC disconnect asks the Node owner to stop its CLI tree and release the campaign lease.
        worker.disconnect();
        const timer = setTimeout(() => {
          worker.kill('SIGTERM');
          app.quit();
        }, 8000);
        worker.once('exit', () => {
          clearTimeout(timer);
          app.quit();
        });
      });
    })
    .catch((error) => {
      console.error('Desktop startup failed:', error.message);
      app.quit();
    });
}
