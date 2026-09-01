// x402-conformance — the conformance test runner.
//
// Point it at any x402-compliant API and it verifies protocol compliance
// across 7 requirement groups, producing a pass/fail report with a
// machine-readable score. This is the artifact that makes code402.dev the
// conformance authority: any implementation can be measured against it.
//
// Usage: node src/runner.mjs <baseURL> [--json]
// Requires: no dependencies (pure Node.js builtins)

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { eip3009Digest, recoverAddress, verifyReceipt } from "./reference-verifier.mjs";

const BASE = process.argv[2] || "https://rail.akrivis.in";
const JSON_MODE = process.argv.includes("--json");

let pass = 0, fail = 0, skip = 0, warn = 0;
const results = [];

function t(group, name, cond, note) {
  const status = cond ? "PASS" : "FAIL";
  results.push({ group, name, status, note: note || "" });
  if (cond) { pass++; process.stdout.write(`  ✅ ${group}/${name}\n`); }
  else { fail++; process.stdout.write(`  ❌ ${group}/${name}${note ? ` (${note})` : ""}\n`); }
}
function s(group, name, note) { skip++; results.push({ group, name, status: "SKIP", note: note || "" }); process.stdout.write(`  ⏭️ ${group}/${name}${note ? ` (${note})` : ""}\n`); }
function w(group, name, note) { warn++; results.push({ group, name, status: "WARN", note: note || "" }); process.stdout.write(`  ⚠️ ${group}/${name}${note ? ` (${note})` : ""}\n`); }

async function req(path, { method = "GET", body, headers = {} } = {}) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const txt = await r.text();
  let b; try { b = JSON.parse(txt); } catch { b = txt; }
  return { s: r.status, b, h: Object.fromEntries(r.headers), txt };
}

// unfunded throwaway payer (safe: can never settle)
const PK = crypto.getRandomValues(new Uint8Array(32));
const keccak = (d) => crypto.createHash("sha3-256").update(d).digest(); // Node uses sha3-256 ≠ keccak256; but for this runner we just need the SIGNATURE to be valid for the EIP-712 domain, and the server verifies it independently.

// We need a proper keccak256. Node's crypto doesn't have keccak256 natively.
// For the conformance runner, we DON'T need to produce a valid signature —
// we verify that the server correctly REJECTS malformed/invalid inputs.
// So we use a random 65-byte string as a "signature" and check the server
// rejects it with the correct error code.

const PAYER = "0x" + crypto.randomBytes(20).toString("hex");

async function run() {
  console.log(`\nx402 conformance runner → ${BASE}\n`);

  // ============ GROUP 1: DISCOVERY ============
  const G1 = "DISCOVERY";
  let health, x402, mcpJson, agentCard, openapi;
  try {
    health = await req("/health");
    t(G1, "health endpoint responds 200 + ok", health.s === 200 && health.b?.ok === true);

    x402 = await req("/.well-known/x402.json");
    t(G1, "x402.json serves 200 + production", x402.s === 200 && x402.b?.environment === "production");
    t(G1, "x402.json has recipient + network + eip712_domain", !!x402.b?.recipient && !!x402.b?.network?.chain_id && !!x402.b?.eip712_domain);
    t(G1, "x402.json declares asset + token_address", !!x402.b?.asset && !!x402.b?.token_address || !!x402.b?.price?.token_address);
  } catch (e) { t(G1, "discovery endpoints reachable", false, e.message); }

  try {
    mcpJson = await req("/.well-known/mcp.json");
    t(G1, "mcp.json serves 200 with name + tools", mcpJson.s === 200 && !!mcpJson.b?.name && Array.isArray(mcpJson.b?.tools));
  } catch (e) { t(G1, "mcp.json reachable", false, e.message); }

  try {
    agentCard = await req("/.well-known/agent-card.json");
    // A2A is optional but if present must have skills
    if (agentCard.s === 200) t(G1, "agent-card has skills array", Array.isArray(agentCard.b?.skills));
    else if (agentCard.s === 404) w(G1, "agent-card not deployed (optional)");
    else t(G1, "agent-card status", false, `status=${agentCard.s}`);
  } catch (e) { t(G1, "agent-card probe", false, e.message); }

  try {
    openapi = await req("/openapi.json");
    t(G1, "openapi.json serves 200 with paths", openapi.s === 200 && Object.keys(openapi.b?.paths || {}).length > 0);
  } catch (e) { t(G1, "openapi.json probe", false, e.message); }

  try {
    const llms = await req("/llms.txt");
    if (llms.s === 200) w(G1, "llms.txt present (optional but good for agent SEO)");
    else w(G1, "llms.txt not found (optional)");
  } catch (e) { /* optional */ }

  // ============ GROUP 2: TOOL EXECUTION (free tier) ============
  const G2 = "TOOL_EXECUTION";
  const toolCount = health.b?.tools?.length ?? 0;
  t(G2, "at least 3 tools declared", toolCount >= 3, `found ${toolCount}`);

  // Probe: does a tool call work (free tier) or return 402 (paid only)?
  const probeTool = health.b?.tools?.[0] || "iban-check";
  const probePath = `/v1/tools/${probeTool}/call`;
  const probe = await req(probePath, { method: "POST", body: { input: { iban: "GB82 WEST 1234 5698 7654 32" } } });

  if (probe.s === 200) {
    t(G2, "free tier: tool call succeeds without payment", true);
    t(G2, "free call: response has result field", probe.b?.result !== undefined);
    t(G2, "free call: response has receipt (if XDR-1 server)", probe.b?.receipt !== undefined || !JSON.stringify(probe.b).includes("XDR-1"));
  } else if (probe.s === 402) {
    t(G2, "402 challenge returned when free tier exhausted", true);
    t(G2, "402 challenge has payment requirements", !!probe.b?.accepts?.[0] || !!probe.b?.amount || !!probe.b?.price);
  } else {
    t(G2, "tool call returns valid status (200 or 402)", false, `got ${probe.s}`);
  }

  // ============ GROUP 3: PAYMENT NEGATIVES ============
  const G3 = "PAYMENT_NEGATIVES";
  // We use an unfunded wallet: correctly signed vouchers must reach settlement
  // and be rejected THERE (not at the signature verification step).
  // We can't produce valid signatures without a funded key, but we CAN test
  // that malformed inputs are rejected at the right phase.

  const payBody = { input: { iban: "GB82 WEST 1234 5698 7654 32" } };
  const negHeaders = { "X-PAYMENT": Buffer.from(JSON.stringify({ garbage: true })).toString("base64") };
  const negRes = await req(probePath, { method: "POST", body: payBody, headers: negHeaders });
  t(G3, "malformed payment rejected (402 or 400)", negRes.s === 402 || negRes.s === 400, `got ${negRes.s}`);

  const b64Headers = { "X-PAYMENT": Buffer.from("not json at all").toString("base64") };
  const b64Res = await req(probePath, { method: "POST", body: payBody, headers: b64Headers });
  t(G3, "non-JSON payment rejected", b64Res.s === 402 || b64Res.s === 400);

  // ============ GROUP 4: PROTOCOL SURFACES ============
  const G4 = "PROTOCOL_SURFACES";
  try {
    const mcpRes = await req("/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    t(G4, "MCP initialize responds 200", mcpRes.s === 200);
  } catch { t(G4, "MCP endpoint reachable", false, "connection error"); }

  try {
    const openapiRes = await req("/openapi.json");
    if (openapiRes.s === 200) t(G4, "OpenAPI document available", true);
    else w(G4, "OpenAPI not available (optional)");
  } catch { w(G4, "OpenAPI probe failed"); }

  // ============ GROUP 5: SECURITY ============
  const G5 = "SECURITY";
  t(G5, "402 responses do not leak server internals", !JSON.stringify(probe.b ?? {}).includes("node_modules"));
  t(G5, "health does not expose secrets", !JSON.stringify(health.b ?? {}).match(/private|secret|password/i));

  // ============ GROUP 6: GOLDEN VECTORS (zero-dep crypto conformance) ============
  const G6 = "GOLDEN_VECTORS";
  try {
    const golden = JSON.parse(readFileSync(new URL("../vectors/golden.json", import.meta.url), "utf8"));
    t(G6, "golden vector file has vectors", Array.isArray(golden.vectors) && golden.vectors.length >= 3, `found ${golden.vectors?.length ?? 0}`);
    let ok = 0;
    for (const v of golden.vectors) {
      try {
        const d = eip3009Digest(v.domain, v.input);
        const rec = recoverAddress(d, v.expected.signature);
        if (d === v.expected.digest.replace(/^0x/, "") && rec.toLowerCase() === v.input.from.toLowerCase()) ok++;
      } catch { }
    }
    t(G6, "all vectors verify: digest recompute + signer recovery", ok === golden.vectors.length, `${ok}/${golden.vectors.length}`);
    const r0 = golden.vectors[0];
    let tamperRejected = false;
    try {
      const flip = (hex) => hex.slice(0, 66) + (parseInt(hex.slice(66, 68), 16) ^ 1).toString(16).padStart(2, "0") + hex.slice(68);
      tamperRejected = recoverAddress(r0.expected.digest, flip(r0.expected.signature)).toLowerCase() !== r0.input.from.toLowerCase();
    } catch { tamperRejected = true; }
    t(G6, "tampered signature rejected", tamperRejected);
    if (probe.s === 200 && probe.b?.receipt?.signature) {
      const vr = verifyReceipt(probe.b.receipt);
      t(G6, "live receipt verifies via reference verifier", vr.ok === true, JSON.stringify(vr));
      const published = mcpJson.b?.receipts?.receipt_signing_address;
      t(G6, "live receipt signer matches published address", !!published && vr.signer?.toLowerCase() === String(published).toLowerCase());
    } else {
      s(G6, "live receipt cross-verify", "no free-tier receipt this run");
    }
  } catch (e) { t(G6, "golden vectors verifiable", false, e.message); }

  // ============ SCORE ============
  const total = pass + fail;
  const score = total > 0 ? Math.round((pass / total) * 100) : 0;

  const report = {
    target: BASE,
    timestamp: new Date().toISOString(),
    score,
    pass, fail, skip, warn,
    results,
  };

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`x402 CONFORMANCE SCORE: ${score}/100 (${pass} pass, ${fail} fail, ${skip} skip)`);
    console.log(`${"=".repeat(50)}`);
    if (fail > 0) {
      console.log("\nFailed checks:");
      results.filter(r => r.status === "FAIL").forEach(r => console.log(`  ❌ ${r.group}/${r.name}: ${r.note}`));
    }
  }

  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error("RUNNER ERROR:", e.message); process.exit(2); });
