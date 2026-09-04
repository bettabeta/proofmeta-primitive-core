// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

/**
 * Argv parsing for the `proofmeta` CLI. Keep this file dumb — actual
 * validation logic lives in src/validate.mjs so tests can exercise it
 * without spawning a subprocess.
 */

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { validateInput, formatReport } from "./validate.mjs";

const { version: CLI_VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

const USAGE = `proofmeta — ProofMeta reference validator

Usage:
  proofmeta validate <file>          Validate a single envelope or chain (JSON file).
  proofmeta validate <file> --json   Emit the verification report as JSON.
  proofmeta --help                   Show this help.
  proofmeta --version                Print the CLI version.

Input file may contain:
  - a single envelope object, OR
  - an array of envelopes (treated as a chain in the given order).

The validator checks:
  1. JSON Schema compliance (envelope + payload shape for known payload types).
  2. payload_hash matches sha256(JCS(payload)).
  3. ed25519 signature over payload_hash.
  4. For arrays: in_reply_to integrity and request_id consistency.
`;

export async function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`proofmeta ${CLI_VERSION}\n`);
    return 0;
  }

  if (argv[0] !== "validate") {
    process.stderr.write(`proofmeta: unknown command: ${argv[0]}\n\n`);
    process.stderr.write(USAGE);
    return 2;
  }

  const rest = argv.slice(1);
  let file;
  let json = false;
  for (const arg of rest) {
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      return 0;
    } else if (arg.startsWith("--")) {
      process.stderr.write(`proofmeta validate: unknown flag: ${arg}\n`);
      return 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      process.stderr.write(`proofmeta validate: unexpected argument: ${arg}\n`);
      return 2;
    }
  }

  if (file === undefined) {
    process.stderr.write("proofmeta validate: missing <file> argument\n");
    return 2;
  }

  let raw;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    process.stderr.write(`proofmeta validate: cannot read ${file}: ${err.message}\n`);
    return 2;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`proofmeta validate: ${file} is not valid JSON: ${err.message}\n`);
    return 2;
  }

  const report = await validateInput(parsed);

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatReport(report, file));
  }

  return report.ok ? 0 : 1;
}
