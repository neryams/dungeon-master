import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { totalmem, platform, arch } from 'node:os';
import { LocalSettings, type LocalModels } from './contracts.js';

const execute = promisify(execFile);
const GiB = 1024 ** 3;
export async function systemSpecs(): Promise<LocalModels['hardware']> {
  const hardware: LocalModels['hardware'] = {
    ramGiB: Math.round(totalmem() / GiB),
    unifiedMemory: platform() === 'darwin' && arch() === 'arm64',
  };
  try {
    const { stdout } = await execute(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 5000, maxBuffer: 16000 },
    );
    // A single-model fit estimate uses the largest GPU, not a sum that assumes sharding.
    const gpus = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const split = line.lastIndexOf(',');
        return {
          name: line.slice(0, split).trim(),
          memory: Number(line.slice(split + 1).trim()) / 1024,
        };
      })
      .filter((g) => Number.isFinite(g.memory) && g.memory > 0)
      .sort((a, b) => b.memory - a.memory);
    if (gpus[0]) {
      hardware.gpu = gpus[0].name;
      hardware.vramGiB = Math.round(gpus[0].memory);
    }
  } catch {
    /* CPU, Apple unified memory, or an unrecognized GPU; never invent VRAM. */
  }
  return hardware;
}
export function suggestModels(hardware: LocalModels['hardware']): LocalModels['suggestions'] {
  const budget = hardware.vramGiB ?? (hardware.unifiedMemory ? hardware.ramGiB * 0.7 : 0);
  const suggestions = [];
  if (budget >= 32)
    suggestions.push({
      model: 'qwen3.5:27b',
      reason: 'Larger vision/tool model to benchmark on 32+ GiB accelerators; context adds memory.',
    });
  if (budget >= 12)
    suggestions.push({
      model: 'qwen3.5:9b',
      reason:
        'Suggested starting point with 12+ GiB accelerator memory; vision and tools, with more context headroom than larger models.',
    });
  if (hardware.ramGiB >= 8)
    suggestions.push({
      model: 'qwen3.5:4b',
      reason:
        budget >= 6
          ? 'Smaller vision/tool option for lower memory use; evaluate rules accuracy.'
          : 'Small trial option; CPU/offloaded inference may be slow. GPU memory was not sufficient or could not be detected.',
    });
  return suggestions;
}
// Metadata only. Do not add generate/chat/responses calls: the agent CLI owns inference.
async function metadata(
  endpoint: string,
  route: 'tags' | 'show' | 'ps',
  model?: string,
): Promise<any> {
  const response = await fetch(new URL(`/api/${route}`, endpoint), {
    method: model ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(model ? { body: JSON.stringify({ model }) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      'Ollama metadata unavailable. Start Ollama and install the selected model first.',
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty Ollama response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024) throw new Error('Ollama metadata is too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function validateLocalModel(raw: LocalSettings) {
  const settings = LocalSettings.parse(raw);
  if (/(?:^|[-/:])cloud(?:$|[-/:])/i.test(settings.model))
    throw new Error('Choose an installed local model, not a cloud model.');
  const info = await metadata(settings.endpoint, 'show', settings.model);
  if (info.remote_host || info.remote_model)
    throw new Error('Cloud-backed models are unavailable in Local mode.');
  const capabilities = Array.isArray(info.capabilities)
    ? info.capabilities.filter((c: unknown): c is string => typeof c === 'string')
    : [];
  if (!capabilities.includes('vision') || !capabilities.includes('tools'))
    throw new Error(
      'The selected model must support both vision (image input) and tools. Choose a multimodal tool-capable model.',
    );
  const contexts = Object.entries(info.model_info ?? {})
    .filter(([key, value]) => key.endsWith('.context_length') && typeof value === 'number')
    .map(([, v]) => v as number);
  const maxContext = Math.max(0, ...contexts);
  if (!maxContext || settings.contextTokens > maxContext)
    throw new Error(
      `Selected context exceeds the model's reported limit (${maxContext || 'unknown'}).`,
    );
  const match =
    typeof info.parameters === 'string'
      ? info.parameters.match(/(?:^|\n)\s*num_ctx\s+(\d+)/)
      : null;
  const configuredContext = match ? Number(match[1]) : undefined;
  if (configuredContext && configuredContext < settings.contextTokens)
    throw new Error(
      `This model configures only ${configuredContext} context tokens. Increase its num_ctx or lower the app context setting.`,
    );
  return { capabilities, maxContext, configuredContext };
}
export async function localModels(raw: LocalSettings): Promise<LocalModels> {
  const settings = LocalSettings.parse(raw);
  const hardware = await systemSpecs();
  const result: LocalModels = { hardware, models: [], suggestions: suggestModels(hardware) };
  try {
    const catalog = await metadata(settings.endpoint, 'tags');
    result.models = (Array.isArray(catalog.models) ? catalog.models : [])
      .filter((m: any) => typeof m.name === 'string' && Number.isFinite(m.size) && !m.remote_host)
      .slice(0, 500)
      .map((m: any) => ({ name: m.name, sizeGiB: Math.round((m.size / GiB) * 10) / 10 }));
    result.selected = await validateLocalModel(settings);
    result.warning =
      'Fit suggestions are estimates. Configure Ollama with at least this context (OLLAMA_CONTEXT_LENGTH or model num_ctx); the app budget does not resize the server context. Vision means image input, not artwork generation.';
  } catch (e) {
    result.warning =
      e instanceof Error ? e.message : 'Cannot inspect Ollama. Check its local endpoint.';
  }
  return result;
}

/** Validate the actual runner allocation after the read-only connection check. */
export async function verifyLocalContext(settings: LocalSettings) {
  const running = await metadata(settings.endpoint, 'ps');
  const model = (Array.isArray(running.models) ? running.models : []).find(
    (m: any) =>
      m.name === settings.model ||
      m.model === settings.model ||
      m.name === `${settings.model}:latest`,
  );
  if (
    !model ||
    !Number.isInteger(model.context_length) ||
    model.context_length < settings.contextTokens
  )
    throw new Error(
      `Ollama has not confirmed the requested ${settings.contextTokens}-token context. Set OLLAMA_CONTEXT_LENGTH on its server or model num_ctx, then reconnect. The app will not continue with a silently smaller context.`,
    );
}

/** Codex otherwise treats unrecognized model names as text-only, dropping MCP images. */
export function localModelCatalog(settings: LocalSettings, capabilities: string[]) {
  return {
    models: [
      {
        slug: settings.model,
        display_name: settings.model,
        description: 'Local multimodal DM',
        default_reasoning_level: capabilities.includes('thinking') ? 'low' : 'none',
        supported_reasoning_levels: capabilities.includes('thinking')
          ? [{ effort: 'low', description: 'Local reasoning' }]
          : [],
        shell_type: 'shell_command',
        visibility: 'list',
        supported_in_api: true,
        priority: 0,
        support_verbosity: false,
        experimental_supported_tools: [],
        base_instructions:
          'You are a Dungeon Master. Follow the campaign developer instructions. Use the provided campaign tools to read authoritative state, retrieve durable memory, save outcomes, and publish player-facing narration.',
        input_modalities: ['text', 'image'],
        context_window: settings.contextTokens,
        effective_context_window_percent: 100,
        supports_reasoning_summaries: capabilities.includes('thinking'),
        supports_parallel_tool_calls: false,
        truncation_policy: { mode: 'tokens', limit: 6000 },
        include_skills_usage_instructions: false,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
      },
    ],
  };
}
