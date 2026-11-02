# Removed Phonon from desktop packaging

## Context

The desktop speech implementation is moving from local Phonon assets to optional Gemini speech. Packaging and user documentation needed to stop bundling model assets and explain the new opt-in boundary.

## Decisions and rationale

- Keep desktop releases free of speech model weights, native speech engine, Phonon Python tooling, personal credentials, and caches.
- Keep the Gemini key outside campaign files and worker environments; document Electron main-process safeStorage encryption in the app userData directory.
- Restrict microphone dictation to the desktop's own loopback session, with review/edit before submission; LAN clients do not receive speech or microphone access.
- Add a microphone usage description to macOS app metadata.
- Add the package import pattern requested for desktop speech service modules.

## Completed changes

- Removed obsolete speech:setup script, test runner reference, Phonon packaging/setup scripts, copied sidecar, and Electron Builder speech resource.
- Removed offline Phonon synthesis from packaged smoke checks; smoke now verifies speech model resources, legacy emitted files, obsolete tools, and Gemini credential files are absent.
- Added cleanup of stale TypeScript Phonon outputs from both desktop and plugin packages. TypeScript build does not remove outputs for deleted sources.
- Added #desktop/* package imports mapping and the macOS microphone usage description.
- Updated README, desktop guide, and architecture documentation with opt-in Gemini narration/dictation, credential storage, model names, local microphone boundary, and no bundled assets.
- Updated desktop packaging tests for the removed Phonon payload and new import mapping. Kept speech-install-ui in test:desktop as requested because it is being replaced by the UI owner.

## Verification

- node --test test/desktop-package.test.mjs passed (2 tests).
- npx prettier --write completed for changed packaging and documentation files.
- npm run build did not pass while the root agent's concurrent speech UI implementation was in progress. It reported TypeScript errors in desktop/main.mts, desktop/app.ts, and tsconfig desktop/UI project configuration. The root agent was notified; package-focused test passed without requiring build output.

## Known limitations

- Full build and packaged Electron smoke validation remain pending the concurrent desktop implementation.
- This entry covers packaging/documentation; the application speech backend and UI are tracked in the root task.

## Next steps

- Once the root implementation compiles, rerun npm run build and node --test test/desktop-package.test.mjs.
- Build the desktop payload and confirm the smoke script rejects speech bundles while creating a temporary campaign successfully.
