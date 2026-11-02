# Disable Test voice while Gemini preview response is pending

## Context and implementation

The user requested disabling Test voice during its pending API request. `desktop/app.ts` now tracks preview request state, renders a disabled Testing… button, and guards duplicate invocations. A shared button renderer keeps speech-settings refreshes and recording status from accidentally enabling it mid-request. The request finally block clears pending state on success or failure before audio playback. Errors from invalidated previews no longer overwrite current settings status. Existing missing-key and recording disable conditions remain in place.

## Verification actually run

- `npm run typecheck`: passed.
- `TMPDIR=/private/tmp npm test -- --test-concurrency=4`: 236/236 passed.
- One-off isolated Electron UI check with a deferred mocked IPC response: button disables immediately; status updates preserve pending state; repeated programmatic click sends no duplicate request; success and failure restore Test voice; failure message remains displayed. No Google request or actual credential was used.
- Prettier on `desktop/app.ts` and `git diff --check`: passed.
- `TMPDIR=/private/tmp npm run desktop:dist`: passed.
- `TMPDIR=/private/tmp npm run desktop:smoke -- --launch`: passed. Unsigned app/DMG/ZIP refreshed in `release/`.

## Limitations and next steps

Restart the development app or install the refreshed release to use the change. Pending applies to waiting for the API response; playback can be restarted after it arrives. No commit or push was performed. Earlier uncommitted speech credential/diagnostic changes were preserved.
