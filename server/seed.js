// Seeds reference data (roads, teams, users, vehicles) and, optionally,
// 1,500 clearly-flagged synthetic demo cases spread over the last 90 days.
const bcrypt = require("bcryptjs");
const { TYPES, SLA_DAYS, STATUSES } = require("./lib/constants");
const { loadRoadGeometry } = require("./lib/roads");
const { pointAlong, nearestOnLine } = require("./lib/geo");

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const iso = (d) => d.toISOString();
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const DEPARTMENTS = [
  ["Roads & Infrastructure", "Arterial roads", "Department"],
  ["Zone / Ward Maintenance", "Residential roads", "Department"],
  ["Water & Sewerage Coordination", "Utility excavation", "Department"],
  ["Electricity / Utility Coordination", "Cable connections", "Department"],
  ["Solid Waste Operations", "Collection vehicle records", "Department"],
  ["Quality & Verification", "Repair evidence", "Department"],
];
const REPAIR_TEAMS = ["Teynampet", "Velachery", "Adyar", "Anna Nagar", "T Nagar", "Ambattur", "Guindy", "Perambur", "Sholinganallur", "Mylapore"]
  .map((a) => [`${a} Road Maintenance`, `${a} and surrounding wards`, "Repair team"]);

const DEMO_USERS = [
  ["Alex Morgan", "admin@roadwatch.demo", "Administrator", "System Administration", "Chennai", null],
  ["Priya Raman", "officer@roadwatch.demo", "Municipal Officer", "Roads & Infrastructure", "Teynampet", null],
  ["Karthik S", "team@roadwatch.demo", "Repair Team", "Road Maintenance", "Velachery", "Velachery Road Maintenance"],
  ["Audit Viewer", "auditor@roadwatch.demo", "Read-Only Auditor", "Quality & Audit", "Chennai", null],
];

// Typical [length cm, width cm, depth mm] per damage type, before jitter.
const DIMS = [[46, 35, 65], [80, 12, 18], [32, 4, 8], [110, 65, 35], [70, 24, 20], [28, 28, 12], [140, 45, 25], [95, 55, 15], [180, 60, 45], [50, 30, 8], [75, 48, 20]];

function seedReference(db) {
  const roads = loadRoadGeometry();
  const insRoad = db.prepare("INSERT INTO roads (name, area, lat, lng, geometry, geometry_source, osm_name) VALUES (?,?,?,?,?,?,?)");
  roads.forEach((r) => insRoad.run(r.name, r.area, r.lat, r.lng, JSON.stringify(r.geometry), r.geometry_source, r.osm_name));

  const insTeam = db.prepare("INSERT INTO teams (name, responsibility, lead, kind) VALUES (?,?,?,?)");
  [...DEPARTMENTS, ...REPAIR_TEAMS].forEach(([n, resp, kind]) => insTeam.run(n, resp, kind === "Department" ? "Operations desk" : "Ward engineer", kind));

  const hash = bcrypt.hashSync("demo123", 10);
  const insUser = db.prepare("INSERT INTO users (name, email, password_hash, role, department, area, team_id, status, last_active) VALUES (?,?,?,?,?,?,?, 'Active', NULL)");
  DEMO_USERS.forEach(([n, e, role, dept, area, team]) => {
    const t = team ? db.prepare("SELECT id FROM teams WHERE name=?").get(team) : null;
    insUser.run(n, e, hash, role, dept, area, t ? t.id : null);
  });

  const rand = rng(42);
  const roadRows = db.prepare("SELECT id, name, area, geometry FROM roads ORDER BY id").all();
  const insVeh = db.prepare("INSERT INTO vehicles (code, type, operator, route, area, road_id, coverage, last_seen, lat, lng) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const now = new Date();
  for (let i = 0; i < 42; i++) {
    const bus = i < 24;
    const r = roadRows[i % roadRows.length];
    const p = pointAlong(JSON.parse(r.geometry), rand()).point;
    insVeh.run(
      bus ? `MTC-${410 + i}` : `GC-${220 + i - 24}`,
      bus ? "Government bus" : "Garbage collection",
      bus ? "MTC (sample)" : (i % 3 ? "Municipal collection (sample)" : "Private contractor (sample)"),
      bus ? `MTC Route ${21 + i * 3}` : `Ward ${30 + i} collection route`,
      r.area, r.id,
      bus ? 70 + Math.floor(rand() * 26) : 58 + Math.floor(rand() * 30),
      iso(new Date(now.getTime() - Math.floor(rand() * 5 * 86400000))),
      p[0], p[1],
    );
  }
}

function seedDemoCases(db, count = 1500) {
  const rand = rng(1234);
  const now = new Date();
  const roads = db.prepare("SELECT id, name, area, geometry FROM roads ORDER BY id").all().map((r) => ({ ...r, line: JSON.parse(r.geometry) }));
  const vehicles = db.prepare("SELECT code, type, route, road_id FROM vehicles").all();
  const repairTeams = db.prepare("SELECT id, name FROM teams WHERE kind='Repair team'").all();
  const insCase = db.prepare(`INSERT INTO cases (code, type, severity, status, road_id, road, area, lat, lng, snap_distance_m, along, source, vehicle, route,
    lane, lane_count, direction, length_cm, width_cm, depth_mm, confidence, ai_status, ai_summary, cause, responsibility, permit, description,
    team_id, deadline, observations, is_synthetic, observed_at, created_at, updated_at, resolved_at)
    VALUES (@code,@type,@severity,@status,@road_id,@road,@area,@lat,@lng,0,@along,@source,@vehicle,@route,@lane,3,@direction,@length_cm,@width_cm,@depth_mm,
    @confidence,'Simulated',NULL,@cause,@responsibility,@permit,@description,@team_id,@deadline,@observations,1,@observed_at,@created_at,@updated_at,@resolved_at)`);
  const insEv = db.prepare("INSERT INTO case_events (case_id, title, detail, user_name, created_at) VALUES (?,?,?,?,?)");
  const flow = ["Reported", "Under Review", "Confirmed", "Assigned", "In Repair", "Awaiting Verification", "Resolved"];

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const road = roads[i % roads.length];
      const along = 0.04 + rand() * 0.92;
      const pos = pointAlong(road.line, along).point;
      const ti = Math.floor(rand() * TYPES.length);
      const type = TYPES[ti];
      const roll = rand();
      const severity = roll < 0.07 ? "Critical" : roll < 0.29 ? "High" : roll < 0.7 ? "Medium" : "Low";
      // Spread observations over 90 days, a little denser recently.
      const ageDays = Math.pow(rand(), 1.15) * 90;
      const created = new Date(now.getTime() - ageDays * 86400000);
      created.setHours(6 + Math.floor(rand() * 14), Math.floor(rand() * 60), 0, 0);
      if (created > now) created.setTime(now.getTime() - (10 + rand() * 300) * 60000);
      const veh = vehicles[Math.floor(rand() * vehicles.length)];
      // Each case gets a repair duration around its SLA; how far it has
      // progressed depends on how much of that time has elapsed.
      const duration = SLA_DAYS[severity] * (0.5 + rand() * 1.8) + 2;
      const progress = ageDays / duration;
      let stage = progress >= 1 ? 6 : Math.min(5, Math.floor(progress * 6 + rand() * 0.8));
      let status = flow[stage];
      if (rand() < 0.04) status = "Rejected";
      else if (status === "In Repair" && rand() < 0.08) status = "Needs Rework";
      const deadline = addDays(created, SLA_DAYS[severity]);
      const dims = DIMS[ti].map((v) => Math.round(v * (0.7 + rand() * 0.6)));
      const isCut = type === "Utility road cut";
      const assigned = ["Assigned", "In Repair", "Awaiting Verification", "Resolved", "Needs Rework"].includes(status);
      const team = assigned ? repairTeams[Math.floor(rand() * repairTeams.length)] : null;
      const resolvedAt = status === "Resolved"
        ? new Date(Math.min(now.getTime() - 3600000, addDays(created, duration).getTime()))
        : null;
      const updated = resolvedAt || addDays(created, Math.min(ageDays, rand() * 3));
      const row = {
        code: `RW-${String(i + 1).padStart(4, "0")}`, type, severity, status,
        road_id: road.id, road: road.name, area: road.area, lat: pos[0], lng: pos[1], along,
        source: veh.type, vehicle: veh.code, route: veh.route,
        lane: 1 + Math.floor(rand() * 3), direction: ["Northbound", "Southbound", "Eastbound", "Westbound"][Math.floor(rand() * 4)],
        length_cm: dims[0], width_cm: dims[1], depth_mm: dims[2],
        confidence: 0.78 + rand() * 0.2,
        cause: isCut ? "Possible utility excavation" : "Road surface deterioration",
        responsibility: rand() < 0.14 ? "Pending verification" : isCut ? "Water & Sewerage Coordination" : "Roads & Infrastructure",
        permit: isCut ? (rand() < 0.5 ? "Pending verification" : "Not found in records") : "Not applicable",
        description: "Synthetic demonstration record; not a verified municipal observation.",
        team_id: team ? team.id : null,
        deadline: iso(deadline),
        observations: 1 + Math.floor(rand() * 5),
        observed_at: iso(created), created_at: iso(created), updated_at: iso(updated),
        resolved_at: resolvedAt ? iso(resolvedAt) : null,
      };
      const id = insCase.run(row).lastInsertRowid;
      insEv.run(id, "Observation recorded", `${veh.type} ${veh.code} · ${road.area}`, "System", iso(created));
      insEv.run(id, "Case created", "Synthetic demo record", "System", iso(created));
      const last = status === "Rejected" ? 1 : status === "Needs Rework" ? 5 : flow.indexOf(status);
      for (let s = 1; s <= last; s++) {
        const t = s === last && resolvedAt ? resolvedAt : addDays(created, (s / Math.max(1, last)) * Math.min(ageDays, 10) * 0.9);
        const title = flow[s] === "Assigned" && team ? `Assigned to ${team.name}` : `Status updated: ${flow[s]}`;
        insEv.run(id, title, "Demo workflow history", "System", iso(t));
      }
      if (status === "Rejected") insEv.run(id, "Status updated: Rejected", "Not road damage on review (demo)", "System", iso(updated));
      if (status === "Needs Rework") insEv.run(id, "Status updated: Needs Rework", "Patch failed verification (demo)", "System", iso(updated));
    }
  });
  tx();
}

// Re-applies road geometry from data/roads.osm.json (if present) without
// touching user data: demo cases are re-placed along their road at the same
// relative position; real cases are re-snapped to the nearest road.
function refreshRoadGeometry(db) {
  const fresh = loadRoadGeometry();
  const upd = db.prepare("UPDATE roads SET geometry=?, geometry_source=?, osm_name=? WHERE name=?");
  const roads = [];
  db.transaction(() => {
    fresh.forEach((r) => upd.run(JSON.stringify(r.geometry), r.geometry_source, r.osm_name, r.name));
    for (const r of db.prepare("SELECT id, geometry FROM roads").all()) roads.push({ id: r.id, line: JSON.parse(r.geometry) });
    const byId = new Map(roads.map((r) => [r.id, r]));
    const updCase = db.prepare("UPDATE cases SET lat=?, lng=?, snap_distance_m=? WHERE id=?");
    for (const c of db.prepare("SELECT id, road_id, along, is_synthetic, lat, lng FROM cases").all()) {
      const road = byId.get(c.road_id);
      if (!road) continue;
      if (c.is_synthetic && c.along != null) {
        const p = pointAlong(road.line, c.along).point;
        updCase.run(p[0], p[1], 0, c.id);
      } else {
        const n = nearestOnLine([c.lat, c.lng], road.line);
        updCase.run(c.lat, c.lng, Math.round(n.distance), c.id);
      }
    }
    const updVeh = db.prepare("UPDATE vehicles SET lat=?, lng=? WHERE id=?");
    for (const v of db.prepare("SELECT id, road_id FROM vehicles").all()) {
      const road = byId.get(v.road_id);
      if (road) { const p = pointAlong(road.line, 0.5).point; updVeh.run(p[0], p[1], v.id); }
    }
  })();
  return fresh.filter((r) => r.geometry_source === "osm").length;
}

function seedIfEmpty(db, { demo }) {
  const n = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  if (n > 0) return false;
  db.transaction(() => seedReference(db))();
  if (demo) seedDemoCases(db);
  return true;
}

module.exports = { seedIfEmpty, seedReference, seedDemoCases, refreshRoadGeometry, STATUSES };
