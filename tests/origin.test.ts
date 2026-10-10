import assert from "node:assert/strict";
import { test } from "node:test";
import { DemoError } from "../src/server/errors";
import { body } from "../src/server/http";
import { sameOrigin } from "../src/server/origin";

const request = (headers: Record<string, string>, url = "http://localhost:3000/api/videos") =>
  new Request(url, { method: "POST", headers });
const rejected = (error: unknown) =>
  error instanceof DemoError && error.code === "ORIGIN_REJECTED" && error.status === 403;

test("same-origin writes use the actual Host after Next normalizes loopback URLs", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"])
    assert.doesNotThrow(() => sameOrigin(request({ host, origin: `http://${host}` })));
  assert.doesNotThrow(() =>
    sameOrigin(request({ host: "LOCALHOST:80", origin: "http://localhost" })),
  );
});

test("different hosts, loopback aliases, ports, and protocols remain cross-origin", () => {
  for (const origin of [
    "https://elsewhere.test",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "https://127.0.0.1:3000",
    "http://127.0.0.1:3000.evil.test",
  ])
    assert.throws(() => sameOrigin(request({ host: "127.0.0.1:3000", origin })), rejected);
});

test("opaque and malformed origins and Host headers are rejected", () => {
  for (const origin of ["null", "", "not a URL", "http://localhost:3000/path", "http://user@localhost:3000"])
    assert.throws(() => sameOrigin(request({ host: "localhost:3000", origin })), rejected);
  for (const host of ["", "localhost:3000/path", "localhost:3000?query", "user@localhost:3000", "localhost:3000,elsewhere.test", "localhost:invalid", "localhost\\:3000"])
    assert.throws(() => sameOrigin(request({ host, origin: "http://localhost:3000" })), rejected);
});

test("untrusted forwarded headers cannot authorize another origin", () => {
  assert.throws(() => sameOrigin(request({
    host: "127.0.0.1:3000",
    origin: "https://elsewhere.test",
    "x-forwarded-host": "elsewhere.test",
    "x-forwarded-proto": "https",
  })), rejected);
});

test("requests without Origin and direct Requests without Host retain their behavior", () => {
  assert.doesNotThrow(() => sameOrigin(request({})));
  assert.doesNotThrow(() => sameOrigin(request({ origin: "http://localhost:3000" })));
  assert.throws(() => sameOrigin(request({ origin: "https://elsewhere.test" })), rejected);
});

test("call JSON writes share the Host check and preserve their rejection message", async () => {
  const makeRequest = (origin: string) => new Request("http://localhost:3000/api/calls", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin, "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: "appointment" }),
  });
  assert.deepEqual(await body(makeRequest("http://127.0.0.1:3000")), { scenario: "appointment" });
  await assert.rejects(body(makeRequest("https://elsewhere.test")), /Cross-origin demo writes/);
});
