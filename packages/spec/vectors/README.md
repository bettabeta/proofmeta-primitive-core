# ProofMeta v0.3.0 test-vector corpus

This directory is the language-neutral conformance corpus for the v0.3.0 envelope-authenticity (D16) and lifecycle-authority (D18) rules in `PROOFMETA_ANWEISUNG.md`.

> **WARNING — TEST KEYS ONLY:** `keys.json` contains public deterministic private Ed25519 seeds. Never use these keys for production, identity, value, secrets, or any non-test purpose.

## File format

There are exactly 15 vector files, one case per file. `keys.json` is fixture metadata, not a vector. Every vector uses exactly this top-level shape:

```json
{
  "id": "stable-case-id",
  "description": "human-readable intent",
  "input": {},
  "expect": { "valid": true }
}
```

`input` is either one envelope object for `verifyEnvelope`, or a JSON array of envelopes for `verifyChain`. The runner infers the operation from that JSON type.

Invalid cases use only a stable reason code:

```json
{
  "id": "stable-invalid-case-id",
  "description": "human-readable attack",
  "input": {},
  "expect": {
    "valid": false,
    "reason": "MISSING_TIMESTAMP"
  }
}
```

Reason codes classify SDK failures; they do not change the SDK API.

## Deterministic keys and signatures

`keys.json` contains exactly one 32-byte Ed25519 seed for each role: `provider`, `consumer`, and `attacker`. Each entry also records the derived 32-byte public key and `did:key` identifier. Implementations should derive the public key from the seed, then confirm both the recorded public key and DID before using a fixture.

All timestamps, payloads, hashes, and signatures are fixed. D16 signatures are Ed25519 signatures over the UTF-8 bytes of the RFC 8785 JCS object containing exactly `proofmeta`, `payload_hash`, `author`, `timestamp`, and `in_reply_to` when present. The legacy vector instead signs the UTF-8 `payload_hash` string to prove that v0.3.0 does not downgrade.

## Reason codes

| Reason code | Existing v0.3.0 SDK result |
| --- | --- |
| `INVALID_SIGNATURE` | `invalid ed25519 signature` |
| `MISSING_TIMESTAMP` | `envelope.timestamp must be a string` |
| `MANIFEST_AUTHOR_MISMATCH` | `manifest author must equal payload.provider.id` |
| `OPEN_AUTHOR_MISMATCH` | `OPEN author must equal payload.consumer.id` |
| `STATUS_AUTHOR_MISMATCH` | `envelope[1] license status author must equal root OPEN payload.provider_id` |
| `MISSING_PROVIDER_ID` | `root OPEN envelope must have a valid provider_id DID string` |
| `ATTESTATION_POLICY_REQUIRED` | `envelope[0]: attestation policy.ref must be a non-empty string` |
| `ATTESTATION_AUTHOR_MISMATCH` | `envelope[1]: attestation author must equal root author` |
| `STATUS_UPDATE_MODE_MIXED` | `envelope[0]: status.update must use exactly one mode: request_id only (Mode A) or subject + policy only (Mode B)` |

## Corpus inventory

| File | ID | Input | Expected |
| --- | --- | --- | --- |
| `01-valid-manifest.json` | `valid-manifest` | envelope | valid |
| `02-valid-open.json` | `valid-open` | envelope | valid |
| `03-valid-status-update.json` | `valid-status-update` | envelope | valid |
| `04-valid-open-pending-granted-chain.json` | `valid-open-pending-granted-chain` | chain | valid |
| `05-invalid-d16-mutated-timestamp.json` | `invalid-d16-mutated-timestamp` | envelope | `INVALID_SIGNATURE` |
| `06-invalid-d16-mutated-in-reply-to.json` | `invalid-d16-mutated-in-reply-to` | envelope | `INVALID_SIGNATURE` |
| `07-invalid-d16-missing-timestamp.json` | `invalid-d16-missing-timestamp` | envelope | `MISSING_TIMESTAMP` |
| `08-invalid-d16-legacy-payload-hash-signature.json` | `invalid-d16-legacy-payload-hash-signature` | envelope | `INVALID_SIGNATURE` |
| `09-invalid-d18-manifest-author-mismatch.json` | `invalid-d18-manifest-author-mismatch` | envelope | `MANIFEST_AUTHOR_MISMATCH` |
| `10-invalid-d18-open-author-mismatch.json` | `invalid-d18-open-author-mismatch` | envelope | `OPEN_AUTHOR_MISMATCH` |
| `11-invalid-d18-attacker-signed-status.json` | `invalid-d18-attacker-signed-status` | chain | `STATUS_AUTHOR_MISMATCH` |
| `12-invalid-d18-root-open-missing-provider-id.json` | `invalid-d18-root-open-missing-provider-id` | chain | `MISSING_PROVIDER_ID` |
| `13-invalid-attestation-missing-policy.json` | `invalid-attestation-missing-policy` | chain | `ATTESTATION_POLICY_REQUIRED` |
| `14-invalid-attestation-changed-author.json` | `invalid-attestation-changed-author` | chain | `ATTESTATION_AUTHOR_MISMATCH` |
| `15-invalid-status-update-mixed-mode.json` | `invalid-status-update-mixed-mode` | chain | `STATUS_UPDATE_MODE_MIXED` |

## Consuming the corpus outside TypeScript

A non-TypeScript implementation can consume the corpus without SDK-specific helpers:

1. Enumerate every `*.json` file except `keys.json`.
2. Parse the vector and require exactly `id`, `description`, `input`, and `expect`.
3. If `input` is an array, run full chain verification; otherwise run envelope verification.
4. Recompute `payload_hash` from RFC 8785 JCS payload bytes.
5. Reconstruct the D16 signing projection and verify its Ed25519 signature against `author`.
6. For chains, verify links, lifecycle semantics, and D18 signer authority.
7. Compare validity with `expect.valid`; for invalid cases, map the local diagnostic to the documented corpus reason code in `expect.reason`.

The TypeScript reference runner is the single test named `ProofMeta v0.3.0 corpus vectors match SDK verification results` in `packages/sdk-ts/test/v0.3.0-vector-corpus.test.mjs`.
