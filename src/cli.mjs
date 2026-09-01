#!/usr/bin/env node
// x402-conformance CLI — thin wrapper: x402-conformance <baseURL> [--json]
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? "https://code402.dev";
const args = [join(here, "runner.mjs"), target, ...process.argv.slice(3)];
const r = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
