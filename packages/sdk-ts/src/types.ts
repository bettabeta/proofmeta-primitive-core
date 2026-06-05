// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * ProofMeta v1 type definitions. Mirrors the JSON Schemas in packages/spec/.
 * Prose reference: PROOFMETA_ANWEISUNG.md §3.
 */

export const PROOFMETA_PROTOCOL_VERSION = "1.0" as const;

export type ProofMetaVersion = typeof PROOFMETA_PROTOCOL_VERSION;

export type ProofMetaStatus =
  | "OPEN"
  | "PENDING"
  | "GRANTED"
  | "DENIED"
  | "SUSPENDED"
  | "REVOKED";

export type Sha256Ref = `sha256:${string}`;
export type Ed25519SigRef = `ed25519:${string}`;
export type Did = `did:${string}`;

/** External anchor entry — see §3.5. Additional fields beyond the declared ones are allowed. */
export interface Anchor {
  type: string;
  reference: string;
  chain?: string;
  authority?: string;
  [k: string]: unknown;
}

/** Any payload carries a type discriminator. */
export interface PayloadBase {
  type: string;
}

/** Outer Signed Envelope wrapper — every ProofMeta artifact is one of these. */
export interface Envelope<P extends PayloadBase = PayloadBase> {
  proofmeta: ProofMetaVersion;
  payload: P;
  payload_hash: Sha256Ref;
  author: Did;
  signature: Ed25519SigRef;
  timestamp: string; // ISO 8601 UTC
  in_reply_to?: Sha256Ref;
  /** Tier-3 external anchors. Omitted for Tier-1 envelopes; present (non-empty) when the envelope is backed by a chain or timestamp authority. */
  anchors?: Anchor[];
}

// ── Manifest ──────────────────────────────────────────────────────────────

export interface ResolverEntry {
  role: string;
  id: string;
}

export interface PriceHint {
  amount: string;
  currency: string;
}

export interface LicenseType {
  id: string;
  name?: string;
  terms_url: string;
  terms_hash: Sha256Ref;
  price_hint?: PriceHint;
  /** At least one tag from the core vocabulary; extension tags MUST be URLs. */
  scope: string[];
}

export interface CatalogItem {
  item_id: string;
  name: string;
  description?: string;
  available_licenses: string[];
  /**
   * sha256 of the item's canonical byte representation.
   * SHOULD be present for static content so Consumers can verify delivered
   * bytes match the licensed item. Absent for dynamic items (services, APIs,
   * streams) — in that case a license does not bind to any specific bytes.
   */
  content_hash?: Sha256Ref;
  metadata?: Record<string, unknown>;
}

export interface ManifestPayload extends PayloadBase {
  type: "manifest";
  provider: {
    id: Did;
    name?: string;
    description?: string;
  };
  request_endpoint: string;
  /** Either catalog_endpoint or items (inline) MUST be present. */
  catalog_endpoint?: string;
  items?: CatalogItem[];
  resolvers?: ResolverEntry[];
  license_types: LicenseType[];
}

// ── License Request (OPEN) ────────────────────────────────────────────────

export interface LicenseRequestPayload extends PayloadBase {
  type: "license.request";
  /** Consumer-generated, globally unique. UUID v7 recommended. */
  request_id: string;
  consumer: {
    id: Did;
    callback_url?: string;
  };
  /** Binds this request to one specific Provider — prevents replay across providers. */
  provider_id: Did;
  item_id: string;
  license_type: string;
  terms_hash: Sha256Ref;
  resolver_preferences?: ResolverEntry[];
  status: "OPEN";
}

// ── Status Update (PENDING / GRANTED / DENIED / SUSPENDED / REVOKED) ───────

export interface StatusUpdatePayload extends PayloadBase {
  type: "status.update";
  request_id: string;
  status: Exclude<ProofMetaStatus, "OPEN">;
  /** Required on SUSPENDED and REVOKED transitions. */
  reason?: string;
  /** Optional context; commonly used on reinstatement (SUSPENDED → GRANTED). */
  note?: string;
  /**
   * Optional signed expiry bound on GRANTED. "Expired" is derived at read time
   * from this field — it is not a stored lifecycle status.
   */
  valid_until?: string;
  delivery?: {
    method?: string;
    url?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ── Unions & helpers ──────────────────────────────────────────────────────

export type AnyPayload =
  | ManifestPayload
  | LicenseRequestPayload
  | StatusUpdatePayload;

export type ManifestEnvelope = Envelope<ManifestPayload>;
export type LicenseRequestEnvelope = Envelope<LicenseRequestPayload>;
export type StatusUpdateEnvelope = Envelope<StatusUpdatePayload>;
