// SQLite database connection and schema.
const path = require("path");
const fs = require("fs");
const config = require("./config");

// Uses Node's built-in SQLite (node:sqlite), so nothing native has to be
// compiled on install. Needs Node.js 22.13+ (Node 24 LTS recommended).
const warn = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes("SQLite") ? undefined : warn.call(process, w, ...a));
let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); }
catch {
  console.error(`\nRoadWatch AI needs Node.js 22.13 or newer (you have ${process.versions.node}).\nInstall the current LTS version from https://nodejs.org and try again.\n`);
  process.exit(1);
}

// Thin wrapper giving the small API the app uses: prepare/exec/pragma/transaction.
class Database {
  constructor(file) { this.raw = new DatabaseSync(file); }
  prepare(sql) { return this.raw.prepare(sql); }
  exec(sql) { this.raw.exec(sql); }
  pragma(p) { this.raw.exec(`PRAGMA ${p}`); }
  close() { this.raw.close(); }
  transaction(fn) {
    return (...args) => {
      this.raw.exec("BEGIN");
      try { const r = fn(...args); this.raw.exec("COMMIT"); return r; }
      catch (e) { this.raw.exec("ROLLBACK"); throw e; }
    };
  }
}

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new Database(config.dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT DEFAULT '',
  area TEXT DEFAULT '',
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  last_active TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  geometry TEXT NOT NULL,           -- JSON array of [lat, lng]
  geometry_source TEXT NOT NULL,    -- 'osm' or 'illustrative'
  osm_name TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  responsibility TEXT DEFAULT '',
  lead TEXT DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'Repair team',   -- 'Department' or 'Repair team'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  operator TEXT DEFAULT '',
  route TEXT DEFAULT '',
  area TEXT DEFAULT '',
  road_id INTEGER REFERENCES roads(id) ON DELETE SET NULL,
  coverage INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  last_seen TEXT,
  lat REAL, lng REAL
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Reported',
  road_id INTEGER REFERENCES roads(id) ON DELETE SET NULL,
  road TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  snap_distance_m REAL,
  along REAL,                       -- position along the road line (0..1), used to re-place demo cases
  source TEXT NOT NULL,
  vehicle TEXT,
  route TEXT,
  lane INTEGER, lane_count INTEGER, direction TEXT,
  length_cm REAL, width_cm REAL, depth_mm REAL,
  confidence REAL,
  ai_status TEXT NOT NULL DEFAULT 'Not run',
  ai_summary TEXT,
  cause TEXT DEFAULT 'Pending review',
  responsibility TEXT DEFAULT 'Pending verification',
  permit TEXT DEFAULT 'Not applicable',
  description TEXT DEFAULT '',
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  deadline TEXT,
  observations INTEGER NOT NULL DEFAULT 1,
  reporter_name TEXT, reporter_contact TEXT,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_road ON cases(road_id);
CREATE INDEX IF NOT EXISTS idx_cases_created ON cases(created_at);

CREATE TABLE IF NOT EXISTS case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- 'evidence' | 'repair' | 'citizen'
  filename TEXT NOT NULL,            -- stored file name inside data/uploads
  original_name TEXT,
  mime TEXT,
  size INTEGER,
  width INTEGER, height INTEGER,
  detections TEXT,                   -- JSON from the detector, if run
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_case ON attachments(case_id);
`);

module.exports = db;
