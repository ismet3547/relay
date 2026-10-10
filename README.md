# Relay

A local workspace for **real video transcription** and an interactive operations demo for the fictional Northline Auto shop. Built with Next.js, TypeScript, Tailwind CSS, FFmpeg, and faster-whisper. No paid API or API key is required.

**Workspace** starts with two clear actions: **Run Demo Call** and **Analyze Video**. **AI Engine** explains the selected workflow, with technical details available on demand.

## Local setup

Install Node.js 20.9+ (tested with Node 24.19), Python **3.12, 64-bit**, and FFmpeg with both `ffmpeg` and `ffprobe` on PATH. Python 3.12 is the documented baseline; other Python versions have not been verified. Run commands from the repository folder.

### Windows — PowerShell

```powershell
git clone --branch feat/video-transcription-ux https://github.com/ismet3547/relay.git
cd relay
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r transcription/requirements.txt
winget install --id Gyan.FFmpeg --exact
```

Close and reopen PowerShell after installing FFmpeg so PATH is refreshed. Return to the `relay` directory, then:

```powershell
ffmpeg -version
ffprobe -version
npm run transcriber:check
npm run model:download
npm run dev:all
```

If you install FFmpeg manually, add its `bin` directory to PATH. Downloads: [FFmpeg](https://ffmpeg.org/download.html), [Python](https://www.python.org/downloads/windows/), [Node.js](https://nodejs.org/). Activating the virtual environment is optional: the launcher selects `.venv\Scripts\python.exe` directly, so PowerShell script execution policy does not block startup.

### macOS / Linux

Install FFmpeg using your system package manager, then:

```sh
git clone --branch feat/video-transcription-ux https://github.com/ismet3547/relay.git
cd relay
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r transcription/requirements.txt
ffmpeg -version
ffprobe -version
npm run transcriber:check
npm run model:download
npm run dev:all
```

Open **http://127.0.0.1:3000** or **http://localhost:3000**. The launcher runs the web application and one Python worker; keep its terminal open. Next prints an alternative port if 3000 is occupied. `npm run dev` starts only the web application; in a second terminal, `npm run transcriber` starts the worker. Uploaded jobs remain queued when the worker is offline.

If the app shows **Transcription needs setup**, run `npm run transcriber:check` in the terminal used to launch Relay. For a missing FFmpeg warning on Windows, install `Gyan.FFmpeg` with the command above, reopen PowerShell, and confirm both `ffmpeg -version` and `ffprobe -version` work before restarting Relay. If using VS Code's integrated terminal, restart VS Code as well so its child processes receive the updated PATH.

Local mutations compare the browser's Origin with the actual request Host and protocol. Next.js normalizes loopback URLs internally, so comparing Origin directly with `request.url` incorrectly rejects `127.0.0.1` uploads. Both local addresses work, while an Origin from a different host, alias, port, or protocol remains rejected. If an older checkout shows **Cross-origin uploads are not allowed**, pull the feature branch and restart the running web server.

`npm run model:download` caches the multilingual Whisper **base** model locally. This first download requires internet access; after installation and model caching, recognition uses only local files. The app can also download the model lazily on its first job, but pre-downloading makes setup failures easier to diagnose. No Hugging Face token is needed for these public model weights.

For a production-mode local run:

```sh
npm run build
npm run start:all
```

### CPU / GPU and configuration

Defaults live in **`config/transcription.json`**, shared by the upload routes and Python worker:

| Setting | Default |
| --- | --- |
| Upload size | 100 MiB per video |
| Duration | 30 minutes |
| Saved / uploading recordings | 20 |
| Source dimensions | Maximum 4096 pixels on either side |
| Formats | MP4, MOV, WebM; actual stream decoding must succeed |
| Model | Multilingual `base` |
| Inference | CPU, `int8`, four threads; one job at a time |
| Browser updates | Poll every 1.5 seconds; call events use SSE |

Restart both processes after changing configuration. The same configuration controls the browser polling interval. Normalized playback copies can be larger than the original upload; allow disk space for original videos, playback copies, and the model. Source and playback are retained until you delete the recording. Extracted WAV audio and unfinished playback copies are cleaned on success, failure, deletion, or worker recovery. Incomplete uploads abandoned by a crashed HTTP process are cleaned by the worker after one hour.

Optional environment variables, inherited by both launcher processes:

| Variable | Purpose |
| --- | --- |
| `RELAY_PYTHON` | Absolute path to your Python executable |
| `RELAY_DATA_DIR` | Absolute private data directory (default `.relay-data`) |
| `RELAY_MODEL_PATH` | An already downloaded CTranslate2 model directory |
| `RELAY_WHISPER_MODEL` | Model identifier, such as `base` or `small`; use a multilingual model for Turkish |
| `RELAY_WHISPER_DEVICE` | `cpu` by default; optionally `cuda` |
| `RELAY_WHISPER_COMPUTE_TYPE` | `int8` by default; a compute type compatible with your device |
| `DEMO_DATA_DIR` | Separate call-demo data directory (default `.demo-data`) |

CPU needs no CUDA installation. GPU support requires a compatible NVIDIA/CTranslate2 stack; follow [faster-whisper's GPU requirements](https://github.com/SYSTRAN/faster-whisper#gpu) and [CTranslate2 installation](https://opennmt.net/CTranslate2/installation.html) before setting `cuda`. GPU execution has not been tested here. Long recordings and larger models can take significant time on a CPU; processing shows actual stages rather than invented completion percentages.

`transcription/requirements.txt` pins faster-whisper 1.2.1 and **PyAV 16.1.0**. Do not upgrade PyAV independently: version 19 removed an argument used by this faster-whisper release ([upstream issue](https://github.com/SYSTRAN/faster-whisper/issues/1589)). `socksio` supports environments with a SOCKS proxy during the initial model download.

## Analyze your own video

1. Choose **Analyze Video**, then drag one MP4, MOV, or WebM onto the upload area or select **Choose video**.
2. Select **Detect automatically**, **English**, or **Turkish** before upload. Language selection applies to that uploaded job.
3. Watch real upload progress. After upload, you can navigate away: a durable local worker validates streams, prepares playback, extracts audio, recognizes speech, validates timestamps, and saves the transcript.
4. Watch with native play/pause, seeking, volume, and fullscreen controls. The speed selector and current-time display sit below the player.
5. Click a transcript line or timestamp to seek to its actual start and play. The active segment follows `video.currentTime`; silent gaps have no highlighted segment. **Follow playback** controls scrolling inside the transcript panel.
6. Search to highlight matching text. Use next/previous arrows or Enter / Shift+Enter to jump to results.
7. Copy text using the copy button or download **TXT**, **SRT**, or **VTT**. Subtitle exports retain the recognizer's actual timestamps. Native captions are available from the video's caption menu once the transcript is ready.
8. Refresh while viewing a recording: its `?recording=...` URL reopens the saved recording. You can also find all recordings in **Results & activity → Video transcripts**.
9. Use the trash button to delete the recording and transcript together. If processing is active, deletion waits for the worker to release the current operation; it can take longer during model loading or a recognition segment.

Files are streamed to disk with bounded multipart parsing. Extension, MIME, signature, size, duration, dimensions, track presence, and decoding are checked. FFmpeg is invoked without a shell and with local-file protocols only. MOV/WebM and uncommon source codecs are normalized to H.264/AAC MP4, up to 1280×720, for browser playback. Recognition uses audio extracted from that exact playback copy so player and transcript share a timeline.

A silent video returns **No speech detected**, a video without an audio track returns **No audio**, and a damaged file returns a decode error. Setup, model download, and recognition failures are visible; Relay never substitutes a canned transcript. Failed jobs can be retried using their original source.

## Run the call demo

1. Choose **Run Demo Call**, select **Successful appointment**, and start.
2. You are the customer. Use suggested replies or type `I'd like an oil change tomorrow morning.`
3. Supply a vehicle such as `My car is a 2021 Honda Civic.`, choose a returned slot, and explicitly confirm. No booking is written before confirmation.
4. The result card shows the saved appointment. **Results & activity** contains conversations, appointments, and recorded evaluations.
5. Try **Scheduling conflict**: tomorrow at 9 AM is already occupied. Accept an alternative or decline; the outcomes are different.
6. Try **Human handoff** with a warranty refund request. It creates a local queue record without contacting an actual advisor.
7. Settings lets you pause new calls or reset the call demo. Reset restores example calls and appointments and leaves your video recordings intact.

Free-text rules support oil changes, today/tomorrow or valid ISO dates within 30 days, morning/afternoon, times such as `10:00` / `10 AM`, vehicle descriptions starting with a year, and explicit confirmation/cancellation. Unsupported services go to a human. Appointment times use **UTC**.

## Use the AI Engine

Choose **Demo call** or **Video transcription**, then select the same conversation or recording shown in Workspace. Switching screens does not cancel processing. Use **Open call/video** to return to the task.

Calls show **Listen → Understand → Decide → Act → Respond**. These are recurring stages of an interactive conversation: “Observed” means a real event was recorded, not that all future turns are finished. Expand **Technical details** for the original ten-stage pipeline, agent state, tool arguments/results, and event timeline.

Videos show **Upload, Validate, Extract audio, Recognize speech, Check timestamps, Ready**. Statuses and event metadata come from the durable job file. “Check timestamps” validates timestamps returned by Whisper against playback duration; it does not claim a separate forced-alignment or diarization model. Expand **Technical details** for codec metadata, detected language/confidence, model/device, processing time, and actual timestamped events.

## What is real, what is simulated

| Feature | Behavior |
| --- | --- |
| Video speech recognition | **Real** local faster-whisper inference on uploaded audio |
| Transcript timestamps, search, media seeks, exports | Based on the stored recognition segments and playback time |
| Call booking tools and verification | **Real** availability reads, validated booking writes, booking lookup, and local handoff records |
| Call state and events | Persisted local data with shared SSE updates |
| Demo phone connection and voice | **Simulated**; customer input is typed text |
| Demo intent, decisions, and replies | Bounded deterministic rules and templates; no LLM or telephony service |
| Historical example calls | Labeled seeded examples; no fabricated execution trace |
| Speaker labels / learning / advisor notifications | Not implemented |

## Architecture and private data

- `src/server/video-upload.ts`: bounded streaming upload and signature validation.
- `src/server/video-store.ts`: atomic job reads/writes, queue state, retry and delete requests.
- `src/app/api/videos/`: job APIs, byte-range playback, and transcript exports.
- `transcription/worker.py`: one exclusive worker, FFmpeg preparation, local recognition, timestamp validation, recovery, heartbeat, and cleanup.
- `src/hooks/use-videos.ts`: shared recording state, upload progress, and polling across both views.
- `src/components/video-workspace.tsx`: native player, seeking, search, exports, and transcript highlighting.
- `src/server/orchestrator.ts`, `tools.ts`, `store.ts`: preserved call workflow, validated tools, idempotent booking, and atomic call persistence.
- `src/hooks/use-demo.ts`: preserved SSE state subscription.

Each recording has a private `.relay-data/videos/<id>/` directory containing `source.video`, normalized `playback.mp4`, and `job.json`. The job ID determines file locations; APIs do not disclose local paths. Model files live in `.relay-data/models/`. Calls live in `.demo-data/state.json`. These directories, `.venv`, media files, and transcripts are excluded from Git. The web application binds to loopback by default.

The HTTP request only uploads and queues; the Python worker handles long-running processing independently. Restarting the web server preserves jobs. A stopped/crashed worker requeues interrupted jobs and removes temporary audio before replaying the source. An exclusive worker lock prevents two workers from consuming the same queue. Call bookings retain explicit confirmation, date/slot uniqueness, idempotency, and post-write lookup verification.

For a later cloud ASR adapter, retain the queue and `VideoJob` / segment contract and replace the worker's recognition implementation. The UI and exports need no provider-specific format. Replace local JSON stores with transactional storage before supporting multiple HTTP servers or users.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run test:worker
npm run test:api
npm run build
npm run test:video
```

`test:video` needs the Python environment, FFmpeg, `curl`, and a cached model (`npm run model:download`). It downloads the public JFK speech fixture from the upstream faster-whisper test data into a temporary directory, adds three seconds of silence, creates actual MP4/MOV/WebM videos, and verifies real ASR, timestamps, range requests, exports, persistence, crash recovery, failures, retry, and deletion. Override `RELAY_TEST_SPEECH` with a local copy of that same JFK fixture to avoid downloading it; expected words assume that fixture. `TEST_VIDEO_PORT` defaults to 3102. The script uses the production build, so run `npm run build` first.

`test:api` starts an isolated dev server on port 3100 (`TEST_PORT` override), checks call scenarios and SSE synchronization, and removes its temporary state. Do not run it while another `next dev` process owns the checkout. Worker tests select the same Python executable as the launcher.

See [VERIFICATION.md](VERIFICATION.md) for the exact results and unexecuted checks.

## Known limits

- Single-computer demo: one Node server, one ASR worker, local JSON stores, no authentication or multi-tenancy. Do not run multiple servers against the same data directory.
- CPU processing and first-time model downloads can be slow. Errors can be retried; deletion may wait for an ASR segment or model operation to finish.
- Whisper segment boundaries and language recognition are approximate. Music, noise, overlapping voices, and short speech can reduce accuracy. No speaker diarization, word highlighting, transcript editing, or live microphone recognition.
- Codec support depends on the installed FFmpeg build. All sources are re-encoded for playback; DRM-protected video is unsupported. The first video/audio tracks are used for multi-track files.
- Windows setup and process handling are implemented, but this environment executed tests on Linux only. GPU execution, real Turkish speech recognition, and browser/mobile visual and interaction checks have not been executed.
