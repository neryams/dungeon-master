import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
// Fail before changing config if the optional dependency was not installed.
const server = require.resolve('journal-rag');
await readFile(join(root, 'journal-rag.config.json'), 'utf8');
const path = join(root, '.codex/config.toml');
let existing = '';
try {
  existing = await readFile(path, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const marker = '# BEGIN dungeon-master development journal';
const endMarker = '# END dungeon-master development journal';
const quote = JSON.stringify;
const block = `${marker}
[mcp_servers.project_journal]
command = ${quote(process.execPath)}
args = [${quote(server)}]
cwd = ${quote(root)}
startup_timeout_sec = 30
tool_timeout_sec = 120

[mcp_servers.project_journal.env]
JOURNAL_RAG_WORKSPACE = ${quote(root)}
${endMarker}`;
const start = existing.indexOf(marker);
let next;
if (start !== -1) {
  const end = existing.indexOf(endMarker, start);
  if (end === -1) throw new Error('Incomplete managed journal block; inspect .codex/config.toml.');
  next = existing.slice(0, start) + block + existing.slice(end + endMarker.length);
} else {
  if (/^\s*\[mcp_servers\.(?:project_journal|"project_journal")(?:\.|\])/m.test(existing)) {
    throw new Error('project_journal already configured; preserve or rename it before setup.');
  }
  next = `${existing}${existing.endsWith('\n') || !existing ? '' : '\n'}\n${block}\n`;
}
await mkdir(join(root, '.codex'), { recursive: true });
await mkdir(join(root, 'docs/journal'), { recursive: true });
await writeFile(path, next);
console.log(
  `Configured project_journal in ${path}. Open this repository as a trusted Codex project and start a new session.`,
);
