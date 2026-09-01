// Go net/http quickstart — x402 challenge with stdlib only (go 1.22+).
// Run: FACILITATOR_URL=... PAY_TO=0x... go run main.go
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
)

var cfg = struct{ Price, PayTo, Asset, Network, Name, Version, Facilitator string }{
	"999", os.Getenv("PAY_TO"), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	"base", "USD Coin", "2", os.Getenv("FACILITATOR_URL"),
}

type reqs map[string]any

func requirements() reqs {
	return reqs{"scheme": "exact", "network": cfg.Network, "maxAmountRequired": cfg.Price,
		"asset": cfg.Asset, "payTo": cfg.PayTo, "extra": reqs{"name": cfg.Name, "version": cfg.Version}}
}

func facilitator(op string, payment string) map[string]any {
	body, _ := json.Marshal(reqs{"x402Version": 1, "paymentHeader": payment, "paymentRequirements": requirements()})
	r, err := http.Post(cfg.Facilitator+op, "application/json", bytes.NewReader(body))
	if err != nil { return map[string]any{"isValid": false, "invalidReason": err.Error()} }
	defer r.Body.Close()
	var out map[string]any
	json.NewDecoder(r.Body).Decode(&out)
	return out
}

func requirePayment(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payment := r.Header.Get("x-payment")
		if payment == "" {
			w.Header().Set("content-type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			json.NewEncoder(w).Encode(reqs{"x402Version": 1, "error": "X402_PAYMENT_REQUIRED",
				"accepts": []reqs{func() reqs { q := requirements(); q["maxTimeoutSeconds"] = 300; return q }()}})
			return
		}
		if v := facilitator("/verify", payment); v["isValid"] != true {
			w.Header().Set("content-type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			json.NewEncoder(w).Encode(reqs{"x402Version": 1, "error": v["invalidReason"]})
			return
		}
		s, _ := json.Marshal(facilitator("/settle", payment))
		w.Header().Set("x-payment-response", base64.StdEncoding.EncodeToString(s))
		next(w, r)
	}
}

func main() {
	http.HandleFunc("/api/validate", requirePayment(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"valid": true}})
	}))
	http.ListenAndServe(":8787", nil)
}
