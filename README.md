# x402-conformance

![x402 conformance](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/89rat/x402-conformance/main/docs/badge.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An executable conformance suite for the [x402](https://www.x402.org/) protocol (v1): point it at any x402 service and get a 0–100 score from real protocol behavior — no configuration, no credentials.

The suite measures what a machine actually experiences: discovery artifacts, the 402 challenge, payment negatives, protocol surfaces, security posture, and cryptographic vectors. It is deliberately opinionated about **measured vs unmeasured**: claims that cannot be exercised are not scored.

## Run it

```bash
# from a clone
node src/runner.mjs https://any-x402-service.example

# or straight from this repo with npx
npx github:89rat/x402-conformance https://any-x402-service.example
```

Zero dependencies (Node ≥ 18 builtins only). The runner only ever spends the target service's **free tier** — it never signs or submits a payment.

## What is measured

| Group | What it checks |
|---|---|
| DISCOVERY | `/.well-known/x402.json`, `/.well-known/mcp.json` shape, resources, example inputs |
| TOOL_EXECUTION | free-tier tool call, response shape, receipt presence |
| PAYMENT_NEGATIVES | real 402 challenge, malformed/expired/tampered X-PAYMENT handling |
| PROTOCOL_SURFACES | MCP handshake (`initialize` / `tools/list`), v2 base64 `PAYMENT-REQUIRED`, receipt fields |
| SECURITY | single-use nonce posture, receipt signer published, replay rejection signals |
| GOLDEN_VECTORS | EIP-3009 digest recompute + signer recovery against published vectors, tamper rejection, live receipt cross-verify when the free tier provides one |

Score = passed checks / total. Every run prints a one-line verdict: `x402 CONFORMANCE SCORE: 100/100 (19 pass, 0 fail, 1 skip)`.

## Also in this package

- **`x402-reference-verifier`** — a zero-dependency reference verifier: from-scratch keccak256, bigint secp256k1 public-key recovery, EIP-3009 digest construction, and offline XDR-1 receipt verification. `node src/reference-verifier.mjs` runs an 11/11 self-test. Use it to verify any service's receipts without installing the ecosystem SDK.
- **`vectors/golden.json`** — golden EIP-3009 test vectors with real RFC-6979 deterministic signatures, digests, and derived `from` addresses (positive + negative: expired, wrong recipient, tampered signature).
- **`schema/`** — JSON Schema for the 402 response body and the machine error taxonomy.
- **`abnf/x402-headers.abnf`** — ABNF grammar for `X-PAYMENT`, `PAYMENT-REQUIRED`, `PAYMENT-OPTIONS`, `X-PAYMENT-RESPONSE`.
- **`x402-sandbox`** — replays a full x402 exchange locally in milliseconds with zero funds: embedded server (real 402 challenge, voucher verification, single-use nonce ledger, signed receipt) + client. `npm run sandbox`.
- **`docs/threat-model.md`** — replay, nonce reuse, signature malleability, facilitator trust. **No external audit has been performed** — stated, not implied.
- **`docs/interop-matrix.md`** — client × server × facilitator cells, marked measured vs unmeasured.

## Clean-room client SDKs

Three independently implemented paying-client SDKs — TypeScript, Python, Go — live in [`sdk/`](sdk/README.md). Each is written from the artifacts in this repo alone and is tested in CI against the embedded sandbox: full 402 → sign → retry → receipt-verify exchange, zero funds.

## Quickstarts

Five runtimes, one identical x402 pattern (≤30 logical lines, pinned deps), in [`examples/quickstarts/`](examples/quickstarts/): TypeScript/Express, Next.js Edge, Python/FastAPI, Go `net/http`, Rust/`workers-rs`.

## Live scores

The [conformance workflow](.github/workflows/conformance.yml) measures two production x402 services hourly and commits the results:

- [`docs/scores.json`](docs/scores.json) — per-service pass/fail/skip + timestamp
- badge at the top of this README updates from that file

## Status & scope

- Protocol version targeted: x402 v1 (+ v2 base64 `PAYMENT-REQUIRED` where served).
- The suite is a measurement tool, not a certification program; a 100/100 score means the checks in this repo passed today.
- Security documentation is honest-by-default: unmeasured claims are labeled, and audit status is stated explicitly.

## License

[MIT](LICENSE)
