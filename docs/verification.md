# Receipt verification — one standard, offline or online

XDR-1 receipts are signed proof artifacts from x402 payments: any recipient should be
able to check one without trusting the issuer, installing an SDK, or paying anything.

This repo ships both paths:

## 1. Offline — the reference verifier

`src/reference-verifier.mjs` recomputes the receipt digest and recovers the signer from
the signature using built-in Node only — a from-scratch keccak256 and bigint secp256k1
public-key recovery. No dependencies, no network, no credentials.

```bash
node src/reference-verifier.mjs            # 11/11 self-tests + golden vectors
```

Canonical form: `keccak256` over the UTF-8 string

```
v|tool|tool_version|input_hash|output_hash|payer|recipient|amount|nonce|ts|tier
```

with a trailing `|successor|stream_state` pair appended **only when** the receipt carries
`successor` or `stream_state` — matching the live issuing rails. The digest is **not**
EIP-191-wrapped (EIP-191 wrapping is reserved for wallet-binding attestations).

## 2. Online — the free stateless endpoint

```bash
npx github:89rat/x402-conformance verify receipt.json      # offline + online
npx github:89rat/x402-conformance verify --offline receipt.json
echo '{...}' | npx github:89rat/x402-conformance verify -  # stdin
```

The default online check is `POST https://hcrb.in/v1/receipt/verify` with body
`{"receipt": {...}}`. That endpoint:

- is **stateless** — it recomputes validity from the receipt itself and stores nothing;
- is **free** — no account, no payment, no key, no SDK;
- accepts **any** XDR-1 receipt, regardless of which x402 service issued it;
- returns `{"ok":true,"value":{"valid":true|false,"signer_recovered":"0x…","declared_signer":"0x…","digest":"0x…","canonical":"…"}}`.

Override the endpoint with `VERIFY_URL=...` if you prefer your own.

The online and offline paths compute the same digest from the same canonical form, so a
receipt that verifies one way verifies the other — the double check exists so a transport
failure can never read as a verdict: the CLI reports each path separately and only says
**VALID** when both agree.

## Receipts as proof, not promises

A valid receipt proves: a specific tool call, at a specific timestamp, was signed by the
declared signer with the declared digest. It does **not** prove the issuer's business
claims, the tool's semantics, or that anyone was paid — settle state lives on-chain. When
you embed a receipt in a report, say what it is: a signed record, verifiable offline.
