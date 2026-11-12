// Map data, dashboard metrics, analytics, team workload and notifications.
// Everything here is computed live from the database.
const express = require("express");
const db = require("../db");
const { TYPES } = require("../lib/constants");
const { haversine } = require("../lib/geo");
const { OPEN_SQL } = require("./cases");

const router = express.Router();
const SEV_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const DAY = 86400000;
const isoAgo = (days) => new Date(Date.now() - days * DAY).toISOString();
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);

router.get("/map", (req, res) => {
  const roads = db.prepare("SELECT id, name, area, geometry, geometry_source, osm_name FROM roads").all();
  const open = db.prepare(`SELECT id, code, lat, lng, severity, type, road, road_id, area, status, vehicle, route, is_synthetic FROM cases WHERE ${OPEN_SQL}`).all();
  const byRoad = new Map();
  for (const c of open) {
    if (!c.road_id) continue;
    const g = byRoad.get(c.road_id) || { count: 0, worst: "Low", bySeverity: { Critical: 0, High: 0, Medium: 0, Low: 0 } };
    g.count++; g.bySeverity[c.severity]++;
    if (SEV_RANK[c.severity] < SEV_RANK[g.worst]) g.worst = c.severity;
    byRoad.set(c.road_id, g);
  }
  const repairs = db.prepare(`SELECT id, code, lat, lng, status FROM cases WHERE status IN ('Assigned','In Repair','Awaiting Verification','Needs Rework')
    OR (status='Resolved' AND resolved_at > ?)`).all(isoAgo(30));
  const vehicles = db.prepare("SELECT v.code, v.type, v.route, v.road_id, v.lat, v.lng FROM vehicles v WHERE status='Active'").all();
  res.json({
    roads: roads.map((r) => ({ id: r.id, name: r.name, area: r.area, geometry: JSON.parse(r.geometry), geometry_source: r.geometry_source, osm_name: r.osm_name, ...(byRoad.get(r.id) || { count: 0, worst: null }) })),
    cases: open.map((c) => [c.id, c.code, +c.lat.toFixed(6), +c.lng.toFixed(6), c.severity, c.type, c.road, c.status, c.area, c.vehicle || "", c.route || "", c.is_synthetic]),
    repairs: repairs.map((c) => [c.id, c.code, c.lat, c.lng, c.status]),
    vehicles,
  });
});

function series(period) {
  // Returns { labels, created[], resolved[] } bucketed by day or week.
  const weekly = period === "12w";
  const buckets = weekly ? 12 : period === "7d" ? 7 : 30;
  const size = weekly ? 7 : 1;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const from = new Date(start.getTime() - (buckets * size - 1) * DAY);
  const created = Array(buckets).fill(0), resolved = Array(buckets).fill(0);
  const idx = (iso) => Math.floor((new Date(iso).getTime() - from.getTime()) / (size * DAY));
  for (const r of db.prepare("SELECT created_at FROM cases WHERE status!='Rejected' AND created_at>=?").all(from.toISOString())) {
    const i = idx(r.created_at); if (i >= 0 && i < buckets) created[i]++;
  }
  for (const r of db.prepare("SELECT resolved_at FROM cases WHERE status='Resolved' AND resolved_at>=?").all(from.toISOString())) {
    const i = idx(r.resolved_at); if (i >= 0 && i < buckets) resolved[i]++;
  }
  const labels = Array.from({ length: buckets }, (_, i) => {
    const d = new Date(from.getTime() + i * size * DAY);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  });
  return { labels, created, resolved, unit: weekly ? "week" : "day" };
}

function coverage() {
  const rows = db.prepare("SELECT type, AVG(coverage) avg, COUNT(*) n FROM vehicles WHERE status='Active' GROUP BY type").all();
  const bus = rows.find((r) => r.type === "Government bus"), gc = rows.find((r) => r.type === "Garbage collection");
  const all = db.prepare("SELECT AVG(coverage) avg FROM vehicles WHERE status='Active'").get().avg;
  return { overall: Math.round(all || 0), bus: Math.round(bus?.avg || 0), garbage: Math.round(gc?.avg || 0), busCount: bus?.n || 0, garbageCount: gc?.n || 0 };
}

router.get("/dashboard", (req, res) => {
  const now = new Date().toISOString();
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const valid = db.prepare("SELECT COUNT(*) n FROM cases WHERE status!='Rejected'").get().n;
  const last30 = db.prepare("SELECT COUNT(*) n FROM cases WHERE status!='Rejected' AND created_at>=?").get(isoAgo(30)).n;
  const prev30 = db.prepare("SELECT COUNT(*) n FROM cases WHERE status!='Rejected' AND created_at>=? AND created_at<?").get(isoAgo(60), isoAgo(30)).n;
  const critical = db.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT area) areas FROM cases WHERE severity='Critical' AND ${OPEN_SQL}`).get();
  const overdue = db.prepare(`SELECT COUNT(*) n FROM cases WHERE ${OPEN_SQL} AND deadline<?`).get(now).n;
  const dueToday = db.prepare(`SELECT COUNT(*) n FROM cases WHERE ${OPEN_SQL} AND deadline>=? AND deadline<=?`).get(now, endToday.toISOString()).n;
  const resolved = db.prepare("SELECT COUNT(*) n FROM cases WHERE status='Resolved'").get().n;
  const res30 = db.prepare("SELECT COUNT(*) n FROM cases WHERE status='Resolved' AND resolved_at>=?").get(isoAgo(30)).n;
  const resPrev = db.prepare("SELECT COUNT(*) n FROM cases WHERE status='Resolved' AND resolved_at>=? AND resolved_at<?").get(isoAgo(60), isoAgo(30)).n;
  const synthetic = db.prepare("SELECT COUNT(*) n FROM cases WHERE is_synthetic=1").get().n;
  const osmRoads = db.prepare("SELECT COUNT(*) n FROM roads WHERE geometry_source='osm'").get().n;
  res.json({
    valid, newChange: pct(last30, prev30), last30,
    critical: critical.n, criticalAreas: critical.areas,
    overdue, dueToday,
    resolved, resolvedChange: pct(res30, resPrev), resolved30: res30,
    coverage: coverage(), trend: series(req.query.period || "30d"),
    synthetic, osmRoads, totalRoads: db.prepare("SELECT COUNT(*) n FROM roads").get().n,
  });
});

router.get("/trend", (req, res) => res.json(series(req.query.period || "30d")));

// Open cases of the same damage type within 10 m of a previously resolved
// case on the same road (the repair likely failed).
function repeatDamage() {
  const resolved = db.prepare("SELECT road_id, type, lat, lng, resolved_at FROM cases WHERE status='Resolved' AND road_id IS NOT NULL").all();
  const open = db.prepare(`SELECT id, road_id, type, lat, lng, created_at FROM cases WHERE ${OPEN_SQL} AND road_id IS NOT NULL`).all();
  const byRoad = new Map();
  resolved.forEach((r) => { if (!byRoad.has(r.road_id)) byRoad.set(r.road_id, []); byRoad.get(r.road_id).push(r); });
  let n = 0;
  for (const c of open) {
    const list = byRoad.get(c.road_id) || [];
    if (list.some((r) => r.type === c.type && r.resolved_at < c.created_at && haversine([r.lat, r.lng], [c.lat, c.lng]) <= 10)) n++;
  }
  return n;
}

router.get("/analytics", (req, res) => {
  const now = new Date().toISOString();
  const types = db.prepare("SELECT type, COUNT(*) n FROM cases WHERE status!='Rejected' GROUP BY type").all();
  const typeCounts = TYPES.map((t) => ({ type: t, n: types.find((x) => x.type === t)?.n || 0 }));
  const vehCov = db.prepare("SELECT area, AVG(coverage) cov FROM vehicles WHERE status='Active' GROUP BY area").all();
  const wards = db.prepare(`SELECT area,
      SUM(CASE WHEN status!='Rejected' THEN 1 ELSE 0 END) valid,
      SUM(CASE WHEN severity='Critical' AND ${OPEN_SQL} THEN 1 ELSE 0 END) critical,
      SUM(CASE WHEN ${OPEN_SQL} AND deadline<@now THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN status='Resolved' THEN 1 ELSE 0 END) resolved
    FROM cases GROUP BY area ORDER BY valid DESC`).all({ now })
    .map((w) => ({ ...w, coverage: Math.round(vehCov.find((v) => v.area === w.area)?.cov || 0) || null }));
  const sla = db.prepare("SELECT SUM(CASE WHEN resolved_at<=deadline THEN 1 ELSE 0 END) met, COUNT(*) n, AVG(julianday(resolved_at)-julianday(created_at)) days FROM cases WHERE status='Resolved'").get();
  res.json({
    repeat: repeatDamage(),
    awaiting: db.prepare("SELECT COUNT(*) n FROM cases WHERE status='Awaiting Verification'").get().n,
    coverage: coverage(),
    excavation: db.prepare(`SELECT COUNT(*) n FROM cases WHERE type='Utility road cut' AND ${OPEN_SQL} AND permit IN ('Pending verification','Not found in records')`).get().n,
    slaMet: sla.n ? Math.round((sla.met / sla.n) * 100) : null,
    avgRepairDays: sla.days ? Math.round(sla.days * 10) / 10 : null,
    typeCounts, wards, trend: series("12w"),
  });
});

router.get("/teams", (req, res) => {
  const now = new Date().toISOString();
  const teams = db.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM cases c WHERE c.team_id=t.id AND c.${OPEN_SQL}) assigned,
      (SELECT COUNT(*) FROM cases c WHERE c.team_id=t.id AND c.${OPEN_SQL} AND c.deadline<@now) overdue,
      (SELECT COUNT(*) FROM cases c WHERE c.team_id=t.id AND c.status='Resolved') verified,
      (SELECT COUNT(*) FROM users u WHERE u.team_id=t.id) members
    FROM teams t ORDER BY t.kind, t.name`).all({ now });
  // Departments own cases through the "responsibility" field.
  const dept = db.prepare(`SELECT responsibility r,
      SUM(CASE WHEN ${OPEN_SQL} THEN 1 ELSE 0 END) assigned,
      SUM(CASE WHEN ${OPEN_SQL} AND deadline<@now THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN status='Resolved' THEN 1 ELSE 0 END) verified
    FROM cases GROUP BY responsibility`).all({ now });
  teams.forEach((t) => {
    if (t.kind === "Department") {
      const d = dept.find((x) => x.r === t.name) || {};
      Object.assign(t, { assigned: d.assigned || 0, overdue: d.overdue || 0, verified: d.verified || 0 });
    }
  });
  const queue = db.prepare(`SELECT id, code, road, area, cause, permit, responsibility, severity FROM cases
    WHERE ${OPEN_SQL} AND (responsibility='Pending verification' OR permit IN ('Pending verification','Not found in records'))
    ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, created_at LIMIT 12`).all();
  res.json({
    teams,
    departments: teams.filter((t) => t.kind === "Department").length,
    repairTeams: teams.filter((t) => t.kind === "Repair team").length,
    awaitingAssignment: db.prepare("SELECT COUNT(*) n FROM cases WHERE status='Confirmed' AND team_id IS NULL").get().n,
    queueTotal: db.prepare(`SELECT COUNT(*) n FROM cases WHERE ${OPEN_SQL} AND (responsibility='Pending verification' OR permit IN ('Pending verification','Not found in records'))`).get().n,
    queue,
  });
});

router.get("/notifications", (req, res) => {
  const now = new Date().toISOString();
  const items = [];
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  q(`SELECT code, road, created_at FROM cases WHERE source='Citizen report' AND status='Reported' ORDER BY created_at DESC LIMIT 5`)
    .forEach((c) => items.push({ level: "info", text: `New citizen report on ${c.road}`, code: c.code, at: c.created_at }));
  q(`SELECT code, road, created_at FROM cases WHERE severity='Critical' AND status='Reported' ORDER BY created_at DESC LIMIT 4`)
    .forEach((c) => items.push({ level: "critical", text: `Critical case needs review · ${c.road}`, code: c.code, at: c.created_at }));
  q(`SELECT code, road, updated_at FROM cases WHERE status='Awaiting Verification' ORDER BY updated_at DESC LIMIT 4`)
    .forEach((c) => items.push({ level: "warn", text: `Repair awaiting verification · ${c.road}`, code: c.code, at: c.updated_at }));
  if (req.user.team_id) {
    q(`SELECT code, road, deadline FROM cases WHERE team_id=? AND ${OPEN_SQL} AND deadline<? ORDER BY deadline LIMIT 4`, req.user.team_id, now)
      .forEach((c) => items.push({ level: "critical", text: `Your team's case is overdue · ${c.road}`, code: c.code, at: c.deadline }));
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  res.json(items.slice(0, 12));
});

module.exports = router;
