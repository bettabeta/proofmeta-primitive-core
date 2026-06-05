# ProofMeta JSON Schemas

Canonical machine-readable schemas for [ProofMeta v1](https://github.com/bettabeta/proofmeta). Normative prose lives in [`PROOFMETA_ANWEISUNG.md`](https://github.com/bettabeta/proofmeta/blob/main/PROOFMETA_ANWEISUNG.md).

## Install

```
npm install @proofmeta/spec
```

```js
import {
  envelopeSchema,
  manifestPayloadSchema,
  licenseRequestPayloadSchema,
  statusUpdatePayloadSchema,
  payloadSchemas, // { manifest, "license.request", "status.update" }
} from "@proofmeta/spec";
```

## Shape

Every artifact in ProofMeta is a **Signed Envelope**. The outer wrapper is uniform; the payload inside varies by type.

```
envelope.schema.json  ──  payload ────┬──  payload.manifest.schema.json        (type: "manifest")
                                      ├──  payload.license-request.schema.json (type: "license.request")
                                      └──  payload.status-update.schema.json   (type: "status.update")
```

| File | Role |
|------|------|
| `envelope.schema.json` | Outer wrapper — required for every artifact. Defines `proofmeta`, `payload`, `payload_hash`, `author`, `signature`, `timestamp`, optional `in_reply_to`, `anchors`. |
| `payload.manifest.schema.json` | Provider License Manifest payload (published at `/.well-known/proofmeta.json`). |
| `payload.license-request.schema.json` | Consumer-signed OPEN envelope that starts a license lifecycle. |
| `payload.status-update.schema.json` | PENDING / GRANTED / DENIED / SUSPENDED / REVOKED envelopes signed by Provider (or Resolver, for PENDING). |

## Validation procedure

1. Validate the outer object against `envelope.schema.json`.
2. Read `payload.type` and validate `payload` against the matching payload schema.
3. Recompute `payload_hash` from the JCS (RFC 8785) canonicalization of `payload` and verify it matches.
4. Verify `signature` against `payload_hash` using the public key resolved from `author`.
5. If `in_reply_to` is present, verify that the referenced envelope exists and is the logical predecessor for this payload type (see §3.4).
6. For scope semantics in manifest payloads, see [`docs/scope-vocabulary.md`](https://github.com/bettabeta/proofmeta/blob/main/docs/scope-vocabulary.md).

Schemas are draft-07. The `$id` URLs are stable references; they are not required to resolve during validation.

## License

Apache-2.0. See [LICENSE](https://github.com/bettabeta/proofmeta/blob/main/LICENSE).
