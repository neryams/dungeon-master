# Electron tabletop

## Launch and setup

Install Node 22.12 or newer, Git, and either Codex CLI or Antigravity CLI. For Codex, run `codex login` and sign in with ChatGPT. For Antigravity, run `agy` and finish its sign-in. Select **Codex CLI** or **Antigravity CLI** under **DM provider**. From this checkout, run:

```bash
npm ci
npm run desktop
```

The desktop detects an executable on PATH or under `~/.local/bin`. Choose **Choose executable** if needed. Detection checks the version and provider protocol support; authentication and campaign access are verified when connecting through an actual `campaign_status` call. That connection check consumes a small CLI turn. The app never reads or copies authentication tokens and makes no direct model API calls.

After detecting a hosted provider, **Model** lists the models reported by that CLI: Antigravity's `agy models` or Codex's app-server model catalogue. Choose a specific model or leave **CLI default** to use the CLI's configuration. **Refresh** queries the catalogue again without starting a conversation or generating text. Each hosted provider remembers its own choice. Model availability and image generation depend on the installed CLI and account; an unavailable model reports an error rather than silently selecting another. If discovery fails, the configured CLI default remains usable.

Create a campaign with a name, folder and edition, or choose a folder containing `campaign.json`. Campaigns belong outside the source/application directory; the default is `~/Campaigns`. Creation uses the existing CLI initializer, including its local Git repository, setup review policy and campaign-bound ChatGPT/Codex plugin configuration. Git repositories are not automatically committed or pushed.

After creation, the app connects the selected provider and starts a conversation with the DM in a dedicated campaign setup screen. Describe the adventure in as much or as little detail as you like, or ask to be surprised. Bring existing characters, create them with the DM, or ask the DM to generate the party. The DM follows the same campaign-creation skill as the plugin, asks a few questions at a time, and saves the party, starting map, objective and opening scene through the normal campaign tools. Saved progress appears above the conversation. Once the DM verifies the opening and enables reviewed play, the app shows the party and map and enables LAN hosting.

While the DM works during setup, a prominent spinner explains that generation can take a few minutes. Its message reflects saved party, map and opening progress. It disappears when the turn finishes or needs attention; ordinary play keeps the compact activity indicator. Reduced-motion preferences disable the spinner animation.

If connection fails, the initialized campaign stays available: reconnect to begin setup. Reopening an unfinished setup restores the conversation and saved progress. The introduction is submitted only when the setup has no table history; reconnecting never repeats a saved or interrupted turn. After an interruption, reconnect and ask the DM to recap or continue. Existing legacy and completed campaigns open in their normal play view. Setup works with Codex, Antigravity and the experimental local provider; local model limitations still apply.

An Antigravity connection generates `.dm/hotseat/workspace/.agents/mcp_config.json`, copies the seven campaign skills into that workspace and merges `mcp(dm-hotseat-<campaign-path-hash>/*)` into the CLI's global `permissions.allow` list. Antigravity 1.4 uses global permission rules even for workspace-local servers. Only that exact server grant is added; unrelated settings and deny/ask lists remain intact. No global MCP server or plugin is installed. The CLI starts in this dedicated workspace, with an explicit campaign-bound MCP command.

This permission grant persists after closing the app. Remove the corresponding rule in `~/.gemini/antigravity-cli/settings.json` if retiring a campaign; reconnecting will add it again. A conflicting ask/deny rule can prevent connection and is not overridden. Reconnect after moving the checkout to regenerate desktop runtime paths. Existing ChatGPT plugin paths follow the normal `dungeon-master setup` guidance.

## Codex connection

Codex runs as an app-owned `codex app-server --listen stdio://` process, using the installed CLI's existing ChatGPT authentication and the selected model, or its configured default. It requires no API key and does not read/copy tokens. The adapter checks `account/read`, starts or resumes a thread, and requires a successful `campaign_status` tool result from the bound server before reporting readiness. An explicitly selected model uses the default reasoning effort reported for that model by the CLI. This was developed against Codex CLI 0.162.1; other releases must support the same app-server protocol. [Official app-server documentation](https://learn.chatgpt.com/docs/app-server).

The dedicated workspace is `.dm/hotseat/codex-workspace`; all seven campaign skills are copied there. Runtime thread overrides bind the same owner-checked desktop MCP server, disable unrelated configured MCP servers/plugins, shell execution and web search, and request a read-only sandbox. Global Codex settings and the campaign's ordinary plugin configuration are not rewritten. Campaign tools perform writes through the existing service and transaction rules. CLI-managed native image generation remains available when supported by the configured model/account. Raw protocol/model output is private; only saved public messages reach the table.

Choose **Campaigns** to return to setup and change providers. Each provider remembers its own executable and conversation locator. Switching providers reads the same authoritative campaign history; it does not share private conversation context. **Reset DM context** resets only the selected provider, durably removing its previous locator even if reconnect fails. Missing/unusable Codex context stops with an error rather than silently creating a replacement conversation or replaying an uncertain action. Interactive CLI approval prompts are not supported in the tabletop; such requests stop the turn with an attention message. Player questions must use the public transcript/response-request tools.

## Playing

The shared screen shows public narration, revealed maps, visible party characters and their exact saved sheets. Click a character to speak as them, or **Table** during setup or group decisions. **Pass seat** selects the next party member. Submit with **Send** or Ctrl/Cmd+Enter. There is one active action at a time. The DM can ask clarification questions through the same public transcript.

When the DM is idle, choose **DM model…** in the table header to change models. The same control is available during campaign setup; **Change model…** is also available after a connection failure. Review the warning and choose **Switch model & reconnect**. This starts fresh provider conversation context; previous private conversation context does not carry over, and cached tokens may need rebuilding. Provider-side caching is controlled by the CLI/service, so the app cannot promise to erase that cache. Saved characters, maps, history and LAN player seats remain intact. The new DM loads campaign state and memory through the normal tools. Cancellation changes nothing; a failed switch preserves the chosen model for **Reconnect**, without replaying the last player action. Local mode offers the installed Ollama models through the same dialog, subject to its vision/tool/context checks.

The agent uses the existing campaign skills for creation, adjudication, state updates and rules-referee fallback. New campaigns begin in setup mode. Describe your party and preferences to begin; the DM creates the opening and enables reviewed play once verified. Independent referee delegation depends on the host's capabilities. When unavailable, the existing explicit administrative fallback applies; the desktop does not certify independent review.

The **Map key** below the party cards stays visible during play. Party badges use the same colored circles and name initials as their map markers. NPCs use dotted circles. Objects and landmarks share the eight-color [Okabe–Ito palette](https://jfly.uni-koeln.de/color/): markers 1–8 are triangles, 9–16 are diamonds. Each carries a matching number in the key, with light or dark text for contrast. For more than 16, colors and shapes repeat while numbers remain unique. Terrain/obstacles use square outlines. The key lists other revealed markers by name and position for the selected map, including those outside the current viewport. It omits concealed entities and fogged placements. Numbering is derived from the currently revealed objects on the selected map; it stays the same when panning or changing viewport size, and may change when that revealed set changes. The map's yellow outer ring still marks the active combat turn.

Map controls choose a map, change grid viewport size, pan or center on the selected character. The default view fits the saved bounds up to 40 cells per dimension and shows the map without document margins. **Details** restores the full coordinate and printable marker key; click the scene title to read its summary. The ChatGPT map images and read-only web panel retain their full document view. Characters' HP, resources, items and positions come from authoritative event state. Asking the DM to move is currently a conversational action; dragging tokens and click-to-move are not implemented. Reveals are explicit, without automatic line of sight. Illustrated backgrounds use native provider image generation and the create-map-art skill: a clean saved-geometry reference, generation, campaign-local asset import, registration and a live composite with labels, markers and fog. Existing artwork is reused as characters move. Missing, changed, stale or concealed artwork falls back to the schematic and shows a warning beside the map. You can ask the DM to skip artwork.

Only `publish_table_message` responses enter the public transcript. Raw CLI output, tool results and referee deliberations are not displayed. Public messages appear when saved, rather than token by token. The DM still must author public prose without secrets; neither the app nor the plugin can automatically redact all spoilers. Hotseat is one trusted operator with a shared party view, not individual player authorization. Desktop and LAN messages support Markdown headings, bold, italics, bullet and numbered lists, inline code and code blocks. Raw HTML remains escaped text; message images and clickable links are disabled, so narration cannot load remote resources or navigate away from the table.

The desktop-only `import_generated_map_art` tool copies bounded PNG/JPEG/WebP output from the connected provider into content-addressed campaign assets; Antigravity accepts only its connected conversation directory. Codex accepts only exact saved image paths reported by successful native image-generation events in the active thread/turn, bound to the desktop owner. Its allowlist resets on reconnect; already imported campaign assets remain available. Both reject symlinks and invalid images. Reference PNGs are mirrored into the campaign’s hotseat reference area for native image conditioning. Registration still uses the existing typed `register_map_art` transaction. No shell permission, extra global file grant or model API is needed. The ordinary ChatGPT plugin keeps its existing host file-handling workflow.

## Stop, restart and recovery

**Stop DM** stops this app's owned CLI process tree. Saved events remain intact. If a turn ends without a published response, fails, times out or is interrupted, the app marks it for attention. Review the map and sheet, reconnect, and ask for a recap before taking another action. Do not resubmit uncertain damage or dice requests as new actions.

Player submissions carry durable IDs. Retrying the same submission returns its existing record and does not call the agent again. Mechanical tool retries retain their existing operation IDs through the normal campaign tools. Public transcript events are included in campaign export/import. The `.dm/hotseat/session.json` (Antigravity) and `.dm/hotseat/codex-session.json` (Codex) files store provider conversation locators; these are optional context, not game state. **Reset DM context** drops that locator and reconnects against the same authoritative campaign.

Opening a campaign recovers any unfinished table request as interrupted. A per-campaign desktop lease prevents a second desktop session. After a hard crash, the lease can take about 30 seconds to expire. The desktop-only MCP wrapper checks its owner process/token before every tool call and every second, and shuts down when ownership disappears. The ordinary ChatGPT/Codex MCP entry point is unchanged. Avoid simultaneously playing the same campaign from a separate trusted CLI or ChatGPT session; revision checks protect state consistency but do not coordinate two DM conversations.

On Linux with DISPLAY, the launcher selects XWayland because native Wayland startup stalled on the development machine. Set `DM_DESKTOP_OZONE=wayland` to opt into native Wayland. The renderer has Node access disabled, context isolation and sandboxing enabled, a restrictive CSP, no external navigation and a narrow IPC bridge. The Node worker uses the Node executable that launched the app so the plugin and journal dependencies do not depend on Electron's native module ABI.

## Verification

```bash
npm test
npm run typecheck
npm run test:journal
npm run test:desktop
npm run test:antigravity
npm run test:codex
npm run test:setup
npm run package:plugin
```

`npm test` includes offline hotseat reducer, protocol, coordinator and owner-lifecycle checks alongside existing campaign/MCP/panel tests. `test:desktop` opens the real Electron window with Playwright, uses synthetic campaign events, checks the renderer and bridge, exercises sheets/maps/seat switching/restart, and writes screenshots to a printed temporary directory. It does not invoke a model. It requires a graphical desktop; Playwright adds its own automation launch flags.

`test:antigravity` and `test:codex` are explicit opt-in integration tests against the selected installed, authenticated CLI and consume the host account's usage. Each tests connection, public narration, damage, movement, native image generation, registration, desktop composite rendering, exact duplicate submission and fresh-process conversation resume with a second character. Each creates a synthetic campaign in a temporary directory. Journal IPC/logs are private and embeddings deliberately use keyword fallback. Antigravity's permission-setting change is restored only if no concurrent settings edit occurred; it never stops or reconfigures the user's existing journal daemon. As with the CLI itself, test conversations can remain in the provider's own history. This smoke does not certify full rules adjudication or independent referee delegation.

`test:setup` is a separate opt-in Codex check that consumes account usage. It creates a temporary new campaign, verifies the DM's saved introductory questions, delegates a small adventure and two characters, checks the party/map/objective/opening and reviewed-play transition, and reconnects without repeating setup. It skips illustrated artwork and isolates journal IPC/logs with keyword fallback.

## Scope

Implemented: source-launched Electron app, Codex and Antigravity connection, new/open campaigns, public transcript, hotseat and LAN play, exact party information, map rendering, native artwork import and interruption recovery. Linux is the verified platform; signed installers, auto-updates, bundled Node, individual player accounts, click-to-move, and streamed public text are not implemented.

| Capability                                                                        | ChatGPT/Codex plugin                 | Electron: Codex / Antigravity                                          |
| --------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Campaign tools, exact state, sheets, inventory, dice, rules, history, corrections | Shared campaign service              | Same service and schemas                                               |
| Seven campaign skills and reviewed-play tools                                     | Host loads skills                    | Workspace skills plus turn instructions                                |
| Public maps, reveal masks, illustrated backgrounds                                | PNG tool results; host file handling | Same renderer; bounded native artifact import                          |
| Saved public narration, hotseat and coordinated LAN input                         | Domain tools available; host chat UI | Desktop/browser table coordinator                                      |
| Independent rules referee                                                         | Depends on host delegation           | Depends on CLI capability; explicit fallback required when unavailable |
| Export/import, validation, journal recovery                                       | Shared CLI                           | Shared CLI; no separate desktop data format                            |

Transport parity does not certify complete D&D rules adjudication, independent referee quality, model/image-generation entitlement, or a full campaign playthrough. The plugin's stdio entry point and read-only player panel remain unchanged.

## LAN multiplayer

Open a campaign, connect your selected provider, and choose **Host LAN game**. Scan the QR code on a phone connected to the same network, or copy the join link. Select the reachable network interface when several are listed. The host chooses an available port automatically; allow that port through the local firewall. Wi-Fi client isolation can prevent devices from reaching one another. HTTP hosting is for a trusted LAN, not internet exposure.

Players enter a name and claim an available character. **Open player seat** lets the host participate in a separate sandboxed window; open additional seats for local hotseat players. **Join LAN** also lets another Electron installation connect by link without its own CLI. The host can assign/release characters, remove a player, rotate invitations, pass for missing characters, or resolve the confirmed replies. Closing the main host app or changing campaigns stops sharing. Stopping sharing leaves the CLI and ordinary desktop usable.

Outside combat, assigned characters save shared, editable intentions and choose **Confirm intention** or **Pass**. The host dispatches the group when every active seat confirms. A disconnected seat remains required until the host handles it. **Send now** dispatches only that player's intention while idle; remaining intentions become drafts and require confirmation afterward. A client can prepare drafts while the DM works, but cannot confirm until the response finishes. Changes to gameplay also invalidate confirmations.

In combat, only the saved active character can confirm; other players can draft. The host uses **Continue NPC turn** when no player character is active. A structured DM decision/reaction request temporarily takes precedence over initiative and waits for the specified characters. During that request, other players cannot submit and Send now is disabled. Holding an intention does not perform the D&D Ready action. The agent is instructed to pause before committing an outcome that needs a reaction/decision; this is agent-guided adjudication, not a complete automatic reaction/rules engine.

Accepted intentions, grouped submissions, public prompts, and narration survive restart through campaign events. A browser retains its session credential and uncertain request ID in session storage so reload/retry does not rerun a saved action. Restarting hosting invalidates credentials, clears seat assignments, and resets confirmations; players rejoin and review drafts. Interrupted CLI work is never automatically replayed. An invitation can be reused until the host rotates it, so rotate it as well as removing a player if they should not rejoin.

All players see the same party-visible information and public holding area. There are no private sheets, separate chat channel, automatic network discovery, or cloud accounts. LAN clients cannot open campaigns, change CLI settings, invoke arbitrary MCP tools, retrieve campaign files, or read private CLI output. The independent read-only panel and ChatGPT/Codex plugin remain available.

`npm run test:lan` exercises phone/desktop browser layouts and reconnect/retry behavior using installed Chrome (`DM_CHROME` overrides its path). `npm run test:antigravity` now also exercises real LAN group input, a targeted reply, Send now, and native map generation with the host's authenticated account. It uses isolated temporary campaign/journal workspaces and restores its permission change if no concurrent settings edit occurred.

CLI turns allow up to ten minutes for native image generation and tool work. The host can stop an active turn at any time; timeout/stop preserves committed state and never automatically retries the CLI request.

## Developing the desktop

Edit `desktop/main.mts`, `desktop/preload.cts`, `desktop/app.ts`, and `desktop/lan.ts`; generated JavaScript belongs in `build/desktop/`. Run `npm run build` after edits, or `npm run desktop` to build and launch. Shared IPC/LAN interfaces and runtime request schemas live in `src/desktop/contracts.ts`. Keep privileged imports out of the browser UI and keep the sandboxed preload self-contained. No bundler or frontend framework is required.

`npm run typecheck` covers the core, Electron, and browser projects and refreshes ignored build outputs through TypeScript project references. `npm test` includes malformed IPC contract checks. `npm run test:desktop` and `npm run test:lan` exercise the emitted application rather than source JavaScript. Campaign files and the ChatGPT/Codex plugin entry points retain their existing locations and formats.

## Local multimodal DM with Ollama

Local mode is experimental. Qwen 3.5 9B has demonstrated durable recall and image interpretation, but the 32k-context stress runs have also produced malformed tool arguments, incomplete requested effects and repeated compaction. Memory guards enforce retrieval and note-saving steps; they cannot guarantee that a model follows a player request or narrates the saved state accurately. Start with 64k and inspect the authoritative sheet after mechanical actions.

Choose **Local · Ollama + Codex CLI**. This uses Codex as the agent harness and Ollama for local inference; ChatGPT login and API keys are not required. Install both CLIs, download a model, and start Ollama with adequate context. For a manually launched server on Linux/macOS:

```bash
ollama pull qwen3.5:9b
OLLAMA_NO_CLOUD=1 OLLAMA_CONTEXT_LENGTH=65536 OLLAMA_NUM_PARALLEL=1 ollama serve
```

Run the pull against an already running Ollama instance; if none is running, start the server first and pull from a second terminal. For an existing service or Ollama desktop installation, configure those settings in that runtime rather than starting a competing server. Do not restart unrelated services. See [Ollama context configuration](https://docs.ollama.com/context-length) and [local-only mode](https://docs.ollama.com/faq). Models and the journal embedding model require an initial download before offline use.

For a reproducible lower-temperature Qwen trial, save this as a `Modelfile` outside the source repository:

```text
FROM qwen3.5:9b
PARAMETER num_ctx 65536
PARAMETER temperature 0.2
```

Run `ollama create dm-qwen3.5:9b -f /path/to/Modelfile` and select `dm-qwen3.5:9b` in the app. This creates a separate local configuration using the downloaded weights; it does not replace the original model. Sampling parameters remain under the user's control through Ollama.

In the setup screen, set the loopback address (normally `http://127.0.0.1:11434`), model and context budget. **Inspect models & hardware** lists installed models, checks the selected model, and suggests Qwen 3.5 sizes based on detected RAM and accelerator memory. The model field accepts arbitrary installed model names; suggestions are not an allowlist. Both **vision (image input)** and **tool calling** are required. A generated Codex model catalog carries those capabilities into the harness; without it, an unfamiliar model name can silently lose image inputs. Capability checks do not certify gameplay quality. NVIDIA VRAM and Apple unified memory inform estimates; unrecognized GPUs get a conservative CPU/offload suggestion. Download sizes are not full runtime memory requirements, and larger context consumes additional memory.

The context budget defaults to 65,536 tokens, with a minimum of 32,768 because the campaign schemas and instructions need substantial space. It configures Codex's context accounting and automatic compaction at 70% of the budget. It does **not** change the Ollama server's context allocation. Connection checks inspect the actual running model's context and refuse a smaller allocation. A model-level `num_ctx` below the requested budget is rejected before inference. Start with 64k where practical; smaller budgets can spend more time compacting the campaign tool schemas and instructions. [Codex/Ollama guidance](https://docs.ollama.com/integrations/codex) recommends at least 64k.

Local mode uses an isolated Codex home under `.dm/hotseat/ollama-workspace/codex-home` and a separate `.dm/hotseat/ollama-session.json` locator. The locator includes endpoint, model and context configuration; changing them starts a new conversation from saved campaign memory. It never reuses ChatGPT credentials or falls back to a hosted model. Only loopback metadata endpoints are contacted by the application; model inference remains in the external Codex CLI. For local MCP image results, the server sends PNG plus text JSON without a separate structuredContent field, avoiding clients that prefer structured data and drop the image. The application's existing plugin and Antigravity connections retain their behavior. The app does not install models or reconfigure a running Ollama server.

### Memory and compaction

Before a local DM mutation or public reply, the desktop campaign server requires successful `resume_campaign` with DM audience, `search_campaign_history`, and an exact `read_campaign_record` when references exist. Search uses a small requested result count; if indexing is unavailable, recent references from resume can be read directly from authoritative events. Journal delivery being pending does not mean the game action failed.

Before publishing, a continuity record must have been saved since that player submission and after its most recent mechanics/review event. Instructions ask for concise decisions, promises, discoveries and unresolved choices, with DM secrets in separate private records. Exact retries still use their original operation IDs. These checks enforce use of memory tools, not the factual quality or relevance of a model's notes. The plugin and other desktop providers do not acquire this additional workflow guard.

Native Codex compaction runs through the selected local model. Its summary prompt preserves pending requests/actions, operation IDs, saved rolls and record references, and directs the DM to reload authoritative state and relevant memory afterward. Summaries never replace campaign events. After a mid-turn compaction, the adapter steers that same active turn with a bounded copy of the current request and an explicit reminder to reload state and avoid repeating effects. A failed handoff stops without replay. The UI shows a generic compaction status; private summaries never enter the public transcript. Local mode rejects oversized submissions before saving them (combined text and group intentions are limited to one quarter of the context budget in UTF-8 bytes). Local prompts bound their recent-table excerpt and omit the artwork skill and unnecessary campaign-creation instructions during established play. Interrupted compaction/turns preserve saved effects and are not automatically replayed. Eight consecutive failed campaign-tool calls stop a local turn with an attention message; a successful call resets this failure budget.

Local mode can interpret rendered images and use existing illustrated maps, but it currently has no image-generation backend. Schematic maps remain available. A separate local image worker is future work. Independent referee availability and rules/narrative quality still depend on the harness and model; the existing explicit fallback remains required when delegation is unavailable.

### Local integration test

```bash
DM_LOCAL_ENDPOINT=http://127.0.0.1:11434 npm run test:local
```

`DM_LOCAL_MODEL` selects another multimodal tool-capable model. The test defaults to the application's 64k budget and always checks explicit compaction and process resume. To stress automatic compaction, set `DM_LOCAL_CONTEXT=32768 DM_REQUIRE_AUTO_COMPACT=1`; this additionally requires an automatic compaction event. It seeds only synthetic temporary campaign data, isolates its journal daemon, and checks recall, exact damage and duplicate protection, image interpretation, compaction and process resume. It performs no direct model API calls. Set `DM_KEEP_LOCAL_TEST=1` to retain the temporary artifacts for inspection. Passing this scenario does not certify long-campaign quality or rules adjudication.
