# Electron tabletop

## Launch and setup

Install Node 22.12 or newer, Git, and either Codex CLI or Antigravity CLI. For Codex, run `codex login` and sign in with ChatGPT. For Antigravity, run `agy` and finish its sign-in. Select **Codex CLI** or **Antigravity CLI** under **DM provider**. From this checkout, run:

```bash
npm ci
npm run desktop
```

The desktop detects an executable on PATH or under `~/.local/bin`. Choose **Choose executable** if needed. Detection checks the version and provider protocol support; authentication and campaign access are verified when connecting through an actual `campaign_status` call. That connection check consumes a small CLI turn. The app never reads or copies authentication tokens and makes no direct model API calls.

Create a campaign with a name, folder and edition, or choose a folder containing `campaign.json`. Campaigns belong outside the source/application directory; the default is `~/Campaigns`. Creation uses the existing CLI initializer, including its local Git repository, setup review policy and campaign-bound ChatGPT/Codex plugin configuration. Git repositories are not automatically committed or pushed.

An Antigravity connection generates `.dm/hotseat/workspace/.agents/mcp_config.json`, copies the seven campaign skills into that workspace and merges `mcp(dm-hotseat-<campaign-path-hash>/*)` into the CLI's global `permissions.allow` list. Antigravity 1.4 uses global permission rules even for workspace-local servers. Only that exact server grant is added; unrelated settings and deny/ask lists remain intact. No global MCP server or plugin is installed. The CLI starts in this dedicated workspace, with an explicit campaign-bound MCP command.

This permission grant persists after closing the app. Remove the corresponding rule in `~/.gemini/antigravity-cli/settings.json` if retiring a campaign; reconnecting will add it again. A conflicting ask/deny rule can prevent connection and is not overridden. Reconnect after moving the checkout to regenerate desktop runtime paths. Existing ChatGPT plugin paths follow the normal `dungeon-master setup` guidance.

## Codex connection

Codex runs as an app-owned `codex app-server --listen stdio://` process, using the installed CLI's existing ChatGPT authentication and configured model. It requires no API key and does not read/copy tokens. The adapter checks `account/read`, starts or resumes a thread, and requires a successful `campaign_status` tool result from the bound server before reporting readiness. This was developed against Codex CLI 0.162.1; other releases must support the same app-server protocol. [Official app-server documentation](https://learn.chatgpt.com/docs/app-server).

The dedicated workspace is `.dm/hotseat/codex-workspace`; all seven campaign skills are copied there. Runtime thread overrides bind the same owner-checked desktop MCP server, disable unrelated configured MCP servers/plugins, shell execution and web search, and request a read-only sandbox. Global Codex settings and the campaign's ordinary plugin configuration are not rewritten. Campaign tools perform writes through the existing service and transaction rules. CLI-managed native image generation remains available when supported by the configured model/account. Raw protocol/model output is private; only saved public messages reach the table.

Choose **Campaigns** to return to setup and change providers. Each provider remembers its own executable and conversation locator. Switching providers reads the same authoritative campaign history; it does not share private conversation context. **Reset DM context** resets only the selected provider, durably removing its previous locator even if reconnect fails. Missing/unusable Codex context stops with an error rather than silently creating a replacement conversation or replaying an uncertain action. Interactive CLI approval prompts are not supported in the tabletop; such requests stop the turn with an attention message. Player questions must use the public transcript/response-request tools.

## Playing

The shared screen shows public narration, revealed maps, visible party characters and their exact saved sheets. Click a character to speak as them, or **Table** during setup or group decisions. **Pass seat** selects the next party member. Submit with **Send** or Ctrl/Cmd+Enter. There is one active action at a time. The DM can ask clarification questions through the same public transcript.

The agent uses the existing campaign skills for creation, adjudication, state updates and rules-referee fallback. New campaigns begin in setup mode. Describe your party and preferences to begin; the DM creates the opening and enables reviewed play once verified. Independent referee delegation depends on the host's capabilities. When unavailable, the existing explicit administrative fallback applies; the desktop does not certify independent review.

Map controls choose a map, change grid viewport size, pan or center on the selected character. The default view fits the saved bounds up to 40 cells per dimension and shows the map without document margins. **Legend** restores the full coordinate and marker key; click the scene title to read its summary. The ChatGPT map images and read-only web panel retain their full document view. Characters' HP, resources, items and positions come from authoritative event state. Asking the DM to move is currently a conversational action; dragging tokens and click-to-move are not implemented. Reveals are explicit, without automatic line of sight. Illustrated backgrounds use native provider image generation and the create-map-art skill: a clean saved-geometry reference, generation, campaign-local asset import, registration and a live composite with labels, markers and fog. Existing artwork is reused as characters move. Missing, changed, stale or concealed artwork falls back to the schematic and shows a warning beside the map. You can ask the DM to skip artwork.

Only `publish_table_message` responses enter the public transcript. Raw CLI output, tool results and referee deliberations are not displayed. Public messages appear when saved, rather than token by token. The DM still must author public prose without secrets; neither the app nor the plugin can automatically redact all spoilers. Hotseat is one trusted operator with a shared party view, not individual player authorization. Narration is rendered as literal text, without executing HTML or loading remote resources.

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
npm run package:plugin
```

`npm test` includes offline hotseat reducer, protocol, coordinator and owner-lifecycle checks alongside existing campaign/MCP/panel tests. `test:desktop` opens the real Electron window with Playwright, uses synthetic campaign events, checks the renderer and bridge, exercises sheets/maps/seat switching/restart, and writes screenshots to a printed temporary directory. It does not invoke a model. It requires a graphical desktop; Playwright adds its own automation launch flags.

`test:antigravity` and `test:codex` are explicit opt-in integration tests against the selected installed, authenticated CLI and consume the host account's usage. Each tests connection, public narration, damage, movement, native image generation, registration, desktop composite rendering, exact duplicate submission and fresh-process conversation resume with a second character. Each creates a synthetic campaign in a temporary directory. Journal IPC/logs are private and embeddings deliberately use keyword fallback. Antigravity's permission-setting change is restored only if no concurrent settings edit occurred; it never stops or reconfigures the user's existing journal daemon. As with the CLI itself, test conversations can remain in the provider's own history. This smoke does not certify full rules adjudication or independent referee delegation.

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
