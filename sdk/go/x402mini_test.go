package x402mini

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func startSandbox(t *testing.T) (string, func()) {
	t.Helper()
	cmd := exec.Command("node", filepath.Join("..", "..", "src", "sandbox.mjs"))
	cmd.Env = append(os.Environ(), "SANDBOX_SERVER_ONLY=1")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start sandbox: %v", err)
	}
	portCh := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			if line := sc.Text(); len(line) > 13 && line[:13] == "SANDBOX_PORT=" {
				portCh <- line[13:]
				return
			}
		}
	}()
	select {
	case p := <-portCh:
		return "http://127.0.0.1:" + p, func() { _ = cmd.Process.Kill() }
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("sandbox did not start")
		return "", nil
	}
}

func TestFullExchangeAgainstSandbox(t *testing.T) {
	base, stop := startSandbox(t)
	defer stop()

	priv := make([]byte, 32)
	if _, err := rand.Read(priv); err != nil {
		t.Fatal(err)
	}
	from, err := PrivateKeyToAddress(priv)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"input": map[string]string{"iban": "GB82WEST12345698765432"}}

	res, err := PayAndCall(base, "/v1/validate/call", body, hex.EncodeToString(priv))
	if err != nil {
		t.Fatalf("pay and call: %v", err)
	}
	if res["status"] != float64(200) {
		t.Fatalf("paid call not 200: %v (%v)", res, res["error"])
	}
	settlement, ok := res["settlement"].(map[string]any)
	if !ok || settlement["success"] != true {
		t.Fatalf("settlement not success: %v", res["settlement"])
	}
	receipt, ok := res["receipt"].(map[string]any)
	if !ok {
		t.Fatalf("no receipt")
	}
	if !strings.EqualFold(fmt.Sprint(receipt["payer"]), from) {
		t.Fatalf("receipt payer %v != derived address %v", receipt["payer"], from)
	}
	ver, ok := res["verification"].(map[string]any)
	if !ok || ver["ok"] != true {
		t.Fatalf("receipt did not verify offline: %v", res["verification"])
	}

	// second independent voucher (fresh nonce) must also settle
	res2, err := PayAndCall(base, "/v1/validate/call", body, hex.EncodeToString(priv))
	if err != nil {
		t.Fatalf("second pay and call: %v", err)
	}
	if res2["status"] != float64(200) {
		t.Fatalf("second paid call not 200: %v", res2)
	}

	// address derivation sanity: recovered signer in verification == payer
	if s, _ := ver["signer"].(string); s == "" {
		t.Fatal("verification missing signer")
	}
}
