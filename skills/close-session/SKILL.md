---
name: close-session
description: End or pause a D&D session by saving detailed scene records, a player recap, DM notes and unresolved choices through Dungeon Master tools.
---

Read campaign_status and relevant current entities. Finish saving any resolved mechanical effects through apply_campaign_changes; leave proposals and pending rolls unresolved.

Use record_scene for unsaved narrative details. Then call checkpoint_session with a concise player-facing summary and unresolved choices. Put secrets and future plans only in dmNotes. The checkpoint updates the current scene summary and unresolved list; it does not end combat, restore resources or advance time automatically.

Reuse the operationId and exact input after an uncertain response. On a revision conflict, read current state before creating a replacement operation. A journal-pending result means authoritative history is saved; retry delivery without repeating gameplay.

Call resume_campaign with audience=party to verify the resume point. Report the saved revision, current location or encounter, next pending choice and any storage delivery limitation. Never say the entire conversation was archived: records contain the scene details explicitly saved by the DM.
