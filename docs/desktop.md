# Electron hotseat MVP

## Launch and setup

Install Node 22.12 or newer, Git, and Antigravity CLI. Run `agy` once in your terminal and finish its sign-in. From this checkout, run:

```bash
npm ci
npm run desktop
```

The desktop detects an executable on PATH or under `~/.local/bin`. Choose **Choose executable** if needed. Detection checks the version and streaming flags; authentication and campaign access are verified when connecting through an actual `campaign_status` call. That connection check consumes a small CLI turn. The app never reads or copies authentication tokens and makes no direct model API calls.

Create a campaign with a name, folder and edition, or choose a folder containing `campaign.json`. Campaigns belong outside the source/application directory; the default is `~/Campaigns`. Creation uses the existing CLI initializer, including its local Git repository, setup review policy and campaign-bound ChatGPT/Codex plugin configuration. Git repositories are not automatically committed or pushed.

The first connection generates `.dm/hotseat/workspace/.agents/mcp_config.json`, copies the seven campaign skills into that workspace and merges `mcp(dm-hotseat-<campaign-path-hash>/*)` into the CLI's global `permissions.allow` list. Antigravity 1.4 uses global permission rules even for workspace-local servers. Only that exact server grant is added; unrelated settings and deny/ask lists remain intact. No global MCP server or plugin is installed. The CLI starts in this dedicated workspace, with an explicit campaign-bound MCP command.

This permission grant persists after closing the app. Remove the corresponding rule in `~/.gemini/antigravity-cli/settings.json` if retiring a campaign; reconnecting will add it again. A conflicting ask/deny rule can prevent connection and is not overridden. Reconnect after moving the checkout to regenerate desktop runtime paths. Existing ChatGPT plugin paths follow the normal `dungeon-master setup` guidance.

## Playing

The shared screen shows public narration, revealed maps, visible party characters and their exact saved sheets. Click a character to speak as them, or **Table** during setup or group decisions. **Pass seat** selects the next party member. Submit with **Send** or Ctrl/Cmd+Enter. There is one active action at a time. The DM can ask clarification questions through the same public transcript.

The agent uses the existing campaign skills for creation, adjudication, state updates and rules-referee fallback. New campaigns begin in setup mode. Describe your party and preferences to begin; the DM creates the opening and enables reviewed play once verified. Independent referee delegation depends on the host's capabilities. When unavailable, the existing explicit administrative fallback applies; the desktop does not certify independent review.

Map controls choose a map, change grid viewport size, pan or center on the selected character. The default view fits the saved bounds up to 40 cells per dimension and shows the map without document margins. **Legend** restores the full coordinate and marker key; click the scene title to read its summary. The ChatGPT map images and read-only web panel retain their full document view. Characters' HP, resources, items and positions come from authoritative event state. Asking the DM to move is currently a conversational action; dragging tokens and click-to-move are not implemented. Reveals are explicit, without automatic line of sight. Illustrated backgrounds use native Antigravity image generation and the create-map-art skill: a clean saved-geometry reference, generation, campaign-local asset import, registration and a live composite with labels, markers and fog. Existing artwork is reused as characters move. Missing, changed, stale or concealed artwork falls back to the schematic and shows a warning beside the map. You can ask the DM to skip artwork.

Only `publish_table_message` responses enter the public transcript. Raw CLI output, tool results and referee deliberations are not displayed. Public messages appear when saved, rather than token by token. The DM still must author public prose without secrets; neither the app nor the plugin can automatically redact all spoilers. Hotseat is one trusted operator with a shared party view, not individual player authorization. Narration is rendered as literal text, without executing HTML or loading remote resources.

The desktop-only `import_generated_map_art` tool copies bounded PNG/JPEG/WebP output from the connected Antigravity conversation into content-addressed campaign assets; it rejects other conversation paths, symlinks and invalid images. Reference PNGs are mirrored inside the dedicated CLI workspace for native image conditioning. Registration still uses the existing typed `register_map_art` transaction. No shell permission, extra global file grant or model API is needed. The ordinary ChatGPT plugin keeps its existing host file-handling workflow.

## Stop, restart and recovery

**Stop DM** stops this app's owned CLI process tree. Saved events remain intact. If a turn ends without a published response, fails, times out or is interrupted, the app marks it for attention. Review the map and sheet, reconnect, and ask for a recap before taking another action. Do not resubmit uncertain damage or dice requests as new actions.

Player submissions carry durable IDs. Retrying the same submission returns its existing record and does not call the agent again. Mechanical tool retries retain their existing operation IDs through the normal campaign tools. Public transcript events are included in campaign export/import. The `.dm/hotseat/session.json` file stores only the CLI conversation locator; it is optional context, not game state. **Reset DM context** drops that locator and reconnects against the same authoritative campaign.

Opening a campaign recovers any unfinished table request as interrupted. A per-campaign desktop lease prevents a second desktop session. After a hard crash, the lease can take about 30 seconds to expire. The desktop-only MCP wrapper checks its owner process/token before every tool call and every second, and shuts down when ownership disappears. The ordinary ChatGPT/Codex MCP entry point is unchanged. Avoid simultaneously playing the same campaign from a separate trusted CLI or ChatGPT session; revision checks protect state consistency but do not coordinate two DM conversations.

On Linux with DISPLAY, the launcher selects XWayland because native Wayland startup stalled on the development machine. Set `DM_DESKTOP_OZONE=wayland` to opt into native Wayland. The renderer has Node access disabled, context isolation and sandboxing enabled, a restrictive CSP, no external navigation and a narrow IPC bridge. The Node worker uses the Node executable that launched the app so the plugin and journal dependencies do not depend on Electron's native module ABI.

## Verification

```bash
npm test
npm run typecheck
npm run test:journal
npm run test:desktop
npm run test:antigravity
npm run package:plugin
```

`npm test` includes offline hotseat reducer, protocol, coordinator and owner-lifecycle checks alongside existing campaign/MCP/panel tests. `test:desktop` opens the real Electron window with Playwright, uses synthetic campaign events, checks the renderer and bridge, exercises sheets/maps/seat switching/restart, and writes screenshots to a printed temporary directory. It does not invoke a model. It requires a graphical desktop; Playwright adds its own automation launch flags.

`test:antigravity` is an explicit opt-in integration test against the installed, authenticated CLI and uses the host account's usage. It tests connection, public narration, damage, movement, native image generation, registration, desktop composite rendering, exact duplicate submission and fresh-process conversation resume with a second character. It creates a synthetic campaign in a temporary directory. Journal IPC/logs are private and embeddings deliberately use keyword fallback. Its permission-setting change is restored only if no concurrent settings edit occurred; it never stops or reconfigures the user's existing journal daemon. As with the CLI itself, test conversations can remain in Antigravity's own history. This smoke does not certify full rules adjudication or independent referee delegation.

## Scope

Implemented: source-launched Electron app, guided Antigravity connection, new/open campaigns, public transcript, hotseat selection, exact party information, maps and interruption recovery. Antigravity 1.4.4 on Linux was exercised. Other operating systems are not yet verified.

Not implemented: signed installers/auto-updates, bundled standalone Node runtime, LAN player input/discovery, individual player accounts, other CLI adapters, streamed public text or a complete rules engine. The existing optional LAN panel remains read-only and retains its prior behavior.
