// Case helpers shared by the staff API and the public citizen-report API.
const db = require("../db");
const { nearestOnLine } = require("./geo");
const { SLA_DAYS, CLOSED_STATUSES } = require("./constants");

const SNAP_LIMIT_M = 150;

let roadCache = null;
function roads() {
  if (!roadCache) roadCache = db.prepare("SELECT id, name, area, lat, lng, geometry, geometry_source FROM roads").all()
    .map((r) => ({ ...r, line: JSON.parse(r.geometry) }));
  return roadCache;
}
function invalidateRoads() { roadCache = null; }

// Finds the nearest known road line to a point.
function snap(lat, lng) {
  let best = null;
  for (const r of roads()) {
    const n = nearestOnLine([lat, lng], r.line);
    if (!best || n.distance < best.distance) best = { road: r, distance: n.distance, point: n.point };
  }
  if (!best) return { road_id: null, road: "Unmatched road", area: "Chennai", distance: null };
  if (best.distance <= SNAP_LIMIT_M) {
    return { road_id: best.road.id, road: best.road.name, area: best.road.area, distance: Math.round(best.distance) };
  }
  return { road_id: null, road: `Unmatched road (near ${best.road.name})`, area: best.road.area, distance: Math.round(best.distance) };
}

function nextCode() {
  const row = db.prepare("SELECT code FROM cases WHERE code LIKE 'RW-%' ORDER BY CAST(substr(code, 4) AS INTEGER) DESC LIMIT 1").get();
  const n = row ? parseInt(row.code.slice(3), 10) + 1 : 1;
  return `RW-${String(n).padStart(4, "0")}`;
}

function deadlineFor(severity, from = new Date()) {
  return new Date(from.getTime() + SLA_DAYS[severity] * 86400000).toISOString();
}

const insEvent = db.prepare("INSERT INTO case_events (case_id, title, detail, user_id, user_name, created_at) VALUES (?,?,?,?,?,?)");
function addEvent(caseId, title, detail, user) {
  insEvent.run(caseId, title, detail || "", user ? user.id : null, user ? user.name : "System", new Date().toISOString());
}

// Human-readable deadline state, computed at read time.
function deadlineState(c, now = Date.now()) {
  if (c.status === "Rejected") return "Closed";
  if (!c.deadline) return "Pending triage";
  const due = new Date(c.deadline).getTime();
  if (c.status === "Resolved") {
    const done = c.resolved_at ? new Date(c.resolved_at).getTime() : now;
    return done <= due ? "Met" : "Missed";
  }
  const days = Math.ceil((due - now) / 86400000);
  if (due < now) return "Overdue";
  if (days <= 1) return "Due today";
  return `Due in ${days} days`;
}

function isOpen(status) { return !CLOSED_STATUSES.includes(status); }

module.exports = { snap, nextCode, deadlineFor, addEvent, deadlineState, isOpen, roads, invalidateRoads, SNAP_LIMIT_M };
