# Verification — 2026-10-10

Tests ran on Linux with Node.js 24.19.0, Next.js 16.4.0, React 19.3.0, Python 3.12.14, FFmpeg/ffprobe 6.1.1, faster-whisper 1.2.1, PyAV 16.1.0, CTranslate2 4.8.2, and ONNX Runtime 1.31.0. Recognition used the multilingual Whisper **base** model on **CPU / int8**, with cached public model weights.

## Executed

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, no lint errors or warnings |
| `npm run typecheck` | Passed |
| `npm test` | **34 passed, 0 failed, 0 skipped** |
| `npm run test:worker` | **6 passed** |
| `npm run build` | Passed; page and all call/video API routes built |
| `npm run test:api` | Passed, all nine HTTP/SSE checks |
| `npm run test:video` | Passed, all eight real ASR / media / persistence checks |
| `npm run transcriber:check` | Ready; Python, faster-whisper, FFmpeg, and ffprobe detected |
| Combined local launcher and shutdown | Passed; both processes started, worker lock released |
| Python compilation and `pip check` | Passed |
| `git diff --check` | Passed |

Dependencies were installed with `npm install`; `package-lock.json` records the install. Python dependencies were installed in `.venv`. Installing unbounded PyAV initially selected version 19 and exposed a real audio-decode failure: `metadata_errors` was removed. Pinning **PyAV 16.1.0** resolved it; the full real-speech integration test then passed. No canned transcript or paid transcription API was used.

## Local Origin regression

The reported upload failure was reproduced through an actual Next.js dev server: POST requests sent to `127.0.0.1` with that same browser Origin returned **403 / ORIGIN_REJECTED**. Next.js normalizes loopback URLs to `localhost`, so the old comparison with `request.url` disagreed with the actual browser address. Calls, uploads, retries, and deletions now share a check against the incoming Host and request protocol.

Six added unit tests cover normalized loopback URLs, IPv6 authorities, exact host/port/protocol boundaries, invalid or opaque Origins, malformed Host headers, forwarded-host spoofing, direct Requests, and the shared call JSON guard. The HTTP/SSE test now sends browser Origin headers on every call mutation, accepts matching `localhost` requests, and rejects cross-site or mismatched loopback Origins. Video integration likewise sends Origin on uploads, retry, and deletion, with a separate real upload through `localhost`; cross-site and mismatched-alias upload/retry/delete requests must return 403 without changing jobs. Lint, type checking, and production build passed after the guard change.

## Real speech recognition

The test used the upstream faster-whisper `tests/data/jfk.flac` public speech fixture. FFmpeg created an actual MP4 with a video stream and **three seconds of leading silence** before the spoken audio, plus MOV and WebM/Opus variants. Media, job JSON, transcripts, and derived audio were stored in an isolated temporary directory and removed afterward.

The latest MP4 run:

- Detected **English** automatically.
- Recognized the expected speech, including “ask not what your country” and “what you can do for your country”.
- Returned one actual recognizer segment with its first start at **2.93 seconds** (0.07 seconds before the known speech boundary).
- Completed in **2.88 seconds** in this environment; this is one short-fixture result, not a general performance promise.
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

- **Browser clicks or visual QA:** actual `video.currentTime` events, timestamp-button seeking, scrolling, clipboard, fullscreen, captions, search navigation, and desktop/mobile layouts have not been exercised in a browser. Handlers are implemented, compile, and use tested timestamp/search helpers; HTTP range delivery and exports were tested separately. These checks still need a local browser review.
- **Windows:** the Windows launcher paths, worker lock handling, process-tree shutdown, and PowerShell setup instructions are implemented; execution was tested on Linux only.
- **Real Turkish speech:** Turkish selection and Unicode/search/export handling are tested, but the real speech fixture was English. Turkish recognition accuracy has not been measured.
- **GPU:** CUDA execution was not tested.
- **Long/noisy/multi-speaker recordings:** the 30-minute limit is enforced and its validator tested; performance and recognition accuracy at that limit were not benchmarked.

Browser QA was unavailable under the applied [Sites skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md), which requires: “If `$control-browser` is unavailable, skip browser QA: do not start a preview server, install a browser, or improvise another browser-control path.” The supported capability was not present. Temporary HTTP integration servers were used for backend verification only.

The call's telephony, speech, LLM, and advisor notification remain simulated or absent and are labeled accordingly. Video transcription uses real local ASR.
