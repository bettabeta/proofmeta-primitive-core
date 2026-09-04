// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROOFMETA_PROTOCOL_VERSION,
  generateKeyPair,
  keyPairFromPrivate,
  createEnvelope,
  verifyEnvelope,
  verifyChain,
  encodeDidKey,
  decodeDidKey,
  isDidKeyEd25519,
  hashPayload,
  jcs,
} from "../dist/index.js";

// ── JCS / hashing ─────────────────────────────────────────────────────────

test("JCS canonicalizes object-key order", () => {
  const a = jcs({ b: 2, a: 1 });
  const b = jcs({ a: 1, b: 2 });
  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2}');
});

test("hashPayload is independent of key order", () => {
  const h1 = hashPayload({ x: 1, y: [2, 3], z: { b: 2, a: 1 } });
  const h2 = hashPayload({ z: { a: 1, b: 2 }, y: [2, 3], x: 1 });
  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[a-f0-9]{64}$/);
});

// ── did:key round-trip ────────────────────────────────────────────────────

test("did:key encode/decode round-trip", async () => {
  const kp = await generateKeyPair();
  assert.match(kp.did, /^did:key:z/);
  const decoded = decodeDidKey(kp.did);
  assert.equal(decoded.length, 32);
  assert.deepEqual(Array.from(decoded), Array.from(kp.publicKey));
  assert.equal(isDidKeyEd25519(kp.did), true);
});

test("did:key rejects non-did:key strings", () => {
  assert.throws(() => decodeDidKey("did:web:example.com"));
  assert.throws(() => decodeDidKey("not-a-did"));
  assert.equal(isDidKeyEd25519("did:web:example.com"), false);
});

test("keyPairFromPrivate derives the same did from the same seed", async () => {
  const kp1 = await generateKeyPair();
  const kp2 = await keyPairFromPrivate(kp1.privateKey);
  assert.equal(kp1.did, kp2.did);
  assert.deepEqual(Array.from(kp1.publicKey), Array.from(kp2.publicKey));
});

// ── Envelope sign/verify ──────────────────────────────────────────────────

test("createEnvelope + verifyEnvelope roundtrip (manifest)", async () => {
  const kp = await generateKeyPair();
  const payload = {
    type: "manifest",
    provider: { id: kp.did, name: "Test Provider" },
    request_endpoint: "https://example.test/request",
    catalog_endpoint: "https://example.test/catalog",
    license_types: [
      {
        id: "free",
        terms_url: "https://example.test/terms",
        terms_hash: "sha256:" + "0".repeat(64),
        scope: ["non-commercial", "attribution-required"],
      },
    ],
  };
  const env = await createEnvelope({
    payload,
    author: kp.did,
    privateKey: kp.privateKey,
  });
  assert.equal(env.proofmeta, PROOFMETA_PROTOCOL_VERSION);
  assert.equal(env.author, kp.did);
  assert.match(env.signature, /^ed25519:[a-f0-9]+$/);
  // anchors field is omitted when no anchors are supplied (Tier-1 default).
  assert.equal(env.anchors, undefined);

  const v = await verifyEnvelope(env);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
});

test("createEnvelope includes anchors when supplied", async () => {
  const kp = await generateKeyPair();
  const env = await createEnvelope({
    payload: { type: "manifest", provider: { id: kp.did } },
    author: kp.did,
    privateKey: kp.privateKey,
    anchors: [{ type: "rfc3161", reference: "blob:abc", authority: "https://tsa.test" }],
  });
  assert.ok(Array.isArray(env.anchors));
  assert.equal(env.anchors.length, 1);
  assert.equal(env.anchors[0].type, "rfc3161");

  const v = await verifyEnvelope(env);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
});

test("createEnvelope omits anchors when passed empty array", async () => {
  // Explicit [] behaves the same as undefined — canonical form stays minimal.
  const kp = await generateKeyPair();
  const env = await createEnvelope({
    payload: { type: "manifest" },
    author: kp.did,
    privateKey: kp.privateKey,
    anchors: [],
  });
  assert.equal(env.anchors, undefined);
});

test("verifyEnvelope detects tampered payload", async () => {
  const kp = await generateKeyPair();
  const env = await createEnvelope({
    payload: { type: "manifest", data: "original" },
    author: kp.did,
    privateKey: kp.privateKey,
  });
  env.payload.data = "tampered";
  const v = await verifyEnvelope(env);
  assert.equal(v.ok, false);
  assert.match(v.reason, /payload_hash/);
});

test("verifyEnvelope detects invalid signature", async () => {
  const kp = await generateKeyPair();
  const env = await createEnvelope({
    payload: { type: "manifest" },
    author: kp.did,
    privateKey: kp.privateKey,
  });
  // flip a hex digit in the signature
  const sig = env.signature;
  const mutated = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
  env.signature = mutated;
  const v = await verifyEnvelope(env);
  assert.equal(v.ok, false);
});

test("createEnvelope rejects mismatched key and author", async () => {
  const kpA = await generateKeyPair();
  const kpB = await generateKeyPair();
  await assert.rejects(
    createEnvelope({
      payload: { type: "manifest" },
      author: kpA.did,
      privateKey: kpB.privateKey,
    }),
    /does not match author DID/,
  );
});

// ── Lifecycle chain ───────────────────────────────────────────────────────

test("verifyChain accepts OPEN → PENDING → GRANTED", async () => {
  const provider = await generateKeyPair();
  const consumer = await generateKeyPair();

  const openEnv = await createEnvelope({
    payload: {
      type: "license.request",
      request_id: "01JZKYH3M2GQ3XN6F1ABCDEFGH",
      consumer: { id: consumer.did },
      provider_id: provider.did,
      item_id: "beat-001",
      license_type: "free",
      terms_hash: "sha256:" + "0".repeat(64),
      status: "OPEN",
    },
    author: consumer.did,
    privateKey: consumer.privateKey,
  });

  const pendingEnv = await createEnvelope({
    payload: {
      type: "status.update",
      request_id: "01JZKYH3M2GQ3XN6F1ABCDEFGH",
      status: "PENDING",
      note: "payment in progress",
    },
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: openEnv.payload_hash,
  });

  const grantedEnv = await createEnvelope({
    payload: {
      type: "status.update",
      request_id: "01JZKYH3M2GQ3XN6F1ABCDEFGH",
      status: "GRANTED",
      delivery: { method: "https", url: "https://example.test/d/xyz" },
    },
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: pendingEnv.payload_hash,
  });

  const v = await verifyChain([openEnv, pendingEnv, grantedEnv]);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
});

test("verifyChain rejects broken in_reply_to link", async () => {
  const provider = await generateKeyPair();
  const consumer = await generateKeyPair();

  const openEnv = await createEnvelope({
    payload: {
      type: "license.request",
      request_id: "req-1",
      consumer: { id: consumer.did },
      provider_id: provider.did,
      item_id: "x",
      license_type: "free",
      terms_hash: "sha256:" + "0".repeat(64),
      status: "OPEN",
    },
    author: consumer.did,
    privateKey: consumer.privateKey,
  });

  const badGranted = await createEnvelope({
    payload: { type: "status.update", request_id: "req-1", status: "GRANTED" },
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: "sha256:" + "d".repeat(64), // points to nowhere
  });

  const v = await verifyChain([openEnv, badGranted]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /in_reply_to/);
});

test("verifyChain rejects mismatched request_id", async () => {
  const provider = await generateKeyPair();
  const consumer = await generateKeyPair();

  const openEnv = await createEnvelope({
    payload: {
      type: "license.request",
      request_id: "req-A",
      consumer: { id: consumer.did },
      provider_id: provider.did,
      item_id: "x",
      license_type: "free",
      terms_hash: "sha256:" + "0".repeat(64),
      status: "OPEN",
    },
    author: consumer.did,
    privateKey: consumer.privateKey,
  });

  const wrongIdUpdate = await createEnvelope({
    payload: { type: "status.update", request_id: "req-B", status: "PENDING" },
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: openEnv.payload_hash,
  });

  const v = await verifyChain([openEnv, wrongIdUpdate]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /request_id/);
});

test("verifyChain rejects root with in_reply_to", async () => {
  const kp = await generateKeyPair();
  const env = await createEnvelope({
    payload: { type: "manifest", provider: { id: kp.did } },
    author: kp.did,
    privateKey: kp.privateKey,
    in_reply_to: "sha256:" + "a".repeat(64),
  });
  const v = await verifyChain([env]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /root/);
});
