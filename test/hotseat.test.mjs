import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { readFile, writeFile, unlink, symlink, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';
import { fixture, apply, hero } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';
import { notifyActivity } from '../dist/desktop/activity-bus.js';
import {
  AntigravitySession,
  grantCampaignPermission,
  prepareWorkspace,
} from '../dist/desktop/antigravity.js';
import { gameplayFingerprint } from '../dist/review.js';
import { partyState } from '../dist/domain.js';
import { exportCampaign, importCampaign } from '../dist/backup.js';

async function table(store, op, operationId = randomUUID()) {
  const { state } = await store.read();
  return store.transact(
    { operationId, expectedRevision: state.revision, actor: 'test', reason: 'Hotseat test' },
    { table: op },
    () => ({ changes: [], records: [], table: op }),
  );
}
test('table events replay/export exactly, reject invalid transitions and do not invalidate rules approvals', async (t) => {
  const { store, service, parent } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    { type: 'put_entity', entity: { ...hero, id: 'secret', visibility: 'dm' } },
  ]);
  const before = gameplayFingerprint((await store.read()).state);
  await assert.rejects(
    table(store, { type: 'submit', id: 'hidden-seat', characterId: 'secret', text: 'Hi' }),
    /visible party/,
  );
  await table(
    store,
    { type: 'submit', id: 'turn-1', characterId: 'hero', text: '<script>test</script>' },
    'submit',
  );
  const retried = await table(
    store,
    { type: 'submit', id: 'turn-1', characterId: 'hero', text: '<script>test</script>' },
    'submit',
  );
  assert.equal(retried.duplicate, true);
  await assert.rejects(
    table(store, { type: 'submit', id: 'other', text: 'Overtake' }),
    /current table request/,
  );
  await assert.rejects(
    table(store, { type: 'finish', requestId: 'turn-1', status: 'completed' }),
    /public response/,
  );
  const input = {
    operationId: 'public-reply',
    expectedRevision: 2,
    reason: 'Answer',
    requestId: 'turn-1',
    text: 'The bridge is clear.',
  };
  await service.execute('publish_table_message', input);
  assert.equal((await service.execute('publish_table_message', input)).duplicate, true);
  await table(store, { type: 'finish', requestId: 'turn-1', status: 'completed' });
  const { state } = await store.read();
  assert.equal(gameplayFingerprint(state), before);
  assert.equal(state.table[0].messages.length, 1);
  assert.equal(state.table[0].messages[0].revision, 3);
  assert.equal(partyState(state).table, undefined);
  await assert.rejects(
    service.execute('publish_table_message', {
      ...input,
      operationId: 'late',
      expectedRevision: state.revision,
    }),
    /not pending/,
  );
  const restored = await importCampaign(join(parent, 'restored'), await exportCampaign(store));
  assert.deepEqual((await restored.read()).state, state);
});

test('desktop recovers unfinished requests, excludes secrets and rejects hidden maps and duplicate owners', async (t) => {
  const { store, service } = await fixture(t);
  await apply(service, [
    { type: 'put_entity', entity: hero },
    {
      type: 'put_entity',
      entity: {
        id: 'secret',
        name: 'PRIVATE_SECRET',
        kind: 'map',
        visibility: 'dm',
        map: { kind: 'grid' },
      },
    },
    {
      type: 'put_entity',
      entity: {
        id: 'grid',
        name: 'Courtyard',
        kind: 'map',
        map: {
          kind: 'grid',
          bounds: { width: 10, height: 10 },
          revealedRegions: [{ x: 0, y: 0, width: 10, height: 10 }],
          tokens: { hero: { x: 2, y: 3 } },
        },
      },
    },
  ]);
  await table(store, { type: 'submit', id: 'crashed', text: 'Approach the gate.' });
  await apply(service, [{ type: 'damage', id: 'hero', amount: 6 }]);
  const host = new DesktopHost({ source: resolve('.') });
  t.after(() => host.close());
  const view = await host.open(store.root);
  assert.equal(view.table[0].status, 'interrupted');
  assert.equal(view.party.members[0].hp, 8);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_SECRET/);
  assert.deepEqual(await host.submit({ id: 'crashed', text: 'Approach the gate.' }), {
    id: 'crashed',
    duplicate: true,
  });
  await assert.rejects(
    host.submit({ id: 'crashed', text: 'Do something else' }),
    /different input/,
  );
  await assert.rejects(host.map({ mapId: 'secret', revision: view.revision }), /not visible/);
  const map = await host.map({ mapId: 'grid', revision: view.revision });
  assert.match(map.image, /^data:image\/png;base64,/);
  await assert.rejects(
    host.map({
      mapId: 'grid',
      revision: view.revision,
      viewport: { x: Number.MAX_SAFE_INTEGER, y: 0, width: 40, height: 20 },
    }),
    /Invalid viewport/,
  );
  const second = new DesktopHost({ source: resolve('.') });
  await assert.rejects(second.open(store.root), /already open/);
  await apply(service, [{ type: 'heal', id: 'hero', amount: 1 }]);
  assert.deepEqual(await host.map({ mapId: 'grid', revision: view.revision }), { stale: true });
  await host.close();
  assert.equal((await second.open(store.root)).table.length, 1);
  await second.close();
});

test('Antigravity workspace setup preserves Codex files and permission merging preserves unrelated rules', async (t) => {
  const { store, parent } = await fixture(t);
  const permissionPath = join(parent, 'settings.json');
  const settings = {
    theme: 'dark',
    permissions: { deny: ['command(*)'], ask: ['mcp(other/*)'], allow: ['read_file(example)'] },
  };
  await writeFile(permissionPath, JSON.stringify(settings));
  const workspace = await prepareWorkspace(store, resolve('.'));
  const result = await grantCampaignPermission(workspace.serverName, permissionPath);
  assert.equal(result.added, true);
  assert.equal((await grantCampaignPermission(workspace.serverName, permissionPath)).added, false);
  const actual = JSON.parse(await readFile(permissionPath, 'utf8'));
  assert.deepEqual(actual, {
    ...settings,
    permissions: { ...settings.permissions, allow: [...settings.permissions.allow, result.rule] },
  });
  const mcp = JSON.parse(await readFile(join(workspace.dir, '.agents/mcp_config.json'), 'utf8'));
  assert.equal(mcp.mcpServers[workspace.serverName].args.at(-1), store.root);
  assert.equal(mcp.mcpServers[workspace.serverName].command, process.execPath);
  await assert.rejects(grantCampaignPermission('*', permissionPath), /Invalid campaign/);
});

test('structured CLI protocol keeps raw private output out of progress, handles split events, errors and interruption', async (t) => {
  const { parent } = await fixture(t);
  const fixturePath = join(parent, 'fake-cli.mjs');
  await writeFile(
    fixturePath,
    `
import readline from 'node:readline';
const line = x => process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({ input: process.stdin }).on('line', text => {
 const request = JSON.parse(text).message.content;
 if (request === 'hang') return;
 if (request === 'bad') { process.stdout.write('not json\\n'); return; }
 line({event:'init', conversation_id:'conversation-1'});
 line({event:'step_update',step_update:{step_type:'agent_response',text_delta:'PRIVATE_SECRET'}});
 line({event:'step_update',step_update:{step_type:'tool',state:'DONE',tool_name:'dm_campaign_status',tool_info:{output:'PRIVATE_SECRET'}}});
 const result=JSON.stringify({event:'result',result:{status: request === 'fail' ? 'ERROR' : 'SUCCESS', response:'PRIVATE_SECRET'}})+'\\n';
 process.stdout.write(result.slice(0,20)); setTimeout(()=>process.stdout.write(result.slice(20)),5);
});`,
  );
  const progress = [];
  const session = new AntigravitySession({
    executable: process.execPath,
    prefixArgs: [fixturePath],
    cwd: parent,
    progress: (s) => progress.push(s),
    timeoutMs: 1000,
  });
  t.after(() => session.close());
  const result = await session.run('hello');
  assert.deepEqual(result.tools, ['dm_campaign_status']);
  assert.equal(result.conversationId, 'conversation-1');
  assert.doesNotMatch(JSON.stringify([result, progress]), /PRIVATE_SECRET/);
  assert.equal((await session.run('second')).conversationId, 'conversation-1');
  await assert.rejects(session.run('fail'), /did not complete/);
  const hanging = session.run('hang');
  const rejection = assert.rejects(hanging, /stopped/);
  await assert.rejects(session.run('duplicate'), /already resolving/);
  await session.close();
  await rejection;
  const malformed = new AntigravitySession({
    executable: process.execPath,
    prefixArgs: [fixturePath],
    cwd: parent,
    timeoutMs: 1000,
  });
  await assert.rejects(malformed.run('bad'), /invalid stream/);
  await malformed.close();
});

test('coordinator serializes actions, deduplicates dispatch, requires public output and stops pending work safely', async (t) => {
  const { store, service, parent } = await fixture(t);
  let runs = 0,
    finish;
  const driver = () => ({
    run: async () => {
      runs++;
      if (runs === 1) return { tools: ['call_mcp_tool'], campaignIds: ['test'] };
      return new Promise((resolve, reject) => {
        finish = { resolve, reject };
      });
    },
    close: async () => {
      finish?.reject(new Error('Stopped'));
    },
  });
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(parent, 'agy/settings.json'),
    probe: async () => ({ path: process.execPath, version: 'fixture' }),
    driver,
  });
  t.after(() => host.close());
  await host.open(store.root);
  await host.connect();
  const input = { id: 'single', text: 'Look around' };
  await host.submit(input);
  await assert.rejects(
    host.submit({ id: 'overtake', text: 'Move' }),
    /current action|current table request|DM|campaign/,
  );
  for (let i = 0; i < 100 && !finish; i++) await delay(5);
  assert.equal(runs, 2);
  assert.equal((await host.submit(input)).duplicate, true);
  const revision = (await store.read()).state.revision;
  await service.execute('publish_table_message', {
    operationId: 'published',
    expectedRevision: revision,
    reason: 'Reply',
    requestId: 'single',
    text: 'The courtyard is quiet.',
  });
  finish.resolve({ tools: [], campaignIds: [] });
  for (let i = 0; i < 100 && (await host.snapshot()).stage === 'resolving'; i++) await delay(5);
  assert.equal((await host.snapshot()).table[0].status, 'completed');
  finish = undefined;
  await host.submit({ id: 'no-public-output', text: 'Look again' });
  for (let i = 0; i < 100 && !finish; i++) await delay(5);
  finish.resolve({ tools: [], campaignIds: [] });
  for (let i = 0; i < 100 && (await host.snapshot()).stage === 'resolving'; i++) await delay(5);
  const failed = await host.snapshot();
  assert.equal(failed.stage, 'attention');
  assert.equal(failed.table[1].status, 'interrupted');
  assert.equal(runs, 3);
});

test('stopping during connection never starts an agent later', async (t) => {
  const { store, parent } = await fixture(t);
  let resolveProbe,
    started = 0;
  const host = new DesktopHost({
    source: resolve('.'),
    permissionPath: join(parent, 'settings.json'),
    probe: () =>
      new Promise((r) => {
        resolveProbe = r;
      }),
    driver: () => {
      started++;
      throw Error('Must not start');
    },
  });
  t.after(() => host.close());
  await host.open(store.root);
  const connect = host.connect();
  const rejected = assert.rejects(connect, /stopped/);
  while (!resolveProbe) await delay(1);
  await host.stop();
  resolveProbe({ path: process.execPath, version: 'fixture' });
  await rejected;
  assert.equal(started, 0);
});

test('desktop MCP transport stops after ownership is revoked; regenerated workspace refuses symlinks', async (t) => {
  const { store, service, parent } = await fixture(t);
  const host = new DesktopHost({ source: resolve('.') });
  t.after(() => host.close());
  const desktopEvents = [];
  host.subscribe((event) => desktopEvents.push(event));
  await host.open(store.root);
  const owner = JSON.parse(await readFile(join(store.root, '.dm/hotseat/owner.json'), 'utf8'));
  assert.match(owner.endpoint, /(?:events\.sock|dm-activity-)/);
  const client = new Client({ name: 'owner-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/desktop/server.js'), '--campaign', store.root],
    env: { ...process.env, DM_HOTSEAT_OWNER_TOKEN: owner.token },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', () => {});
  t.after(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  assert.equal(
    (await client.callTool({ name: 'campaign_status', arguments: {} })).structuredContent.campaign
      .id,
    'test',
  );
  const publicRoll = await client.callTool({
    name: 'roll_dice',
    arguments: {
      operationId: 'desktop-wrapper-public-roll',
      expectedRevision: 0,
      reason: 'Visible hotseat roll',
      expression: '1d20+2',
      purpose: 'Perception check',
      visibility: 'party',
    },
  });
  assert.equal(publicRoll.isError, undefined);
  const activityFeed = JSON.parse(
    await readFile(join(store.root, '.dm/hotseat/activity.json'), 'utf8'),
  );
  assert.equal(activityFeed.ownerToken, owner.token);
  assert.equal(activityFeed.rolls[0].status, 'complete');
  assert.equal(activityFeed.rolls[0].label, 'Perception Check');
  assert.equal(activityFeed.rolls[0].total, publicRoll.structuredContent.roll.total);
  assert.doesNotMatch(JSON.stringify(activityFeed), /reason|Visible hotseat roll/);
  for (
    let i = 0;
    i < 100 &&
    !desktopEvents.some(
      (event) =>
        event.kind === 'activity' &&
        event.activity?.rolls.some(
          (roll) => roll.id === 'desktop-wrapper-public-roll' && roll.status === 'complete',
        ),
    );
    i++
  )
    await delay(5);
  assert.ok(
    desktopEvents.some(
      (event) =>
        event.kind === 'activity' &&
        event.activity?.rolls.some(
          (roll) => roll.id === 'desktop-wrapper-public-roll' && roll.status === 'rolling',
        ),
    ),
  );
  assert.ok(
    desktopEvents.some(
      (event) =>
        event.kind === 'activity' &&
        event.activity?.rolls.some(
          (roll) => roll.id === 'desktop-wrapper-public-roll' && roll.status === 'complete',
        ),
    ),
  );
  assert.ok(desktopEvents.some((event) => event.kind === 'changed'));
  assert.equal(
    (await host.snapshot()).activity.rolls[0].total,
    publicRoll.structuredContent.roll.total,
  );
  const ownerPath = join(store.root, '.dm/hotseat/owner.json');
  await writeFile(
    ownerPath,
    JSON.stringify({ ...owner, endpoint: join(store.root, 'missing.sock') }),
  );
  const recoveredRoll = await client.callTool({
    name: 'roll_dice',
    arguments: {
      operationId: 'desktop-recovered-roll',
      expectedRevision: 1,
      reason: 'Recovery test',
      expression: '1d20',
      purpose: 'Perception check',
      visibility: 'party',
    },
  });
  assert.equal(recoveredRoll.isError, undefined);
  assert.equal(
    desktopEvents.some((event) =>
      event.activity?.rolls.some((roll) => roll.id === 'desktop-recovered-roll'),
    ),
    false,
  );
  await writeFile(ownerPath, JSON.stringify(owner));
  const recovered = await host.snapshot();
  assert.equal(
    recovered.activity.rolls.find((roll) => roll.id === 'desktop-recovered-roll').total,
    recoveredRoll.structuredContent.roll.total,
  );
  const pending = (id) => ({ id, label: 'Dice roll', notation: '1d20', status: 'rolling' });
  await Promise.all([
    notifyActivity(owner.endpoint, {
      token: owner.token,
      kind: 'activity',
      activity: { rolls: [pending('parallel-a')] },
    }),
    notifyActivity(owner.endpoint, {
      token: owner.token,
      kind: 'activity',
      activity: { rolls: [pending('parallel-b')] },
    }),
  ]);
  await notifyActivity(owner.endpoint, {
    token: owner.token,
    kind: 'activity',
    activity: {
      rolls: [pending('desktop-wrapper-public-roll')],
    },
  });
  await notifyActivity(owner.endpoint, {
    token: owner.token,
    kind: 'activity',
    activity: {
      rolls: [{ ...pending('uncommitted-total'), status: 'complete', total: 999 }],
    },
  });
  for (
    let i = 0;
    i < 100 && !(await host.snapshot()).activity.rolls.some((roll) => roll.id === 'parallel-b');
    i++
  )
    await delay(5);
  const merged = (await host.snapshot()).activity.rolls;
  assert.ok(merged.some((roll) => roll.id === 'parallel-a'));
  assert.ok(merged.some((roll) => roll.id === 'parallel-b'));
  assert.equal(merged.find((roll) => roll.id === 'desktop-wrapper-public-roll').status, 'complete');
  assert.equal(
    merged.some((roll) => roll.id === 'uncommitted-total'),
    false,
  );
  await apply(service, [
    {
      type: 'put_entity',
      entity: { id: 'reference-map', name: 'Map', kind: 'map', map: { kind: 'grid' } },
    },
  ]);
  const reference = await client.callTool({
    name: 'render_location_map',
    arguments: {
      mapId: 'reference-map',
      mode: 'reference',
      audience: 'party',
      viewport: { x: 0, y: 0, width: 4, height: 4 },
    },
  });
  assert.equal(reference.isError, undefined);
  assert.ok(
    reference.structuredContent.referencePath.startsWith(
      join(store.root, '.dm/hotseat/workspace/map-references/'),
    ),
  );
  assert.deepEqual(
    await readFile(reference.structuredContent.referencePath),
    Buffer.from(reference.content.find((c) => c.type === 'image').data, 'base64'),
  );
  const invalidImport = await client.callTool({
    name: 'import_generated_map_art',
    arguments: { sourcePath: '/outside.png' },
  });
  assert.equal(invalidImport.isError, true);
  await unlink(join(store.root, '.dm/hotseat/owner.json'));
  await delay(1300);
  await assert.rejects(client.callTool({ name: 'campaign_status', arguments: {} }));
  const workspace = join(store.root, '.dm/hotseat/workspace');
  await mkdir(workspace, { recursive: true });
  await symlink(parent, join(workspace, '.agents'));
  await assert.rejects(prepareWorkspace(store, resolve('.')), /Symlinks/);
});

test('snapshot recovery cannot overwrite a newer tool phase', async (t) => {
  const { store, service } = await fixture(t);
  const host = new DesktopHost({ source: resolve('.') });
  t.after(() => host.close());
  await host.open(store.root);
  await apply(service, [{ type: 'put_entity', entity: hero }]);
  await table(store, {
    type: 'submit',
    id: 'phase-race',
    characterId: 'hero',
    text: 'Look around',
  });
  const owner = JSON.parse(await readFile(join(store.root, '.dm/hotseat/owner.json'), 'utf8'));
  let entered;
  let release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const original = host.activity.snapshot.bind(host.activity);
  host.activity.snapshot = async () => {
    entered();
    await blocked;
    return { phase: 'Stale phase', rolls: [] };
  };
  try {
    const reading = host.snapshot();
    await started;
    await notifyActivity(owner.endpoint, {
      token: owner.token,
      kind: 'activity',
      requestId: 'phase-race',
      activity: { phase: 'Checking rules', rolls: [] },
    });
    release();
    const snapshot = await reading;
    assert.equal(snapshot.activity.phase, 'Checking rules');
  } finally {
    release();
    host.activity.snapshot = original;
  }
});

test('snapshot settles abandoned rolls from committed events after a turn ends', async (t) => {
  const { store, service } = await fixture(t);
  const host = new DesktopHost({ source: resolve('.') });
  t.after(() => host.close());
  await host.open(store.root);
  const owner = JSON.parse(await readFile(join(store.root, '.dm/hotseat/owner.json'), 'utf8'));
  const pending = (id) => ({ id, label: 'Dice roll', notation: '1d20', status: 'rolling' });
  host.stage = 'resolving';
  await notifyActivity(owner.endpoint, {
    token: owner.token,
    kind: 'activity',
    activity: { rolls: [pending('saved-without-finish')] },
  });
  await notifyActivity(owner.endpoint, {
    token: owner.token,
    kind: 'activity',
    activity: { rolls: [pending('abandoned-roll')] },
  });
  const active = await host.snapshot();
  assert.deepEqual(
    active.activity.rolls.map((roll) => roll.status),
    ['rolling', 'rolling'],
  );
  const committed = await service.execute('roll_dice', {
    operationId: 'saved-without-finish',
    expectedRevision: 0,
    reason: 'Saved before process loss',
    expression: '1d20',
    purpose: 'Perception check',
    visibility: 'party',
  });
  host.stage = 'attention';
  const settled = await host.snapshot();
  assert.equal(
    settled.activity.rolls.find((roll) => roll.id === 'saved-without-finish').total,
    committed.roll.total,
  );
  assert.equal(
    settled.activity.rolls.find((roll) => roll.id === 'saved-without-finish').status,
    'complete',
  );
  assert.equal(
    settled.activity.rolls.find((roll) => roll.id === 'abandoned-roll').status,
    'failed',
  );
  host.stage = 'resolving';
  assert.equal(
    (await host.snapshot()).activity.rolls.find((roll) => roll.id === 'abandoned-roll').status,
    'failed',
  );
});

test('desktop imports only its conversation raster assets and renders backgrounds with cached fallback warnings', async (t) => {
  const { store, service, parent } = await fixture(t);
  const { importGeneratedArt } = await import('../dist/desktop/art.js');
  const { renderMapImage } = await import('../dist/maps.js');
  const sharp = (await import('sharp')).default;
  const brain = join(parent, 'brain');
  const conversation = join(brain, 'test-conversation');
  await mkdir(conversation, { recursive: true });
  const image = join(conversation, 'courtyard.png');
  await sharp({ create: { width: 200, height: 200, channels: 3, background: '#824abe' } })
    .png()
    .toFile(image);
  const host = new DesktopHost({ source: resolve('.') });
  t.after(() => host.close());
  await host.open(store.root);
  await writeFile(
    join(store.root, '.dm/hotseat/session.json'),
    JSON.stringify({ campaignRoot: store.root, conversationId: 'test-conversation' }),
  );
  const art = await importGeneratedArt(store, image, brain);
  assert.deepEqual(await importGeneratedArt(store, image, brain), art);
  assert.deepEqual(await readFile(join(store.root, art.path)), await readFile(image));
  await assert.rejects(importGeneratedArt(store, join(parent, 'outside.png'), brain), /path/i);
  await symlink(image, join(conversation, 'link.png'));
  await assert.rejects(
    importGeneratedArt(store, join(conversation, 'link.png'), brain),
    /Symlinks/,
  );
  await writeFile(join(conversation, 'bad.png'), 'not image bytes');
  await assert.rejects(importGeneratedArt(store, join(conversation, 'bad.png'), brain));
  await apply(service, [
    {
      type: 'put_entity',
      entity: {
        id: 'map',
        kind: 'map',
        name: 'Courtyard',
        map: {
          kind: 'grid',
          bounds: { width: 4, height: 4 },
          revealedRegions: [{ x: 0, y: 0, width: 4, height: 4 }],
        },
      },
    },
  ]);
  const viewport = { x: 0, y: 0, width: 4, height: 4 };
  await service.execute('register_map_art', {
    operationId: 'desktop-art',
    expectedRevision: 1,
    reason: 'Test background',
    mapId: 'map',
    art: {
      path: art.path,
      purpose: 'Background',
      sourceRevision: 1,
      visibility: 'party',
      background: { extent: viewport },
    },
  });
  const state = (await store.read()).state;
  const expected = await renderMapImage(store.root, state, 'map', 'party', viewport);
  const rendered = await host.map({ mapId: 'map', revision: 2, viewport });
  assert.equal(rendered.image, `data:image/png;base64,${expected.png.toString('base64')}`);
  assert.deepEqual(rendered.warnings, []);
  await unlink(join(store.root, art.path));
  // A new viewport forces validation; the warning must also survive the cache hit.
  const input = { mapId: 'map', revision: 2, viewport: { ...viewport, width: 3 } };
  const fallback = await host.map(input);
  assert.match(fallback.warnings.join(' '), /missing, changed, or unreadable/);
  assert.deepEqual(await host.map(input), fallback);
  assert.equal((await store.read()).state.revision, 2, 'Rendering never writes campaign events');
});
