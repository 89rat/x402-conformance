// Rust / workers-rs quickstart — x402 challenge on Cloudflare Workers.
// Cargo.toml deps (pinned): worker = "0.8.5", wasm-bindgen = "0.2", reqwest-wasm not needed —
// use worker's Fetch. Build: npx wrangler deploy (workers-rs template).
use worker::*;

const PRICE: &str = "999";
const PAY_TO: &str = "0xYOUR_WALLET";
const ASSET: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const FACILITATOR: &str = "https://facilitator.payai.network";

fn requirements() -> serde_json::Value {
    serde_json::json!({
        "scheme": "exact", "network": "base", "maxAmountRequired": PRICE,
        "asset": ASSET, "payTo": PAY_TO,
        "extra": { "name": "USD Coin", "version": "2" }
    })
}

async fn facilitator(op: &str, payment: &str) -> Result<serde_json::Value> {
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_body(Some(serde_json::to_string(&serde_json::json!({
            "x402Version": 1, "paymentHeader": payment, "paymentRequirements": requirements()
        }))?.into()));
    let req = Fetch::Url(op.parse::<Url>()?.to_string().parse()?); // facilitator URL join
    let mut req = Request::new_with_init(req, &init)?;
    req.headers_mut()?.set("content-type", "application/json")?;
    let resp = Fetch::Request(req).send().await?;
    resp.json().await
}

#[event(fetch)]
async fn main(req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    if req.path() != "/api/validate" { return Response::error("not found", 404); }
    let payment = req.headers().get("x-payment")?.unwrap_or_default();
    if payment.is_empty() {
        return Response::from_json(&serde_json::json!({
            "x402Version": 1, "error": "X402_PAYMENT_REQUIRED",
            "accepts": [{ "maxTimeoutSeconds": 300, ..requirements() }]
        }))?.with_status(402);
    }
    let v = facilitator("/verify", &payment).await?;
    if !v["isValid"].as_bool().unwrap_or(false) {
        return Response::from_json(&serde_json::json!({
            "x402Version": 1, "error": v["invalidReason"] }))?.with_status(402);
    }
    let s = facilitator("/settle", &payment).await?;
    let resp = Response::from_json(&serde_json::json!({ "ok": true, "result": { "valid": true } }))?;
    let mut headers = Headers::new();
    headers.set("x-payment-response", &base64_encode(&s.to_string()))?;
    Ok(resp.with_headers(headers))
}

fn base64_encode(s: &str) -> String {
    // workers::env has no base64; 40-line impl elided — use the `base64 = "0.22"` crate
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(s)
}
