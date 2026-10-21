#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, mkdtemp, writeFile, cp, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { CampaignStore, initialize, atomicWrite } from './store.js';
import { CampaignConfig } from './schema.js';
import { exportCampaign, importCampaign } from './backup.js';
import { CampaignService } from './service.js';
import { JournalAdapter, McpJournal } from './journal.js';
import { serve } from './server.js';
import { startPanel } from './panel.js';

const usage = `Dungeon Master (Node >=22)
  dungeon-master init <slug> [--name NAME] [--edition 2014|2024] [--parent DIR] [--config JSON]
  dungeon-master panel --campaign DIR [--lan] [--port PORT]
  dungeon-master serve --campaign DIR
  dungeon-master validate --campaign DIR
  dungeon-master export --campaign DIR --output FILE
  dungeon-master import FILE --campaign NEW_DIR
  dungeon-master setup --campaign DIR
  dungeon-master journal-sync --campaign DIR
  dungeon-master demo [--parent DIR]

init/import create a new directory and local Git repository. No remote or push.
setup creates a campaign-bound plugin, project marketplace and enablement configuration.
DM_JOURNAL_SERVER can override the pinned dependency's dist/server.js.
`;
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    campaign: { type: 'string' },
    name: { type: 'string' },
    edition: { type: 'string' },
    parent: { type: 'string' },
    config: { type: 'string' },
    output: { type: 'string' },
    help: { type: 'boolean' },
    lan: { type: 'boolean' },
    port: { type: 'string' },
  },
});
const [command, arg] = positionals;
function git(root: string) {
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'pipe' });
}
async function setup(store: CampaignStore) {
  const source = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = join(store.root, '.codex');
  await mkdir(dir, { recursive: true });
  const configPath = join(dir, 'config.toml');
  try {
    await access(configPath);
    throw new Error(
      'Project config already exists; preserve it and use docs/installation.md to merge configuration.',
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const pluginDir = join(store.root, '.dm', 'plugin');
  await mkdir(pluginDir, { recursive: true });
  for (const path of ['plugin.json', 'skills', 'README.md', 'docs'])
    await cp(join(source, path), join(pluginDir, path), { recursive: true });
  const serverPath = join(source, 'dist/server.js');
  await writeFile(
    join(pluginDir, 'mcp.json'),
    JSON.stringify(
      {
        $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        mcpServers: {
          'dungeon-master': {
            type: 'stdio',
            command: process.execPath,
            args: [serverPath, '--campaign', store.root],
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
  const market = `dm-${store.config.id}-${createHash('sha256').update(store.root).digest('hex').slice(0, 8)}`;
  const marketDir = join(store.root, '.agents/plugins');
  await mkdir(marketDir, { recursive: true });
  await writeFile(
    join(marketDir, 'marketplace.json'),
    JSON.stringify(
      {
        name: market,
        interface: { displayName: `DM: ${store.config.name}` },
        plugins: [
          {
            name: 'dungeon-master',
            source: { source: 'local', path: './.dm/plugin' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        ],
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  await writeFile(configPath, `[plugins."dungeon-master@${market}"]\nenabled = true\n`, {
    flag: 'wx',
  });
  return {
    campaign: store.root,
    plugin: pluginDir,
    marketplace: market,
    config: configPath,
    next: 'Open this campaign folder as a trusted Codex project. Install Dungeon Master from its project marketplace and start a new conversation.',
  };
}
async function main() {
  if (values.help || !command) {
    console.log(usage);
    return;
  }
  if (command === 'init') {
    if (!arg || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(arg))
      throw new Error('Supply a lowercase campaign slug');
    const parent = resolve(values.parent ?? join(homedir(), 'Campaigns'));
    await mkdir(parent, { recursive: true });
    const raw = values.config ? JSON.parse(await readFile(values.config, 'utf8')) : {};
    const config = CampaignConfig.parse({
      ...raw,
      schemaVersion: 1,
      id: arg,
      name: values.name ?? raw.name ?? arg,
      edition: values.edition ?? raw.edition ?? '2024',
    });
    const store = await initialize(join(parent, arg), config);
    git(store.root);
    console.log(JSON.stringify(await setup(store), null, 2));
    return;
  }
  if (command === 'demo') {
    const parent = values.parent
      ? resolve(values.parent)
      : await mkdtemp(join(tmpdir(), 'dm-demo-'));
    await mkdir(parent, { recursive: true });
    const store = await initialize(
      join(parent, `lantern-ford-${Date.now()}`),
      CampaignConfig.parse({
        schemaVersion: 1,
        id: 'lantern-ford',
        name: 'The Lantern at Briar Ford',
        premise: 'A ferry lantern has gone dark on the night of the harvest crossing.',
      }),
    );
    git(store.root);
    const service = new CampaignService(
      store,
      new JournalAdapter(store, new McpJournal(store.root)),
    );
    try {
      const example = JSON.parse(
        await readFile(
          join(dirname(fileURLToPath(import.meta.url)), '../examples/lantern-ford.json'),
          'utf8',
        ),
      );
      await service.execute('apply_campaign_changes', {
        operationId: randomUUID(),
        expectedRevision: 0,
        reason: 'Initialize the original example adventure',
        changes: example.changes,
      });
      await service.execute('record_scene', {
        operationId: randomUUID(),
        expectedRevision: 1,
        reason: 'Record the starting scene',
        title: 'Arrival at Briar Ford',
        content: example.opening,
      });
      const mutate = async (
        name: import('./service.js').ToolName,
        args: Record<string, unknown>,
      ) => {
        const { state } = await store.read();
        return service.execute(name, {
          operationId: randomUUID(),
          expectedRevision: state.revision,
          reason: 'Briar Ford map demonstration',
          ...args,
        });
      };
      await mutate('record_scene', {
        title: 'Player briefing',
        content: example.briefing,
        visibility: 'party',
      });
      await mutate('record_scene', {
        title: 'Private opening reference',
        content: example.dmReference,
        visibility: 'dm',
      });
      await mutate('create_location_map', { entity: example.bridgeMap });
      await mutate('apply_campaign_changes', { changes: example.concludeFerryman });
      await mutate('update_map_positions', {
        mapId: 'river-crossing',
        group: { entityIds: ['mara', 'tess'], position: { x: 4, y: 6 } },
      });
      await mutate('update_map_positions', {
        mapId: 'river-crossing',
        positions: [{ entityId: 'tess', x: 5, y: 8 }],
      });
      const views = [];
      for (const audience of ['dm', 'party']) {
        const { image, ...metadata } = (await service.execute('render_location_map', {
          mapId: 'river-crossing',
          audience,
        })) as Record<string, unknown>;
        views.push(metadata);
      }
      console.log(
        JSON.stringify(
          { campaign: store.root, views, resume: await service.resume('party') },
          null,
          2,
        ),
      );
    } finally {
      await service.close();
    }
    return;
  }
  if (!values.campaign) throw new Error('--campaign is required');
  const root = resolve(values.campaign);
  if (command === 'import') {
    if (!arg) throw new Error('Supply an archive file');
    const store = await importCampaign(root, JSON.parse(await readFile(arg, 'utf8')));
    git(store.root);
    console.log(JSON.stringify(await setup(store), null, 2));
    return;
  }
  if (command === 'panel') {
    const port = Number(values.port ?? 4317);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Port must be between 1 and 65535');
    const panel = await startPanel(root, { lan: values.lan, port });
    console.log(
      'Read-only player panel. Keep this process running. Access links:\n' + panel.urls.join('\n'),
    );
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void panel.close().then(() => process.exit(0));
      });
    return;
  }
  if (command === 'serve') {
    await serve(root);
    return;
  }
  const store = await CampaignStore.open(root);
  switch (command) {
    case 'validate': {
      const { state, events } = await store.read();
      const journal = await new JournalAdapter(store, new McpJournal(root)).health();
      console.log(
        JSON.stringify(
          { valid: true, revision: state.revision, events: events.length, journal },
          null,
          2,
        ),
      );
      break;
    }
    case 'export': {
      if (!values.output) throw new Error('--output is required');
      await atomicWrite(
        resolve(values.output),
        JSON.stringify(await exportCampaign(store), null, 2) + '\n',
      );
      console.log(values.output);
      break;
    }
    case 'setup':
      console.log(JSON.stringify(await setup(store), null, 2));
      break;
    case 'journal-sync': {
      const journal = new JournalAdapter(store, new McpJournal(root));
      try {
        console.log(JSON.stringify(await journal.flush(), null, 2));
      } finally {
        await journal.close();
      }
      break;
    }
    default:
      throw new Error(usage);
  }
}
await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
