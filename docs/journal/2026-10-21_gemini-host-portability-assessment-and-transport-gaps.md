# Gemini host portability assessment and transport gaps

## Context and decisions

Investigated whether the repository plugin can run in Gemini desktop. The core CampaignService and MCP tools are model-independent; src/server.ts currently exposes stdio. Google documents Gemini Apps custom apps through an MCP server URL, with current help listing web/mobile availability. This does not establish native desktop local stdio support. Avoid asserting that all Gemini products lack MCP.

## Findings and rationale

Gemini CLI documents local stdio MCP, SKILL.md discovery under .gemini/skills or .agents/skills, and extension packaging through gemini-extension.json. A CLI adaptation appears feasible with connection/packaging and host-workflow changes, without rewriting campaign state or journal internals. This is an assessment, not verified compatibility. Native desktop is not a demonstrated drop-in target. A Gemini Apps integration would need an accessible authenticated MCP HTTP endpoint/bridge and a way to supply the skill instructions. docs/cloud.md already describes a future HTTP wrapper; the player panel is not an MCP endpoint. Referee delegation can use the existing explicit fallback; optional generated artwork can be skipped while deterministic maps remain available.

Sources inspected: https://support.google.com/gemini/answer/17209137 ; https://geminicli.com/docs/tools/mcp-server/ ; https://geminicli.com/docs/cli/using-agent-skills/ ; https://geminicli.com/docs/extensions/reference/ .

## Verification actually run

Read README.md, docs/architecture.md, docs/installation.md, docs/cloud.md, referee/art skills, transport code references and prior referee journal entry; checked Git status (clean before this note). Read current official Google documentation. No Gemini runtime integration, code changes, npm tests or daemon operations performed.

## Limitations and next steps

Desktop feature rollout and account availability need confirmation in the target client. If requested, add Gemini CLI configuration/package support and test campaign_status, mutation retry, fresh-session resume, map output and referee fallback using an isolated campaign. A desktop/web port additionally needs transport/auth and instruction-loading decisions. No campaign data or secrets included; no commit or push.
