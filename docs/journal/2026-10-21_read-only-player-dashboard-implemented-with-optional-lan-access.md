# Read-only player dashboard implemented with optional LAN access

## Context and decisions

Following conversational sheets at commit 5eaea3b, the user approved a player-only dashboard with optional LAN access and explicit CLI startup. Implemented a separate Node HTTP reader bound to one campaign; no model API, journal runtime, MCP passthrough, or gameplay writes. Shared per-run bearer links grant the same party view to everyone; LAN HTTP is for trusted local networks, not internet hosting.

## Completed changes

src/panel.ts serves authenticated state and revision-bound PNG endpoints, reusing party filtering and sheet projections. It rejects audience overrides, writes, arbitrary paths, invalid Host/Origin and unsafe viewport extents. Images render in memory with a bounded cache and serialized rendering. A revision check after rendering rejects concurrent-update images. src/panel-ui.ts provides responsive sheets, full inventory, story, active quests, encounter order, maps and viewport controls, with two-second polling and disconnected snapshot labeling. New images decode before display and stale responses are discarded. CLI panel supports --campaign, --lan and --port. Hidden encounter turns now use a projection-only -1 sentinel rather than selecting the wrong visible participant. Documentation and package metadata are updated to 0.4.0; no event schema migration.

## Verification actually run

npm test passed 36 tests. Panel tests exercise real HTTP listeners, authentication and token rotation, local network-interface access, visibility, complete inventory, separate placements, active quest selection, empty roster, restart, PNG equality, unchanged campaign file contents, renderer failure, and concurrent update rejection. npm run typecheck, format:check, git diff --check and package:plugin passed. npm run test:journal passed using its isolated temporary daemon. Browser checks against a disposable external test campaign confirmed desktop content, map viewport controls, character centering and disconnected state. A 390px viewport used one column with no page overflow; mobile screenshot capture was unreliable, so rendered DOM measurements were checked as well.

## Limitations and next steps

No second physical device was available; local LAN-address HTTP access was tested. The host must stay running and allow the selected port through its firewall. No individual player accounts, TLS, auto-start, gameplay editing or original-artwork endpoint. Event replay happens on each refresh, suitable for the current campaign scale. Changes remain uncommitted; no push requested. Final package should be regenerated with this journal entry included.
