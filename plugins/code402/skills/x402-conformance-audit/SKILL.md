---
name: x402-conformance-audit
description: Audit any x402 endpoint for protocol conformance across Discovery, Tool Execution, Payment Negatives, Protocol Surfaces, Security, and Golden EIP-3009 Vectors. Use when asked to test, score, benchmark, or verify an x402 server or facilitator endpoint.
---

# x402 Conformance Audit Skill

Run the zero-dependency executable conformance suite (`89rat/x402-conformance`) against any live x402 service to produce a deterministic 0–100 score based strictly on measured protocol behavior.

## Quick Execution

```bash
# Audit any live x402 endpoint (uses free tier only; never signs or spends funds)
npx github:89rat/x402-conformance https://hcrb.in

# Run local embedded sandbox replay of the full paid exchange (zero funds)
npx github:89rat/x402-conformance dev
```

## Conformance Groups (19 Checks)

| Group | Verified Protocol Behavior |
|---|---|
| `DISCOVERY` | `/.well-known/x402.json` and `/.well-known/mcp.json` schema, resources, example inputs |
| `TOOL_EXECUTION` | Free-tier tool call execution, deterministic response envelope, XDR-1 receipt presence |
| `PAYMENT_NEGATIVES` | Authentic HTTP 402 challenge (`accepts[]`), rejection of malformed/expired/tampered `X-PAYMENT` headers |
| `PROTOCOL_SURFACES` | MCP JSON-RPC 2.0 handshake (`initialize`, `tools/list`), v2 base64 `PAYMENT-REQUIRED` header |
| `SECURITY` | Single-use nonce enforcement, published receipt signer address, replay rejection |
| `GOLDEN_VECTORS` | RFC-6979 deterministic EIP-3009 digest recomputation, `secp256k1` signer recovery, tamper rejection |

## Guardrails

- **Measured vs. Unmeasured**: Never claim a property passes unless the runner exercised it and recorded `pass`.
- **Zero Custody / Zero Spend**: The conformance runner never touches private keys or submits on-chain transactions during an audit.
