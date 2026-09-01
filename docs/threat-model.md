# x402 v1 threat model (code402 / openfang-rail reference implementation)

Status: **no external security audit has been performed.** This document states
the trust model plainly; it is not a substitute for an audit. Version-anchored
to the 2026-08-30 deployment (worker 1.1.0, EIP-3009 USDC on Base, chain 8453).

## Assets and trust boundaries

| Asset | Where it lives | Compromise effect |
|---|---|---|
| Payer funds | Payer's own wallet | Never held by the service — non-custodial by construction |
| `RECEIPT_SIGNING_KEY` | Cloudflare write-only secret | Forged receipts (only); rotation path documented |
| Payout `RECIPIENT` | Worker var (public address) | None — payments are payer→recipient on-chain, no intermediary |
| Nonce ledger | Workers KV (eventually consistent) | Replay window (see §1) |
| Facilitator | Third party (payai / dexter) | Settlement liveness, not custody (see §4) |

## 1. Replay and nonce reuse

Vouchers bind `(recipient, value, nonce)`; the nonce is a 32-byte client-chosen
value checked single-use in KV before any other validation. **Residual risk:**
KV is eventually consistent — two racing settlements with the SAME voucher can
both pass the nonce check during the propagation window (typically < 60 s).
The on-chain `transferWithAuthorization` is itself single-use per nonce, so the
loss bound is one payment (the payer cannot lose more than the voucher value).
Ordering rule enforced: replay check runs BEFORE price validation so a replayed
voucher can never be leveraged for price probing.

## 2. Signature malleability

ECDSA `(r,s)` admits a second valid `(r, n−s)`. Mitigations: signers produce
low-s signatures (RFC-6979 deterministic k, noble secp256k1); verifiers MAY
reject high-s. The golden vectors pin low-s outputs. The consequence of a
malleated signature is limited to confusing explorers — the voucher spends the
same nonce, so it cannot double-spend.

## 3. Receipt forgery vs payment forgery

XDR-1 receipts are proof artifacts, not value: forging a receipt key fakes
attestations but cannot move USDC. Value integrity rests entirely on
EIP-3009 signature verification against the USDC contract's EIP-712 domain
(name/version/chainId/verifyingContract pinned per challenge) and on-chain
settlement. Wallet-binding attestation (EIP-191, operator authorizes the
receipt signer) lets third parties detect a substituted receipt key.

## 4. Facilitator trust

The facilitator pays gas and submits `transferWithAuthorization`; it cannot
redirect funds (the voucher names recipient and amount) but it can censor or
delay settlement (liveness risk), and it observes payment metadata. Multi-
facilitator failover (primary + fallback chain) limits censorship; payers
seeking stronger privacy should settle directly with their own submitter —
the protocol does not require the facilitator.

## 5. Harvest-now-decrypt-later

Not applicable to payment vouchers (all data is public at signing; there are
no secrets to harvest). Receipt payloads contain no confidential data —
tool inputs/outputs are hashed, never embedded.

## 6. Abuse and griefing

Free tier (20 calls/day/IP) is the abuse surface: deterministic validators
cap the value of a free call; KV counters makeEnumeration cheap for the
operator. Dynamic pricing floor is the economic griefing bound — a sniping
buyer cannot push a price below its floor, only ride it.

## 7. Intermediaries

402 responses set `Cache-Control: no-store`; `X-PAYMENT`,
`PAYMENT-REQUIRED`, `PAYMENT-OPTIONS`, `X-PAYMENT-RESPONSE` are end-to-end
headers that proxies must forward unmodified. Encoded payloads stay under
16 KiB to clear common CDN caps (grammar: `abnf/x402-headers.abnf`).

## 8. Explicitly out of scope / unmitigated

- KV propagation replay window above one-payment bound (acceptable).
- No external audit. No bug bounty. Size your exposure accordingly.
- The facilitator list is operator-chosen; a hostile facilitator pair could
  collude to censor (never to steal).
