import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Provider } from './contracts.js';
import { parseCodexModelId } from './models.js';

/**
 * Native Antigravity workflow model tiers documented by the installed CLI.
 * These are run_workflow agent() tiers, not invoke_subagent options or IDs
 * returned by `agy models`.
 */
export const ANTIGRAVITY_REFEREE_MODEL_OPTIONS = [
  { id: 'flash', speed: 'fast', evidence: 'lighter tier for simple work' },
  { id: 'flash_lite', speed: 'fast', evidence: 'lighter tier for simple work' },
  { id: 'pro', speed: 'strong', evidence: 'documented model tier' },
] as const;

export interface SupportedRefereeModelOption {
  id: string;
  /** Explicit host documentation/catalogue evidence; never inferred from the ID. */
  speed?: 'fast' | 'balanced' | 'slow';
  cost?: 'lower' | 'standard' | 'higher';
  rulesChecking?: 'sufficient' | 'unknown';
}

export interface RefereeModelSelectionInput {
  provider: Provider;
  /** Explicit referee/adjudicator model or tier selected by the user. */
  preferredModel?: string;
  /** Exact child-model options documented by the native workflow skill. */
  supportedModelOptions?: readonly (string | SupportedRefereeModelOption)[];
  /** Local provider model already selected for the DM session, if applicable. */
  localModel?: string;
}

export interface RefereeModelSelection {
  model: string;
  explicit: boolean;
  executionPath: 'workflow' | 'native-delegation' | 'inherit' | 'local';
  instruction: string;
}

const MAX_NATIVE_GUIDE_BYTES = 64 * 1024;
const antigravityCapabilityCache = new Map<
  string,
  { mtimeMs: number; size: number; options: string[] }
>();

const FAST_ANTIGRAVITY_OPTIONS = new Set<string>(
  ANTIGRAVITY_REFEREE_MODEL_OPTIONS.filter((option) => option.speed === 'fast').map(
    (option) => option.id,
  ),
);
const ANTIGRAVITY_WORKFLOW_TIER_IDS = new Set<string>(
  ANTIGRAVITY_REFEREE_MODEL_OPTIONS.map((option) => option.id),
);

/**
 * Select only an exact child-model option supported by the host. In particular,
 * Antigravity's `agy models` catalogue IDs are not workflow child tiers and
 * must never be substituted for the documented `agent()` model values.
 */
export function selectRefereeModel(input: RefereeModelSelectionInput): RefereeModelSelection {
  if (input.provider === 'ollama') {
    const model = input.localModel?.trim();
    return {
      model: model || 'inherit',
      explicit: Boolean(model),
      executionPath: 'local',
      instruction: model
        ? `Keep the referee within the configured local provider and use the current local model ${model}. Do not switch to a hosted provider.`
        : 'Keep the referee within the configured local provider and inherit its current model. Do not switch to a hosted provider.',
    };
  }

  const options = input.supportedModelOptions ?? [];
  const supportedIds = new Set(
    options.map((option) => (typeof option === 'string' ? option : option.id)),
  );
  const preferred = input.preferredModel?.trim();

  if (input.provider === 'antigravity') {
    if (preferred === 'inherit') {
      return {
        model: 'inherit',
        explicit: true,
        executionPath: 'inherit',
        instruction:
          'Use the inherited primary model for the bounded referee (use invoke_subagent without a model field, or run_workflow with model="inherit"; give the referee its read-only instructions and restrict tools where supported). Do not infer child tiers from agy models catalogue IDs, names, or assumed pricing.',
      };
    }
    const chosenTier =
      preferred && ANTIGRAVITY_WORKFLOW_TIER_IDS.has(preferred) && supportedIds.has(preferred)
        ? preferred
        : !preferred
          ? ANTIGRAVITY_REFEREE_MODEL_OPTIONS.find(
              (option) => FAST_ANTIGRAVITY_OPTIONS.has(option.id) && supportedIds.has(option.id),
            )?.id
          : undefined;
    if (chosenTier) {
      return {
        model: chosenTier,
        explicit: true,
        executionPath: 'workflow',
        instruction: `Use the documented ${chosenTier} tier for the bounded referee when run_workflow is in your active native tools. Register the rules-referee role using the native definition schema and its read-only referee instructions; restrict tools and disable file writes where supported. Then use run_workflow agent(type_name=<registered referee>, workspace="inherit", model="${chosenTier}") with the exact packet and result schema. Consult the installed native workflow skill for invocation syntax and reuse context when supported. Do not pass any model field to invoke_subagent: that path has not demonstrated an override. If the workflow tool or tier is unavailable, use native delegation with its inherited model and record that limitation. Use a stronger supported tier only for a specific unresolved ruling.`,
      };
    }
  }

  if (input.provider === 'codex') {
    if (preferred === 'inherit') {
      return {
        model: 'inherit',
        explicit: true,
        executionPath: 'inherit',
        instruction:
          'Use the inherited primary model for the bounded referee (omit model and reasoning_effort overrides when calling spawn_agent).',
      };
    }
    if (preferred) {
      const parsed = parseCodexModelId(preferred);
      return {
        model: preferred,
        explicit: true,
        executionPath: 'native-delegation',
        instruction: parsed.reasoningEffort
          ? `Invoke the referee with the configured ${parsed.model} model and reasoning_effort="${parsed.reasoningEffort}" (when calling spawn_agent, pass fork_turns="none", model="${parsed.model}", and reasoning_effort="${parsed.reasoningEffort}" along with the complete prepared action packet inline). Escalate only for a specific unresolved or complex ruling.`
          : `Invoke the referee with the configured ${parsed.model} model (when calling spawn_agent, pass fork_turns="none" and model="${parsed.model}" along with the complete prepared action packet inline). Escalate only for a specific unresolved or complex ruling.`,
      };
    }
    const suitable = options
      .filter((option): option is SupportedRefereeModelOption => typeof option !== 'string')
      .filter(
        (option) =>
          option.speed === 'fast' &&
          option.cost === 'lower' &&
          option.rulesChecking === 'sufficient',
      )
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (suitable) {
      return {
        model: suitable.id,
        explicit: true,
        executionPath: 'native-delegation',
        instruction: `Invoke the referee with the explicitly advertised ${suitable.id} model. Host metadata identifies it as fast, lower-cost and sufficient for rules checking. Escalate only for a specific unresolved or complex ruling, using another explicitly supported option.`,
      };
    }
  }

  return {
    model: 'inherit',
    explicit: false,
    executionPath: 'inherit',
    instruction:
      input.provider === 'antigravity'
        ? 'Use invoke_subagent only with its actual supported parameters (such as Role and TypeName); do not pass a model field. Use run_workflow with model="flash" if the active tool and its installed guide confirm support; give the referee its read-only instructions and restrict tools where supported. Otherwise accept the inherited model. Do not infer child tiers from agy models catalogue IDs, names, or assumed pricing.'
        : 'Use the host default/inherited referee model because no documented faster child-model override is confirmed as supported. Do not infer a child override from provider catalogue IDs, names, or assumed pricing.',
  };
}

/** Read the installed CLI's bundled workflow guide once per file revision. */
export async function discoverAntigravityWorkflowModelOptions(
  guidePath = join(
    homedir(),
    '.gemini',
    'antigravity-cli',
    'builtin',
    'skills',
    'run-workflow',
    'SKILL.md',
  ),
): Promise<string[]> {
  try {
    const metadata = await stat(guidePath);
    if (!metadata.isFile() || metadata.size > MAX_NATIVE_GUIDE_BYTES) return [];
    const cached = antigravityCapabilityCache.get(guidePath);
    if (cached && cached.mtimeMs === metadata.mtimeMs && cached.size === metadata.size)
      return [...cached.options];
    const guide = await readFile(guidePath, 'utf8');
    // Match the installed native workflow's agent() model-tier argument,
    // not invoke_subagent parameters, changelog prose, or agy models catalogue.
    const tierMarker = /^\s*[-*]?\s*`?model`?\s*:\s*the agent's model tier:/im.exec(guide);
    const paragraphStart = tierMarker?.index;
    const afterMarker = paragraphStart === undefined ? '' : guide.slice(paragraphStart);
    const nextListItem = afterMarker.slice(1).search(/\n\s*[-*]\s+/);
    const tierParagraph =
      paragraphStart === undefined
        ? ''
        : afterMarker.slice(0, nextListItem < 0 ? 1200 : nextListItem + 1);
    const options = tierParagraph
      ? ANTIGRAVITY_REFEREE_MODEL_OPTIONS.map((option) => option.id).filter((id) =>
          tierParagraph.includes(`"${id}"`),
        )
      : [];
    antigravityCapabilityCache.set(guidePath, {
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      options,
    });
    return [...options];
  } catch {
    return [];
  }
}
