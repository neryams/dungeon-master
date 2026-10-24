# Referee model path corrected after native delegation smoke

## Context and decisions

A native Antigravity tool-schema smoke confirmed invoke_subagent exposes role/type fields but no model override. The earlier helper and journal entry incorrectly described that tool as accepting Model: flash. The installed native run-workflow guide separately documents agent(..., model="flash") tiers. That documentation alone does not prove the active tool list provides a safely bounded read-only referee type, and a workflow smoke has not yet confirmed runtime model acceptance.

## Implemented corrections

- Updated src/desktop/referee-model.ts so the workflow path is conditional on both the documented tier and active tools supporting a rules-referee with an explicit read-only campaign-tool restriction. Instructions use the documented lower-case model argument on run_workflow agent(), avoid assuming a named custom type exists, and reject using a broad self-agent with mutation tools. If no bounded read-only route is available, the DM uses invoke_subagent with only its supported arguments and inherits the parent model.
- Updated run-campaign and rules-referee guidance to remove claims that invoke_subagent accepts a model field. They describe the separate workflow route conditionally and preserve the read-only boundary.
- Updated tests to verify the workflow syntax, safe-tool requirement, inherited fallback, exact tier discovery and refusal to treat agy models catalogue IDs as child tiers.

## Verification actually run

npm run typecheck passed before the final assertion-only test edit. Targeted node tests for referee-model and Antigravity events passed 10/10; the installed guide resolves flash, flash_lite and pro. git diff --check passed. No full suite run was done.

## Limitations and next steps

No confirmed native smoke has yet shown that the bounded read-only workflow child can actually use flash. Keep the explicit model selection conditional until the native definition/invocation schema and tool restrictions are verified. No campaign data, model APIs, or shared daemon were touched; no commit was created.