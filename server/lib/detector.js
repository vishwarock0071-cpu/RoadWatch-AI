// Client for the Python YOLO detector service (detector/app.py).
// If the service is not running, callers get { ok:false } and the case is
// marked "AI unavailable" instead of receiving made-up scores.
const fs = require("fs");
const config = require("../config");

async function health() {
  try {
    const r = await fetch(`${config.detectorUrl}/health`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false, reason: `Detector responded ${r.status}` };
    return { ok: true, ...(await r.json()) };
  } catch (e) {
    return { ok: false, reason: "Detector service is not running" };
  }
}

async function detect(filePath, mime, name) {
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(filePath)], { type: mime || "image/jpeg" }), name || "image.jpg");
    const r = await fetch(`${config.detectorUrl}/detect`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: body.detail || `Detector responded ${r.status}` };
    return { ok: true, ...body };
  } catch (e) {
    return { ok: false, reason: "Detector service is not running" };
  }
}

// Turns raw detections into a suggested severity. The heuristic uses how much
// of the photo the detected damage covers and how many regions were found.
// It is a triage suggestion only; officers confirm or override it.
function assess(result) {
  const dets = (result && result.detections) || [];
  if (!dets.length) {
    return { ai_status: "No damage detected", severity: null, confidence: null, summary: "The model found no road damage in this photo." };
  }
  const cover = Math.min(1, dets.reduce((s, d) => s + (d.area_ratio || 0), 0));
  const maxConf = Math.max(...dets.map((d) => d.confidence));
  let severity = "Low";
  if (cover >= 0.15 || dets.length >= 4) severity = "Critical";
  else if (cover >= 0.06 || dets.length >= 3) severity = "High";
  else if (cover >= 0.02) severity = "Medium";
  const labels = [...new Set(dets.map((d) => d.label))].join(", ");
  return {
    ai_status: "Detected",
    severity,
    confidence: maxConf,
    summary: `${dets.length} region${dets.length > 1 ? "s" : ""} detected (${labels}), covering ${(cover * 100).toFixed(1)}% of the image. Suggested severity: ${severity}.`,
  };
}

module.exports = { health, detect, assess };
