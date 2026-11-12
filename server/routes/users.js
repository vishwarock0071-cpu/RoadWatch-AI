// Sign-in, own profile, and administrator user management.
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const auth = require("../lib/auth");
const { ROLES } = require("../lib/constants");

const authRouter = express.Router();
const usersRouter = express.Router();

// Basic brute-force protection: 10 failed attempts per email+IP per 15 minutes.
const attempts = new Map();
function limited(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60000) return false;
  return a.count >= 10;
}
function fail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60000) attempts.set(key, { first: Date.now(), count: 1 });
  else a.count++;
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, area: u.area, team_id: u.team_id, status: u.status, last_active: u.last_active, created_at: u.created_at });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post("/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const key = `${email}|${req.ip}`;
  if (limited(key)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) { fail(key); return res.status(401).json({ error: "Email or password is incorrect." }); }
  if (u.status !== "Active") return res.status(403).json({ error: "This account has been deactivated. Contact an administrator." });
  attempts.delete(key);
  auth.issue(res, u);
  db.prepare("UPDATE users SET last_active=? WHERE id=?").run(new Date().toISOString(), u.id);
  res.json(publicUser(u));
});

authRouter.post("/logout", (req, res) => { auth.clear(res); res.json({ ok: true }); });

authRouter.get("/me", auth.requireAuth, (req, res) => {
  const u = db.prepare("SELECT u.*, t.name team_name FROM users u LEFT JOIN teams t ON t.id=u.team_id WHERE u.id=?").get(req.user.id);
  res.json({ ...publicUser(u), team_name: u.team_name || null });
});

authRouter.put("/me", auth.requireAuth, (req, res) => {
  const { name, email, department, area, current_password, new_password } = req.body;
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: "Name is required." });
  if (email !== undefined) {
    if (!EMAIL.test(email)) return res.status(400).json({ error: "Enter a valid email." });
    if (db.prepare("SELECT 1 FROM users WHERE email=? AND id!=?").get(email.trim(), u.id)) return res.status(409).json({ error: "That email is already used." });
  }
  let hash = u.password_hash;
  if (new_password) {
    if (!bcrypt.compareSync(String(current_password || ""), u.password_hash)) return res.status(400).json({ error: "Current password is incorrect." });
    if (String(new_password).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
    hash = bcrypt.hashSync(String(new_password), 10);
  }
  db.prepare("UPDATE users SET name=?, email=?, department=?, area=?, password_hash=? WHERE id=?").run(
    name?.trim() ?? u.name, email?.trim().toLowerCase() ?? u.email, department ?? u.department, area ?? u.area, hash, u.id);
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(u.id)));
});

// ---- administrator user management ----
usersRouter.use(auth.requireCan("manageUsers"));

usersRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT u.*, t.name team_name FROM users u LEFT JOIN teams t ON t.id=u.team_id ORDER BY u.id").all();
  res.json(rows.map((u) => ({ ...publicUser(u), team_name: u.team_name || null })));
});

function validate(b, isNew) {
  if (!String(b.name || "").trim()) return "Full name is required.";
  if (!EMAIL.test(String(b.email || "").trim())) return "Enter a valid email address.";
  if (!ROLES.includes(b.role)) return "Choose a valid role.";
  if (isNew && String(b.password || "").length < 6) return "Password must be at least 6 characters.";
  if (b.role === "Repair Team" && !b.team_id) return "Repair Team users must belong to a repair team.";
  return null;
}

usersRouter.post("/", (req, res) => {
  const b = req.body, err = validate(b, true);
  if (err) return res.status(400).json({ error: err });
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(b.email.trim())) return res.status(409).json({ error: "That email already exists." });
  const id = db.prepare("INSERT INTO users (name, email, password_hash, role, department, area, team_id) VALUES (?,?,?,?,?,?,?)").run(
    b.name.trim(), b.email.trim().toLowerCase(), bcrypt.hashSync(String(b.password), 10), b.role, b.department || "", b.area || "",
    b.role === "Repair Team" ? Number(b.team_id) : null).lastInsertRowid;
  res.status(201).json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)));
});

usersRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id), b = req.body;
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) return res.status(404).json({ error: "User not found." });
  const err = validate({ ...u, ...b }, false);
  if (err) return res.status(400).json({ error: err });
  if (db.prepare("SELECT 1 FROM users WHERE email=? AND id!=?").get(String(b.email ?? u.email).trim(), id)) return res.status(409).json({ error: "Email already assigned to another user." });
  if (id === req.user.id && b.role && b.role !== "Administrator") return res.status(400).json({ error: "You cannot remove your own administrator role." });
  const role = b.role || u.role;
  db.prepare("UPDATE users SET name=?, email=?, role=?, department=?, area=?, team_id=? WHERE id=?").run(
    String(b.name ?? u.name).trim(), String(b.email ?? u.email).trim().toLowerCase(), role, b.department ?? u.department, b.area ?? u.area,
    role === "Repair Team" ? Number(b.team_id ?? u.team_id) : null, id);
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(String(b.password), 10), id);
  }
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)));
});

usersRouter.post("/:id/toggle", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You cannot deactivate your own account." });
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) return res.status(404).json({ error: "User not found." });
  const status = u.status === "Active" ? "Inactive" : "Active";
  if (status === "Inactive" && u.role === "Administrator" && db.prepare("SELECT COUNT(*) n FROM users WHERE role='Administrator' AND status='Active'").get().n <= 1) {
    return res.status(400).json({ error: "At least one active administrator is required." });
  }
  db.prepare("UPDATE users SET status=? WHERE id=?").run(status, id);
  res.json(publicUser({ ...u, status }));
});

module.exports = { authRouter, usersRouter };
