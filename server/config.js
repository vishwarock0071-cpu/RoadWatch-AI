// Configuration. Values come from environment variables or a .env file in the
// project root (simple KEY=value lines). Sensible defaults let it run as-is.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// A JWT secret is generated once and kept in data/ so sessions survive restarts.
function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(ROOT, "data", ".jwt-secret");
  try { return fs.readFileSync(file, "utf8").trim(); } catch { /* create below */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const s = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, s);
  return s;
}

module.exports = {
  root: ROOT,
  port: Number(process.env.PORT || 8000),
  dbFile: process.env.DB_FILE || path.join(ROOT, "data", "roadwatch.db"),
  uploadDir: path.join(ROOT, "data", "uploads"),
  detectorUrl: (process.env.DETECTOR_URL || "http://127.0.0.1:8001").replace(/\/$/, ""),
  seedDemo: (process.env.SEED_DEMO || "true").toLowerCase() !== "false",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 8),
  jwtSecret: jwtSecret(),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
};
