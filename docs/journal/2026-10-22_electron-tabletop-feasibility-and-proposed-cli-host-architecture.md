# Electron tabletop feasibility and proposed CLI host architecture

## Context and rationale

Assessed the user's proposed desktop application: show DM conversation alongside live player maps and information, guide setup after CLI installation/authentication, and support LAN players sharing one host runtime or hotseat play. Baseline commit: 6d298ab. Working tree was clean at investigation start. This entry records a proposal, not an implemented application or an approved implementation scope.

## Findings

README.md, docs/architecture.md, src/panel.ts, src/service.ts and src/store.ts establish reusable authoritative events, typed transactions, player projections, deterministic maps and a read-only LAN panel. The current panel has shared bearer access, no player identity or action submission, and polls snapshots. Existing setup is campaign-bound but is not a seamless cross-provider installer; docs/installation.md also contains older setup descriptions that should be reconciled during implementation.

Prior journal evidence records Antigravity CLI integration smokes, including map media and retry behavior, but not full gameplay, independent referee delegation or multiplayer. Current official documentation supports Codex app-server over stdio with thread/turn events and approval handling; Claude Code print mode with structured streaming and session continuation; Antigravity persistent stream-json input/output. Antigravity headless control_request/control_response input is unsupported and approvals require policy configuration, so adapters cannot promise identical approval capabilities.

## Proposed design

Use Electron for the host shell and a reusable web player UI. Run a local session coordinator that owns the CLI process, authenticated player sessions, character assignments, durable submission IDs and a serialized action queue. Keep CLI/MCP access on the host. Players submit intentions; all actual campaign mutations remain CampaignStore.transact plus typed reducers. Preserve operation IDs when recovering uncertain results and never blindly replay interrupted agent turns.

Separate explicitly public narration from private CLI/tool/referee events. Persist public narration through a typed campaign operation with revision associations; derive current maps, HP and inventory only from event state. Do not broadcast the raw agent stream or raw campaign events. Existing party visibility does not provide per-player authorization.

Propose opt-in mDNS/DNS-SD lobby advertisement, host-approved pairing and manual address/QR fallback. Discovery is not authentication. Keep provider credentials local and use app-owned transport for clients. Hotseat uses the same coordinator with an active-character selector. Capability probes should verify provider versions, campaign identity, loaded tools/skills, permissions and referee fallback. No direct model API integration is proposed.

## Verification actually performed

Read project documentation, relevant source and prior journal entries; checked Git status and baseline commit. Inspected official documentation at https://learn.chatgpt.com/docs/app-server , https://code.claude.com/docs/en/headless , https://antigravity.google/docs/cli/headless/ and https://www.electronjs.org/docs/latest/tutorial/security . No CLI inference sessions, behavioral code changes, npm tests or daemon operations were run. Only this development journal entry was added; no commit or push.

## Limitations and concrete next steps

Provider parity, installed-version protocol behavior, distribution permissions/account eligibility, multi-device discovery and disconnect recovery need validation before release. Recommended first implementation is one-provider hotseat vertical slice with public narration and exact map/state updates, then authenticated LAN play and discovery, followed by additional provider adapters. Test interruption after event commit, reconnect deduplication, secret filtering, character ownership and queue ordering. npm test and npm run typecheck are required after behavioral changes; journal integration tests must use isolated temporary workspaces.
