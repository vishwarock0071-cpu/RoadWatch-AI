// Photo upload handling (multer) plus "attach + run AI" helper.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../config");
const db = require("../db");
const detector = require("./detector");

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ALLOWED[file.mimetype] || ".bin"}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(Object.assign(new Error("Only JPEG, PNG or WebP photos are accepted."), { status: 400 }));
  },
});

// Wraps multer so its errors become clean JSON responses.
function photo(field = "photo") {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? `Photo is larger than ${config.maxUploadMb} MB.` : err.message;
    res.status(err.status || 400).json({ error: msg });
  });
}

const insAtt = db.prepare(`INSERT INTO attachments (case_id, kind, filename, original_name, mime, size, width, height, detections, uploaded_by, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

// Saves an attachment row; when runAi is true, sends the photo to the detector.
// Returns { attachmentId, ai } where ai is the assessment (or null).
async function attach(caseId, file, kind, user, runAi) {
  let detections = null, width = null, height = null, ai = null;
  if (runAi) {
    const result = await detector.detect(file.path, file.mimetype, file.originalname);
    if (result.ok) {
      detections = JSON.stringify({ model: result.model, detections: result.detections, inference_ms: result.inference_ms });
      width = result.image?.width || null; height = result.image?.height || null;
      ai = { ...detector.assess(result), raw: result };
    } else {
      ai = { ai_status: "AI unavailable", severity: null, confidence: null, summary: result.reason };
    }
  }
  const id = insAtt.run(caseId, kind, file.filename, file.originalname?.slice(0, 200) || null, file.mimetype, file.size,
    width, height, detections, user ? user.id : null, new Date().toISOString()).lastInsertRowid;
  return { attachmentId: id, ai };
}

function removeFile(file) { if (file) fs.rm(file.path, { force: true }, () => {}); }

module.exports = { photo, attach, removeFile };
