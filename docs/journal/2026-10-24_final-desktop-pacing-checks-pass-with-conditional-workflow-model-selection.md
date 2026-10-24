# Final desktop pacing checks pass with conditional workflow model selection

## Final implementation decision
This supersedes intermediate notes requiring a host-only readOnlyWorkflowAvailable flag. Installed workflow metadata selects the preferred flash tier in src/desktop/referee-model.ts; the actual DM must verify run_workflow is in its active tools, register the bounded referee with read-only instructions and tool restrictions where supported, then use the documented agent(type_name=..., workspace="inherit", model="flash") interface. It falls back honestly when that workflow or tier is unavailable. The desktop does not have native tool-call enforcement and cannot certify that the model obeyed this instruction. Native smoke tests advertised the workflow but did not execute it, so actual faster-model execution and latency improvement remain unverified. Do not apply workflow arguments to invoke_subagent.

## Verification completed
Final TMPDIR=/private/tmp npm test: 197 passed, zero failures. npm run typecheck passed. TMPDIR=/private/tmp npm run test:journal passed against its isolated temporary daemon. Timing/privacy and host publication regression tests pass. git diff --check passes. Test cleanup now explicitly closes its owned host before removing the synthetic workspace, avoiding an observed teardown race. No user's daemon or campaign process was stopped.

## State and next steps
Changes are built and uncommitted; the earlier logging commit remains 66883f8. Restart the development desktop and reconnect to load provider lifecycle changes. Inspect an actual subsequent turn for workflow execution and timings before claiming a speed gain. Optional progress messages are public, durable, labelled and speech-eligible, with no private reasoning exposed.