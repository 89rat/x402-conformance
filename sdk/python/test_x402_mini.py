"""Python SDK end-to-end test against the embedded x402 sandbox (zero funds)."""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from x402_mini import pay_and_call, private_key_to_address  # noqa: E402

here = os.path.dirname(os.path.abspath(__file__))
sandbox = subprocess.Popen(
    ["node", os.path.join(here, "..", "..", "src", "sandbox.mjs")],
    env={**os.environ, "SANDBOX_SERVER_ONLY": "1"},
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
try:
    port = None
    for line in sandbox.stdout:
        if line.startswith("SANDBOX_PORT="):
            port = int(line.split("=")[1].strip())
            break
    if port is None:
        raise RuntimeError("sandbox did not start")

    base = f"http://127.0.0.1:{port}"
    priv = os.urandom(32)
    addr = private_key_to_address(priv)

    results = []
    res1 = pay_and_call(base, "/v1/validate/call", {"input": {"iban": "GB82WEST12345698765432"}}, priv.hex())
    res2 = pay_and_call(base, "/v1/validate/call", {"input": {"iban": "GB82WEST12345698765432"}}, priv.hex())

    def t(name, cond):
        results.append(cond)
        print(f"{'PASS' if cond else 'FAIL'} {name}")

    t("paid call returns 200", res1["status"] == 200)
    t("settlement success", (res1.get("settlement") or {}).get("success") is True)
    t("receipt payer == sdk-derived address", bool(res1.get("receipt")) and res1["receipt"]["payer"].lower() == addr.lower())
    t("receipt verifies offline (raw-keccak XDR-1)", bool(res1.get("verification")) and res1["verification"]["ok"] is True)
    t("second paid call OK (single-use per nonce)", res2["status"] == 200 and res2["verification"]["ok"] is True)

    print(f"\n{sum(results)}/{len(results)} python-sdk tests passed")
    sys.exit(0 if all(results) else 1)
finally:
    sandbox.kill()
