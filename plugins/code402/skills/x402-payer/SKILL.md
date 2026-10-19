---
name: x402-payer
description: Pay for machine-payable API calls with USDC via x402 (HTTP 402 + EIP-3009) — no accounts, no API keys. Use when an agent needs to call a paid x402 endpoint such as hcrb.in or rail.akrivis.in (24 deterministic checks + 7 revenue modules), handle a 402 challenge, sign the voucher, and verify the signed receipt.
---

# x402 Payer

How an autonomous agent pays for a tool call with USDC on Base — no human, no account, no API key. Payment is the credential.

## When to use

- An endpoint returns **HTTP 402** with an `accepts[]` payment challenge
- You need to call a paid x402 tool (e.g. `hcrb.in` / `rail.akrivis.in` 24 core checks or 7 revenue modules)
- You need to **verify the signed receipt** proving a paid call happened

## Reference rail: Code402 / HCRB (live, Base mainnet)

| Fact | Value |
|---|---|
| Core MCP endpoint (`24` tools) | `https://hcrb.in/mcp` and `https://rail.akrivis.in/mcp` (JSON-RPC 2.0) |
| Modules MCP endpoint (`7` modules) | `https://hcrb.in/mcp?catalog=modules` |
| Manifests | `https://hcrb.in/.well-known/mcp.json` and `https://hcrb.in/.well-known/mcp.json?catalog=modules` |
| Agent reference & evaluation paths | `https://hcrb.in/llms.txt` (`https://hcrb.in/llms-full.txt`) |
| Free tier | 5 free calls/day per client on eligible tools — evaluate first, pay per call when needed |
| Pricing | Every paid call quotes its live price in the HTTP 402 challenge (`accepts[0]`, typically `$0.005–$0.02` USDC on Base) |
| Asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, EIP-712 domain name `USD Coin`, version `2`, chain 8453 |
| Receipt | XDR-1, secp256k1; signer published in the manifest; offline-verifiable (`https://hcrb.in/v1/receipt/verify` is free forever) |

## Evaluation paths (`llms.txt`)

- **Compliance / KYC**: sample `iban-check` → `lei-check` → `vat-mod97-check` → `sanctions-address-screen`, then module `POST /v1/compliance/einvoice-transform` or `POST /v1/oracle/vendor-risk-score`.
- **Settlement / working capital**: sample `balance-check` → `tx-activity`, then module `POST /v1/commerce/accelerate-payout`.
- **FX**: sample `fx-spot-price-oracle` → `calculate-fx-savings`, then module `POST /v1/fx/best-execution-quote`.
- **Additional revenue modules**: `POST /v1/quota/mint-x402`, `POST /v1/multimodal/verify-artifact`, `POST /v1/dip1/adjudicate-dispute`.

## The protocol (always this order)

1. **Call first without paying.** Free tier may cover you. Never sign a voucher before seeing an actual 402.
2. **Parse the 402 challenge**: `accepts[0]` gives `amount` (v2) or `maxAmountRequired` (v1), `payTo`, `asset`, `maxTimeoutSeconds`, `extra.name`, `extra.version`.
3. **Sign EIP-3009 `TransferWithAuthorization`** with your agent wallet:
   - `from` = your address, `to` = `payTo`, `value` = quoted atomic amount (exact — over/underpayment is rejected)
   - `validAfter` = 0, `validBefore` = now + `maxTimeoutSeconds`, `nonce` = random 32 bytes (not sequential)
   - EIP-712 domain: `(extra.name, extra.version, chainId, asset)`
4. **Retry the identical request** with header `X-PAYMENT: base64(JSON)`.
5. **Verify the receipt** (offline, no trust needed):
   - canonical: `v|tool|tool_version|input_hash|output_hash|payer|recipient|amount|nonce|ts|tier` (plus `|successor|stream_state` when either streaming field is present) → keccak256 → recover signer == `receipt.signer`
   - attestation: when `authorization.attestation` is present, recover EIP-191 signer of `authorization.attestation_sig` == `authorization.authorized_by`.

## Hard rules

- **Never pay before a 402.** A 200 means free tier served you.
- **Exact amount only.** The rail binds voucher value to the live quote; mismatches are rejected.
- **One nonce, one intent.** Voucher nonces are single-use server-side; replays are refused.
- **Key hygiene.** Your agent wallet key stays in your environment; it signs authorizations, it is never sent anywhere.
- **Receipts are evidence.** Store them; they are verifiable offline or via `https://hcrb.in/v1/receipt/verify`.
