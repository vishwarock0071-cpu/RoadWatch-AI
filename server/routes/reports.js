// CSV export of (filtered) cases and a PDF summary report.
const express = require("express");
const PDFDocument = require("pdfkit");
const db = require("../db");
const { requireCan } = require("../lib/auth");
const { buildFilter, BASE, OPEN_SQL } = require("./cases");
const { deadlineState } = require("../lib/cases");
const { TYPES } = require("../lib/constants");

const router = express.Router();
router.use(requireCan("exportReports"));

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // avoid spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get("/cases.csv", (req, res) => {
  const { sql, params } = buildFilter(req.query);
  const rows = db.prepare(`${BASE} ${sql} ORDER BY c.created_at DESC`).all(params);
  const cols = [
    ["Case", "code"], ["Created", "created_at"], ["Type", "type"], ["Severity", "severity"], ["Status", "status"],
    ["Road", "road"], ["Area", "area"], ["Latitude", "lat"], ["Longitude", "lng"], ["Source", "source"], ["Vehicle", "vehicle"],
    ["Route", "route"], ["Team", "team_name"], ["Deadline", "deadline"], ["Deadline state", (c) => deadlineState(c)],
    ["Resolved at", "resolved_at"], ["Length (cm)", "length_cm"], ["Width (cm)", "width_cm"], ["Depth (mm)", "depth_mm"],
    ["AI status", "ai_status"], ["AI confidence", (c) => (c.confidence != null ? c.confidence.toFixed(2) : "")],
    ["Cause", "cause"], ["Responsibility", "responsibility"], ["Permit", "permit"], ["Synthetic demo record", (c) => (c.is_synthetic ? "yes" : "no")],
    ["Description", "description"],
  ];
  const lines = [cols.map((c) => c[0]).join(",")];
  for (const r of rows) lines.push(cols.map(([, k]) => csvCell(typeof k === "function" ? k(r) : r[k])).join(","));
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="roadwatch-cases-${stamp}.csv"`);
  res.send("﻿" + lines.join("\r\n"));
});

router.get("/summary.pdf", (req, res) => {
  const now = new Date();
  const nowIso = now.toISOString();
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  const m = {
    valid: one("SELECT COUNT(*) n FROM cases WHERE status!='Rejected'"),
    open: one(`SELECT COUNT(*) n FROM cases WHERE ${OPEN_SQL}`),
    critical: one(`SELECT COUNT(*) n FROM cases WHERE severity='Critical' AND ${OPEN_SQL}`),
    overdue: one(`SELECT COUNT(*) n FROM cases WHERE ${OPEN_SQL} AND deadline<?`, nowIso),
    resolved: one("SELECT COUNT(*) n FROM cases WHERE status='Resolved'"),
    awaiting: one("SELECT COUNT(*) n FROM cases WHERE status='Awaiting Verification'"),
    citizen: one("SELECT COUNT(*) n FROM cases WHERE source='Citizen report'"),
    synthetic: one("SELECT COUNT(*) n FROM cases WHERE is_synthetic=1"),
  };
  const sla = db.prepare("SELECT SUM(CASE WHEN resolved_at<=deadline THEN 1 ELSE 0 END) met, COUNT(*) n FROM cases WHERE status='Resolved'").get();
  const wards = db.prepare(`SELECT area, SUM(CASE WHEN status!='Rejected' THEN 1 ELSE 0 END) valid,
      SUM(CASE WHEN severity='Critical' AND ${OPEN_SQL} THEN 1 ELSE 0 END) critical,
      SUM(CASE WHEN ${OPEN_SQL} AND deadline<? THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN status='Resolved' THEN 1 ELSE 0 END) resolved
    FROM cases GROUP BY area ORDER BY valid DESC`).all(nowIso);
  const types = db.prepare("SELECT type, COUNT(*) n FROM cases WHERE status!='Rejected' GROUP BY type").all();
  const urgent = db.prepare(`SELECT code, type, road, area, severity, status, deadline FROM cases WHERE ${OPEN_SQL} AND severity IN ('Critical','High') AND deadline<?
    ORDER BY CASE severity WHEN 'Critical' THEN 0 ELSE 1 END, deadline LIMIT 15`).all(nowIso);

  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: "RoadWatch AI summary report" } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="roadwatch-summary-${nowIso.slice(0, 10)}.pdf"`);
  doc.pipe(res);
  const ink = "#182438", muted = "#718096", blue = "#3768e5";
  const W = doc.page.width - 96;

  doc.fillColor(blue).font("Helvetica-Bold").fontSize(10).text("ROADWATCH AI · CHENNAI OPERATIONS");
  doc.moveDown(0.3).fillColor(ink).fontSize(22).text("Road condition summary report");
  doc.font("Helvetica").fontSize(10).fillColor(muted).text(`Generated ${now.toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })} by ${req.user.name} (${req.user.role})`);
  if (m.synthetic) doc.moveDown(0.4).fillColor("#bf6a1b").text(`Note: ${m.synthetic} of these records are synthetic demo data, not verified municipal observations.`);
  doc.moveDown(1);

  const tiles = [["Valid cases", m.valid], ["Open cases", m.open], ["Critical (open)", m.critical], ["Overdue", m.overdue],
    ["Verified resolved", m.resolved], ["Awaiting verification", m.awaiting], ["Citizen reports", m.citizen], ["Deadline met", sla.n ? `${Math.round((sla.met / sla.n) * 100)}%` : "—"]];
  const tw = W / 4, th = 52; let y = doc.y;
  tiles.forEach(([label, val], i) => {
    const x = 48 + (i % 4) * tw, yy = y + Math.floor(i / 4) * (th + 8);
    doc.roundedRect(x, yy, tw - 8, th, 6).fillAndStroke("#f5f7fb", "#e5eaf1");
    doc.fillColor(muted).font("Helvetica").fontSize(8).text(label, x + 10, yy + 9, { width: tw - 26 });
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(17).text(String(val), x + 10, yy + 23, { width: tw - 26 });
  });
  doc.y = y + 2 * (th + 8) + 12; doc.x = 48;

  function table(title, headers, rows, widths) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(13).text(title, 48, doc.y);
    doc.moveDown(0.4);
    const draw = (cells, bold, bg) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const top = doc.y;
      if (bg) doc.rect(48, top - 3, W, 17).fill(bg);
      let x = 48;
      cells.forEach((c, i) => {
        doc.fillColor(bold ? muted : ink).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
          .text(String(c ?? "—"), x + 4, top, { width: widths[i] * W - 8, height: 11, ellipsis: true });
        x += widths[i] * W;
      });
      doc.y = top + 17;
    };
    draw(headers, true, "#f0f3f8");
    rows.forEach((r) => draw(r, false));
    doc.moveDown(1);
  }

  table("Ward / area overview", ["Area", "Valid cases", "Critical (open)", "Overdue", "Resolved"],
    wards.map((w) => [w.area, w.valid, w.critical, w.overdue, w.resolved]), [0.36, 0.16, 0.16, 0.16, 0.16]);
  table("Cases by damage type", ["Damage type", "Valid cases"],
    TYPES.map((t) => [t, types.find((x) => x.type === t)?.n || 0]), [0.7, 0.3]);
  table("Overdue Critical / High cases", ["Case", "Type", "Road", "Severity", "Status", "Due"],
    urgent.map((c) => [c.code, c.type, `${c.road}, ${c.area}`, c.severity, c.status, new Date(c.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })]),
    [0.1, 0.21, 0.3, 0.1, 0.19, 0.1]);
  doc.fontSize(8).fillColor(muted).font("Helvetica").text("Severity suggestions from the AI detector are triage aids and must be confirmed by an officer. Road geometry © OpenStreetMap contributors where fetched.", 48, doc.y, { width: W });
  doc.end();
});

module.exports = router;
