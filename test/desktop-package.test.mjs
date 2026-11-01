import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  APP_FILES,
  NODE_SHA256,
  NODE_VERSION,
  NODE_WIN_X64_SHA256,
  PLUGIN_DOCS,
} from '../scripts/package-desktop.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const builder = createRequire(import.meta.url)('../electron-builder.config.cjs');

test('macOS installer has a reproducible, pinned arm64 external Node runtime', () => {
  assert.equal(NODE_VERSION, '22.23.3');
  assert.match(NODE_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(builder.electronVersion, '45.0.0');
  assert.equal(builder.asar, false);
  assert.deepEqual(builder.mac.target, ['dmg', 'zip']);
  assert.equal(builder.mac.icon, 'build/dungeon-master.icns');
  assert.equal(builder.mac.identity, null);
  assert.ok(packageJson.scripts['desktop:dist'].includes('--arm64'));
  assert.ok(packageJson.scripts['desktop:dist'].includes('build-app-icon.mjs'));
  assert.match(
    packageJson.scripts['speech:setup'],
    /^npm run build && node scripts\/setup-speech\.mjs$/,
  );
});

test('Windows installer has a reproducible, pinned x64 external Node runtime', () => {
  assert.equal(NODE_VERSION, '22.23.3');
  assert.match(NODE_WIN_X64_SHA256, /^[a-f0-9]{64}$/);
  assert.deepEqual(builder.win.target, ['nsis', 'zip']);
  assert.equal(builder.win.icon, 'build/dungeon-master.ico');
  assert.equal(builder.win.signAndEditExecutable, false);
  assert.ok(packageJson.scripts['desktop:dist'].includes('--x64'));
  const nodeResource = builder.extraResources.find((item) => item.to === 'node');
  assert.ok(nodeResource?.filter.includes('bin/node.exe'));
});

test('packaged payload has runtime assets and excludes development journals and caches', () => {
  for (const required of ['dist', 'build/desktop', 'skills', 'rules', 'examples', 'package.json'])
    assert.ok(APP_FILES.includes(required), `missing packaged path: ${required}`);
  for (const forbidden of ['docs/journal', '.codex', '.journal-rag', 'test', 'src', 'node_modules'])
    assert.ok(!APP_FILES.includes(forbidden), `unexpected packaged path: ${forbidden}`);
  assert.ok(PLUGIN_DOCS.includes('docs/desktop.md'));
  assert.ok(!PLUGIN_DOCS.some((path) => path.includes('journal')));
  assert.ok(!PLUGIN_DOCS.includes('docs/text-to-speech-investigation.md'));
  assert.ok(packageJson.scripts['desktop:smoke']);
});
