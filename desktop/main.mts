import { Preferences, WorkerReply, dispatchDesktop } from '#desktop/contracts';
import type { DesktopApi, WorkerApi } from '#desktop/contracts';
import type { ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, dialog, session, shell } from 'electron';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, delimiter } from 'node:path';
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
const nodePath = app.isPackaged
  ? join(process.resourcesPath, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
  : process.env.DM_DESKTOP_NODE;
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
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          DM_BUNDLED_SPEECH: app.isPackaged
            ? join(process.resourcesPath, 'speech')
            : process.env.DM_BUNDLED_SPEECH,
          PATH: [
            dirname(nodePath),
            process.env.PATH,
            ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []),
          ]
            .filter(Boolean)
            .join(delimiter),
        },
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
      const executable = (provider = prefs.provider ?? 'antigravity') =>
        provider === 'antigravity' ? prefs.executable : prefs.codexExecutable;
      async function checkModel(
        model: string | undefined,
        provider = prefs.provider ?? 'antigravity',
      ) {
        if (model === undefined && provider !== 'ollama') return;
        const catalog = await call('models', executable(provider), provider, prefs.local);
        if (!catalog.models.some((entry) => entry.id === model))
          throw new Error('That model is unavailable. Refresh the model list and choose another.');
      }
      function rememberModel(
        model: string | undefined,
        provider = prefs.provider ?? 'antigravity',
      ) {
        if (provider === 'ollama') {
          if (!prefs.local || !model) throw new Error('Configure a local model first.');
          prefs.local = { ...prefs.local, model };
        } else {
          prefs.models = { ...prefs.models, [provider]: model };
        }
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
        models: () => call('models', executable(), prefs.provider ?? 'antigravity', prefs.local),
        selectModel: async (model) => {
          const provider = prefs.provider ?? 'antigravity';
          const view = await call('snapshot');
          if (view.campaign && !['disconnected', 'attention'].includes(view.stage))
            throw new Error('Use DM model to change models in an active campaign.');
          await checkModel(model, provider);
          const latest = await call('snapshot');
          if (latest.campaign && !['disconnected', 'attention'].includes(latest.stage))
            throw new Error('Wait for the DM before changing models.');
          if ((prefs.provider ?? 'antigravity') !== provider)
            throw new Error('The provider changed. Choose its model again.');
          rememberModel(model, provider);
          await savePrefs();
        },
        switchModel: async (model) => {
          const provider = prefs.provider ?? 'antigravity';
          await checkModel(model, provider);
          if ((prefs.provider ?? 'antigravity') !== provider)
            throw new Error('The provider changed. Choose its model again.');
          const local =
            provider === 'ollama' && prefs.local && model ? { ...prefs.local, model } : prefs.local;
          try {
            await call('connect', executable(provider), true, provider, local, model);
          } catch (error) {
            const view = await call('snapshot');
            const attemptedModel = provider === 'ollama' ? local?.model : model;
            if (
              view.campaign &&
              view.stage === 'attention' &&
              view.provider === provider &&
              view.model === attemptedModel
            ) {
              rememberModel(model, provider);
              await savePrefs();
            }
            throw error;
          }
          rememberModel(model, provider);
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
        connect: async (fresh = false) => {
          const provider = prefs.provider ?? 'antigravity';
          const model = provider === 'ollama' ? undefined : prefs.models?.[provider];
          if (provider !== 'ollama') await checkModel(model, provider);
          if (
            (prefs.provider ?? 'antigravity') !== provider ||
            (provider !== 'ollama' && prefs.models?.[provider] !== model)
          )
            throw new Error('The provider or model changed. Connect again with your selection.');
          return call('connect', executable(provider), fresh, provider, prefs.local, model);
        },
        submit: (input) => call('submit', input),
        beginSetup: () => call('beginSetup'),
        snapshot: () => call('snapshot'),
        map: (input) => call('map', input),
        speech: (input) => call('speech', input),
        speechStatus: () => call('speechStatus'),
        cancelSpeech: () => call('cancelSpeech'),
        speechSetupStatus: () => call('speechSetupStatus'),
        installSpeech: (input) => call('installSpeech', input),
        declineSpeech: () => call('declineSpeech'),
        cancelSpeechInstall: () => call('cancelSpeechInstall'),
        openSpeechLink: async (link) => {
          if (link === 'license' && app.isPackaged) {
            const error = await shell.openPath(
              join(process.resourcesPath, 'speech', 'licenses', 'CC-BY-NC-4.0.txt'),
            );
            if (error) throw new Error('Could not open the included narration license.');
            return;
          }
          const urls = {
            license: 'https://creativecommons.org/licenses/by-nc/4.0/',
            model: 'https://huggingface.co/gradium/phonon-40m-en',
            token: 'https://huggingface.co/settings/tokens',
          };
          await shell.openExternal(urls[link]);
        },
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
          autoplayPolicy: 'no-user-gesture-required',
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
