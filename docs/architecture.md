# Architecture

## Boundaries

`CampaignService` exposes D&D operations without depending on a transport. `createMcpServer` binds those operations to MCP; `serve` supplies local stdio. `CampaignStore` handles validated events and filesystem persistence. `JournalAdapter` converts campaign records/search into calls through the `JournalBackend` interface. `McpJournal` is the implementation using the pinned upstream server, not its private daemon modules.

Each server is bound to one canonical campaign root. Public tools accept entity IDs and `record:<id>` references, not workspace paths. Paths used for journal access are derived from the bound corpus, validated and checked for symlinks. Upstream's unrestricted `get_entry` is never exposed directly.

## Records and invariants

`campaign.json` is schema version 1 configuration. `events/NNNNNNNNNN-<uuid>.json` is authoritative. Events include revision, operation ID, normalized request hash, timestamp, actor/reason, session/scene references and typed payload. The payload contains changes, optional dice, journal records, or a correction target.

All writes take a per-campaign cross-process filesystem lock with heartbeat. The service validates a complete batch against a cloned state before writing a temporary event, fsyncing it, atomically renaming it and syncing the directory. Readers see only complete `.json` files; temporary files are ignored. Event numbering and operation/record uniqueness are checked on replay. The state snapshot is best-effort and never trusted over replay. A failure after commit may produce an uncertain client result; an exact retry recovers the committed event.

Request hashes prevent reusing an operation ID for different input. A repeated identical operation returns the original event and current state/revision. A different new operation with a stale revision fails. Corrections are explicit compensating changes, not rollback of the full campaign.

This is designed for a single local filesystem and one operator. Do not run concurrent writers over Git synchronization, network shares or independently mounted copies. Filesystem locks coordinate processes on the same filesystem; Git is not a distributed transaction coordinator.

## Journal delivery and retrieval

Narrative content is first saved inside an event. The queue is derived by comparing those records to Markdown carrying their IDs; no separate queue database is necessary. Delivery uses the campaign lock, verifies content, and forwards missing records to `write_entry`. Unique IDs lead the title to survive upstream slug truncation. Successful file writes with lost acknowledgements are recognized on retry. Conflicting or partial derived files stop delivery and are reported; they are not silently rewritten.

Journal delivery and event commits are not one distributed transaction. A journal outage leaves game state committed, content recoverable and delivery pending. Resume/checkpoint and the CLI `journal-sync` retry delivery. Search is explicitly unavailable when the backend fails. Upstream may search with BM25 while vectors initialize or fail. Delivery-ready only means Markdown delivery completed; it does not guarantee vector indexing completed.

Search admits only results mapped to known committed records whose current Markdown matches authoritative content. Party search filters DM-only records. `read_campaign_record` first uses the journal when possible and otherwise returns exact content from the event history.

## Model boundary and visibility

The model adjudicates rules, chooses narrative content and decides what to save. Tools cannot guarantee that every spoken sentence or chat turn is captured. Skills require immediate mechanical writes and detailed scene records at boundaries. “Saved” means an actual committed event, not a narrative promise.

Current properties are exact lookups. History retrieval supplies background and evidence; it never recalculates current HP or inventory. Resume packets select party characters, owned items, quests, the current scene/encounter and recent history references. Full entities remain individually readable.

Party views remove DM-only entities, planned entities, their relationships and references, private records and private dice. Graph maps expose revealed nodes and edges only. Grid images use explicit revealed-cell/region masks; there is no automatic line-of-sight engine. Player images are generated independently from filtered state; hidden markers, labels, features and legend entries never reach their renderer. Legacy image references are omitted from party views. Put sensitive map images in separate DM-only entities. Descriptions, configuration and scene prose are not automatically redacted: skills must place secrets in separate DM records/entities.

The operator can request audience=dm and inspect local files. Player filtering is not authentication or a secrecy guarantee against that operator. Authenticated player accounts are out of scope.

## Portability and recovery

Export contains validated configuration, ordered events and assets. Import requires a new directory, validates the history and reconstructs it without reusing caches. Markdown can be regenerated by journal-sync. Schema version 1 is the only supported version; unsupported versions fail validation rather than guessing a migration.

No automatic commits, pushes, model calls or cloud deployments. Runtime caches and locks are disposable; authoritative events and assets need durable backups. Git history detects/reviews manual changes, but event files are not cryptographically signed.

## Story and map increment (0.2.0)

Optional story/map fields retain schemaVersion 1; existing event files are never rewritten. Story focus, quest progress, NPC interaction topics and explicit pressure triggers are current event-backed state. Resume excludes inactive quests while exact lookups retain them. An explicit roster controls group membership. Regional/tactical map levels separate placements; new set_positions removes selected entities from other maps at the same level without changing scene location. Legacy move_token replay remains unchanged.

Map creation saves graph drawing coordinates. src/maps.ts produces a deterministic SVG internally and rasterizes with direct Sharp; MCP returns PNG image blocks plus structured metadata. A mutation commits first, then replays its saved revision for rendering. Exact retries use the original revision even after later changes. Rendering failures leave gameplay committed; render-only recovery accepts that revision. Derived files are keyed by map, revision, audience and viewport in .dm/maps. They are excluded from export; original assets and event definitions survive import, and rendering regenerates the schematic. Byte equality is tested on the same renderer/font environment, not promised across different Sharp/font versions.

Optional host image generation is an agent skill, never a model API integration. Generated art is stored under assets with audience, purpose and source revision. It is displayed independently from tactical geometry.

## Conversational sheets (0.3.0)

src/sheets.ts derives full character sheets and compact party overviews from one audience-filtered state snapshot. Service lookups read authoritative events once, then join visible owned items and map placements without consulting journal history or writing caches. Unlike resume, full sheet inventories have no entity-count cutoff. The player-sheet skill uses fresh tool results and explicit source revisions; no independent sheet storage or synchronization is required.

## Player dashboard (0.4.0)

`dungeon-master panel` starts an independent, campaign-bound HTTP reader. It does not instantiate the journal adapter or expose CampaignService as HTTP RPC. `/api/state` projects one replayed snapshot into party sheets, active quests, current scene/focus, visible map summaries and encounter order. The projection uses the existing visibility rules; public prose must still be authored without secrets. A hidden active participant has no active player highlight (filtered encounter turn is -1, a projection-only sentinel never persisted).

`/api/map` requires mapId and revision, with optional x/y/width/height as a complete viewport. It renders a party schematic in memory, checks the revision again after rendering, and returns 409 if state has advanced. The browser discards obsolete responses. Eight PNGs at most are cached in memory, cleared at revision changes; rendering is serialized with busy responses. Panel reads do not write campaign files. There is no schema migration.

The server serves only bundled UI and two authenticated GET endpoints. Random per-run bearer tokens are passed in URL fragments and retained in browser session storage, never query strings or server logs. Restart invalidates old links. Host/origin checks, a restrictive CSP, text-only prose rendering, no CORS and no-store responses complement the token boundary. LAN mode enables IPv4 listening explicitly. It uses HTTP on trusted networks; it is not public hosting or individual player authorization.
