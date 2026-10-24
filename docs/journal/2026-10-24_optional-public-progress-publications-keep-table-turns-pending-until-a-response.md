# Optional public progress publications keep table turns pending until a response

## Context

The desktop table needs to show deliberate public scene narration while the DM is still resolving a request. Such a message must remain distinct from the response that completes the turn, and older saved events must continue to replay as completed responses.

## Decisions and rationale

- Add optional `delivery` values `progress` and `response` to publication operations; omitted delivery means a response.
- Persist delivery on projected table messages. Legacy messages without a marker count as responses.
- Reject progress publications that also carry `responseRequest`, and require at least one response before completing a turn.
- Export `hasPublishedResponse(turn)` from `src/table.ts` for host lifecycle checks.
- Keep progress text as deliberate public narration; tool descriptions explicitly exclude raw thoughts, tool logs and private referee details.

## Completed changes

- Updated `src/schema.ts`, `src/service.ts`, and `src/table.ts` with the optional delivery marker, reducer rules and helper.
- Added `test/progress-publication.test.mjs` for progress-only completion rejection, progress followed by final response, prompt rejection, response request activation and legacy compatibility.
- Reviewed speech eligibility: `src/desktop/speech-text.ts` currently includes all public publish events, so intentional progress narration will autoplay when speech is enabled. Whether progress should be silent is a product choice.

## Verification actually run

- `npm run typecheck`: passed.
- `npm test`: 182 passed, 1 failed. The new tests passed. The unrelated failure was `test/codex.test.mjs` “Codex artwork import accepts only observed raster paths for the current owner”, which raised `Symlinks are not permitted in campaign data` from `src/desktop/art.ts`.

## Known limitations and next steps

- The desktop speech filter has not been changed; progress is eligible for playback.
- The parent host implementation should use `hasPublishedResponse(turn)` for completion and timeout checks.
