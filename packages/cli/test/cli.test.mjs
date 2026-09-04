// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

test("--version matches the CLI package version", () => {
  const result = spawnSync(
    process.execPath,
    [new URL("../bin/proofmeta.mjs", import.meta.url).pathname, "--version"],
    { encoding: "utf-8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `proofmeta ${packageJson.version}\n`);
});
