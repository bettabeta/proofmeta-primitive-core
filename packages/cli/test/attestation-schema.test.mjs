// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Backward-compatibility proof for the status.update two-mode schema (§3.4).
 *
 * The schema accepts EITHER a chained verdict (request_id, Mode A) OR a root
 * attestation (subject + policy, Mode B), via oneOf. These tests assert that:
 *   1. existing licensing verdicts (request_id) still validate — unchanged;
 *   2. new attestations (subject + policy) validate — new capability;
 *   3. a payload with NEITHER is still rejected — strictness preserved (this is
 *      the proof we did not merely make request_id optional);
 *   4. a payload with BOTH is rejected — clean mode separation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { statusUpdatePayloadSchema } from "@proofmeta/spec";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(statusUpdatePayloadSchema);

test("Mode A — existing licensing verdict (request_id) still validates", () => {
  const ok = validate({
    type: "status.update",
    request_id: "01JZKYH3M2GQ3XN6F1ABCDEFGH",
    status: "GRANTED",
  });
  assert.equal(ok, true, ajv.errorsText(validate.errors));
});

test("Mode B — root attestation (subject + policy) validates", () => {
  const ok = validate({
    type: "status.update",
    status: "DENIED",
    subject: { id: "claude-code@host-42", host: "macbook-daud" },
    policy: { ref: "https://pandr.de/policy/eu-only", scope: ["eu-residency-required"] },
    reason: "Egress to api.openai.com (US)",
    evidence: { score: 65, factors: ["egress-non-eu", "holds-credentials"] },
  });
  assert.equal(ok, true, ajv.errorsText(validate.errors));
});

test("NEITHER request_id nor subject is still REJECTED (strictness preserved)", () => {
  const ok = validate({
    type: "status.update",
    status: "GRANTED",
  });
  assert.equal(ok, false, "a status.update with neither mode's keys must be rejected");
});

test("BOTH request_id and subject/policy is REJECTED (mode separation)", () => {
  const ok = validate({
    type: "status.update",
    status: "GRANTED",
    request_id: "01JZKYH3M2GQ3XN6F1ABCDEFGH",
    subject: { id: "claude-code@host-42" },
    policy: { ref: "https://pandr.de/policy/eu-only" },
  });
  assert.equal(ok, false, "a status.update must not mix Mode A and Mode B");
});

test("Mode B requires policy when subject is present", () => {
  const ok = validate({
    type: "status.update",
    status: "DENIED",
    subject: { id: "claude-code@host-42" },
  });
  assert.equal(ok, false, "subject without policy is neither a valid Mode A nor Mode B payload");
});
