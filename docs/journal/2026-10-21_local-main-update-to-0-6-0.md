# Local main update to 0.6.0

## Context and decisions

Updated the existing local source checkout from `a145358` to `6d298ab` by fetching origin and fast-forwarding main. Seven commits add story and maps, conversational sheets, the read-only player panel, reviewed-play workflows, bundled SRD sections, and MCP schema compatibility updates. The previous untracked machine setup note was preserved.

The user prefers starting a new campaign rather than refreshing the old campaign's generated plugin. No personal campaign configuration, plugin copy, event history, or assets were changed. New campaign initialization will generate the current 0.6.0 manifest and seven skills. Existing installed campaign plugin caches were not modified.

## Completed setup

Installed the current lockfile with `npm ci`, regenerated the ignored development journal connection, built and packaged the plugin, and refreshed the linked CLI commands with `npm link`. Preserved the existing local embedding model cache outside node_modules before dependency reinstallation and restored it afterward. The bundled rules corpus is already generated and committed; no runtime download or regeneration is needed.

## Verification actually completed

- `npm ci`: successful, zero audit vulnerabilities.
- `npm run journal:setup`: successful.
- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test`: all 49 tests passed, including new map rendering, panel HTTP, sheets, rules corpus, and referee workflows.
- `TMPDIR=/private/tmp npm run test:journal`: isolated pinned journal MCP integration passed.
- `npm run package:plugin`: generated the ignored portable plugin and archive.
- `npm link` and `dungeon-master --help`: successful; the panel command is present.
- Pinned journal module resolution and Sharp 0.35.5 loading: successful.
- Local HEAD equals origin/main at `6d298ab`; tracked source files remain unmodified.

The short canonical TMPDIR avoids the macOS path-equality and Unix socket path-length issues identified during the original machine setup.

## Limitations and next steps

Create a newly named campaign with the updated CLI, open its folder as a trusted Codex project, install its generated plugin, and start a fresh conversation. Only the intended campaign plugin should be active. App plugin discovery and live skill selection were not exercised during this update. The existing campaign's installed plugin still has its previous skill copy; it has not been migrated.

The project journal MCP tools were not loaded in this conversation. Relevant journal files were searched directly and this Markdown entry was written as the AGENTS.md fallback. No commit or push was performed.
