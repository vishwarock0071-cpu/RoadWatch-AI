// Public (no sign-in) endpoints for the citizen report and tracking page.
const express = require("express");
const db = require("../db");
const C = require("../lib/cases");
const { TYPES } = require("../lib/constants");
const { photo, attach, removeFile } = require("../lib/uploads");

const router = express.Router();

// 8 reports per IP per hour.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  hits.set(ip, list);
  if (list.length >= 8) return true;
  list.push(now);
  return false;
}

router.get("/info", (req, res) => {
  res.json({ types: TYPES, roads: db.prepare("SELECT name, area, lat, lng FROM roads ORDER BY name").all() });
});

router.post("/reports", photo(), async (req, res) => {
  const b = req.body;
  if (!req.file) return res.status(400).json({ error: "Please attach a photo of the road damage." });
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 12.7 || lat > 13.4 || lng < 79.9 || lng > 80.5) {
    removeFile(req.file); return res.status(400).json({ error: "Please mark a location inside Chennai on the map." });
  }
  if (b.consent !== "yes") { removeFile(req.file); return res.status(400).json({ error: "Please confirm the report is accurate." }); }
  if (rateLimited(req.ip)) { removeFile(req.file); return res.status(429).json({ error: "Too many reports from this connection. Please try again later." }); }

  const type = TYPES.includes(b.type) ? b.type : "Pothole";
  const s = C.snap(lat, lng);
  const now = new Date().toISOString();
  const id = db.prepare(`INSERT INTO cases (code, type, severity, status, road_id, road, area, lat, lng, snap_distance_m, source,
      cause, responsibility, permit, description, deadline, reporter_name, reporter_contact, observed_at, created_at, updated_at)
      VALUES (?,?,?,'Reported',?,?,?,?,?,?,'Citizen report','Pending review','Pending verification',?,?,?,?,?,?,?,?)`).run(
    C.nextCode(), type, "Medium", s.road_id, s.road, s.area, lat, lng, s.distance,
    type === "Utility road cut" ? "Pending verification" : "Not applicable",
    String(b.description || "").slice(0, 1000), C.deadlineFor("Medium"),
    String(b.name || "").trim().slice(0, 100) || null, String(b.contact || "").trim().slice(0, 100) || null, now, now, now).lastInsertRowid;
  C.addEvent(id, "Citizen report received", s.road_id ? `Matched to ${s.road}` : "Location not on a mapped road", null);

  const { ai } = await attach(id, req.file, "citizen", null, true);
  let severity = "Medium";
  if (ai.ai_status === "Detected") {
    severity = ai.severity;
    db.prepare("UPDATE cases SET ai_status=?, ai_summary=?, confidence=?, severity=?, deadline=? WHERE id=?")
      .run(ai.ai_status, ai.summary, ai.confidence, severity, C.deadlineFor(severity), id);
  } else {
    db.prepare("UPDATE cases SET ai_status=?, ai_summary=? WHERE id=?").run(ai.ai_status, ai.summary, id);
  }
  C.addEvent(id, ai.ai_status === "Detected" ? "AI detection completed" : ai.ai_status, ai.summary, null);
  const c = db.prepare("SELECT code, status, road, area, ai_status, ai_summary FROM cases WHERE id=?").get(id);
  res.status(201).json({ ...c, severity, detections: ai.raw?.detections || [], image: ai.raw?.image || null });
});

const PUBLIC_EVENTS = /^(Citizen report received|Case created|Status updated|Assigned to|Repair update|AI detection completed|AI found no damage)/;

router.get("/track/:code", (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const c = db.prepare("SELECT id, code, type, severity, status, road, area, created_at, updated_at, resolved_at FROM cases WHERE code=?").get(code);
  if (!c) return res.status(404).json({ error: "No report found with that reference." });
  const events = db.prepare("SELECT title, created_at FROM case_events WHERE case_id=? ORDER BY created_at DESC, id DESC").all(c.id)
    .filter((e) => PUBLIC_EVENTS.test(e.title))
    .map((e) => ({ title: e.title.replace(/^Assigned to .*/, "Assigned to a repair team"), created_at: e.created_at }));
  const { id, ...pub } = c;
  res.json({ ...pub, events });
});

module.exports = router;
