# Proposal — Policy Attestations (rootable status)

**Status:** Accepted & merged to `main` (2026-06-21, via `feat/policy-attestations`; freeze window from `MILESTONE-SCOPE-FREEZE.md` has elapsed). Decision recorded as D14 in `PROOFMETA_ANWEISUNG.md` §10; spec text in §3.4.1. Full test suite green: licensing behaviour unchanged, backward-compat proven. Phases 1–3 done; Phase 4 (agent-xray emits attestations) is downstream in the agent-xray repo.
**Date:** 2026-06-21
**Owner:** Pandr UG / ProofMeta
**Proposed decision entry:** D14 (see §10 of [`PROOFMETA_ANWEISUNG.md`](../PROOFMETA_ANWEISUNG.md))
**Version impact:** Additive → **v1.1** (minor bump). No breaking change.

---

## 1. Why this exists

ProofMeta v1 models a **bilateral licensing transaction**: a Consumer *requests* a license, a Provider *grants/denies* it. The status lifecycle (`GRANTED / DENIED / SUSPENDED / REVOKED`) is therefore always anchored to a prior `license.request` (OPEN root).

A second, structurally identical use case exists — **policy / governance verdicts**:

> An authority (e.g. an enterprise governance scanner) observes a subject (an AI tool, an asset, an action) and asserts a signed verdict about it against a named policy — *without anyone having requested anything*.

This is the same shape — **rulebook + signed verdict with history** — and needs **no new primitive**. The decision is already the status; the conditions are already expressible as scope URLs (D11); the tamper-evident audit trail is already the envelope chain. The *only* thing v1 lacks is the ability for a status to **stand alone** (be a root) instead of replying to a request.

## 2. What changes (and what explicitly does not)

| | Change |
|---|---|
| **`payload.status-update.schema.json`** | `request_id` moves out of top-level `required`; add `subject` + `policy` properties; add a `oneOf` that makes a status **either** a chained licensing verdict (`request_id`) **or** a root attestation (`subject` + `policy`), never both. |
| **Spec prose** (`PROOFMETA_ANWEISUNG.md` §3.4) | Document the two status *modes*: *chained verdict* (existing) and *root attestation* (new). |
| **SDK** (`lifecycle.ts`, Phase 2) | Additive branch: a status MAY be a root when it carries `subject` and no `in_reply_to`. Existing OPEN→…→status logic untouched. New helper `createAttestation()`. |
| **CLI** (Phase 3) | Accepts attestations automatically once the schema is updated. |
| **NOT touched** | `envelope.schema.json`, `payload.manifest.schema.json`, `payload.license-request.schema.json`, DID/ed25519, JCS hashing, the core scope vocabulary. |

## 3. The two status modes (§3.4 addition)

A `status.update` payload is valid in exactly one of two modes:

**Mode A — Chained verdict (licensing, unchanged):**
- Carries `request_id` matching the OPEN `license.request`.
- Envelope carries `in_reply_to` pointing at the previous envelope in the lifecycle.
- This is v1 behaviour, fully preserved.

**Mode B — Root attestation (governance, new):**
- Carries `subject` (what is judged) and `policy` (which rulebook), **no** `request_id`.
- The first verdict on a subject is a **root** — envelope omits `in_reply_to`.
- A re-evaluation (re-scan) is a follow-up attestation whose `in_reply_to` points at the previous attestation on the same subject → the verdict history of a subject is a signed, ordered chain (audit trail for free).

## 4. Backward-compatibility guarantee — and how it is proven

The schema is changed with a `oneOf`, **not** by loosening a required field:

```
"oneOf": [
  { "required": ["request_id"] },        // Mode A — licensing
  { "required": ["subject", "policy"] }   // Mode B — attestation
]
```

This **preserves licensing strictness** rather than weakening it:

| Message | Mode A branch | Mode B branch | Result | vs v1 |
|---|---|---|---|---|
| Existing licensing verdict (`request_id` present) | ✅ matches | ✗ | **Valid** | unchanged |
| Malformed licensing verdict (no `request_id`, no `subject`) | ✗ | ✗ | **Rejected** | unchanged (still rejected) |
| New governance attestation (`subject`+`policy`, no `request_id`) | ✗ | ✅ matches | **Valid** | new capability |
| Mixed (`request_id` **and** `subject`) | ✅ | ✅ | **Rejected** (oneOf = exactly one) | clean separation enforced |

**Proof obligation (the "nothing breaks" evidence):**
1. The **entire existing test suite stays green, untouched** — `sdk-ts` (envelope/lifecycle/jcs), `cli` validate, provider rejection test, `scripts/e2e.mjs`.
2. New tests are added **only in new files**, never editing existing tests.
3. One explicit regression test asserts row 2 above: *a status.update with neither `request_id` nor `subject` is still rejected* — this is what proves we did not merely make `request_id` optional.

## 5. Verdict semantics (status enum reused — decision: reuse)

The existing enum is reused so machines need one vocabulary. Meanings in attestation context (by analogy, documented):

| Status | Licensing meaning | Attestation meaning |
|---|---|---|
| `PENDING` | request under review | subject under evaluation |
| `GRANTED` | you may use the item | subject is **compliant / permitted** |
| `DENIED` | you may not | subject is **non-compliant / blocked** |
| `SUSPENDED` | license paused | subject **quarantined**, pending review |
| `REVOKED` | license withdrawn | subject **must be removed** / access withdrawn |

## 6. Policy conditions = scope URLs (reuses D11, no core change)

Governance conditions are expressed as scope URL extensions — the mechanism already decided in D11. Examples:
`https://pandr.de/scope/eu-residency-required`, `https://pandr.de/scope/no-shell-exec`, `https://pandr.de/scope/no-autonomous-unattended`.
The normative core vocabulary is **not** extended.

## 7. Proposed payload fields (Mode B)

- `subject` — object: `{ id (required), content_hash?, host? }` — what is judged.
- `policy` — object: `{ ref (URL and/or sha256 of the rulebook), scope?: string[] }` — which rulebook + which conditions applied.
- `verdict` carried in the existing `status` field (no new field).
- `reason` — reuse existing field (already required on SUSPENDED/REVOKED).
- `evidence?` — optional free object (risk score, factors, rule ids); rides along under existing `additionalProperties: true`.
- `valid_until?` — reuse existing field (re-scan cadence).

## 8. Phased rollout

- **Phase 0 — done.** Capture the design (this document).
- **Phase 1 — done (branch `feat/policy-attestations`).** `payload.status-update.schema.json` carries the `oneOf` (Mode A `request_id` / Mode B `subject`+`policy`); schema regression tests in `packages/cli/test/attestation-schema.test.mjs` prove backward-compat (Mode A still validates, NEITHER still rejected, BOTH rejected).
- **Phase 2 — done (branch).** SDK ships `createAttestation()` (additive, with optional `in_reply_to` for re-evaluations) + types (`AttestationSubject`, `AttestationPolicy`; `request_id` now optional). Attestation *history chains* are validated: `verifyChain` routes an attestation-rooted chain to the new `validateAttestationChain()` (and `isAttestationEnvelope()`), while a license-rooted chain still uses `validateStatusTransitions()` unchanged. Attestation chain semantics: free transitions (no illegal moves, no terminal states — a subject may flip compliant↔non-compliant over time), subject-id constant across the chain, reason required on SUSPENDED/REVOKED.
- **Phase 3 — done.** CLI `validate` accepts attestations: a single attestation via the updated schema (schema + hash + signature), and an attestation history chain — the transitions check is routed by chain kind (`isAttestationEnvelope` → `validateAttestationChain`), mirroring `verifyChain`. Tested in `packages/cli/test/attestation-validate.test.mjs`.
- **Phase 4 — convergence (separate repo, agent-xray), not started.** Emit attestation envelopes; retire `evidence.py`'s redundant hash chain.
- **Merge gate.** Hold on `main` until the scope freeze lifts; then review + merge `feat/policy-attestations`.

## 9. Out of scope

- Payment / resolver completion.
- Any new core scope tag.
- Any change to manifest, license-request, or envelope schemas.
- A separate `policy.verdict` / `audit.event` payload type (explicitly rejected: reusing `status.update` keeps one vocabulary; see §2).

## 10. Proposed §10 decision entry

> **D14 — How standalone policy verdicts are expressed.** A `status.update` MAY be a **root attestation**: instead of `request_id` + `in_reply_to`, it carries `subject` + `policy` and is signed by the asserting authority. A `oneOf` in the status schema makes the two modes mutually exclusive, so existing licensing verdicts validate unchanged and the absence of `request_id` is only valid when `subject` + `policy` are present. The status enum and scope-URL mechanism (D11) are reused; no new payload type or core vocabulary. Attestation history chains use free transitions (no terminal states) with a constant subject. See §3.4 and `docs/attestation-extension-proposal.md`. *(Date: TBD on acceptance.)*

## 11. Open audit questions (NOT solved by chain verification)

Chain verification proves the verdicts are **linked, signed, ordered, and about one subject**. That is the trust backbone — it is **not** the whole enterprise-audit story. Selling "compliance & audit" on top of this must not conflate "chain verified" with "audit complete." Three deeper questions remain explicitly open and are deliberately **not** enforced by `validateAttestationChain`:

1. **Policy-version constancy.** A chain locks the subject, not the policy. If the rulebook changes mid-period, the chain does not record *which policy version applied when*. Auditors ask this. Options (future): require `policy.ref` to carry a version/hash and decide whether it may change across a chain, or branch the chain on policy change.
2. **Observation-gap / continuity proof.** The chain shows a sequence of *verdicts*, not proof of *continuous observation*. It cannot answer "prove you were watching the whole time, not only when convenient." Needs signed heartbeat / no-change attestations plus an expected cadence — a separate mechanism.
3. **Trustworthy timestamps.** Ordering comes from `in_reply_to`; the `timestamp` is self-asserted by the author. For audit, *when* matters, and self-asserted time is weak. This is Tier-3 anchor territory (RFC 3161, on-chain anchors via the existing optional `anchors` field) — not addressed by chain linking.

These are tracked here so the gap is visible before the offering is positioned as audit-grade.
