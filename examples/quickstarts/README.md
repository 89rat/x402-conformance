# x402 multi-runtime quickstarts — protect an API with an x402 payment challenge

Five runtimes, one identical pattern (≤30 logical lines each, pinned deps):

1. Call your protected route without `X-PAYMENT` → client gets a **402 challenge**
   (`accepts[]` with payTo, amount, asset, EIP-712 domain).
2. Client signs an EIP-3009 `TransferWithAuthorization` voucher (USDC on Base).
3. Client retries with `X-PAYMENT: <base64 payload>` → server asks the facilitator
   to `/verify` the voucher, runs the handler, `/settle` the transfer, and returns
   the settlement in `X-PAYMENT-RESPONSE` (base64).

| Runtime | File | Deps (pinned) |
|---|---|---|
| TypeScript / Express | `express.mjs` | `express@4.19.2` |
| TypeScript / Next.js Edge | `nextjs-edge.ts` | `next@14.2.5` |
| Python / FastAPI | `fastapi_app.py` | `fastapi==0.115.0`, `uvicorn==0.30.6`, `httpx==0.27.2` |
| Go / net/http | `main.go` | stdlib only, go ≥ 1.22 |
| Rust / workers-rs | `worker.rs` | `worker = "0.8.5"`, `base64 = "0.22"` |

Configuration (all runtimes): `PAY_TO` (your wallet), `FACILITATOR_URL`
(gas-payer that verifies + settles vouchers; e.g. `https://facilitator.payai.network`).

**Conformance contract** (machine-checkable):
- No header → `402` with `x402Version`, `error: "X402_PAYMENT_REQUIRED"`, `accepts[0]`
  containing `scheme:"exact"`, `network`, `maxAmountRequired` (minor units),
  `asset`, `payTo`, `maxTimeoutSeconds`, `extra.name`, `extra.version`.
- Invalid voucher → `402` with the facilitator's `invalidReason`.
- Valid voucher → handler response + `X-PAYMENT-RESPONSE` header.

Verify any implementation against the suite:
`npx github:89rat/x402-conformance <your-url>`

Reference deployments (live, 28 tools each): https://code402.dev · https://rail.akrivis.in
