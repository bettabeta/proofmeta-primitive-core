# ProofMeta Primitive Core

> **Layer:** Primitive
> **Depends on:** nothing
> **Guarantees:** Cryptographic integrity — Signed Envelopes, DID identity, JCS hashing, ed25519 signatures, status lifecycle.

> The permission layer for the agentic web — an open protocol that lets any AI agent discover, request, and use licensed items from any other AI agent, with machine-readable terms and a status lifecycle.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: v1 Draft](https://img.shields.io/badge/Status-v1_Draft-yellow)]()

---

## What is ProofMeta?

ProofMeta is a **protocol**, not a platform. It defines what agents say to each other when licensing content or capabilities. It never defines how money moves, where files are stored, or which blockchain is used.

- **Provider Agent** — publishes a manifest, offers licensed items
- **Consumer Agent** — discovers providers, requests licenses
- **Resolver** — external service that handles payment, delivery, or verification

## Core Principles

1. The protocol is the contract, not the infrastructure
2. An agent should be able to participate with a single file
3. Status is the only state ProofMeta owns
4. Machine-first, human-readable second
5. No vendor lock-in, ever
6. Simplicity over completeness

## Status Lifecycle

```
OPEN → PENDING → GRANTED | DENIED
                 GRANTED → SUSPENDED → GRANTED (reinstate)
                 GRANTED → REVOKED (optional)
                 SUSPENDED → REVOKED (escalate)
```

## License verdicts and attestations

A signed status can be linked to a request or issued independently:

- **License verdict** — answers a request, such as a request that results in `GRANTED`.
- **Attestation** — an authority asserts a verdict about a `subject` against a `policy`, with no prior request. Later evaluations can link into a signed, tamper-evident verdict history.

Profiles for specific domains live in separate `proofmeta-profile-*` repositories.

## Quick Start

A Provider Agent publishes a manifest at `/.well-known/proofmeta.json`. Every ProofMeta artifact is a **Signed Envelope** — the outer wrapper carries the author DID, the signature, and a hash of the payload. The manifest lives inside `payload`:

```json
{
  "proofmeta": "1.0",
  "payload": {
    "type": "manifest",
    "provider": {
      "id": "did:key:z6Mkh...",
      "name": "Your Agent Name"
    },
    "request_endpoint": "https://youragent.ai/api/proofmeta/request",
    "catalog_endpoint": "https://youragent.ai/api/proofmeta/catalog",
    "resolvers": [
      { "role": "payment",  "id": "stripe" },
      { "role": "delivery", "id": "https" },
      { "role": "anchor",   "id": "none" }
    ],
    "license_types": [
      {
        "id": "free-attribution",
        "terms_url": "https://youragent.ai/terms/free",
        "terms_hash": "sha256:...",
        "scope": ["non-commercial", "attribution-required"]
      }
    ]
  },
  "payload_hash": "sha256:...",
  "author": "did:key:z6Mkh...",
  "signature": "ed25519:...",
  "timestamp": "2026-04-21T10:00:00Z"
}
```

Status is expressed through the envelope chain — a Consumer polls `GET {request_endpoint}/{request_id}` to retrieve the latest envelope or, with `?full=true`, the whole chain. See [`PROOFMETA_ANWEISUNG.md`](./PROOFMETA_ANWEISUNG.md) for the full spec and [`docs/scope-vocabulary.md`](./docs/scope-vocabulary.md) for the normative scope tags.

## Repository Structure

```
/packages/spec          → JSON Schemas (manifest, request, status)
/packages/sdk-ts        → TypeScript SDK
/packages/resolvers     → Reference resolver implementations
/examples/provider      → Demo Provider Agent
/examples/consumer      → Demo Consumer Agent
/docs                   → Specification documentation
package.json            → npm workspaces (packages/*, examples/*)
.cursorrules            → Cursor IDE rules
```

## Implemented in the v1 draft

**ProofMeta v1 Draft — working reference implementation, packages 0.2.0.** The v1 draft has a working reference vertical slice. It is not yet a released v1: the canonical spec domain and the acceptance evidence listed in the master specification are still open. A Provider can stand up, a Consumer can request a license, and an envelope chain can be re-verified by anyone end-to-end — no platform, no chain, no coordination beyond the manifest URL.

- [x] Manifest spec (`payload.manifest.schema.json`)
- [x] License-request + status-update spec (`payload.license-request.schema.json`, `payload.status-update.schema.json`)
- [x] Status lifecycle: `OPEN → PENDING → {GRANTED | DENIED}`; from `GRANTED`: `SUSPENDED` or terminal `REVOKED`; from `SUSPENDED`: `GRANTED` or terminal `REVOKED`; `DENIED` is terminal.
- [x] TypeScript SDK (`@proofmeta/sdk-ts`) — ed25519 signing, JCS hashing, envelope + chain verification
- [x] Reference resolver interface + free-license implementation (`@proofmeta/resolvers`)
- [x] Demo Provider and Consumer agents (`examples/provider`, `examples/consumer`)
- [x] Validator CLI (`@proofmeta/cli` → `proofmeta validate <file>`)

Next: publish the v1 draft at the canonical spec domain, record the Provider/Consumer setup benchmarks, and add a normative cross-implementation test-vector corpus. Planned for v1.1: one payment resolver, one optional anchor resolver with a Tier-3 demo, and resolver-informed requirements for a future ERC-7521 wrapping interface; the formal interface remains deferred to v2.

## License


Copyright © 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)

This project is licensed under the Apache License 2.0  see the [LICENSE](LICENSE) file for details.
