---
name: maintain-campaign
description: Inspect campaign history or correct D&D bookkeeping inconsistencies using Dungeon Master records and explicit compensating events.
---

Identify the disputed property and inspect authoritative current state with get_campaign_entity. Use search_campaign_history and read_campaign_record for historical context. A narrative discrepancy does not override current properties automatically.

For an authorized correction, identify the original event from prior tool results or the local immutable event history. Explain the correction when its intended effect is unclear. Call correct_campaign_event with that eventId, current expectedRevision, a fresh operationId, reason and explicit compensating changes. Account for subsequent legitimate actions; do not blindly restore an old snapshot. Read a full entity before using put_entity, which replaces it.

Narrative corrections should be new records explaining what supersedes the older account, with references to the old record. Do not erase prior journal entries or mutate event JSON. Duplicate requests must reuse the original operationId and exact input.

Use dungeon-master validate for local structural checks and export for a portable backup when requested. Use journal-sync to retry pending narrative delivery. If a derived journal file conflicts with committed history, preserve a backup and explain the conflict before repairing it; do not rewrite authoritative events to match the derived file.

Verify affected properties and summarize the resulting revision. Never resolve missing history by inventing events or treating a future DM plan as established canon.
