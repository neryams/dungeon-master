# macOS arm64 Electron DMG and ZIP packaging implemented and smoke tested

## Context
The desktop previously launched from the repository with a developer-installed Node runtime. This milestone prepares a local unsigned macOS Apple-silicon app with an external Node child runtime, while preserving the source-relative app root and campaign files outside the app.

## Decisions and rationale
- Used electron-builder 26.4.0 with an explicit macOS arm64 target producing DMG and ZIP.
- Kept the Electron app payload unpacked at `Contents/Resources/app`; the existing `import.meta.url` paths then resolve to its root for renderer assets, compiled worker, campaign CLI, rule data, skills and dependencies.
- Bundled official Node.js 22.23.3 for darwin-arm64 after SHA-256 verification (`72d5d8832b41c9d9646197af614ffd751406ea4d215060eb91b98864e1919a3e` for the official `.tar.xz`); shipped it at `Contents/Resources/node/bin/node`.
- Staged an allowlist of runtime files, user-facing plugin docs and licenses, omitting development journals, tests, source trees, caches and model weights. Production package metadata is inventoried as `THIRD_PARTY_PACKAGES.json`.
- Kept package unsigned with no notarization credentials; no publish or commit was performed.

## Completed changes
- Added the electron-builder configuration, `desktop:dist`, `desktop:smoke`, and `test:desktop-package` scripts, package staging/runtime downloader, and packaged smoke harness.
- Added `release/` to `.gitignore`.
- Smoke harness creates a synthetic campaign using the bundled Node and `DesktopHost` in a temporary directory, then launches the packaged app via Playwright with separate temporary user-data and speech-cache paths and confirms its initial worker IPC snapshot.

## Verification actually run
- `node --check` passed for the packaging script, smoke script and builder config.
- `node --test test/desktop-package.test.mjs`: 2 passed.
- `npm run test:desktop-package`: build and 2 packaging tests passed.
- `npm run desktop:dist`: completed on macOS arm64. Produced `release/Dungeon Master-0.6.0-arm64.dmg` (144 MB) and `release/Dungeon Master-0.6.0-arm64.zip` (32 MB); staged app tree was approximately 731 MB before compression.
- `node scripts/smoke-packaged-desktop.mjs 'release/mac-arm64/Dungeon Master.app' --launch`: passed; a synthetic campaign reached revision 1 in setup mode, packaged UI rendered, and the packaged Node worker answered IPC.

## Limitations
- The build is unsigned and unnotarized and may require macOS user approval on first launch; it is not ready for public release without signing/notarization.
- electron-builder used its default Electron icon because the repository has no app icon asset.
- The desktop still relies on an installed/sign-in-ready Codex or Antigravity CLI for hosted play and on system Git for campaign initialization. Narration remains optional and model assets are not bundled.
- This first target is macOS arm64 only.

## Next steps
- Decide whether to add an app icon matching the existing desktop sigil.
- Run final packaging and smoke again after remaining concurrent speech/UI changes settle.
- Document direct installation and external CLI/Git prerequisites in user-facing desktop docs; consider a separate signed/notarized release workflow later.