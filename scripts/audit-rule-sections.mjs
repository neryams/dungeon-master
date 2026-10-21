import { readFile, writeFile } from 'node:fs/promises';
const corpus = JSON.parse(await readFile('rules/srd-5.2.1-sections.json', 'utf8'));
const pdf = JSON.parse(await readFile('rules/srd-5.2.1.json', 'utf8'));
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const dispositions = {
  'Contents                                                          Fighter': [
    'Fighter',
    'PDF column/header extraction artifact',
  ],
  'Legal Information': [
    null,
    'Legal attribution retained separately in rules/ATTRIBUTION.md and vendor LICENSE',
  ],
  'Monk Subclass: Warrior of the Open                                       Spell Descriptions': [
    'Spell Descriptions',
    'PDF columns interleaved; Monk subclass independently present',
  ],
  Hand: ['Monk Subclass: Warrior of the Open Hand', 'PDF wrapped heading'],
  Tests: ['D20 Tests', 'PDF TOC parser excludes digits in titles'],
  'Running a Monster': [null, 'Present as a blockquote in monsters.md, not a Markdown heading'],
  'Path of the Berserker': [
    'Barbarian Subclass: Path of the Berserker',
    'Full subclass heading retained',
  ],
  'College of Lore': ['Bard Subclass: College of Lore', 'Full subclass heading retained'],
  'Circle of the Land': ['Druid Subclass: Circle of the Land', 'Full subclass heading retained'],
};
const coverage = [];
for (const p of pdf.pages.slice(1, 4))
  for (const m of p.text.matchAll(/([^\d.\n]+?)\.[. ]+(\d+)/g)) {
    const title = m[1].trim();
    if (!title) continue;
    const [mapped, disposition] = dispositions[title] ?? [title, 'Exact normalized heading'];
    const matches = mapped
      ? corpus.sections.filter((s) => normalize(s.title) === normalize(mapped))
      : [];
    if (mapped && !matches.length) throw Error(`Unaccounted TOC heading: ${title}`);
    coverage.push({
      title,
      pdfPage: Number(m[2]),
      sectionIds: matches.map((s) => s.id),
      disposition,
    });
  }
if (!corpus.sections.some((s) => s.parts.join(' ').includes('Running a Monster')))
  throw Error('Missing monster guidance');
const samples = [
  ['Long Jump', [184, 185], ['Strength score', 'DC 10', 'quarter']],
  ['Concentration', 179, ['maximum DC of 30', 'Incapacitated']],
  ['Potion of Healing (50 GP)', 99, ['Bonus Action', '2d4 + 2', '5 feet']],
  ['Spell Slots', 104, ['four level 1', 'Long Rest']],
  ['Fireball', 131, ['8d6 Fire', '20-foot-radius', '1d6']],
  ['Adult Red Dragon', 318, ['256 (19d12 + 133)', '19', '40 ft.']],
  ['Level 5: Extra Attack', 29, ['attack twice', 'Attack action']],
  ['Barbarian Class Features', 28, ['Rages', 'Weapon Mastery', 'Brutal Strike']],
];
const comparisons = samples.map(([title, page, phrases]) => {
  const candidates = corpus.sections.filter((s) => s.title === title);
  const section = candidates.find((s) =>
    phrases.every((p) => normalize(s.parts.join(' ')).includes(normalize(p))),
  );
  if (!section) throw Error(`Missing sample ${title}`);
  const text = (Array.isArray(page) ? page : [page]).map((p) => pdf.pages[p - 1].text).join('\n');
  for (const phrase of phrases)
    if (!normalize(text).includes(normalize(phrase)))
      throw Error(`PDF sample mismatch ${title}: ${phrase}`);
  return {
    title,
    pdfPage: page,
    sectionId: section.id,
    checkedPhrases: phrases,
    result: 'Representative mechanics agree; not a whole-section equivalence proof',
  };
});
await writeFile(
  'rules/coverage-report.json',
  JSON.stringify(
    {
      corpusRevision: corpus.corpusRevision,
      method:
        'PDF contents/index pages 2–4 heading coverage with explicit extraction dispositions; representative mechanics against bundled official PDF extraction',
      coverage,
      comparisons,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Audited ${coverage.length} contents/index entries and ${comparisons.length} representative comparisons`,
);
