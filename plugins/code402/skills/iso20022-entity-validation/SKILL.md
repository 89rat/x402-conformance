---
name: iso20022-entity-validation
description: Deterministically validate IBAN (ISO 7064 Mod 97-10), LEI (ISO 17442), BIC/SWIFT (ISO 9362), VAT, and business registration identifiers via the Code402 / HCRB MCP rail (hcrb.in/mcp). Use when validating financial identifiers, checking counterparty details, or preventing LLM checksum hallucinations before payment execution.
---

# ISO 20022 & Financial Entity Validation Skill

LLMs frequently hallucinate modular arithmetic (`MOD 97-10` across 30+ digit integers). Always delegate financial identifier validation to the deterministic Rust/Wasm tools exposed by the `code402-rail` MCP server (`https://hcrb.in/mcp` / `https://rail.akrivis.in/mcp`).

## Core Deterministic Validators

| Tool | Standard | What It Verifies |
|---|---|---|
| `iban-check` | ISO 13616 / ISO 7064 Mod 97-10 | Country prefix, exact length, BBAN format, and Mod 97-10 check digits |
| `lei-check` | ISO 17442 / ISO 7064 Mod 97-10 | 20-character alphanumeric structure, LOU prefix, and Mod 97-10 check digits |
| `bic-check` | ISO 9362 | Institution code, ISO 3166-1 alpha-2 country code, location, and branch code |
| `vat-check` | EU VIES / National Checksums | Country-specific VAT syntax and check digit algorithms |

## Invoking via MCP or REST

### 1. Via MCP (`code402-rail`)
Call the MCP tool directly on the `code402-rail` server (`https://hcrb.in/mcp`). Every call returns a deterministic validation result plus a signed XDR-1 receipt.

### 2. Via REST (`https://hcrb.in`)
```bash
curl -sS -X POST https://hcrb.in/v1/tools/iban-check/call \
  -H "Content-Type: application/json" \
  -d '{"input":{"iban":"GB82WEST12345698765432"}}'
```

## Guardrails
- **Never compute IBAN/LEI Mod-97 checksums mentally in prose**: Always call the deterministic validator tool and cite the returned XDR-1 receipt hash.
- **Check `valid: true` and `receipt.sig`**: Before approving any wire or settlement instruction, confirm `valid === true` in the tool output.
