# Milestone Scope Freeze — W21 2026

**Decision date:** 2026-05-24  
**Owner:** Pandr UG / ProofMeta  
**Status:** Frozen — no scope changes without explicit re-freeze

---

## Chosen milestone: AI Usage & Rights Check (commercial wedge)

**One monetizable milestone for the next 2–3 weeks.** Everything else is explicitly out of scope.

### Why this over alternatives

| Option | Verdict | Reason |
|--------|---------|--------|
| **AI Checker live + first paid consults** | **Selected** | Code is done (`ai-checker`), PANDR links in place, fastest path to revenue signal and pilot conversations |
| Execution layer (x402 / Privy resolvers) | Deferred | Infrastructure without a live product surface; no buyer-facing offer yet |
| Scanner wedge (€49 report on proofmeta.com) | Deferred | Site migration incomplete; duplicates checker GTM without adding distribution |
| External protocol pilot (B2B SDK) | Deferred | Needs sales cycle + onboarding docs (P2 backlog); checker feeds pipeline first |

ProofMeta protocol work continues only where it **directly supports** the checker (envelope on submission, manifest endpoint). No new protocol primitives this milestone.

---

## In scope

| # | Deliverable | Success signal |
|---|-------------|----------------|
| 1 | **Production deploy** at `https://check.pandr.de` | Landing + intake + result page reachable; form submits persist to Supabase |
| 2 | **Vercel + env** | `DATABASE_URL`, `DIRECT_URL`, `PROVIDER_PRIVATE_KEY_HEX`, `NEXT_PUBLIC_APP_URL` configured; GitHub Action or manual deploy documented |
| 3 | **PANDR funnel** | pandr.de CTAs → checker (done); Calendly CTA on result page (done) |
| 4 | **First 5 completed screenings** | Real submissions with result IDs (internal + friendly pilots OK) |
| 5 | **Optional ProofMeta envelope** on submission | `requestId` populated when `PROVIDER_PRIVATE_KEY_HEX` set; not blocking launch |
| 6 | **One paid follow-up** | At least one Calendly booking attributed to checker result / PANDR offer page |

---

## Out of scope (explicit)

- Auth / user accounts / dashboard v2
- Custom tool suggestion queue (v1.1)
- Catalog admin UI or Supabase-backed catalog
- Stripe / x402 / Privy resolver completion
- Scanner page migration to proofmeta.com
- Solana PDA anchor resolver
- Legal calibration of risk scores (heuristic stays)
- PDF/email export of results
- Hauszertifikat or other Pandr product changes

---

## Timeline

| Week | Focus |
|------|--------|
| **W21 (now)** | Vercel login → deploy → domain `check.pandr.de` → smoke test E2E |
| **W22** | 5+ screenings, iterate copy/CTA from feedback, one paid consult |
| **W23** | Re-freeze: either deepen checker (auth, PDF) **or** first external SDK pilot |

---

## Success criteria (milestone done)

- [ ] `check.pandr.de` serves latest `main` of `ai-checker`
- [ ] Submission → `/result/[id]` works in production
- [ ] ≥ 5 completed screenings logged
- [ ] ≥ 1 Calendly booking from checker funnel
- [ ] No P0 bugs in intake (DE/EN, validation, mobile)

---

## Dependencies & blockers

| Blocker | Owner | Mitigation |
|---------|-------|------------|
| Vercel CLI not authenticated | Ops | `vercel login` or set `VERCEL_TOKEN` + GitHub secrets for workflow |
| Domain assignment | Ops | Attach `check.pandr.de` to Vercel project (DNS already on Vercel) |
| Supabase prod DB | Done for checker | Separate project `azmpqacgxjlljpubklar` |

---

## Re-freeze trigger

After success criteria met **or** W23 start — pick **one** of:

1. Checker v1.1 (auth, PDF, custom tools)
2. External SDK pilot (1 design partner)
3. Execution resolvers (x402 + Privy) for paid agent runs

Document the next choice in a new `MILESTONE-SCOPE-FREEZE.md` revision; do not stack all three.
