#!/usr/bin/env node
// Starts the AI detector (if installed) and the web server together, then opens
// the browser. Ctrl+C stops both.   Flags: --no-ai  --no-browser
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WIN = process.platform === "win32";
const VPY = path.join(ROOT, "detector", ".venv", WIN ? "Scripts/python.exe" : "bin/python");
const MODEL = process.env.MODEL_PATH || path.join(ROOT, "detector", "models", "pothole.pt");
const args = process.argv.slice(2);
const config = require("../server/config");
const kids = [];

function prefix(name, color, stream) {
  let buf = "";
  stream.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/); buf = lines.pop();
    lines.filter(Boolean).forEach((l) => console.log(`\x1b[${color}m[${name}]\x1b[0m ${l}`));
  });
}

function start(name, color, cmd, a, env = {}) {
  const p = spawn(cmd, a, { cwd: ROOT, env: { ...process.env, ...env } });
  prefix(name, color, p.stdout); prefix(name, color, p.stderr);
  p.on("exit", (code) => { if (!shuttingDown) console.log(`[${name}] stopped (code ${code})`); });
  kids.push(p);
  return p;
}

let shuttingDown = false;
function stopAll() {
  if (shuttingDown) return; shuttingDown = true;
  console.log("\nStopping RoadWatch AI…");
  kids.forEach((k) => { try { WIN ? spawnSync("taskkill", ["/pid", String(k.pid), "/T", "/F"]) : k.kill("SIGTERM"); } catch { /* already gone */ } });
  setTimeout(() => process.exit(0), 600);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

function openBrowser(url) {
  if (args.includes("--no-browser")) return;
  const cmd = WIN ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref(); } catch { /* no browser available */ }
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, "node_modules", "express"))) {
    console.log("Dependencies are missing. Run setup first (setup.bat on Windows, ./setup.sh on macOS/Linux)."); process.exit(1);
  }
  if (args.includes("--no-ai")) console.log("Starting without the AI detector (--no-ai).");
  else if (!fs.existsSync(VPY)) console.log("AI detector not installed — run setup to enable photo analysis. Starting web app only.");
  else if (!fs.existsSync(MODEL)) console.log(`Pothole model not found at ${path.relative(ROOT, MODEL)} — run setup. Starting web app only.`);
  else {
    start("ai", "35", VPY, [path.join("detector", "app.py")]);
    process.stdout.write("Loading the AI model…");
    const ok = await waitFor(`${config.detectorUrl}/health`, 90000);
    console.log(ok ? " ready." : " still loading (the web app will connect when it's ready).");
  }
  start("web", "36", process.execPath, [path.join("server", "index.js")]);
  const url = `http://localhost:${config.port}`;
  if (await waitFor(`${url}/api/health`, 20000)) {
    console.log(`\n  ✅ RoadWatch AI is ready:  ${url}\n  📱 Citizen report page:   ${url}/report\n  Press Ctrl+C to stop.\n`);
    openBrowser(url);
  }
})();
