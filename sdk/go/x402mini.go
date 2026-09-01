// Package x402mini is a clean-room x402 client SDK (Go), implementable from
// the published artifacts alone (ABNF grammar + JSON Schemas + golden vectors).
//
// Flow: POST without payment -> parse the 402 challenge -> build + sign an
// EIP-3009 TransferWithAuthorization voucher -> retry with X-PAYMENT (base64)
// -> verify the XDR-1 receipt offline.
package x402mini

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/btcsuite/btcd/btcec/v2"
	becdsa "github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"golang.org/x/crypto/sha3"
)

func keccak256(b []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(b)
	return h.Sum(nil)
}

func w32(n *big.Int) []byte {
	out := make([]byte, 32)
	n.FillBytes(out)
	return out
}

func a32(addr string) ([]byte, error) {
	h := strings.TrimPrefix(strings.ToLower(addr), "0x")
	b, err := hex.DecodeString(h)
	if err != nil || len(b) != 20 {
		return nil, fmt.Errorf("bad address %q", addr)
	}
	return append(make([]byte, 12), b...), nil
}

func kstr(s string) []byte { return keccak256([]byte(s)) }

func eip712Struct(typeString string, fields ...[]byte) []byte {
	return keccak256(append(keccak256([]byte(typeString)), bytes.Join(fields, nil)...))
}

const (
	domainTypehash  = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
	transferTypehash = "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
)

// EIP3009Digest builds the EIP-712 digest for a TransferWithAuthorization voucher.
func EIP3009Digest(domain map[string]any, auth map[string]string) ([]byte, error) {
	contract, err := a32(domain["verifyingContract"].(string))
	if err != nil {
		return nil, err
	}
	chainID, err := strconv.ParseInt(fmt.Sprint(domain["chainId"]), 10, 64)
	if err != nil {
		return nil, err
	}
	ds := eip712Struct(domainTypehash,
		kstr(domain["name"].(string)),
		kstr(domain["version"].(string)),
		w32(big.NewInt(chainID)),
		contract,
	)
	from, err := a32(auth["from"])
	if err != nil {
		return nil, err
	}
	to, err := a32(auth["to"])
	if err != nil {
		return nil, err
	}
	val := new(big.Int)
	if _, ok := val.SetString(auth["value"], 10); !ok {
		return nil, fmt.Errorf("bad value %q", auth["value"])
	}
	va := new(big.Int)
	if _, ok := va.SetString(auth["validAfter"], 10); !ok {
		return nil, fmt.Errorf("bad validAfter %q", auth["validAfter"])
	}
	vb := new(big.Int)
	if _, ok := vb.SetString(auth["validBefore"], 10); !ok {
		return nil, fmt.Errorf("bad validBefore %q", auth["validBefore"])
	}
	nonce, err := hex.DecodeString(strings.TrimPrefix(auth["nonce"], "0x"))
	if err != nil {
		return nil, err
	}
	msg := eip712Struct(transferTypehash, from, to, w32(val), w32(va), w32(vb), nonce)
	return keccak256(append([]byte{0x19, 0x01}, append(ds, msg...)...)), nil
}

// PrivateKeyToAddress derives the 0x address for a secp256k1 private key.
func PrivateKeyToAddress(priv []byte) (string, error) {
	_, pub := btcec.PrivKeyFromBytes(priv)
	return addressFromPub(pub)
}

func addressFromPub(pub *btcec.PublicKey) (string, error) {
	un := pub.SerializeUncompressed() // 65 bytes, prefix 0x04
	return "0x" + hex.EncodeToString(keccak256(un[1:])[12:]), nil
}

// SignDigest32 returns a 65-byte recoverable signature hex (r||s||v, v=27/28).
func SignDigest32(digest []byte, priv []byte) (string, error) {
	key, _ := btcec.PrivKeyFromBytes(priv)
	sig := becdsa.Sign(key, digest)
	var rs [64]byte // compact r||s — Serialize() is DER, so pack the scalars directly
	r, s := sig.R(), sig.S()
	r.PutBytesUnchecked(rs[:32])
	s.PutBytesUnchecked(rs[32:64])
	dbg := fmt.Sprintf("dbg: len(rs)=%d len(digest)=%d\n", len(rs), len(digest))
	fmt.Fprint(os.Stderr, dbg)
	want, err := PrivateKeyToAddress(priv)
	if err != nil {
		return "", err
	}
	firstErr := error(nil)
	for _, v := range []byte{27, 28} {
		cand := append(append([]byte{}, rs[:]...), v)
		pub, wasCompressed, err := becdsa.RecoverCompact(cand, digest)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		addr, err := addressFromPub(pub)
		if err == nil && strings.EqualFold(addr, want) {
			return hex.EncodeToString(cand), nil
		}
		_ = wasCompressed
	}
	return "", fmt.Errorf("could not produce recoverable signature (firstErr=%v)", firstErr)
}

// VerifyReceipt verifies an XDR-1 receipt: digest = raw keccak256 over the
// canonical string (NOT EIP-191-wrapped); recovers and compares the signer.
func VerifyReceipt(receipt map[string]any) (map[string]any, error) {
	fields := []string{"v", "tool", "tool_version", "input_hash", "output_hash", "payer", "recipient", "amount", "nonce", "ts", "tier"}
	parts := make([]string, len(fields))
	for i, f := range fields {
		parts[i] = fmt.Sprint(receipt[f])
	}
	digest := keccak256([]byte(strings.Join(parts, "|")))
	sigHex := strings.TrimPrefix(fmt.Sprint(receipt["signature"]), "0x")
	sig, err := hex.DecodeString(sigHex)
	if err != nil || len(sig) != 65 {
		return nil, fmt.Errorf("signature must be 65 bytes hex")
	}
	pub, _, err := becdsa.RecoverCompact(sig, digest)
	if err != nil {
		return nil, err
	}
	signer, err := addressFromPub(pub)
	if err != nil {
		return nil, err
	}
	return map[string]any{"signer": signer, "ok": strings.EqualFold(signer, fmt.Sprint(receipt["signer"]))}, nil
}

// PayAndCall performs the full x402 exchange against base+path for the given
// JSON body, paying from the provided 32-byte secp256k1 private key (hex).
func PayAndCall(base, path string, body map[string]any, privateKeyHex string) (map[string]any, error) {
	priv, err := hex.DecodeString(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil || len(priv) != 32 {
		return nil, fmt.Errorf("private key must be 32 bytes hex")
	}
	from, err := PrivateKeyToAddress(priv)
	if err != nil {
		return nil, err
	}

	challenge, err := postJSON(base+path, body, nil)
	if err != nil {
		return nil, err
	}
	if challenge["accepts"] == nil {
		return map[string]any{"error": "expected 402 challenge"}, nil
	}
	acc := challenge["accepts"].([]any)[0].(map[string]any)

	network := fmt.Sprint(acc["network"])
	last := network[strings.LastIndex(network, ":")+1:]
	re := regexp.MustCompile(`\d+`)
	chainID := re.FindString(last)

	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	timeout := 300.0
	if t, ok := acc["maxTimeoutSeconds"].(float64); ok {
		timeout = t
	}
	auth := map[string]string{
		"from":        from,
		"to":          fmt.Sprint(acc["payTo"]),
		"value":       fmt.Sprint(acc["maxAmountRequired"]),
		"validAfter":  strconv.FormatInt(time.Now().Unix()-60, 10),
		"validBefore": strconv.FormatInt(time.Now().Unix()+int64(timeout), 10),
		"nonce":       "0x" + hex.EncodeToString(nonce),
	}
	extra, _ := acc["extra"].(map[string]any)
	domain := map[string]any{
		"name":              "USD Coin",
		"version":           "2",
		"chainId":           chainID,
		"verifyingContract": fmt.Sprint(acc["asset"]),
	}
	if extra != nil {
		if v, ok := extra["name"]; ok {
			domain["name"] = v
		}
		if v, ok := extra["version"]; ok {
			domain["version"] = v
		}
	}
	digest, err := EIP3009Digest(domain, auth)
	if err != nil {
		return nil, err
	}
	sig, err := SignDigest32(digest, priv)
	if err != nil {
		return nil, err
	}
	scheme := "exact"
	if s, ok := acc["scheme"]; ok {
		scheme = fmt.Sprint(s)
	}
	env := map[string]any{
		"x402Version": 1, "scheme": scheme, "network": network,
		"payload": map[string]any{"signature": "0x" + sig, "authorization": auth},
	}
	raw, err := json.Marshal(env)
	if err != nil {
		return nil, err
	}
	paid, err := postJSON(base+path, body, map[string]string{"x-payment": base64.StdEncoding.EncodeToString(raw)})
	if err != nil {
		return nil, err
	}
	out := map[string]any{"data": paid}
	if paid["_status"] == float64(200) {
		out["status"] = 200
		if receipt, ok := paid["receipt"].(map[string]any); ok {
			ver, err := VerifyReceipt(receipt)
			if err != nil {
				return nil, err
			}
			out["receipt"] = receipt
			out["verification"] = ver
		}
		if settlement, ok := paid["settlement"]; ok {
			out["settlement"] = settlement
		}
		return out, nil
	}
	out["status"] = paid["_status"]
	if e, ok := paid["error"]; ok {
		out["error"] = e
	}
	return out, nil
}

func postJSON(url string, body map[string]any, headers map[string]string) (map[string]any, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest("POST", url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	out := map[string]any{"_status": float64(res.StatusCode)}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil && res.StatusCode != 200 {
		return nil, err
	}
	if res.StatusCode >= 400 && res.StatusCode != 402 {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return out, nil
}
