// RoadWatch AI — Express server entry point.
const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const config = require("./config");
const db = require("./db");
const { seedIfEmpty, refreshRoadGeometry } = require("./seed");
const auth = require("./lib/auth");
const detector = require("./lib/detector");
const { invalidateRoads } = require("./lib/cases");
const { authRouter, usersRouter } = require("./routes/users");
const { router: casesRouter } = require("./routes/cases");
const statsRouter = require("./routes/stats");
const { teams, vehicles } = require("./routes/resources");
const reportsRouter = require("./routes/reports");
const publicRouter = require("./routes/public");
const C = require("./lib/constants");

if (seedIfEmpty(db, { demo: config.seedDemo })) {
  console.log(`Database created at ${config.dbFile}${config.seedDemo ? " with demo data" : " (no demo cases)"}.`);
}

const app = express();
app.set("trust proxy", "loopback");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ---- API ----
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/public", publicRouter);
app.use("/api/auth", authRouter);

const api = express.Router();
api.use(auth.requireAuth);
api.get("/meta", (req, res) => res.json({
  roles: C.ROLES, types: C.TYPES, severities: C.SEVERITIES, statuses: C.STATUSES, sources: C.SOURCES,
  permits: C.PERMIT_STATUSES, sla: C.SLA_DAYS, statusRules: C.STATUS_RULES, can: C.ROLE_CAN,
}));
api.use("/cases", casesRouter);
api.use("/stats", statsRouter);
api.use("/teams", teams);
api.use("/vehicles", vehicles);
api.use("/users", usersRouter);
api.use("/reports", reportsRouter);

api.get("/attachments/:id", (req, res) => {
  const a = db.prepare("SELECT filename, mime FROM attachments WHERE id=?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "File not found." });
  const file = path.join(config.uploadDir, path.basename(a.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: "File missing on disk." });
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.type(a.mime || "application/octet-stream").sendFile(file);
});

api.get("/system", async (req, res) => {
  const roads = db.prepare("SELECT geometry_source s, COUNT(*) n FROM roads GROUP BY s").all();
  res.json({
    detector: await detector.health(),
    roads: { osm: roads.find((r) => r.s === "osm")?.n || 0, illustrative: roads.find((r) => r.s === "illustrative")?.n || 0 },
    synthetic: db.prepare("SELECT COUNT(*) n FROM cases WHERE is_synthetic=1").get().n,
    real: db.prepare("SELECT COUNT(*) n FROM cases WHERE is_synthetic=0").get().n,
  });
});

api.post("/system/reload-roads", auth.requireCan("manageUsers"), (req, res) => {
  const matched = refreshRoadGeometry(db);
  invalidateRoads();
  res.json({ ok: true, osmRoads: matched });
});

api.post("/system/remove-demo-cases", auth.requireCan("manageUsers"), (req, res) => {
  const n = db.prepare("DELETE FROM cases WHERE is_synthetic=1").run().changes;
  res.json({ ok: true, removed: n });
});

app.use("/api", api);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// ---- static frontend ----
app.use("/vendor/leaflet", express.static(path.join(config.root, "node_modules", "leaflet", "dist")));
app.use(express.static(path.join(config.root, "public"), { extensions: ["html"] }));

// ---- errors ----
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose || err.status < 500 ? err.message : "Something went wrong on the server." });
});

if (require.main === module) {
  app.listen(config.port, async () => {
    console.log(`\nRoadWatch AI is running → http://localhost:${config.port}`);
    console.log(`Citizen report page   → http://localhost:${config.port}/report`);
    const h = await detector.health();
    console.log(h.ok ? `AI detector connected (${h.model})` : `AI detector not reachable at ${config.detectorUrl} — photos will be saved without AI analysis until it is started.`);
  });
}

module.exports = app;
