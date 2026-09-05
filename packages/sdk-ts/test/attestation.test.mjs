// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPair,
  createEnvelope,
  createAttestation,
  verifyEnvelope,
  verifyChain,
  statusFromEnvelope,
  validateAttestationChain,
} from "../dist/index.js";

// Build a signed re-evaluation history for one subject: each verdict links to
// the previous via in_reply_to.
async function attestationHistory(authority, subject, policy, statuses) {
  const chain = [];
  let prev;
  for (const s of statuses) {
    const env = await createAttestation({
      subject,
      policy,
      status: s.status,
      author: authority.did,
      privateKey: authority.privateKey,
      ...(prev ? { in_reply_to: prev.payload_hash } : {}),
      ...(s.reason ? { extras: { reason: s.reason } } : {}),
    });
    chain.push(env);
    prev = env;
  }
  return chain;
}

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

// ── Attestation history chains (Phase 2) ───────────────────────────────────

test("verifyChain accepts a free-flowing verdict history (GRANTED → DENIED → GRANTED)", async () => {
  const authority = await generateKeyPair();
  const subject = { id: "claude-code@host-42" };
  const policy = { ref: "https://pandr.de/policy/eu-only" };

  const chain = await attestationHistory(authority, subject, policy, [
    { status: "GRANTED" },
    { status: "DENIED", reason: "egress to US endpoint" },
    { status: "GRANTED" },
  ]);

  const v = await verifyChain(chain);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
});

test("verifyChain detects a broken in_reply_to link in a verdict history", async () => {
  const authority = await generateKeyPair();
  const subject = { id: "cursor@host-7" };
  const policy = { ref: "https://pandr.de/policy/no-shell-exec" };

  const chain = await attestationHistory(authority, subject, policy, [
    { status: "GRANTED" },
    { status: "SUSPENDED", reason: "under review" },
  ]);
  // Corrupt the link of the second verdict.
  chain[1] = { ...chain[1], in_reply_to: "sha256:" + "0".repeat(64) };

  const v = await verifyChain(chain);
  assert.equal(v.ok, false);
});

test("verifyChain rejects a history where the subject changes mid-chain", async () => {
  const authority = await generateKeyPair();
  const policy = { ref: "https://pandr.de/policy/eu-only" };

  const a = await createAttestation({
    subject: { id: "claude-code@host-42" },
    policy,
    status: "GRANTED",
    author: authority.did,
    privateKey: authority.privateKey,
  });
  const b = await createAttestation({
    subject: { id: "DIFFERENT-tool@host-99" },
    policy,
    status: "DENIED",
    author: authority.did,
    privateKey: authority.privateKey,
    in_reply_to: a.payload_hash,
    extras: { reason: "switched subject" },
  });

  const v = await verifyChain([a, b]);
  assert.equal(v.ok, false, "subject must be constant across an attestation chain");
});

test("verifyChain rejects signed attestations missing policy or policy.ref", async () => {
  const authority = await generateKeyPair();
  const payloads = [
    {
      type: "status.update",
      subject: { id: "claude-code@host-42" },
      status: "GRANTED",
    },
    {
      type: "status.update",
      subject: { id: "claude-code@host-42" },
      policy: {},
      status: "GRANTED",
    },
  ];

  for (const payload of payloads) {
    const attestation = await createEnvelope({
      payload,
      author: authority.did,
      privateKey: authority.privateKey,
    });
    const v = await verifyChain([attestation]);
    assert.equal(v.ok, false, "attestation policy.ref must be required");
  }
});

test("verifyChain rejects an attestation history whose author changes", async () => {
  const rootAuthority = await generateKeyPair();
  const laterAuthority = await generateKeyPair();
  const subject = { id: "claude-code@host-42" };
  const policy = { ref: "https://pandr.de/policy/eu-only" };

  const root = await createAttestation({
    subject,
    policy,
    status: "GRANTED",
    author: rootAuthority.did,
    privateKey: rootAuthority.privateKey,
  });
  const later = await createAttestation({
    subject,
    policy,
    status: "DENIED",
    author: laterAuthority.did,
    privateKey: laterAuthority.privateKey,
    in_reply_to: root.payload_hash,
    extras: { reason: "authority changed" },
  });

  const v = await verifyChain([root, later]);
  assert.equal(v.ok, false, "attestation author must be constant across the chain");
});

test("validateAttestationChain rejects mixing a licensing verdict into an attestation chain", async () => {
  const authority = await generateKeyPair();
  const att = await createAttestation({
    subject: { id: "claude-code@host-42" },
    policy: { ref: "https://pandr.de/policy/eu-only" },
    status: "GRANTED",
    author: authority.did,
    privateKey: authority.privateKey,
  });
  // A Mode-A style status.update (request_id) does not belong in this chain.
  const licensing = {
    payload: { type: "status.update", request_id: "01JZ", status: "GRANTED" },
  };
  const r = validateAttestationChain([att, licensing]);
  assert.equal(r.ok, false);
});
