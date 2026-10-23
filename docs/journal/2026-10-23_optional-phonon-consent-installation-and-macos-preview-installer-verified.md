# Optional Phonon consent installation and macOS preview installer verified

## Context and decision
The user chose Phonon 40M over the 31M comparison, retaining Easton and Zoey, and requested optional noncommercial narration setup alongside a macOS-first distributable. Work remains on `codex/desktop-text-to-speech` at base `c1628fd`; no commit or push was made. Keep original application code MIT. Phonon weights remain a separately downloaded CC BY-NC 4.0 component; no weights or access tokens are bundled.

## Completed changes
- `src/desktop/speech-install.ts` provides explicit versioned acceptance, persistent decline, bounded/cancellable background setup, a checksum-verified uv bootstrap, private Python environment, pinned speech packages/model/voices, provenance checks and retained notices. Runtime startup requires accepted/current consent and ready assets. `scripts/setup-speech.mjs` applies the same acceptance policy.
- Desktop IPC and `desktop/app.ts` expose first-run optional setup, model/license/access links, a one-time password token field, installation progress/cancel/retry, and a persistent setup entry. Skipping remains playable and is remembered. Credentials are not persisted by the app. HF model access approval remains required separately.
- Existing narration supports Easton/Zoey, saved mute/voice preferences, skip and historical replay; campaign setup remains silent.
- `scripts/package-desktop.mjs`, `electron-builder.config.cjs`, icon generation and packaged smoke scripts produce Apple silicon DMG/ZIP previews with bundled Node and production dependencies. Payload allowlists exclude engineering journals, credentials and campaign data. Third-party component inventory and full notices are retained.
- README and `docs/desktop.md` / `docs/architecture.md` document setup, packaging and boundaries. `THIRD_PARTY_NOTICES.md` and `licenses/phonon/` preserve component licensing.

## Verification actually run
- `TMPDIR=/private/tmp npm test`: 160/160 passed. Canonical macOS temporary paths avoid existing symlink-path fixture mismatches.
- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm run test:desktop`: 3/3 passed, covering campaign UI, narration, consent, skip/reload and modal layout. Root visually inspected the consent screenshot.
- `TMPDIR=/private/tmp npm run test:journal`: 1/1 passed with an isolated temporary daemon; the user's shared daemon was not stopped or reconfigured.
- A fresh private installation at `/tmp/dm-phonon-final.0tILOf` completed with the configured HF access; both Easton and Zoey produced valid WAV audio (169004 and 180524 bytes).
- Final packaged installer module, renderer JS/CSS/HTML, sidecar and Phonon notice were compared byte-for-byte with the working build and matched. Targeted formatting and `git diff --check` passed.
- An early desktop test accidentally used the default speech cache and created a declined decision. After confirming the exact timestamp and test provenance, only that test-created decision was removed; model assets were preserved. All Electron tests now set isolated speech homes.

## Limitations and next steps
This is an unsigned macOS arm64 preview. Public release requires Developer ID signing, notarization and clean-machine validation. Git and the chosen authenticated DM provider CLI remain separate prerequisites; the package bundles Node and optional speech setup handles Python. Intel macOS, Windows/Linux installers and automatic updates are not implemented. Final artifact integrity and packaged launch/skip smoke are being checked before handoff; see the final task report for their outcome. No actual campaign data or secrets were added to this repository.
