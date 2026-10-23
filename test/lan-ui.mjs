import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { fixture, apply } from './helpers.mjs';
import { DesktopHost } from '../dist/desktop/host.js';

test(
  'phone and desktop browsers share intentions, maps and targeted decisions',
  { timeout: 60000 },
  async (t) => {
    const { store, service, parent } = await fixture(t);
    const example = JSON.parse(await readFile('examples/lantern-ford.json', 'utf8'));
    await apply(service, example.changes);
    await service.execute('create_location_map', {
      operationId: 'map',
      expectedRevision: 1,
      reason: 'test',
      entity: example.bridgeMap,
    });
    let count = 0;
    const host = new DesktopHost({
      source: resolve('.'),
      permissionPath: join(parent, 'settings.json'),
      probe: async () => ({ path: process.execPath, version: 'fixture' }),
      driver: () => ({
        run: async () => {
          count++;
          if (count === 1) return { tools: ['call_mcp_tool'], campaignIds: ['test'] };
          const s = await host.snapshot();
          await service.execute('publish_table_message', {
            operationId: randomUUID(),
            expectedRevision: s.revision,
            reason: 'test',
            requestId: s.table.at(-1).id,
            text: `The lantern lights the bridge. **The sign** points ahead, and Tess *listens*.

## By the river

- The lantern burns low.
- Water rushes below.

1. Read the sign.
2. Follow the path.

The inscription says \`keep moving\`.

\`\`\`text
Lantern light fades.
\`\`\`

<script>window.UNSAFE=true</script>
<img src="https://example.invalid/hostile.png" onerror="window.UNSAFE=true">
<div onclick="window.UNSAFE=true">raw HTML stays text</div>
![remote image](https://example.invalid/markdown.png)
[unsafe link](javascript:window.UNSAFE=true)`,
            ...(count === 2
              ? {
                  responseRequest: {
                    characterIds: ['tess'],
                    prompt: 'Tess, do you cross?',
                    kind: 'decision',
                  },
                }
              : {}),
          });
          return { tools: [], campaignIds: [] };
        },
        close: async () => {},
      }),
    });
    t.after(() => host.close());
    await host.open(store.root);
    await host.connect();
    const lan = await host.startLan();
    const browser = await chromium.launch({
      executablePath: process.env.DM_CHROME ?? '/usr/bin/google-chrome',
      headless: true,
    });
    t.after(() => browser.close());
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await phone.newPage(),
      b = await desktop.newPage();
    const errors = [];
    for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
    async function joinGame(p, name, character) {
      await p.goto(lan.urls.find((u) => !u.includes('127.0.0.1')) ?? lan.urls[0]);
      await p.locator('#name').fill(name);
      await p.getByRole('button', { name: 'Join game', exact: true }).click();
      await p.getByRole('button', { name: character, exact: true }).click();
      await p.locator('#acting').filter({ hasText: character }).waitFor();
    }
    await joinGame(a, 'Alice', 'Mara');
    if (lan.urls.some((u) => !u.includes('127.0.0.1')))
      assert.equal(await a.evaluate(() => isSecureContext), false);
    await joinGame(b, 'Bob', 'Tess');
    await a.locator('#text').fill('I inspect the bridge.');
    await a.locator('#confirm').click();
    await b.locator('#intentions').filter({ hasText: 'I inspect the bridge.' }).waitFor();
    assert.equal(count, 1);
    await b.locator('#text').fill('I watch the river.');
    await b.locator('#confirm').click();
    await a.locator('#turn').filter({ hasText: 'Tess, do you cross?' }).waitFor();
    assert.equal(await a.locator('#text').isDisabled(), true);
    await b.locator('#turn').filter({ hasText: 'Tess, do you cross?' }).waitFor();
    assert.equal(await b.locator('#now').isDisabled(), true);
    await b.locator('#text').fill('Yes, carefully.');
    await b.locator('#confirm').click();
    await a.waitForFunction(() => document.querySelectorAll('#transcript article').length === 2);
    const narration = a.locator('#transcript .message-markdown:has(h2)').first();
    assert.equal(await narration.locator('h2').count(), 1);
    assert.equal(await narration.locator('strong').innerText(), 'The sign');
    assert.equal(await narration.locator('em').innerText(), 'listens');
    assert.equal(await narration.locator('ul li').count(), 2);
    assert.equal(await narration.locator('ol li').count(), 2);
    assert.equal(await narration.locator('code').count(), 2);
    assert.equal(await narration.locator('pre code').count(), 1);
    assert.equal(await a.locator('#transcript script, #transcript img, #transcript a').count(), 0);
    assert.match(
      await a.locator('#transcript').innerText(),
      /<script>window\.UNSAFE=true<\/script>/,
    );
    assert.match(await a.locator('#transcript').innerText(), /<img src=/);
    assert.match(await a.locator('#transcript').innerText(), /unsafe link/);
    assert.equal(await a.evaluate(() => window.UNSAFE), undefined);
    await a.getByRole('button', { name: 'Map', exact: true }).click();
    await a.waitForFunction(() => document.querySelector('#map-image').naturalWidth > 0);
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mkdir('/tmp/dm-lan-ui', { recursive: true });
    await a.screenshot({ path: '/tmp/dm-lan-ui/phone-map.png', fullPage: true });
    await a.getByRole('button', { name: 'Table', exact: true }).click();
    await a.screenshot({ path: '/tmp/dm-lan-ui/phone-table.png', fullPage: true });
    await b.screenshot({ path: '/tmp/dm-lan-ui/desktop.png', fullPage: true });
    await a.reload();
    await a.locator('#acting').filter({ hasText: 'Mara' }).waitFor();
    assert.equal(await a.locator('#join').isHidden(), true);
    await a.getByRole('button', { name: 'Character', exact: true }).click();
    await a.locator('#sheet-select').selectOption('tess');
    assert.match(await a.locator('#sheet-content').innerText(), /Tess/);
    await a.getByRole('button', { name: 'Table', exact: true }).click();
    const beforeRetry = count;
    await a.route(
      '**/api/intent',
      async (route) => {
        await route.fetch();
        await route.abort('failed');
      },
      { times: 1 },
    );
    await a.locator('#text').fill('I listen again.');
    await a.locator('#now').click();
    await a.locator('#retry').waitFor();
    await a.reload();
    await a.locator('#retry').waitFor();
    await a.locator('#retry').click();
    await a.waitForFunction(() => document.querySelector('#retry').hidden);
    assert.equal(count, beforeRetry + 1, 'Lost response and reload must not rerun CLI');
    assert.deepEqual(errors, []);
  },
);
