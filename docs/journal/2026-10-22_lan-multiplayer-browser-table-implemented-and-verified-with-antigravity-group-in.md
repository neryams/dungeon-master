# LAN multiplayer browser table implemented and verified with Antigravity group input

## Context and decisions

Implemented the approved LAN multiplayer plan on feature/standalone-app after baseline 042ce19. The user selected direct QR/link joining, exclusive character claims, shared editable intentions, automatic group dispatch, Send now with reconfirmation, and targeted DM replies. Follow-up discussion established initiative-aware combat and explicit pauses for reactions. No automatic discovery or cloud/model API calls. Changes remain uncommitted; no push or PR update performed.

## Completed implementation

- src/desktop/lan.ts hosts bundled browser assets and a narrow authenticated HTTP API in the desktop worker. Per-run fragment invitations exchange for revocable client credentials. Host/origin checks, body/rate/connection limits, fixed assets, safe errors, and explicit public projection keep paths, raw agent output, credentials, and private state off LAN.
- Electron adds hosting QR/address selection, invite rotation, local player windows, joining another host, player removal, assignment/release, host passes/resolve, and NPC-turn continuation. Remote windows have no preload or Node integration. Source campaigns and CLI management remain local.
- Typed table operations persist seats, editable intentions, confirmations, grouped character-attributed submissions, and public responseRequest prompts. Epoch checks invalidate stale confirmations; exact operation retries survive network loss/reload without repeating CLI effects. Gameplay state remains authoritative; gathering is excluded from generic party state and review fingerprints.
- Exploration waits for assigned seats; combat confirmation follows saved initiative. Targeted decision/reaction prompts take precedence and wait for named characters. Host passing for an unclaimed target does not enroll it in future groups. Disconnects do not silently pass. All actual mechanical adjudication remains with the campaign/referee tools; the DM must pause before committing an outcome requiring a reaction.
- Phone browser tabs show the public transcript, shared intentions, revealed/composite maps with pan/view controls, full character stats/inventory, and journal objectives. Session storage retains uncertain request IDs; retry is explicit. Campaign changes/restarts stop hosting or revoke access, reset confirmations, and preserve durable drafts.
- Fixed a stop-before-agent-dispatch race and serialized concurrent LAN startup to avoid orphan listeners. CLI timeout raised from five to ten minutes after a native-generation timeout. Existing hotseat, ChatGPT/Codex plugin, and independent read-only panel retained.

## Verification actually run

- npm test: 74/74 passing after final reducer change; npm run typecheck passed.
- npm run test:journal passed using an isolated temporary daemon/workspace. No existing user daemon was stopped or reconfigured.
- npm run test:desktop passed, including hosting QR and sandboxed local player window.
- npm run test:lan passed with phone and desktop Chromium contexts over the machine's non-loopback HTTP address (insecure-context behavior verified), shared input, targeted replies, maps, reload, and a deliberately lost HTTP response recovered without duplicate CLI work. Screenshots inspected under /tmp/dm-lan-ui; real physical phones/Wi-Fi traversal were not tested.
- Authenticated Antigravity integration first passed mechanics/group/targeted input, then timed out during native generation at the original five-minute limit. After increasing the budget, the complete live test passed in about 256 seconds at revision 27: five public turns, grouped intentions, targeted prompt/reply, LAN Send now, native generated background imported/registered, identical LAN and desktop composites, and resumed CLI session without repeated mechanics. Tests restored their permission edit only if unchanged concurrently and removed their isolated synthetic campaigns.
- Plugin packaging, format check, and git diff --check passed before the final journal write; packaging/format will be refreshed to include this entry.

## Limitations and next steps

Trusted-LAN HTTP only; no TLS, installers, mDNS, private sheets, standalone chat, or provider parity. Reaction opportunities and rule correctness remain agent-adjudicated, not a complete automatic D&D rules engine. A disconnected/missing player needs explicit host intervention. The host must keep running and permit its displayed ephemeral port through its firewall; Wi-Fi client isolation may block devices. Review the uncommitted source and docs, then commit/push only on user instruction.
