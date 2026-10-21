# Dungeon Master

Read README.md and docs/architecture.md before changes. Run npm test and npm run typecheck after changes to behavior. Test journal integration with npm run test:journal in isolated temporary workspaces; never stop or reconfigure the user's existing journal daemon.

The event history is authoritative. All mutations go through CampaignStore.transact and typed reducers; do not modify saved events or derive current properties from RAG search. Preserve operation IDs on retry. Journal tools are internal, never exposed as raw passthrough tools. No model API calls. Campaign data belongs outside this source repository.
