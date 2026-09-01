# x402 v1 interop matrix — client × server × facilitator × network

Rule: every cell is either **measured** (date + evidence) or **unmeasured**.
No cell is filled by assumption. The goal is 100% measured coverage of the
reference column, and independent columns filled as third parties appear.

## Reference column (this project)

| # | Client | Server | Facilitator | Network | Handshake to signing | Settlement | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | x402-payer-skill (`pay-call.mjs`) | rail.akrivis.in (28 tools) | payai → dexter failover | Base mainnet | ✅ measured 2026-08-30 (402 parse + quote + voucher sign; receipt verify 4/4) | ⏳ pending funded payer | `x402-payer-skill/README.md`, qa_live 13/13 |
| 2 | x402-payer-skill | code402.dev (28 tools) | payai → dexter failover | Base mainnet | ✅ measured 2026-09-01 (gate.mjs dry run through real 402 challenge) | ⏳ pending funded payer | `x402-gate/` dry-run log |
| 3 | official @x402 v2 buyer SDK | rail.akrivis.in | — | Base mainnet | ✅ measured 2026-08-30 (122/122 harness; base64 PAYMENT-REQUIRED, CAIP-2 accepts, PAYMENT-SIGNATURE) | ⏳ not attempted | buyer-SDK harness |
| 4 | zero-dep reference verifier | (offline) | — | — | ✅ 11/11 self-tests 2026-09-01; golden vectors 3/3 | n/a | `src/reference-verifier.mjs` |
| 5 | gate.mjs artifacts-only agent | code402.dev | — | — | ✅ discovery→402→parse with zero human docs 2026-09-01 | ⏳ blocked on funding | `x402-gate/gate.mjs` |

## Independent implementations (target: 3 SDKs in CI per Phase 3)

| Client | Server | Status |
|---|---|---|
| your SDK here | code402.dev / rail | open — conformance runner + golden vectors are the entry test |

## Facilitator × network

| Facilitator | Base mainnet | Base Sepolia | Measured how |
|---|---|---|---|
| payai.network | ✅ reachable (probed, ms-timed, `/status`) | unmeasured | live probe, 60 s cache |
| dexter.cash | ✅ configured fallback (probe row) | unmeasured | live probe |

## Intermediary behavior (402 + non-standard headers)

| Intermediary | 402 passes | X-PAYMENT forwarded | Measured |
|---|---|---|---|
| Cloudflare (orange-cloud) | ✅ (live services behind CF) | ✅ (paid-path QA + live battery) | 2026-08-30 |
| nginx default (8 KiB header cap) | unmeasured | unmeasured | — |
| Other CDNs | unmeasured | unmeasured | — |

## How to add a column

Run `x402-conformance https://your-server` (100/100 = conformant), then verify
your client against `vectors/golden.json` with `x402-reference-verifier`, and
file the measured row with evidence. Settlement cells stay ⏳ until an on-chain
Transfer is observed — self-reported "works" is not a measurement.
