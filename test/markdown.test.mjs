import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownMessage } from '../build/desktop/markdown.js';

test('chat renderer repairs escaped prose paragraphs while preserving code and inert HTML', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ className: '', innerHTML: '' }) },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const render = (text) => markdownMessage(text).innerHTML;
  assert.equal(
    render(String.raw`First.\n\n**Pip** bows.`),
    '<p>First.</p>\n<p><strong>Pip</strong> bows.</p>\n',
  );
  assert.equal(render(String.raw`First.\r\n\r\n## Next`), '<p>First.</p>\n<h2>Next</h2>\n');
  assert.equal(render('First.\n\nSecond.'), '<p>First.</p>\n<p>Second.</p>\n');
  assert.match(render('Use `\\n\\n` here.'), /<code>\\n\\n<\/code>/);
  for (const fence of ['```', '~~~']) {
    assert.match(
      render(`${fence}text\n\\n\\n\n${fence}`),
      /<pre><code class="language-text">\\n\\n\n<\/code><\/pre>/,
    );
  }
  assert.match(render('    \\n\\n'), /<pre><code>\\n\\n/);
  assert.match(render('```text\n\\n\\n'), /<pre><code class="language-text">\\n\\n/);
  assert.match(render(String.raw`A path C:\new\notes.`), /C:\\new\\notes/);
  assert.equal(
    render(String.raw`First.\n\n<script>alert(1)</script>`),
    '<p>First.</p>\n<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n',
  );
});
