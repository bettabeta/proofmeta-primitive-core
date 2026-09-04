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
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  generateKeyPair,
  createEnvelope,
  hashPayload,
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
