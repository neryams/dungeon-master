# Antigravity CLI smoke verified and Gemini CLI removed

## Context and decisions

The user installed and authenticated Antigravity CLI (`agy`) and requested integration smoke tests, followed by Gemini CLI removal if they passed. Used a synthetic campaign outside the repository at `/tmp/dm-agy-smoke-5vpQdm/agy-smoke`. No real campaign records or player information were used. Direct host CLI invocation was explicitly authorized; the shipped server still performs no model API calls.

## Investigation and implemented changes

Native `agy plugin validate` recognized seven skills, but its loader expects `mcp_config.json` unless Agent Plugins spec support is enabled. Installed a generated campaign-bound plugin copy with that additional file; no global direct MCP connection was added. The generic source directory is unsuitable as an agy plugin because it has an unbound command and its SRD rules/ directory is interpreted as agent rules. Added installation guidance in docs/installation.md.

Initial actual MCP calls exposed a schema compatibility failure: Antigravity validates tools against JSON Schema 2020-12, while Zod tuples emitted draft-07 array-valued items. It rejected six tools, including apply_campaign_changes, approve_action_effects and administer_campaign. src/schema.ts now defines MapEdge as an exactly-two-element homogeneous Id array transformed to a TypeScript tuple, reused in schema and src/service.ts. Stored edge format and valid inputs remain unchanged. test/mcp.test.mjs checks all advertised schemas for array-valued items and retains endpoint-count/identifier rejection checks. These are implemented changes, not a proposed port.

Headless tool calls initially auto-denied because they cannot prompt. Temporarily allowed only `mcp(dungeon-master_dungeon-master/*)` in Antigravity CLI settings; restored the original settings after testing. No broad permission bypass was used.

## Verification actually run

Actual authenticated agy print sessions verified campaign identity, sheet lookup, edition-matched search/read rules, map PNG returned as a media artifact, record_scene delivery, journal read/search, and exact retry. After the schema fix, damage changed HP 9 to 7 exactly once; identical operation ID/input returned duplicate=true at revision 5. A fresh independent conversation resumed HP 7 and the persisted record. Reviewed mode at revision 6 rejected direct damage with REVIEW_REQUIRED; explicit world_preparation administration healed to HP 8 at revision 7. Direct CampaignStore replay independently confirmed revision 7, HP 8, one damage event, no event for rejected damage, and one narrative record.

npm test passed all 49 tests; npm run typecheck passed; npm run test:journal passed before and after the fix using its own isolated runtime. Targeted Prettier and git diff --check passed. Campaign journal used private TMPDIR/IPC/log directories and invalid:model to force keyword fallback, avoiding downloads and the user's existing daemon. Only the test daemon PID recorded in private logs was stopped.

## Cleanup completed

Uninstalled the temporary dungeon-master agy plugin, restored Antigravity permission settings, and removed the temporary settings backup. Uninstalled globally installed @google/gemini-cli 0.65.0 and its extra ~/.local/bin/gemini symlink. Removed Gemini CLI metadata, the known test/auth caches and histories, and the empty auth workspace created during installation. Preserved Antigravity's config, credentials and other files under the shared ~/.gemini directory. npm global inventory confirms Gemini CLI absent; `command -v agy` succeeds. A post-cleanup authenticated agy prompt returned AGY_STILL_OK. Synthetic campaign and smoke JSONL evidence remain in the private /tmp smoke directory.

## Known limitations and next steps

These are CLI integration smokes, not a full gameplay session, native desktop UI check, visual map interpretation test, optional generated-art test or independent rules-referee delegation test. Antigravity extracted the returned PNG into a conversation media file. Semantic journal embeddings were intentionally not exercised. Install a campaign-bound plugin following docs/installation.md before actual play; no disposable campaign plugin remains enabled. Source changes and journal entries remain uncommitted; no push was performed.
