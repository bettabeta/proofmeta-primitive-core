# @proofmeta/sdk-ts

Reference TypeScript SDK for the [ProofMeta Protocol](https://github.com/bettabeta/proofmeta). Create, sign, and verify the four primitives of the protocol: manifests, license requests, status updates, and the `in_reply_to` chains that connect them.

Chain-agnostic. No payment, delivery, or anchor code in core — those live behind the resolver interface in their own packages.

## Install

```
npm install @proofmeta/sdk-ts
```

## API surface

Four functions cover the entire v1 protocol:

```ts
import {
  generateKeyPair,
  createEnvelope,
  verifyEnvelope,
  verifyChain,
} from "@proofmeta/sdk-ts";

// did:key + ed25519 keypair
const kp = await generateKeyPair();
// → { did: "did:key:z6Mk...", publicKey, privateKey }

// Sign any payload into a Signed Envelope
const envelope = await createEnvelope({
  payload: { type: "manifest", /* ... */ },
  author: kp.did,
  privateKey: kp.privateKey,
});

// Verify schema version + payload_hash + signature
const v = await verifyEnvelope(envelope);
// → { ok: true } or { ok: false, reason: "..." }

// Verify a lifecycle chain (OPEN → PENDING → GRANTED/DENIED/SUSPENDED …)
const c = await verifyChain([open, pending, granted]);
```

## What gets verified

`verifyEnvelope` checks three things:

1. `proofmeta: "1.0"`.
2. `payload_hash === sha256(JCS(payload))` — recomputed from scratch, not trusted from the envelope.
3. `signature` is a valid ed25519 signature over the `payload_hash` string.

`verifyChain` additionally checks that every `in_reply_to` matches the prior envelope's `payload_hash`, the root has no `in_reply_to`, all `request_id`s in the chain agree, and status transitions follow the allowed lifecycle (including `SUSPENDED` / reinstatement). Use `isCurrentlyValid(chain)` for read-time validity; expiry is derived from optional `valid_until` on `GRANTED` envelopes, not a stored status.

## Canonicalization

Payloads are canonicalized per [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) before hashing, so two envelopes with different key orders but the same semantic payload have the same `payload_hash`.

## Identity

v1 requires `did:key` with ed25519. Other DID methods can be supported by passing a `resolveAuthor(did)` callback to `verifyEnvelope`.

## License

Apache-2.0. See [LICENSE](https://github.com/bettabeta/proofmeta/blob/main/LICENSE).
