# Code402 / HCRB Agent Plugin Rules

## Core Invariants
- **Non-Custodial Invariant**: Strictly $0 custodial float on Base L2. All settlements are direct peer-to-peer EIP-3009 `TransferWithAuthorization` vouchers in USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, chain 8453).
- **Receipt Verification is Free Forever**: `receipt_verify` (`https://hcrb.in/v1/receipt/verify`) is stateless, offline-recomputable (XDR-1 canonical digest + `secp256k1` signer recovery + EIP-191 operator attestation), and free forever.
- **Measured vs. Unmeasured**: Never claim an x402 endpoint passes conformance unless the executable runner (`npx github:89rat/x402-conformance`) exercised the check and recorded `pass`.
- **Working Domains**: Use `https://hcrb.in` and `https://rail.akrivis.in` for live MCP and REST interactions.

## Skill Routing Map
When handling tasks related to x402 payments, conformance auditing, receipt verification, or financial identifier validation, load the corresponding bundled skill:

- **`x402-payer`**: Paying for HTTP 402 machine-payable tool calls via EIP-3009 USDC vouchers and verifying XDR-1 receipts.
- **`x402-conformance-audit`**: Running the 19-check zero-dependency x402 protocol conformance suite against any live endpoint or local sandbox.
- **`x402-receipt-verification`**: Verifying XDR-1 cryptographic settlement receipts both offline and via `https://hcrb.in/v1/receipt/verify`.
- **`iso20022-entity-validation`**: Validating IBAN (ISO 7064 Mod 97-10), LEI (ISO 17442), BIC/SWIFT (ISO 9362), and VAT identifiers deterministically via the `code402-rail` MCP server (`https://hcrb.in/mcp`).
