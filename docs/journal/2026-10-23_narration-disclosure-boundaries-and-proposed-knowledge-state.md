# Narration disclosure boundaries and proposed knowledge state

## Context

Read-only engineering investigation into over-disclosure and overly prescriptive DM narration. Campaign-specific examples and private material are intentionally excluded from this public engineering journal.

## Findings and rationale

`skills/run-campaign/SKILL.md` requires separation of party facts, rumors and DM plans, but also encourages concrete next actions without sufficiently distinguishing observable opportunities from hidden solutions or predicted outcomes. `src/schema.ts` provides NPC interaction `knows` and `disclosed` string arrays. `src/service.ts` resume includes relevant interactions and recent record references. Audience filtering protects structured private content, but authored public prose is not automatically redacted, as documented in `docs/architecture.md`.

## Proposed work — not implemented

Strengthen narration guidance to describe perception, attribute testimony, avoid omniscient conclusions and unsolicited solution menus, preserve fair warnings about apparent risks, and keep operational metadata out of ordinary narration. Consider narrow event-backed facts with canonical DM truth, public description, disclosure evidence and knowledge recipients. Surface relevant facts directly in the DM resume packet; journal history remains supporting evidence rather than current knowledge state. Distinguish established truth, NPC claims, player hypotheses and future plans. Reveal conditions should allow unexpected valid discovery methods. A ledger cannot guarantee secrecy once hidden information is in the narrator context.

## Completed investigation and verification

Read README, architecture, run/create skill text, resume implementation, interaction schemas, provider prompt excerpts and historical engineering notes. A bounded read-only design review corroborated existing support and gaps. No gameplay behavior or campaign data was modified. Existing unrelated working-tree changes were left intact. No tests were run because this was a design investigation.

## Next steps

Discuss scope with the user before implementing schema changes. Prefer an initial narration-guidance improvement followed by a narrow durable knowledge model if needed. Validate future changes with synthetic disclosure examples and replay/projection tests, including restart and partial disclosure; never put real campaign records in this repository.
