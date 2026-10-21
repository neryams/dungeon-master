import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convert, htmlText, hash } from '../scripts/build-rule-sections.mjs';
import {
  executeRules,
  sectionBook,
  verifySectionBook,
  validateRuleCitation,
} from '../dist/rules.js';

test('converter retains headings, duplicate IDs, block content and merged table semantics', () => {
  const input =
    '\uFEFF# Rules\n\nIntro\n\n## Action\n\nFirst\n\n## Action\n\nSecond\n\n<table><tr><th rowspan="2">Level</th><th colspan="2">Slots</th></tr><tr><td>1</td><td>2</td></tr></table>\n';
  const { sections, warnings } = convert('fixture.md', input, 'abc');
  assert.equal(sections.length, 4);
  assert.match(sections[3].id, /~2$/);
  assert.match(sections[3].parts[0], /Level \| Slots \| Slots/);
  assert.match(sections[3].parts[0], /Level \| 1 \| 2/);
  assert.deepEqual(warnings, []);
  assert.equal(sections[2].parentId, sections[1].id);
  assert.deepEqual(convert('fixture.md', input, 'abc').sections, sections);
  const many = convert(
    'long.md',
    '# Long\n\n' +
      Array.from({ length: 60 }, (_, i) => `Paragraph ${i}: ` + 'word '.repeat(100)).join('\n\n'),
    'abc',
  ).sections[1];
  assert.ok(many.parts.length > 2);
  assert.match(many.parts.at(-1), /Paragraph 59/);
  assert.ok(many.parts.every((p) => p.length <= 12000));
  const unsupported = [];
  assert.equal(htmlText('<script>alert(1)</script>', unsupported), '');
  assert.ok(unsupported.length);
});

test('vendor checksums, deterministic corpus and audited heading coverage', async () => {
  const manifest = JSON.parse(await readFile('rules/vendor/srd-5.2.1/manifest.json', 'utf8'));
  const corpus = await sectionBook('2024'),
    rebuilt = [];
  for (const f of manifest.files) {
    const raw = await readFile(`rules/vendor/srd-5.2.1/${f.file}`, 'utf8');
    assert.equal(hash(raw), f.sha256);
    if (!f.rules) continue;
    const result = convert(f.file, raw, manifest.commit);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.sections.length, result.headings + 1);
    rebuilt.push(...result.sections);
  }
  assert.deepEqual(rebuilt, corpus.sections);
  assert.equal(new Set(rebuilt.map((s) => s.id)).size, rebuilt.length);
  const fireball = rebuilt.find((s) => s.title === 'Fireball');
  assert.match(fireball.parentId, /spell-descriptions$/);
  const changed = structuredClone(corpus);
  changed.sections[0].title = 'corrupt';
  assert.throws(() => verifySectionBook(JSON.stringify(changed)), /checksum/);
});

test('section retrieval covers rule exceptions, class features, spells and monsters', async () => {
  for (const [query, title, fragment] of [
    ['long jump', 'Long Jump', /Strength score/],
    ['concentration damage', 'Concentration', /maximum DC of 30/],
    ['potion of healing', 'Potion of Healing (50 GP)', /Bonus Action/],
    ['spell slots', 'Spell Slots', /Long Rest/],
    ['fireball', 'Fireball', /8d6 Fire/],
    ['adult red dragon', 'Adult Red Dragon', /256/],
    ['prone', 'Prone [Condition]', /Disadvantage/],
    ['bonus actions', 'Bonus Actions', /Bonus Action/],
  ]) {
    const r = await executeRules('search_rules', { query }, '2024');
    const hit = r.hits.find((h) => h.title === title);
    assert.ok(hit, query);
    const read = await executeRules('read_rules', { sectionId: hit.id }, '2024');
    assert.match(read.text, fragment, query);
    assert.equal(read.source.corpusRevision, hit.corpusRevision);
  }
  const duplicates = await executeRules(
    'search_rules',
    { query: 'Level 5 Extra Attack', limit: 8 },
    '2024',
  );
  assert.ok(duplicates.hits.filter((h) => h.title === 'Level 5: Extra Attack').length > 1);
  const barbarian = await executeRules('search_rules', { query: 'Barbarian Extra Attack' }, '2024');
  assert.ok(
    barbarian.hits
      .slice(0, 3)
      .some((h) => h.title === 'Level 5: Extra Attack' && h.headingPath.includes('Barbarian')),
  );
  const roots = await executeRules('list_rule_sections', { limit: 3 }, '2024');
  assert.equal(roots.total, 13);
  assert.equal(roots.nextOffset, 3);
  const next = await executeRules('list_rule_sections', { offset: 3, limit: 3 }, '2024');
  assert.notEqual(next.sections[0].id, roots.sections[0].id);
  const children = await executeRules(
    'list_rule_sections',
    { parentId: roots.sections[0].id },
    '2024',
  );
  assert.ok(children.sections.length);
  const old = await executeRules('search_rules', { query: 'Long Jump' }, '2014');
  assert.ok(old.hits[0].page);
  const pages = await executeRules('search_rules', { query: 'Long Jump', format: 'pages' }, '2024');
  assert.ok(pages.hits.some((h) => [184, 185].includes(h.page)));
  for (const [name, args, edition] of [
    ['read_rules', {}, '2024'],
    ['read_rules', { page: 1, part: 1 }, '2024'],
    ['read_rules', { sectionId: 'nope' }, '2024'],
    ['read_rules', { sectionId: 'spells', page: 1 }, '2024'],
    ['read_rules', { sectionId: 'spells', part: 9999 }, '2024'],
    ['list_rule_sections', { parentId: 'nope' }, '2024'],
    ['search_rules', { query: 'Jump', format: 'sections' }, '2014'],
  ])
    await assert.rejects(executeRules(name, args, edition));
});

test('new section citations require edition, known section and exact revision; page citations remain valid', async () => {
  const c = await sectionBook('2024'),
    citation = { source: c.id, sectionId: c.sections[0].id, corpusRevision: c.corpusRevision };
  await validateRuleCitation(citation, '2024');
  await validateRuleCitation({ source: 'srd-5.2.1', page: 99 }, '2024');
  for (const bad of [
    { ...citation, corpusRevision: 'old' },
    { ...citation, sectionId: 'missing' },
    { ...citation, page: 99 },
    { source: c.id },
    { source: c.id, page: 9999 },
  ])
    await assert.rejects(validateRuleCitation(bad, '2024'));
  await assert.rejects(validateRuleCitation(citation, '2014'));
});
