# Use Cases

ProofMeta is one primitive applied to many problems. Each use case here shows
how a real scenario maps onto the **same** core (Signed Envelope + manifest /
license.request / status.update) — without adding to the protocol.

The point of writing them down: prove the breadth is real (one toolchain, many
markets) and keep the core small by routing scenario-specific needs to
extensions and resolvers, not new schemas (see [`../architecture.md`](../architecture.md)).

## The map

| Use case | Status | Primary primitive | What ProofMeta provides |
|---|---|---|---|
| [Raynet — Enterprise AI Asset Management](./raynet-enterprise-sam.md) | **Active** | Attestation (Mode B) | Machine-readable, signed governance & audit verdicts over discovered AI assets |
| Agentic commerce | Planned | License verdict + resolvers | Permission + payment for agent-to-agent skill/API use |
| Skills monetization | Planned | License verdict + payment resolver | Paid, provable use of a skill/workflow |
| Content / IP licensing | Planned | License verdict + attestation | Grant *and* prove rights; verify terms were honored |

## Template for a new use case

1. **The problem** — what permission/proof question is unanswered today.
2. **The actors** — who is the Provider / Consumer / Authority.
3. **The mapping** — which payload type, what goes in `subject`/`policy`/`scope`,
   which resolvers (`{role, id}`).
4. **What stays out of core** — the extensions/resolvers used, so no schema is
   added.
5. **Commercial framing** — what is sold (the outcome), and the IP boundary.
