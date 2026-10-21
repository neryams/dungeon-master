# Dungeon Master

Read README.md and docs/architecture.md before changes. Run npm test and npm run typecheck after changes to behavior. Test journal integration with npm run test:journal in isolated temporary workspaces; never stop or reconfigure the user's existing journal daemon.

The event history is authoritative. All mutations go through CampaignStore.transact and typed reducers; do not modify saved events or derive current properties from RAG search. Preserve operation IDs on retry. Journal tools are internal, never exposed as raw passthrough tools. No model API calls. Campaign data belongs outside this source repository.

## Development journal

This source project has its own **project_journal** MCP connection for engineering progress. Direct journal tool use is appropriate here; the restriction above applies to the shipped campaign tools. Development notes live in `docs/journal/`, configured by `journal-rag.config.json`. Never put actual campaign records, private player information, credentials, or secrets here: this is a public repository.

Install dependencies with `npm ci`, then run `npm run journal:setup`. This uses the already pinned optional journal-rag dependency and generates an ignored `.codex/config.toml` with absolute Node/server/workspace paths. Open this repository as a trusted Codex project and start a new session to load its MCP tools. Rerun setup after moving the checkout or Node installation. Setup preserves other config and replaces only its own marked block. Do not add this development server to the campaign plugin's `mcp.json` or global Codex config. See [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

At the start of substantive work, use `search_journal({query, k: 5})` for related decisions, progress and open issues. Use `list_entries({filter})` to browse and `get_entry({path})` to read the full relevant entries; use `search_regex({pattern, k})` for exact symbols or paths. Treat old notes as historical evidence and verify current code and Git status.

After a meaningful milestone, decision, investigation or handoff, call `write_entry({title, content})`. Use a specific unique title and Markdown beginning with `# Title`, followed by context, decisions and rationale, completed changes, verification actually run, known limitations, and concrete next steps. Distinguish planned work from implemented work. Include relevant repo-relative paths and commit IDs when known. Before retrying an uncertain write, list/read the dated entry: upstream writes are not idempotent and duplicate titles on the same UTC date fail. Add follow-up entries to supersede old conclusions rather than silently rewriting history.

If MCP tools are unavailable in the current session, read/search `docs/journal/` directly and create an equivalent dated Markdown entry there; report that fallback. The Markdown is authoritative and the ignored `.journal-rag/` index is rebuildable. Keep journal entries with the related source changes for review; do not commit or push automatically. Never stop or reconfigure another workspace's shared daemon. Initial embeddings may take time; keyword fallback does not prove semantic indexing is ready.
