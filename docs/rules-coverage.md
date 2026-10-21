# SRD Markdown coverage audit

The 2024 default uses downfallx/dnd-5e-srd-markdown pinned at `1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4`, converted locally by `scripts/build-rule-sections.mjs`. Vendored bytes are unchanged and individually checksummed. The upstream README's broad spell/monster counts are not treated as verified coverage claims.

## Coverage and dispositions

`rules/section-audit.json` records all 13 rule files, 2,877 parsed headings, 579 HTML tables, and zero unparsed source-line or unsupported-element warnings. The 2,890 sections include 13 document roots. Every nonblank source line is covered by a parsed top-level block or heading. Raw source spans are retained in the generated corpus; this coverage check does not prove semantic equivalence to the official PDF.

`rules/coverage-report.json` records 478 entries parsed from the official PDF contents and stat-block index (pages 2–4), their matching section IDs and explicit dispositions. No major contents/index entry is unaccounted for. The nine non-exact matches are PDF column/wrapping/parser artifacts, three shortened subclass titles, legal information retained in attribution/license files, and “Running a Monster,” which is retained as a blockquote. The column artifact involving the Monk subclass is resolved against its complete heading. This is a coverage inventory, not an exhaustive prose comparison.

Two source structure issues are corrected during conversion:

- The leading BOM in spells.md prevents Markdown parsers from recognizing its first heading. Remove it for parsing only.
- Embedded creature headings in spells.md inconsistently use level 2 or 4. Normalize actual spell entries to level 3 beneath Spell Descriptions, their embedded creatures to level 4, and creature action groups to level 5. Otherwise Fireball incorrectly appears beneath Otherworldly Steed. Original line references and raw files remain intact.

Repeated titles use their heading ancestry and an occurrence suffix when necessary. Empty table artifact cells remain empty; row/column spans repeat the cell value so relationships are not silently lost. Table rows and headers remain together where possible; continuation parts repeat a header when a large table must be split. HTML is parsed as data and never executed. Unsupported elements and unparsed lines appear in the audit; current corpus tests require zero warnings.

## Representative fidelity checks

The reproducible audit checks these mechanics against the bundled official PDF extraction:

| Passage                 | PDF pages | Checked details                                         |
| ----------------------- | --------- | ------------------------------------------------------- |
| Long Jump               | 184–185   | Strength score, DC 10, quarter-distance obstacle        |
| Concentration           | 179       | Maximum DC 30 and Incapacitated                         |
| Potion of Healing       | 99        | Bonus Action, 2d4 + 2 healing, five-foot administration |
| Spell Slots             | 104       | Level-one slot example and Long Rest recovery           |
| Fireball                | 131       | 8d6 Fire damage, 20-foot radius, higher-slot increment  |
| Adult Red Dragon        | 318       | HP/dice, AC and movement figures                        |
| Barbarian Extra Attack  | 29        | Two attacks with the Attack action                      |
| Barbarian feature table | 28        | Rages, Weapon Mastery and Brutal Strike columns/content |

These checks compare representative phrases and mechanics, not every cell or sentence. No material discrepancy was found in those checks. PDF extraction itself can interleave columns, so fidelity disputes should be checked against the original PDF. The section API makes no claim of a whole-book exact transcription.

Retrieval tests cover the above plus conditions, action economy, duplicate class features, TOC paging, parent/child links, merged cells, continuations, checksum failure, edition restrictions and invalid locators. Long Jump and Potion of Healing remain findable through explicit page search; their section results isolate coherent rules instead of surrounding columns. No embeddings or network are used at runtime.

## Reproduce and update

Run `npm run rules:build`, then `node scripts/audit-rule-sections.mjs` and `npm test`. Generation is deterministic and offline. A future update explicitly replaces vendor files, their manifest SHA/checksums, and any converter corrections; regenerate both reports, review discrepancies, and test before changing the default. Never update saved citation events. Historical page citations continue to work, and historical section revisions remain recorded even if a future bundle changes. A missing/corrupt section corpus returns an explicit error suggesting page lookup, never a silent fallback.
