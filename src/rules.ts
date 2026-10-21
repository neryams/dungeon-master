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
      query: z.string().trim().min(2).max(300),
      edition: z.enum(['2014', '2024']).optional(),
      limit: z.number().int().min(1).max(8).default(5),
    })
    .strict(),
  read_rules: z
    .object({
      edition: z.enum(['2014', '2024']).optional(),
      page: z.number().int().min(1),
      count: z.number().int().min(1).max(3).default(1),
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
  const i = ruleInputs[name].parse(raw),
    book = await ruleBook(i.edition ?? edition);
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
  if (i.page > pages.length) throw new CampaignError('NOT_FOUND', 'Rule page not found');
  return { source, pageCount: pages.length, pages: pages.slice(i.page - 1, i.page - 1 + i.count) };
}
