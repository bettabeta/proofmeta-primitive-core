# ProofMeta

> **Layer:** Primitive
> **Depends on:** nothing
> **Guarantees:** Cryptographic integrity — Signed Envelopes, DID identity, JCS hashing, ed25519 signatures, status lifecycle.

> The permission layer for the agentic web — an open protocol that lets any AI agent discover, request, and use licensed items from any other AI agent, with machine-readable terms and a status lifecycle.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: v1 Draft](https://img.shields.io/badge/Status-v1_Draft-yellow)]()

[Website](https://www.proofmeta.com/) · [Manifest Generator](https://www.proofmeta.com/generate) · [Verifier](https://www.proofmeta.com/verify) · [Master Specification](./PROOFMETA_ANWEISUNG.md)

---

## Try ProofMeta in 60 seconds

No install, account, or email required:

1. [Verify proofmeta.com's own signed manifest](https://www.proofmeta.com/verify?url=/.well-known/proofmeta.json).
2. Inspect who signed it, which payload hash was signed, and which license scopes it declares.
3. [Open the Manifest Generator](https://www.proofmeta.com/generate) to create a key and build your own manifest locally in the browser.

The generator keeps the private key in your browser and self-checks the signed result. When you are ready to publish, host the downloaded file at `https://your-domain/.well-known/proofmeta.json`.

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

## Manifest shape

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
/site                   → Browser generator, verifier, and protocol website
/docs                   → Specification documentation
package.json            → npm workspaces (packages/*, examples/*)
.cursorrules            → Cursor IDE rules
```

## Implemented in the v1 draft

**ProofMeta v1 Draft — local B1 Version-P1/Z1 preparation: SDK/CLI 0.5.0, private demos 0.4.0; Spec 0.4.0 and free resolver 0.3.0 unchanged.** These are coherent local workspace versions, not a claim of published 0.5.0 tarballs or completed Acceptance hardening. The SDK root API remains available. Acceptance is the separate export `@proofmeta/sdk-ts/acceptance`, produced by `scripts/build-acceptance-validators.mjs`. Independent QA, final P2 runtime/packaging evidence and release approval remain open. The v1 draft has a working reference vertical slice. It is not yet a released v1: the canonical spec domain and the acceptance evidence listed in the master specification are still open. A Provider can stand up, a Consumer can request a license, and an envelope chain can be re-verified by anyone end-to-end — no platform, no chain, no coordination beyond the manifest URL.

- [x] Manifest spec (`payload.manifest.schema.json`)
- [x] License-request + status-update spec (`payload.license-request.schema.json`, `payload.status-update.schema.json`)
- [x] Status lifecycle: `OPEN → PENDING → {GRANTED | DENIED}`; from `GRANTED`: `SUSPENDED` or terminal `REVOKED`; from `SUSPENDED`: `GRANTED` or terminal `REVOKED`; `DENIED` is terminal.
- [x] TypeScript SDK (`@proofmeta/sdk-ts`) — ed25519 signing, JCS hashing, envelope + chain verification
- [x] Reference resolver interface + free-license implementation (`@proofmeta/resolvers`)
- [x] Demo Provider and Consumer agents (`examples/provider`, `examples/consumer`)
- [x] Validator CLI (`@proofmeta/cli` → `proofmeta validate <file>`)

Next: publish the v1 draft at the canonical spec domain, record the Provider/Consumer setup benchmarks, and add a normative cross-implementation test-vector corpus. Planned for v1.1: one payment resolver, one optional anchor resolver with a Tier-3 demo, and resolver-informed requirements for a future ERC-7521 wrapping interface; the formal interface remains deferred to v2.

## Bounded local install policy (Version-P1/Z1)

Use a trusted Node-compatible npm (locally tested Node 18.20.8 / npm 10.8.2), trusted tools/environment/user/global npm configuration, and a fresh checkout without root/workspace `node_modules`. Run from its root. **PRE must succeed before npm is launched**: npm 10.8.2 can execute workspace or `file:`-directory `prepare` even with `--ignore-scripts`. Post-install smoke alone cannot prevent that execution. Keep dependency lifecycle scripts disabled; no global config changes, global script allowance, `npm rebuild`, dependency `install.js`, network binary fallback or arbitrary postinstall execution is authorized:

```sh
node scripts/version-p1-install-smoke.mjs --preinstall &&
  npm ci --ignore-scripts --no-audit &&
  node scripts/version-p1-install-smoke.mjs &&
  npm run build &&
  NODE_OPTIONS=--experimental-global-webcrypto npm test &&
  npm audit
```

PRE uses only Node built-ins and raw JSON reads; it never imports dependencies, evaluates package scripts/config, invokes npm, regenerates the lock, or runs hooks. SHA-256 byte pins cover the audited root manifest, all six workspace manifests and the complete lockfile-v3 graph (39 exact-version/SRI registry tarballs and six approved workspace links). Every manifest/lock change, even formatting or a newly added hook, fails closed until a separate graph/hook audit updates the approved pins. Workspace wildcard entries are exactly consumer/provider/free; extra entries, symlinked manifest paths, root/workspace `.npmrc`, shrinkwrap, `binding.gyp` and pre-existing `node_modules` are rejected. Root/workspace install hooks (`preinstall`, `install`, `postinstall`, `prepublish`, `preprepare`, `prepare`, `postprepare`) are unsupported. The unchanged SDK `prepublishOnly` is publication-only, not enabled or invoked by this sequence. Only the already audited registry tarball graph plus these approved local workspaces is supported: other local directories, local `.tgz`, git, URL, alternate registry, alias or changed hook/graph topologies are rejected. The local `.tgz` malicious-hook fixture is a suppression control for npm, **not** an allowed PRE graph.

This is a bounded admission policy, **not an arbitrary malicious-checkout or TOCTOU sandbox**. The guard itself, tools, environment/config outside the checkout, and checkout contents remaining unchanged between PRE and ci are trust prerequisites. A modified guard or racing writer is not contained. Registry integrity pins are checked by npm during ci, not downloaded/verified by PRE; the audited esbuild registry postinstall remains skipped. PRE success reports graph admission and `npmLaunched: false`, not a completed install; post-smoke reports only that it did not invoke dependency lifecycle scripts, not retrospective proof that none ran. Build/test explicitly execute trusted project commands and are distinct from install suppression. Independent QA of this exact correction remains open.

The scoped smoke is explicitly **Linux x64 only**, not the P2 runtime/platform matrix. It checks the pinned install graph and invokes only the installed optional `@esbuild/linux-x64` executable plus esbuild's transform API to verify version 0.28.2. esbuild's declared `node install.js` postinstall remains skipped; npm installs the platform optional package from the integrity-pinned lock. Do not omit optional dependencies. If the binary is missing, mismatched or an alternate `ESBUILD_BINARY_PATH` is set, fail rather than enabling scripts or downloading a fallback. Other platforms need separately scoped checks/approval. The crypto flag above is command-local, existing Node 18 behavior remains an open support question.

Preserve third-party copyright/license texts with any redistributed dependency, binary or future generated/bundled validator; the SDK [pinned-artifact notices](packages/sdk-ts/THIRD-PARTY-NOTICES.md) carry those texts. esbuild platform tarballs declare MIT but do not include separate license text; the esbuild parent MIT notice covers them. No browser validator is generated or distributed by this preparation. Local install evidence does not establish P2 external-tarball installation, full runtime matrix, independent QA or release approval.

## License


Copyright © 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)

This project is licensed under the Apache License 2.0  see the [LICENSE](LICENSE) file for details.
