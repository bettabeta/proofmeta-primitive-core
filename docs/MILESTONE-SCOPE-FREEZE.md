# Milestone Scope Freeze — Security-first v1 Hardening

**Decision date:** 2026-09-04
**Owner:** Pandr UG / ProofMeta
**Status:** Frozen — no scope changes without explicit owner re-freeze
**Baseline:** `main` at `aaba41f014456a172d1341c43508fbec34562ba5`
**Release boundary:** breaking pre-v1 draft package line `0.3.0`; this milestone does not declare protocol v1 released

---

## Superseded freeze

This document replaces the stale W21 2026 **AI Usage & Rights Check** commercial-wedge milestone in full. Checker deployment, funnel, screenings, paid-consult, and other product work are not carried into this milestone. The only selected outcome is a fail-closed, interoperable security baseline for the smallest useful v1 protocol.

## Chosen milestone

**Security-first v1 protocol hardening.** Work is limited to eliminating release-blocking ambiguity and acceptance gaps in envelope authenticity, actor authority, untrusted-input validation, and reproducibility. New product capabilities do not enter scope.

The normative decisions are D16–D19 in `PROOFMETA_ANWEISUNG.md`. Normative authority must change before dependent schemas, SDKs, CLI behavior, fixtures, or examples.

---

## In scope

| # | Workstream | Required outcome |
|---|------------|------------------|
| 1 | **Authenticated signing projection** | All `0.3.0` producers sign, and all `0.3.0` verifiers reconstruct and verify, the JCS projection of `proofmeta`, `payload_hash`, `author`, `timestamp`, and optional `in_reply_to`; payload remains transitively authenticated by `payload_hash`. |
| 2 | **No downgrade fallback** | Legacy payload-hash-only signatures are never silently accepted as valid by the `0.3.0` path. Any explicit migration/inspection result is distinct from protocol validity and cannot enter lifecycle acceptance. |
| 3 | **v1 actor authorization** | Manifest author equals `provider.id`; OPEN author equals `consumer.id`; every license-chain `status.update` author equals the root request's `provider_id`. Resolver-authored license statuses fail closed pending v1.1 DID delegation. |
| 4 | **Context and status-mode semantics** | License chains and root attestations remain unambiguously separated; parent links, request context, mode-specific roots, subject constancy, and lifecycle transitions fail closed. |
| 5 | **Shared untrusted-input validation** | SDK, CLI, Provider, Consumer, and E2E paths apply one consistent schema/hash/signature/authority/chain decision model to externally supplied envelopes. |
| 6 | **JCS and JSON-ingress conformance** | Duplicate keys, unsupported numeric values, encoding edge cases, and canonicalization behavior are rejected or normalized only as the normative rules permit, consistently across entry points. |
| 7 | **Normative vectors and adversarial regressions** | Language-neutral vectors and tests cover payload mutation, timestamp mutation, parent-link rewiring, author mutation, attacker-authored status, Manifest/Provider mismatch, OPEN/Consumer mismatch, and anchors added/removed without changing Tier-1 signature validity. |
| 8 | **Reproducible release gates** | Workspace versions and lock metadata move coherently to `0.3.0`; clean install, package tarball smoke tests, full tests, E2E, and independent fail-closed review pass from a clean checkout. |
| 9 | **Normative/documentation reconciliation** | Security claims and examples touched by these workstreams use the locked D16–D18 semantics and do not describe legacy signing or direct resolver lifecycle authority as valid. |

---

## Explicitly out of scope

- Payment resolver implementation, payment flows, payment splitting, royalties, Stripe, x402, or Privy work
- Anchor resolver or anchor-type implementation, including Solana PDA, EVM, Arweave, and RFC 3161 integrations
- Tier-3 implementation or demo work; this milestone specifies only the trust boundary for optional anchor evidence
- Registries, directories, exploration networks, discovery marketplaces, or registry-dependent consumers
- ERC-7521 requirements, wrapping interfaces, contracts, or integrations
- New DID methods or direct resolver-signed lifecycle statuses; v1.1 DID delegation/authorization must be designed and re-frozen separately
- Canonical-domain publication, protocol-v1 release declaration, launch, marketing, checker, website-funnel, dashboard, or other product work
- New lifecycle states, resolver roles, payment/storage primitives, license-contract features, or unrelated refactors

Existing Tier-1 behavior may be changed only where necessary to enforce D16–D18 or the validation/reproducibility gates above.

---

## Ordered delivery gates

1. **Normative gate:** D16–D19 are present and contradictory authority prose is reconciled.
2. **RED gate:** adversarial tests demonstrate each known authenticity and authorization failure on the old behavior.
3. **Projection gate:** one canonical projection function and fixed cross-language vectors govern producers and verifiers.
4. **Authority gate:** Manifest, OPEN, and every license-chain status enforce the v1 signer rules.
5. **Validation gate:** all untrusted ingress paths share fail-closed context, mode, JCS, and JSON rules.
6. **Reproducibility gate:** versions/lockfiles align at `0.3.0`; full, E2E, clean-install, and tarball tests pass.
7. **Review gate:** a fresh independent adversarial review of the complete diff returns fail-closed approval with no unresolved security or normative contradiction.

A later gate may not weaken an earlier one. Passing tests alone does not authorize a v1 release claim.

---

## Milestone completion criteria

- [ ] Timestamp, author, protocol version, payload hash, and optional parent-link mutation invalidate the author signature.
- [ ] Payload mutation fails recomputed-hash comparison; payload remains transitively authenticated through the signed `payload_hash`.
- [ ] A legacy 0.2.x payload-hash-only signature cannot receive a valid 0.3.0 verification result through fallback.
- [ ] Manifest/Provider and OPEN/Consumer identity mismatches fail.
- [ ] Every non-Provider-authored `status.update` in a license chain fails, including a cryptographically valid Resolver or attacker signature.
- [ ] Root-attestation semantics remain distinct and are not accidentally subjected to the license-chain Provider rule.
- [ ] Adding, removing, or changing `anchors` does not alter Tier-1 signature validity, and unvalidated anchor presence contributes no trust.
- [ ] Shared validation behavior is consistent across SDK, CLI, demos, and E2E.
- [ ] Normative vectors, adversarial tests, full tests, E2E, clean install, and package tarball smoke tests pass.
- [ ] Package and lock metadata consistently identify `0.3.0` as a v1 draft package line.
- [ ] Independent fail-closed review passes after the final change.
- [ ] No excluded capability or release claim entered the milestone.

---

## Re-freeze trigger

Re-freeze only after all completion criteria pass, or when a newly discovered security issue requires changing this boundary. The next milestone must be chosen explicitly; excluded v1.1/v2 capabilities do not roll forward automatically.
