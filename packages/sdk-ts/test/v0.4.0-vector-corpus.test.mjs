// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { verifyChain, verifyEnvelope } from "../dist/index.js";

const corpusDirectory = new URL("../../spec/vectors/", import.meta.url);

const reasonByCode = Object.freeze({
  INVALID_SIGNATURE: "invalid ed25519 signature",
  MISSING_TIMESTAMP: "envelope.timestamp must be a string",
  MANIFEST_AUTHOR_MISMATCH: "manifest author must equal payload.provider.id",
  OPEN_AUTHOR_MISMATCH: "OPEN author must equal payload.consumer.id",
  STATUS_AUTHOR_MISMATCH:
    "envelope[1] license status author must equal root OPEN payload.provider_id",
  MISSING_PROVIDER_ID: "root OPEN envelope must have a valid provider_id DID string",
  ATTESTATION_POLICY_REQUIRED:
    "envelope[0]: attestation policy.ref must be a non-empty string",
  ATTESTATION_AUTHOR_MISMATCH:
    "envelope[1]: attestation author must equal root author",
  STATUS_UPDATE_MODE_MIXED:
    "envelope[0]: status.update must use exactly one mode: request_id only (Mode A) or subject + policy only (Mode B)",
});

test("ProofMeta v0.4.0 corpus vectors match SDK verification results", async () => {
  const vectorFiles = readdirSync(corpusDirectory)
    .filter((name) => name.endsWith(".json") && name !== "keys.json")
    .sort();

  assert.equal(vectorFiles.length, 15, "the corpus must contain exactly 15 vectors");

  const seenIds = new Set();
  for (const file of vectorFiles) {
    const vector = JSON.parse(readFileSync(new URL(file, corpusDirectory), "utf8"));
    assert.deepEqual(Object.keys(vector), ["id", "description", "input", "expect"], file);
    assert.equal(typeof vector.id, "string", file);
    assert.equal(seenIds.has(vector.id), false, `duplicate vector id: ${vector.id}`);
    seenIds.add(vector.id);

    const result = Array.isArray(vector.input)
      ? await verifyChain(structuredClone(vector.input))
      : await verifyEnvelope(structuredClone(vector.input));

    assert.equal(result.ok, vector.expect.valid, vector.id);
    if (!vector.expect.valid) {
      assert.equal(typeof vector.expect.reason, "string", `${vector.id}: missing reason code`);
      assert.equal(
        result.reason,
        reasonByCode[vector.expect.reason],
        `${vector.id}: unexpected SDK reason for ${vector.expect.reason}`,
      );
    }
  }
});
