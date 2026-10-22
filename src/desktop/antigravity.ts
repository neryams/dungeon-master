import { spawn, execFile, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, readdir, cp } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, delimiter, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { atomicWrite, safePath, CampaignStore } from '../store.js';

const execute = promisify(execFile);
export async function detectAntigravity(explicit?: string) {
  const names = process.platform === 'win32' ? ['agy.exe', 'agy.cmd'] : ['agy'];
  const candidates = explicit
    ? [explicit]
    : [
        ...names.flatMap((n) => (process.env.PATH ?? '').split(delimiter).map((p) => join(p, n))),
        join(homedir(), '.local', 'bin', names[0]),
      ];
  for (const path of candidates) {
    if (!isAbsolute(path)) continue;
    try {
      await access(path, constants.X_OK);
      const { stdout } = await execute(path, ['--version'], { timeout: 10000, maxBuffer: 100000 });
      const help = await execute(path, ['--help'], { timeout: 10000, maxBuffer: 100000 });
      const helpText = help.stdout + help.stderr;
      if (!helpText.includes('--input-format') || !helpText.includes('--output-format')) continue;
      return { path, version: stdout.trim() };
    } catch {
      /* Try the next installation. */
    }
  }
  throw new Error(
    'Antigravity CLI was not found or does not support streaming. Install and sign in with agy, then select its executable and check again.',
  );
}

export async function prepareWorkspace(
  store: CampaignStore,
  source: string,
  env: Record<string, string> = {},
  ownerToken?: string,
  provider: 'antigravity' | 'codex' = 'antigravity',
) {
  const workspace = provider === 'codex' ? '.dm/hotseat/codex-workspace' : '.dm/hotseat/workspace';
  const dir = await safePath(store.root, workspace, false);
  const agents = join(dir, '.agents');
  // Do not follow campaign-provided symlinks when regenerating app-owned files.
  for (const path of [
    '.agents',
    '.agents/mcp_config.json',
    'AGENTS.md',
    '.agents/skills',
    ...(await readdir(join(source, 'skills'), { recursive: true })).map(
      (p) => `.agents/skills/${p.replaceAll('\\', '/')}`,
    ),
  ])
    await safePath(store.root, `${workspace}/${path}`, false);
  await mkdir(agents, { recursive: true });
  const serverName = `dm-hotseat-${createHash('sha256').update(store.root).digest('hex').slice(0, 12)}`;
  await atomicWrite(
    join(agents, 'mcp_config.json'),
    JSON.stringify(
      {
        mcpServers: {
          [serverName]: {
            command: process.execPath,
            args: [
              join(source, ownerToken ? 'dist/desktop/server.js' : 'dist/server.js'),
              '--campaign',
              store.root,
            ],
            env: {
              ...env,
              ...(ownerToken ? { DM_HOTSEAT_OWNER_TOKEN: ownerToken } : {}),
              DM_DESKTOP_PROVIDER: provider,
            },
          },
        },
      },
      null,
      2,
    ),
  );
  await cp(join(source, 'skills'), join(agents, 'skills'), { recursive: true, force: true });
  await atomicWrite(
    join(dir, 'AGENTS.md'),
    `# Dungeon Master hotseat\n\nUse only the ${serverName} MCP server for this campaign. Use the Dungeon Master skills in .agents/skills. Never edit campaign files or invoke raw journal tools. All game changes go through campaign tools. Native image generation is allowed for create-map-art; use referencePath from render_location_map and import_generated_map_art to copy its generated output to campaign assets before register_map_art. Do not use shell for artwork file handling. The desktop shows only publish_table_message calls. Keep all DM secrets, referee deliberations and operational logs out of those messages.\n`,
  );
  const binding = JSON.parse(await readFile(join(agents, 'mcp_config.json'), 'utf8'));
  return {
    dir,
    serverName,
    server: binding.mcpServers[serverName] as {
      command: string;
      args: string[];
      env: Record<string, string>;
    },
  };
}

export const settingsFile = () => join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
// Antigravity 1.4 uses global permission rules even for workspace-local MCP servers.
// Merge only this campaign's exact server grant; never change ask/deny or other settings.
export async function grantCampaignPermission(serverName: string, path = settingsFile()) {
  if (!/^dm-hotseat-[a-f0-9]{12}$/.test(serverName)) throw new Error('Invalid campaign server');
  await mkdir(join(path, '..'), { recursive: true });
  const release = await lockfile.lock(join(path, '..'), { retries: 5 });
  try {
    let settings: Record<string, any> = {};
    try {
      settings = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new Error('Invalid Antigravity settings');
    const permissions = settings.permissions ?? {};
    if (
      !permissions ||
      typeof permissions !== 'object' ||
      Array.isArray(permissions) ||
      (permissions.allow !== undefined && !Array.isArray(permissions.allow))
    )
      throw new Error('Invalid Antigravity permissions; repair them in the CLI first');
    const rule = `mcp(${serverName}/*)`;
    if (permissions.allow?.includes(rule)) return { rule, added: false };
    settings.permissions = { ...permissions, allow: [...(permissions.allow ?? []), rule] };
    await atomicWrite(path, JSON.stringify(settings, null, 2) + '\n');
    return { rule, added: true };
  } finally {
    await release();
  }
}

export interface AgentResult {
  conversationId?: string;
  tools: string[];
  campaignIds: string[];
}
export interface AgentDriver {
  run(prompt: string): Promise<AgentResult>;
  close(): Promise<void>;
}
export class AntigravitySession implements AgentDriver {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: {
    resolve: (r: AgentResult) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
    tools: Set<string>;
    campaignIds: Set<string>;
  };
  private buffer = '';
  private conversationId?: string;
  private closing?: Promise<void>;
  constructor(
    private options: {
      executable: string;
      cwd: string;
      conversationId?: string;
      env?: NodeJS.ProcessEnv;
      timeoutMs?: number;
      progress?: (text: string) => void;
      onConversation?: (id: string) => void | Promise<void>;
      prefixArgs?: string[]; // Used by protocol contract tests, never exposed through desktop IPC.
    },
  ) {}

  run(prompt: string): Promise<AgentResult> {
    if (this.pending) return Promise.reject(new Error('The DM is already resolving an action'));
    if (this.closing) return Promise.reject(new Error('The DM session is stopping'));
    if (!this.child) this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          new Error(
            'The DM timed out. Saved changes remain intact. Review the table before continuing.',
          ),
        );
        void this.close();
      }, this.options.timeoutMs ?? 600000);
      this.pending = { resolve, reject, timer, tools: new Set(), campaignIds: new Set() };
      this.child!.stdin.write(
        JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
        (error) => {
          if (error) this.fail(new Error('Could not send the action to Antigravity'));
        },
      );
    });
  }
  private start() {
    const args = [
      ...(this.options.prefixArgs ?? []),
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
    ];
    if (this.options.conversationId) args.push('--conversation', this.options.conversationId);
    const child = spawn(this.options.executable, args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.child = child;
    child.stdin.on('error', () => this.fail(new Error('Antigravity input closed')));
    // Never forward stderr or raw model/tool events into the shared player renderer.
    child.stderr.on('data', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 16 * 1024 * 1024) {
        this.fail(new Error('Antigravity returned an oversized event'));
        void this.close();
        return;
      }
      let index: number;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.fail(new Error('Antigravity returned an invalid stream event'));
          void this.close();
          return;
        }
      }
    });
    child.on('error', () =>
      this.fail(new Error('Unable to start Antigravity. Check the executable and sign-in.')),
    );
    child.on('close', () => {
      this.fail(
        new Error(
          'Antigravity disconnected. Saved changes remain intact; the action was not automatically retried.',
        ),
      );
      // The MCP child may outlive a crashed CLI. Only signal this owned process group.
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {}
      }
      if (this.child === child) this.child = undefined;
    });
  }
  private receive(event: any) {
    const id =
      event.conversation_id ?? event.init?.conversation_id ?? event.result?.conversation_id;
    if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      this.conversationId = id;
      void Promise.resolve(this.options.onConversation?.(id)).catch(() => {
        this.fail(new Error('Could not save DM conversation context'));
        void this.close();
      });
    }
    if (event.event === 'step_update' && event.step_update?.step_type === 'tool') {
      const info = event.step_update.tool_info;
      const name = event.step_update.tool_name ?? info?.name;
      if (typeof name === 'string') {
        if (event.step_update.state === 'DONE' && !info?.error) {
          this.pending?.tools.add(name);
          // agy 1.4 routes MCP through call_mcp_tool; its name is not the domain tool name.
          // Recognize readiness from the actual campaign tool result, never assistant prose.
          if (name === 'call_mcp_tool' || name.includes('campaign_status')) {
            try {
              const output =
                typeof info?.output === 'string' ? JSON.parse(info.output) : info?.output;
              if (
                output?.campaign?.schemaVersion === 1 &&
                typeof output.campaign.id === 'string' &&
                Number.isInteger(output.revision) &&
                output.journal
              )
                this.pending?.campaignIds.add(output.campaign.id);
            } catch {
              /* Other MCP tool outputs are irrelevant to readiness. */
            }
          }
        }
        this.options.progress?.(
          name.includes('publish_table_message')
            ? 'Saving the DM response…'
            : name.includes('rules')
              ? 'Consulting the rules…'
              : 'The DM is resolving your action…',
        );
      }
    }
    if (event.event !== 'result' || !this.pending) return;
    if (event.result?.status !== 'SUCCESS') {
      this.fail(
        new Error(
          'Antigravity did not complete the turn. Check CLI authentication, limits and campaign permissions; saved changes remain intact.',
        ),
      );
      return;
    }
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve({
      conversationId: this.conversationId,
      tools: [...pending.tools],
      campaignIds: [...pending.campaignIds],
    });
  }
  private fail(error: Error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.fail(new Error('DM session stopped. Check saved state before continuing.'));
    const child = this.child;
    if (!child) return Promise.resolve();
    this.closing = new Promise<void>((resolve) => {
      const signal = (name: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name);
          else child.kill(name);
        } catch {}
      };
      const kill = setTimeout(() => signal('SIGKILL'), 3000);
      child.once('close', () => {
        clearTimeout(kill);
        resolve();
      });
      signal('SIGTERM');
    });
    return this.closing;
  }
}
