// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPair,
  createEnvelope,
  updateStatus,
  verifyChain,
  canTransition,
  validateStatusTransitions,
  getCurrentStatus,
  isCurrentlyValid,
  getValidityIntervals,
} from "../dist/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────

async function baseOpenChain() {
  const provider = await generateKeyPair();
  const consumer = await generateKeyPair();
  const requestId = "01JZKYH3M2GQ3XN6F1ABCDEFGH";

  const open = await createEnvelope({
    payload: {
      type: "license.request",
      request_id: requestId,
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

  const pending = await updateStatus(open, "PENDING", provider.did, provider.privateKey, {
    note: "payment in progress",
  });

  const granted = await updateStatus(pending, "GRANTED", provider.did, provider.privateKey, {
    delivery: { method: "https", url: "https://example.test/d/xyz" },
  });

  return { provider, consumer, requestId, open, pending, granted };
}

// ── Transition rules ──────────────────────────────────────────────────────

test("canTransition allows GRANTED → SUSPENDED → GRANTED → REVOKED", () => {
  assert.equal(canTransition("GRANTED", "SUSPENDED"), true);
  assert.equal(canTransition("SUSPENDED", "GRANTED"), true);
  assert.equal(canTransition("SUSPENDED", "REVOKED"), true);
  assert.equal(canTransition("GRANTED", "REVOKED"), true);
});

test("canTransition rejects illegal transitions", () => {
  assert.equal(canTransition("REVOKED", "GRANTED"), false);
  assert.equal(canTransition("REVOKED", "SUSPENDED"), false);
  assert.equal(canTransition("SUSPENDED", "PENDING"), false);
  assert.equal(canTransition("GRANTED", "PENDING"), false);
  assert.equal(canTransition("DENIED", "GRANTED"), false);
});

// ── Full chain verification ─────────────────────────────────────────────────

test("verifyChain accepts suspend → reinstate with full history", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();

  const suspended = await updateStatus(granted, "SUSPENDED", provider.did, provider.privateKey, {
    reason: "pending compliance review",
  });

  const reinstated = await updateStatus(suspended, "GRANTED", provider.did, provider.privateKey, {
    note: "review cleared",
  });

  const chain = [open, pending, granted, suspended, reinstated];
  const v = await verifyChain(chain);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
  assert.equal(chain.length, 5);
  assert.equal(getCurrentStatus(chain), "GRANTED");
});

test("verifyChain accepts GRANTED → REVOKED with reason", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();

  const revoked = await updateStatus(granted, "REVOKED", provider.did, provider.privateKey, {
    reason: "terms violation",
  });

  const v = await verifyChain([open, pending, granted, revoked]);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
  assert.equal(getCurrentStatus([open, pending, granted, revoked]), "REVOKED");
});

test("verifyChain accepts SUSPENDED → REVOKED escalation", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();

  const suspended = await updateStatus(granted, "SUSPENDED", provider.did, provider.privateKey, {
    reason: "under review",
  });
  const revoked = await updateStatus(suspended, "REVOKED", provider.did, provider.privateKey, {
    reason: "review failed",
  });

  const v = await verifyChain([open, pending, granted, suspended, revoked]);
  assert.equal(v.ok, true, v.ok ? "" : v.reason);
});

test("verifyChain rejects SUSPENDED without reason", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();

  const suspended = await createEnvelope({
    payload: {
      type: "status.update",
      request_id: open.payload.request_id,
      status: "SUSPENDED",
    },
    author: provider.did,
    privateKey: provider.privateKey,
    in_reply_to: granted.payload_hash,
  });

  const v = await verifyChain([open, pending, granted, suspended]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /reason/);
});

test("verifyChain rejects REVOKED → anything", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();

  const revoked = await updateStatus(granted, "REVOKED", provider.did, provider.privateKey, {
    reason: "done",
  });
  const illegal = await updateStatus(revoked, "GRANTED", provider.did, provider.privateKey);

  const v = await verifyChain([open, pending, granted, revoked, illegal]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /illegal status transition/);
});

test("verifyChain rejects SUSPENDED → PENDING", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();

  const suspended = await updateStatus(granted, "SUSPENDED", provider.did, provider.privateKey, {
    reason: "hold",
  });
  const illegal = await updateStatus(suspended, "PENDING", provider.did, provider.privateKey);

  const v = await verifyChain([open, pending, granted, suspended, illegal]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /illegal status transition/);
});

test("validateStatusTransitions preserves prior GRANTED in validity intervals", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();

  const suspended = await updateStatus(granted, "SUSPENDED", provider.did, provider.privateKey, {
    reason: "audit",
  });
  const reinstated = await updateStatus(suspended, "GRANTED", provider.did, provider.privateKey);

  const chain = [open, pending, granted, suspended, reinstated];
  const intervals = getValidityIntervals(chain);

  assert.equal(intervals.length, 2);
  assert.equal(intervals[0].grant_hash, granted.payload_hash);
  assert.equal(intervals[0].until, suspended.timestamp);
  assert.equal(intervals[1].grant_hash, reinstated.payload_hash);
  assert.equal(intervals[1].until, null);
});

// ── Current validity ────────────────────────────────────────────────────────

test("isCurrentlyValid is false for SUSPENDED and true after reinstate", async () => {
  const { provider, open, pending, granted } = await baseOpenChain();
  const fullGranted = [open, pending, granted];
  assert.equal(isCurrentlyValid(fullGranted), true);

  const suspended = await updateStatus(granted, "SUSPENDED", provider.did, provider.privateKey, {
    reason: "pause",
  });
  const suspendedChain = [open, pending, granted, suspended];
  assert.equal(isCurrentlyValid(suspendedChain), false);

  const reinstated = await updateStatus(suspended, "GRANTED", provider.did, provider.privateKey);
  assert.equal(isCurrentlyValid([...suspendedChain, reinstated]), true);
});

test("isCurrentlyValid derives expiry from valid_until, not a status", async () => {
  const provider = await generateKeyPair();
  const consumer = await generateKeyPair();

  const open = await createEnvelope({
    payload: {
      type: "license.request",
      request_id: "req-exp",
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
  const pending = await updateStatus(open, "PENDING", provider.did, provider.privateKey);
  const granted = await updateStatus(pending, "GRANTED", provider.did, provider.privateKey, {
    valid_until: "2020-01-01T00:00:00Z",
  });

  const chain = [open, pending, granted];
  assert.equal(getCurrentStatus(chain), "GRANTED");
  assert.equal(isCurrentlyValid(chain), false);
  assert.equal(isCurrentlyValid(chain, new Date("2019-06-01T00:00:00Z")), true);
});
