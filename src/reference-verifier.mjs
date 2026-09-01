// x402-conformance — zero-dependency reference verifier.
//
// Pure Node.js builtins: keccak256 (Keccak-f[1600]) + secp256k1 public-key
// recovery + the two verifications every x402 v1 implementation needs:
//   1. EIP-3009 TransferWithAuthorization voucher signatures
//   2. XDR-1 signed receipts (canonical hash, secp256k1, EIP-191 attestation)
//
// This IS the normative check: an implementation's output is conformant iff
// this verifier accepts it. Self-test: `node src/reference-verifier.mjs`

// ---------- keccak256 (original Keccak padding 0x01..0x80, NOT sha3) ----------
const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROTC = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const rotl = (x, n) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

function keccakF(state) {
  const B = new BigUint64Array(25);
  for (let round = 0; round < 24; round++) {
    const C = new BigUint64Array(5), D = new BigUint64Array(5);
    for (let x = 0; x < 5; x++) C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x + 5 * y] ^= D[x];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROTC[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x + 5 * y] = B[x + 5 * y] ^ ((B[(x + 1) % 5 + 5 * y] ^ MASK) & B[(x + 2) % 5 + 5 * y]);
    state[0] ^= RC[round];
  }
}

export function keccak256(msg) {
  const RATE = 136;
  const state = new BigUint64Array(25);
  const pad = new Uint8Array(Math.ceil((msg.length + 1) / RATE) * RATE);
  pad.set(msg); pad[msg.length] = 0x01; pad[pad.length - 1] |= 0x80;
  for (let off = 0; off < pad.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let j = 0; j < 8; j++) lane |= BigInt(pad[off + i * 8 + j]) << BigInt(8 * j);
      state[i] ^= lane;
    }
    keccakF(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((state[i] >> BigInt(8 * j)) & 0xffn);
  return out;
}

// ---------- secp256k1 public-key recovery (affine, bigint) ----------
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const G = [0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
           0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) {
  let [lr, r] = [mod(a, m), m], [ls, s] = [1n, 0n];
  while (r) { const q = lr / r; [lr, r] = [r, lr - q * r]; [ls, s] = [s, ls - q * s]; }
  return mod(ls, m);
}
function ptAdd(a, b) {
  if (!a) return b; if (!b) return a;
  if (a[0] === b[0]) {
    if (mod(a[1] + b[1]) === 0n) return null;
    const lam = mod(3n * a[0] * a[0] * inv(2n * a[1]));
    const x = mod(lam * lam - 2n * a[0]);
    return [x, mod(lam * (a[0] - x) - a[1])];
  }
  const lam = mod((b[1] - a[1]) * inv(b[0] - a[0]));
  const x = mod(lam * lam - a[0] - b[0]);
  return [x, mod(lam * (a[0] - x) - a[1])];
}
function ptMul(k, p = G) {
  let R = null, A = p;
  while (k) { if (k & 1n) R = ptAdd(R, A); A = ptAdd(A, A); k >>= 1n; }
  return R;
}
export { ptMul as secpPointMul, G as SECP_G, N as SECP_N, P as SECP_P };

export function recoverAddress(digestHex, sigHex) {
  const sig = sigHex.replace(/^0x/, "");
  if (sig.length !== 130) throw new Error("signature must be 65 bytes hex");
  const r = BigInt("0x" + sig.slice(0, 64));
  const s = BigInt("0x" + sig.slice(64, 128));
  let recid = parseInt(sig.slice(128, 130), 16);
  if (recid >= 27) recid -= 27;
  if (recid > 3) throw new Error("invalid recovery id");
  const h = BigInt("0x" + digestHex.replace(/^0x/, ""));
  // R = (x = r (+ n if recid>=2), y = sqrt(x^3+7) with parity recid&1)
  const x = mod(r + (recid >= 2 ? N : 0n), P);
  const y2 = mod(x * x * x + 7n);
  let y = modPow(y2, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== y2) throw new Error("R not on curve (invalid r)");
  if ((y & 1n) !== BigInt(recid & 1)) y = P - y;
  const e = mod(h, N);
  // Q = r^-1 (sR - eG)
  const Q = ptMul(inv(r, N), ptAdd(ptMul(s, [x, y]), ptMul(mod(-e, N))));
  if (!Q || mod(Q[1] * Q[1], P) !== mod(Q[0] * Q[0] * Q[0] + 7n, P)) throw new Error("recovered point not on curve");
  const un = new Uint8Array(64);
  const xh = Q[0].toString(16).padStart(64, "0"), yh = Q[1].toString(16).padStart(64, "0");
  for (let i = 0; i < 32; i++) { un[i] = parseInt(xh.slice(i * 2, i * 2 + 2), 16); un[32 + i] = parseInt(yh.slice(i * 2, i * 2 + 2), 16); }
  return "0x" + [...keccak256(un).slice(12)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function modPow(b, e, m) {
  let R = 1n; b = mod(b, m);
  while (e) { if (e & 1n) R = mod(R * b, m); b = mod(b * b, m); e >>= 1n; }
  return R;
}

// ---------- EIP-3009 digest ----------
const te = new TextEncoder();
const hex = (b) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
const word = (n) => { const w = new Uint8Array(32); let v = BigInt(n); for (let i = 31; i >= 0 && v; i--) { w[i] = Number(v & 255n); v >>= 8n; } return w; };
const addrWord = (a) => { const w = new Uint8Array(32); w.set(new Uint8Array(20), 12); const h = a.replace(/^0x/, "").toLowerCase(); for (let i = 0; i < 20; i++) w[12 + i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return w; };
const hashStruct = (s) => keccak256(te.encode(s));

export function eip3009Digest(domain, auth) {
  const ds = keccak256(cat(
    hashStruct("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
    hashStruct(domain.name), hashStruct(domain.version), word(domain.chainId), addrWord(domain.verifyingContract)));
  return hex(keccak256(cat(te.encode("\x19\x01"), ds, keccak256(cat(
    hashStruct("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
    addrWord(auth.from), addrWord(auth.to), word(auth.value), word(auth.validAfter), word(auth.validBefore), new Uint8Array(auth.nonce.replace(/^0x/, "").match(/../g).map(x => parseInt(x, 16))))))));
}

// ---------- XDR-1 receipt ----------
const eip191 = (m) => keccak256(cat(te.encode("\x19Ethereum Signed Message:\n" + m.length), te.encode(m)));
export function verifyReceipt(receipt) {
  const canon = [receipt.v, receipt.tool, receipt.tool_version, receipt.input_hash, receipt.output_hash, receipt.payer, receipt.recipient, receipt.amount, receipt.nonce, receipt.ts, receipt.tier].join("|");
  const digest = hex(eip191(canon));
  const signer = recoverAddress(digest, receipt.signature);
  return { signer, ok: signer.toLowerCase() === String(receipt.signer).toLowerCase() };
}

// ---------- self-test ----------
import { pathToFileURL } from "node:url";
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let pass = 0, fail = 0;
  const t = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
  t('keccak256("")', hex(keccak256(new Uint8Array(0))) === "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  t('keccak256("abc")', hex(keccak256(te.encode("abc"))) === "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  // golden vectors: digest + recovery round-trip
  const golden = JSON.parse((await import("node:fs")).readFileSync(new URL("../vectors/golden.json", import.meta.url), "utf8"));
  for (const v of golden.vectors) {
    const d = eip3009Digest(v.domain, v.input);
    t(`${v.id} digest matches stored`, d === v.expected.digest.replace(/^0x/, ""));
    const rec = recoverAddress(d, v.expected.signature);
    t(`${v.id} recovers to input.from`, rec.toLowerCase() === v.input.from.toLowerCase());
    // tamper: flip one bit of s → must NOT recover to from
    const tampered = v.expected.signature.slice(0, -4) + (parseInt(v.expected.signature.slice(-4, -2), 16) ^ 0x01).toString(16).padStart(2, "0") + v.expected.signature.slice(-2);
    let differs = false;
    try { differs = recoverAddress(d, tampered) !== v.input.from.toLowerCase(); } catch { differs = true; }
    t(`${v.id} tampered signature rejected`, differs);
  }
  console.log(`\n${pass}/${pass + fail} self-tests passed`);
  process.exit(fail ? 1 : 0);
}
