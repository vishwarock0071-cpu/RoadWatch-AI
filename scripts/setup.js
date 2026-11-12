#!/usr/bin/env node
// One-time setup after `npm install`:
//   1. Python virtual environment + AI detector packages
//   2. Pretrained pothole model download + self-test
//   3. Real road geometry from OpenStreetMap
//   4. Database with demo data
// Every step is optional in the sense that a failure is reported and the
// app still runs (without AI, or with illustrative road lines).
// Flags: --skip-ai   --skip-roads
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WIN = process.platform === "win32";
const VENV = path.join(ROOT, "detector", ".venv");
const VPY = path.join(VENV, WIN ? "Scripts/python.exe" : "bin/python");
const args = process.argv.slice(2);
const results = [];

const line = (t) => console.log(`\n\x1b[1m\x1b[34m▶ ${t}\x1b[0m`);
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { stdio: "inherit", cwd: ROOT, ...opts }).status === 0;

function findPython() {
  const candidates = WIN ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys;print('%d.%d'%sys.version_info[:2])"], { encoding: "utf8" });
    if (r.status === 0) {
      const [maj, min] = r.stdout.trim().split(".").map(Number);
      if (maj === 3 && min >= 9) return { cmd, pre, version: r.stdout.trim() };
    }
  }
  return null;
}

function setupAI() {
  line("Step 1/4 · AI detector (Python packages)");
  if (args.includes("--skip-ai")) { results.push(["AI detector", "skipped"]); return false; }
  if (!fs.existsSync(VPY)) {
    const py = findPython();
    if (!py) {
      console.log("Python 3.9+ was not found. Install Python 3.11 or 3.12 from https://www.python.org/downloads/ (tick “Add python.exe to PATH”), then run setup again.");
      results.push(["AI detector", "Python not found — app will run without AI"]); return false;
    }
    console.log(`Using Python ${py.version} (${py.cmd})`);
    if (!run(py.cmd, [...py.pre, "-m", "venv", VENV])) { results.push(["AI detector", "could not create virtual environment"]); return false; }
  }
  run(VPY, ["-m", "pip", "install", "--upgrade", "pip", "-q"]);
  // On Linux the default PyTorch wheel bundles CUDA (~2.5 GB); the CPU build is far smaller.
  if (process.platform === "linux") {
    console.log("Installing CPU-only PyTorch (smaller download)…");
    run(VPY, ["-m", "pip", "install", "torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cpu"]);
  }
  console.log("Installing detector packages (first time can take several minutes)…");
  if (!run(VPY, ["-m", "pip", "install", "-r", path.join("detector", "requirements.txt")])) {
    console.log("\nPackage install failed. If you're on a very new Python version, install Python 3.12 and delete detector/.venv, then run setup again.");
    results.push(["AI detector", "package install failed — app will run without AI"]); return false;
  }

  line("Step 2/4 · Pothole detection model");
  if (!run(VPY, [path.join("detector", "download_model.py")])) {
    results.push(["AI model", "not downloaded — see message above"]); return false;
  }
  run(VPY, [path.join("detector", "selftest.py")]);
  results.push(["AI detector", "ready"]);
  return true;
}

function setupRoads() {
  line("Step 3/4 · Real road geometry from OpenStreetMap");
  if (args.includes("--skip-roads")) { results.push(["Road geometry", "skipped (illustrative lines)"]); return; }
  const ok = run(process.execPath, [path.join("scripts", "fetch-roads.js")]);
  results.push(["Road geometry", ok ? "OpenStreetMap roads saved" : "not fetched — illustrative lines (retry: npm run fetch-roads)"]);
}

function setupDb() {
  line("Step 4/4 · Database");
  const config = require("../server/config");
  if (fs.existsSync(config.dbFile)) {
    console.log(`Database already exists at ${path.relative(ROOT, config.dbFile)} — keeping it. (npm run reset-db to start fresh)`);
    results.push(["Database", "kept existing"]); return;
  }
  const db = require("../server/db");
  const { seedIfEmpty } = require("../server/seed");
  seedIfEmpty(db, { demo: config.seedDemo });
  results.push(["Database", config.seedDemo ? "created with demo data" : "created (no demo cases)"]);
}

(function main() {
  const [maj] = process.versions.node.split(".").map(Number);
  const [, mi] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && mi < 13)) { console.log(`Node.js 22.13 or newer is required (you have ${process.versions.node}). Install the LTS version (Node 24) from https://nodejs.org`); process.exit(1); }
  if (!fs.existsSync(path.join(ROOT, "node_modules", "express"))) { console.log("Run `npm install` first."); process.exit(1); }
  setupAI();
  setupRoads();
  setupDb();
  console.log("\n\x1b[1mSetup summary\x1b[0m");
  results.forEach(([k, v]) => console.log(`  ${k.padEnd(14)} ${v}`));
  console.log(`\nStart the app with ${WIN ? "start.bat" : "./start.sh"}  (or: npm run start:all)\n`);
})();
