import MarkdownIt from 'markdown-it';
import { parseFragment } from 'parse5';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
const md = new MarkdownIt({ html: true });
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
const plain = (n) =>
  n.nodeName === '#text'
    ? n.value
    : n.tagName === 'br'
      ? ' '
      : (n.childNodes ?? []).map(plain).join('');
export function htmlText(html, warnings = []) {
  const tree = parseFragment(html);
  function visit(n) {
    if (['script', 'style'].includes(n.tagName)) {
      warnings.push(`Unsupported ${n.tagName}`);
      return '';
    }
    if (
      n.tagName &&
      ![
        'hr',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'td',
        'th',
        'br',
        'p',
        'em',
        'strong',
        'b',
        'i',
        'a',
        'span',
        'div',
        'sup',
        'sub',
        'ul',
        'ol',
        'li',
      ].includes(n.tagName)
    )
      warnings.push(`Unsupported HTML element ${n.tagName}`);
    if (n.tagName === 'table') {
      const inspect = (node) => {
        for (const child of node.childNodes ?? []) {
          if (child.tagName === 'table') warnings.push('Unsupported nested table');
          if (['script', 'style', 'caption'].includes(child.tagName))
            warnings.push(`Unsupported table element ${child.tagName}`);
          inspect(child);
        }
      };
      inspect(n);
      const rows = [];
      const collect = (x) => {
        if (x.tagName === 'tr') rows.push(x);
        else (x.childNodes ?? []).forEach(collect);
      };
      collect(n);
      const grid = [];
      rows.forEach((row, r) => {
        grid[r] ??= [];
        let c = 0;
        for (const cell of (row.childNodes ?? []).filter((x) => ['td', 'th'].includes(x.tagName))) {
          while (grid[r][c] !== undefined) c++;
          const attrs = Object.fromEntries((cell.attrs ?? []).map((a) => [a.name, a.value]));
          const rs = Number(attrs.rowspan ?? 1),
            cs = Number(attrs.colspan ?? 1);
          if (
            !Number.isInteger(rs) ||
            !Number.isInteger(cs) ||
            rs < 1 ||
            cs < 1 ||
            rs > 100 ||
            cs > 100
          )
            throw Error('Unsupported table span');
          const value = plain(cell).replace(/\s+/g, ' ').trim();
          for (let y = 0; y < rs; y++) {
            grid[r + y] ??= [];
            for (let x = 0; x < cs; x++) {
              if (grid[r + y][c + x] !== undefined) throw Error('Overlapping table spans');
              grid[r + y][c + x] = value;
            }
          }
          c += cs;
        }
      });
      return (
        '\n' +
        grid.map((row) => '| ' + Array.from(row, (x) => x ?? '').join(' | ') + ' |').join('\n') +
        '\n'
      );
    }
    if (n.tagName === 'hr') return '\n---\n';
    if (n.tagName === 'br') return '\n';
    return n.nodeName === '#text' ? n.value : (n.childNodes ?? []).map(visit).join('');
  }
  return visit(tree);
}
export function convert(file, raw, commit) {
  const lines = raw.split('\n'),
    tokens = md.parse(raw.replace(/^\uFEFF/, ''), {}),
    sections = [],
    warnings = [];
  const root = {
    id: file.replace(/\.md$/, ''),
    title: file.replace(/\.md$/, '').replaceAll('-', ' '),
    headingPath: [],
    level: 0,
    startLine: 1,
    children: [],
    blocks: [],
  };
  root.headingPath = [root.title];
  sections.push(root);
  const stack = [root],
    counts = new Map(),
    covered = new Set();
  let current = root;
  for (const t of tokens)
    if (t.map && t.level === 0) for (let n = t.map[0]; n < t.map[1]; n++) covered.add(n);
  lines.forEach((line, n) => {
    if (line.trim() && !covered.has(n)) warnings.push(`Unparsed source line ${n + 1}`);
  });
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      let level = Number(t.tag.slice(1));
      const title = tokens[i + 1].content;
      // Upstream spells mix heading levels for embedded stat blocks. Keep each
      // spell under Spell Descriptions and its creature/action details beneath it.
      if (file === 'spells.md' && t.map[0] >= 261) {
        const following = lines.slice(t.map[1], t.map[1] + 4).join('\n');
        if (/_(Level \d|[A-Za-z]+ Cantrip)/.test(following)) level = 3;
        else level = /^(Traits|Actions|Bonus Actions|Reactions)$/.test(title) ? 5 : 4;
      }
      while (stack.length > 1 && stack.at(-1).level >= level) stack.pop();
      const parent = stack.at(-1),
        base = parent.id + '/' + slug(title),
        occurrence = (counts.get(base) ?? 0) + 1;
      counts.set(base, occurrence);
      current = {
        id: base + (occurrence > 1 ? '~' + occurrence : ''),
        title,
        headingPath: [...parent.headingPath, title],
        level,
        parentId: parent.id,
        startLine: t.map[0] + 1,
        children: [],
        blocks: [],
      };
      parent.children.push(current.id);
      sections.push(current);
      stack.push(current);
      i += 2;
      continue;
    }
    if (t.map && t.level === 0) {
      const block = lines.slice(...t.map).join('\n');
      if (t.type === 'html_block') current.blocks.push(htmlText(block, warnings));
      else if (!t.type.endsWith('_close')) current.blocks.push(block);
    }
  }
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    s.endLine = Math.max(s.startLine, (sections[i + 1]?.startLine ?? lines.length + 1) - 1);
    s.rawMarkdown = lines.slice(s.startLine - 1, s.endLine).join('\n');
    const parts = [];
    let part = '';
    const append = (chunk) => {
      if (part.length && part.length + chunk.length + 2 > 12000) {
        parts.push(part);
        part = '';
      }
      part += (part ? '\n\n' : '') + chunk;
    };
    for (const block of s.blocks) {
      if (block.length > 12000 && block.trimStart().startsWith('|')) {
        const rows = block.trim().split('\n'),
          header = rows[0];
        for (const row of rows) {
          if (part && part.length + row.length + 1 > 12000) {
            parts.push(part);
            part = header;
          }
          part += (part ? '\n' : '') + row;
        }
      } else {
        if (block.length > 12000) warnings.push(`Oversize indivisible block in ${s.id}`);
        append(block);
      }
    }
    if (part || !parts.length) parts.push(part);
    s.parts = parts;
    delete s.blocks;
    s.file = file;
    s.sourceLink = `https://github.com/downfallx/dnd-5e-srd-markdown/blob/${commit}/${file}#L${s.startLine}-L${s.endLine}`;
  }
  return {
    sections,
    warnings,
    headings: tokens.filter((t) => t.type === 'heading_open').length,
    tables: (raw.match(/<table\b/gi) ?? []).length,
  };
}
export async function build() {
  const root = new URL('../rules/vendor/srd-5.2.1/', import.meta.url),
    manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const sections = [],
    audit = [];
  for (const f of manifest.files) {
    const raw = await readFile(new URL(f.file, root), 'utf8');
    if (hash(raw) !== f.sha256) throw Error(`Vendor checksum mismatch: ${f.file}`);
    if (!f.rules) continue;
    const result = convert(f.file, raw, manifest.commit);
    sections.push(...result.sections);
    audit.push({
      file: f.file,
      headings: result.headings,
      sections: result.sections.length,
      tables: result.tables,
      warnings: result.warnings,
    });
  }
  if (new Set(sections.map((s) => s.id)).size !== sections.length)
    throw Error('Duplicate section IDs');
  const sectionsSha256 = hash(JSON.stringify(sections));
  const corpus = {
    id: 'srd-5.2.1',
    edition: '2024',
    version: '5.2.1',
    corpusRevision: `${manifest.commit}:v${manifest.conversionVersion}:${sectionsSha256}`,
    upstreamCommit: manifest.commit,
    license: 'CC-BY-4.0',
    sectionsSha256,
    sections,
  };
  await writeFile(
    new URL('../rules/srd-5.2.1-sections.json', import.meta.url),
    JSON.stringify(corpus, null, 2) + '\n',
  );
  await writeFile(
    new URL('../rules/section-audit.json', import.meta.url),
    JSON.stringify(audit, null, 2) + '\n',
  );
  console.log(`Built ${sections.length} sections from ${audit.length} files`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await build();
