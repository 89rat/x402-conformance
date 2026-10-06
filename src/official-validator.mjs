#!/usr/bin/env node
// official-validator.mjs — check a live x402 challenge against the VENDOR'S OWN schemas.
//
// Why this exists: src/runner.mjs validates challenges with this suite's hand-rolled checks.
// That is fine for our own gates, but doctrine requires 1:1 publication discipline for
// third-party scores — a conformance verdict should come from the vendor's validator, not our
// reading of the spec. @x402/core ships exactly that (PaymentRequiredV1Schema/V2Schema,
// isPaymentRequiredV1/V2, validatePaymentRequirements).
//
// This package is deliberately ZERO-DEPENDENCY, so the vendor module is loaded OPTIONALLY:
// resolved from our own node_modules, else from the current working directory's. If it cannot
// be found the script reports UNASSESSED (exit 3) — it never guesses and never fails a caller
// for our missing dependency. Same discipline as runner.mjs, which SKIPs what it cannot verify.
//
// Usage: node src/official-validator.mjs [challenge-url] [--json]

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const JSON_MODE = args.includes("--json");
const URL_ARG = args.find((a) => a.startsWith("http")) ?? "https://hcrb.in/v1/tools/iban-check/call";

// Load the vendor validator without adding a dependency. createRequire resolves a bare
// specifier against the base we give it, so trying the CWD base lets this run inside any
// project that happens to have @x402/core installed (e.g. a payer spike directory).
function loadOfficial() {
  const bases = [import.meta.url, pathToFileURL(join(process.cwd(), "noop.js")).href];
  for (const base of bases) {
    try {
      const req = createRequire(base);
      const mod = req("@x402/core/schemas");
      if (mod && typeof mod.isPaymentRequiredV1 === "function") return { mod, from: base };
    } catch { /* try the next base */ }
  }
  return null;
}

const official = loadOfficial();
if (!official) {
  const note = "@x402/core not resolvable from this package or the CWD";
  if (JSON_MODE) console.log(JSON.stringify({ status: "UNASSESSED", reason: note }, null, 2));
  else {
    console.log(`⏭️  UNASSESSED — ${note}`);
    console.log("    Install it where this runs (e.g. `npm i @x402/core` or run from a dir that has it)");
    console.log("    to get a vendor-authoritative verdict. No verdict is being guessed.");
  }
  process.exit(3);
}

const { isPaymentRequiredV1, isPaymentRequiredV2, validatePaymentRequirements } = official.mod;

// Estate probes MUST mark themselves, or they land in the demand funnel as if the world had
// called. Verified 2026-10-06: three unmarked 402 fetches moved /status distinct_callers 91 -> 94,
// challenges_issued 5849 -> 5853 and free_calls 140 -> 143; three marked ones moved all three by
// exactly zero. A funnel that counts our own probes cannot answer "is there demand?".
// The token is a secret: read it, send it, never print it.
const SELF_TOKEN = process.env.SELF_TRAFFIC_TOKEN || (() => {
  // The estate root is NOT always under the user's home (this estate lives at C:\.claude), so
  // try explicit candidates rather than assuming one layout. Never print the value.
  const candidates = [
    process.env.SELF_TRAFFIC_TOKEN_FILE,
    join(homedir(), ".claude", ".secrets", "self-traffic.key"),
    "C:/.claude/.secrets/self-traffic.key",
    join(process.cwd(), ".secrets", "self-traffic.key"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const t = readFileSync(p, "utf8").trim();
      if (t) return t;
    } catch { /* try the next candidate */ }
  }
  return "";
})();

const headers = { "content-type": "application/json", "x-force-402": "true" };
if (SELF_TOKEN) headers["x-code402-self"] = SELF_TOKEN;

const res = await fetch(URL_ARG, { method: "POST", headers, body: JSON.stringify({ input: { iban: "GB82WEST12345698765432" } }) });
if (res.status !== 402) {
  console.error(`Expected a 402 challenge from ${URL_ARG}, got HTTP ${res.status}`);
  process.exit(1);
}

const body = await res.json();
const headerB64 = res.headers.get("payment-required");
const v2 = headerB64 ? JSON.parse(Buffer.from(headerB64, "base64").toString("utf8")) : null;

const checks = [];
const add = (name, pass, note = "") => checks.push({ name, pass, note });

add("body parses as an x402 v1 challenge", isPaymentRequiredV1(body) === true);
if (v2) add("PAYMENT-REQUIRED parses as an x402 v2 challenge", isPaymentRequiredV2(v2) === true);
else add("PAYMENT-REQUIRED header present", false, "absent — v2 clients have nothing to read");

// Per-accept: the vendor's validator is what a client runs before signing.
for (const [i, a] of (body.accepts ?? []).entries()) {
  let ok = false, why = "";
  try { validatePaymentRequirements(a, 1); ok = true; } catch (e) { why = e.message; }
  add(`body.accepts[${i}] valid under v1 requirements`, ok, why);
}
for (const [i, a] of (v2?.accepts ?? []).entries()) {
  let ok = false, why = "";
  try { validatePaymentRequirements(a, 2); ok = true; } catch (e) { why = e.message; }
  add(`header.accepts[${i}] valid under v2 requirements`, ok, why);
}

const failed = checks.filter((c) => !c.pass);
if (JSON_MODE) {
  console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", url: URL_ARG, validator: "@x402/core", checks }, null, 2));
} else {
  console.log(`Vendor-authoritative challenge check  ${URL_ARG}`);
  console.log(`validator: @x402/core (resolved from ${official.from.startsWith("file:") ? "package" : official.from})`);
  if (!SELF_TOKEN) console.log("  ⚠️  no self-traffic token found: this probe will be counted as a real caller in the demand funnel");
  for (const c of checks) console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}${c.note ? ` (${c.note})` : ""}`);
  console.log(`\n${failed.length ? `${failed.length} check(s) rejected by the vendor validator` : "all checks accepted by the vendor validator"}`);
}
process.exit(failed.length ? 1 : 0);
