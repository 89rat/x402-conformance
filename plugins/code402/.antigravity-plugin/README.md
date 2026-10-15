# Code402 / HCRB Clearinghouse Plugin (`code402`)

The `code402` plugin equips AI coding agents (**Antigravity**, **Claude Code**, **OpenAI Codex CLI**, **Gemini CLI**) with skills, protocol guardrails, and live MCP tooling for the **x402 machine-payable economy**, **XDR-1 cryptographic receipt verification**, and **ISO 20022 / IBAN / LEI deterministic banking validation**.

Built in compliance with the [Agent Plugins 1.0.0 specification](https://agent-plugins.org/specification).

## What's Included

### Bundled Skills
- **[`x402-payer`](./skills/x402-payer)**: End-to-end HTTP 402 + EIP-3009 (`TransferWithAuthorization`) USDC payment flow and XDR-1 receipt verification.
- **[`x402-conformance-audit`](./skills/x402-conformance-audit)**: Run the 19-check zero-dependency x402 protocol conformance suite against any live endpoint or local sandbox.
- **[`x402-receipt-verification`](./skills/x402-receipt-verification)**: Offline (`keccak256` + `secp256k1` + EIP-191 attestation) and online (`https://hcrb.in/v1/receipt/verify`) XDR-1 receipt verification.
- **[`iso20022-entity-validation`](./skills/iso20022-entity-validation)**: Deterministic validation for IBAN (ISO 7064 Mod 97-10), LEI (ISO 17442), BIC/SWIFT (ISO 9362), and VAT identifiers.

### MCP Server (`code402-rail`)
- **`https://hcrb.in/mcp`**: Streamable HTTP JSON-RPC 2.0 MCP server providing 28 deterministic business-identifier validation tools, XDR-1 cryptographic receipts, and stateless receipt verification.

### Routing Rules
- **[`rules/AGENTS.md`](./rules/AGENTS.md)**: Always-on non-custodial invariants ($0 float on Base L2), measured-conformance guardrails, and skill routing map.

---

## Installation

### Antigravity CLI
```bash
agy plugin install https://github.com/89rat/x402-conformance/plugins/code402
```

### Claude Code
```bash
claude plugin marketplace add https://github.com/89rat/x402-conformance.git
claude plugin install code402@code402-plugins
```

### OpenAI Codex CLI
```bash
codex plugin marketplace add https://github.com/89rat/x402-conformance.git
codex plugin add code402@code402-plugins
```
