// Real Ollama + production Next.js + optional real Whisper integration.
// No mocked inference, fabricated transcripts, browser clicks or microphone access.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "relay-cashier-http-"));
const port = Number(process.env.RELAY_TEST_PORT || 3104);
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  CASHIER_DATA_DIR: path.join(data, "cashier"),
  RELAY_DATA_DIR: path.join(data, "speech"),
  DEMO_DATA_DIR: path.join(data, "calls"),
  NEXT_TELEMETRY_DISABLED: "1",
};
if (
  !env.RELAY_MODEL_PATH &&
  fs.existsSync(path.join(root, ".relay-data/models/base/model.bin"))
)
  env.RELAY_MODEL_PATH = path.join(root, ".relay-data/models/base");
const report = {
  startedAt: new Date().toISOString(),
  kind: "real Ollama HTTP integration",
  cases: [],
  turns: [],
  browserMicrophone:
    "Not executed; requires a real supported browser and microphone permission.",
};
const children = [];
let interrupted = false;
let next;
let logs = "";
function child(command, args, childEnv = env) {
  if (interrupted) throw new Error("Integration test was interrupted.");
  const process = spawn(command, args, {
    cwd: root,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  children.push(process);
  for (const stream of [process.stdout, process.stderr])
    stream.on("data", (b) => {
      logs = (logs + b.toString()).slice(-16000);
    });
  process.on("error", (e) => {
    logs += `\n${e.message}`;
  });
  return process;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(url, milliseconds = 40000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* Starting. */
    }
    await sleep(300);
  }
  throw new Error(`Service did not start: ${url}`);
}
async function api(
  route,
  body,
  credentials,
  method = body === undefined ? "GET" : "POST",
  expected = 200,
) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      Origin: base,
      ...(body === undefined || body instanceof Buffer
        ? {}
        : { "Content-Type": "application/json" }),
      ...(credentials ? { Authorization: `Bearer ${credentials.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${route}: ${JSON.stringify(value)}`);
  return value;
}
const endpoint = (c) => `/api/cashier/sessions/${c.id}`;
async function session() {
  const value = await api("/api/cashier/sessions", {}, undefined, "POST", 201);
  return { id: value.session.id, token: value.token };
}
async function read(c) {
  return (await api(endpoint(c), undefined, c)).session;
}
async function say(c, text, extra = {}) {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const response = await api(
    `${endpoint(c)}/messages`,
    { text, messageId: requestId, ...extra },
    c,
    "POST",
    202,
  );
  let view = response.session;
  const deadline = Date.now() + 900000;
  let progress = Date.now();
  while (view.processing) {
    if (Date.now() > deadline)
      throw new Error("Cashier turn did not finish in 15 minutes.");
    await sleep(700);
    view = await read(c);
    if (Date.now() - progress > 20000) {
      console.log(
        `  actual inference ${Math.round((Date.now() - started) / 1000)}s · ${view.events.at(-1)?.label}`,
      );
      progress = Date.now();
    }
  }
  const turn = view.turns.find((t) => t.requestId === requestId);
  assert.equal(turn?.status, "completed", JSON.stringify(view.messages.at(-1)));
  const tools = view.tools.filter((t) => t.turnId === turn.id);
  const inference = view.events.filter(
    (e) =>
      e.turnId === turn.id && e.label === "Actual model inference completed",
  );
  assert.ok(inference.length, "Actual model inference event required");
  assert.ok(
    inference.some((e) => e.metadata.outputTokens > 0),
    "Actual generated tokens required",
  );
  assert.doesNotMatch(JSON.stringify(view), /<think>|<\/think>/i);
  report.turns.push({
    input: text,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    source: extra.source || "text",
    provider: view.provider,
    model: view.model,
    reply: view.messages.at(-1).text,
    tools: tools.map((t) => ({
      name: t.name,
      actor: t.actor,
      arguments: t.arguments,
      status: t.status,
    })),
    items: view.pricedCart.items,
    totalMinor: view.pricedCart.totalMinor,
    orderNumber: view.order?.number,
  });
  return view;
}
function passed(name, evidence) {
  console.log(`PASS ${name}`);
  report.cases.push({ name, status: "passed", evidence });
}
const quantities = (view) =>
  Object.fromEntries(
    [...new Set(view.cart.items.map((i) => i.productId))].map((id) => [
      id,
      view.cart.items
        .filter((i) => i.productId === id)
        .reduce((n, i) => n + i.quantity, 0),
    ]),
  );
async function stop(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null)
    return;
  process.kill("SIGTERM");
  const exit = new Promise((resolve) => process.once("exit", resolve));
  await Promise.race([exit, sleep(6000)]);
  if (process.exitCode === null && process.signalCode === null)
    process.kill("SIGKILL");
}
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, async () => {
    interrupted = true;
    report.error = `Interrupted by ${signal}; this run is not a pass.`;
    fs.writeFileSync(
      path.join(data, "report.json"),
      JSON.stringify(report, null, 2),
    );
    for (const process of [...children].reverse()) await stop(process);
    console.log(`Interrupted verification data: ${data}`);
    process.exit(code);
  });
}
async function startNext() {
  next = child(process.execPath, [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
  await waitFor(`${base}/api/cashier`);
}
try {
  if (process.env.RELAY_TEST_OLLAMA_BIN) {
    env.RELAY_LLM_URL = "http://127.0.0.1:11435";
    child(process.env.RELAY_TEST_OLLAMA_BIN, ["serve"], {
      ...env,
      OLLAMA_HOST: "127.0.0.1:11435",
      OLLAMA_NO_CLOUD: "1",
      ...(process.env.RELAY_TEST_OLLAMA_MODELS
        ? { OLLAMA_MODELS: process.env.RELAY_TEST_OLLAMA_MODELS }
        : {}),
    });
    await waitFor(`${env.RELAY_LLM_URL}/api/tags`);
  }
  await startNext();
  const health = await api("/api/cashier/health");
  assert.equal(health.agent.ready, true, health.agent.error);
  report.provider = health.agent;
  const html = await (await fetch(base)).text();
  assert.ok(
    html.includes("Agent Setup") &&
      html.includes("Operations") &&
      html.includes("AI Engine"),
  );
  let view;
  const variations = await session();
  view = await say(
    variations,
    "Could you fix me up with a pair of cheese burgers, leave the pickles off just the latter one, and a big cup of Sprite?",
  );
  assert.deepEqual(quantities(view), { cheeseburger: 2, sprite: 1 });
  assert.deepEqual(
    view.cart.items
      .filter((i) => i.productId === "cheeseburger")
      .map((i) => i.modifications),
    [[], ["no_pickles"]],
  );
  assert.equal(
    view.cart.items.find((i) => i.productId === "sprite").selections.size,
    "large",
  );
  passed(
    "9 Unfamiliar natural-language variation with actual inference",
    "Pair / latter / big cup resolved by the model",
  );

  const basic = await session();
  view = await say(basic, "One cheeseburger and a Coke.");
  assert.deepEqual(quantities(view), { cheeseburger: 1, cola: 1 });
  assert.deepEqual(
    view.cart.items.map((i) => i.modifications),
    [[], []],
  );
  assert.equal(
    view.cart.items.find((i) => i.productId === "cola").selections.size,
    "medium",
  );
  assert.equal(view.pricedCart.totalMinor, 968);
  assert.equal(view.order, undefined);
  view = await say(basic, "That's all.");
  assert.equal(view.status, "awaiting_confirmation");
  assert.ok(view.quoteValid);
  const quote = view.quote;
  view = await say(basic, "Yes.");
  assert.ok(view.order);
  assert.equal(view.order.paymentStatus, "unpaid");
  assert.equal(view.order.status, "new");
  const stored = JSON.parse(
    fs.readFileSync(path.join(env.CASHIER_DATA_DIR, "state.json"), "utf8"),
  );
  assert.equal(stored.orders[0].id, view.order.id);
  assert.ok(
    (await api("/api/cashier")).orders.some((o) => o.id === view.order.id),
  );
  passed(
    "1 Basic order, real persisted record and Kitchen entry",
    view.order.number,
  );

  const confirmationId = crypto.randomUUID();
  await Promise.all([
    api(
      `${endpoint(basic)}/confirm`,
      { quoteId: quote.id, messageId: confirmationId },
      basic,
    ),
    api(
      `${endpoint(basic)}/confirm`,
      { quoteId: quote.id, messageId: confirmationId },
      basic,
    ),
  ]);
  await api(
    `${endpoint(basic)}/confirm`,
    { quoteId: quote.id, messageId: crypto.randomUUID() },
    basic,
  );
  assert.equal((await api("/api/cashier")).orders.length, 1);
  passed(
    "7 Duplicate and concurrent confirmation submissions",
    "Only one order",
  );

  const combo = await session();
  view = await say(
    combo,
    "I want a large burger meal with Sprite instead of Cola and no pickles.",
  );
  assert.deepEqual(quantities(view), { classic_burger_meal: 1 });
  assert.deepEqual(view.cart.items[0].selections, {
    size: "large",
    drink: "sprite",
  });
  assert.ok(view.cart.items[0].modifications.includes("no_pickles"));
  assert.equal(view.pricedCart.totalMinor, 1402);
  passed(
    "2 Combo customization and actual total",
    "Large / Sprite / no pickles / $14.02",
  );

  const changes = await session();
  view = await say(changes, "Two burgers and fries.");
  // A generic burger can reasonably trigger a product clarification. Answer it
  // as a customer; do not bypass the model with direct add-to-cart test calls.
  if (
    !view.cart.items.length &&
    /which|what type|what kind|\?/i.test(view.messages.at(-1).text)
  )
    view = await say(changes, "Classic burgers, please, and keep the fries.");
  assert.deepEqual(quantities(view), { classic_burger: 2, fries: 1 });
  view = await say(changes, "Remove one burger and add a large Sprite.");
  assert.deepEqual(quantities(view), {
    classic_burger: 1,
    fries: 1,
    sprite: 1,
  });
  assert.equal(
    view.cart.items.find((i) => i.productId === "sprite").selections.size,
    "large",
  );
  passed("3 Natural corrections mutate actual cart lines", quantities(view));

  const unavailable = await session();
  view = await say(unavailable, "A strawberry milkshake, please.");
  assert.equal(view.cart.items.length, 0);
  assert.match(
    view.messages.at(-1).text,
    /sold out|unavailable|not available/i,
  );
  passed("4 Sold-out item with no silent substitution", "Cart remains empty");

  const ambiguous = await session();
  view = await say(ambiguous, "Remove the sauce from the second one.");
  assert.equal(view.cart.items.length, 0);
  assert.match(view.messages.at(-1).text, /\?|which|clarif|second|cart/i);
  view = await say(ambiguous, "Two cheeseburgers, please.");
  const secondId = view.cart.items[1].id;
  view = await say(ambiguous, "Remove the sauce from the second one.");
  assert.equal(view.cart.items[1].id, secondId);
  assert.deepEqual(
    view.cart.items.map((i) => i.modifications),
    [[], ["no_sauce"]],
  );
  passed("5 Ambiguity and exact second-line modification", secondId);

  view = await say(
    combo,
    "That's everything. Please show the total before I decide.",
  );
  assert.ok(view.quote);
  view = await say(combo, "No, don't place that order. I'm still deciding.");
  assert.equal(view.order, undefined);
  assert.equal((await api("/api/cashier")).orders.length, 1);
  passed(
    "6 Refused confirmation does not create an order",
    "One previously confirmed order remains",
  );

  let order = (await read(basic)).order;
  for (const status of ["preparing", "ready", "completed"]) {
    order = (
      await api(
        `/api/cashier/orders/${order.id}`,
        { status, version: order.statusVersion },
        undefined,
        "PATCH",
      )
    ).order;
    assert.equal((await read(basic)).order.status, status);
  }
  view = await say(basic, "What stage has my order reached now?");
  assert.match(view.messages.at(-1).text, /completed/i);
  await stop(next);
  await startNext();
  assert.equal((await read(basic)).order.status, "completed");
  passed(
    "8 Kitchen progression, customer status and server restart",
    order.number,
  );

  const settings = (await api("/api/cashier")).job;
  await api(
    "/api/cashier/job",
    {
      ...settings,
      agentName: "Deniz",
      primaryLanguage: "tr",
      greeting: "Merhaba! Siparişinizi alabilirim.",
    },
    undefined,
    "PUT",
  );
  const turkish = await session();
  assert.equal((await read(turkish)).job.agentName, "Deniz");
  view = await say(turkish, "Bir cheeseburger ve büyük Sprite istiyorum.");
  assert.deepEqual(quantities(view), { cheeseburger: 1, sprite: 1 });
  assert.equal((await read(basic)).job.agentName, "Alex");
  passed(
    "Saved job configuration and Turkish real inference",
    "New session uses Deniz; earlier session retains Alex",
  );

  const menu = await api("/api/cashier");
  const pending = await api(
    `${endpoint(changes)}/actions`,
    {
      name: "calculate_order_total",
      arguments: {},
      messageId: crypto.randomUUID(),
    },
    changes,
  );
  await api(
    "/api/cashier/menu",
    {
      revision: menu.menuRevision,
      products: menu.products.map((p) =>
        p.id === "sprite" ? { ...p, available: false } : p,
      ),
    },
    undefined,
    "PUT",
  );
  const stale = await api(
    `${endpoint(changes)}/confirm`,
    { quoteId: pending.session.quote.id, messageId: crypto.randomUUID() },
    changes,
  );
  assert.equal(stale.session.order, undefined);
  assert.equal(stale.session.turns.at(-1).status, "failed");
  passed(
    "Live-menu edit invalidates a displayed quote",
    "No stale or sold-out order saved",
  );
  const current = await api("/api/cashier");
  await api(
    "/api/cashier/menu",
    { revision: current.menuRevision, products: menu.products },
    undefined,
    "PUT",
  );

  const handoff = await session();
  view = await say(handoff, "I need a refund for yesterday's payment.");
  assert.equal(view.status, "handoff");
  assert.ok(
    (await api("/api/cashier")).handoffs.some(
      (h) => h.sessionId === handoff.id,
    ),
  );
  passed(
    "Unsupported refund creates a local staff-help record",
    "No payment or external notification",
  );
  const denied = await fetch(`${base}${endpoint(basic)}/actions`, {
    method: "POST",
    headers: {
      Origin: "https://foreign.example",
      "Content-Type": "application/json",
      Authorization: `Bearer ${basic.token}`,
    },
    body: JSON.stringify({
      name: "get_cart",
      arguments: {},
      messageId: crypto.randomUUID(),
    }),
  });
  assert.equal(denied.status, 403);
  await api(endpoint(basic), undefined, { token: "wrong" }, "GET", 403);
  passed(
    "Actual HTTP origin and session-authorization guards",
    "Foreign mutation and wrong capability rejected",
  );

  let speechFile = process.env.RELAY_TEST_SPEECH_FILE;
  if (process.argv.includes("--synthetic-voice")) {
    speechFile = path.join(data, "spoken-order.webm");
    const synth = child("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "flite=text='One cheeseburger please':voice=slt",
      "-c:a",
      "libopus",
      "-f",
      "webm",
      "-live",
      "1",
      speechFile,
    ]);
    await new Promise((resolve, reject) => {
      synth.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                "FFmpeg must include libflite for --synthetic-voice; otherwise provide RELAY_TEST_SPEECH_FILE.",
              ),
            ),
      );
      synth.once("error", reject);
    });
  }
  if (speechFile) {
    const python =
      env.RELAY_PYTHON ||
      path.join(
        root,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
    child(python, ["transcription/worker.py"]);
    let health;
    for (let i = 0; i < 40; i++) {
      health = await api("/api/cashier/health");
      if (health.speech.online && health.speech.status === "ready") break;
      await sleep(500);
    }
    assert.ok(
      health.speech.online && health.speech.status === "ready",
      health.speech.error,
    );
    const voiceSession = await session();
    const mime = {
      ".webm": "audio/webm",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".mp4": "audio/mp4",
    }[path.extname(speechFile)];
    assert.ok(mime, "Supported audio file required");
    const response = await fetch(
      `${base}${endpoint(voiceSession)}/utterances`,
      {
        method: "POST",
        headers: {
          Origin: base,
          Authorization: `Bearer ${voiceSession.token}`,
          "Content-Type": mime,
        },
        body: fs.readFileSync(speechFile),
      },
    );
    const value = await response.json();
    assert.equal(response.status, 202, JSON.stringify(value));
    let utterance = value.utterance;
    for (
      let i = 0;
      i < 240 && ["queued", "processing"].includes(utterance.status);
      i++
    ) {
      await sleep(500);
      utterance = (
        await api(
          `${endpoint(voiceSession)}/utterances/${utterance.id}`,
          undefined,
          voiceSession,
        )
      ).utterance;
    }
    assert.equal(utterance.status, "completed", JSON.stringify(utterance));
    assert.ok(utterance.text);
    if (process.argv.includes("--synthetic-voice"))
      assert.match(utterance.text, /cheese\s*burger/i);
    view = await say(voiceSession, utterance.text, {
      source: "voice",
      utteranceId: utterance.id,
    });
    assert.ok(
      view.cart.items.length > 0,
      "Use an audio recording of a supported menu order for the voice fixture.",
    );
    if (process.argv.includes("--synthetic-voice"))
      assert.deepEqual(quantities(view), { cheeseburger: 1 });
    const dir = path.join(env.RELAY_DATA_DIR, "utterances", utterance.id);
    assert.equal(fs.existsSync(path.join(dir, "source.audio")), false);
    assert.equal(fs.existsSync(path.join(dir, "audio.wav")), false);
    passed(
      "10 Backend voice fixture: actual Whisper → actual Ollama → same saved cart",
      {
        text: utterance.text,
        model: utterance.model,
        duration: utterance.duration,
        source: process.argv.includes("--synthetic-voice")
          ? "FFmpeg libflite spoken audio, WebM without duration metadata"
          : "Provided audio recording",
        browserMicrophone: "Not executed",
      },
    );
  } else
    report.cases.push({
      name: "10 Voice",
      status: "not executed",
      reason:
        "Provide RELAY_TEST_SPEECH_FILE with a spoken menu order or --synthetic-voice when FFmpeg includes libflite. Browser microphone requires manual QA.",
    });
  report.completedAt = new Date().toISOString();
  report.status = "passed";
  console.log(
    `Real cashier integration passed (${report.cases.filter((c) => c.status === "passed").length} checks, ${report.turns.length} model turns).`,
  );
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  console.error(error.stack);
  console.error(logs.slice(-5000));
  process.exitCode = 1;
} finally {
  for (const process of children.reverse()) await stop(process);
  fs.writeFileSync(
    path.join(data, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (
    process.env.RELAY_TEST_PRESERVE_DATA === "1" ||
    report.status === "failed"
  )
    console.log(`Verification data: ${data}`);
  else fs.rmSync(data, { recursive: true, force: true });
}
