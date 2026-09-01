# x402 clean-room client SDKs

Three independently implemented x402 client SDKs — TypeScript, Python, Go — written against the published artifacts in this repository (ABNF grammar, JSON Schemas, golden vectors), **not** against any service's source code. They demonstrate that the machine-readable contract is sufficient to build a paying client from scratch, in any language.

Each SDK implements the full paying-client flow:

1. POST the tool call without payment → parse the real `402` challenge (`accepts[]`, pay-to, amount, EIP-712 domain parameters).
2. Build and sign an EIP-3009 `TransferWithAuthorization` voucher (secp256k1, recovery id proven by recovery, RFC-6979 where the runtime provides it).
3. Retry with the base64 `X-PAYMENT` header.
4. Verify the returned XDR-1 receipt offline (digest = raw keccak256 over the canonical string — not EIP-191-wrapped).

## Tested in CI, against the sandbox

Every push runs each SDK end-to-end against `src/sandbox.mjs` in server-only mode — a real 402-protected resource with real voucher verification, single-use nonce ledger, and signed receipts — so the whole paying-client exchange is exercised with **zero funds**. See [`sdk.yml`](../.github/workflows/sdk.yml).

| SDK | Path | Crypto deps | Test |
|---|---|---|---|
| TypeScript/ESM | [`sdk/typescript/`](typescript/) | @noble/curves 1.9.7, @noble/hashes 1.8.0 | `node test.mjs` |
| Python 3 | [`sdk/python/`](python/) | pycryptodome 3.23.0, ecdsa 0.19.2 | `python test_x402_mini.py` |
| Go 1.22 | [`sdk/go/`](go/) | btcec/v2 2.3.4, x/crypto 0.27.0 | `go test ./...` |

Run the same testbed yourself: `SANDBOX_SERVER_ONLY=1 node src/sandbox.mjs` prints `SANDBOX_PORT=<n>`, then point any of the SDKs at it.
