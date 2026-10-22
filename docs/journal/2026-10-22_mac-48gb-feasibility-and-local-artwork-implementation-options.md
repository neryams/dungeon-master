# Mac 48GB feasibility and local artwork implementation options

## Context

The user asked what would enable local artwork generation and improve DM success, and whether a Mac with 48 GB unified memory would help. This is an investigation and proposed next increment, not implemented functionality. The user confirmed the chip is M3 Max during this investigation. Existing uncommitted Ollama adapter work and its prior trial results remain unchanged.

## Findings and recommendations

A 48 GB Apple Silicon Mac is a promising larger-model target, subject to actual GPU-accessible memory, context allocation and throughput measurements. Official Ollama qwen3.5:27b currently lists approximately 17 GB llama.cpp Q4_K_M and 20 GB MLX artifacts; qwen3.5:35b lists approximately 22 GB. Both advertise vision/tools. These are weight download sizes, not total runtime requirements. Start with a quantized 27B model at 64k and compare the same synthetic fixture with 9B; optionally benchmark 35B MoE for latency/accuracy. Do not assume a larger model is proven better for this particular DM or that 48 GB is wholly available to the GPU. Leave room for macOS, context, vision and embeddings. The confirmed M3 Max is a promising target; actual tokens per second and image latency still need measurement. Serial DM and image jobs are the conservative first design.

Ollama currently documents experimental macOS image generation through its CLI, with output files in the working directory. FLUX.2 Klein 4B is listed at about 5.7 GB and Z-Image Turbo FP8 at 13 GB. A first prototype can use an app-owned external CLI worker with a fixed scratch/output directory, bounded prompt/settings, timeout/cancellation and an output manifest, preserving the no-direct-model-API application boundary. This must be a separate artwork backend from the multimodal DM model; vision capability alone does not produce images.

The existing source already has geometry reference rendering, content-addressed raster import, typed register_map_art, deterministic markers/fog and schematic fallback. Proposed integration should reuse those, extend ownership checks for the image worker, keep generation retries separate from game mutations and expose one bounded artwork tool to the agent. It must not expose arbitrary shell/workflows or arbitrary filesystem paths. Validate generation failure, stale map revisions, secret filtering, cancellation and identical retry behavior.

For maps, reference conditioning is the substantive additional work. Ollama's FLUX model page advertises model-level editing capability, while the image-generation announcement describes image editing as future work; do not assume the installed CLI accepts reference editing without testing it. A pinned local ComfyUI workflow with compatible ControlNet/reference conditioning is a stronger candidate for layout control. ComfyUI supports Apple Silicon desktop installations and local queue/progress/history/output interfaces. An external worker or verified local CLI/MCP path should own that execution. The current `comfy generate` documentation describes partner/cloud endpoints and is not the local offline path to use. No backend was installed or invoked in this investigation.

## Reliability priorities

Previous failures included incorrect/missing mutation fields at both 32k and 64k. More memory alone does not fix tool use. Prioritize narrower phase-specific tool interfaces that translate into the same CampaignService and typed reducers, concise relevant prompts, actionable bounded error repair, preservation of operation IDs and post-mutation reads before outcome narration. Preserve journal guards and current-state/event authority. Compaction should retain a bounded durable pending-task record and reload relevant memory; do not treat summary quality as persistence. Evaluate repeated runs, long sessions and automatic compaction using actual success/failure counts; the previous single passing tuned 9B trial is not a reliability estimate. Hardware suggestions should eventually distinguish estimated fit from empirically tested model/configuration quality.

## Verification and next steps

Searched the project journal, inspected README.md, docs/architecture.md, src/desktop/art.ts and the map-art workflow, and checked current official sources below. No behavior changes, installations, model downloads, Mac benchmarks or new tests were performed. A Mac-native Electron smoke test is still necessary; the current implementation was verified on Linux. The local provider currently accepts loopback endpoints only, so running the app on the Mac is the simplest initial trial. A split Mac-DM/PC-image deployment is future work requiring an explicit connection design.

Suggested order: benchmark Qwen 27B at 64k with the existing smoke and repeat/compaction evaluations; reduce tool/schema complexity; prototype one local artwork worker; validate geometry conditioning and resource scheduling before enabling automatic artwork during play.

## Primary sources

- https://ollama.com/library/qwen3.5:27b
- https://ollama.com/library/qwen3.5:35b
- https://ollama.com/blog/image-generation
- https://ollama.com/x/flux2-klein
- https://ollama.com/x/z-image-turbo
- https://docs.comfy.org/installation/desktop/macos
- https://docs.comfy.org/development/comfyui-server/comms_routes
- https://docs.comfy.org/tutorials/controlnet/controlnet
- https://docs.comfy.org/comfy-cli/reference
