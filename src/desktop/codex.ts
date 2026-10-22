import { spawn, execFile, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, delimiter, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { AgentDriver, AgentResult } from './antigravity.js';

const execute = promisify(execFile);
// config/read serializes absent TOML fields as null; TOML overrides cannot contain null.
function withoutNulls(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? withoutNulls(v) : v]),
  );
}
export async function detectCodex(explicit?: string) {
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
  const candidates = explicit
    ? [explicit]
    : [
        ...names.flatMap((n) => (process.env.PATH ?? '').split(delimiter).map((p) => join(p, n))),
        join(homedir(), '.local/bin', names[0]),
      ];
  for (const path of candidates) {
    if (!isAbsolute(path)) continue;
    try {
      await access(path, constants.X_OK);
      const { stdout } = await execute(path, ['--version'], { timeout: 10000 });
      const help = await execute(path, ['app-server', '--help'], { timeout: 10000 });
      if (!(help.stdout + help.stderr).includes('--listen')) continue;
      return { path, version: stdout.trim() };
    } catch {
      /* Try another installation. */
    }
  }
  throw new Error(
    'Codex CLI with app-server was not found. Install Codex, run codex login, then choose its executable.',
  );
}

export interface CodexOptions {
  executable: string;
  cwd: string;
  serverName: string;
  server: { command: string; args: string[]; env: Record<string, string> };
  conversationId?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  progress?: (text: string) => void;
  onConversation?: (id: string) => void | Promise<void>;
  onImage?: (path: string) => void | Promise<void>;
  prefixArgs?: string[]; // Protocol tests only, never exposed through IPC.
}

/** Local Codex harness only. Authentication and model access remain owned by the CLI. */
export class CodexSession implements AgentDriver {
  private child?: ChildProcessWithoutNullStreams;
  private closed = false;
  private closing?: Promise<void>;
  private sequence = 0;
  private buffer = '';
  private threadId?: string;
  private turnId?: string;
  private imageWrites = Promise.resolve();
  private requests = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private pending?: {
    resolve: (value: AgentResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    tools: Set<string>;
    campaignIds: Set<string>;
  };
  constructor(private options: CodexOptions) {}

  run(prompt: string): Promise<AgentResult> {
    if (this.closed)
      return Promise.reject(
        new Error('The Codex session is stopped. Reconnect before continuing.'),
      );
    if (this.pending) return Promise.reject(new Error('The DM is already resolving an action'));
    const result = new Promise<AgentResult>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.abort(
            new Error(
              'Codex timed out. Saved changes remain intact; review the table before reconnecting.',
            ),
          ),
        this.options.timeoutMs ?? 600000,
      );
      this.pending = { resolve, reject, timer, tools: new Set(), campaignIds: new Set() };
    });
    void this.dispatch(prompt).catch(() =>
      this.abort(
        new Error(
          'Codex could not start or resume the turn. Check CLI sign-in and limits; use Reset DM context if the saved conversation is unavailable.',
        ),
      ),
    );
    return result;
  }
  private async dispatch(prompt: string) {
    if (!this.child) {
      this.start();
      await this.request('initialize', {
        clientInfo: { name: 'dungeon_master', title: 'Dungeon Master', version: '0.6.0' },
      });
      this.send({ method: 'initialized' });
      const auth = await this.request('account/read', { refreshToken: false });
      if (!auth.account || auth.account.type !== 'chatgpt') {
        this.abort(new Error('Sign in to Codex with ChatGPT using codex login, then reconnect.'));
        return;
      }
      // Read effective configuration without exposing it. Overrides apply only to this thread;
      // unrelated MCP servers/plugins and global settings are never changed.
      const { config: inherited } = await this.request('config/read', {
        includeLayers: false,
        cwd: this.options.cwd,
      });
      const config: Record<string, unknown> = {
        'features.shell_tool': false,
        'features.unified_exec': false,
        'features.apps': false,
        web_search: 'disabled',
      };
      config.mcp_servers = Object.fromEntries(
        Object.entries(inherited.mcp_servers ?? {}).map(([name, value]) => [
          name,
          { ...withoutNulls(value), enabled: false },
        ]),
      );
      (config.mcp_servers as Record<string, unknown>)[this.options.serverName] = {
        ...this.options.server,
        enabled: true,
        required: true,
        startup_timeout_sec: 60,
        tool_timeout_sec: 120,
      };
      config.plugins = Object.fromEntries(
        Object.entries(inherited.plugins ?? {}).map(([name, value]) => [
          name,
          { ...withoutNulls(value), enabled: false },
        ]),
      );
      const params = {
        cwd: this.options.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        config,
        developerInstructions: `You are the Dungeon Master. Use campaign MCP tools only from ${this.options.serverName}. Native image generation and native delegation of bounded rules-referee checks are allowed. Referees inherit the primary model and use the same campaign tools. All state changes use campaign tools; never edit files, run shell, invoke raw journal tools, or call model APIs. Only publish_table_message is visible to players. Keep private narration and tool output out of public messages. If independent rules review is unavailable use the documented delegation_unavailable fallback.`,
      };
      const resumed = this.options.conversationId;
      const response = await this.request(
        resumed ? 'thread/resume' : 'thread/start',
        resumed ? { ...params, threadId: resumed } : params,
      );
      const id = response.thread?.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
        throw new Error('Invalid Codex thread');
      this.threadId = id;
      await this.options.onConversation?.(id);
    }
    this.turnId = undefined;
    const response = await this.request('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: prompt }],
    });
    if (this.pending && !this.turnId) this.turnId = response.turn?.id;
  }
  private start() {
    const child = spawn(
      this.options.executable,
      [
        ...(this.options.prefixArgs ?? []),
        'app-server',
        '--listen',
        'stdio://',
        '-c',
        'features.apps=false',
      ],
      {
        cwd: this.options.cwd,
        env: this.options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      },
    );
    this.child = child;
    child.stderr.on('data', () => {}); // Raw model/tool/auth output never enters the renderer.
    child.stdin.on('error', () =>
      this.abort(new Error('Codex input closed. Reconnect and check saved state.')),
    );
    child.on('error', () =>
      this.abort(new Error('Could not start Codex. Check the executable and sign-in.')),
    );
    child.on('close', () => {
      this.abort(
        new Error('Codex disconnected. Saved changes remain intact; no action was retried.'),
      );
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {}
      }
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 32 * 1024 * 1024)
        return this.abort(new Error('Codex returned an oversized event'));
      let index;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.abort(new Error('Codex returned an invalid protocol event'));
          return;
        }
      }
    });
  }
  private send(message: unknown) {
    if (this.closed) throw new Error('Codex stopped');
    this.child!.stdin.write(JSON.stringify(message) + '\n');
  }
  private request(method: string, params: unknown): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Codex stopped'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.requests.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }
  private receive(message: any) {
    if (!message || typeof message !== 'object' || Array.isArray(message))
      throw new Error('Invalid message');
    if (message.id !== undefined && !message.method) {
      const request = this.requests.get(message.id);
      if (request) {
        this.requests.delete(message.id);
        message.error
          ? request.reject(new Error('Codex request failed'))
          : request.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined) {
      // No implicit approval of shell, file, auth or interactive requests on a shared table.
      this.send({
        id: message.id,
        error: {
          code: -32601,
          message:
            'Interactive requests are unavailable. Ask the players through publish_table_message.',
        },
      });
      this.abort(
        new Error(
          'Codex requested an unsupported interactive approval. Saved changes remain intact; reconnect and review the table.',
        ),
      );
      return;
    }
    const p = message.params;
    if (!this.pending || !p || p.threadId !== this.threadId) return;
    if (message.method === 'turn/started' && !this.turnId) this.turnId = p.turn?.id;
    if (!this.turnId || (p.turnId ?? p.turn?.id) !== this.turnId) return;
    if (message.method === 'item/completed') {
      const item = p.item;
      if (
        item?.type === 'mcpToolCall' &&
        item.server === this.options.serverName &&
        item.status === 'completed' &&
        !item.error &&
        !item.result?.isError
      ) {
        this.pending.tools.add(item.tool);
        if (item.tool === 'campaign_status') {
          const outputs = [
            item.result?.structuredContent,
            ...(item.result?.content ?? [])
              .filter((c: any) => c.type === 'text')
              .map((c: any) => {
                try {
                  return JSON.parse(c.text);
                } catch {
                  return null;
                }
              }),
          ];
          for (const output of outputs)
            if (
              output?.campaign?.schemaVersion === 1 &&
              typeof output.campaign.id === 'string' &&
              Number.isInteger(output.revision) &&
              output.journal
            )
              this.pending.campaignIds.add(output.campaign.id);
        }
        this.options.progress?.(
          item.tool === 'publish_table_message'
            ? 'Saving the DM response…'
            : 'The DM is resolving your action…',
        );
      }
      if (
        item?.type === 'imageGeneration' &&
        item.status === 'completed' &&
        !item.failure &&
        typeof item.savedPath === 'string' &&
        isAbsolute(item.savedPath)
      )
        this.imageWrites = this.imageWrites
          .then(async () => {
            if (!this.closed) await this.options.onImage?.(item.savedPath);
          })
          .catch(() =>
            this.abort(
              new Error('Could not record generated artwork. Saved gameplay remains intact.'),
            ),
          );
    }
    if (message.method === 'turn/completed') {
      if (p.turn.status !== 'completed')
        return this.abort(
          new Error(
            'Codex did not complete the turn. Check sign-in and usage limits; saved changes remain intact.',
          ),
        );
      const pending = this.pending;
      void this.imageWrites.then(() => {
        if (this.pending !== pending || this.closed) return;
        this.pending = undefined;
        clearTimeout(pending.timer);
        pending.resolve({
          conversationId: this.threadId,
          tools: [...pending.tools],
          campaignIds: [...pending.campaignIds],
        });
      });
    }
  }
  private abort(error: Error) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    for (const request of this.requests.values()) request.reject(error);
    this.requests.clear();
    void this.close();
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Codex session stopped. Check saved state before continuing.'));
      this.pending = undefined;
    }
    for (const request of this.requests.values()) request.reject(new Error('Codex stopped'));
    this.requests.clear();
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    this.closing = new Promise((resolve) => {
      const signal = (name: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name);
          else child.kill(name);
        } catch {}
      };
      const timer = setTimeout(() => signal('SIGKILL'), 3000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      signal('SIGTERM');
    });
    return this.closing;
  }
}
