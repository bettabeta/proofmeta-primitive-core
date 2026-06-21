# Use Case — Raynet: Enterprise AI Asset Management

**Status:** Active (first reference use case).
**Reference application:** `agent-xray` (separate repo) — local, read-only
discovery of AI agents/tools on a machine.

## 1. The problem

Enterprise Software Asset Management (SAM) and IT discovery were built for a
world of installed software and licenses. **AI agents and tools are a new,
largely invisible asset class:** autonomous, plugin-based, often shadow-IT, with
data that can leave the EU. A config-only scan sees a fraction of reality;
standing-autonomous agents, MCP servers, scheduled jobs, and bypass permissions
go uncounted. Worse, even when discovered, there is no *machine-readable,
tamper-evident* way to say "this asset is (non-)compliant against our policy,
and here is the proof over time."

## 2. The actors

- **Authority** — the enterprise's governance function (the `agent-xray`
  scanner), signing with its own DID.
- **Subject** — each discovered AI asset (an agent, MCP tool, skill, scheduled
  job, installed AI CLI…).
- **Policy** — the organization's rulebook (EU residency, no shell-exec, no
  autonomous-unattended, sanctioned tools/destinations…).

There is no "request" here — nobody asks to be audited. This is exactly why the
**root attestation** (Mode B, §3.4.1) is the fit, not the license lifecycle.

## 3. The mapping (onto the existing core)

| SAM/governance concept | ProofMeta |
|---|---|
| Discovered AI asset | `subject` (`id`, optional `content_hash` of observed state, `host`) |
| Organization's rulebook | `policy.ref` (URL/hash of the policy doc) |
| Specific conditions applied | `policy.scope` → scope URLs (e.g. `…/scope/eu-residency-required`) |
| Compliance decision | `status`: `GRANTED` (compliant) / `DENIED` (non-compliant) / `SUSPENDED` (quarantined) / `REVOKED` (must remove) |
| Why | `reason` + free `evidence` (risk score, factors, rule ids) |
| Compliance over time | attestation **history chain** — hourly re-scans linked via `in_reply_to` → signed, ordered audit timeline |

The verdict is a normal Signed Envelope: anyone can re-verify it later with
`proofmeta validate`, offline, without trusting the scanner's database.

## 4. What stays out of the core

- No new payload type — reuses `status.update` (Mode B).
- No new core vocabulary — governance conditions are **scope URLs** (D11).
- No vendor schemas — any storage/anchor integration is a resolver (D9).
- `agent-xray`'s bespoke `evidence/v1` hash chain is **redundant** with the
  envelope chain and should be replaced by ProofMeta attestations (the
  convergence / "bridge" step). That is what makes it literally
  *"Raynet powered by ProofMeta"* rather than a look-alike.

## 5. What chain verification does NOT yet solve

Selling "compliance & audit" must not conflate "chain verified" with "audit
complete." Three questions are deliberately open (see
[`../attestation-extension-proposal.md`](../attestation-extension-proposal.md) §11):
policy-version constancy, observation-gap / continuity proof, and trustworthy
(anchored) timestamps. The chain is the **trust backbone**, not the whole audit.

## 6. Commercial framing & IP boundary

- **Sell the outcome**, not the protocol: AI tool inventory, AI agent discovery,
  usage risk, policy mapping, audit-ready evidence and reports — extending
  Raynet's existing catalog / SAM / Data Hub to the AI asset class.
- **Lead with the demo** (discovered tool → signed ProofMeta attestation →
  verifiable audit timeline), not the spec.
- **IP boundary:** ProofMeta core stays **Pandr UG** background IP (Apache-2.0,
  pre-existing) and is *licensed to* Raynet — not assigned. The Raynet-specific
  integration/connector may belong to Raynet. Keep `ProofMeta core` and
  `Raynet integration` cleanly separated.
