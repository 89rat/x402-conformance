"""
x402-mini (Python) — a clean-room x402 client SDK, implementable from the
published artifacts alone (ABNF grammar + JSON Schemas + golden vectors).

Flow: POST without payment -> parse the 402 challenge -> build + sign an
EIP-3009 TransferWithAuthorization voucher -> retry with X-PAYMENT (base64)
-> verify the XDR-1 receipt offline.

Deps: pycryptodome (keccak256), ecdsa (secp256k1). A vendored copy may exist
in ./_vendor for zero-install runs; CI installs the pinned versions instead.
"""
import base64
import json
import os
import re
import secrets
import sys
import time
import urllib.request

_vendor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_vendor")
if os.path.isdir(_vendor):
    sys.path.insert(0, _vendor)

from Crypto.Hash import keccak as _keccak  # noqa: E402
import ecdsa  # noqa: E402
from ecdsa import SECP256k1, SigningKey  # noqa: E402
from ecdsa.ellipticcurve import Point  # noqa: E402

GEN = ecdsa.ecdsa.generator_secp256k1
ORDER = GEN.order()
P = SECP256k1.curve.p()

DOMAIN_TYPEHASH = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
TRANSFER_TYPEHASH = "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"


def keccak256(data: bytes) -> bytes:
    h = _keccak.new(digest_bits=256)
    h.update(data)
    return h.digest()


def _w32(n: int) -> bytes:
    return int(n).to_bytes(32, "big")


def _a32(addr: str) -> bytes:
    return bytes.fromhex(addr.removeprefix("0x").lower()).rjust(32, b"\x00")


def _kstr(s: str) -> bytes:
    return keccak256(s.encode())


def _eip712_struct(typestring: str, *fields: bytes) -> bytes:
    return keccak256(_kstr(typestring) + b"".join(fields))


def private_key_to_address(priv: bytes) -> str:
    q = GEN * int.from_bytes(priv, "big")
    pub64 = int(q.x()).to_bytes(32, "big") + int(q.y()).to_bytes(32, "big")
    return "0x" + keccak256(pub64)[-20:].hex()


def _recover_address(digest32: bytes, sig65: bytes) -> str:
    r = int.from_bytes(sig65[0:32], "big")
    s = int.from_bytes(sig65[32:64], "big")
    recid = sig65[64] - 27 if sig65[64] >= 27 else sig65[64]
    if not (0 <= recid <= 3):
        raise ValueError("invalid recovery id")
    x = (r + (ORDER if recid >= 2 else 0)) % P
    y_sq = (pow(x, 3, P) + 7) % P
    y = pow(y_sq, (P + 1) // 4, P)
    if (y * y) % P != y_sq:
        raise ValueError("R not on curve (invalid r)")
    if (y & 1) != (recid & 1):
        y = P - y
    e = int.from_bytes(digest32, "big") % ORDER
    q = ((Point(SECP256k1.curve, x, y) * s) + (GEN * ((ORDER - e) % ORDER))) * pow(r, ORDER - 2, ORDER)
    pub64 = int(q.x()).to_bytes(32, "big") + int(q.y()).to_bytes(32, "big")
    return "0x" + keccak256(pub64)[-20:].hex()


def sign_digest32(digest32: bytes, priv: bytes) -> str:
    """65-byte recoverable signature hex: r||s||v(27/28), recid proven by recovery."""
    sk = SigningKey.from_string(priv, curve=SECP256k1)
    rs = sk.sign_digest_deterministic(digest32, sigencode=ecdsa.util.sigencode_string)
    want = private_key_to_address(priv).lower()
    for v in (0, 1):
        cand = rs + bytes([27 + v])
        try:
            if _recover_address(digest32, cand).lower() == want:
                return cand.hex()
        except ValueError:
            pass
    raise ValueError("could not produce recoverable signature")


def eip3009_digest(domain: dict, auth: dict) -> bytes:
    domain_sep = _eip712_struct(
        DOMAIN_TYPEHASH,
        _kstr(domain["name"]), _kstr(domain["version"]),
        _w32(int(domain["chainId"])), _a32(domain["verifyingContract"]),
    )
    msg = _eip712_struct(
        TRANSFER_TYPEHASH,
        _a32(auth["from"]), _a32(auth["to"]), _w32(int(auth["value"])),
        _w32(int(auth["validAfter"])), _w32(int(auth["validBefore"])),
        bytes.fromhex(auth["nonce"].removeprefix("0x")),
    )
    return keccak256(b"\x19\x01" + domain_sep + msg)


def verify_receipt(receipt: dict) -> dict:
    canon = "|".join(str(receipt[k]) for k in ("v", "tool", "tool_version", "input_hash", "output_hash", "payer", "recipient", "amount", "nonce", "ts", "tier"))
    signer = _recover_address(keccak256(canon.encode()), bytes.fromhex(receipt["signature"].removeprefix("0x")))
    return {"signer": signer, "ok": signer.lower() == str(receipt["signer"]).lower()}


def _post(url: str, body: dict, headers: dict | None = None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def pay_and_call(base: str, path: str, body: dict, private_key: str) -> dict:
    priv = bytes.fromhex(private_key.removeprefix("0x"))
    from_addr = private_key_to_address(priv)

    status, challenge = _post(base + path, body)
    if status != 402:
        return {"status": status, "error": "expected 402 challenge"}

    acc = challenge["accepts"][0]
    chain_id = int(re.match(r"\d+", str(acc["network"]).split(":")[-1]).group())
    now = int(time.time())
    auth = {
        "from": from_addr,
        "to": acc["payTo"],
        "value": str(acc["maxAmountRequired"]),
        "validAfter": str(now - 60),
        "validBefore": str(now + int(acc.get("maxTimeoutSeconds", 300))),
        "nonce": "0x" + secrets.token_bytes(32).hex(),
    }
    domain = {
        "name": acc.get("extra", {}).get("name", "USD Coin"),
        "version": acc.get("extra", {}).get("version", "2"),
        "chainId": chain_id,
        "verifyingContract": acc["asset"],
    }
    signature = "0x" + sign_digest32(eip3009_digest(domain, auth), priv)
    payload = base64.b64encode(json.dumps({
        "x402Version": 1, "scheme": acc["scheme"], "network": acc["network"],
        "payload": {"signature": signature, "authorization": auth},
    }).encode()).decode()

    status, data = _post(base + path, body, {"x-payment": payload})
    if status != 200:
        return {"status": status, "data": data, "error": data.get("error", "paid call failed")}
    receipt = data.get("receipt") or data.get("result", {}).get("receipt")
    return {
        "status": status, "data": data, "receipt": receipt,
        "verification": verify_receipt(receipt) if receipt else None,
        "settlement": data.get("settlement"),
    }
