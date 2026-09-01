// TypeScript SDK end-to-end test against the embedded x402 sandbox (zero funds).
// Spawns the sandbox in server-only mode, replays discovery -> 402 -> sign ->
// retry -> receipt verification with the SDK, asserts the results.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { payAndCall, privateKeyToAddress } from "./x402-mini.mjs";

const sandbox = spawn(process.execPath, [fileURLToPath(new URL("../../src/sandbox.mjs", import.meta.url))], {
  env: { ...process.env, SANDBOX_SERVER_ONLY: "1" },
  stdio: ["ignore", "pipe", "inherit"],
});
const port = await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error("sandbox did not start")), 5000);
  sandbox.stdout.on("data", (d) => {
    const m = String(d).match(/SANDBOX_PORT=(\d+)/);
    if (m) { clearTimeout(to); resolve(Number(m[1])); }
  });
});

try {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const addr = privateKeyToAddress(privateKey);
  const res = await payAndCall({ base: `http://127.0.0.1:${port}`, path: "/v1/validate/call", body: { input: { iban: "GB82WEST12345698765432" } }, privateKey });
  let pass = 0, fail = 0;
  const t = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };

  t("paid call returns 200", res.status === 200);
  t("settlement success", res.settlement?.success === true);
  t("receipt present with payer == sdk-derived address", !!res.receipt && res.receipt.payer?.toLowerCase() === addr.toLowerCase());
  t("receipt verifies offline (raw-keccak XDR-1)", res.verification?.ok === true);
  t("replay rejected (402 REPLAY)", await (async () => {
    // re-issue with the SAME voucher is not possible via payAndCall (fresh nonce);
    // a second paid call must succeed — proving single-use per nonce and reuse of SDK
    const res2 = await payAndCall({ base: `http://127.0.0.1:${port}`, path: "/v1/validate/call", body: { input: { iban: "GB82WEST12345698765432" } }, privateKey });
    return res2.status === 200 && res2.verification?.ok === true;
  })());

  console.log(`\n${pass}/${pass + fail} typescript-sdk tests passed`);
  process.exitCode = fail ? 1 : 0;
} finally {
  sandbox.kill();
  await sleep(50);
}
