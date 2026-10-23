import MarkdownIt from 'markdown-it';
import type { Event } from '../schema.js';

const markdown = new MarkdownIt({ html: true });
const MAX_PART_LENGTH = 500;

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

  const normalized = prose
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n+ */gu, '\n')
    .trim();
  if (!normalized) return [];
  return normalized.split('\n').flatMap(splitSpeechText);
}

function splitSpeechText(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/gu) ?? [];
  const parts: string[] = [];
  let current = '';

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    for (const piece of splitAtLimit(sentence)) {
      if (current && current.length + 1 + piece.length > MAX_PART_LENGTH) {
        parts.push(current);
        current = '';
      }
      current = current ? `${current} ${piece}` : piece;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function splitAtLimit(text: string): string[] {
  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_PART_LENGTH) {
    let cut = remaining.lastIndexOf(' ', MAX_PART_LENGTH);
    if (cut < 1) cut = MAX_PART_LENGTH;
    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}
