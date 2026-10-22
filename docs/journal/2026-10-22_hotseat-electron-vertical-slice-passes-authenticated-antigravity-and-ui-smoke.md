# Hotseat Electron vertical slice passes authenticated Antigravity and UI smoke

## Context and decisions

The user authorized an Electron hotseat MVP on the current branch, focused on the installed/authenticated Antigravity CLI while preserving the ChatGPT desktop plugin route. Baseline is 6d298ab. Implemented the initial vertical slice; final regression, documentation and lifecycle hardening remain in progress.

## Implemented changes

Added desktop/ with an isolated Electron renderer, narrow preload bridge and Node worker. src/desktop/host.ts coordinates campaign opening/creation, a per-campaign desktop lease, CLI connection, durable submissions, public narration, exact player snapshots and revision-bound PNGs. src/desktop/antigravity.ts uses structured persistent stdin/stdout, never sends raw agent/tool output to the renderer, and creates a workspace-local MCP connection plus skill copies under the campaign's ignored .dm/hotseat directory. It merges one exact campaign-server permission grant into Antigravity settings without altering other rules. Credentials remain managed by agy.

Added optional typed table events and publish_table_message; these go through CampaignStore.transact and replay, survive export/import and do not invalidate mechanical review fingerprints. Generic party tools omit the table history. src/player-view.ts now supplies the unchanged panel projection and the desktop. Existing CLI campaign creation retains its generated ChatGPT/Codex plugin configuration.

## Verification actually run

Existing 49 tests passed after the initial domain changes. Four new hotseat tests passed for event replay/export, interrupted requests, filtering, map freshness, config preservation and split/malformed CLI streams. An authenticated Antigravity 1.4.4 integration test passed in a synthetic temporary campaign: damage and movement committed exactly once, explicit public narration persisted, PNG rendered, a fresh CLI process resumed its conversation for a second character, and duplicate submission did not repeat effects. The smoke used private TMPDIR/log paths and invalid:model journal fallback; it restored its exact settings change and only terminated daemons recorded in its own private logs.

Electron UI automation passed: setup rendering, sandbox/context isolation, no renderer Node access, actual saved party/map/transcript display, literal script-text rendering without execution, hidden content exclusion, seat switching, live HP refresh, restart recovery and new-campaign ChatGPT configuration. Visually inspected setup and play screenshots. Native Wayland startup stalled here; launching with --ozone-platform=x11 worked. The launcher selects XWayland on Linux with DISPLAY and supports DM_DESKTOP_OZONE=wayland as an override. Antigravity 1.4 emits call_mcp_tool wrapper events, so readiness checks inspect the actual campaign result rather than the outer tool name.

## Known limitations and next steps

No LAN multiplayer, additional providers, installer/signing or automatic model calls outside agy. Public prose remains explicitly authored by the DM; it is not automatically spoiler-redacted. Finish controller lifecycle/race tests, review shutdown behavior, run npm test, npm run typecheck, npm run test:journal in isolation and package validation, and document launch/setup/recovery. No commit or push performed.
