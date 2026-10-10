# Verification — 2026-10-10

Tests ran on Linux with Node.js 24.19.0, Next.js 16.4.0, React 19.3.0, Python 3.12.14, FFmpeg/ffprobe 6.1.1, faster-whisper 1.2.1, PyAV 16.1.0, CTranslate2 4.8.2, and ONNX Runtime 1.31.0. Recognition used the multilingual Whisper **base** model on **CPU / int8**, with cached public model weights.

## Executed

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, no lint errors or warnings |
| `npm run typecheck` | Passed |
| `npm test` | **60 passed, 0 failed, 0 skipped** |
| `npm run test:worker` | **8 passed** |
| `npm run build` | Passed; page and all cashier/call/video API routes built |
| `npm run test:api` | Passed, all nine HTTP/SSE checks |
| `npm run test:video` | Passed, all eight real ASR / media / persistence checks |
| `npm run transcriber:check` | Ready; Python, faster-whisper, FFmpeg, and ffprobe detected |
| `git diff --check` | Passed |

The retained baseline setup checks also passed the combined launcher/shutdown (both processes started and the worker lock was released), Python compilation, and `pip check`. Those setup checks were not repeated for the cashier feature. Dependencies were installed with `npm install`; `package-lock.json` records the baseline install. Python dependencies were installed in `.venv`. Installing unbounded PyAV initially selected version 19 and exposed a real audio-decode failure: `metadata_errors` was removed. Pinning **PyAV 16.1.0** resolved it; the real-speech integration test passed again on this feature. No canned transcript or paid transcription API was used.

## Real AI cashier verification

The numbered **1–9 acceptance scenarios and four additional checks returned PASS** through an actual production Next.js HTTP server, **Ollama 0.40.2**, and **`qwen3.5:4b-q4_K_M`** on CPU. Every conversation assertion required an actual inference event with generated tokens; assertions inspected saved cart lines, validated tool arguments and actors, orders, and HTTP responses. These were not scripted intent matches or a mocked model. Model weights were downloaded from the official Ollama registry and checked against the manifest SHA-256 digests. Earlier model candidates exposed real failures and are not the verified default.

| Acceptance case | Observed result |
| --- | --- |
| 1 — Basic order | `One cheeseburger and a Coke.` saved one cheeseburger and one medium Cola, without unsolicited modifiers. Subtotal **894**, tax **74**, total **968** USD cents. `That's all.` prepared a quote; `Yes.` led to a real model `confirm_order` call and persisted **RB-1001**, unpaid, in Kitchen. |
| 2 — Combo customization | One Classic Burger Meal, **large**, **Sprite**, **no pickles**. Subtotal **1295**, tax **107**, total **1402** USD cents. |
| 3 — Multiple changes | Two separately identified Classic Burgers and fries became **one Classic Burger, fries, and one large Sprite** after the natural correction. The removed unit actually disappeared from storage. |
| 4 — Sold-out product | Strawberry Milkshake was reported unavailable; the cart stayed empty with no silent substitute. |
| 5 — Ambiguous reference | An empty-cart request about “the second one” asked for clarification. After two cheeseburgers were added, the same request changed only the second persisted line to **no sauce**, preserving its ID and the first line. |
| 6 — Refused confirmation | Refusing the displayed combo quote created no order; only the previously confirmed basic order existed. |
| 7 — Duplicate submission | Concurrent confirmation requests with the same request ID, followed by another confirmation ID, still produced exactly **one** order. |
| 8 — Kitchen updates | RB-1001 moved **New → Preparing → Ready → Completed**. The customer status tool returned Completed, and the saved status survived an HTTP server restart. |
| 9 — Unfamiliar phrasing | “Could you fix me up with a pair of cheese burgers, leave the pickles off just the latter one, and a big cup of Sprite?” produced two cheeseburger unit lines, **no pickles only on the latter**, and large Sprite, total **1666** USD cents. Actual inference and permitted tool calls were required. |
| 10 — Browser voice | **Not executed.** No supported browser-control capability or microphone was available; see the exact Sites requirement below. |

The four additional real HTTP checks passed:

- Saving the job as **Deniz / Turkish** changed new sessions; the earlier session retained **Alex**. Actual inference on `Bir cheeseburger ve büyük Sprite istiyorum.` added the correct products and size.
- Making Sprite unavailable after a displayed quote invalidated that quote; confirmation saved no stale or sold-out order. The menu was restored afterward.
- An unsupported refund request created a real local staff-help record, without a payment operation or external notification.
- A foreign Origin mutation and a request with an incorrect session capability returned **403**.

The integration command used a separate temporary Ollama service and isolated call, restaurant, and speech stores:

```sh
npm run build
npm run test:cashier
# Optional backend audio fixture; FFmpeg must include libflite:
npm run test:cashier -- --synthetic-voice
```

Install/start the documented Ollama model first. `RELAY_TEST_OLLAMA_BIN` and `RELAY_TEST_OLLAMA_MODELS` can select an isolated local service/cache; `RELAY_TEST_PRESERVE_DATA=1` retains the script's report and isolated state. An actual supported-format spoken menu-order file can be supplied through `RELAY_TEST_SPEECH_FILE` instead of synthesis. No model, audio, session capability, or runtime state is committed.

The last synthetic audio attempt decoded a real live WebM without duration metadata and Whisper returned **“Want cheese burger please?”** from the generated speech “One cheeseburger please”. That recognition is imperfect and was not replaced with a canned transcript. The environment was renewed before the final audio → Ollama → saved-cart result could be recovered; the temporary result directory and running process were unavailable afterward. **This attempt is not counted as a complete voice pass**, and neither its final cart nor its audio-cleanup assertions are claimed as verified. The script retains those assertions for reproduction. Browser microphone capture, MediaRecorder behavior, spoken replies, and visual QA still require local browser testing.

The **60 unit tests comprise 26 cashier tests and 34 retained call/video tests**. Cashier tests cover integer pricing/tax, option defaults and required choices, explicit per-unit modifier scope, atomic rejection, permissions and actor boundaries, live menu invalidation, quote expiry and explicit approval, ordinary voice text not granting approval, approval surviving an unchanged total read, exact order verification, idempotency, restart recovery, immutable confirmed totals, kitchen versions, and audio header validation. Provider test doubles exercise controlled failure/loop paths only; they are not evidence of real inference. AI Engine records server menu reads as **backend**, direct cart controls as **customer**, and actual model tool requests as **model**; private thinking is discarded.

## Local Origin regression

The reported upload failure was reproduced through an actual Next.js dev server: POST requests sent to `127.0.0.1` with that same browser Origin returned **403 / ORIGIN_REJECTED**. Next.js normalizes loopback URLs to `localhost`, so the old comparison with `request.url` disagreed with the actual browser address. Calls, uploads, retries, and deletions now share a check against the incoming Host and request protocol.

Six added unit tests cover normalized loopback URLs, IPv6 authorities, exact host/port/protocol boundaries, invalid or opaque Origins, malformed Host headers, forwarded-host spoofing, direct Requests, and the shared call JSON guard. The HTTP/SSE test now sends browser Origin headers on every call mutation, accepts matching `localhost` requests, and rejects cross-site or mismatched loopback Origins. Video integration likewise sends Origin on uploads, retry, and deletion, with a separate real upload through `localhost`; cross-site and mismatched-alias upload/retry/delete requests must return 403 without changing jobs. Lint, type checking, and production build passed after the guard change.

## Real speech recognition

The test used the upstream faster-whisper `tests/data/jfk.flac` public speech fixture. FFmpeg created an actual MP4 with a video stream and **three seconds of leading silence** before the spoken audio, plus MOV and WebM/Opus variants. Media, job JSON, transcripts, and derived audio were stored in an isolated temporary directory and removed afterward.

The latest MP4 run:

- Detected **English** automatically.
- Recognized the expected speech, including “ask not what your country” and “what you can do for your country”.
- Returned one actual recognizer segment with its first start at **2.93 seconds** (0.07 seconds before the known speech boundary).
- Completed in **3.19 seconds** in this environment; this is one short-fixture result, not a general performance promise.
- Validated monotonic start/end timestamps inside actual normalized playback duration.
- Recorded completion events for Upload, Validation, Extraction, Recognition, Timestamp checking, and Ready.
- Removed extracted WAV audio after completion.

MOV and WebM were also genuinely recognized using their own uploaded source audio. The MOV test killed the worker during recognition, restarted it, verified its recovery event, and completed the same durable recording. A separate active-recognition deletion test confirmed the worker released and removed the recording directory, including its temporary audio.

The HTTP test additionally verified:

- Upload while the worker is offline remains queued, with no transcript text.
- Queued and completed jobs survive HTTP server restart, including exact stored segments.
- Media byte ranges return HTTP 206 and the requested bytes; out-of-bounds seeks return 416.
- TXT, SRT, and VTT download actual recognized content; subtitle time syntax is valid.
- No-audio video, silent speech, damaged container, fake file signature, and cross-origin changes return safe errors without fabricated text.
- Retry reprocesses the actual uploaded source; delete removes original video, normalized playback, and transcript.

## Call regression and focused checks

The original call orchestrator, tools, store, SSE hook, and call console remain unchanged. HTTP checks passed for verified booking, duplicate confirmation, accepted and declined conflicts, human handoff, invalid input, paused intake, reset, and matching HTTP/SSE state. Unit tests additionally cover explicit confirmation, missing details, unsupported services, slot races, changed dates, concurrent duplicate submissions, idempotency argument mismatches, cancellation, and recovery in a fresh process.

Video tests cover millisecond handling, subtitle exports and Unicode, active-segment boundaries and silent gaps, search matches, MIME/signature agreement, file size, multipart interruptions and cleanup, multiple files, cross-origin changes, path stripping, byte ranges, persisted queue state, failed-job retry, and deletion claims. Python tests reject missing audio, invalid/long duration, oversized dimensions, overlapping/out-of-range recognition timestamps, and empty speech.

## Not executed

- **Cashier browser microphone and TTS:** acceptance case 10 was not run in a browser. The synthetic backend attempt described above does not establish a complete voice pass. Use **Speak**, grant microphone access, say a menu order, stop recording, verify the recognized text and saved cart, then use the explicit confirmation button; enable **Read replies aloud** to check real browser speech-synthesis events.
- **Browser clicks or visual QA:** actual `video.currentTime` events, timestamp-button seeking, scrolling, clipboard, fullscreen, captions, search navigation, and desktop/mobile layouts have not been exercised in a browser. Handlers are implemented, compile, and use tested timestamp/search helpers; HTTP range delivery and exports were tested separately. These checks still need a local browser review.
- **Windows:** the Windows launcher paths, worker lock handling, process-tree shutdown, and PowerShell setup instructions are implemented; execution was tested on Linux only.
- **Real Turkish speech:** Turkish selection and Unicode/search/export handling are tested, but the real speech fixture was English. Turkish recognition accuracy has not been measured.
- **GPU:** CUDA execution was not tested.
- **Long/noisy/multi-speaker recordings:** the 30-minute limit is enforced and its validator tested; performance and recognition accuracy at that limit were not benchmarked.

Browser QA was unavailable under the applied [Sites skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md), which requires: “If `$control-browser` is unavailable, skip browser QA: do not start a preview server, install a browser, or improvise another browser-control path.” The supported capability was not present. Temporary HTTP integration servers were used for backend verification only.

The call's telephony, speech, LLM, and advisor notification remain simulated or absent and are labeled accordingly. Video transcription uses real local ASR.
