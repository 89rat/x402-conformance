---
name: x402-payer
description: Pay for machine-payable API calls with USDC via x402 (HTTP 402 + EIP-3009) — no accounts, no API keys. Use when an agent needs to call a paid x402 endpoint such as hcrb.in or rail.akrivis.in (deterministic business-ID validation), handle a 402 challenge, sign the voucher, and verify the signed receipt.
---

# x402 Payer

How an autonomous agent pays for a tool call with USDC on Base — no human, no account, no API key. Payment is the credential.

## When to use

- An endpoint returns **HTTP 402** with an `accepts[]` payment challenge
- You need to call a paid x402 tool (e.g. `hcrb.in` / `rail.akrivis.in` validation tools: IBAN/LEI/VAT/company-number checks, settlement proofs)
- You need to **verify the signed receipt** proving a paid call happened

## Reference rail: Code402 / HCRB (live, Base mainnet)

| Fact | Value |
|---|---|
| MCP endpoint | `https://hcrb.in/mcp` and `https://rail.akrivis.in/mcp` (JSON-RPC 2.0, `2025-03-26`) |
| Manifest | `https://hcrb.in/.well-known/mcp.json` |
| Live prices | `GET https://hcrb.in/health` |
| Free tier | Free evaluation calls per day per client IP — evaluate first, pay later |
| Basic checks | floor $0.000999 USDC (999 minor); premium/bundle $0.02–0.05; dynamic Dutch pricing, floors guaranteed |
| Asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, EIP-712 domain name `USD Coin`, version `2`, chain 8453 |
| Receipt | XDR-1, secp256k1; signer published in the manifest; operator attestation (EIP-191) in every response |

## The protocol (always this order)

1. **Call first without paying.** Free tier may cover you. Never sign a voucher before seeing an actual 402.
2. **Parse the 402 challenge**: `accepts[0]` gives `maxAmountRequired`, `payTo`, `asset`, `maxTimeoutSeconds`, `extra.name`, `extra.version`.
3. **Sign EIP-3009 `TransferWithAuthorization`** with your agent wallet:
   - `from` = your address, `to` = `payTo`, `value` = `maxAmountRequired` (exact — over/underpayment is rejected)
   - `validAfter` = 0, `validBefore` = now + `maxTimeoutSeconds`, `nonce` = random 32 bytes (not sequential)
   - EIP-712 domain: `(extra.name, extra.version, chainId, asset)`
4. **Retry the identical request** with header `X-PAYMENT: base64(JSON)`.
5. **Verify the receipt** (offline, no trust needed):
   - canonical: `v|tool|tool_version|input_hash|output_hash|payer|recipient|amount|nonce|ts|tier` → keccak256 → recover signer == `receipt.signer`
   - attestation: `authorization.attestation` names that signer; recover EIP-191 signer of `authorization.attestation_sig` == `authorization.authorized_by`
   - only then is the receipt provably operator-authorized.

## Hard rules

- **Never pay before a 402.** A 200 means free tier served you.
- **Exact amount only.** The rail binds voucher value to the quote; mismatches are rejected, not credited.
- **One nonce, one intent.** Voucher nonces are single-use server-side; replays return the original receipt, never double-charge.
- **Key hygiene.** Your agent wallet key stays in your environment (`AGENT_WALLET_KEY`); it signs authorizations, it is never sent anywhere. The signed voucher alone cannot move funds beyond `value` to `payTo` before `validBefore`.
- **Receipts are evidence.** Store them; they are the audit trail of what you paid for, verifiable by anyone offline or via `https://hcrb.in/v1/receipt/verify`.
