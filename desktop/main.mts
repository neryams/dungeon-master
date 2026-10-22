import { Preferences, WorkerReply, dispatchDesktop } from '#desktop/contracts';
import type { DesktopApi, WorkerApi } from '#desktop/contracts';
import type { ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';

const root = fileURLToPath(new URL('../..', import.meta.url));
const index = join(root, 'build/desktop/index.html');
const indexUrl = pathToFileURL(index).href;
let window: BrowserWindow,
  worker: ChildProcess,
  quitting = false,
  counter = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
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
        // JSON IPC is portable across Electron's and the external Node worker's V8 versions.
        serialization: 'json',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      });
      worker.stderr?.on('data', () => {});
      worker.on('message', (raw: unknown) => {
        const parsed = WorkerReply.safeParse(raw);
        if (!parsed.success) return;
        const { id, result, error } = parsed.data;
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
      function call<K extends keyof WorkerApi>(
        method: K,
        ...args: Parameters<WorkerApi[K]>
      ): ReturnType<WorkerApi[K]> {
        // Replies cross a trusted worker boundary; request handlers are checked against WorkerApi.
        return new Promise<unknown>((resolve, reject) => {
          if (!worker.connected)
            return reject(new Error('The campaign runtime is unavailable. Restart the app.'));
          const id = ++counter;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('Request timed out. Check saved state before trying again.'));
          }, 660000);
          pending.set(id, { resolve, reject, timer });
          worker.send({ id, method, args });
        }) as ReturnType<WorkerApi[K]>;
      }
      const prefsPath = join(app.getPath('userData'), 'table-preferences.json');
      let prefs: Preferences = {};
      try {
        prefs = Preferences.parse(JSON.parse(await readFile(prefsPath, 'utf8')));
      } catch {}
      async function savePrefs() {
        await mkdir(app.getPath('userData'), { recursive: true });
        await writeFile(prefsPath + '.tmp', JSON.stringify(prefs), { mode: 0o600 });
        await rename(prefsPath + '.tmp', prefsPath);
      }
      const actions: DesktopApi = {
        preferences: async () => prefs,
        localModels: (settings) => call('localModels', settings),
        configureLocal: async (settings) => {
          await call('stop');
          prefs.local = settings;
          await savePrefs();
        },
        selectProvider: async (provider) => {
          await call('stop');
          prefs.provider = provider;
          await savePrefs();
        },
        detect: async (path) => {
          const provider = prefs.provider ?? 'antigravity';
          const found = await call(
            'detect',
            path ?? (provider !== 'antigravity' ? prefs.codexExecutable : prefs.executable),
            provider,
          );
          if (provider !== 'antigravity') prefs.codexExecutable = found.path;
          else prefs.executable = found.path;
          await savePrefs();
          return found;
        },
        chooseExecutable: async () => {
          const r = await dialog.showOpenDialog(window, {
            title:
              prefs.provider !== undefined && prefs.provider !== 'antigravity'
                ? 'Choose Codex CLI (codex)'
                : 'Choose Antigravity CLI (agy)',
            properties: ['openFile'],
          });
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        chooseParent: async () => {
          const r = await dialog.showOpenDialog(window, {
            title: 'Choose a home for your campaigns',
            properties: ['openDirectory', 'createDirectory'],
          });
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        chooseCampaign: async () => {
          const r = await dialog.showOpenDialog(window, {
            title: 'Open a campaign folder',
            properties: ['openDirectory'],
          });
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        open: async (path) => {
          const state = await call('open', path);
          if (state.campaign) prefs.recent = state.root;
          await savePrefs();
          return state;
        },
        create: async (input) => {
          const state = await call('create', input);
          if (state.campaign) prefs.recent = state.root;
          await savePrefs();
          return state;
        },
        connect: (fresh = false) =>
          call(
            'connect',
            (prefs.provider ?? 'antigravity') !== 'antigravity'
              ? prefs.codexExecutable
              : prefs.executable,
            fresh,
            prefs.provider ?? 'antigravity',
            prefs.local,
          ),
        submit: (input) => call('submit', input),
        snapshot: () => call('snapshot'),
        map: (input) => call('map', input),
        stop: () => call('stop'),
        startLan: () => call('startLan'),
        stopLan: () => call('stopLan'),
        lanStatus: () => call('lanStatus'),
        lanAdmin: (input) => call('lanAdmin', input),
        joinLan: async (link) => {
          const url = new URL(link);
          if (
            url.protocol !== 'http:' ||
            url.username ||
            url.password ||
            !url.port ||
            url.pathname !== '/' ||
            url.search ||
            !/^#[a-f0-9]{64}$/.test(url.hash)
          )
            throw new Error('Paste a complete LAN game link.');
          const player = new BrowserWindow({
            title: 'Dungeon Master — LAN player',
            width: 1100,
            height: 850,
            backgroundColor: '#151b18',
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
            },
          });
          player.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          player.webContents.on('will-navigate', (event) => event.preventDefault());
          player.webContents.on('will-attach-webview', (event) => event.preventDefault());
          await player.loadURL(url.href);
        },
      };
      ipcMain.handle('table:call', async (event, method: unknown, args: unknown) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== indexUrl
        )
          throw new Error('Untrusted window');
        return dispatchDesktop(actions, method, args);
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
          preload: join(root, 'build/desktop/preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.on('closed', () => app.quit());
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
