#!/usr/bin/env node
// x402-conformance CLI — thin wrapper.
//   x402-conformance <baseURL> [--json]   measure a live x402 service
//   x402-conformance dev                  local full-exchange replay (zero funds)
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];

if (arg === "dev" || arg === "sandbox") {
  // Phase-1 "x402 dev": replay the full 402 -> sign -> retry -> receipt-verify
  // exchange locally against an embedded resource server. Zero funds, no deps.
  const r = spawnSync(process.execPath, [join(here, "sandbox.mjs")], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const target = arg ?? "https://code402.dev";
const args = [join(here, "runner.mjs"), target, ...process.argv.slice(3)];
const r = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
