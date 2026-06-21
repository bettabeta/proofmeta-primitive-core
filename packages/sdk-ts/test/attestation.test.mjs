// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPair,
  createAttestation,
  verifyEnvelope,
  statusFromEnvelope,
} from "../dist/index.js";

test("createAttestation builds a signed root status with subject + policy", async () => {
  const authority = await generateKeyPair();

  const att = await createAttestation({
    subject: { id: "claude-code@host-42", host: "macbook-daud" },
    policy: { ref: "https://pandr.de/policy/eu-only", scope: ["eu-residency-required"] },
    status: "DENIED",
    author: authority.did,
    privateKey: authority.privateKey,
    extras: { reason: "Egress to api.openai.com (US)" },
  });

  // It is an envelope ROOT — no in_reply_to, no request_id.
  assert.equal(att.in_reply_to, undefined);
  assert.equal(att.payload.request_id, undefined);
  assert.equal(att.payload.type, "status.update");
  assert.equal(att.payload.subject.id, "claude-code@host-42");
  assert.equal(att.payload.policy.ref, "https://pandr.de/policy/eu-only");

  // The verdict reuses the status vocabulary.
  assert.equal(statusFromEnvelope(att), "DENIED");

  // It verifies as a standalone signed envelope.
  const v = await verifyEnvelope(att);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
});

test("attestation signature is bound to its payload (tamper detection)", async () => {
  const authority = await generateKeyPair();
  const att = await createAttestation({
    subject: { id: "cursor@host-7" },
    policy: { ref: "https://pandr.de/policy/no-shell-exec" },
    status: "GRANTED",
    author: authority.did,
    privateKey: authority.privateKey,
  });

  // Tamper the verdict after signing → verification must fail.
  const tampered = { ...att, payload: { ...att.payload, status: "DENIED" } };
  const v = await verifyEnvelope(tampered);
  assert.equal(v.ok, false);
});
