# Google speech API feasibility and CLI audio boundaries investigated

## Context

User asked whether Google AI Studio speech models can replace current narration with a user API key, whether Antigravity/Codex expose them, and whether speech-to-text is available. Investigation only; no application behavior changed. Git status was clean before this note.

## Findings and recommendation

Current narration is local Phonon behind `src/desktop/speech-runtime.ts`; `DesktopHost.speech` resolves exact saved public message revisions before synthesis. Voice selection/contracts are currently Easton/Zoey. No microphone/transcription flow is implemented. Recommend optional independent speech providers, preserving local narration and keeping DM provider selection separate. Direct Google speech calls would require a scoped exception to the project's current no-model-API principle; no such implementation was made.

Google's current documentation lists `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`, supporting API-key requests, voice/style controls and streaming; unary output defaults to WAV. Dedicated STT models are `gemini-3.5-transcribe` and `gemini-3.5-transcribe-live`. Sources: https://ai.google.dev/gemini-api/docs/speech-generation and https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe . Availability/quotas for a particular user's key were not tested.

Antigravity documents `/voice`/F5 interactive dictation but explicitly disables it under `--print`, the application's adapter path. This is not evidence of a reusable headless TTS/STT endpoint. Source: https://antigravity.google/docs/cli/commands/voice/ . No supported built-in Google TTS passthrough was established.

Installed Codex reports `0.164.0-alpha.11.1`. Generated experimental app-server TypeScript bindings in an isolated `/tmp/dm-speech-protocol.*` directory show thread realtime start, appendAudio, appendSpeech, audio output and transcript notifications, marked EXPERIMENTAL. Thus a blanket claim that Codex has no audio is incorrect. These methods are not used by our adapter; account entitlement, runtime operation, standalone transcription suitability and exact narration behavior were not verified. Public app-server documentation: https://learn.chatgpt.com/docs/app-server . OpenAI's separate transcription API currently recommends `gpt-transcribe` for files and `gpt-live-transcribe` for live audio: https://developers.openai.com/api/docs/guides/transcription .

## Verification actually run

Read README.md, docs/architecture.md, prior speech journal and relevant desktop source; a lower-cost review agent checked the implementation seams. Queried official Google/OpenAI documentation. Ran git status, Codex version/help/features and local protocol generation only. No model calls, credential access, daemon changes or application tests; behavior was not modified.

## Next steps and limitations

If implementation is requested, add opt-in Google narration with host-owned credential storage, preserve exact public-message selection and cancellation, and evaluate latency/pronunciation using synthetic text. Add push-to-talk transcription into an editable action draft separately. Codex experimental audio requires a bounded capability/runtime investigation before relying on it. Pricing and account quotas remain to be checked for a chosen deployment. No commit or push.
