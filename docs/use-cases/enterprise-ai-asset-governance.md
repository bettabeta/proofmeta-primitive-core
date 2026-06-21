# Use Case — Enterprise AI Asset Governance

**Status:** Active (first reference use case).
**Reference service:** `agent-xray` — a service that uses ProofMeta: local,
read-only discovery of AI agents/tools on a machine, emitting signed
compliance verdicts.

## 1. The problem

Software Asset Management (SAM) and IT discovery were built for installed
software and licenses. **AI agents and tools are a new, largely invisible asset
class:** autonomous, plugin-based, often shadow-IT, with data that can leave the
EU. A config-only scan sees a fraction of reality; standing-autonomous agents,
MCP servers, scheduled jobs, and bypass permissions go uncounted. And even when
discovered, there is no *machine-readable, tamper-evident* way to state "this
asset is (non-)compliant against our policy, and here is the proof over time."

## 2. The actors

- **Authority** — the organization's governance function (the discovery
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
| Compliance over time | attestation **history chain** — periodic re-scans linked via `in_reply_to` → signed, ordered audit timeline |

The verdict is a normal Signed Envelope: anyone can re-verify it later with
`proofmeta validate`, offline, without trusting the scanner's database.

## 4. What stays out of the core

- No new payload type — reuses `status.update` (Mode B).
- No new core vocabulary — governance conditions are **scope URLs** (D11).
- No vendor schemas — any storage/anchor integration is a resolver (D9).
- A discovery service should emit ProofMeta attestations rather than maintain a
  bespoke tamper-evidence chain — the envelope chain already provides that.

## 5. What chain verification does NOT yet solve

Selling "compliance & audit" must not conflate "chain verified" with "audit
complete." Three questions are deliberately open (see
[`../attestation-extension-proposal.md`](../attestation-extension-proposal.md) §11):
policy-version constancy, observation-gap / continuity proof, and trustworthy
(anchored) timestamps. The chain is the **trust backbone**, not the whole audit.

## 6. Commercial framing & IP boundary

- **Sell the outcome**, not the protocol: AI tool inventory, AI agent discovery,
  usage risk, policy mapping, audit-ready evidence and reports — extending an
  existing SAM / IT-discovery / CMDB platform to the AI asset class.
- **Lead with the demo** (discovered tool → signed ProofMeta attestation →
  verifiable audit timeline), not the spec.
- **IP boundary:** the ProofMeta core stays the protocol author's background IP
  (Apache-2.0, pre-existing) and is *licensed to* adopters — not assigned.
  Keep "ProofMeta core" and any adopter-specific integration cleanly separated.
