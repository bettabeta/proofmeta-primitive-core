# @proofmeta/cli

Reference validator CLI for the [ProofMeta Protocol](https://github.com/bettabeta/proofmeta). Point it at any signed envelope or chain; it tells you whether it would pass an honest Provider or Consumer.

## Use

```
npx @proofmeta/cli validate path/to/envelope.json
npx @proofmeta/cli validate path/to/chain.json --json
```

Or install it:

```
npm install -g @proofmeta/cli
proofmeta validate manifest.json
```

The input file can be a single envelope object **or** an array of envelopes (treated as a chain in the given order).

## What it checks

1. **JSON Schema compliance** — the envelope, and the payload dispatched on `payload.type` (`manifest` | `license.request` | `status.update`).
2. **`payload_hash` correctness** — recomputed from scratch as `sha256(JCS(payload))` using the reference SDK, then compared to what the envelope claims.
3. **Signature and actor validity** — Ed25519 signature over the UTF-8 JCS projection of `proofmeta`, `payload_hash`, `author`, `timestamp`, and optional `in_reply_to` (excluding `anchors`), plus manifest Provider and OPEN Consumer author checks.
4. **Chain integrity and authority** (array input) — every `in_reply_to` matches the previous envelope's `payload_hash`; the root has no `in_reply_to`; all `request_id`s agree; and every license status is authored by the root OPEN's Provider.

## Example

```
$ curl -s https://example.com/.well-known/proofmeta.json > manifest.json
$ proofmeta validate manifest.json
proofmeta validate manifest.json — envelope (1 envelope)
  [OK]   envelope payload.type=manifest
    [OK]   schema
    [OK]   payload_hash
    [OK]   signature

OK
```

Exit code: `0` on OK, `1` on validation failure, `2` on usage / IO error.

## JSON mode

`--json` emits a structured report for machine consumers (CI, dashboards, other agents):

```json
{
  "ok": true,
  "kind": "envelope",
  "envelopes": [
    { "index": 0, "ok": true, "payload_type": "manifest", "schema": { "ok": true, "errors": [] }, "hash": { "ok": true }, "signature": { "ok": true } }
  ]
}
```

## License

Apache-2.0. See [LICENSE](https://github.com/bettabeta/proofmeta/blob/main/LICENSE).
