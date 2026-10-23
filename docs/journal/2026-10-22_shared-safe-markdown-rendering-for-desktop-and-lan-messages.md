# Shared safe Markdown rendering for desktop and LAN messages

## Context and decisions

The user authorized committing the guided creation/spinner work and then requested simple Markdown rendering in the message panel. Committed the prior work and its verification notes as 439fe1f on codex/electron-campaign-setup. No push was requested or performed.

Reused the existing locked markdown-it 15.0.3 dependency rather than adding another parser or implementing Markdown manually. The official self-contained browser ES module is copied locally at build time with its MIT license. Used the CommonMark preset with html=false and breaks=true, with image, link and autolink rules disabled. Raw HTML stays escaped text, and messages cannot generate media or navigation elements. No external CDN or runtime fetch is needed.

## Completed changes

- desktop/markdown.ts creates message DOM using the configured parser. desktop/vendor/markdown-it.d.ts supplies types from the installed package for the locally copied browser module.
- desktop/app.ts and desktop/lan.ts use the same renderer for DM and player/group transcript message bodies. Speaker labels remain plain DOM text. Existing saved text is formatted on display without event/data migration.
- desktop/markdown.css styles paragraphs, headings, emphasis, bullet/ordered lists, code/fences and quotes, with wrapping and horizontal code overflow. Both desktop and LAN styles import it.
- scripts/build-desktop.mjs copies the shared CSS and official browser bundle/license. tsconfig.ui.json includes the new source/types. src/desktop/lan.ts extends its fixed static asset allowlist for the shared renderer/CSS and browser module; arbitrary files remain inaccessible.
- Expanded real desktop and LAN UI fixtures for requested Markdown plus hostile raw script/image/HTML, Markdown images and unsafe links. A lower-cost subagent added the test cases and reviewed parser configuration/build wiring; the primary agent integrated and reviewed the implementation and fixed the repeated-LAN-message selector scope in the test.
- Updated docs/desktop.md, docs/architecture.md and docs/verification.md to describe supported formatting and resource/navigation restrictions.

## Verification actually completed

- TMPDIR=/private/tmp npm run test:desktop passed, including semantic headings, strong/emphasis, bullet and ordered lists, inline/fenced code, no script/image/anchor message elements, and no executed script sentinel. Inspected the desktop screenshot.
- TMPDIR=/private/tmp DM_CHROME=<installed macOS Chrome executable> npm run test:lan passed phone/desktop scenarios and the same formatting/inert-content assertions. Inspected the phone table screenshot.
- TMPDIR=/private/tmp npm test: 112/112 passed.
- npm run typecheck passed.
- npm run format:check and git diff --check passed.
- npm run package:plugin passed, including the local browser module/license and shared renderer assets.

## Limitations and next steps

This is formatting only. Raw HTML, clickable links and embedded images are intentionally unavailable in messages; campaign map rendering stays separate. No provider/model calls or campaign mutations were needed. Current running app sessions load the new renderer on restart. Markdown changes and this note remain uncommitted for review; preceding campaign creation and spinner work is committed as 439fe1f.
