// Session auth: a signed JWT in an httpOnly cookie. Roles are re-read from
// the database on every request so deactivation / role changes apply at once.
const jwt = require("jsonwebtoken");
const db = require("../db");
const config = require("../config");
const { ROLE_CAN } = require("./constants");

const COOKIE = "rw_session";

function issue(res, user) {
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: false, maxAge: config.sessionHours * 3600000 });
}

function clear(res) { res.clearCookie(COOKIE); }

const touch = db.prepare("UPDATE users SET last_active=? WHERE id=?");
const getUser = db.prepare("SELECT id, name, email, role, department, area, team_id, status FROM users WHERE id=?");

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: "Please sign in." });
  try {
    const { uid } = jwt.verify(token, config.jwtSecret);
    const user = getUser.get(uid);
    if (!user || user.status !== "Active") { clear(res); return res.status(401).json({ error: "Your account is not active." }); }
    req.user = user;
    touch.run(new Date().toISOString(), uid);
    next();
  } catch {
    clear(res);
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

// requireCan("editCase") — checks the role permission table.
function requireCan(action) {
  return (req, res, next) => {
    if (!ROLE_CAN[action] || !ROLE_CAN[action].includes(req.user.role)) {
      return res.status(403).json({ error: `Your role (${req.user.role}) cannot do this.` });
    }
    next();
  };
}

function can(user, action) { return !!ROLE_CAN[action] && ROLE_CAN[action].includes(user.role); }

module.exports = { issue, clear, requireAuth, requireCan, can };
