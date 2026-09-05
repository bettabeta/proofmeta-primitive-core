// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * License status lifecycle — transitions, current status, and validity-over-time.
 * See PROOFMETA_ANWEISUNG.md §3.4.
 */

import type { AnyPayload, Envelope, ProofMetaStatus, Sha256Ref } from "./types.js";

/** Status values that may appear as the current state of a license lifecycle. */
export const PROOFMETA_STATUSES: readonly ProofMetaStatus[] = [
  "OPEN",
  "PENDING",
  "GRANTED",
  "DENIED",
  "SUSPENDED",
  "REVOKED",
] as const;

/** Terminal states — no further transitions are permitted. */
export const TERMINAL_STATUSES: readonly ProofMetaStatus[] = [
  "DENIED",
  "REVOKED",
] as const;

/**
 * Allowed status transitions. OPEN is carried by license.request; all other
 * keys are status.update payload.status values.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ProofMetaStatus, readonly ProofMetaStatus[]>
> = {
  OPEN: ["PENDING"],
  PENDING: ["GRANTED", "DENIED"],
  GRANTED: ["SUSPENDED", "REVOKED"],
  SUSPENDED: ["GRANTED", "REVOKED"],
  DENIED: [],
  REVOKED: [],
};

export type TransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Status updates that suspend or permanently revoke MUST carry a reason. */
export const REASON_REQUIRED_STATUSES: readonly ProofMetaStatus[] = [
  "SUSPENDED",
  "REVOKED",
] as const;

export function canTransition(
  from: ProofMetaStatus,
  to: ProofMetaStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Read the lifecycle status encoded by a single envelope. */
export function statusFromEnvelope(
  envelope: Envelope<AnyPayload>,
): ProofMetaStatus | undefined {
  const { payload } = envelope;
  if (payload.type === "license.request") {
    return payload.status === "OPEN" ? "OPEN" : undefined;
  }
  if (payload.type === "status.update" && typeof payload.status === "string") {
    return payload.status as ProofMetaStatus;
  }
  return undefined;
}

/**
 * Validate one transition and any required metadata on the target envelope.
 * `target` is the envelope being appended; `from` is the prior lifecycle status.
 */
export function validateTransition(
  from: ProofMetaStatus,
  target: Envelope<AnyPayload>,
): TransitionResult {
  const to = statusFromEnvelope(target);
  if (to === undefined) {
    return {
      ok: false,
      reason: "envelope does not encode a license lifecycle status",
    };
  }

  if (!canTransition(from, to)) {
    return {
      ok: false,
      reason: `illegal status transition: ${from} → ${to}`,
    };
  }

  if (target.payload.type !== "status.update") {
    return { ok: false, reason: "status transition must be a status.update envelope" };
  }

  if (REASON_REQUIRED_STATUSES.includes(to)) {
    const reason = (target.payload as { reason?: unknown }).reason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return {
        ok: false,
        reason: `status ${to} requires a non-empty reason field`,
      };
    }
  }

  return { ok: true };
}

/**
 * Validate the full status transition sequence of a license lifecycle chain.
 * Assumes cryptographic / in_reply_to integrity is checked separately.
 */
export function validateStatusTransitions(
  envelopes: Envelope<AnyPayload>[],
): TransitionResult {
  if (envelopes.length === 0) {
    return { ok: false, reason: "empty chain" };
  }

  const root = envelopes[0]!;
  if (root.payload.type !== "license.request") {
    return {
      ok: false,
      reason: "lifecycle root must be a license.request envelope",
    };
  }
  if (root.payload.status !== "OPEN") {
    return { ok: false, reason: "lifecycle root must have status OPEN" };
  }

  let current: ProofMetaStatus = "OPEN";

  for (let i = 1; i < envelopes.length; i++) {
    const env = envelopes[i]!;
    if (env.payload.type === "status.update") {
      const p = env.payload as {
        request_id?: unknown;
        subject?: unknown;
        policy?: unknown;
      };
      if (
        p.request_id !== undefined &&
        (p.subject !== undefined || p.policy !== undefined)
      ) {
        return {
          ok: false,
          reason: `envelope[${i}]: status.update must use exactly one mode: request_id only (Mode A) or subject + policy only (Mode B)`,
        };
      }
      if (typeof p.request_id !== "string" || p.request_id.length === 0) {
        return {
          ok: false,
          reason: `envelope[${i}]: license chain requires Mode A status.update with a non-empty request_id and no subject or policy`,
        };
      }
    }
    const t = validateTransition(current, env);
    if (!t.ok) {
      return {
        ok: false,
        reason: `envelope[${i}]: ${t.reason}`,
      };
    }
    const next = statusFromEnvelope(env);
    if (next === undefined) {
      return {
        ok: false,
        reason: `envelope[${i}]: missing status`,
      };
    }
    current = next;
  }

  return { ok: true };
}

// ── Attestation chains (policy/governance verdict history) ─────────────────

/** Whether an envelope is a root status.update attestation candidate. */
export function isAttestationEnvelope(envelope: Envelope<AnyPayload>): boolean {
  return envelope.payload.type === "status.update";
}

/**
 * Validate an attestation history chain — re-evaluations of the same subject
 * over time, linked via in_reply_to (cryptographic linking is checked by
 * verifyChain; this validates the governance semantics).
 *
 * Unlike a license lifecycle, governance verdicts are NOT a one-way street:
 * a subject may move freely between GRANTED / DENIED / SUSPENDED / REVOKED as
 * re-scans find it compliant or not. There are therefore no illegal
 * transitions and no terminal states. The invariants are:
 *   - every envelope is a Mode B status.update (subject + policy, no request_id);
 *   - the subject.id is constant across the whole chain;
 *   - the author is constant across the whole chain;
 *   - each status is a valid (non-OPEN) verdict;
 *   - SUSPENDED / REVOKED carry a reason (same as licensing).
 *
 * Deliberately NOT enforced here (tracked as open audit questions, see
 * docs/attestation-extension-proposal.md §11): policy-version constancy,
 * observation-gap / continuity proof, and trustworthy (anchored) timestamps.
 */
export function validateAttestationChain(
  envelopes: Envelope<AnyPayload>[],
): TransitionResult {
  if (envelopes.length === 0) {
    return { ok: false, reason: "empty chain" };
  }

  let subjectId: string | undefined;
  let rootAuthor: string | undefined;

  for (let i = 0; i < envelopes.length; i++) {
    const env = envelopes[i]!;
    if (env.payload.type !== "status.update") {
      return {
        ok: false,
        reason: `envelope[${i}]: attestation chain must contain only status.update envelopes`,
      };
    }

    const p = env.payload as {
      request_id?: unknown;
      subject?: { id?: unknown };
      policy?: unknown;
      status?: unknown;
      reason?: unknown;
    };

    if (
      p.request_id !== undefined &&
      (p.subject !== undefined || p.policy !== undefined)
    ) {
      return {
        ok: false,
        reason: `envelope[${i}]: status.update must use exactly one mode: request_id only (Mode A) or subject + policy only (Mode B)`,
      };
    }

    if (p.request_id !== undefined || p.subject === undefined) {
      return {
        ok: false,
        reason: `envelope[${i}]: attestation chain requires Mode B status.update (subject + policy, no request_id)`,
      };
    }

    const policy = p.policy;
    const policyRef =
      typeof policy === "object" && policy !== null && !Array.isArray(policy)
        ? (policy as { ref?: unknown }).ref
        : undefined;
    if (typeof policyRef !== "string" || policyRef.length === 0) {
      return {
        ok: false,
        reason: `envelope[${i}]: attestation policy.ref must be a non-empty string`,
      };
    }

    if (i === 0) {
      rootAuthor = env.author;
    } else if (env.author !== rootAuthor) {
      return {
        ok: false,
        reason: `envelope[${i}]: attestation author must equal root author`,
      };
    }

    const id = p.subject?.id;
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, reason: `envelope[${i}]: missing subject.id` };
    }
    if (i === 0) {
      subjectId = id;
    } else if (id !== subjectId) {
      return {
        ok: false,
        reason: `envelope[${i}]: subject.id changed across chain (${id} vs ${subjectId})`,
      };
    }

    const status = p.status;
    if (
      typeof status !== "string" ||
      status === "OPEN" ||
      !PROOFMETA_STATUSES.includes(status as ProofMetaStatus)
    ) {
      return {
        ok: false,
        reason: `envelope[${i}]: invalid attestation status ${String(status)}`,
      };
    }

    if (REASON_REQUIRED_STATUSES.includes(status as ProofMetaStatus)) {
      const reason = p.reason;
      if (typeof reason !== "string" || reason.trim().length === 0) {
        return {
          ok: false,
          reason: `envelope[${i}]: status ${status} requires a non-empty reason field`,
        };
      }
    }
  }

  return { ok: true };
}

/** Latest lifecycle status, or undefined if the chain has no license root. */
export function getCurrentStatus(
  envelopes: Envelope<AnyPayload>[],
): ProofMetaStatus | undefined {
  if (envelopes.length === 0) return undefined;
  for (let i = envelopes.length - 1; i >= 0; i--) {
    const s = statusFromEnvelope(envelopes[i]!);
    if (s !== undefined) return s;
  }
  return undefined;
}

/** Read optional valid_until from a GRANTED status.update envelope. */
export function validUntilFromEnvelope(
  envelope: Envelope<AnyPayload>,
): string | undefined {
  if (envelope.payload.type !== "status.update") return undefined;
  if (envelope.payload.status !== "GRANTED") return undefined;
  const vu = (envelope.payload as { valid_until?: unknown }).valid_until;
  return typeof vu === "string" ? vu : undefined;
}

/**
 * Whether the license is valid at `at` (default: now).
 * SUSPENDED, REVOKED, DENIED, PENDING, and OPEN are not currently valid.
 * Expiry is derived from the active GRANTED envelope's optional valid_until —
 * never a stored EXPIRED status.
 */
export function isCurrentlyValid(
  envelopes: Envelope<AnyPayload>[],
  at: Date = new Date(),
): boolean {
  const status = getCurrentStatus(envelopes);
  if (status !== "GRANTED") return false;

  const latest = envelopes[envelopes.length - 1]!;
  const validUntil = validUntilFromEnvelope(latest);
  if (validUntil !== undefined) {
    const until = new Date(validUntil);
    if (Number.isNaN(until.getTime()) || until.getTime() < at.getTime()) {
      return false;
    }
  }
  return true;
}

/** One contiguous period during which the license was provably GRANTED. */
export interface ValidityInterval {
  /** ISO 8601 — timestamp of the GRANTED envelope that opened this period. */
  from: string;
  /**
   * ISO 8601 — when validity ended (suspend, revoke, deny, or a later grant
   * superseding this one). null when the chain ends still GRANTED with no
   * valid_until cap, or when valid_until is the only bound.
   */
  until: string | null;
  /** payload_hash of the GRANTED envelope that opened this period. */
  grant_hash: Sha256Ref;
  /** Optional signed expiry bound from that GRANTED envelope. */
  valid_until?: string;
}

/**
 * Reconstruct validity-over-time from the signed chain. Prior GRANTED periods
 * remain provable after SUSPENDED or reinstatement.
 */
export function getValidityIntervals(
  envelopes: Envelope<AnyPayload>[],
): ValidityInterval[] {
  const intervals: ValidityInterval[] = [];
  let open: ValidityInterval | undefined;

  const closeOpen = (until: string | null) => {
    if (open) {
      open.until = until;
      intervals.push(open);
      open = undefined;
    }
  };

  for (const env of envelopes) {
    const status = statusFromEnvelope(env);
    if (status === undefined) continue;

    if (status === "GRANTED") {
      closeOpen(env.timestamp);
      open = {
        from: env.timestamp,
        until: null,
        grant_hash: env.payload_hash,
      };
      const vu = validUntilFromEnvelope(env);
      if (vu !== undefined) open.valid_until = vu;
    } else if (
      status === "SUSPENDED" ||
      status === "REVOKED" ||
      status === "DENIED"
    ) {
      closeOpen(env.timestamp);
    }
  }

  if (open) {
    if (open.valid_until !== undefined) {
      open.until = open.valid_until;
    }
    intervals.push(open);
  }

  return intervals;
}
