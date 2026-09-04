import { test } from "node:test";
import assert from "node:assert/strict";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex } from "@noble/hashes/utils";
import {
  createEnvelope,
  generateKeyPair,
  verifyEnvelope,
  verifyChain,
} from "../dist/index.js";
import { jcs } from "../dist/jcs.js";
import { hashPayload } from "../dist/hash.js";

ed25519.etc.sha512Sync = (...msgs) => sha512(ed25519.etc.concatBytes(...msgs));

test("verifyEnvelope rejects missing timestamp", async () => {
  const consumer = await generateKeyPair();
  const payload = {
    type: "manifest",
    provider: { id: consumer.did },
    request_endpoint: "http://x",
    license_types: [],
  };
  const payload_hash = hashPayload(payload);
  const projection = {
    proofmeta: "1.0",
    payload_hash,
    author: consumer.did,
  };

  const msg = new TextEncoder().encode(jcs(projection));
  const sigBytes = ed25519.sign(msg, consumer.privateKey);
  const signature = "ed25519:" + bytesToHex(sigBytes);
  const envelopeWithoutTimestamp = {
    proofmeta: "1.0",
    payload,
    payload_hash,
    author: consumer.did,
    signature,
  };

  const result = await verifyEnvelope(envelopeWithoutTimestamp);
  assert.equal(result.ok, false);
  assert.match(result.reason, /timestamp/i);
});

test("verifyChain rejects missing provider_id in root OPEN", async () => {
  const consumer = await generateKeyPair();
  const attacker = await generateKeyPair();
  const openEnvelope = await createEnvelope({
    payload: {
      type: "license.request",
      status: "OPEN",
      request_id: "req-1",
      consumer: { id: consumer.did },
      item_id: "i1",
      license_type: "l1",
      terms_hash:
        "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    },
    author: consumer.did,
    privateKey: consumer.privateKey,
  });
  const grantedEnvelope = await createEnvelope({
    payload: {
      type: "status.update",
      status: "GRANTED",
      request_id: "req-1",
    },
    author: attacker.did,
    privateKey: attacker.privateKey,
    in_reply_to: openEnvelope.payload_hash,
  });

  const result = await verifyChain([openEnvelope, grantedEnvelope]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /provider_id/i);
});
