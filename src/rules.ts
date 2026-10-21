import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CampaignError } from './domain.js';
const books = new Map<string, Promise<Book>>();
interface Book {
  id: string;
  edition: string;
  version: string;
  sourceUrl: string;
  license: string;
  pdfSha256: string;
  textSha256: string;
  extraction: string;
  pagesSha256: string;
  pages: { page: number; text: string }[];
}
export const ruleInputs = {
  search_rules: z
    .object({
      format: z.enum(['auto', 'sections', 'pages']).default('auto'),
      query: z.string().trim().min(2).max(300),
      edition: z.enum(['2014', '2024']).optional(),
      limit: z.number().int().min(1).max(8).default(5),
    })
    .strict(),
  list_rule_sections: z
    .object({
      edition: z.enum(['2014', '2024']).optional(),
      parentId: z.string().min(1).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(30),
    })
    .strict(),
  read_rules: z
    .object({
      edition: z.enum(['2014', '2024']).optional(),
      sectionId: z.string().min(1).optional(),
      part: z.number().int().min(1).optional(),
      page: z.number().int().min(1).optional(),
      count: z.number().int().min(1).max(3).optional(),
    })
    .strict(),
};
export async function ruleBook(edition: string): Promise<Book> {
  const version = edition === '2014' ? '5.1' : '5.2.1';
  if (!books.has(version))
    books.set(
      version,
      readFile(new URL(`../rules/srd-${version}.json`, import.meta.url), 'utf8').then((text) => {
        const book = JSON.parse(text) as Book;
        if (
          createHash('sha256').update(JSON.stringify(book.pages)).digest('hex') !== book.pagesSha256
        )
          throw new Error('Bundled rules checksum mismatch');
        return book;
      }),
    );
  return books.get(version)!;
}
export async function executeRules(name: keyof typeof ruleInputs, raw: unknown, edition: string) {
  const i = ruleInputs[name].parse(raw);
  const selectedEdition = i.edition ?? edition;
  if (name === 'list_rule_sections') {
    const input = ruleInputs.list_rule_sections.parse(raw),
      corpus = await sectionBook(selectedEdition);
    if (input.parentId && !corpus.sections.some((s) => s.id === input.parentId))
      throw new CampaignError('NOT_FOUND', 'Rule section not found');
    const matches = corpus.sections.filter((s) => s.parentId === input.parentId);
    return {
      source: sectionSource(corpus),
      sections: matches.slice(input.offset, input.offset + input.limit).map(sectionSummary),
      total: matches.length,
      nextOffset: input.offset + input.limit < matches.length ? input.offset + input.limit : null,
    };
  }
  if (
    'query' in i &&
    (i.format === 'sections' || (i.format === 'auto' && selectedEdition === '2024'))
  ) {
    const corpus = await sectionBook(selectedEdition),
      phrase = i.query.toLowerCase().replace(/\s+/g, ' ').trim();
    const words = [...new Set(phrase.match(/[a-z0-9]+/g) ?? [])].filter(
      (w) => !['the', 'a', 'an', 'of', 'for', 'to', 'and', 'in', 'is'].includes(w),
    );
    const bodies = corpus.sections.map((s) => s.parts.join(' ').toLowerCase());
    const weights = new Map(
      words.map((w) => [
        w,
        Math.log(1 + corpus.sections.length / (1 + bodies.filter((b) => b.includes(w)).length)),
      ]),
    );
    const hits = corpus.sections
      .map((s, index) => {
        const title = s.title.toLowerCase(),
          body = bodies[index],
          ancestry = s.headingPath.slice(0, -1).join(' ').toLowerCase();
        const score =
          (title === phrase ? 100 : title.includes(phrase) ? 60 : 0) +
          (words.length > 0 && words.every((w) => `${title} ${ancestry}`.includes(w)) ? 40 : 0) +
          words.reduce(
            (n, w) =>
              n +
              (weights.get(w) ?? 0) * (title.includes(w) ? 10 : 0) +
              (weights.get(w) ?? 0) * (ancestry.includes(w) ? 2 : 0) +
              (weights.get(w) ?? 0) * Math.min(3, body.split(w).length - 1),
            0,
          ) +
          (body.includes(phrase) ? 12 : 0);
        const pos = Math.max(0, body.indexOf(phrase));
        return {
          ...sectionSummary(s),
          score,
          excerpt: s.parts.join(' ').slice(Math.max(0, pos - 150), pos + 1050),
          corpusRevision: corpus.corpusRevision,
        };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, i.limit);
    return { source: sectionSource(corpus), hits };
  }
  if ('sectionId' in i && i.sectionId) {
    if (i.page !== undefined || i.count !== undefined)
      throw new CampaignError('INVALID_LOCATOR', 'Use either sectionId/part or page/count');
    const corpus = await sectionBook(selectedEdition),
      section = corpus.sections.find((s) => s.id === i.sectionId),
      part = i.part ?? 1;
    if (!section || part > section.parts.length)
      throw new CampaignError('NOT_FOUND', 'Rule section or part not found');
    return {
      source: sectionSource(corpus),
      ...sectionSummary(section),
      parent: corpus.sections.filter((s) => s.id === section.parentId).map(sectionSummary)[0],
      children: corpus.sections
        .filter((s) => section.children.includes(s.id))
        .slice(0, 30)
        .map(sectionSummary),
      childCount: section.children.length,
      nextChildOffset: section.children.length > 30 ? 30 : null,
      part,
      partCount: section.parts.length,
      text: section.parts[part - 1],
      nextPart: part < section.parts.length ? part + 1 : null,
    };
  }
  if (!('query' in i) && (!('page' in i) || !i.page || i.part !== undefined))
    throw new CampaignError('INVALID_LOCATOR', 'Supply page/count or sectionId/part');
  const book = await ruleBook(selectedEdition);
  const { pages, ...source } = book;
  if ('query' in i) {
    const words = [...new Set(i.query.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(
      (w) => !['the', 'a', 'an', 'of', 'for', 'to', 'and', 'in', 'is'].includes(w),
    );
    const normalized = pages.map((p) => p.text.toLowerCase().replace(/\s+/g, ' '));
    const weights = new Map(
      words.map((w) => [
        w,
        Math.log(1 + pages.length / (1 + normalized.filter((t) => t.includes(w)).length)),
      ]),
    );
    const phrase = i.query.toLowerCase().replace(/\s+/g, ' ').trim();
    const hits = pages
      .map((p, index) => {
        const text = normalized[index];
        const score =
          words.reduce(
            (sum, w) => sum + (weights.get(w) ?? 0) * Math.min(5, text.split(w).length - 1),
            0,
          ) +
          Math.min(8, text.split(phrase).length - 1) * 8 +
          (p.text.split('\n').some((line) => {
            const t = line.trim().toLowerCase();
            const rest = t.slice(phrase.length).trim();
            return t.startsWith(phrase) && (!rest || rest.startsWith('(') || rest.startsWith('['));
          })
            ? 24
            : 0);
        return { ...p, score };
      })
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score || a.page - b.page)
      .slice(0, i.limit)
      .map((p) => {
        const rare = [...words].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
        const index = Math.max(
          0,
          p.text.toLowerCase().indexOf(rare.find((w) => p.text.toLowerCase().includes(w)) ?? ''),
        );
        return {
          page: p.page,
          score: p.score,
          excerpt: p.text.slice(Math.max(0, index - 150), index + 1050),
        };
      });
    return { source, pageCount: pages.length, hits };
  }
  if (!('page' in i) || !i.page) throw new CampaignError('INVALID_LOCATOR', 'Supply a page');
  if (i.page > pages.length) throw new CampaignError('NOT_FOUND', 'Rule page not found');
  return {
    source,
    pageCount: pages.length,
    pages: pages.slice(i.page - 1, i.page - 1 + (i.count ?? 1)),
  };
}

interface Section {
  id: string;
  title: string;
  headingPath: string[];
  parentId?: string;
  children: string[];
  file: string;
  startLine: number;
  endLine: number;
  sourceLink: string;
  parts: string[];
}
interface SectionBook {
  id: string;
  edition: string;
  version: string;
  corpusRevision: string;
  upstreamCommit: string;
  license: string;
  sectionsSha256: string;
  sections: Section[];
}
export function verifySectionBook(text: string): SectionBook {
  const corpus = JSON.parse(text) as SectionBook;
  if (
    !Array.isArray(corpus.sections) ||
    createHash('sha256').update(JSON.stringify(corpus.sections)).digest('hex') !==
      corpus.sectionsSha256 ||
    corpus.corpusRevision !== `${corpus.upstreamCommit}:v1:${corpus.sectionsSha256}`
  )
    throw new Error('Section corpus checksum mismatch');
  return corpus;
}
export async function sectionBook(edition: string): Promise<SectionBook> {
  if (edition !== '2024')
    throw new CampaignError(
      'UNSUPPORTED_FORMAT',
      'Section lookup is available for 2024 only; use format=pages for 2014',
    );
  try {
    return verifySectionBook(
      await readFile(new URL('../rules/srd-5.2.1-sections.json', import.meta.url), 'utf8'),
    );
  } catch {
    throw new CampaignError(
      'RULES_UNAVAILABLE',
      'Section corpus missing or corrupt; use search_rules format=pages and read_rules page',
    );
  }
}
function sectionSource(corpus: SectionBook) {
  const { sections: _, ...source } = corpus;
  return source;
}
function sectionSummary(s: Section) {
  return {
    id: s.id,
    title: s.title,
    headingPath: s.headingPath,
    parentId: s.parentId,
    sourceLink: s.sourceLink,
    file: s.file,
    startLine: s.startLine,
    endLine: s.endLine,
    partCount: s.parts.length,
  };
}
export async function validateRuleCitation(
  citation: { source: string; page?: number; sectionId?: string; corpusRevision?: string },
  edition: string,
) {
  if (!citation.source.startsWith('srd-')) return;
  const book = await ruleBook(edition);
  if (citation.source !== book.id)
    throw new CampaignError('INVALID_CITATION', 'Use the campaign edition');
  if (citation.sectionId) {
    const corpus = await sectionBook(edition);
    if (
      citation.page !== undefined ||
      citation.corpusRevision !== corpus.corpusRevision ||
      !corpus.sections.some((s) => s.id === citation.sectionId)
    )
      throw new CampaignError(
        'INVALID_CITATION',
        'Use an existing section and its exact corpusRevision, without page',
      );
  } else if (
    !citation.page ||
    citation.page > book.pages.length ||
    citation.corpusRevision !== undefined
  )
    throw new CampaignError(
      'INVALID_CITATION',
      'Use a valid PDF page or a sectionId with corpusRevision',
    );
}
