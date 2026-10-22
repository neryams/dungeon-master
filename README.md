# Dungeon Master

An open-source D&D DM plugin for local Codex/ChatGPT Work. ChatGPT narrates and adjudicates; campaign tools save exact state and use [journal-rag](https://github.com/neryams/workspace-docs-mcp) internally for campaign memory. No OpenAI model API calls. An optional local web panel provides read-only player views.

## Start locally

Requires Node.js 22+, npm, and Git. From this repository:

```bash
npm ci
npm run build
node dist/cli.js init my-campaign --name "My Campaign" --edition 2024
```

This creates `~/Campaigns/my-campaign`, a separate local Git repository, a campaign-bound plugin, and project marketplace configuration. Open that folder as a trusted Codex project. Install **Dungeon Master** from its project marketplace, then start a new conversation and ask it to create your party and opening scene. The generated server connection uses explicit absolute paths; it does not rely on the host's working directory. No GitHub repository is created or pushed.

A new campaign initially has no characters and has one setup-policy event. The create-campaign skill collects the party and starting situation and persists them through the domain tools. Pass `--config campaign-options.json` to init for `premise`, `tone`, and `houseRules`; these fields are player-facing.

When the host supports built-in image generation, campaign setup can create an illustrated background for the starting map. The renderer keeps map positions and topology authoritative, overlays live map details, and preserves player reveal masking. Artwork generation is optional; the schematic remains available if generation or registration fails. The plugin makes no model API calls.

If your client doesn't discover local plugins, use the direct MCP and skill installation instructions in [installation.md](docs/installation.md). Generic portable plugin installations need `npm link` and an explicit `DM_CAMPAIGN_ROOT`; the generated campaign plugin does not.

## What is included

- Exact characters, HP/temp HP, inventory, resources, conditions, initiative, world time, story progress, party roster and map positions.
- Graph/grid map authoring, atomic subgroup movement, explicit reveal masks, illustrated backgrounds aligned to saved map geometry and PNG tool responses.
- Cryptographic dice, recorded physical dice, idempotent retries, revision conflicts and explicit corrections.
- Append-only JSON event history, replayable state, Markdown scene records and journal-backed historical retrieval.
- Seven campaign skills: create, run, close, maintain, player sheets, rules referee and optional host-generated map artwork.
- Export/import, validation, pending journal delivery recovery and an original example adventure.
- Player-facing filtering of DM-only entities and records. One trusted operator controls the whole campaign; this is not multi-user authorization.

There is no complete rules engine. The DM supplies adjudicated outcomes and resource changes. The campaign records whether you use 2014 or 2024 5e; it bundles licensed SRD references but does not automatically apply every spell, feature or rest rule.

## Ask for your sheet

Ask “Show my character sheet,” “What am I carrying?” or “Where is everyone?” The player-sheet skill reads current saved health, resources, complete visible inventory and regional/tactical placements. It asks which character when the conversation does not identify one. “Show the current map” returns a PNG at the same saved revision.

Sheets default to the player view and include their source revision. Ask again after an action for a fresh snapshot; old chat messages do not update themselves. These lookups do not advance play or contact the journal.

## Commands

```bash
node dist/cli.js validate --campaign ~/Campaigns/my-campaign
node dist/cli.js journal-sync --campaign ~/Campaigns/my-campaign
node dist/cli.js export --campaign ~/Campaigns/my-campaign --output /tmp/campaign-backup.json
node dist/cli.js import /tmp/campaign-backup.json --campaign ~/Campaigns/restored-campaign
node dist/cli.js demo
```

`demo` creates a temporary example campaign, not a campaign in your personal folder. It records a playable opening, concludes the ferryman interaction, moves onto the bridge, splits the party and renders DM/player PNGs. It may initialize the shared journal daemon/model. Use the isolated integration tests when you want to avoid changing the existing journal runtime.

Export includes committed events and assets; import rebuilds state and makes journal records available from authoritative history immediately. Run `journal-sync` to materialize and reindex Markdown. Keep backups somewhere durable: a local Git repository without commits or a remote is not a backup service. Git commits and pushes are explicit user actions.

## Journal dependency

The optional `journal-rag` dependency is pinned to commit `93de77e54b013800d9ecddbe230840c46d549740`. `npm ci` installs it when possible; npm may require approval of dependency install scripts depending on its version/configuration. Check with:

```bash
node -e "console.log(require.resolve('journal-rag'))"
```

The local development override is `DM_JOURNAL_SERVER=/absolute/path/to/workspace-docs-mcp/dist/server.js`. A missing dependency leaves gameplay events safe but narrative delivery pending and search unavailable. It is optional so the bookkeeping core can run without native embedding dependencies.

Embeddings run on the machine through journal-rag. The initial model download can be substantial. Upstream falls back to keyword search when vectors cannot be built. The DM adapter never calls a model API and never exposes raw journal tools to the playing agent.

## Verification

For development progress tracking, run `npm run journal:setup` after installing dependencies, then open this repository as a trusted Codex project and start a new session. This installs a project-scoped `project_journal` MCP connection backed by `docs/journal/`. Its machine-specific connection config and retrieval cache are ignored by Git. See [AGENTS.md](AGENTS.md#development-journal) for the read/write workflow. This development journal is separate from campaign memory.

```bash
npm run typecheck
npm test
npm run test:journal
npm run package:plugin
```

The real journal integration test uses private temporary IPC/log directories and intentionally forces keyword fallback, avoiding model downloads and the user's existing daemon. `npm test` covers actual MCP transport as well as state, visibility and recovery. [Verification notes](docs/verification.md) distinguish automated checks from app UI and live storytelling checks.

See [architecture](docs/architecture.md), [tool interfaces](docs/tools.md), and [cloud connection guidance](docs/cloud.md). The package archive is generated at `build/dungeon-master-plugin.tgz`; no artifacts are published automatically.

## Play in the Electron hotseat app

With Antigravity CLI (`agy`) installed and signed in:

```bash
npm ci
npm run desktop
```

The app detects the CLI, guides campaign creation or opening, and connects the DM. Choose a character, type an action, and pass the seat to the next player. Public DM narration appears beside the revealed map, exact character sheets, inventory, resources and quests. Campaign state and the table transcript survive restarts. Interrupted actions are never automatically replayed.

The app supports hotseat and browser-based LAN multiplayer using one host’s Antigravity CLI. Choose **Host LAN game** to share a QR code/link with phones on the same network. Players claim characters, prepare shared intentions, and confirm group submissions; combat follows saved initiative and the DM can request targeted decisions/reactions. It requires Node 22.12+ and Git; it is launched from this checkout, with no signed installer yet. The existing ChatGPT/Codex plugin and read-only LAN panel remain available. New campaigns created in the desktop also receive the standard campaign-bound ChatGPT/Codex plugin configuration.

Connecting creates an app workspace under the campaign's `.dm/hotseat` directory and adds one exact campaign-server MCP permission to Antigravity's settings. It preserves unrelated settings, existing deny/ask rules and CLI credentials. See [desktop setup, recovery and testing](docs/desktop.md).

## Open the player dashboard

```bash
node dist/cli.js panel --campaign ~/Campaigns/my-campaign
# Optional: allow other computers/phones on the same trusted network
node dist/cli.js panel --campaign ~/Campaigns/my-campaign --lan
```

Open the complete access link printed in the terminal. The panel shows party sheets, inventory, resources, positions, current story, active quests, turn order and player maps. It refreshes every two seconds while visible; it cannot change gameplay. Campaign tools continue running separately. Map controls select a viewport or center on a selected character with a visible grid position.

The default listens only on this computer, port 4317. Use `--port 4318` if that port is occupied. `--lan` prints candidate network addresses; share a complete LAN link with players. The host must stay on and its firewall must allow that port. VPN or virtual-adapter addresses may not be reachable from another device. Stop with Ctrl+C. Restarting creates new access links.

Everyone with the link sees the same party-visible state, not DM secrets or individual private sheets. LAN mode uses unencrypted HTTP and is intended for a trusted local network, not internet exposure. There are no accounts or cloud services. Public descriptions and scene prose must not contain DM secrets. The panel does not serve original artwork or campaign files.

## Rules referee

New campaigns begin in setup mode and enter reviewed play after their opening is verified. The primary DM delegates a bounded rules check to a host subagent using the same model, records costs and success/failure procedures before rolling, then obtains approval of the exact effects before committing them. Dangerous but legal choices remain the player's choice; impossible actions do not become possible just because a player asks or rolls well.

The tools enforce that workflow and saved-state consistency. They do not supply a complete combat engine or prove that the reviewing agent interpreted the rules correctly. The primary DM can explicitly administer an override, correction or world-preparation change. If the host lacks delegation, it records a clearly marked DM fallback instead of pretending independent review occurred. No model API is called.

Existing campaigns retain legacy behavior until configure_review enables reviewed play. Pending actions survive restarts and exports. See [tool contracts](docs/tools.md#referee-workflow) and [architecture](docs/architecture.md#referee-reviewed-play-050) for the guard boundaries and limitations.

Edition-matched SRD references are bundled for offline lookup. `search_rules` defaults to coherent Markdown sections for 2024 and PDF pages for 2014. `list_rule_sections` browses a paginated table of contents; `read_rules` accepts `sectionId` and optional `part`, or the existing `page`/`count` locator. Section reads include up to 30 child links; follow `nextChildOffset` through `list_rule_sections` for the rest. Use `search_rules` with `format: "pages"` for the original PDF extraction. Section results carry stable IDs, heading paths, source links and a `corpusRevision` for referee citations. The community conversion is pinned and audited; see [coverage and limitations](docs/rules-coverage.md). No runtime downloads or vector database are required. [Attribution and extraction notes](rules/ATTRIBUTION.md) accompany the pinned text. Non-SRD features require supplied rules or explicit DM judgment.
