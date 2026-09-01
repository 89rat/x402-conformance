# FastAPI quickstart — x402 challenge middleware (Python 3.12).
# Deps: fastapi==0.115.0 uvicorn==0.30.6 httpx==0.27.2
# Run: FACILITATOR_URL=... PAY_TO=0x... uvicorn fastapi_app:app --port 8787
import os
import json
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

CFG = {
    "price": "999",
    "pay_to": os.environ.get("PAY_TO", "0xYOUR_WALLET"),
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  # USDC on Base
    "network": "base", "name": "USD Coin", "version": "2",
    "facilitator": os.environ.get("FACILITATOR_URL", "https://facilitator.payai.network"),
}

app = FastAPI()


def requirements():
    return {"scheme": "exact", "network": CFG["network"], "maxAmountRequired": CFG["price"],
            "asset": CFG["asset"], "payTo": CFG["pay_to"],
            "extra": {"name": CFG["name"], "version": CFG["version"]}}


async def require_payment(request: Request):
    """Return a 402 JSONResponse when the request has no valid payment, else None."""
    header = request.headers.get("x-payment")
    if not header:
        return JSONResponse({"x402Version": 1, "error": "X402_PAYMENT_REQUIRED",
                             "accepts": [{**requirements(), "maxTimeoutSeconds": 300}]}, status_code=402)
    body = {"x402Version": 1, "paymentHeader": header, "paymentRequirements": requirements()}
    async with httpx.AsyncClient(timeout=15) as c:
        v = (await c.post(CFG["facilitator"] + "/verify", json=body)).json()
        if not v.get("isValid"):
            return JSONResponse({"x402Version": 1, "error": v.get("invalidReason", "invalid payment")}, status_code=402)
        s = (await c.post(CFG["facilitator"] + "/settle", json=body)).json()
    request.state.settlement = json.dumps(s)
    return None


@app.post("/api/validate")
async def validate(request: Request):
    denied = await require_payment(request)
    if denied:
        return denied
    return JSONResponse({"ok": True, "result": {"valid": True}},
                        headers={"x-payment-response": request.state.settlement})
