#!/usr/bin/env node
// Parse two x402-conformance runner outputs and write docs/scores.json +
// docs/badge.json (shields.io endpoint schema) for the README badge.
import fs from "node:fs";

function parse(file, label) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/x402 CONFORMANCE SCORE:\s*(\d+)\/(\d+)\s*\((\d+) pass, (\d+) fail, (\d+) skip\)/);
  if (!m) throw new Error(`${label}: no score line found in runner output`);
  return {
    label,
    score: `${m[1]}/${m[2]}`,
    pass: Number(m[3]),
    fail: Number(m[4]),
    skip: Number(m[5]),
    measured_at: new Date().toISOString(),
  };
}

const [railFile, code402File] = process.argv.slice(2);
const results = [parse(railFile, "rail.akrivis.in"), parse(code402File, "code402.dev")];

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/scores.json", JSON.stringify({ results }, null, 2) + "\n");

const msg = results.map((r) => `${r.label} ${r.score}`).join(" · ");
const fail = results.some((r) => r.fail > 0);
const color = fail ? (results.every((r) => r.score === "0/100") ? "red" : "orange") : "brightgreen";
fs.writeFileSync("docs/badge.json", JSON.stringify({ schemaVersion: 1, label: "x402 conformance", message: msg, color }) + "\n");
console.log("scores:", msg, `color=${color}`);
