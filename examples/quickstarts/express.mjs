// Express quickstart — protect any route with an x402 payment challenge.
// Deps: express@4.19.2  |  Run: FACILITATOR_URL=... PAY_TO=0x... node express.mjs
// Pattern: no X-PAYMENT -> 402 challenge. Present -> facilitator verify+settle -> handler.
import express from "express";

const CFG = {
  price: "999",                                        // minor units (0.000999 USDC)
  payTo: process.env.PAY_TO ?? "0xYOUR_WALLET",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  network: "base", chainId: 8453, name: "USD Coin", version: "2",
  facilitator: process.env.FACILITATOR_URL ?? "https://facilitator.payai.network",
};
const app = express();
app.use(express.json());

const challenge = (res) => res.status(402).json({
  x402Version: 1, error: "X402_PAYMENT_REQUIRED",
  accepts: [{ scheme: "exact", network: CFG.network, maxAmountRequired: CFG.price,
    asset: CFG.asset, payTo: CFG.payTo, maxTimeoutSeconds: 300,
    extra: { name: CFG.name, version: CFG.version } }],
});

export async function requirePayment(req, res, next) {
  if (!req.header("x-payment")) return challenge(res);
  const r = await fetch(CFG.facilitator + "/verify", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentHeader: req.header("x-payment"),
      paymentRequirements: { scheme: "exact", network: CFG.network, maxAmountRequired: CFG.price,
        asset: CFG.asset, payTo: CFG.payTo, extra: { name: CFG.name, version: CFG.version } } }) });
  const v = await r.json();
  if (!v.isValid) return res.status(402).json({ x402Version: 1, error: v.invalidReason ?? "invalid payment" });
  const s = await (await fetch(CFG.facilitator + "/settle", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentHeader: req.header("x-payment"),
      paymentRequirements: { scheme: "exact", network: CFG.network, maxAmountRequired: CFG.price,
        asset: CFG.asset, payTo: CFG.payTo, extra: { name: CFG.name, version: CFG.version } } }) })).json();
  res.set("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(s)).toString("base64"));
  next();
}

app.post("/api/validate", requirePayment, (req, res) => res.json({ ok: true, result: { valid: true } }));
app.listen(8787, () => console.log("x402-protected API on :8787"));
