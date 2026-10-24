# Event-backed DM knowledge ledger implementation

## Context and decisions

Implemented the scoped durable knowledge ledger requested after the narration-disclosure investigation. Facts are typed, event-backed state rather than entities or journal records. Each fact has a stable ID, canonical truth kind and text, linked entities, known character/NPC holders, an optional observable description, nonbinding discovery hints, and explicit disclosure evidence. Disclosure audience and type remain independent from canonical truth, so confirming that a claim was heard does not establish that the claim is true.

A typed `set_knowledge` change replaces the complete fact at its stable ID. Existing event history remains authoritative and exact operation retries recover the saved event. Character/NPC and linked-entity references are validated. The set_knowledge change is nonmechanical in reviewed-play classification but contributes to the gameplay fingerprint, so it can make a pending review stale.

Party projections remove the entire ledger. DM resume returns relevant facts with a 100-fact detail limit, total count, all fact IDs for exact follow-up lookup, and a truncation flag. `get_campaign_knowledge` reads an exact fact for DM audience; party audience receives NOT_FOUND. Ordinary entity descriptions remain the place for public content.

## Completed changes

- Added KnowledgeFact and KnowledgeDisclosure schemas, State.knowledge and set_knowledge reduction.
- Added reference validation for linked entities, knowledge holders and character disclosure recipients.
- Added party projection stripping, DM resume relevance/count/truncation/IDs, exact lookup service and MCP registration.
- Classified set_knowledge as nonmechanical while retaining its gameplay-fingerprint effect.
- Added event retry, replay, export/import, privacy, reference validation, legacy-state, resume relevance/truncation and MCP exposure tests.

## Verification

- `npm run typecheck` passed.
- `npm run build` passed.
- `node --test test/knowledge.test.mjs test/mcp.test.mjs` passed: 6 tests.
- The full test suite remains for the parent task to run.

## Known limitations

The ledger guides the DM but does not itself prevent a narrator from leaking text already present in context. Disclosure records capture what the DM records; they cannot prove that every spoken or seen detail was saved. Resume fact ID lists are not paginated and can grow with a very large campaign ledger.

## Next steps

Run the full suite and review the combined prompt and documentation changes. Keep campaign data out of this repository and do not commit automatically.