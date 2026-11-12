// Teams/departments and observation vehicles.
const express = require("express");
const db = require("../db");
const { requireCan } = require("../lib/auth");
const { OPEN_SQL } = require("./cases");
const { pointAlong } = require("../lib/geo");

const teams = express.Router();
const vehicles = express.Router();

teams.get("/", (req, res) => res.json(db.prepare("SELECT id, name, kind, responsibility, lead FROM teams ORDER BY kind DESC, name").all()));

function teamBody(b) {
  const name = String(b.name || "").trim();
  if (!name) return { error: "Team / department name is required." };
  if (!["Department", "Repair team"].includes(b.kind)) return { error: "Choose Department or Repair team." };
  return { name, kind: b.kind, responsibility: String(b.responsibility || "").trim(), lead: String(b.lead || "").trim() };
}

teams.post("/", requireCan("manageTeams"), (req, res) => {
  const t = teamBody(req.body);
  if (t.error) return res.status(400).json(t);
  if (db.prepare("SELECT 1 FROM teams WHERE name=?").get(t.name)) return res.status(409).json({ error: "A team with that name exists." });
  const id = db.prepare("INSERT INTO teams (name, kind, responsibility, lead) VALUES (@name,@kind,@responsibility,@lead)").run(t).lastInsertRowid;
  res.status(201).json(db.prepare("SELECT * FROM teams WHERE id=?").get(id));
});

teams.put("/:id", requireCan("manageTeams"), (req, res) => {
  const t = teamBody(req.body);
  if (t.error) return res.status(400).json(t);
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM teams WHERE id=?").get(id)) return res.status(404).json({ error: "Team not found." });
  if (db.prepare("SELECT 1 FROM teams WHERE name=? AND id!=?").get(t.name, id)) return res.status(409).json({ error: "A team with that name exists." });
  db.prepare("UPDATE teams SET name=@name, kind=@kind, responsibility=@responsibility, lead=@lead WHERE id=@id").run({ ...t, id });
  res.json(db.prepare("SELECT * FROM teams WHERE id=?").get(id));
});

teams.delete("/:id", requireCan("manageTeams"), (req, res) => {
  const id = Number(req.params.id);
  const open = db.prepare(`SELECT COUNT(*) n FROM cases WHERE team_id=? AND ${OPEN_SQL}`).get(id).n;
  if (open) return res.status(409).json({ error: `Reassign this team's ${open} open case(s) before deleting it.` });
  if (db.prepare("SELECT COUNT(*) n FROM users WHERE team_id=?").get(id).n) return res.status(409).json({ error: "Move this team's users to another team first." });
  db.prepare("DELETE FROM teams WHERE id=?").run(id);
  res.json({ ok: true });
});

// ---- vehicles ----
vehicles.get("/", (req, res) => {
  const rows = db.prepare(`SELECT v.*, r.name road_name,
      (SELECT COUNT(*) FROM cases c WHERE c.vehicle=v.code) cases,
      (SELECT COUNT(*) FROM cases c WHERE c.vehicle=v.code AND c.${OPEN_SQL}) open_cases,
      (SELECT MAX(observed_at) FROM cases c WHERE c.vehicle=v.code) last_detection
    FROM vehicles v LEFT JOIN roads r ON r.id=v.road_id ORDER BY v.type, v.code`).all();
  const stale = rows.filter((v) => !v.last_seen || Date.now() - new Date(v.last_seen).getTime() > 3 * 86400000).length;
  res.json({
    items: rows,
    summary: {
      total: rows.length,
      bus: rows.filter((v) => v.type === "Government bus").length,
      garbage: rows.filter((v) => v.type === "Garbage collection").length,
      coverage: rows.length ? Math.round(rows.reduce((s, v) => s + (v.coverage || 0), 0) / rows.length) : 0,
      stale,
    },
  });
});

vehicles.get("/roads", (req, res) => res.json(db.prepare("SELECT id, name, area FROM roads ORDER BY name").all()));

function vehicleBody(b) {
  const code = String(b.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) return { error: "Vehicle ID must be 2–20 letters, numbers or dashes." };
  if (!["Government bus", "Garbage collection"].includes(b.type)) return { error: "Choose a vehicle type." };
  const road = b.road_id ? db.prepare("SELECT id, area, geometry FROM roads WHERE id=?").get(Number(b.road_id)) : null;
  if (!road) return { error: "Choose the main road on this vehicle's route." };
  const cov = Number(b.coverage);
  const p = pointAlong(JSON.parse(road.geometry), 0.5).point;
  return {
    code, type: b.type, operator: String(b.operator || "").trim(), route: String(b.route || "").trim(), area: road.area,
    road_id: road.id, coverage: Number.isFinite(cov) ? Math.max(0, Math.min(100, Math.round(cov))) : 0,
    status: b.status === "Inactive" ? "Inactive" : "Active", lat: p[0], lng: p[1],
  };
}

vehicles.post("/", requireCan("manageVehicles"), (req, res) => {
  const v = vehicleBody(req.body);
  if (v.error) return res.status(400).json(v);
  if (db.prepare("SELECT 1 FROM vehicles WHERE code=?").get(v.code)) return res.status(409).json({ error: "That vehicle ID already exists." });
  const id = db.prepare(`INSERT INTO vehicles (code, type, operator, route, area, road_id, coverage, status, lat, lng, last_seen)
    VALUES (@code,@type,@operator,@route,@area,@road_id,@coverage,@status,@lat,@lng,@last_seen)`).run({ ...v, last_seen: new Date().toISOString() }).lastInsertRowid;
  res.status(201).json(db.prepare("SELECT * FROM vehicles WHERE id=?").get(id));
});

vehicles.put("/:id", requireCan("manageVehicles"), (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare("SELECT * FROM vehicles WHERE id=?").get(id);
  if (!old) return res.status(404).json({ error: "Vehicle not found." });
  const v = vehicleBody({ ...old, ...req.body });
  if (v.error) return res.status(400).json(v);
  if (db.prepare("SELECT 1 FROM vehicles WHERE code=? AND id!=?").get(v.code, id)) return res.status(409).json({ error: "That vehicle ID already exists." });
  db.prepare("UPDATE vehicles SET code=@code, type=@type, operator=@operator, route=@route, area=@area, road_id=@road_id, coverage=@coverage, status=@status, lat=@lat, lng=@lng WHERE id=@id").run({ ...v, id });
  if (old.code !== v.code) db.prepare("UPDATE cases SET vehicle=? WHERE vehicle=?").run(v.code, old.code);
  res.json(db.prepare("SELECT * FROM vehicles WHERE id=?").get(id));
});

module.exports = { teams, vehicles };
