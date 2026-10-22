# Local machine setup and verification

## Context and decisions

Cloned upstream revision `a145358` and installed the locked dependencies for local use. Node.js 24.11.1, npm 11.6.2, and Git were already available. Installed the pinned optional `journal-rag` dependency successfully, generated the ignored project development MCP configuration with `npm run journal:setup`, and linked the Dungeon Master CLI commands with `npm link`.

Downloaded the macOS default `Xenova/all-MiniLM-L6-v2` embedding model into the installed Transformers.js default cache. A standalone call through the installed journal embedding module produced a finite 384-dimensional vector and successfully searched a disposable sample record. This used private temporary lock/log directories and did not start or reconfigure a shared daemon.

No personal campaign was created, and no source behavior was changed, committed, or pushed.

## Verification actually completed

- `npm ci`: successful; audit reported zero vulnerabilities.
- Optional journal server resolution: successful.
- `npm run typecheck`: passed.
- `npm test`: all 20 tests passed with `TMPDIR` set to the canonical macOS temporary directory. The initial default invocation failed one CLI path-equality assertion because `/var` resolves to `/private/var`.
- `TMPDIR=/private/tmp npm run test:journal`: passed. The initial long macOS temporary path caused the isolated journal connection to fail; a short temporary root avoids the Unix socket path length limit.
- `npm run package:plugin`: passed; generated the ignored plugin folder and archive under `build/`.
- `dungeon-master --help`: successful through the linked CLI.
- Actual local embedding and vector search: passed using the default macOS model.

## Limitations and next steps

The current Codex conversation has not loaded the repository's project-scoped MCP connection. Plugin discovery and skill selection in the application have not been verified. To play, initialize a named campaign with `dungeon-master init <slug> --name <name> --edition 2024`, open the generated campaign folder as a trusted Codex project, install its generated Dungeon Master plugin, and start a new conversation.

Journal tools were unavailable in the setup conversation, so this entry was written directly as the Markdown fallback required by `AGENTS.md`.
