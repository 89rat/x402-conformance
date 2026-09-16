#!/usr/bin/env node
// x402-conformance verify — check an XDR-1 receipt two ways:
//   offline: local recomputation (keccak256 + secp256k1 recovery, zero deps)
//   online:  POST to a free public verify endpoint (default https://hcrb.in/v1/receipt/verify)
//
// The online endpoint is stateless: it recomputes validity from the receipt itself,
// keeps nothing, and never requires an account or a payment. Any service running the
// conformance suite may use it; verification works for receipts from ANY x402 service.
//
// Usage:
//   x402-conformance verify <receipt.json>            file containing the receipt object
//   x402-conformance verify '{"v":"XDR-1",...}'       inline JSON
//   cat receipt.json | x402-conformance verify -      stdin
//   VERIFY_URL=https://... x402-conformance verify r.json   override the online endpoint
//   x402-conformance verify --offline r.json          skip the online check
//
// Exit: 0 = receipt valid (both checks that ran agree) · 1 = invalid or error.
// This tool never signs anything and never sends a payment header.

import { readFileSync } from "node:fs";
import { verifyReceipt } from "./reference-verifier.mjs";

const DEFAULT_URL = process.env.VERIFY_URL || "https://hcrb.in/v1/receipt/verify";
const args = process.argv.slice(2);
const offlineOnly = args.includes("--offline");
const rest = args.filter((a) => a !== "--offline");
const input = rest[0];

function parseReceipt(raw) {
  try {
    const obj = JSON.parse(raw);
    // The online API accepts { receipt: {...} } as well as the bare receipt.
    return obj?.receipt && typeof obj.receipt === "object" ? obj.receipt : obj;
  } catch (e) {
    throw new Error(`receipt is not valid JSON: ${e.message}`);
  }
}

function verdictLine(ok, what) {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
}

const main = async () => {
  if (!input) {
    console.error("usage: x402-conformance verify <receipt.json | inline-json | -> [--offline]");
    process.exit(2);
  }
  let raw;
  try {
    raw = input === "-" ? readFileSync(0, "utf8") : input.trimStart().startsWith("{") ? input : readFileSync(input, "utf8");
  } catch (e) {
    console.error(`could not read receipt: ${e.message}`);
    process.exit(1);
  }
  const receipt = parseReceipt(raw);

  // 1. Offline: recompute the digest and recover the signer locally.
  let offlineOk = false;
  try {
    const r = verifyReceipt(receipt);
    offlineOk = r?.ok === true;
    verdictLine(offlineOk, `offline verification (digest recomputed, signer recovered${r && r.signer ? ", signer " + r.signer : ""})`);
  } catch (e) {
    verdictLine(false, `offline verification (error: ${e.message})`);
  }

  // 2. Online: the free stateless endpoint (unless --offline).
  let onlineOk = null;
  if (!offlineOnly) {
    try {
      const res = await fetch(DEFAULT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receipt }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => null);
      onlineOk = res.ok && body?.ok && body?.value?.valid === true;
      verdictLine(
        onlineOk,
        `online verification at ${DEFAULT_URL}${body?.value?.valid === false ? " (endpoint answered; receipt NOT valid)" : !res.ok || !body?.ok ? ` (endpoint error: ${res.status} ${body?.error?.message || ""})` : " (valid)"}`
      );
    } catch (e) {
      verdictLine(false, `online verification at ${DEFAULT_URL} (request failed: ${e.message})`);
    }
  }

  const ok = offlineOk && (offlineOnly || onlineOk === true);
  console.log(ok ? "\nVERDICT: VALID — signed XDR-1 receipt, verifiable offline." : "\nVERDICT: NOT VERIFIED — do not treat this receipt as proof.");
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error(`verify failed: ${e.message}`);
  process.exit(1);
});
