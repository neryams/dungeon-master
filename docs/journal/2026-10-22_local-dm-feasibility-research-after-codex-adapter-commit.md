# Local DM feasibility research after Codex adapter commit

## Context and completed milestone

The user authorized committing the previously verified Electron Codex adapter, then requested research into an Ollama adapter or similar CLI for a fully local DM. Committed the adapter and its existing verification notes as `d47ca3a` (`Add Codex Electron provider with campaign and LAN parity`) on `feat/codex-electron-adapter`, based on `origin/main` at `0d6e281`. Nothing was pushed. The working tree was clean immediately after that commit. This entry records subsequent research, not an implemented local provider.

The adapter milestone retains the verification documented in the preceding journal entry: 89 unit tests, typecheck, isolated journal integration, desktop and LAN UI checks, live Codex and Antigravity synthetic scenarios, and plugin packaging. Those checks were not rerun for this documentation-only investigation.

## Findings and rationale

A local DM is technically feasible using an external agent harness plus a local tool-capable model. Ollama supplies inference and tool-call responses; a harness must execute MCP tools, maintain the agent loop and conversation, and surface lifecycle events. The recommended first spike is Electron -> existing Codex app-server adapter -> local Ollama model, retaining the same owner-bound campaign MCP server and authoritative CampaignStore reducers. This preserves the repository boundary against adding direct model API calls to the campaign application.

Official Ollama documentation supports Codex OSS mode and a Responses-compatible loopback provider. OpenAI advanced configuration documents Ollama and LM Studio as OSS providers. Local installed Codex accepts `codex --oss --local-provider ollama app-server --help`; this verifies argument parsing/help only, not a working local app-server conversation.

OpenCode is an alternative harness: its V2 documentation describes local Ollama/LM Studio/vLLM discovery, MCP servers, and fresh-context subagents that can inherit the parent model. Its headless server documentation provides an integration surface. Pin and verify an actual version before implementing: V1 and V2 configuration schemas differ.

The current `src/desktop/codex.ts` explicitly requires a ChatGPT account and does not select a local backend/model. A local mode must deliberately replace that prerequisite with local-backend validation, retain the existing ChatGPT mode's checks, and carry model/provider identity through session persistence. It is not enabled by the current commit.

## Capability assessment

- Exact campaign state, dice, HP, inventory, movement, schematic maps, player-safe projections, LAN interaction, and replay/resume are already supplied by shared local application code. A local agent can use the same typed tools; correct interpretation and choice of tools still require evaluation.
- Rules lookup and journal memory can remain local with required assets and embedding models cached before offline play. Never derive authoritative current state from retrieved memory.
- Narration, adjudication and sustained tool use are plausible with suitable models, but DM quality and long-session reliability have not been measured. A schema-valid mutation alone does not establish a correct ruling.
- A referee can use a bounded separate context and the same local model, preferably sequentially on a single GPU. This is a proposed design; the current local setup has not demonstrated it. Same-model review can share errors.
- Vision is model-dependent and separate from image generation.
- Native local artwork on Linux needs separate investigation. Ollama's current image-generation page still documents experimental macOS support and Linux as forthcoming. ComfyUI has self-hosted workflow queues, progress, and output retrieval, making it a possible separate local image worker. Any integration must preserve scoped artifact imports and the application's external-harness/no-direct-model-API boundary. Schematic map rendering needs no image model.

## Resource and offline considerations

The inspected development machine has a 16 GiB-class NVIDIA GPU and about 60 GiB usable system RAM. An initial benchmark candidate is `qwen3.5:9b`, whose current Ollama page lists tools, thinking and vision, with a 6.6 GB llama.cpp Q4_K_M artifact (a separate engine artifact is 7.6 GB). This is a candidate inferred from capabilities and footprint, not a proven DM model. `gpt-oss:20b` is a text-only comparison candidate with a roughly 14 GB download; runtime/context overhead may require CPU offload on this GPU.

Ollama recommends at least 64k context for Codex, while its context-length guide assigns only 4k by default below 24 GiB VRAM. The app currently exposes 31 campaign tools plus the desktop import helper, and four injected skill texts total about 23,515 characters before schemas/history/results. Explicit context configuration, actual memory measurement, and prompt/tool relevance scoping matter. Model download size is not total runtime VRAM. Do not promise 64k entirely on GPU before measuring.

For a fully local mode, require local model tags and loopback endpoints, disable cloud features (`OLLAMA_NO_CLOUD=1`), disable web search/apps/cloud artwork, and fail visibly rather than silently falling back to a hosted model. Predownload required assets, then verify gameplay with outbound network disabled. Do not alter any existing shared journal daemon.

## Verification actually performed and limitations

Inspected current source and committed Git state; searched/read engineering journal history; checked installed Codex CLI help; inspected GPU/RAM; researched the primary documentation linked below. `ollama`, `opencode`, `goose`, and `llama-server` were not found on PATH. No runtime was installed, no model was downloaded, and no local inference or performance benchmark was run. No local adapter behavior was changed.

## Concrete next steps (proposed)

1. Add an explicit Local (Ollama) mode around the existing Codex protocol driver, with model/backend configuration, capability detection and isolated session identity.
2. Run a minimal campaign MCP tool round trip with a small tool-capable model through app-server before building additional UI.
3. Reuse the common synthetic provider/LAN scenario, including duplicate/retry behavior, cancellation/failure, process restart, and state equality; gate artwork separately.
4. Add an adjudication/secret-handling and long-session evaluation with recorded latency, tool failures, context size and GPU/CPU split. Test referee behavior explicitly.
5. Verify no outbound network dependency after setup. Evaluate a separate local artwork worker only after core gameplay passes.

## Primary sources consulted

- https://docs.ollama.com/integrations/codex
- https://learn.chatgpt.com/docs/config-file/config-advanced
- https://docs.ollama.com/capabilities/tool-calling
- https://docs.ollama.com/context-length
- https://docs.ollama.com/faq
- https://ollama.com/library/qwen3.5:9b
- https://ollama.com/library/gpt-oss:20b
- https://opencode.ai/v2/docs/models
- https://opencode.ai/v2/docs/mcp-servers
- https://opencode.ai/v2/docs/agents
- https://opencode.ai/docs/server
- https://ollama.com/blog/image-generation
- https://docs.comfy.org/development/comfyui-server/comms_routes
