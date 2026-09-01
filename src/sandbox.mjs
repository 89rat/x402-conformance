#!/usr/bin/env node
// x402-sandbox — local replay of the FULL x402 header exchange, zero funds,
// zero npm dependencies. The Phase-1 "x402 dev" experience:
//
//   node src/sandbox.mjs
//
// Spins an embedded x402-protected resource server (real 402 challenge,
// real voucher verification via the reference verifier, mock on-chain
// settlement in a local single-use ledger) and a real client that:
//   discovers -> gets 402 -> signs an EIP-3009 voucher (RFC-6979, deterministic)
//   -> retries with X-PAYMENT -> receives result + settlement + XDR-1 receipt
//   -> verifies the receipt offline.
// Prints the measured time-to-first-payment and PASS/FAIL.

import http from "node:http";
import crypto from "node:crypto";
import { keccak256, recoverAddress, eip3009Digest, verifyReceipt, secpPointMul, SECP_G, SECP_N } from "./reference-verifier.mjs";

const hex = (b) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const hb = (h) => new Uint8Array(h.replace(/^0x/, "").match(/../g).map(x => parseInt(x, 16)));
const PRICE = "999"; // 0.000999 local-USDC
const DOMAIN = { name: "USD Coin", version: "2", chainId: 31337, verifyingContract: "0x00000000000000000000000000000000c0ffee00" };

// ---------- RFC-6979-style deterministic ECDSA signing (HMAC-SHA256) ----------
function signDigest(digestHex, priv, expectAddr) {
  const h1 = crypto.createHash("sha256").update(Buffer.from(digestHex.replace(/^0x/, ""), "hex")).digest();
  const x = Buffer.from(priv);
  const bits2octets = (b) => {
    let v = BigInt("0x" + b.toString("hex")) % SECP_N;
    const o = Buffer.alloc(32); o.write(v.toString(16).padStart(64, "0"), "hex"); return o;
  };
  const z2 = bits2octets(h1);
  let V = Buffer.alloc(32, 0x01), K = Buffer.alloc(32, 0x00);
  K = crypto.createHmac("sha256", K).update(Buffer.concat([V, Buffer.from([0x00]), x, z2])).digest();
  V = crypto.createHmac("sha256", K).update(V).digest();
  K = crypto.createHmac("sha256", K).update(Buffer.concat([V, Buffer.from([0x01]), x, z2])).digest();
  V = crypto.createHmac("sha256", K).update(V).digest();
  const d = privToScalar(priv);
  const e = BigInt("0x" + digestHex.replace(/^0x/, "")) % SECP_N;
  for (let tries = 0; tries < 100; tries++) {
    V = crypto.createHmac("sha256", K).update(V).digest();
    const k = BigInt("0x" + V.toString("hex"));
    if (k > 0n && k < SECP_N) {
      const R = secpPointMul(k, SECP_G);
      const r = R[0] % SECP_N;
      if (r !== 0n) {
        let s = (modInv(k, SECP_N) * ((e + r * d) % SECP_N)) % SECP_N;
        if (s > SECP_N / 2n) s = SECP_N - s;
        if (s !== 0n) {
          // recovery parity: the verifier is the source of truth — brute v,
          // requiring recovery to the EXPECTED address (wrong parity recovers
          // to a different valid address, so equality is the real check)
          const digest = digestHex.replace(/^0x/, "");
          const want = expectAddr?.toLowerCase();
          for (const v of [27, 28]) {
            const cand = r.toString(16).padStart(64, "0") + s.toString(16).padStart(64, "0") + v.toString(16).padStart(2, "0");
            try {
              const rec = recoverAddress(digest, cand).toLowerCase();
              if (!want || rec === want) return "0x" + cand;
            } catch { }
          }
        }
      }
    }
    K = crypto.createHmac("sha256", K).update(Buffer.concat([V, Buffer.from([0x00])])).digest();
    V = crypto.createHmac("sha256", K).update(V).digest();
  }
  throw new Error("could not produce recoverable signature");
}
function modInv(a, m) { let [lr, r] = [((a % m) + m) % m, m], [ls, s] = [1n, 0n]; while (r) { const q = lr / r; [lr, r] = [r, lr - q * r]; [ls, s] = [s, ls - q * s]; } return ((ls % m) + m) % m; }
const privToScalar = (priv) => BigInt("0x" + Buffer.from(priv).toString("hex"));
const addressFromPriv = (priv) => {
  const Q = secpPointMul(privToScalar(priv), SECP_G);
  const ser = new Uint8Array(64);
  const xh = Q[0].toString(16).padStart(64, "0"), yh = Q[1].toString(16).padStart(64, "0");
  for (let i = 0; i < 32; i++) { ser[i] = parseInt(xh.slice(i * 2, i * 2 + 2), 16); ser[32 + i] = parseInt(yh.slice(i * 2, i * 2 + 2), 16); }
  return "0x" + hex(keccak256(ser).slice(12));
};

// ---------- embedded x402 resource server ----------
const sandboxKey = crypto.getRandomValues(new Uint8Array(32));
const sandboxAddr = addressFromPriv(sandboxKey);
const usedNonces = new Set();
const payTo = addressFromPriv(crypto.getRandomValues(new Uint8Array(32)));

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payment = req.headers["x-payment"];
    const challenge = { x402Version: 1, error: "X402_PAYMENT_REQUIRED", accepts: [{ scheme: "exact", network: "ethereum:31337-local", maxAmountRequired: PRICE, asset: DOMAIN.verifyingContract, payTo, maxTimeoutSeconds: 300, extra: { name: DOMAIN.name, version: DOMAIN.version } }] };
    if (!payment) { res.writeHead(402, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify(challenge)); }
    try {
      const payload = JSON.parse(Buffer.from(payment, "base64").toString("utf8"));
      const a = payload.payload.authorization, sig = payload.payload.signature;
      if (a.to.toLowerCase() !== payTo.toLowerCase()) throw new Error("PAYEE_MISMATCH");
      if (a.value !== PRICE) throw new Error("AMOUNT_MISMATCH");
      if (BigInt(a.validBefore) * 1000n < Date.now()) throw new Error("EXPIRED");
      if (usedNonces.has(a.nonce)) throw new Error("REPLAY");
      const digest = eip3009Digest(DOMAIN, a);
      const rec = recoverAddress(digest, sig);
      if (rec.toLowerCase() !== a.from.toLowerCase()) throw new Error("SIGNATURE_INVALID");
      usedNonces.add(a.nonce);
      // mock-settle: deterministic pseudo tx hash from the nonce
      const tx = "0x" + hex(keccak256(hb(a.nonce)));
      // XDR-1 receipt signed by the sandbox key; canon + EIP-191 digest must
      // match verifyReceipt() in reference-verifier.mjs byte-for-byte
      const receipt = {
        v: 1, tool: "sandbox-validate", tool_version: "1.0.0",
        input_hash: "0x" + hex(crypto.createHash("sha256").update(body || "{}").digest()),
        output_hash: "0x" + hex(keccak256(hb(tx))),
        payer: rec, recipient: payTo, amount: PRICE,
        nonce: a.nonce, ts: Math.floor(Date.now() / 1000), tier: "paid",
        signer: sandboxAddr,
      };
      const canon = [receipt.v, receipt.tool, receipt.tool_version, receipt.input_hash, receipt.output_hash, receipt.payer, receipt.recipient, receipt.amount, receipt.nonce, receipt.ts, receipt.tier].join("|");
      const eip191 = keccak256(new TextEncoder().encode("\x19Ethereum Signed Message:\n" + canon.length + canon));
      receipt.signature = signDigest(hex(eip191), sandboxKey, sandboxAddr);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: { valid: true, tool: "sandbox-validate" }, settlement: { success: true, network: "ethereum:31337-local", transaction: tx }, receipt, authorization: { note: "local sandbox; no attestation" } }));
    } catch (e) {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ x402Version: 1, error: e.message }));
    }
  });
});

// ---------- client: full header-exchange replay ----------
const t0 = Date.now();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port, base = `http://127.0.0.1:${port}`;
const call = (headers) => fetch(base + "/v1/validate/call", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ input: { iban: "GB82WEST12345698765432" } }) });

let r = await call({});
if (r.status !== 402) { console.error(`FAIL: expected 402, got ${r.status}`); process.exit(1); }
const challenge = await r.json();
const acc = challenge.accepts[0];
console.log(`[1] 402 challenge parsed: pay ${acc.maxAmountRequired} -> ${acc.payTo.slice(0, 10)}… (${Math.floor((Date.now() - t0))}ms)`);

const priv = crypto.getRandomValues(new Uint8Array(32));
const from = addressFromPriv(priv);
const now = Math.floor(Date.now() / 1000);
const auth = { from, to: acc.payTo, value: acc.maxAmountRequired, validAfter: "0", validBefore: String(now + 300), nonce: "0x" + hex(crypto.getRandomValues(new Uint8Array(32))) };
const signature = signDigest(eip3009Digest(DOMAIN, auth), priv, from);
const xpayment = Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: acc.network, payload: { signature, authorization: auth } })).toString("base64");
console.log(`[2] voucher signed (RFC-6979) by ${from.slice(0, 10)}… (${Math.floor((Date.now() - t0))}ms)`);

r = await call({ "X-PAYMENT": xpayment });
if (r.status !== 200) { console.error(`FAIL: paid call returned ${r.status}: ${JSON.stringify(await r.json())}`); process.exit(1); }
const paid = await r.json();
console.log(`[3] settled: tx ${paid.settlement.transaction.slice(0, 14)}… (${Math.floor((Date.now() - t0))}ms)`);

const vr2 = verifyReceipt(paid.receipt);
if (!vr2.ok) { console.error(`FAIL: receipt did not verify: ${JSON.stringify(vr2)}`); process.exit(1); }
console.log(`[4] receipt verified offline (signer ${vr2.signer.slice(0, 10)}…) (${Math.floor((Date.now() - t0))}ms)`);

// replay must be rejected
r = await call({ "X-PAYMENT": xpayment });
const rej = await r.json();
if (r.status !== 402 || rej.error !== "REPLAY") { console.error(`FAIL: replay not rejected (${r.status} ${rej.error})`); process.exit(1); }
console.log(`[5] replay rejected with coded error REPLAY (${Math.floor((Date.now() - t0))}ms)`);
server.close();
console.log(`\nSANDBOX PASS — full x402 exchange replayed locally, time-to-first-payment ${Date.now() - t0}ms, zero funds`);
