// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ed25519 from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

import {
  createAttestation,
  createEnvelope,
  generateKeyPair,
  hashPayload,
  jcs,
  verifyChain,
  verifyEnvelope,
} from "../dist/index.js";

const vectors = JSON.parse(
  readFileSync(
    new URL("../../spec/test-vectors/envelope-signing-v1.json", import.meta.url),
    "utf8",
  ),
);
const vector = (id) => vectors.cases.find((entry) => entry.id === id);
const encoder = new TextEncoder();

function clone(value) {
  return structuredClone(value);
}

async function legacyEnvelope({ in_reply_to } = {}) {
  const signer = await generateKeyPair();
  const envelope = await createEnvelope({
    payload: { type: "test.vector", value: "authenticated payload" },
    author: signer.did,
    privateKey: signer.privateKey,
    timestamp: "2026-09-04T12:00:00.000Z",
    ...(in_reply_to === undefined ? {} : { in_reply_to }),
  });
  return { envelope, signer };
}

// The fixture is language-neutral: all cryptographic inputs and outputs are
// strings/JSON, and this test derives every redundant field independently.
test("D16 deterministic vectors are internally consistent", async () => {
  for (const entry of vectors.cases) {
    assert.equal(jcs(entry.envelope.payload), entry.payload_jcs, entry.id);
    assert.equal(hashPayload(entry.envelope.payload), entry.payload_hash, entry.id);

    const projection = {
      proofmeta: entry.envelope.proofmeta,
      payload_hash: entry.envelope.payload_hash,
      author: entry.envelope.author,
      timestamp: entry.envelope.timestamp,
      ...(entry.envelope.in_reply_to === undefined
        ? {}
        : { in_reply_to: entry.envelope.in_reply_to }),
    };
    const canonical = jcs(projection);
    assert.deepEqual(projection, entry.signing_projection, entry.id);
    assert.equal(canonical, entry.signing_projection_jcs, entry.id);
    assert.equal(bytesToHex(encoder.encode(canonical)), entry.signing_bytes_hex, entry.id);

    const publicKey = hexToBytes(vectors.identities[entry.signer].public_key_hex);
    const signature = hexToBytes(entry.signature.slice("ed25519:".length));
    assert.equal(await ed25519.verifyAsync(signature, encoder.encode(canonical), publicKey), true, entry.id);
  }

  const root = vector("manifest-provider-root");
  const rootKey = hexToBytes(vectors.identities[root.signer].public_key_hex);
  const rootSignature = hexToBytes(root.signature.slice("ed25519:".length));
  for (const [field, value] of [
    ["proofmeta", "1.1"],
    ["payload_hash", "sha256:" + "ff".repeat(32)],
    ["author", vectors.identities.consumer.did],
    ["timestamp", "2030-01-01T00:00:00.000Z"],
  ]) {
    const mutatedProjection = { ...root.signing_projection, [field]: value };
    assert.equal(
      await ed25519.verifyAsync(rootSignature, encoder.encode(jcs(mutatedProjection)), rootKey),
      false,
      `root projection mutation must invalidate signature: ${field}`,
    );
  }

  const nonRoot = vector("license-pending-provider-non-root");
  const nonRootKey = hexToBytes(vectors.identities[nonRoot.signer].public_key_hex);
  const nonRootSignature = hexToBytes(nonRoot.signature.slice("ed25519:".length));
  assert.equal(
    await ed25519.verifyAsync(
      nonRootSignature,
      encoder.encode(
        jcs({ ...nonRoot.signing_projection, in_reply_to: "sha256:" + "ee".repeat(32) }),
      ),
      nonRootKey,
    ),
    false,
    "non-root projection mutation must invalidate signature: in_reply_to",
  );

  const legacy = vectors.legacy_payload_hash_only;
  const legacyPublicKey = hexToBytes(vectors.identities[legacy.signer].public_key_hex);
  assert.equal(
    await ed25519.verifyAsync(
      hexToBytes(legacy.signature.slice("ed25519:".length)),
      encoder.encode(legacy.signing_input),
      legacyPublicKey,
    ),
    true,
  );
});

test("D16 0.3 verifier accepts a root projection-signature vector", async () => {
  const result = await verifyEnvelope(clone(vector("manifest-provider-root").envelope));
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
});

test("D16 0.3 verifier accepts a non-root projection-signature vector", async () => {
  const result = await verifyEnvelope(clone(vector("license-pending-provider-non-root").envelope));
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
});

test("D16 timestamp mutation invalidates an otherwise unchanged signature", async () => {
  const { envelope } = await legacyEnvelope();
  const mutated = { ...envelope, timestamp: "2030-01-01T00:00:00.000Z" };
  const result = await verifyEnvelope(mutated);
  assert.equal(result.ok, false, "timestamp must be authenticated by the envelope signature");
});

test("D16 in_reply_to mutation invalidates an otherwise unchanged signature", async () => {
  const { envelope } = await legacyEnvelope({ in_reply_to: "sha256:" + "11".repeat(32) });
  const mutated = { ...envelope, in_reply_to: "sha256:" + "22".repeat(32) };
  const result = await verifyEnvelope(mutated);
  assert.equal(result.ok, false, "in_reply_to must be authenticated by the envelope signature");
});

test("D16 author mutation is cryptographically rejected even when a resolver returns the same key", async () => {
  const signer = await generateKeyPair();
  const envelope = await createEnvelope({
    payload: { type: "test.vector", value: "author binding" },
    author: "did:web:honest.example",
    privateKey: signer.privateKey,
    timestamp: "2026-09-04T12:01:00.000Z",
  });
  const mutated = { ...envelope, author: "did:web:attacker.example" };
  const result = await verifyEnvelope(mutated, { resolveAuthor: () => signer.publicKey });
  assert.equal(result.ok, false, "author must be present in the signed projection, not only used for key lookup");
});

test("D16 protocol-version mutation is rejected", async () => {
  const { envelope } = await legacyEnvelope();
  const result = await verifyEnvelope({ ...envelope, proofmeta: "1.1" });
  assert.equal(result.ok, false);
});

test("D16 payload_hash mutation is rejected", async () => {
  const { envelope } = await legacyEnvelope();
  const result = await verifyEnvelope({ ...envelope, payload_hash: "sha256:" + "ff".repeat(32) });
  assert.equal(result.ok, false);
});

test("D16 0.3 verifier rejects a legacy payload-hash-only signature", async () => {
  const result = await verifyEnvelope(clone(vectors.legacy_payload_hash_only.envelope));
  assert.equal(result.ok, false, "0.3 verification must not downgrade to the 0.2 payload-hash-only rule");
});

test("D18 rejects a manifest whose author differs from payload.provider.id", async () => {
  const result = await verifyEnvelope(clone(vector("manifest-provider-mismatch").envelope));
  assert.equal(result.ok, false);
  assert.match(result.reason, /author.*provider|provider.*author/i);
});

test("D18 rejects an OPEN whose author differs from payload.consumer.id", async () => {
  const result = await verifyChain([clone(vector("license-open-consumer-mismatch").envelope)]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /author.*consumer|consumer.*author/i);
});

test("D18 rejects a cryptographically valid resolver-signed license status", async () => {
  const result = await verifyChain([
    clone(vector("license-open-consumer-root").envelope),
    clone(vector("license-pending-resolver-non-root").envelope),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /status.*author|author.*provider|provider.*author/i);
});

test("D18 root attestations remain valid under the asserting authority signer", async () => {
  const authority = await generateKeyPair();
  const attestation = await createAttestation({
    subject: { id: "scanner@host-1" },
    policy: { ref: "https://authority.example/policy/v1" },
    status: "GRANTED",
    author: authority.did,
    privateKey: authority.privateKey,
    timestamp: "2026-09-04T12:02:00.000Z",
  });
  const result = await verifyChain([attestation]);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
});

test("D17 anchors may be added and removed without changing Tier-1 signature validity", async () => {
  const { envelope } = await legacyEnvelope();
  const withAnchors = {
    ...envelope,
    anchors: [{ type: "rfc3161", reference: "blob:deterministic-test-anchor" }],
  };
  const removedAgain = { ...withAnchors };
  delete removedAgain.anchors;

  for (const candidate of [envelope, withAnchors, removedAgain]) {
    const result = await verifyEnvelope(candidate);
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
  }
});
