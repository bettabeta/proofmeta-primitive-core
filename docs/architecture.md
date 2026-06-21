# ProofMeta Architecture — Core vs. Adapters

ProofMeta is a **protocol, not a platform**. Its power comes from a tiny core
plus open extension points — not from a large schema surface. This document
draws the line, so contributions land in the right layer.

## The four layers

```
┌─────────────────────────────────────────────────────────────┐
│ Applications        agent-xray, AI Checker, marketplaces,     │  ← consume the protocol
│                     provider/consumer agents                  │
├─────────────────────────────────────────────────────────────┤
│ Adapters (Resolvers) identity · storage · payment · anchor    │  ← reference impls, {role,id}
│                     packages/resolvers/*                      │
├─────────────────────────────────────────────────────────────┤
│ Extensions          scope URLs · item types · subject/policy  │  ← conventions, no core change
│                     refs                                      │
├─────────────────────────────────────────────────────────────┤
│ CORE                Signed Envelope + 4 payload types         │  ← packages/spec (keep small!)
│                     (manifest, license.request, status.update)│
└─────────────────────────────────────────────────────────────┘
```

## Core — `packages/spec` (the only "truth")

One primitive, the **Signed Envelope** (DID author, payload, JCS hash, ed25519
signature). Payload types today: `manifest`, `license.request`, `status.update`
(which has two modes — license verdict and root attestation; see §3.4.1).

**Rule:** the core stays minimal (Principle #6). A new payload type is a new
file + one line in `spec/index.mjs`. Adding capability almost never means
touching the core — it means using an extension point below.

## Adapters (Resolvers) — `packages/resolvers/*`

Identity, storage, payment, and anchor are **not** core schemas. They are
declared in manifests/requests as a flat `{ role, id }` list (D9) and
implemented as reference resolvers in their own packages. A Stripe, Circle,
Solana, IPFS, or Arweave integration is a **resolver package**, never a schema
in the core.

> ⚠️ Anti-pattern: do **not** create `schemas/adapters/payment/stripe.schema.json`
> et al. That bakes infrastructure and vendor lock-in into the protocol —
> exactly what Principles #1 and #5 forbid. Vendor specifics live in resolvers.

## Extensions — conventions, no core change

- **Scope URLs** (D11): any condition outside the normative vocabulary is a URL
  (`https://pandr.de/scope/eu-residency-required`). No core change.
- **`subject` / `policy` references** on attestations: opaque refs (id, URL,
  hash). The core does not model what a subject *is*.
- **Item types** (AI agent, dataset, content, API…): catalog metadata, not core
  schemas. Bind bytes with the optional `content_hash` (D13) when it matters.

## Applications — where the value is sold

Discovery engines, dashboards, marketplaces, agents. **agent-xray** (enterprise
AI asset governance) is the first reference application: it discovers AI assets
and emits ProofMeta **attestations** as machine-readable, verifiable governance
and audit evidence. Applications are where ProofMeta meets a buyer — they
consume the protocol; they are not part of it.

## How to decide where something goes

| You want to add… | Layer | Where |
|---|---|---|
| A new kind of signed statement | Core | new `payload.*.schema.json` + `index.mjs` |
| A payment / storage / chain integration | Adapter | `packages/resolvers/<name>/` |
| A jurisdiction- or domain-specific condition | Extension | a scope URL — no code |
| A new asset/item kind | Extension | catalog metadata + optional `content_hash` |
| A product surface (dashboard, scanner, agent) | Application | its own repo / package |

When in doubt: **keep the core small.** It is the most valuable asset precisely
because it is minimal.
