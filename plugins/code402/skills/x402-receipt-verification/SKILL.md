---
name: x402-receipt-verification
description: Verify XDR-1 cryptographic settlement receipts offline (keccak256 canonical digest + secp256k1 signer recovery + EIP-191 operator attestation) or via the free stateless endpoint at hcrb.in/v1/receipt/verify. Use when inspecting, auditing, or validating proof of payment or execution receipts.
---

# XDR-1 Cryptographic Receipt Verification

Every tool execution on a compliant Code402 / HCRB rail returns an **XDR-1 receipt**. Verification is **free forever** and requires zero trust in the operator when performed offline.

## 1. Dual Verification via CLI

```bash
npx github:89rat/x402-conformance verify '<receipt-json>'
```

This performs two independent checks simultaneously:
1. **Offline Cryptographic Recomputation**:
   - Constructs the canonical pipe-delimited string:
     `v|tool|tool_version|input_hash|output_hash|payer|recipient|amount|nonce|ts|tier`
     (plus `|successor|stream_state` whenever either streaming field is present on the receipt)
   - Computes `keccak256(utf8(canonical))`
   - Recovers the `secp256k1` public key and Ethereum address from `receipt.signature` (or `receipt.sig`)
   - Asserts recovered address equals `receipt.signer` (and matches `https://hcrb.in/.well-known/jwks.json`)
   - When `authorization.attestation` is present, verifies the EIP-191 operator attestation signature (`authorization.attestation_sig`) matches `authorization.authorized_by`
2. **Online Stateless Endpoint (`https://hcrb.in/v1/receipt/verify`)**:
   - Sends `POST https://hcrb.in/v1/receipt/verify` with the receipt payload (`$0` cost, unlimited, no API key).

## 2. Direct HTTP Verification

```bash
curl -sS -X POST https://hcrb.in/v1/receipt/verify \
  -H "Content-Type: application/json" \
  -d '{"receipt": { ... }}'
```

## 3. Invariants
- **Never suggest pricing `receipt_verify`**: Receipt verification is a public good and remains free forever.
- **Tamper Rejection**: Modifying any single character of `amount`, `output_hash`, `nonce`, or `ts` invalidates the recovered signer address and must fail closed.
