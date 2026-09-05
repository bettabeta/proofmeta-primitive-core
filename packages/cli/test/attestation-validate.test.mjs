// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * The validator must accept attestations end-to-end (Phase 3): a single root
 * attestation, and an attestation history chain — routing the transitions
 * check by chain kind, the same way verifyChain does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateKeyPair, createEnvelope, createAttestation } from "@proofmeta/sdk-ts";
import { validateInput } from "../src/validate.mjs";

test("validate accepts a single root attestation", async () => {
  const a = await generateKeyPair();
  const att = await createAttestation({
    subject: { id: "claude-code@host" },
    policy: { ref: "https://pandr.de/policy/eu-only" },
    status: "DENIED",
    author: a.did,
    privateKey: a.privateKey,
    extras: { reason: "egress to US endpoint" },
  });
  const r = await validateInput(att);
  assert.equal(r.ok, true);
});

test("validate accepts an attestation history chain", async () => {
  const a = await generateKeyPair();
  const subject = { id: "cursor@host" };
  const policy = { ref: "https://pandr.de/policy/eu-only" };

  const e1 = await createAttestation({
    subject, policy, status: "GRANTED", author: a.did, privateKey: a.privateKey,
  });
  const e2 = await createAttestation({
    subject, policy, status: "DENIED", author: a.did, privateKey: a.privateKey,
    in_reply_to: e1.payload_hash, extras: { reason: "egress detected" },
  });
  const e3 = await createAttestation({
    subject, policy, status: "GRANTED", author: a.did, privateKey: a.privateKey,
    in_reply_to: e2.payload_hash,
  });

  const r = await validateInput([e1, e2, e3]);
  assert.equal(r.ok, true, JSON.stringify({ chain: r.chain, transitions: r.transitions }));
  assert.equal(r.transitions.ok, true);
});

test("validate rejects a signed status.update containing request_id and subject", async () => {
  const authority = await generateKeyPair();
  const envelope = await createEnvelope({
    payload: {
      type: "status.update",
      request_id: "01JZKYH3M2GQ3XN6F1ABCDEFGH",
      subject: { id: "claude-code@host" },
      status: "GRANTED",
    },
    author: authority.did,
    privateKey: authority.privateKey,
  });

  const r = await validateInput(envelope);
  assert.equal(r.envelopes[0].hash.ok, true);
  assert.equal(r.envelopes[0].signature.ok, true);
  assert.equal(r.envelopes[0].schema.ok, false, "request_id and subject must not share a status.update mode");
  assert.equal(r.ok, false);
});
