// Helpers shared by the staff app (app.js) and the citizen page (report.js).
const $ = (id) => document.getElementById(id);
const SEV_COLORS = { Critical: "#DC4545", High: "#F28C28", Medium: "#E5B52A", Low: "#269B65" };
const CHENNAI = [13.045, 80.225];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 3200);
}

// fetch wrapper: JSON in/out, FormData passthrough, readable errors.
async function api(path, { method = "GET", body, raw } = {}) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  let res;
  try { res = await fetch(path, opts); } catch { throw Object.assign(new Error("Cannot reach the RoadWatch server. Is it running?"), { status: 0 }); }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.detail || `Request failed (${res.status})`);
    err.status = res.status;
    if (res.status === 401 && typeof window.onUnauthorized === "function") window.onUnauthorized();
    throw err;
  }
  return data;
}

const fmtDate = (iso, withTime) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

function timeAgo(iso) {
  if (!iso) return "Never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

// Photo with AI detection boxes drawn on top (box_norm is 0..1 of image size).
function photoWithBoxes(url, detections, alt = "Road damage photo") {
  const dets = (detections || []).map((d) => {
    const [x1, y1, x2, y2] = d.box_norm || [0, 0, 0, 0];
    return `<span class="detbox" style="left:${x1 * 100}%;top:${y1 * 100}%;width:${(x2 - x1) * 100}%;height:${(y2 - y1) * 100}%"><em>${esc(d.label)} ${Math.round(d.confidence * 100)}%</em></span>`;
  }).join("");
  return `<div class="detwrap"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">${dets}</div>`;
}

// Nearest road (client-side preview of the server's snapping).
function nearestRoad(lat, lng, roads) {
  const toXY = (p) => [(p[1] - lng) * 111320 * Math.cos((lat * Math.PI) / 180), (p[0] - lat) * 110540];
  let best = null;
  for (const r of roads || []) {
    for (let i = 0; i < r.geometry.length - 1; i++) {
      const a = toXY(r.geometry[i]), b = toXY(r.geometry[i + 1]);
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l2)) : 0;
      const d = Math.hypot(a[0] + dx * t, a[1] + dy * t);
      if (!best || d < best.d) best = { road: r, d };
    }
  }
  return best;
}

// A small Leaflet map for choosing a location. Returns { map, set(lat,lng), get() }.
function pickerMap(el, { roads, onChange, start } = {}) {
  const map = L.map(el, { zoomControl: true }).setView(start || CHENNAI, start ? 16 : 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
  (roads || []).forEach((r) => L.polyline(r.geometry, { color: "#3768e5", weight: 4, opacity: 0.35, interactive: false }).addTo(map));
  let marker = null, value = null;
  const set = (lat, lng, fly) => {
    value = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    if (!marker) marker = L.marker([lat, lng], { draggable: true }).addTo(map).on("dragend", (e) => { const p = e.target.getLatLng(); set(p.lat, p.lng); });
    else marker.setLatLng([lat, lng]);
    if (fly) map.setView([lat, lng], Math.max(map.getZoom(), 16));
    onChange && onChange(value, nearestRoad(value.lat, value.lng, roads));
  };
  map.on("click", (e) => set(e.latlng.lat, e.latlng.lng));
  if (start) set(start[0], start[1]);
  setTimeout(() => map.invalidateSize(), 60);
  return { map, set, get: () => value };
}

function useMyLocation(picker, btn) {
  if (!navigator.geolocation) return toast("This browser cannot share location.", "error");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (p) => { btn.disabled = false; btn.textContent = label; picker.set(p.coords.latitude, p.coords.longitude, true); },
    (e) => { btn.disabled = false; btn.textContent = label; toast(e.code === 1 ? "Location permission was denied. Tap the map instead." : "Could not get your location. Tap the map instead.", "error"); },
    { enableHighAccuracy: true, timeout: 12000 },
  );
}
