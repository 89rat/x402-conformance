// Next.js Edge middleware quickstart — x402 challenge at the edge (next@14.2.5).
// File: middleware.ts (project root). Protects /premium/* routes.
// Verifies via facilitator /verify + /settle before forwarding.
const CFG = {
  price: "999",
  payTo: process.env.PAY_TO ?? "0xYOUR_WALLET",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "base", name: "USD Coin", version: "2",
  facilitator: process.env.FACILITATOR_URL ?? "https://facilitator.payai.network",
};
const requirements = { scheme: "exact", network: CFG.network, maxAmountRequired: CFG.price,
  asset: CFG.asset, payTo: CFG.payTo, extra: { name: CFG.name, version: CFG.version } };

async function settle(paymentHeader: string) {
  const body = JSON.stringify({ x402Version: 1, paymentHeader, paymentRequirements: requirements });
  const v = await (await fetch(CFG.facilitator + "/verify", { method: "POST", headers: { "content-type": "application/json" }, body })).json();
  if (!v.isValid) return { ok: false, why: v.invalidReason ?? "invalid payment" };
  const s = await (await fetch(CFG.facilitator + "/settle", { method: "POST", headers: { "content-type": "application/json" }, body })).json();
  return { ok: true, settlement: btoa(JSON.stringify(s)) };
}

export async function middleware(req: Request): Promise<Response> {
  const payment = req.headers.get("x-payment");
  if (!payment) return new Response(JSON.stringify({
    x402Version: 1, error: "X402_PAYMENT_REQUIRED",
    accepts: [{ ...requirements, maxTimeoutSeconds: 300 }] }), {
    status: 402, headers: { "content-type": "application/json" } });
  const r = await settle(payment);
  if (!r.ok) return new Response(JSON.stringify({ x402Version: 1, error: r.why }), { status: 402 });
  const resp = fetch(req); // forward to your route handler
  return (await resp.then((res: Response) => {
    const h = new Headers(res.headers); h.set("x-payment-response", r.settlement!);
    return new Response(res.body, { status: res.status, headers: h });
  }));
}

export const config = { matcher: ["/premium/:path*"] };
