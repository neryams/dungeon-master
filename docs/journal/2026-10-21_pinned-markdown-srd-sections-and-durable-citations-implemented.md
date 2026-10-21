# Pinned Markdown SRD sections and durable citations implemented

## Context and decisions

Implemented the approved section-based rules retrieval plan from fb61bf9 on feature/game-setup. The 2024 default now uses the community Markdown SRD pinned at downfallx/dnd-5e-srd-markdown commit 1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4. Official PDF-derived corpora remain available, and 2014 defaults are unchanged. No runtime network, model API, embeddings, vector database or panel changes were introduced.

## Completed changes

Vendored 13 rule documents plus upstream README/LICENSE with per-file checksums and provenance. scripts/build-rule-sections.mjs uses direct markdown-it/parse5 dependencies to generate stable hierarchical section IDs, duplicate suffixes, source line links, merged-cell text, raw spans and continuation parts. A BOM and inconsistent embedded creature headings in spells.md required documented structural corrections without editing vendor files. rules/section-audit.json accounts for 2,877 headings and 579 tables with zero warnings. scripts/audit-rule-sections.mjs produces a checked-in coverage report for 478 PDF contents/index entries and eight representative mechanics comparisons. docs/rules-coverage.md records dispositions and limitations.

search_rules supports auto/sections/pages; read_rules supports sectionId/part or legacy page/count; list_rule_sections provides bounded TOC browsing. Section reads cap child links at 30 and direct further browsing through nextChildOffset. Search uses title, heading ancestry and weighted body matches, including class-qualified feature queries. Section corruption/missing files produce explicit errors suggesting PDF lookup. Optional RuleCitation sectionId/corpusRevision fields are checked for new writes. Citation validation now runs within the transaction callback after retry detection, so old operations and replay do not depend on an available historical corpus. No saved events were rewritten. Referee instructions, attribution, README, architecture and package metadata were updated to 0.6.0.

## Verification actually run

npm test passed 49 tests. Coverage includes deterministic regeneration, vendor checksums, all parsed headings, merged cells, duplicate IDs, continuation preservation, relevant retrieval queries, edition/locator restrictions, corruption/missing corpus failures, MCP section/TOC transport, citation validation, amendments/approvals, exact retries without rules files, restart and export/import preserving events. npm run typecheck and format:check passed; git diff --check passed. npm run test:journal passed one test against its isolated temporary daemon. rules-referee skill validation passed. package:plugin passed, and packaged 2014/2024 retrieval and TOC lookup were exercised with fetch disabled. The package includes both PDF corpora, vendor Markdown, generated sections and audit reports.

## Limitations and next steps

Coverage and representative phrase/mechanics checks are not a proof of full-book textual equivalence. The community source is not official; ambiguous fidelity still requires original-PDF inspection. Lookup validates citation location/provenance, not whether an agent correctly interpreted it. Future source updates must explicitly regenerate/review manifests, corpus revisions and audit dispositions; historical events stay untouched. Work remains uncommitted and has not been pushed. Review the source changes and regenerate the archive to include this journal entry before release.
