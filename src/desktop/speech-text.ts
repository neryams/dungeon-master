import MarkdownIt from 'markdown-it';
import type { Event } from '../schema.js';

const markdown = new MarkdownIt({ html: true });
const FIRST_PART_LENGTH = 500;
const MAX_PART_LENGTH = 2500;

/** Return table publication revisions made while public play was allowed. */
export function speechEligibleRevisions(events: Event[]): number[] {
  let reviewMode: 'legacy' | 'setup' | 'reviewed' = 'legacy';
  const revisions: number[] = [];

  for (const event of events) {
    const operation = event.payload.review;
    if (operation?.type === 'configure') reviewMode = operation.mode;

    if (reviewMode !== 'setup' && event.payload.table?.type === 'publish') {
      revisions.push(event.sequence);
    }
  }

  return revisions;
}

/** Convert Markdown narration into short, readable text suitable for speech. */
export function speechParts(markdownText: string): string[] {
  const tokens = markdown.parse(markdownText, {});
  let prose = '';

  const boundary = () => {
    if (prose && !/\s$/.test(prose)) prose += '\n';
  };

  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') {
      boundary();
      continue;
    }

    if (token.type === 'inline') {
      for (const child of token.children ?? []) {
        switch (child.type) {
          case 'text':
          case 'code_inline':
            prose += child.content;
            break;
          case 'image':
            // Image alt text is useful narration; its destination is not.
            prose += child.content;
            break;
          case 'softbreak':
          case 'hardbreak':
            boundary();
            break;
          // Link targets and raw tags are intentionally omitted.
        }
      }
      boundary();
      continue;
    }

    if (
      token.type === 'heading_open' ||
      token.type === 'paragraph_open' ||
      token.type === 'paragraph_close' ||
      token.type === 'heading_close' ||
      token.type === 'list_item_open' ||
      token.type === 'list_item_close' ||
      token.type === 'blockquote_open' ||
      token.type === 'blockquote_close'
    ) {
      boundary();
    }
  }

  const normalized = omitSpeechNotation(prose)
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n+ */gu, '\n')
    .replace(/ +([,.;:!?)\]])/gu, '$1')
    .trim();
  if (!normalized) return [];
  return packSpeechParagraphs(normalized.split('\n'));
}

/** Only discard complete, recognizable annotations; mixed narrative stays readable. */
function omitSpeechNotation(text: string): string {
  const number = '[+−-]?\\d+(?:\\.\\d+)?';
  const tuple = `${number}\\s*,\\s*${number}(?:\\s*,\\s*${number})?`;
  const axes = `x\\s*[:=]\\s*${number}\\s*[,;]\\s*y\\s*[:=]\\s*${number}(?:\\s*[,;]\\s*z\\s*[:=]\\s*${number})?`;
  const coordinates = new RegExp(
    `^(?:(?:coordinates?|coords?|grid)\\s*:?\\s*)?(?:${tuple}|${axes})$`,
    'iu',
  );
  const dice = '(?:\\d+)?d\\d+(?:\\s*[+−-]\\s*\\d+)?(?:\\s*=\\s*\\d+)?';
  const stat = '(?:DC|AC|HP)\\s*[:=]?\\s*\\d+(?:\\s*[/]\\s*\\d+)?';
  const mechanics = new RegExp(`^(?:${dice}|${stat})(?:\\s*[,;]\\s*(?:${dice}|${stat}))*$`, 'iu');

  // Markdown has already been flattened, so bold/inline-code notation is handled too.
  return text.replace(/\(([^()\n]*)\)|\[([^\[\]\n]*)\]/gu, (annotation, round, square) => {
    const content = String(round ?? square).trim();
    return coordinates.test(content) || mechanics.test(content) ? ' ' : annotation;
  });
}

function packSpeechParagraphs(paragraphs: string[]): string[] {
  const parts: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/gu) ?? [];
    let separator = current ? '\n' : '';

    for (const rawSentence of sentences) {
      let remaining = rawSentence.trim();
      while (remaining) {
        const limit = parts.length === 0 ? FIRST_PART_LENGTH : MAX_PART_LENGTH;
        if (!current) {
          if (remaining.length <= limit) {
            current = remaining;
            separator = ' ';
            break;
          }
          let cut = remaining.lastIndexOf(' ', limit);
          if (cut < 1) cut = limit;
          parts.push(remaining.slice(0, cut).trim());
          remaining = remaining.slice(cut).trimStart();
          separator = '';
        } else if (current.length + 1 + remaining.length <= limit) {
          current = `${current}${separator}${remaining}`;
          separator = ' ';
          break;
        } else {
          parts.push(current);
          current = '';
          separator = '';
        }
      }
    }

    if (parts.length === 0 && current) {
      parts.push(current);
      current = '';
    }
  }

  if (current) parts.push(current);
  return parts;
}
