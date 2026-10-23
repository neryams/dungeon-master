# Final macOS narration preview artifacts pass packaged launch and integrity checks

## Context
Final verification follow-up to `2026-10-23_optional-phonon-consent-installation-and-macos-preview-installer-verified.md`. This resolves that entry's pending packaged checks. Source remains uncommitted on `codex/desktop-text-to-speech`, base `c1628fd`.

## Completed verification
- Final `npm run desktop:dist` succeeded.
- `npm run desktop:smoke -- --launch` passed against the rebuilt app: bundled Node/native dependencies work, a synthetic campaign was created in an isolated temporary workspace, the Electron app rendered, the bundled worker answered IPC, and clicking Skip persisted declined state and closed the narration dialog.
- Both bundled Node and Electron are arm64. DMG `hdiutil verify` reports VALID; ZIP `unzip -t` passes. The package contains the app icon, notices, license inventory and Node runtime. No `.codex`, `.journal-rag`, or `docs/journal` is included.
- Root independently confirmed final packaged renderer, installer, speech sidecar and model notice match the working build.

## Artifacts
- `release/Dungeon Master-0.6.0-arm64.dmg`, approximately 249 MiB. SHA-256: `bfe0debb604556c3c0e73f56564768ee6c19390d5b9cd092b5a66fc42e3bfd46`.
- `release/Dungeon Master-0.6.0-arm64.zip`, approximately 243 MiB. SHA-256: `f24dfdecf1a543755a0cbb16b7b3301a87f1ca96e954a4406f033dd31bbc311e`.

## Limitations and next steps
Unsigned and unnotarized Apple silicon preview, not a signed public release. Signing/notarization and clean-machine distribution validation remain next release work. Git and an authenticated DM provider remain external prerequisites. Optional Phonon download still requires explicit CC BY-NC acceptance and approved Hugging Face access. No automatic publication, commit or push was performed.
