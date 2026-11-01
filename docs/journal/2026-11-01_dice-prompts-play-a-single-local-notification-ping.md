# Dice prompts play a single local notification ping

## Context and decision

User requested an audible system-style ping when a dice prompt appears. Implemented a short, quiet local Web Audio sine cue shared by Electron hotseat and LAN browsers. Sound is independent of narration preferences. No new audio assets, network calls, IPC commands or gameplay events are needed.

## Completed changes

- Added `desktop/dice-prompt-sound.ts`: tracks campaign/prompt IDs so snapshots, temporary disappearance and recovery do not repeat the ping. Plays a 220ms tone with a short attack/decay and disconnects completed audio nodes. Unsupported/blocked audio cannot fail a dice prompt.
- `desktop/app.ts` and `desktop/lan.ts` observe the actually displayed prompt. The LAN host has no actionable prompt and does not ping for another player's prompt. Pointer and keyboard interactions unlock audio according to browser autoplay rules; blocked cues are never queued for later playback.
- Added the module to `tsconfig.ui.json` and the fixed LAN asset allowlist in `src/desktop/lan.ts`.
- Updated `docs/desktop.md` and added `test/dice-prompt-sound.test.mjs` covering once-per-prompt playback, campaign identity, browser unlock and unavailable audio.

## Verification actually run

- `TMPDIR=/private/tmp npm test`: 212 passed.
- `npm run typecheck`: passed.
- Real Electron player-roll UI test: 1 passed.
- LAN phone/desktop browser test with the installed macOS Chrome path: 1 passed.
- `TMPDIR=/private/tmp npm run test:journal`: 1 passed in isolated temporary workspace/daemon.
- `git diff --check`: passed.

## Limitations and next steps

Browser sound requires a prior interaction and is subject to browser/system mute settings. Tests verify cue scheduling and deduplication; no subjective listening check was performed. Restart the source app or reload the LAN client to load the module. Changes remain uncommitted; no campaign data or existing journal daemon was changed.
