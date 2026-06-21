// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * ProofMeta reference TypeScript SDK. v1 primitives only —
 * no chain, no payment, no delivery. Resolvers live in their own packages.
 */

export * from "./types.js";
export { jcs } from "./jcs.js";
export { hashPayload, hashesEqual } from "./hash.js";
export {
  DID_KEY_PREFIX,
  encodeDidKey,
  decodeDidKey,
  isDidKeyEd25519,
} from "./did-key.js";
export { generateKeyPair, keyPairFromPrivate, type KeyPair } from "./keys.js";
export {
  createEnvelope,
  updateStatus,
  createAttestation,
  verifyEnvelope,
  verifyChain,
  type CreateEnvelopeOptions,
  type StatusUpdateExtras,
  type VerifyOptions,
  type VerifyResult,
} from "./envelope.js";
export {
  ALLOWED_TRANSITIONS,
  PROOFMETA_STATUSES,
  REASON_REQUIRED_STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  getCurrentStatus,
  getValidityIntervals,
  isCurrentlyValid,
  statusFromEnvelope,
  isAttestationEnvelope,
  validateAttestationChain,
  validateStatusTransitions,
  validateTransition,
  validUntilFromEnvelope,
  type TransitionResult,
  type ValidityInterval,
} from "./lifecycle.js";
