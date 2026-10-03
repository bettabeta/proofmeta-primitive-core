// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Reference ProofMeta Provider Agent.
 *
 * Zero external dependencies beyond the SDK and the free resolver. Uses
 * Node's built-in `http` server. Demonstrates a Tier-1 end-to-end flow:
 *
 *   GET  /.well-known/proofmeta.json             → signed Manifest envelope
 *   POST /api/proofmeta/request                  → accepts OPEN envelope,
 *                                                  returns the resulting
 *                                                  chain (PENDING + GRANTED)
 *   GET  /api/proofmeta/request/:request_id      → latest envelope for this
 *                                                  lifecycle (?full=true →
 *                                                  whole chain)
 *
 * Everything is signed. Everything is verifiable.
 */

import http from "node:http";
import { createHash } from "node:crypto";
import {
  generateKeyPair,
  createEnvelope,
  updateStatus,
  verifyEnvelope,
} from "@proofmeta/sdk-ts";
import { createFreeResolver } from "@proofmeta/resolver-free";

// ── Config ────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4100);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? `http://${HOST}:${PORT}`;

// ── State ────────────────────────────────────────────────────────────────

/** @type {Map<string, import("@proofmeta/sdk-ts").Envelope[]>} */
const chains = new Map(); // request_id → [OPEN, PENDING, GRANTED, ...]
// Process-local one-shot reservations are separate from published chains.
// Keep IDs even on processing failure; retry requires a new ID. Restarting
// this process clears reservations; this is not multi-instance replay protection.
const reservedRequestIds = new Set();

// ── Bootstrap: keypair, resolvers, manifest ───────────────────────────────

const keypair = await generateKeyPair();
const freeResolver = createFreeResolver({ id: "none" });

const licenseTypes = [
  {
    id: "free-attribution",
    name: "Free with Attribution",
    terms_url: `${PUBLIC_ORIGIN}/terms/free-attribution.txt`,
    // In production the Provider computes this over the real license text.
    terms_hash: `sha256:${"0".repeat(64)}`,
    scope: ["non-commercial", "attribution-required", "derivative-allowed"],
  },
];

// Deterministic demo bytes representing the skill pack. A real Provider would
// hash the actual tarball/zip/file served at delivery.url.
const skillPackBytes = Buffer.from(
  "ProofMeta demo skill pack — cost-optimizer-skill@0.1 — deterministic fixture",
  "utf-8",
);
const skillPackContentHash = `sha256:${createHash("sha256").update(skillPackBytes).digest("hex")}`;

const inlineItems = [
  {
    item_id: "cost-optimizer-skill@0.1",
    name: "Cost-Optimizer Skill",
    description:
      "Claude skill pack that analyzes LLM configs and proposes cost-reducing edits. Validated on ProofMeta Scanner telemetry (40–70% cost reduction, ~€105/month avg savings).",
    available_licenses: ["free-attribution"],
    content_hash: skillPackContentHash,
    metadata: { format: "skill-pack", version: "0.1.0" },
  },
];

const manifestEnvelope = await createEnvelope({
  payload: {
    type: "manifest",
    provider: {
      id: keypair.did,
      name: "ProofMeta Reference Provider",
      description: "Tier-1 end-to-end demo per §9 Success Criterion #3.",
    },
    request_endpoint: `${PUBLIC_ORIGIN}/api/proofmeta/request`,
    items: inlineItems, // inline variant — no separate catalog endpoint needed
    resolvers: [freeResolver.descriptor],
    license_types: licenseTypes,
  },
  author: keypair.did,
  privateKey: keypair.privateKey,
});

const licenseTypesById = new Map(licenseTypes.map((lt) => [lt.id, lt]));

console.log(`[provider] DID: ${keypair.did}`);
console.log(`[provider] Listening on ${PUBLIC_ORIGIN}`);

// ── HTTP server ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", PUBLIC_ORIGIN);

    if (req.method === "GET" && url.pathname === "/.well-known/proofmeta.json") {
      return json(res, 200, manifestEnvelope);
    }

    if (req.method === "POST" && url.pathname === "/api/proofmeta/request") {
      return await handleRequest(req, res);
    }

    const getMatch = url.pathname.match(/^\/api\/proofmeta\/request\/([^/]+)$/);
    if (req.method === "GET" && getMatch) {
      return await handleGetStatus(res, getMatch[1], url.searchParams.get("full") === "true");
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("[provider] error:", err);
    return json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, HOST);

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const body = await readJson(req);
  if (!body) return json(res, 400, { error: "empty body" });

  // 1. Verify the OPEN envelope cryptographically.
  const v = await verifyEnvelope(body);
  if (!v.ok) return json(res, 400, { error: `invalid envelope: ${v.reason}` });

  const p = body.payload;
  if (p?.type !== "license.request" || p?.status !== "OPEN") {
    return json(res, 400, { error: "payload.type/status not license.request/OPEN" });
  }

  // 2. Business-level validation.
  if (p.provider_id !== keypair.did) {
    return json(res, 400, { error: "provider_id does not match this provider — replay-rejection" });
  }
  if (p.consumer?.id !== body.author) {
    return json(res, 400, { error: "consumer.id must match envelope.author" });
  }
  const lt = licenseTypesById.get(p.license_type);
  if (!lt) return json(res, 400, { error: `unknown license_type: ${p.license_type}` });
  if (p.terms_hash !== lt.terms_hash) {
    return json(res, 400, { error: "terms_hash mismatch" });
  }
  const item = inlineItems.find((i) => i.item_id === p.item_id);
  if (!item) return json(res, 400, { error: `unknown item_id: ${p.item_id}` });
  if (!item.available_licenses.includes(p.license_type)) {
    return json(res, 400, { error: "item does not offer this license_type" });
  }

  // 3. Check and reserve synchronously after validation, before processing awaits.
  if (reservedRequestIds.has(p.request_id)) {
    return json(res, 409, { error: "request_id already seen" });
  }
  reservedRequestIds.add(p.request_id);

  // 4. Sign PENDING — updateStatus wires in_reply_to + request_id from the prior envelope.
  const pending = await updateStatus(body, "PENDING", keypair.did, keypair.privateKey, {
    note: "payment resolver starting",
  });
  const chain = [body, pending];

  // 5. Invoke the free resolver.
  const resolverResult = await freeResolver.process({ request: p, licenseType: lt });
  if (!resolverResult.ok) {
    const denied = await updateStatus(pending, "DENIED", keypair.did, keypair.privateKey, {
      note: resolverResult.reason,
    });
    chain.push(denied);
    chains.set(p.request_id, chain);
    return json(res, 200, { chain });
  }

  // 6. Sign GRANTED.
  const granted = await updateStatus(pending, "GRANTED", keypair.did, keypair.privateKey, {
    note: "free license — payment skipped",
    delivery: {
      method: "https",
      url: `${PUBLIC_ORIGIN}/deliver/${p.request_id}`,
    },
    resolver_receipt: resolverResult.receipt,
  });
  chain.push(granted);
  chains.set(p.request_id, chain);

  return json(res, 200, { chain });
}

async function handleGetStatus(res, requestId, full) {
  const chain = chains.get(requestId);
  if (!chain) return json(res, 404, { error: "unknown request_id" });
  if (full) return json(res, 200, { chain });
  return json(res, 200, chain[chain.length - 1]);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (e) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Graceful shutdown for clean e2e-test exit.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
