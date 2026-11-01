# Windows Setup, Cross-Platform Fixes, and Windows x64 Desktop Release

## Context

This was the first time setting up, testing, and packaging Dungeon Master on Windows (`win32-x64`, Node `v24.22.1`, npm `11.19.1`). While the core TypeScript build and MCP/desktop architecture already anticipated Windows in several places (such as `desktop/main.mts` checking `process.platform === 'win32' ? 'node.exe' : 'node'`), running the full verification suite and building a desktop release on Windows uncovered platform-specific behavior in atomic directory syncs, relative path separators, line-ending normalization, unprivileged symlink creation in tests, child-process working directory locks during test teardown, and macOS-only assumptions in the desktop packaging scripts.

Project journal MCP tools were unavailable in this session; per `AGENTS.md`, `docs/journal/` was searched/read directly and this dated Markdown entry was created as the authoritative fallback.

## Decisions and Rationale

1. **Skip directory `fsync` on Windows in `atomicWrite` (`src/store.ts`)**:
   - Opening a directory handle with `'r'` and calling `dir.sync()` invokes `FlushFileBuffers`, which NTFS rejects with `EPERM` on read-only directory handles. Guarding the parent directory sync with `if (process.platform !== 'win32')` preserves POSIX directory entry durability while allowing atomic temp-file writes and renames to succeed on Windows.
2. **Normalize relative paths in `importGeneratedArt` (`src/desktop/art.ts`)**:
   - `path.relative()` returns backslash-separated paths on Windows, which `safePath()` rightly rejects as non-normalized relative paths. Converting `relative(...)` output with `.replaceAll('\\', '/')` before validation keeps campaign paths canonical (`/`-separated) across platforms.
3. **Normalize CRLF when hashing and parsing vendored SRD markdown (`scripts/build-rule-sections.mjs`)**:
   - On Windows Git checkouts with `core.autocrlf=true`, `rules/vendor/srd-5.2.1/*.md` files are checked out with `\r\n` line endings. Normalizing `\r\n` to `\n` in `hash()` and `convert()` ensures deterministic SHA-256 verification and identical rule section IDs/excerpts on both Windows and POSIX.
4. **Enforce LIFO cleanup order and retry temp directory removal in tests (`test/helpers.mjs`, `test/antigravity-events.test.mjs`)**:
   - `node:test` runs `t.after()` callbacks in registration (FIFO) order. Because `fixture(t)` registered `rm(parent, ...)` before callers registered `host.close()` / `session.close()`, Windows failed with `EBUSY` when attempting to delete temporary directories still held as `cwd` by active child processes—which in turn aborted subsequent `t.after()` hooks and left child processes hanging. Wrapping `t.after` in `fixture(t)` to run callbacks in LIFO order before `rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })` ensures all child processes close before directory removal.
5. **Use NTFS junctions for unprivileged Windows symlink tests (`test/codex.test.mjs`, `test/hotseat.test.mjs`, `test/maps.test.mjs`, `test/performance.test.mjs`, `test/referee.test.mjs`, `test/store.test.mjs`)**:
   - Creating file/directory symlinks on Windows requires Administrator or Developer Mode (`EPERM`), whereas NTFS directory junctions (`'junction'`) work without elevation and still satisfy `lstat().isSymbolicLink() === true` for symlink traversal security checks.
6. **Isolate `real-journal.mjs` named pipe on Windows (`test/integration/real-journal.mjs`)**:
   - On Windows, `journal-rag` derives its named pipe endpoint (`\\.\pipe\journal-rag-v1-<hash>`) from `os.homedir()` (`USERPROFILE`) rather than `TMPDIR`. Passing `USERPROFILE`, `HOME`, `TEMP`, and `TMP` pointed at the test's temporary `ipc` directory guarantees complete isolation from any existing user journal daemon.
7. **Add Windows x64 (`win32-x64`) desktop release packaging (`scripts/package-desktop.mjs`, `electron-builder.config.cjs`, `scripts/build-app-icon.mjs`, `scripts/smoke-packaged-desktop.mjs`, `desktop/main.mts`, `package.json`, `test/desktop-package.test.mjs`)**:
   - Pinned the official Node.js `v22.23.3` Windows x64 archive (`node-v22.23.3-win-x64.zip`, SHA-256 `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`) alongside the existing macOS arm64 runtime (`NODE_SHA256`), staging `bin/node.exe` and `LICENSE` into `build/desktop-node`.
   - Updated `scripts/build-app-icon.mjs` to generate `build/dungeon-master.png` and `build/dungeon-master.ico` (256x256 PNG-backed ICO) on all platforms while continuing to build `build/dungeon-master.icns` via `iconutil` on macOS.
   - Configured `electron-builder.config.cjs` with `win` targets (`['nsis', 'zip']`, `icon: 'build/dungeon-master.ico'`, `signAndEditExecutable: false`), and updated `desktop/main.mts` to set `DM_BUNDLED_SPEECH` only when `speech/speech-assets.json` is present in packaged resources (since the native `ptts` binary is currently macOS arm64 only).

## Completed Changes

- `src/store.ts`: Skipped parent directory `fsync` (`dir.sync()`) on `win32` in `atomicWrite`.
- `src/desktop/art.ts`: Normalized `relative(...)` path separators to `/` in `importGeneratedArt`.
- `scripts/build-rule-sections.mjs`: Normalized `\r\n` to `\n` in `hash()` and `convert()`.
- `desktop/main.mts`: Checked `existsSync(join(process.resourcesPath, 'speech', 'speech-assets.json'))` before setting `DM_BUNDLED_SPEECH` in packaged mode and before opening bundled speech license files.
- `scripts/build-app-icon.mjs`: Added cross-platform `build/dungeon-master.png` and `build/dungeon-master.ico` generation.
- `scripts/package-desktop.mjs`: Added `win32-x64` target support with pinned `NODE_WIN_X64_SHA256`, optional speech directory staging on non-macOS, and `--dist` invocation of `electron-builder` for the active platform.
- `electron-builder.config.cjs`: Added `win` target configuration (`nsis`, `zip`) and included `bin/node.exe` in `extraResources`.
- `scripts/smoke-packaged-desktop.mjs`: Added `win32` packaged layout and Electron launch verification.
- `package.json`: Updated `desktop:dist` to support both macOS (`--arm64`) and Windows (`--x64`).
- `test/helpers.mjs`, `test/antigravity-events.test.mjs`, `test/codex.test.mjs`, `test/desktop-package.test.mjs`, `test/hotseat.test.mjs`, `test/local.test.mjs`, `test/maps.test.mjs`, `test/model-catalog.test.mjs`, `test/performance.test.mjs`, `test/referee.test.mjs`, `test/speech-runtime.test.mjs`, `test/store.test.mjs`, `test/integration/real-journal.mjs`: Updated for cross-platform Windows compatibility and added Windows desktop packaging assertions.

## Verification Run

- `npm ci` & `npm run journal:setup`
- `npm run typecheck` (passed)
- `npm test` (199/199 tests passed)
- `npm run test:journal` (1/1 isolated journal daemon integration test passed)
- `npm run package:plugin` (produced `build/dungeon-master-plugin.tgz`)
- `npm run desktop:dist` (produced `release/win-unpacked/`, `release/Dungeon Master-0.6.0-x64.zip`, and `release/Dungeon Master-0.6.0-x64.exe`)
- `npm run desktop:smoke -- --launch` (verified bundled Node `v22.23.3` x64, `sharp`, disposable campaign creation, speech setup, and packaged Electron UI launch + IPC)

## Known Limitations and Next Steps

- Bundled offline Phonon narration (`gradium-ai/xn-ptts` v0.4.0) currently ships a native binary only for `darwin-arm64`; on Windows, packaged builds run with narration optional/unbundled so gameplay works immediately without requiring pre-bundled Phonon weights.
- Windows release artifacts are built unsigned (`signAndEditExecutable: false`) so builds succeed without code-signing certificates or Windows Developer Mode symlink privileges.
