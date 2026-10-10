# Relay

A local operations workspace with a **real AI Fast-Food Cashier**, persistent carts and unpaid restaurant orders, a local Kitchen, **real video transcription**, and the preserved Northline Auto appointment demo. Built with Next.js, TypeScript, Ollama, FFmpeg, and faster-whisper. The basic workflow needs no paid API or API key.

**Workspace** prioritizes **AI Cashier**, alongside **Run Demo Call** and **Analyze Video**. **Operations** contains Kitchen, saved orders, and the editable menu. **Agent Setup** configures the implemented Fast-Food Cashier job. **AI Engine** shows actual model requests, validated tool executions, and saved results. This feature is developed on `feat/restaurant-cashier-agent` and is left unmerged.

## Local setup

Install Node.js 20.9+ (tested with Node 24.19), Python **3.12, 64-bit**, and FFmpeg with both `ffmpeg` and `ffprobe` on PATH. Python 3.12 is the documented baseline; other Python versions have not been verified. Run commands from the repository folder.

### Ollama — real cashier model

Install [Ollama](https://ollama.com/download). On Windows, use its official installer, start the Ollama application, and reopen PowerShell. The application runs its API in the background on port 11434; [official Windows instructions](https://docs.ollama.com/windows). On Linux/macOS, ensure the service is running; use `ollama serve` in a separate terminal when needed.

```sh
ollama --version
ollama pull qwen3.5:4b-q4_K_M
ollama list
```

Relay defaults to this explicit [Qwen3.5 4B Q4_K_M model](https://ollama.com/library/qwen3.5:4b-q4_K_M), with structured tool calling and thinking disabled through the API. Its download is about 3.3 GB. Install a current Ollama version that supports this model. Allow RAM for inference, Relay, and Whisper; 16 GB system RAM provides useful headroom for this local setup. A CPU turn can take minutes; the interface waits for actual inference and shows saved actions as they occur. The Ollama model and Whisper `base` are **two separate downloads**. `npm run model:download` downloads Whisper only.

The **AI Cashier** start action checks the actual Ollama service, installed model, and tool capability. If setup is missing it returns an understandable error; there is no fake chatbot fallback. Video and appointment workflows work without Ollama.

If this repository is already installed, fetch the isolated feature before following the setup:

```sh
git fetch origin
git switch feat/restaurant-cashier-agent
npm ci
```

### Windows — PowerShell

```powershell
git clone --branch feat/restaurant-cashier-agent https://github.com/ismet3547/relay.git
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

If Winget says FFmpeg is already installed but commands are missing, refresh the current shell's PATH, check both executables, then restart Relay:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
ffmpeg -version
ffprobe -version
```

If you install FFmpeg manually, add its `bin` directory to PATH. Downloads: [FFmpeg](https://ffmpeg.org/download.html), [Python](https://www.python.org/downloads/windows/), [Node.js](https://nodejs.org/). Activating the virtual environment is optional: the launcher selects `.venv\Scripts\python.exe` directly, so PowerShell script execution policy does not block startup.

### macOS / Linux

Install FFmpeg using your system package manager, then:

```sh
git clone --branch feat/restaurant-cashier-agent https://github.com/ismet3547/relay.git
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
| `CASHIER_DATA_DIR` | Separate restaurant data directory (default `.cashier-data`) |
| `RELAY_LLM_PROVIDER` | `ollama`; the implemented adapter. Unknown providers return a setup error |
| `RELAY_LLM_MODEL` | Default `qwen3.5:4b-q4_K_M`; install the exact selected tag |
| `RELAY_LLM_URL` | Default `http://127.0.0.1:11434`; server-side Ollama endpoint |
| `RELAY_LLM_TIMEOUT_MS` | Per-inference timeout; default 180000, bounded to 10000–180000 ms |
| `RELAY_LLM_API_KEY` | Optional server-only bearer credential for a protected Ollama endpoint; unnecessary locally |

CPU needs no CUDA installation. GPU support requires a compatible NVIDIA/CTranslate2 stack; follow [faster-whisper's GPU requirements](https://github.com/SYSTRAN/faster-whisper#gpu) and [CTranslate2 installation](https://opennmt.net/CTranslate2/installation.html) before setting `cuda`. GPU execution has not been tested here. Long recordings and larger models can take significant time on a CPU; processing shows actual stages rather than invented completion percentages.

`transcription/requirements.txt` pins faster-whisper 1.2.1 and **PyAV 16.1.0**. Do not upgrade PyAV independently: version 19 removed an argument used by this faster-whisper release ([upstream issue](https://github.com/SYSTRAN/faster-whisper/issues/1589)). `socksio` supports environments with a SOCKS proxy during the initial model download.

Set shared worker/web variables in the shell before `dev:all` or `start:all`. The launcher inherits shell variables for both children; it does not load Next's `.env.local` into Python. Next alone can load server-only LLM settings from `.env.local`. Restart after changing configuration. No credential is sent to the browser or written into a job configuration.

## Take a real restaurant order

1. Open **Agent Setup**. The implemented job is **Fast-Food Cashier**; edit the agent/business names, greeting, English/Turkish primary language, style instructions, enabled tools, tax rate, item limit, and pickup/dine-in rules. Save. Settings apply to subsequent sessions; an active session retains its job version and permissions.
2. Open **Operations → Menu**. Select a product to edit its real base price, aliases, category, availability, ingredients/allergens, required selections, defaults, option choices, and paid extras. Add or delete products in the draft, then **Save menu**. Reload discards unsaved edits. Concurrent saves use revision checks.
3. Open **Workspace → AI Cashier**, then **Start ordering**. Try `One cheeseburger and a Coke.` or `I want a large burger meal with Sprite instead of Cola and no pickles.`
4. The real model reads the stored menu and invokes registered tools. Watch the cart beside the conversation. `quantity: 2` creates separate unit lines; multi-item additions use explicit per-unit modifier scope, so `Make the second burger without onions` changes that exact item. Ask about ingredients, sizes, or choices; missing required selections require clarification.
5. Make corrections naturally. You can also adjust quantities, remove a line, or choose fulfillment using the cart controls. These are explicitly logged as **customer controls**, not AI tool calls. All prices and tax use integer minor units on the backend.
6. Say `That's all` or use **Review order**. Review the exact items, selections, fulfillment, subtotal, tax, and total. Click **Confirm order**, or type a standalone affirmative reply such as `Yes` after a valid quote. An order is never saved by the model granting itself approval. Voice recognition alone cannot grant final approval; use the displayed button.
7. The backend rechecks the menu, availability, options, quantity limits and exact quote, writes the order atomically, reads the saved record back, and returns its actual `RB-…` number. Payment remains **unpaid / pay at counter**. A changed menu/cart or expired five-minute review requires another review. Retried confirmations return the same order.
8. Open **Operations → Kitchen** to find that same order. Advance **New → Preparing → Ready → Completed**. Status persists and updates the customer cart. Ask `What stage has my order reached?` to use the actual order-status tool.
9. Open **AI Engine → AI Cashier**. Choose the session; inspect actual lifecycle events, inference provider/model/token counts, tool arguments/results, errors, actors, and timestamps. At the start of each customer turn, the server executes the registered `get_menu` read to supply real identifiers and choices before inference. This is labeled **Server context read**, separately from **AI tool call** and **Customer cart control**. Model tool schemas contain real menu product/option/modifier IDs; backend validation still checks every operation. Private model reasoning is discarded and never displayed. The internal completion check compares a proposed reply to actual saved operations through another real inference request. A successful quote/status/order/handoff tool returns the verified backend result immediately. If the customer has already approved an unchanged quote, another total read preserves that approval and the model continues to confirm_order; it does not ask for approval again. Quote preparation never grants approval.
10. Refresh to resume the current ordering session on the same browser origin. Confirmed orders remain in Kitchen even if browser storage is cleared. **New order** starts a separate session without deleting older saved orders.

The model selects real tools and asks clarifying questions. After cart mutations, the backend renders the saved items, quantities, choices and total, retaining a model-generated clarification question when present. This prevents a fluent draft from describing an unsaved change as complete. Updating a line to its existing quantity/customizations is rejected as unchanged; removing one of two separate unit lines requires deleting that exact line.

The fictional menu uses USD and a configurable demo tax rate. Defaults are explicit: for example, a standard drink defaults to medium; combos require size and drink. Displayed base prices exclude selections/extras. Allergy information is descriptive and cannot establish safety or cross-contact guarantees. Refunds, disputes, and unsupported operations create a local staff-help record visible in Operations; no real staff notification, payment, printer, POS, delivery, or telephone integration exists.

### Speak to the cashier

Run `npm run dev:all` so Whisper's worker is online. In a supported browser on `localhost`/`127.0.0.1` or HTTPS, start a cashier session, press **Speak**, allow microphone access, speak a short order, and press **Stop recording**. It stops automatically after 30 seconds. Relay uploads at most 4 MiB to the separate utterance queue, decodes actual audio, recognizes it with local Whisper, displays the recognized text, and sends that exact transcript to the same real AI session. No video job is created.

**Listening**, **Transcribing**, **Processing**, and **Speaking** follow actual recorder, worker, model, and speech-synthesis events. Enable **Read replies aloud** or use **Listen** on a reply for browser speech synthesis. Browser voices and language availability depend on the system. Recognition can queue behind an active video; **Use text instead** cancels waiting in the browser. Source audio is removed after recognition, and utterance metadata/text expire after one hour while the conversation retains its sent text.

Permission denial, unsupported media formats, silence, decoder failures, an offline worker, missing FFmpeg, and missing models show an error with text input as the fallback. Review misrecognized speech via **Edit as text** before sending another correction. Final confirmation remains an explicit action on the displayed quote. This is push-to-talk, not full-duplex audio or telephony.

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
7. Settings lets you pause new calls or reset the call demo. Reset restores example calls and appointments and leaves restaurant orders, menu/settings, and video recordings intact.

Free-text rules support oil changes, today/tomorrow or valid ISO dates within 30 days, morning/afternoon, times such as `10:00` / `10 AM`, vehicle descriptions starting with a year, and explicit confirmation/cancellation. Unsupported services go to a human. Appointment times use **UTC**.

## Use the AI Engine

Choose **AI Cashier**, **Demo call**, or **Video transcription**, then select the same conversation or recording shown in Workspace. Switching screens does not cancel processing. Use **Open call/video** to return to the task.

Calls show **Listen → Understand → Decide → Act → Respond**. These are recurring stages of an interactive conversation: “Observed” means a real event was recorded, not that all future turns are finished. Expand **Technical details** for the original ten-stage pipeline, agent state, tool arguments/results, and event timeline.

Videos show **Upload, Validate, Extract audio, Recognize speech, Check timestamps, Ready**. Statuses and event metadata come from the durable job file. “Check timestamps” validates timestamps returned by Whisper against playback duration; it does not claim a separate forced-alignment or diarization model. Expand **Technical details** for codec metadata, detected language/confidence, model/device, processing time, and actual timestamped events.

## What is real, what is simulated

| Feature | Behavior |
| --- | --- |
| Cashier conversation | **Real** configured Ollama inference with structured tools; no scripted order matching |
| Restaurant menu/cart/total/orders/Kitchen | **Real** validated local data, integer prices, atomic writes, confirmation, idempotency and status updates |
| Cashier short-utterance recognition | **Real** FFmpeg + local Whisper; browser microphone and TTS require local browser verification |
| Job settings and tool permissions | Saved settings snapshot into new sessions; server registry and schemas enforce permissions |
| Cashier human handoff | Real local record; no employee is contacted |
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
- `src/server/cashier-store.ts`, `cashier-schema.ts`, `cashier-tools.ts`: separate restaurant domain, strict registered tools, capabilities, pricing, quotes, atomic orders and kitchen progression.
- `src/server/cashier-ai.ts`: provider-independent `CashierProvider` contract, implemented Ollama adapter, bounded inference/tool loop, sanitized replies and observable inference metrics.
- `src/server/cashier-speech.ts`: authenticated bounded audio upload and short-utterance queue; the exclusive Python worker shares its cached Whisper model between voice and videos.
- `src/hooks/use-cashier*.ts`, `src/components/cashier-*.tsx`: shared session polling, browser audio controls, cashier/cart, Kitchen, menu editor, job settings and engine inspection.

Each recording has a private `.relay-data/videos/<id>/` directory containing `source.video`, normalized `playback.mp4`, and `job.json`. The job ID determines file locations; APIs do not disclose local paths. Model files live in `.relay-data/models/`. Calls live in `.demo-data/state.json`. Restaurant menu, job, sessions, orders, and handoffs live in `.cashier-data/state.json`, with atomic replacement writes. Session tokens are hashed in server storage; the browser stores its own capability in localStorage to resume on refresh. Short audio uses `.relay-data/utterances/<id>/`; source audio and extracted WAV are removed after recognition, and the worker expires utterance job/transcript files after one hour. These directories, `.venv`, media files, and transcripts are excluded from Git. The web application binds to loopback by default.

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
npm run test:cashier
```

`test:cashier` starts a production server on port 3104 (`RELAY_TEST_PORT` override), using isolated temporary restaurant/call/speech directories. Start Ollama and install the configured model first; run `npm run build` after changes. It uses actual inference to test basic orders, combos, corrections, sold-out/ambiguous requests, refusal, duplicate confirmations, Kitchen progression and restart, unfamiliar language, job edits, menu invalidation and handoff. A missing model fails the check; no test-double provider is used here.

For backend voice verification, provide a real audio recording containing an available menu order:

```powershell
$env:RELAY_TEST_SPEECH_FILE = "C:\path\spoken-order.webm"
npm run test:cashier
```

On FFmpeg builds with `libflite`, `npm run test:cashier -- --synthetic-voice` generates an actual spoken audio fixture and verifies Whisper → Ollama → cart, including live WebM with no duration metadata. Synthetic-audio integration does **not** exercise browser microphone permissions, MediaRecorder controls, or TTS. Those require the manual browser flow above. `RELAY_TEST_PRESERVE_DATA=1` keeps the isolated report and persisted state for inspection; failed runs retain evidence automatically. Advanced test environments can set `RELAY_TEST_OLLAMA_BIN` and `RELAY_TEST_OLLAMA_MODELS` to start a separate local Ollama instance for the script.

`test:video` needs the Python environment, FFmpeg, `curl`, and a cached model (`npm run model:download`). It downloads the public JFK speech fixture from the upstream faster-whisper test data into a temporary directory, adds three seconds of silence, creates actual MP4/MOV/WebM videos, and verifies real ASR, timestamps, range requests, exports, persistence, crash recovery, failures, retry, and deletion. Override `RELAY_TEST_SPEECH` with a local copy of that same JFK fixture to avoid downloading it; expected words assume that fixture. `TEST_VIDEO_PORT` defaults to 3102. The script uses the production build, so run `npm run build` first.

`test:api` starts an isolated dev server on port 3100 (`TEST_PORT` override), checks call scenarios and SSE synchronization, and removes its temporary state. Do not run it while another `next dev` process owns the checkout. Worker tests select the same Python executable as the launcher.

See [VERIFICATION.md](VERIFICATION.md) for the exact results and unexecuted checks.

## Known limits

- Single-computer demo: one Node server, one ASR worker, local JSON stores, no employee authentication or multi-tenancy. Cashier mutations require a browser-held session capability. Do not run multiple servers against the same data directory.
- Local employee inspection, menu/settings and Kitchen do not have employee authentication; keep Relay bound to loopback. This is not a deployed restaurant service. Capability tokens authorize customer session mutations, but do not provide staff access control.
- The adapter contract is independent, but this build implements Ollama only. Other providers require their own adapter; OpenAI or paid cloud APIs are not required. Model quality varies: short requests and explicit clarification help. Failed/limited turns keep actual saved cart actions and expose the error; inspect the cart before retrying.
- Arbitrary conversational affirmations are not an authorization parser. The backend recognizes narrow standalone English/Turkish affirmative replies after a valid quote; use **Confirm order** for other wording. Cart/menu changes invalidate the quote. Voice transcripts never authorize final submission.
- Current session capabilities are remembered per browser origin. `localhost` and `127.0.0.1` have separate browser storage; both see the same saved Kitchen orders. Starting another session replaces the browser's current-session pointer, while older records remain inspectable in AI Engine.
- CPU processing and first-time model downloads can be slow. Errors can be retried; deletion may wait for an ASR segment or model operation to finish.
- Whisper segment boundaries and language recognition are approximate. Music, noise, overlapping voices, and short speech can reduce accuracy. No speaker diarization, word highlighting, or transcript editing. Cashier microphone input uses its separate short-utterance path; video transcription is unchanged.
- Codec support depends on the installed FFmpeg build. All sources are re-encoded for playback; DRM-protected video is unsupported. The first video/audio tracks are used for multi-track files.
- Windows setup and process handling are implemented, but this environment executed tests on Linux only. GPU execution, real Turkish speech recognition, and browser/mobile visual and interaction checks have not been executed.
