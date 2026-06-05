// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Core validation logic. Kept independent of argv parsing so tests can
 * drive it directly with parsed JSON values.
 *
 * Report shape:
 *   {
 *     ok: boolean,
 *     kind: "envelope" | "chain",
 *     envelopes: Array<EnvelopeReport>,
 *     chain?: { ok: boolean, reason?: string },
 *     transitions?: { ok: boolean, reason?: string },
 *   }
 *
 * Each envelope report:
 *   {
 *     index: number,
 *     ok: boolean,
 *     payload_type?: string,
 *     schema: { ok: boolean, errors: string[] },
 *     hash:   { ok: boolean, reason?: string },
 *     signature: { ok: boolean, reason?: string },
 *   }
 *
 * We recompute the hash and verify the signature via the SDK so this tool
 * and the reference SDK agree on what "valid" means.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  envelopeSchema,
  payloadSchemas,
} from "@proofmeta/spec";
import {
  hashPayload,
  hashesEqual,
  verifyEnvelope,
  verifyChain,
  validateStatusTransitions,
} from "@proofmeta/sdk-ts";

// Prepare a single Ajv instance with all known payload schemas compiled once.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateEnvelope = ajv.compile(envelopeSchema);
const payloadValidators = Object.fromEntries(
  Object.entries(payloadSchemas).map(([type, schema]) => [type, ajv.compile(schema)]),
);

const KNOWN_PAYLOAD_TYPES = Object.keys(payloadSchemas);

function ajvErrorsToStrings(errors) {
  if (!errors) return [];
  return errors.map((e) => {
    const path = e.instancePath || "(root)";
    return `${path} ${e.message ?? "invalid"}`;
  });
}

async function validateOne(env, index) {
  const report = {
    index,
    ok: false,
    payload_type: undefined,
    schema: { ok: false, errors: [] },
    hash: { ok: false },
    signature: { ok: false },
  };

  // 1. Envelope schema
  const envelopeOk = validateEnvelope(env);
  if (!envelopeOk) {
    report.schema.errors.push(...ajvErrorsToStrings(validateEnvelope.errors));
  }

  const payloadType =
    env && typeof env === "object" && env.payload && typeof env.payload === "object"
      ? env.payload.type
      : undefined;
  report.payload_type = typeof payloadType === "string" ? payloadType : undefined;

  // 2. Payload schema (only for known types)
  if (typeof payloadType === "string") {
    const validator = payloadValidators[payloadType];
    if (validator) {
      const payloadOk = validator(env.payload);
      if (!payloadOk) {
        report.schema.errors.push(
          ...ajvErrorsToStrings(validator.errors).map((s) => `payload ${s}`),
        );
      }
    } else {
      // Unknown payload types are allowed by the envelope schema (extension
      // payloads), but we flag them so the operator notices.
      report.schema.errors.push(
        `payload.type "${payloadType}" is not a known core type (${KNOWN_PAYLOAD_TYPES.join(", ")}); skipping payload schema check`,
      );
    }
  }

  report.schema.ok = report.schema.errors.length === 0;

  // If envelope itself is malformed, skip cryptographic checks — the
  // fields we need may not even exist.
  if (!envelopeOk) {
    return report;
  }

  // 3. Hash recomputation (independent of signature so we can show both).
  try {
    const recomputed = hashPayload(env.payload);
    if (hashesEqual(recomputed, env.payload_hash)) {
      report.hash.ok = true;
    } else {
      report.hash.reason = `payload_hash mismatch — envelope says ${env.payload_hash}, canonical payload hashes to ${recomputed}`;
    }
  } catch (err) {
    report.hash.reason = `hash computation failed: ${err.message}`;
  }

  // 4. Signature verification (delegates to SDK).
  try {
    const v = await verifyEnvelope(env);
    if (v.ok) {
      report.signature.ok = true;
    } else {
      report.signature.reason = v.reason;
    }
  } catch (err) {
    report.signature.reason = `signature verification threw: ${err.message}`;
  }

  report.ok = report.schema.ok && report.hash.ok && report.signature.ok;
  return report;
}

/**
 * Validate either a single envelope object or an array of envelopes (chain).
 */
export async function validateInput(input) {
  const isArray = Array.isArray(input);
  const envelopes = isArray ? input : [input];

  const envelopeReports = [];
  for (let i = 0; i < envelopes.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    envelopeReports.push(await validateOne(envelopes[i], i));
  }

  const allEnvelopesOk = envelopeReports.every((r) => r.ok);

  const report = {
    ok: allEnvelopesOk,
    kind: isArray ? "chain" : "envelope",
    envelopes: envelopeReports,
  };

  if (isArray) {
    if (!allEnvelopesOk) {
      report.chain = {
        ok: false,
        reason: "chain verification skipped because one or more envelopes failed individually",
      };
    } else {
      const c = await verifyChain(envelopes);
      report.chain = c.ok ? { ok: true } : { ok: false, reason: c.reason };
      const t = validateStatusTransitions(envelopes);
      report.transitions = t.ok ? { ok: true } : { ok: false, reason: t.reason };
      if (!report.chain.ok || !report.transitions.ok) report.ok = false;
    }
  }

  return report;
}

// ── Human-readable formatter ────────────────────────────────────────────

export function formatReport(report, filename) {
  const lines = [];
  const header = report.kind === "chain" ? "chain" : "envelope";
  lines.push(`proofmeta validate ${filename} — ${header} (${report.envelopes.length} envelope${report.envelopes.length === 1 ? "" : "s"})`);

  for (const r of report.envelopes) {
    const label = report.kind === "chain" ? `envelope[${r.index}]` : "envelope";
    const typeLabel = r.payload_type ? ` payload.type=${r.payload_type}` : "";
    lines.push(`  ${mark(r.ok)} ${label}${typeLabel}`);
    lines.push(`    ${mark(r.schema.ok)} schema`);
    for (const err of r.schema.errors) {
      lines.push(`        · ${err}`);
    }
    lines.push(`    ${mark(r.hash.ok)} payload_hash`);
    if (!r.hash.ok && r.hash.reason) lines.push(`        · ${r.hash.reason}`);
    lines.push(`    ${mark(r.signature.ok)} signature`);
    if (!r.signature.ok && r.signature.reason) lines.push(`        · ${r.signature.reason}`);
  }

  if (report.chain) {
    lines.push(`  ${mark(report.chain.ok)} chain integrity`);
    if (!report.chain.ok && report.chain.reason) {
      lines.push(`        · ${report.chain.reason}`);
    }
  }

  if (report.transitions) {
    lines.push(`  ${mark(report.transitions.ok)} status transitions`);
    if (!report.transitions.ok && report.transitions.reason) {
      lines.push(`        · ${report.transitions.reason}`);
    }
  }

  lines.push("");
  lines.push(report.ok ? "OK" : "FAIL");
  return lines.join("\n") + "\n";
}

function mark(ok) {
  return ok ? "[OK]  " : "[FAIL]";
}
