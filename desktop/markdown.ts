import MarkdownIt from './vendor/markdown-it.js';

// Only parser-generated formatting becomes HTML. Raw HTML stays escaped; message content
// cannot introduce remote media, clickable URLs, or executable navigation.
const parser = new MarkdownIt('commonmark', { html: false, breaks: true }).disable([
  'image',
  'link',
  'autolink',
]);

export function markdownMessage(text: string): HTMLDivElement {
  const body = document.createElement('div');
  body.className = 'message-markdown';
  body.innerHTML = parser.render(text);
  return body;
}
