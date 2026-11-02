# User CLI logs confirm retryable Gemini too-many-requests failures

## Context and findings

The user supplied the previously inaccessible development terminal output. Three speech failures report HTTP 429, `apiCode: too_many_requests`, and internal category `quota`. These match the temporary-rate-limit case covered by the new retry implementation. The excerpt contains no response headers or raw Google response body, so it cannot establish whether Google supplied Retry-After or RetryInfo. Separate CoreText font messages are not Gemini request failures. The speech stack shape is consistent with the earlier adapter before requestAttempt/backoff was introduced.

## Verification

Inspected `test/gemini-speech.test.mjs`: the HTTP-date retry test explicitly mocks HTTP 429 with `error.code: too_many_requests` and verifies subsequent successful WAV generation. Additional tests cover fallback backoff without hints, exhaustion, and cancellation. Reran `TMPDIR=/private/tmp node --test test/gemini-speech.test.mjs`: all 22 tests passed. No source changes or live Google requests were needed. No commit or push performed.

## Next steps

Restart the source-launched app using `npm run desktop` to load the updated adapter. Temporary limits now emit safe `[speech]` retry-count and delay diagnostics. Successful recovery should avoid the final table:call failure; exhausted retries can still surface a bounded final error.