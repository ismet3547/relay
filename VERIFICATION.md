# Verification — 2026-10-10

Executed against the final source with Node.js 24.19.0 and Next.js 16.4.0:

- `npm ci` dependencies are reproducible through the included package lock; the implementation environment installed them with `npm install`.
- `npm run typecheck` — passed.
- `npm run lint` — passed, no warnings or errors.
- `npm test` — **18 passed, 0 failed, 0 skipped**.
- `npm run build` — passed, including the page and all six API route patterns.
- `npm run test:api` — passed; the development server returned HTTP 200.

The HTTP/SSE check exercised successful booking, conflict acceptance, conflict decline, human handoff, replayed confirmation, validation errors, paused intake, and reset. The SSE snapshot was compared with HTTP call and appointment state. Bookings were saved to an actual temporary data file and looked up before a successful outcome.

Regression tests additionally checked explicit confirmation, missing vehicle data, unsupported services, a slot becoming occupied after the availability check, changed appointment dates, simultaneous duplicate confirmations, tool idempotency mismatches, workflow cancellation on reset, and recovery in a fresh Node process.

**Not executed:** browser-based visual inspection, viewport screenshots, or end-to-end browser clicks. The available environment did not provide the supported browser QA capability. Responsive layouts, controls, and accessibility semantics are implemented and compile, but their visual behavior needs a local browser review.

No real speech recognition, LLM, telephony, external advisor notification, or paid API was used. All simulated stages are labeled in the product.
