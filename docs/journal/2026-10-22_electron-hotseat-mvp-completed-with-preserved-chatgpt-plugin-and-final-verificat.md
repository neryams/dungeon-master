# Electron hotseat MVP completed with preserved ChatGPT plugin and final verification

## Context and decisions

Completed the user-authorized Electron hotseat implementation on the existing branch from baseline 6d298ab. Antigravity 1.4.4 is the only desktop provider in this iteration. All changes remain uncommitted for review. No direct model API calls were added.

## Completed changes

The desktop under desktop/ provides guided CLI detection, campaign creation/opening, connection verification, a public transcript, character selection and passing the seat, exact sheets/inventory/resources/quests, initiative and revision-bound revealed maps with viewport controls. A sandboxed, context-isolated renderer uses a narrow sender-validated IPC bridge to an external Node worker. The application has its own user-data directory. The source launcher selects XWayland on Linux where DISPLAY is available, with an explicit native-Wayland override.

src/desktop/host.ts serializes submissions and preserves durable request IDs, uses a campaign desktop lease, records interrupted turns, and never automatically reruns uncertain agent actions. src/desktop/server.ts checks owner PID/token before tools and on a heartbeat so orphaned CLI processes lose campaign-tool access. src/desktop/antigravity.ts drives structured persistent streams, suppresses raw output, validates actual campaign tool results, and manages an app-specific workspace-local MCP binding and one exact global CLI permission grant while preserving other settings. Session locators are disposable context, never current state.

src/table.ts and optional schema table payloads persist public intentions/narration/status through CampaignStore.transact and typed replay. publish_table_message is additive to the existing MCP tools. Conversation events do not invalidate rules-review fingerprints. src/player-view.ts supplies a shared filtered projection; existing panel behavior remains read-only. New desktop campaigns use the unchanged CLI initializer and retain the campaign-bound ChatGPT/Codex plugin configuration. Plugin packaging includes the desktop source. README.md, docs/desktop.md, docs/architecture.md, docs/tools.md and docs/verification.md describe launch, data boundaries, setup permissions, recovery and limitations.

## Verification actually run

Final npm test: 56 passed. Final npm run typecheck passed. npm run test:journal passed with its private temporary runtime. npm run test:desktop passed after the final app changes; it checks real Electron setup, sandbox/isolation, no renderer Node access, player projections, script text inertness, map loading, character switching, live HP refresh, restart transcript recovery and new-campaign ChatGPT configuration. Setup and table screenshots were visually inspected; final automated screenshots were written under /tmp/dm-desktop-ui-k4kDSM.

The authenticated npm run test:antigravity passed twice after fixing the real wrapper-event protocol, most recently with the desktop owner-checking MCP wrapper: two public turns, damage and movement exactly once, PNG rendering, duplicate submission deduplication, and a fresh CLI process resuming for a second character. The final live run completed at revision 9 in approximately 95 seconds. It used synthetic temporary campaign data, private journal IPC/log paths and invalid:model keyword fallback, restored its scoped settings change, and only terminated daemons identified in its own logs. No existing shared journal daemon was stopped or reconfigured. Full independent referee delegation, semantic embeddings and a complete live adventure were not tested.

npm run package:plugin passed. Prettier and git diff --check passed before this final journal entry; final formatting/package refresh follows to include this note. No commit or push was performed.

## Known limitations and next steps

This is a source-launched Linux-tested MVP, not a signed standalone installer. It requires Node 22.12+, Git and an authenticated agy installation. No LAN input/discovery, other provider adapters, per-player authorization, click-to-move, generated-art display or token-streamed public text. Public narration is explicitly authored by the DM and is not automatically spoiler-redacted. Independent referee behavior depends on the CLI; explicit fallback remains available. The native ChatGPT UI was not exercised live in this task; compatibility is covered by existing MCP/CLI tests and packaging.

Next useful milestones are a fuller guided campaign-creation/playthrough acceptance session, OS-specific packaging/signing, broader provider capability checks, and paired LAN play. Keep campaign data outside this public repository and continue using isolated journal workspaces for integration tests.
