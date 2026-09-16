# The conformance badge — one mark, earned by measurement

The badge at the top of the README is not decoration. It renders the score that the
**executable suite** produced from real protocol behavior, and it updates from CI on
schedule. Any x402 service can earn the same mark the same way — there is no special
access and no hand-scoring.

## How a service earns the badge

1. Run the suite against your live origin: `npx github:89rat/x402-conformance https://your-service`
   (the runner only uses your free tier — it never signs or submits a payment).
2. Publish your score honestly: the badge points at `docs/badge.json` in your own fork or
   repo, exactly like this repo's own badge. Keep the runner in CI so the mark tracks the
   live surface, not a snapshot.
3. Put the badge where machines and humans look for it — your README, your `/pricing`
   page, your `/.well-known/mcp.json` description.

## What the badge says and does not say

- It says: this surface measured **N/100** on the public suite on a real date, and the
  checks are listed in the suite — discovery, the 402 challenge, payment negatives, receipt
  presence, cryptographic vectors.
- It does **not** say: security-audited, revenue, latency, custody, compliance, or that any
  human reviewed it. A service that claims the badge means more than that is misusing it;
  the suite's whole point is measured-vs-unmeasured, and the mark inherits that honesty.

## Why a neutral mark helps every seller

Agents that pay per call cannot ask follow-up questions; a wrong number is a failed sale.
A public, runnable, reproducible score is the cheapest trust signal a seller can offer a
machine buyer — cheaper than prose, and falsifiable in one command. The suite is
origin-agnostic: it scores any x402 v1 service the same way, including (and especially)
competitors. That neutrality is the point of publishing it.
