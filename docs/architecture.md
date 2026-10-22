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

Optional host image generation is an agent skill, never a model API integration. For an illustrated map, `render_location_map` mode `reference` produces a clean terrain/layout guide for an exact viewport, without transient markers, title, legend or text labels; grid lines and feature shapes remain visible as geometry guides. The host generates a background, which is stored under assets and registered with audience, purpose, source revision and a coordinate extent. The extent maps the full image edges to the viewport's map-coordinate cell boundaries. Registration records a SHA-256 content hash and a static map-geometry hash. Normal `mode=map` rendering uses the latest eligible background only while those hashes remain valid, then draws live markers, grid, labels and reveal masks above it. Missing, invalid or stale art produces a warning and falls back to the schematic. Grid party fog remains opaque over unrevealed cells. A graph party background is withheld until every original node and edge is revealed, so graph artwork must be authored entirely party-safe. Artwork never changes event-backed coordinates or topology; a map change affecting movement/topology needs an explicit typed map update and a new reference/background.

For party backgrounds, concealing a feature inside an otherwise visible cell (or a graph background extent) also withholds the artwork and falls back to the schematic. A painting cannot selectively erase that feature. Concealed grid features already covered by opaque cell fog do not suppress the rest of the background.

## Conversational sheets (0.3.0)

src/sheets.ts derives full character sheets and compact party overviews from one audience-filtered state snapshot. Service lookups read authoritative events once, then join visible owned items and map placements without consulting journal history or writing caches. Unlike resume, full sheet inventories have no entity-count cutoff. The player-sheet skill uses fresh tool results and explicit source revisions; no independent sheet storage or synchronization is required.

## Player dashboard (0.4.0)

`dungeon-master panel` starts an independent, campaign-bound HTTP reader. It does not instantiate the journal adapter or expose CampaignService as HTTP RPC. `/api/state` projects one replayed snapshot into party sheets, active quests, current scene/focus, visible map summaries and encounter order. The projection uses the existing visibility rules; public prose must still be authored without secrets. A hidden active participant has no active player highlight (filtered encounter turn is -1, a projection-only sentinel never persisted).

`/api/map` requires mapId and revision, with optional x/y/width/height as a complete viewport. It renders a party map, including any eligible illustrated background, in memory, checks the revision again after rendering, and returns 409 if state has advanced. The browser discards obsolete responses. Eight PNGs at most are cached in memory, cleared at revision changes; rendering is serialized with busy responses. Panel reads do not write campaign files. There is no schema migration.

The server serves only bundled UI and two authenticated GET endpoints. Random per-run bearer tokens are passed in URL fragments and retained in browser session storage, never query strings or server logs. Restart invalidates old links. Host/origin checks, a restrictive CSP, text-only prose rendering, no CORS and no-store responses complement the token boundary. LAN mode enables IPv4 listening explicitly. It uses HTTP on trusted networks; it is not public hosting or individual player authorization.

## Referee-reviewed play (0.5.0)

Review policy and actions are optional event-backed state. Old histories replay in legacy mode; CLI init now records setup mode as its first event. The campaign-opening skill transitions to reviewed mode after verification. Policies are administrative events and cannot change while an action is pending. No historical event or schema version is rewritten.

The host delegates a bounded rules-referee task with the primary model inherited. The MCP service does not invoke models. It records prepared packets, pre-roll rulings, roll-step specifications/results, post-roll approval of exact typed effects, and an atomic commit. Actor/model metadata is descriptive: the server cannot authenticate that a different agent authored a response. Enforcement guarantees the review protocol, current state, exact approved changes and bookkeeping constraints, not the correctness of a model's interpretation.

Review guards live in the reducer, covering every existing mutation entry point, entity replacements and corrections. In reviewed mode, mechanics require commit_action or administer_campaign. The administrative path records purpose, reason and adjudication while retaining normal validation. Pure story/quest/NPC changes, reveal operations and art registration do not require approval. Creating/replacing characters, items or maps and changing roster/time/encounter/positions do. The entire gameplay state (excluding revision and review metadata) is fingerprinted; narrative record events alone do not invalidate an approval, but state changes do. Fingerprints assume campaign configuration is changed only through supported setup; manual config edits are not a rules migration mechanism.

There is one pending action at a time. Superseding refreshes context under a new ID, preserves all rolls, and requires renewed review. Once dice exist, the original costs/procedure/outcome terms cannot be rewritten through ordinary review tools; an administrative override is required. Conditional steps are interpreted by the referee: code checks declared specifications, ordering of required steps, bounds of reported totals, explicit optional-step skips and presence of required results. Approval also dry-runs the exact effects against state invariants. It does not automatically derive damage formulas, enforce a complete turn budget, or interpret prose conditions. Action budgets and missing feature details remain explicit context and adjudication.

Private packets and rulings never enter player state or the HTTP panel. Party get_action returns only an explicitly authored publicExplanation. Reviewed and administrative rolls are omitted from party resume, even if their underlying visibility is party, because their purpose may contain private procedure details. The primary DM communicates suitable roll results in narration. Raw trusted-operator tool results and local files remain accessible to that operator.

Bundled SRD text is independent of journal retrieval. Search/read selects the campaign edition by default: 2024 uses a pinned community Markdown section corpus, while 2014 uses the original page corpus. Explicit page search remains available for both. list_rule_sections exposes paginated document roots and immediate children. Section reads return bounded continuation parts, provenance and hierarchy links. Rules load offline and verify their section/page checksums; a corrupt section corpus fails explicitly without silently switching formats. New SRD citations must use the campaign edition and either a valid page or a known section ID with exact corpus revision. Validation occurs inside the transaction callback after retry detection; replay does not load external rule data. Optional section citation fields preserve existing events. The offline converter uses markdown-it and parse5 without executing HTML; see docs/rules-coverage.md for reproducibility, structural corrections and audit limits. House-rule citations must quote configured text exactly; these checks do not prove that the cited passage supports the ruling. Attribution and extraction caveats accompany the bundle.
