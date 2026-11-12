// Staff case API: list / detail / create / update / workflow / evidence.
const express = require("express");
const db = require("../db");
const { requireCan, can } = require("../lib/auth");
const { TYPES, SEVERITIES, STATUSES, SOURCES, PERMIT_STATUSES, STATUS_RULES, CLOSED_STATUSES } = require("../lib/constants");
const C = require("../lib/cases");
const { photo, attach, removeFile } = require("../lib/uploads");

const router = express.Router();
const SEV_ORDER = "CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END";
const OPEN_SQL = `status NOT IN (${CLOSED_STATUSES.map((s) => `'${s}'`).join(",")})`;

function listRow(c) {
  return {
    id: c.id, code: c.code, type: c.type, severity: c.severity, status: c.status,
    road: c.road, area: c.area, source: c.source, vehicle: c.vehicle, cause: c.cause,
    team: c.team_name || null, deadline: c.deadline, deadline_state: C.deadlineState(c),
    created_at: c.created_at, is_synthetic: !!c.is_synthetic, ai_status: c.ai_status, photos: c.photos || 0,
  };
}

function buildFilter(q) {
  const where = [], params = {};
  if (q.q) {
    where.push(`(c.code LIKE @q OR c.road LIKE @q OR c.area LIKE @q OR c.vehicle LIKE @q OR c.route LIKE @q OR c.type LIKE @q OR c.description LIKE @q OR c.reporter_name LIKE @q)`);
    params.q = `%${String(q.q).trim()}%`;
  }
  if (SEVERITIES.includes(q.severity)) { where.push("c.severity=@severity"); params.severity = q.severity; }
  if (TYPES.includes(q.type)) { where.push("c.type=@type"); params.type = q.type; }
  if (STATUSES.includes(q.status)) { where.push("c.status=@status"); params.status = q.status; }
  if (SOURCES.includes(q.source)) { where.push("c.source=@source"); params.source = q.source; }
  if (q.team_id) { where.push("c.team_id=@team_id"); params.team_id = Number(q.team_id); }
  if (q.road_id) { where.push("c.road_id=@road_id"); params.road_id = Number(q.road_id); }
  if (q.area) { where.push("c.area=@area"); params.area = q.area; }
  if (q.open === "1") where.push(`c.${OPEN_SQL}`);
  if (q.overdue === "1") { where.push(`c.${OPEN_SQL} AND c.deadline < @now`); params.now = new Date().toISOString(); }
  if (q.synthetic === "0") where.push("c.is_synthetic=0");
  if (q.synthetic === "1") where.push("c.is_synthetic=1");
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const BASE = `SELECT c.*, t.name AS team_name, (SELECT COUNT(*) FROM attachments a WHERE a.case_id=c.id) AS photos
  FROM cases c LEFT JOIN teams t ON t.id=c.team_id`;

router.get("/", (req, res) => {
  const { sql, params } = buildFilter(req.query);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const sort = {
    newest: "c.created_at DESC",
    oldest: "c.created_at ASC",
    severity: `${SEV_ORDER.replace(/severity/, "c.severity")}, c.created_at DESC`,
    deadline: "c.deadline ASC",
  }[req.query.sort] || "c.created_at DESC";
  const total = db.prepare(`SELECT COUNT(*) n FROM cases c ${sql}`).get(params).n;
  const rows = db.prepare(`${BASE} ${sql} ORDER BY ${sort} LIMIT ${limit} OFFSET ${(page - 1) * limit}`).all(params);
  res.json({ total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), items: rows.map(listRow) });
});

// Priority queue for the dashboard: open cases, worst + most overdue first.
router.get("/priority", (req, res) => {
  const rows = db.prepare(`${BASE} WHERE c.${OPEN_SQL} ORDER BY ${SEV_ORDER.replace(/severity/, "c.severity")}, c.deadline ASC LIMIT ?`)
    .all(Math.min(20, Number(req.query.limit) || 6));
  res.json(rows.map(listRow));
});

function loadCase(idOrCode) {
  const isNum = /^\d+$/.test(String(idOrCode));
  return db.prepare(`${BASE} WHERE ${isNum ? "c.id" : "c.code"}=?`).get(isNum ? Number(idOrCode) : idOrCode);
}

function detail(c) {
  const events = db.prepare("SELECT title, detail, user_name, created_at FROM case_events WHERE case_id=? ORDER BY created_at DESC, id DESC").all(c.id);
  const attachments = db.prepare("SELECT id, kind, original_name, mime, size, width, height, detections, created_at FROM attachments WHERE case_id=? ORDER BY created_at DESC").all(c.id)
    .map((a) => ({ ...a, url: `/api/attachments/${a.id}`, detections: a.detections ? JSON.parse(a.detections) : null }));
  const { team_name, photos, ...rest } = c;
  return {
    ...rest, is_synthetic: !!c.is_synthetic, team: team_name || null, deadline_state: C.deadlineState(c),
    area_m2: c.length_cm && c.width_cm ? +(c.length_cm * c.width_cm / 10000).toFixed(2) : null,
    events, attachments,
  };
}

router.get("/:id", (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found." });
  res.json(detail(c));
});

const num = (v) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Create a case (staff). Accepts multipart with an optional "photo".
// severity "auto" means "use the AI suggestion" (falls back to Medium).
router.post("/", requireCan("createCase"), photo(), async (req, res) => {
  const b = req.body;
  const lat = num(b.lat), lng = num(b.lng);
  const errors = [];
  if (!TYPES.includes(b.type)) errors.push("Choose a valid damage type.");
  if (!(SEVERITIES.includes(b.severity) || b.severity === "auto")) errors.push("Choose a severity.");
  if (lat === null || lng === null || lat < 12.7 || lat > 13.4 || lng < 79.9 || lng > 80.5) errors.push("Pick a location inside Chennai on the map.");
  if (!SOURCES.includes(b.source)) errors.push("Choose an observation source.");
  if (errors.length) { removeFile(req.file); return res.status(400).json({ error: errors.join(" ") }); }

  const s = C.snap(lat, lng);
  const now = new Date().toISOString();
  const severity = b.severity === "auto" ? "Medium" : b.severity;
  const info = db.prepare(`INSERT INTO cases (code, type, severity, status, road_id, road, area, lat, lng, snap_distance_m, source, vehicle, route,
    lane, lane_count, direction, length_cm, width_cm, depth_mm, cause, responsibility, permit, description, deadline, observed_at, created_at, updated_at)
    VALUES (?,?,?,'Reported',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    C.nextCode(), b.type, severity, s.road_id, b.road?.trim() || s.road, b.area?.trim() || s.area, lat, lng, s.distance,
    b.source, b.vehicle?.trim() || null, b.route?.trim() || null,
    num(b.lane), num(b.lane_count), b.direction || null, num(b.length_cm), num(b.width_cm), num(b.depth_mm),
    b.type === "Utility road cut" ? "Possible utility excavation" : "Pending review", "Pending verification",
    b.type === "Utility road cut" ? "Pending verification" : "Not applicable",
    (b.description || "").slice(0, 2000), C.deadlineFor(severity), now, now, now);
  const id = info.lastInsertRowid;
  C.addEvent(id, "Case created", `${b.source}${s.road_id ? "" : " · location not on a mapped road"}`, req.user);

  if (req.file) await applyPhoto(id, req.file, "evidence", req.user, b.severity === "auto");
  res.status(201).json(detail(loadCase(id)));
});

// Attaches a photo, runs AI, and records results on the case.
async function applyPhoto(id, file, kind, user, adoptSeverity) {
  const { ai } = await attach(id, file, kind, user, kind !== "repair");
  if (!ai) { C.addEvent(id, "Photo added", kind, user); return; }
  if (ai.ai_status === "Detected") {
    const sets = ["ai_status=?", "ai_summary=?", "confidence=?", "updated_at=?"];
    const vals = [ai.ai_status, ai.summary, ai.confidence, new Date().toISOString()];
    if (adoptSeverity && ai.severity) {
      sets.push("severity=?", "deadline=?");
      const created = db.prepare("SELECT created_at FROM cases WHERE id=?").get(id).created_at;
      vals.push(ai.severity, C.deadlineFor(ai.severity, new Date(created)));
    }
    db.prepare(`UPDATE cases SET ${sets.join(",")} WHERE id=?`).run(...vals, id);
    C.addEvent(id, "AI detection completed", ai.summary, null);
  } else {
    db.prepare("UPDATE cases SET ai_status=?, ai_summary=?, updated_at=? WHERE id=?").run(ai.ai_status, ai.summary, new Date().toISOString(), id);
    C.addEvent(id, ai.ai_status === "No damage detected" ? "AI found no damage" : "AI detection unavailable", ai.summary, null);
  }
}

// Edit classification / measurements / location (officer, admin).
router.patch("/:id", requireCan("editCase"), (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found." });
  const b = req.body, changes = {};
  if (b.type !== undefined) { if (!TYPES.includes(b.type)) return res.status(400).json({ error: "Invalid damage type." }); changes.type = b.type; }
  if (b.severity !== undefined) {
    if (!SEVERITIES.includes(b.severity)) return res.status(400).json({ error: "Invalid severity." });
    changes.severity = b.severity;
    if (C.isOpen(c.status)) changes.deadline = C.deadlineFor(b.severity, new Date(c.created_at));
  }
  for (const k of ["length_cm", "width_cm", "depth_mm", "lane", "lane_count"]) if (b[k] !== undefined) changes[k] = num(b[k]);
  for (const k of ["direction", "cause", "description", "vehicle", "route"]) if (b[k] !== undefined) changes[k] = String(b[k]).slice(0, 2000);
  if (b.deadline) { const d = new Date(b.deadline); if (isNaN(d)) return res.status(400).json({ error: "Invalid deadline." }); changes.deadline = d.toISOString(); }
  if (b.lat !== undefined && b.lng !== undefined) {
    const lat = num(b.lat), lng = num(b.lng);
    if (lat === null || lng === null) return res.status(400).json({ error: "Invalid location." });
    const s = C.snap(lat, lng);
    Object.assign(changes, { lat, lng, road_id: s.road_id, road: s.road, area: s.area, snap_distance_m: s.distance, along: null });
  }
  if (!Object.keys(changes).length) return res.status(400).json({ error: "Nothing to update." });
  changes.updated_at = new Date().toISOString();
  db.prepare(`UPDATE cases SET ${Object.keys(changes).map((k) => `${k}=@${k}`).join(",")} WHERE id=@id`).run({ ...changes, id: c.id });
  const fields = Object.keys(changes).filter((k) => !["updated_at", "deadline", "road_id", "snap_distance_m", "along"].includes(k));
  C.addEvent(c.id, "Case details edited", fields.join(", "), req.user);
  res.json(detail(loadCase(c.id)));
});

// Workflow transition with role rules.
router.post("/:id/status", (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found." });
  const { status, note, team_id } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status." });
  if (!(STATUS_RULES[req.user.role] || []).includes(status)) return res.status(403).json({ error: `Your role cannot set a case to "${status}".` });
  if (req.user.role === "Repair Team" && c.team_id !== req.user.team_id) return res.status(403).json({ error: "This case is not assigned to your team." });
  if (status === c.status) return res.status(400).json({ error: `Case is already "${status}".` });
  if (status === "Resolved" && c.status !== "Awaiting Verification") {
    return res.status(409).json({ error: "A case can only be marked Resolved after repair evidence is submitted (status Awaiting Verification)." });
  }
  const changes = { status, updated_at: new Date().toISOString() };
  let title = `Status updated: ${status}`;
  if (status === "Assigned") {
    const t = team_id ? db.prepare("SELECT id, name FROM teams WHERE id=?").get(Number(team_id)) : (c.team_id ? { id: c.team_id, name: c.team_name } : null);
    if (!t) return res.status(400).json({ error: "Choose a team to assign this case to." });
    changes.team_id = t.id; title = `Assigned to ${t.name}`;
  }
  if (status === "Resolved") changes.resolved_at = changes.updated_at;
  else changes.resolved_at = null;
  db.prepare(`UPDATE cases SET ${Object.keys(changes).map((k) => `${k}=@${k}`).join(",")} WHERE id=@id`).run({ ...changes, id: c.id });
  C.addEvent(c.id, title, note || "", req.user);
  res.json(detail(loadCase(c.id)));
});

// Permit / responsibility review.
router.post("/:id/review", requireCan("editCase"), (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found." });
  const { permit, responsibility, cause, note } = req.body;
  if (permit && !PERMIT_STATUSES.includes(permit)) return res.status(400).json({ error: "Invalid permit status." });
  db.prepare("UPDATE cases SET permit=COALESCE(?, permit), responsibility=COALESCE(?, responsibility), cause=COALESCE(?, cause), updated_at=? WHERE id=?")
    .run(permit || null, responsibility?.trim() || null, cause?.trim() || null, new Date().toISOString(), c.id);
  C.addEvent(c.id, "Responsibility / permit review updated", [permit, responsibility, note].filter(Boolean).join(" · "), req.user);
  res.json(detail(loadCase(c.id)));
});

// Repair update with an optional after-repair photo (repair team, officer, admin).
router.post("/:id/repair", requireCan("repairUpdate"), photo(), async (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) { removeFile(req.file); return res.status(404).json({ error: "Case not found." }); }
  if (req.user.role === "Repair Team" && c.team_id !== req.user.team_id) { removeFile(req.file); return res.status(403).json({ error: "This case is not assigned to your team." }); }
  if (!C.isOpen(c.status)) { removeFile(req.file); return res.status(409).json({ error: `Case is ${c.status}; reopen it before adding repair updates.` }); }
  const status = req.body.status;
  if (!["In Repair", "Awaiting Verification"].includes(status)) { removeFile(req.file); return res.status(400).json({ error: "Repair status must be In Repair or Awaiting Verification." }); }
  if (status === "Awaiting Verification" && !req.file && !db.prepare("SELECT 1 FROM attachments WHERE case_id=? AND kind='repair'").get(c.id)) {
    return res.status(400).json({ error: "Attach an after-repair photo before sending for verification." });
  }
  if (!req.body.note?.trim()) { removeFile(req.file); return res.status(400).json({ error: "Add repair notes." }); }
  if (req.file) await attach(c.id, req.file, "repair", req.user, false);
  db.prepare("UPDATE cases SET status=?, updated_at=?, resolved_at=NULL WHERE id=?").run(status, new Date().toISOString(), c.id);
  C.addEvent(c.id, `Repair update: ${status}`, req.body.note.trim() + (req.file ? " · photo attached" : ""), req.user);
  res.json(detail(loadCase(c.id)));
});

// Add another evidence photo (runs AI). Officers/admins.
router.post("/:id/photos", requireCan("editCase"), photo(), async (req, res) => {
  const c = loadCase(req.params.id);
  if (!c) { removeFile(req.file); return res.status(404).json({ error: "Case not found." }); }
  if (!req.file) return res.status(400).json({ error: "Choose a photo to upload." });
  await applyPhoto(c.id, req.file, "evidence", req.user, req.body.adopt_severity === "1");
  db.prepare("UPDATE cases SET observations=observations+1 WHERE id=?").run(c.id);
  res.json(detail(loadCase(c.id)));
});

// Re-run AI on an existing photo (e.g. after starting the detector).
router.post("/:id/photos/:aid/detect", requireCan("editCase"), async (req, res) => {
  const c = loadCase(req.params.id);
  const a = c && db.prepare("SELECT * FROM attachments WHERE id=? AND case_id=?").get(Number(req.params.aid), c.id);
  if (!a) return res.status(404).json({ error: "Photo not found." });
  const path = require("path"), config = require("../config");
  const detector = require("../lib/detector");
  const result = await detector.detect(path.join(config.uploadDir, a.filename), a.mime, a.original_name);
  if (!result.ok) return res.status(503).json({ error: result.reason });
  const ai = detector.assess(result);
  db.prepare("UPDATE attachments SET detections=?, width=?, height=? WHERE id=?")
    .run(JSON.stringify({ model: result.model, detections: result.detections, inference_ms: result.inference_ms }), result.image?.width || null, result.image?.height || null, a.id);
  db.prepare("UPDATE cases SET ai_status=?, ai_summary=?, confidence=?, updated_at=? WHERE id=?")
    .run(ai.ai_status, ai.summary, ai.confidence, new Date().toISOString(), c.id);
  C.addEvent(c.id, "AI detection re-run", ai.summary, req.user);
  res.json(detail(loadCase(c.id)));
});

router.post("/:id/comment", (req, res) => {
  if (req.user.role === "Read-Only Auditor") return res.status(403).json({ error: "Read-only role cannot comment." });
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found." });
  const note = String(req.body.note || "").trim();
  if (!note) return res.status(400).json({ error: "Write a comment first." });
  C.addEvent(c.id, "Comment", note.slice(0, 2000), req.user);
  res.json(detail(loadCase(c.id)));
});

router.delete("/:id", (req, res) => {
  if (!can(req.user, "manageUsers")) return res.status(403).json({ error: "Only administrators can delete cases. Use Rejected instead." });
  const c = loadCase(req.params.id);
  if (!c) return res.status(404).json({ error: "Case not found." });
  const files = db.prepare("SELECT filename FROM attachments WHERE case_id=?").all(c.id);
  db.prepare("DELETE FROM cases WHERE id=?").run(c.id);
  const fs = require("fs"), path = require("path"), config = require("../config");
  files.forEach((f) => fs.rm(path.join(config.uploadDir, f.filename), { force: true }, () => {}));
  res.json({ ok: true });
});

module.exports = { router, buildFilter, BASE, listRow, OPEN_SQL };
