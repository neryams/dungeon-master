import { spawn, execFile, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, delimiter, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { LocalSettings } from './contracts.js';
import type { AgentDriver, AgentResult } from './antigravity.js';

const execute = promisify(execFile);
const REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);
// Restore only the active request, never repeat the large skill/history preamble.
function continuationFor(prompt: string | undefined): string {
  if (!prompt) return '';
  const marker = '\n\nCurrent player submission: ';
  const index = prompt.lastIndexOf(marker);
  return index >= 0 ? prompt.slice(index + 2) : prompt.slice(-12000);
}

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
    'Codex CLI with app-server was not found. Install Codex and choose its executable. ChatGPT mode also requires codex login.',
  );
}

export interface CodexOptions {
  executable: string;
  cwd: string;
  serverName: string;
  server: { command: string; args: string[]; env: Record<string, string> };
  conversationId?: string;
  model?: string;
  local?: LocalSettings;
  modelCatalog?: string;
  localThinking?: boolean;
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
  private continuationWrites = Promise.resolve();
  private requests = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private pending?: {
    resolve: (value: AgentResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    continuation: string;
    compacting: boolean;
    compacted: boolean;
    toolFailures: number;
    tools: Set<string>;
    campaignIds: Set<string>;
  };
  constructor(private options: CodexOptions) {}

  run(prompt: string): Promise<AgentResult> {
    return this.begin(prompt);
  }
  /** Used for explicit context maintenance; automatic compaction uses the same native engine. */
  compact(): Promise<AgentResult> {
    if (!this.threadId) return Promise.reject(new Error('Connect before compacting context.'));
    return this.begin();
  }
  private begin(prompt?: string): Promise<AgentResult> {
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
      this.pending = {
        resolve,
        reject,
        timer,
        continuation: continuationFor(prompt),
        compacting: prompt === undefined,
        compacted: false,
        toolFailures: 0,
        tools: new Set(),
        campaignIds: new Set(),
      };
    });
    void this.dispatch(prompt).catch(() =>
      this.abort(
        new Error(
          this.options.local
            ? 'Local DM could not start or resume. Check Ollama, model, and context settings; use Reset DM context if needed.'
            : 'Codex could not start or resume the turn. Check CLI sign-in and limits; use Reset DM context if the saved conversation is unavailable.',
        ),
      ),
    );
    return result;
  }
  private async dispatch(prompt?: string) {
    if (!this.child) {
      this.start();
      await this.request('initialize', {
        clientInfo: { name: 'dungeon_master', title: 'Dungeon Master', version: '0.6.0' },
      });
      this.send({ method: 'initialized' });
      if (this.options.local && this.options.modelCatalog) {
        const catalog = await this.request('model/list', { includeHidden: true });
        const selected = catalog.data?.find((m: any) => m.model === this.options.local!.model);
        if (!selected?.inputModalities?.includes('image'))
          throw new Error('Local model catalog did not enable images');
      }
      const auth = this.options.local
        ? undefined
        : await this.request('account/read', { refreshToken: false });
      if (!this.options.local && (!auth?.account || auth.account.type !== 'chatgpt')) {
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
      const local = this.options.local;
      const selectedModel = local?.model ?? this.options.model;
      let selectedReasoningEffort: string | undefined;
      if (!local && this.options.model) {
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        let selectedModelAvailable = false;
        for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
          const page = await this.request('model/list', {
            limit: 100,
            includeHidden: true,
            ...(cursor ? { cursor } : {}),
          });
          if (!Array.isArray(page?.data) || page.data.length > 100)
            throw new Error('Codex returned an invalid model catalog.');
          const selected = page.data.find((entry: any) => entry?.model === this.options.model);
          if (selected) {
            selectedModelAvailable = true;
            if (REASONING_EFFORTS.has(selected.defaultReasoningEffort))
              selectedReasoningEffort = selected.defaultReasoningEffort;
            break;
          }
          const nextCursor = page.nextCursor;
          if (nextCursor === undefined || nextCursor === null || nextCursor === '') break;
          if (
            typeof nextCursor !== 'string' ||
            nextCursor.length > 4096 ||
            seenCursors.has(nextCursor)
          )
            throw new Error('Codex returned an invalid model catalog cursor.');
          seenCursors.add(nextCursor);
          cursor = nextCursor;
          if (pageNumber === 19) throw new Error('Codex returned too many model catalog pages.');
        }
        if (!selectedModelAvailable)
          throw new Error('The selected Codex model is not available for this account.');
      }
      if (local)
        Object.assign(config, {
          model: local.model,
          model_provider: 'dm_ollama',
          model_providers: {
            dm_ollama: {
              name: 'Local Ollama',
              base_url: new URL('/v1', local.endpoint).href,
              wire_api: 'responses',
              requires_openai_auth: false,
            },
          },
          model_context_window: local.contextTokens,
          model_auto_compact_token_limit: Math.floor(local.contextTokens * 0.7),
          model_reasoning_effort: this.options.localThinking === false ? 'none' : 'low',
          compact_prompt:
            'Summarize this private DM conversation for continuation in at most 400 words. Begin with the ACTIVE request ID and unfinished next steps. Keep references instead of copying whole state snapshots or instructions. Preserve the current table requestId, player intent, pending action IDs, exact operation IDs and saved dice/effects, unresolved choices, and record: references. Separate public facts from DM secrets. Never execute tools or invent outcomes during compaction. Events remain authoritative. On continuation call resume_campaign, search_campaign_history and read_campaign_record before acting; never repeat saved effects. Use record_scene for new continuity notes and publish_table_message for the current request. A summary is not a campaign save.',
          'features.image_generation': false,
          'features.view_image': false,
          'memories.generate_memories': false,
          'memories.use_memories': false,
        });
      else if (selectedModel) {
        config.model = selectedModel;
        if (selectedReasoningEffort) config.model_reasoning_effort = selectedReasoningEffort;
      }
      const params = {
        ...(local
          ? { model: local.model, modelProvider: 'dm_ollama' }
          : selectedModel
            ? { model: selectedModel }
            : {}),
        cwd: this.options.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        config,
        developerInstructions: `You are the Dungeon Master. Use campaign MCP tools only from ${this.options.serverName}. ${local ? 'This is a local multimodal model. In apply_campaign_changes, change.id means the EXISTING entity ID, not an operation ID. Example: changes=[{type:"damage",id:"existing-character-id",amount:2}]. The top-level operationId identifies the transaction. Use exact schema keys, not entityId for damage. Native image generation is unavailable. Existing registered map artwork is supported: render_location_map returns a PNG inline; inspect that image directly, never guess filesystem paths. Use schematic maps when no artwork is registered. Before each gameplay turn call resume_campaign (audience dm), search_campaign_history (audience dm, limit 3), and read_campaign_record for at least one returned hit or recentRecords reference if any exist. These local memory steps are mandatory even for sheet or map questions, overriding generic skill exemptions. Before publishing save a concise record_scene continuity note (aim for under 1500 characters), including decisions, promises and unresolved choices; keep secrets in separate visibility dm records. If retrieval is unavailable say so and use exact saved record references. Context compacts automatically: reload authoritative state and records afterward, preserving request and operation IDs.' : 'Native image generation is allowed.'} Native delegation of bounded rules-referee checks is allowed. Referees inherit the primary model and use the same campaign tools. All state changes use campaign tools; never edit files, run shell, invoke raw journal tools, or call model APIs. Only publish_table_message is visible to players. Keep private narration and tool output out of public messages. If independent rules review is unavailable use the documented delegation_unavailable fallback.`,
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
    if (prompt === undefined) {
      await this.request('thread/compact/start', { threadId: this.threadId });
      return;
    }
    const response = await this.request('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: prompt }],
      ...(!this.options.local && this.options.model ? { model: this.options.model } : {}),
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
        ...(this.options.local
          ? [
              '-c',
              'model_provider="dm_ollama"',
              '-c',
              'memories.generate_memories=false',
              '-c',
              'memories.use_memories=false',
              '-c',
              `model_providers.dm_ollama={name="Local Ollama",base_url=${JSON.stringify(new URL('/v1', this.options.local.endpoint).href)},wire_api="responses",requires_openai_auth=false}`,
              '-c',
              `model=${JSON.stringify(this.options.local.model)}`,
              ...(this.options.modelCatalog
                ? ['-c', `model_catalog_json=${JSON.stringify(this.options.modelCatalog)}`]
                : []),
            ]
          : []),
      ],
      {
        cwd: this.options.cwd,
        env: {
          ...(this.options.env ?? process.env),
          ...(this.options.local ? { OLLAMA_NO_CLOUD: '1' } : {}),
        },
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
    if (message.method === 'item/started' && p.item?.type === 'contextCompaction')
      this.options.progress?.('Compacting DM context; campaign history stays saved…');
    if (message.method === 'item/completed') {
      const item = p.item;
      if (
        this.options.local &&
        item?.type === 'mcpToolCall' &&
        item.server === this.options.serverName
      ) {
        const failed = item.status === 'failed' || item.error || item.result?.isError;
        this.pending.toolFailures = failed ? this.pending.toolFailures + 1 : 0;
        if (this.pending.toolFailures >= 8)
          return this.abort(
            new Error(
              'The local model failed eight consecutive campaign tool calls. Saved effects remain intact; review the table and try a different model or reset DM context. The action was not retried.',
            ),
          );
      }
      if (item?.type === 'contextCompaction') {
        this.pending.compacted = true;
        // Keep the active request visible after native mid-turn compaction. This steers the
        // same turn; it never resubmits an interrupted turn or repeats a transaction.
        if (this.options.local && !this.pending.compacting) {
          const turnId = this.turnId;
          const text = this.pending.continuation.startsWith('Connection check only.')
            ? `Continue only this read-only connection check after compaction. Do not resume gameplay or write campaign data.\n${this.pending.continuation}`
            : `Continue the ACTIVE player request below after compaction. The earlier connection check is finished: do not return READY. First reload resume_campaign and relevant saved records. Do not repeat saved damage, rolls or other effects. Save any missing continuity note and publish_table_message for this requestId.\n${this.pending.continuation}`;
          this.continuationWrites = this.continuationWrites
            .then(async () => {
              await this.request('turn/steer', {
                threadId: this.threadId,
                expectedTurnId: turnId,
                input: [{ type: 'text', text }],
              });
            })
            .catch(() =>
              this.abort(
                new Error(
                  'Could not restore the active request after compaction. Saved effects remain intact; reconnect and review the table.',
                ),
              ),
            );
        }
      }
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
        !this.options.local &&
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
      if (this.pending.compacting && !this.pending.compacted)
        return this.abort(
          new Error(
            'Context compaction did not complete. Reconnect and reload saved campaign memory.',
          ),
        );
      if (p.turn.status !== 'completed')
        return this.abort(
          new Error(
            'Codex did not complete the turn. Check sign-in and usage limits; saved changes remain intact.',
          ),
        );
      const pending = this.pending;
      void Promise.all([this.imageWrites, this.continuationWrites]).then(() => {
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
