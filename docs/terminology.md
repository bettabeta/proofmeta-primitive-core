# Terminology

Shared vocabulary for ProofMeta. Normative meanings live in
`PROOFMETA_ANWEISUNG.md`; this is the quick reference.

## Core artifacts

- **Signed Envelope** — the single primitive. Wraps a payload with the author
  DID, a JCS hash of the payload, an ed25519 signature, and a timestamp. Every
  ProofMeta artifact is one of these. (§3.1)
- **Payload** — the content inside an envelope. Its `type` is the discriminator:
  `manifest`, `license.request`, or `status.update`.
- **Manifest** — what a Provider publishes: who they are, endpoints, resolvers,
  and `license_types` (each with a `scope`). Also readable as a **policy** —
  a machine-readable rulebook. (§3.3)
- **License Request** — a Consumer's `OPEN` envelope asking to license an item
  under a named `license_type`. Root of a license lifecycle. (§3.6)
- **Status Update** — a verdict envelope. Carries one of `PENDING / GRANTED /
  DENIED / SUSPENDED / REVOKED`. Has two modes (§3.4.1):
  - **License verdict (Mode A)** — answers a request; carries `request_id`,
    chained via `in_reply_to`.
  - **Attestation (Mode B)** — a standalone verdict about a `subject` against a
    `policy`, no prior request; carries `subject` + `policy`, no `request_id`.

## Attestation terms

- **Subject** — what an attestation judges (e.g. an observed AI tool, asset, or
  action). Identified by a stable `id`; may carry `content_hash`, `host`.
- **Policy** — the rulebook an attestation was made against. A `ref` (URL and/or
  sha256) plus optional `scope` conditions.
- **Verdict** — the `status` value, reused by analogy: `GRANTED` = compliant /
  permitted, `DENIED` = non-compliant, `SUSPENDED` = quarantined, `REVOKED` =
  withdrawn / must be removed.
- **Attestation history chain** — re-evaluations of one subject over time,
  linked via `in_reply_to`. Free transitions, no terminal states, constant
  subject. A signed, tamper-evident verdict timeline.

## Roles

- **Provider Agent** — publishes a manifest, offers licensed items.
- **Consumer Agent** — discovers providers, requests licenses.
- **Authority** — issues attestations (e.g. a governance scanner, auditor,
  marketplace). Signs with its own DID.
- **Resolver** — external service handling a `role` (payment, delivery, anchor,
  identity…). Declared as `{ role, id }`; implemented in `packages/resolvers/*`.

## Cryptographic / format terms

- **DID** — decentralized identifier of a signer. v1 MUST-support: `did:key`
  with ed25519. (D3)
- **JCS** — JSON Canonicalization Scheme (RFC 8785); the canonical byte form
  hashed for `payload_hash`. (D1)
- **Anchor** — optional external witness (on-chain PDA, RFC 3161 timestamp,
  Arweave tx). Tier-3 trust; never required. (§3.5, D12)
- **Scope** — license/policy conditions. Normative core tags + URL extensions
  for anything domain- or jurisdiction-specific. (D11)
