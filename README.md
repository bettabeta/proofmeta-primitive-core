# ProofMeta Primitive Core

> **Layer:** Primitive
> **Depends on:** nothing
> **Guarantees:** Cryptographic integrity — Signed Envelopes, DID identity, JCS hashing, ed25519 signatures, status lifecycle.

> The permission layer for the agentic web — an open protocol that lets any AI agent discover, request, and use licensed items from any other AI agent, with machine-readable terms and a status lifecycle.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: Draft](https://img.shields.io/badge/Status-Draft-yellow)]()

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

## Two kinds of verdict: licenses and attestations

The same signed status serves two uses (one primitive, one toolchain — see §3.4.1):

- **License verdict** — a verdict *forward*, answering a request: "you asked to license this item → `GRANTED`."
- **Attestation** — a standalone verdict an authority asserts about a `subject` against a `policy`, with **no prior request**: "this AI tool, against the EU policy → `DENIED`." Re-evaluations link into a signed, tamper-evident verdict history.

This makes ProofMeta the permission *and* the proof layer: licensing says *you may*; attestations prove *the state / that the terms were honored*. Governance and compliance (e.g. enterprise AI asset management) use attestations; commercial licensing uses both.

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
  "timestamp": "2026-04-21T10:00:00Z",
  "anchors": []
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

## What v1 ships

v1 is a working vertical slice, not a wishlist. A Provider can stand up, a Consumer can request a license, and an envelope chain can be re-verified by anyone end-to-end — no platform, no chain, no coordination beyond the manifest URL.

- [x] Manifest spec (`payload.manifest.schema.json`)
- [x] License-request + status-update spec (`payload.license-request.schema.json`, `payload.status-update.schema.json`)
- [x] Status lifecycle: `OPEN → PENDING → GRANTED | DENIED → SUSPENDED → REVOKED`
- [x] TypeScript SDK (`@proofmeta/sdk-ts`) — ed25519 signing, JCS hashing, envelope + chain verification
- [x] Reference resolver interface + free-license implementation (`@proofmeta/resolvers`)
- [x] Demo Provider and Consumer agents (`examples/provider`, `examples/consumer`)
- [x] Validator CLI (`@proofmeta/cli` → `proofmeta validate <file>`)

Next up (post-v1): content-hashing for catalog items, optional anchor resolvers (Tier 3), and a normative test-vector corpus.

## License


Copyright © 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)

This project is licensed under the Apache License 2.0  see the [LICENSE](LICENSE) file for details.
