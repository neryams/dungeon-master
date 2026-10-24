import MarkdownIt from './vendor/markdown-it.js';

// Only parser-generated formatting becomes HTML. Raw HTML stays escaped; message content
// cannot introduce remote media, clickable URLs, or executable navigation.
const parser = new MarkdownIt('commonmark', { html: false, breaks: true }).disable([
  'image',
  'link',
  'autolink',
]);

// Some provider messages contain double-escaped paragraph separators. Repair only
// paragraph breaks in prose, leaving code examples and other backslashes intact.
function paragraphBreaks(text: string): string {
  if (!/(?:\\r\\n|\\n){2,}/.test(text)) return text;
  const prose = (value: string) =>
    value.replace(
      /((?<!`)(`+)(?!`)[\s\S]*?(?<!`)\2(?!`))|(?<!\\)(?:\\r\\n|\\n){2,}/g,
      (match, code) => (code ? match : match.replace(/\\r\\n|\\n/g, '\n')),
    );
  // Use Markdown's own block boundaries to protect fenced and indented code,
  // including incomplete fences in a message still being composed.
  const lines = text.split(/(?<=\n)/);
  const output: string[] = [];
  let cursor = 0;
  for (const token of parser.parse(text, {})) {
    if (!token.map || !['fence', 'code_block'].includes(token.type)) continue;
    const [start, end] = token.map;
    output.push(prose(lines.slice(cursor, start).join('')), lines.slice(start, end).join(''));
    cursor = end;
  }
  output.push(prose(lines.slice(cursor).join('')));
  return output.join('');
}

export function markdownMessage(text: string): HTMLDivElement {
  const body = document.createElement('div');
  body.className = 'message-markdown';
  body.innerHTML = parser.render(paragraphBreaks(text));
  return body;
}
