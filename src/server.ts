#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import { CampaignStore } from './store.js';
import { JournalAdapter, McpJournal } from './journal.js';
import { CampaignService, descriptions, inputs, ToolName } from './service.js';
import { CampaignError } from './domain.js';

export function createMcpServer(service: CampaignService): McpServer {
  const server = new McpServer({ name: 'dungeon-master', version: '0.6.0' });
  for (const name of Object.keys(inputs) as ToolName[]) {
    const readOnly = [
      'get_action',
      'search_rules',
      'read_rules',
      'list_rule_sections',
      'campaign_status',
      'get_character_sheet',
      'get_party_overview',
      'render_location_map',
      'get_campaign_entity',
      'search_campaign_history',
      'read_campaign_record',
    ].includes(name);
    server.registerTool(
      name,
      {
        description: descriptions[name],
        inputSchema: inputs[name].shape,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const started = Date.now();
        try {
          const data = await service.execute(name, args);
          process.stderr.write(
            JSON.stringify({
              tool: name,
              operationId: 'operationId' in args ? args.operationId : undefined,
              revision: (data as { revision?: number })?.revision,
              durationMs: Date.now() - started,
              status: 'ok',
            }) + '\n',
          );
          const { image, ...structured } = data as Record<string, unknown> & {
            image?: { data: string; mimeType: 'image/png' };
          };
          return {
            structuredContent: structured,
            content: [
              { type: 'text' as const, text: JSON.stringify(structured) },
              ...(image
                ? [{ type: 'image' as const, mimeType: image.mimeType, data: image.data }]
                : []),
            ],
          };
        } catch (error) {
          const details =
            error instanceof CampaignError
              ? { code: error.code, message: error.message, details: error.details }
              : error instanceof ZodError
                ? {
                    code: 'INVALID_INPUT',
                    message: 'Input failed validation',
                    fields: error.issues.map((i) => ({ path: i.path, message: i.message })),
                  }
                : {
                    code: 'INTERNAL_ERROR',
                    message:
                      'Operation failed; retry the same operation ID after checking campaign status.',
                  };
          process.stderr.write(
            JSON.stringify({
              tool: name,
              durationMs: Date.now() - started,
              status: 'error',
              code: details.code,
            }) + '\n',
          );
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(details) }],
          };
        }
      },
    );
  }
  return server;
}
export async function serve(root: string): Promise<void> {
  const store = await CampaignStore.open(root);
  const service = new CampaignService(store, new JournalAdapter(store, new McpJournal(store.root)));
  const server = createMcpServer(service);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await service.close();
    await server.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void close().finally(() => process.exit(0));
    });
  process.stdin.once('end', () => {
    void close();
  });
  await server.connect(new StdioServerTransport());
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let cwd = process.cwd();
  while (!existsSync(join(cwd, 'campaign.json')) && dirname(cwd) !== cwd) cwd = dirname(cwd);
  const index = process.argv.indexOf('--campaign');
  const root =
    index >= 0
      ? process.argv[index + 1]
      : (process.env.DM_CAMPAIGN_ROOT ??
        (existsSync(join(cwd, 'campaign.json')) ? cwd : undefined));
  if (!root) {
    process.stderr.write('Set DM_CAMPAIGN_ROOT or pass --campaign /absolute/campaign/path\n');
    process.exitCode = 1;
  } else
    await serve(root).catch((error) => {
      process.stderr.write(`Cannot open campaign: ${error.message}\n`);
      process.exitCode = 1;
    });
}
