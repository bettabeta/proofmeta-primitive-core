// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Signed Envelope create / sign / verify. See §3.1.
 *
 * Signing procedure:
 *   1. payload_hash = "sha256:" + hex( sha256( jcs(payload) ) )
 *   2. signature    = "ed25519:" + hex( ed25519.sign( utf8(payload_hash), privateKey ) )
 *
 * Signing the ASCII payload_hash string (not the raw canonical JSON) keeps the
 * signing surface small and unambiguous: all a verifier needs is the hash and
 * the author DID.
 */

import * as ed25519 from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { decodeDidKey, isDidKeyEd25519 } from "./did-key.js";
import { hashPayload, hashesEqual } from "./hash.js";
import {
  isAttestationEnvelope,
  validateAttestationChain,
  validateStatusTransitions,
} from "./lifecycle.js";
import {
  PROOFMETA_PROTOCOL_VERSION,
  type AnyPayload,
  type Anchor,
  type Did,
  type Ed25519SigRef,
  type Envelope,
  type PayloadBase,
  type ProofMetaStatus,
  type Sha256Ref,
  type StatusUpdatePayload,
} from "./types.js";

// ── Signing ──────────────────────────────────────────────────────────────

export interface CreateEnvelopeOptions<P extends PayloadBase> {
  payload: P;
  author: Did;
  privateKey: Uint8Array;
  /** Optional — ISO 8601 string. Defaults to current UTC time. */
  timestamp?: string;
  /** payload_hash of the logically previous envelope in the same lifecycle. */
  in_reply_to?: Sha256Ref;
  /** Tier-3 external anchors. Omitted from the envelope when empty or absent. */
  anchors?: Anchor[];
}

/**
 * Build a Signed Envelope around a payload.
 *
 * The `author` DID must correspond to `privateKey`. For did:key with ed25519,
 * this is verified by deriving the public key from the private key and
 * comparing against the DID. For other DID methods, the caller is responsible.
 */
export async function createEnvelope<P extends PayloadBase>(
  opts: CreateEnvelopeOptions<P>,
): Promise<Envelope<P>> {
  const {
    payload,
    author,
    privateKey,
    timestamp = new Date().toISOString(),
    in_reply_to,
    anchors,
  } = opts;

  if (isDidKeyEd25519(author)) {
    const derivedPub = await ed25519.getPublicKeyAsync(privateKey);
    const didPub = decodeDidKey(author);
    if (!bytesEqual(derivedPub, didPub)) {
      throw new Error(
        "Private key does not match author DID (derived public key mismatch)",
      );
    }
  }

  const payload_hash = hashPayload(payload);
  const sigBytes = await ed25519.signAsync(
    new TextEncoder().encode(payload_hash),
    privateKey,
  );
  const signature = `ed25519:${bytesToHex(sigBytes)}` as Ed25519SigRef;

  const envelope: Envelope<P> = {
    proofmeta: PROOFMETA_PROTOCOL_VERSION,
    payload,
    payload_hash,
    author,
    signature,
    timestamp,
  };
  if (in_reply_to !== undefined) envelope.in_reply_to = in_reply_to;
  if (anchors !== undefined && anchors.length > 0) envelope.anchors = anchors;
  return envelope;
}

// ── Verifying ────────────────────────────────────────────────────────────

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface VerifyOptions {
  /**
   * Optional override: resolve the public key for an `author` DID. Required
   * for DID methods other than did:key. If omitted and author is not a
   * did:key, verification fails.
   */
  resolveAuthor?: (author: string) => Promise<Uint8Array> | Uint8Array;
}

/**
 * Verify a Signed Envelope:
 *   1. proofmeta version is 1.0
 *   2. payload_hash matches sha256(jcs(payload))
 *   3. signature is a valid ed25519 signature over the payload_hash string
 *
 * Does NOT verify `in_reply_to` chain integrity (that is a lifecycle concern
 * handled by verifyChain) or anchor authenticity (resolver concern).
 */
export async function verifyEnvelope<P extends PayloadBase>(
  envelope: Envelope<P>,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  if (envelope.proofmeta !== PROOFMETA_PROTOCOL_VERSION) {
    return { ok: false, reason: `unsupported version: ${envelope.proofmeta}` };
  }

  const recomputed = hashPayload(envelope.payload);
  if (!hashesEqual(recomputed, envelope.payload_hash)) {
    return { ok: false, reason: "payload_hash does not match canonical payload" };
  }

  let publicKey: Uint8Array;
  if (isDidKeyEd25519(envelope.author)) {
    publicKey = decodeDidKey(envelope.author);
  } else if (opts.resolveAuthor) {
    publicKey = await opts.resolveAuthor(envelope.author);
  } else {
    return {
      ok: false,
      reason: `cannot resolve author DID without resolveAuthor: ${envelope.author}`,
    };
  }

  if (!envelope.signature.startsWith("ed25519:")) {
    return { ok: false, reason: "signature is not an ed25519 reference" };
  }
  const sigHex = envelope.signature.slice("ed25519:".length);
  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(sigHex);
  } catch {
    return { ok: false, reason: "signature is not valid hex" };
  }

  const msg = new TextEncoder().encode(envelope.payload_hash);
  const ok = await ed25519.verifyAsync(sigBytes, msg, publicKey);
  return ok ? { ok: true } : { ok: false, reason: "invalid ed25519 signature" };
}

// ── Status transitions ───────────────────────────────────────────────────

/**
 * Extras attached to a status.update payload. `note` and `delivery` are the
 * two named fields in the spec; additional keys pass through untouched, for
 * resolver-specific metadata (e.g. payment receipts).
 */
export interface StatusUpdateExtras {
  note?: string;
  delivery?: StatusUpdatePayload["delivery"];
  [k: string]: unknown;
}

/**
 * Build and sign a status.update envelope that continues an existing chain.
 *
 * Given the `prior` envelope (typically the OPEN request, or a PENDING
 * update), this produces the next envelope with the correct `in_reply_to`
 * pointing at `prior.payload_hash` and the same `request_id`. The Provider's
 * job is reduced to: pick the next status, hand over its key, done.
 *
 * The generic parameter `B` ensures the prior payload carries `request_id`;
 * manifest payloads do not qualify at compile time.
 */
export async function updateStatus<B extends PayloadBase & { request_id: string }>(
  prior: Envelope<B>,
  status: Exclude<ProofMetaStatus, "OPEN">,
  author: Did,
  privateKey: Uint8Array,
  extras: StatusUpdateExtras = {},
): Promise<Envelope<StatusUpdatePayload>> {
  const payload: StatusUpdatePayload = {
    type: "status.update",
    request_id: prior.payload.request_id,
    status,
    ...extras,
  };
  return createEnvelope<StatusUpdatePayload>({
    payload,
    author,
    privateKey,
    in_reply_to: prior.payload_hash,
  });
}

// ── Attestations (root status — policy/governance verdicts) ────────────────

/**
 * Build and sign a ROOT ATTESTATION: a standalone status.update that asserts a
 * verdict about `subject` against `policy`, with no prior license.request.
 *
 * Unlike {@link updateStatus}, this is an envelope root — it carries no
 * `request_id` and no `in_reply_to`. The verdict reuses the status vocabulary
 * (GRANTED = compliant/permitted, DENIED = non-compliant, SUSPENDED =
 * quarantined, REVOKED = must be removed). The asserting authority signs with
 * its own key. See §3.4 Mode B and docs/attestation-extension-proposal.md.
 *
 * Note: attestation *history chains* (re-evaluations linked via in_reply_to)
 * are not yet validated by verifyChain — single attestations verify via
 * verifyEnvelope today.
 */
export async function createAttestation(
  args: {
    subject: StatusUpdatePayload["subject"];
    policy: StatusUpdatePayload["policy"];
    status: Exclude<ProofMetaStatus, "OPEN">;
    author: Did;
    privateKey: Uint8Array;
    timestamp?: string;
    /**
     * payload_hash of the previous attestation about the SAME subject. Omit for
     * the first verdict (an envelope root); set on re-evaluations to build a
     * signed verdict history. See validateAttestationChain.
     */
    in_reply_to?: Sha256Ref;
    extras?: StatusUpdateExtras;
  },
): Promise<Envelope<StatusUpdatePayload>> {
  const {
    subject,
    policy,
    status,
    author,
    privateKey,
    timestamp,
    in_reply_to,
    extras = {},
  } = args;
  const payload: StatusUpdatePayload = {
    type: "status.update",
    subject,
    policy,
    status,
    ...extras,
  };
  return createEnvelope<StatusUpdatePayload>({
    payload,
    author,
    privateKey,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(in_reply_to !== undefined ? { in_reply_to } : {}),
  });
}

// ── Chain verification ───────────────────────────────────────────────────

/**
 * Verify a license-lifecycle chain: OPEN → PENDING → GRANTED/DENIED …
 *
 *   - Each envelope verifies individually (signature + hash).
 *   - The first envelope is the root (no in_reply_to).
 *   - Each subsequent envelope's in_reply_to equals the previous one's
 *     payload_hash.
 *   - All envelopes share the same payload.request_id (if applicable).
 *   - Status transitions follow the allowed lifecycle (including SUSPENDED).
 */
export async function verifyChain(
  envelopes: Envelope<AnyPayload>[],
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  if (envelopes.length === 0) {
    return { ok: false, reason: "empty chain" };
  }

  let prevHash: Sha256Ref | undefined;
  let rootRequestId: string | undefined;

  for (let i = 0; i < envelopes.length; i++) {
    const env = envelopes[i]!;
    const v = await verifyEnvelope(env, opts);
    if (!v.ok) return { ok: false, reason: `envelope[${i}]: ${v.reason}` };

    if (i === 0) {
      if (env.in_reply_to !== undefined) {
        return { ok: false, reason: "root envelope must not have in_reply_to" };
      }
    } else {
      if (env.in_reply_to === undefined) {
        return {
          ok: false,
          reason: `envelope[${i}] missing in_reply_to`,
        };
      }
      if (prevHash === undefined || !hashesEqual(env.in_reply_to, prevHash)) {
        return {
          ok: false,
          reason: `envelope[${i}].in_reply_to does not match previous payload_hash`,
        };
      }
    }

    // Track request_id consistency if present on the payload
    const rid = (env.payload as { request_id?: unknown }).request_id;
    if (typeof rid === "string") {
      if (rootRequestId === undefined) rootRequestId = rid;
      else if (rid !== rootRequestId) {
        return {
          ok: false,
          reason: `envelope[${i}] request_id differs from root (${rid} vs ${rootRequestId})`,
        };
      }
    }

    prevHash = env.payload_hash;
  }

  // Two chain kinds share the same cryptographic linking above, but have
  // different semantics: a license lifecycle (rooted at a license.request) vs.
  // an attestation history (rooted at a root attestation). Route accordingly.
  const semantics = isAttestationEnvelope(envelopes[0]!)
    ? validateAttestationChain(envelopes)
    : validateStatusTransitions(envelopes);
  if (!semantics.ok) return semantics;

  return { ok: true };
}

// ── Utility ──────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
