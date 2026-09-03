/**
 * x402-mini (TypeScript) — a clean-room x402 client SDK, implementable from
 * the published artifacts alone (ABNF grammar + JSON Schemas + golden vectors).
 *
 * Flow: POST without payment -> parse the 402 challenge (v1 JSON body, or v2
 * base64 PAYMENT-REQUIRED header) -> build + sign an EIP-3009
 * TransferWithAuthorization voucher -> retry with X-PAYMENT (base64) ->
 * verify the XDR-1 receipt offline.
 *
 * Deps (pinned): @noble/curves ^1.9.7, @noble/hashes ^1.8.0. Node >= 18.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
const { Point } = secp256k1;
import { keccak_256 } from "@noble/hashes/sha3";

// ---------- helpers ----------
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const hb = (h) => new Uint8Array(h.replace(/^0x/, "").match(/../g).map((x) => parseInt(x, 16)));
const cat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const te = new TextEncoder();
const word32 = (n) => hb(n.toString(16).padStart(64, "0"));
const addrWord = (a) => hb(a.replace(/^0x/, "").toLowerCase().padStart(64, "0"));

// ---------- primitives ----------
export function privateKeyToAddress(privBytes) {
  const pub = secp256k1.getPublicKey(privBytes, false); // 65-byte uncompressed
  return "0x" + hex(keccak_256(pub.slice(1)).slice(-20));
}

export function signDigest32(digest /* Uint8Array(32) */, privBytes) {
  const sig = secp256k1.sign(digest, privBytes, { format: "recovered", prehash: false });
  const b65 = sig.toBytes ? sig.toBytes("recovered") : sig; // [recid][r||s]
  return hex(b65.slice(1)) + (b65[0] + 27).toString(16).padStart(2, "0");
}

// ---------- EIP-712 (EIP-3009 TransferWithAuthorization) ----------
const keccakHex = (s) => keccak_256(te.encode(s));
const hashStruct = (type, fields) => keccak_256(cat(keccak_256(te.encode(type)), ...fields));
const DOMAIN_TYPEHASH = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

export function eip3009Digest(domain, auth) {
  const domainSep = hashStruct(DOMAIN_TYPEHASH, [keccakHex(domain.name), keccakHex(domain.version), word32(BigInt(domain.chainId)), addrWord(domain.verifyingContract)]);
  return keccak_256(cat(hb("1901"), domainSep, hashStruct(
    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
    [addrWord(auth.from), addrWord(auth.to), word32(BigInt(auth.value)), word32(BigInt(auth.validAfter)), word32(BigInt(auth.validBefore)), hb(auth.nonce)]
  )));
}

// ---------- XDR-1 receipt verification (raw keccak over canonical) ----------
export function verifyReceipt(receipt) {
  const canon = [receipt.v, receipt.tool, receipt.tool_version, receipt.input_hash, receipt.output_hash, receipt.payer, receipt.recipient, receipt.amount, receipt.nonce, receipt.ts, receipt.tier].join("|");
  const digest = keccak_256(te.encode(canon));
  const sig = hb(receipt.signature);
  let v = sig[64]; if (v >= 27) v -= 27;
  const sig65 = new Uint8Array(65); sig65[0] = v; sig65.set(sig.slice(0, 64), 1);
  const rec = secp256k1.recoverPublicKey(sig65, digest, { prehash: false }); // 33-byte compressed
  const un = rec[0] === 4 ? rec : Point.fromBytes(rec).toBytes(false); // 65-byte uncompressed
  const pub = un.slice(1);
  const signer = "0x" + hex(keccak_256(pub).slice(-20));
  return { signer, ok: signer.toLowerCase() === String(receipt.signer).toLowerCase() };
}

// ---------- challenge parsing (v1 JSON body / v2 PAYMENT-REQUIRED header) ----------
export function parseChallenge(status, bodyText, headers) {
  if (status !== 402) return null;
  const h = headers?.get?.("payment-required") ?? headers?.["payment-required"];
  if (h) {
    const v2 = JSON.parse(new TextDecoder().decode(Uint8Array.from(atobURIComponent(h), (c) => c.charCodeAt(0))));
    return { x402Version: 2, ...v2 };
  }
  return JSON.parse(bodyText);
}
function atobURIComponent(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

// ---------- opt-in telemetry (DIS-1 price index) ----------
// Strictly execution metadata, zero payload content. Default OFF. Fails silent
// (fire-and-forget; registry errors never block the call). Only what we actually
// measure is emitted — no invented latency/uptime fields. See sdk/README.md.
let telemetry = { enabled: false, url: "" };
export function enableTelemetry({ url, enabled = true }) {
  telemetry = { enabled: !!enabled, url: url || "" };
}
function emitTelemetry(host, pathHash, quoted, settled, status, receiptOk) {
  if (!telemetry.enabled || !telemetry.url) return;
  const p = {
    spec_version: "1.0.0",
    endpoint_host: host,
    endpoint_path_hash: pathHash,
    quoted_amount: quoted,
    settled_amount: settled,
    asset: "USDC",
    network: "eip155:8453",
    status_code: status,
    receipt_valid: receiptOk,
    timestamp: Math.floor(Date.now() / 1000),
  };
  // fire-and-forget; swallow everything (telemetry never blocks a payment)
  fetch(telemetry.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).catch(() => {});
}

// ---------- main entry ----------
export async function payAndCall({ base, path, body, privateKey /* 32-byte hex */ }) {
  const t0 = telemetry.enabled ? Date.now() : 0;
  const key = typeof privateKey === "string" ? hb(privateKey) : privateKey;
  const from = privateKeyToAddress(key);

  const first = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const challenge = parseChallenge(first.status, await first.text(), first.headers);
  if (!challenge) return { status: first.status, data: null, error: "expected 402 challenge" };

  const acc = challenge.accepts[0];
  const chainId = parseInt(String(acc.network).split(":").pop(), 10);
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from,
    to: acc.payTo,
    value: String(acc.maxAmountRequired),
    validAfter: String(now - 60),
    validBefore: String(now + (acc.maxTimeoutSeconds || 300)),
    nonce: "0x" + hex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const domain = { name: acc.extra?.name ?? "USD Coin", version: acc.extra?.version ?? "2", chainId, verifyingContract: acc.asset };
  const signature = "0x" + signDigest32(eip3009Digest(domain, auth), key);
  const xpayment = Buffer.from(JSON.stringify({ x402Version: 1, scheme: acc.scheme, network: acc.network, payload: { signature, authorization: auth } })).toString("base64");

  const second = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-payment": xpayment }, body: JSON.stringify(body) });
  const data = await second.json();
  if (second.status !== 200) {
    emitTelemetry(base, hex(keccak_256(te.encode(path))).slice(0, 64), auth.value, "0", second.status, false);
    return { status: second.status, data, error: data.error ?? "paid call failed" };
  }
  const receipt = data.receipt ?? data.result?.receipt ?? null;
  const verification = receipt ? verifyReceipt(receipt) : null;
  emitTelemetry(base, hex(keccak_256(te.encode(path))).slice(0, 64), auth.value, receipt ? receipt.amount : "0", second.status, verification ? verification.ok : false);
  return { status: second.status, data, receipt, verification, settlement: data.settlement ?? null };
}
