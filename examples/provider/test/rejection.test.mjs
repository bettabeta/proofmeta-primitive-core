// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP-level tests for the reference Provider's rejection branches.
 *
 * Spawns the provider once on an isolated port, fetches the manifest, then
 * fires crafted OPEN envelopes at /api/proofmeta/request to hit each of the
 * provider's rejection branches end-to-end — the paths that exist in the
 * server code but are not exercised by scripts/e2e.mjs.
 *
 * Each test asserts both the HTTP status and the error message so a
 * behavior change in one branch is caught precisely.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import {
  generateKeyPair,
  createEnvelope,
  hashPayload,
  verifyEnvelope,
  verifyChain,
} from "@proofmeta/sdk-ts";

// ── Fixture setup ─────────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, "..", "server.mjs");
const PORT = Number(process.env.PORT ?? 4102);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let providerProc;
let providerDid;
let termsHash;
let licenseType;
let itemId;

before(async () => {
  providerProc = spawn(
    "node",
    [serverPath],
    {
      env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", PUBLIC_ORIGIN: ORIGIN },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  providerProc.stdout.on("data", () => {}); // drain
  providerProc.stderr.on("data", () => {});

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${ORIGIN}/.well-known/proofmeta.json`);
      if (r.ok) {
        const manifest = await r.json();
        providerDid = manifest.payload.provider.id;
        licenseType = manifest.payload.license_types[0].id;
        termsHash = manifest.payload.license_types[0].terms_hash;
        itemId = manifest.payload.items[0].item_id;
        return;
      }
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("provider did not start in time");
});

after(() => {
  if (providerProc && !providerProc.killed) providerProc.kill("SIGTERM");
});

// ── Helpers ───────────────────────────────────────────────────────────────

function uuidv7() {
  const unixMs = BigInt(Date.now());
  const randA = Math.floor(Math.random() * 0x1000); // 12 bits
  const randHi = Math.floor(Math.random() * 0x4000) | 0x8000; // 14 bits + RFC variant
  const randLo =
    Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0") +
    Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  const hex = unixMs.toString(16).padStart(12, "0");
  const timeLow = hex.slice(0, 8);
  const timeMid = hex.slice(8, 12);
  const verRandA = (0x7000 | randA).toString(16).padStart(4, "0");
  const varRand = randHi.toString(16).padStart(4, "0");
  return `${timeLow}-${timeMid}-${verRandA}-${varRand}-${randLo.slice(0, 12)}`;
}

/** Build a valid OPEN envelope; override any payload field to hit a branch. */
async function makeOpen(overrides = {}) {
  const consumer = await generateKeyPair();
  const payload = {
    type: "license.request",
    request_id: uuidv7(),
    consumer: { id: consumer.did },
    provider_id: providerDid,
    item_id: itemId,
    license_type: licenseType,
    terms_hash: termsHash,
    status: "OPEN",
    ...overrides,
  };
  const env = await createEnvelope({
    payload,
    author: consumer.did,
    privateKey: consumer.privateKey,
  });
  return { env, consumer };
}

async function postRequest(body) {
  return fetch(`${ORIGIN}/api/proofmeta/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Serialized into a temporary resolver wrapper, never a rewritten server.
// The loader redirects only the real server's resolver import. The SDK, HTTP,
// signing and successful resolver processing remain unchanged on Node 18+.
function controlledResolver(createFreeResolver, options) {
  const real = createFreeResolver(options);
  let released = false;
  let fail = false;
  const waiters = [];
  process.on("message", (message) => {
    if (message.type !== "release") return;
    released = true;
    fail = message.fail;
    for (const resolve of waiters.splice(0)) resolve();
  });
  return {
    ...real,
    async process(input) {
      process.send({ type: "call", id: input.request.request_id });
      if (!released) await new Promise((resolve) => waiters.push(resolve));
      if (fail) throw new Error("injected resolver failure after reservation");
      return real.process(input);
    },
  };
}

async function waitUntil(predicate, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  throw new Error(`timed out: ${description}`);
}

async function controlledProvider(t) {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const scratch = await mkdtemp(path.join(tmpdir(), "proofmeta-h4-"));
  let child;
  const requests = [];
  const controllers = [];
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    await Promise.allSettled(requests);
    await rm(scratch, { recursive: true, force: true });
  });
  const wrapperURL = pathToFileURL(path.join(scratch, "resolver.mjs")).href;
  const realURL = pathToFileURL(createRequire(import.meta.url).resolve("@proofmeta/resolver-free")).href;
  await writeFile(path.join(scratch, "resolver.mjs"), `
    import { createFreeResolver as real } from ${JSON.stringify(realURL)};
    const wrap = ${controlledResolver.toString()};
    export function createFreeResolver(options) { return wrap(real, options); }
  `);
  const loaderPath = path.join(scratch, "loader.mjs");
  await writeFile(loaderPath, `
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "@proofmeta/resolver-free" &&
          context.parentURL === ${JSON.stringify(pathToFileURL(serverPath).href)}) {
        return { url: ${JSON.stringify(wrapperURL)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `);
  child = spawn(process.execPath, ["--experimental-loader", loaderPath, serverPath], {
    cwd: path.dirname(serverPath),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1",
      PUBLIC_ORIGIN: origin, PROVIDER_SERVER: serverPath },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let diagnostics = "";
  child.stdout.on("data", (data) => { diagnostics = (diagnostics + data).slice(-4000); });
  child.stderr.on("data", (data) => { diagnostics = (diagnostics + data).slice(-4000); });
  const calls = [];
  child.on("message", (message) => {
    if (message.type === "call") calls.push(message.id);
  });
  // Attach rejection handlers immediately, including requests held at the
  // resolver barrier. Cleanup aborts and settles them even after a RED assertion.
  function request(url, options = {}) {
    const controller = new AbortController();
    controllers.push(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    const pending = fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    pending.catch(() => {});
    requests.push(pending);
    return pending;
  }
  let manifest;
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`controlled provider exited: ${diagnostics}`);
    try {
      const response = await fetch(`${origin}/.well-known/proofmeta.json`);
      if (!response.ok) return false;
      manifest = await response.json();
      return true;
    } catch { return false; }
  }, "controlled provider startup");
  return {
    calls,
    async open(overrides = {}) {
      return (await makeOpen({ provider_id: manifest.payload.provider.id, ...overrides })).env;
    },
    post(body) {
      return request(`${origin}/api/proofmeta/request`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    get(id, full = false) {
      return request(`${origin}/api/proofmeta/request/${id}${full ? "?full=true" : ""}`);
    },
    release(fail = false) { child.send({ type: "release", fail }); },
  };
}

// A missing reservation sends the duplicate into the held resolver. Diagnose
// that as an assertion, not as a fetch timeout or background rejection.
async function assertPendingConflict(provider, open) {
  let timer;
  try {
    const response = await Promise.race([
      provider.post(open),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); }),
    ]);
    assert.ok(response, `duplicate must return 409 before resolver release; resolver calls=${provider.calls.length}`);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "request_id already seen" });
  } finally { clearTimeout(timer); }
}

async function assertValidChain(chain, open) {
  assert.equal(chain.length, 3);
  assert.deepEqual(chain[0], open);
  assert.deepEqual(chain.map((env) => env.payload.status), ["OPEN", "PENDING", "GRANTED"]);
  for (const env of chain) assert.equal((await verifyEnvelope(env)).ok, true);
  assert.equal((await verifyChain(chain)).ok, true);
}

test("H4: eight parallel identical requests reserve exactly once", async (t) => {
  const provider = await controlledProvider(t);
  const open = await provider.open();
  const completed = [];
  const requests = Array.from({ length: 8 }, () => provider.post(open));
  for (const pending of requests) {
    pending.then((response) => completed.push(response), () => {});
  }
  await waitUntil(() => provider.calls.length > 0, "first resolver call");
  const deadline = Date.now() + 2000;
  while (completed.length < 7 && Date.now() < deadline) await delay(10);
  assert.equal(completed.length, 7,
    `seven duplicates must complete before release; resolver calls=${provider.calls.length}`);
  assert.deepEqual(completed.map((response) => response.status), Array(7).fill(409));
  for (const response of completed) {
    assert.deepEqual(await response.clone().json(), { error: "request_id already seen" });
  }
  assert.deepEqual(provider.calls, [open.payload.request_id]);
  for (const full of [false, true]) {
    const hidden = await provider.get(open.payload.request_id, full);
    assert.equal(hidden.status, 404);
    assert.deepEqual(await hidden.json(), { error: "unknown request_id" });
  }
  provider.release();
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((res) => res.status).sort(), [200, 409, 409, 409, 409, 409, 409, 409]);
  assert.deepEqual(provider.calls, [open.payload.request_id]);
  const { chain } = await responses.find((res) => res.status === 200).json();
  await assertValidChain(chain, open);
  const full = await provider.get(open.payload.request_id, true);
  assert.equal(full.status, 200);
  assert.deepEqual(await full.json(), { chain });
  const latest = await provider.get(open.payload.request_id);
  assert.equal(latest.status, 200);
  assert.deepEqual(await latest.json(), chain[2]);
});

test("H4: differently signed same-ID payload conflicts while pending and completed", async (t) => {
  const provider = await controlledProvider(t);
  const open = await provider.open();
  // Build a second valid, differently signed request rather than tampering bytes.
  // makeOpen creates its own consumer with matching author and consumer.id.
  const other = await provider.open({ request_id: open.payload.request_id });
  assert.notEqual(other.signature, open.signature);
  assert.notEqual(other.payload_hash, open.payload_hash);
  assert.equal((await verifyEnvelope(other)).ok, true);
  const first = provider.post(open);
  await waitUntil(() => provider.calls.length === 1, "pending resolver");
  for (const duplicate of [open, other]) await assertPendingConflict(provider, duplicate);
  provider.release();
  const winner = await first;
  assert.equal(winner.status, 200);
  await assertValidChain((await winner.json()).chain, open);
  for (const duplicate of [open, other]) assert.equal((await provider.post(duplicate)).status, 409);
  assert.deepEqual(provider.calls, [open.payload.request_id]);
});

test("H4: resolver failure retains reservation without publishing a partial chain", async (t) => {
  const provider = await controlledProvider(t);
  const open = await provider.open();
  const first = provider.post(open);
  await waitUntil(() => provider.calls.length === 1, "failing resolver");
  for (const full of [false, true]) {
    assert.equal((await provider.get(open.payload.request_id, full)).status, 404);
  }
  await assertPendingConflict(provider, open);
  provider.release(true);
  const failed = await first;
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "injected resolver failure after reservation" });
  for (const full of [false, true]) {
    const hidden = await provider.get(open.payload.request_id, full);
    assert.equal(hidden.status, 404);
    assert.deepEqual(await hidden.json(), { error: "unknown request_id" });
  }
  const different = await provider.open({ request_id: open.payload.request_id });
  for (const duplicate of [open, different]) assert.equal((await provider.post(duplicate)).status, 409);
  assert.deepEqual(provider.calls, [open.payload.request_id]);
  provider.release(false);
  const fresh = await provider.open();
  const retry = await provider.post(fresh);
  assert.equal(retry.status, 200);
  await assertValidChain((await retry.json()).chain, fresh);
  assert.deepEqual(provider.calls, [open.payload.request_id, fresh.payload.request_id]);
});

test("H4: existing validation and business rejections do not reserve IDs", async (t) => {
  const provider = await controlledProvider(t);
  provider.release();
  const cases = [
    ["signature", (env) => { env.signature = "ed25519:" + "0".repeat(128); }],
    ["hash", (env) => { env.payload.item_id = "tampered"; }],
    ["type", { type: "other" }],
    ["status", { status: "PENDING" }],
    ["provider", { provider_id: "did:key:wrong-provider" }],
    ["consumer", { consumer: { id: "did:key:wrong-consumer" } }],
    ["license", { license_type: "unknown" }],
    ["terms", { terms_hash: "sha256:" + "f".repeat(64) }],
    ["item", { item_id: "unknown" }],
  ];
  for (const [index, [name, invalid]] of cases.entries()) {
    const valid = await provider.open();
    let rejected;
    if (typeof invalid === "function") {
      rejected = structuredClone(valid);
      invalid(rejected);
    } else {
      rejected = await provider.open({ request_id: valid.payload.request_id, ...invalid });
    }
    assert.equal((await provider.post(rejected)).status, 400, name);
    assert.equal(provider.calls.length, index, name);
    const accepted = await provider.post(valid);
    assert.equal(accepted.status, 200, name);
    await assertValidChain((await accepted.json()).chain, valid);
  }
  assert.equal(provider.calls.length, cases.length);
  assert.equal(new Set(provider.calls).size, cases.length);
});

test("H4: different IDs reach the resolver concurrently and publish independent chains", async (t) => {
  const provider = await controlledProvider(t);
  const opens = await Promise.all(Array.from({ length: 3 }, () => provider.open()));
  const requests = opens.map((open) => provider.post(open));
  await waitUntil(() => provider.calls.length === opens.length, "three concurrent resolver calls");
  assert.deepEqual([...provider.calls].sort(), opens.map((open) => open.payload.request_id).sort());
  for (const open of opens) assert.equal((await provider.get(open.payload.request_id, true)).status, 404);
  provider.release();
  const responses = await Promise.all(requests);
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200);
    const { chain } = await response.json();
    await assertValidChain(chain, opens[index]);
    const full = await provider.get(opens[index].payload.request_id, true);
    assert.equal(full.status, 200);
    assert.deepEqual(await full.json(), { chain });
    const latest = await provider.get(opens[index].payload.request_id);
    assert.equal(latest.status, 200);
    assert.deepEqual(await latest.json(), chain[2]);
  }
});

// ── Happy-path sanity fixture ─────────────────────────────────────────────

test("happy path: valid OPEN returns 200 + 3-envelope chain", async () => {
  const { env } = await makeOpen();
  const res = await postRequest(env);
  assert.equal(res.status, 200);
  const { chain } = await res.json();
  assert.equal(chain.length, 3);
  assert.equal(chain[0].payload.type, "license.request");
  assert.equal(chain[1].payload.status, "PENDING");
  assert.equal(chain[2].payload.status, "GRANTED");
});

// ── Rejection branches ────────────────────────────────────────────────────

test("rejects tampered signature", async () => {
  const { env } = await makeOpen();
  const sigHex = env.signature.slice("ed25519:".length);
  env.signature = "ed25519:" + (sigHex[0] === "0" ? "1" : "0") + sigHex.slice(1);
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /invalid envelope/);
});

test("rejects tampered payload (hash mismatch)", async () => {
  const { env } = await makeOpen();
  env.payload.item_id = "sneaky-override";
  // Leave payload_hash unchanged — this is the tampering case.
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /invalid envelope/);
});

test("rejects wrong provider_id (replay-rejection)", async () => {
  // Recompute hash + sign so the envelope is otherwise internally valid;
  // only the business-level provider_id check should trip.
  const consumer = await generateKeyPair();
  const payload = {
    type: "license.request",
    request_id: uuidv7(),
    consumer: { id: consumer.did },
    provider_id: "did:key:z6MkNotTheRightProviderAtAllXxxxxxxxxxxxxxxxxx",
    item_id: itemId,
    license_type: licenseType,
    terms_hash: termsHash,
    status: "OPEN",
  };
  const env = await createEnvelope({
    payload,
    author: consumer.did,
    privateKey: consumer.privateKey,
  });
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /provider_id/);
  assert.match(error, /replay-rejection/);
});

test("rejects consumer.id mismatch with envelope.author", async () => {
  const impostor = await generateKeyPair();
  const consumer = await generateKeyPair();
  const payload = {
    type: "license.request",
    request_id: uuidv7(),
    consumer: { id: impostor.did }, // claims someone else
    provider_id: providerDid,
    item_id: itemId,
    license_type: licenseType,
    terms_hash: termsHash,
    status: "OPEN",
  };
  // Sign with the real consumer's key — author will be consumer.did,
  // but payload.consumer.id points at impostor.did.
  const env = await createEnvelope({
    payload,
    author: consumer.did,
    privateKey: consumer.privateKey,
  });
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /OPEN author must equal payload.consumer.id/);
});

test("rejects unknown license_type", async () => {
  const { env } = await makeOpen({ license_type: "enterprise-gold" });
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /unknown license_type/);
});

test("rejects terms_hash mismatch", async () => {
  const { env } = await makeOpen({ terms_hash: "sha256:" + "f".repeat(64) });
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /terms_hash mismatch/);
});

test("rejects unknown item_id", async () => {
  const { env } = await makeOpen({ item_id: "does-not-exist@9.9" });
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /unknown item_id/);
});

test("rejects non-OPEN status on license.request payload", async () => {
  // Craft a license.request with status: "PENDING" — the provider only
  // accepts OPEN on this endpoint.
  const consumer = await generateKeyPair();
  const payload = {
    type: "license.request",
    request_id: uuidv7(),
    consumer: { id: consumer.did },
    provider_id: providerDid,
    item_id: itemId,
    license_type: licenseType,
    terms_hash: termsHash,
    status: "PENDING",
  };
  const env = await createEnvelope({
    payload,
    author: consumer.did,
    privateKey: consumer.privateKey,
  });
  const res = await postRequest(env);
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /type\/status not license\.request\/OPEN/);
});

test("rejects duplicate request_id (one-shot replay protection)", async () => {
  const { env } = await makeOpen();
  const first = await postRequest(env);
  assert.equal(first.status, 200);
  const second = await postRequest(env);
  assert.equal(second.status, 409);
  const { error } = await second.json();
  assert.match(error, /already seen/);
});

test("rejects empty body with 400", async () => {
  const res = await fetch(`${ORIGIN}/api/proofmeta/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.status, 400);
  const { error } = await res.json();
  assert.match(error, /empty body/);
});

// ── GET-side coverage ─────────────────────────────────────────────────────

test("GET unknown request_id returns 404", async () => {
  const res = await fetch(`${ORIGIN}/api/proofmeta/request/${uuidv7()}`);
  assert.equal(res.status, 404);
  const { error } = await res.json();
  assert.match(error, /unknown request_id/);
});

test("GET ?full=true returns whole chain, default returns latest", async () => {
  const { env } = await makeOpen();
  const post = await postRequest(env);
  assert.equal(post.status, 200);
  const rid = env.payload.request_id;

  const latest = await fetch(`${ORIGIN}/api/proofmeta/request/${rid}`);
  assert.equal(latest.status, 200);
  const latestEnv = await latest.json();
  assert.equal(latestEnv.payload.status, "GRANTED");

  const full = await fetch(`${ORIGIN}/api/proofmeta/request/${rid}?full=true`);
  assert.equal(full.status, 200);
  const { chain } = await full.json();
  assert.equal(chain.length, 3);
});

test("unknown route returns 404", async () => {
  const res = await fetch(`${ORIGIN}/nope`);
  assert.equal(res.status, 404);
});
