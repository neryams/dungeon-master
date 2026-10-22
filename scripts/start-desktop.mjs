import { spawn } from 'node:child_process';
import electron from 'electron';
const args =
  process.platform === 'linux' && (process.env.DISPLAY || process.env.DM_DESKTOP_OZONE)
    ? [`--ozone-platform=${process.env.DM_DESKTOP_OZONE ?? 'x11'}`]
    : [];
const child = spawn(electron, [...args, 'desktop/main.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, DM_DESKTOP_NODE: process.execPath },
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
