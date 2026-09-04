// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPair,
  createEnvelope,
  hashPayload,
} from "@proofmeta/sdk-ts";

import { validateInput } from "../src/validate.mjs";

// ── Helpers ────────────────────────────────────────────────────────────

async function validManifestEnvelope() {
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
  return { env, kp };
}

async function validRequestChain() {
  const provider = await generateKeyPair();
  const consumer = await generateKeyPair();
  const requestId = "01850000-0000-7000-8000-000000000001";
  const itemId = "sku-1";
  const licenseType = "free";
  const termsHash = "sha256:" + "a".repeat(64);

  const openEnv = await createEnvelope({
    payload: {
      type: "license.request",
      request_id: requestId,
      consumer: { id: consumer.did },
      provider_id: provider.did,
      item_id: itemId,
      license_type: licenseType,
      terms_hash: termsHash,
      status: "OPEN",
    },
    author: consumer.did,
    privateKey: consumer.privateKey,
  });

  const pendingEnv = await createEnvelope({
    payload: {
      type: "status.update",
      request_id: requestId,
      status: "PENDING",
    },
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: openEnv.payload_hash,
  });

  const grantedEnv = await createEnvelope({
    payload: {
      type: "status.update",
      request_id: requestId,
      status: "GRANTED",
      license: {
        license_type: licenseType,
        terms_url: "https://example.test/terms",
        terms_hash: termsHash,
      },
    },
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: pendingEnv.payload_hash,
  });

  return Object.assign([openEnv, pendingEnv, grantedEnv], { provider, consumer });
}

// ── Tests ──────────────────────────────────────────────────────────────

test("valid single envelope passes all checks", async () => {
  const { env } = await validManifestEnvelope();
  const report = await validateInput(env);
  assert.equal(report.ok, true);
  assert.equal(report.kind, "envelope");
  assert.equal(report.envelopes.length, 1);
  const r = report.envelopes[0];
  assert.equal(r.schema.ok, true);
  assert.equal(r.hash.ok, true);
  assert.equal(r.signature.ok, true);
  assert.equal(r.payload_type, "manifest");
});

test("fails schema when required fields are missing", async () => {
  const { env } = await validManifestEnvelope();
  // drop an envelope-level required field
  const broken = { ...env };
  delete broken.author;
  const report = await validateInput(broken);
  assert.equal(report.ok, false);
  assert.equal(report.envelopes[0].schema.ok, false);
  assert.ok(
    report.envelopes[0].schema.errors.some((e) => /author/.test(e)),
    `expected an error mentioning 'author', got: ${report.envelopes[0].schema.errors.join(" | ")}`,
  );
});

test("rejects an externally supplied empty anchors array", async () => {
  const { env } = await validManifestEnvelope();
  const broken = { ...env, anchors: [] };
  const report = await validateInput(broken);
  assert.equal(report.ok, false);
  assert.equal(report.envelopes[0].schema.ok, false);
  assert.ok(
    report.envelopes[0].schema.errors.some((e) => /anchors|minItems|fewer than 1/.test(e)),
    `expected an anchors minItems error, got: ${report.envelopes[0].schema.errors.join(" | ")}`,
  );
});

test("fails payload schema for invalid manifest (no catalog_endpoint and no items)", async () => {
  const { env } = await validManifestEnvelope();
  // Build a structurally-valid envelope but mutate payload after the fact.
  const mutatedPayload = { ...env.payload };
  delete mutatedPayload.catalog_endpoint;
  const broken = {
    ...env,
    payload: mutatedPayload,
    payload_hash: hashPayload(mutatedPayload),
  };
  const report = await validateInput(broken);
  assert.equal(report.ok, false);
  assert.equal(report.envelopes[0].schema.ok, false);
  // Signature will fail too (we didn't re-sign) — hash should succeed because
  // we recomputed it. That's fine; we only care the schema flagged the
  // missing oneOf.
  assert.ok(
    report.envelopes[0].schema.errors.some((e) => /payload/.test(e)),
    `expected payload schema error, got: ${report.envelopes[0].schema.errors.join(" | ")}`,
  );
});

test("detects payload_hash tampering", async () => {
  const { env } = await validManifestEnvelope();
  const broken = {
    ...env,
    payload: { ...env.payload, request_endpoint: "https://evil.test/request" },
    // payload_hash left unchanged on purpose
  };
  const report = await validateInput(broken);
  assert.equal(report.ok, false);
  assert.equal(report.envelopes[0].hash.ok, false);
  assert.match(report.envelopes[0].hash.reason, /mismatch/);
});

test("detects signature tampering", async () => {
  const { env } = await validManifestEnvelope();
  // flip a hex nibble in the signature
  const sigHex = env.signature.slice("ed25519:".length);
  const flipped =
    "ed25519:" + (sigHex[0] === "0" ? "1" : "0") + sigHex.slice(1);
  const broken = { ...env, signature: flipped };
  const report = await validateInput(broken);
  assert.equal(report.ok, false);
  assert.equal(report.envelopes[0].signature.ok, false);
});

test("valid chain: OPEN → PENDING → GRANTED verifies end-to-end", async () => {
  const chain = await validRequestChain();
  const report = await validateInput(chain);
  assert.equal(report.ok, true);
  assert.equal(report.kind, "chain");
  assert.equal(report.envelopes.length, 3);
  assert.equal(report.chain.ok, true);
  assert.deepEqual(
    report.envelopes.map((r) => r.payload_type),
    ["license.request", "status.update", "status.update"],
  );
});

test("broken in_reply_to in chain is detected", async () => {
  const chain = await validRequestChain();
  const { provider } = chain;

  // Re-sign the middle envelope with a valid key but wrong in_reply_to.
  const middle = await createEnvelope({
    payload: chain[1].payload,
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: "sha256:" + "f".repeat(64),
  });

  const broken = [chain[0], middle, chain[2]];
  const report = await validateInput(broken);
  assert.equal(report.ok, false);
  assert.equal(report.envelopes[1].schema.ok, true);
  assert.equal(report.envelopes[1].signature.ok, true);
  assert.equal(report.chain.ok, false);
  assert.match(report.chain.reason, /in_reply_to/);
});

test("report fields are stable for JSON output consumers", async () => {
  const { env } = await validManifestEnvelope();
  const report = await validateInput(env);
  assert.equal(typeof report.ok, "boolean");
  assert.equal(Array.isArray(report.envelopes), true);
  for (const r of report.envelopes) {
    assert.equal(typeof r.index, "number");
    assert.equal(typeof r.ok, "boolean");
    assert.equal(typeof r.schema.ok, "boolean");
    assert.equal(Array.isArray(r.schema.errors), true);
    assert.equal(typeof r.hash.ok, "boolean");
    assert.equal(typeof r.signature.ok, "boolean");
  }
});
