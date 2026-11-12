// RoadWatch AI — staff web app. Talks to the Express API under /api.
"use strict";

let me = null, meta = null;
let teamsCache = [], vehiclesCache = [], mapData = null;
let map = null, roadLayer = null, markerLayer = null, vehicleLayer = null, repairLayer = null, selectedRoad = null;
const caseQuery = { page: 1 };
let currentPage = "dashboard";

const can = (action) => !!(me && meta && meta.can[action] && meta.can[action].includes(me.role));
const sevPill = (s) => `<span class="pill ${esc(String(s).toLowerCase())}">${esc(s)}</span>`;
const statPill = (s) => `<span class="pill statuspill st-${esc(String(s).toLowerCase().replace(/\s+/g, "-"))}">${esc(s)}</span>`;
const initials = (n) => String(n || "?").split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const n0 = (v) => (v == null ? "–" : Number(v).toLocaleString("en-IN"));
const dlState = (s) => `<span class="dl ${/Overdue|Missed/.test(s) ? "bad" : /today/.test(s) ? "warn" : s === "Met" ? "ok" : ""}">${esc(s)}</span>`;

// ---------------------------------------------------------------- boot & auth
window.onUnauthorized = () => { if (me) { me = null; showLogin("Your session ended. Please sign in again."); } };

document.addEventListener("DOMContentLoaded", async () => {
  bindStatic();
  try { const u = await api("/api/auth/me"); await start(u); }
  catch { showLogin(); }
  $("boot").classList.add("hidden");
});

function showLogin(msg) {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("loginError").textContent = msg || "";
  closeDrawer(); closeModal();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("loginBtn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const u = await api("/api/auth/login", { method: "POST", body: { email: $("email").value, password: $("password").value } });
    $("loginError").textContent = "";
    await start(u);
  } catch (err) { $("loginError").textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = "Sign in →"; }
});
document.querySelectorAll(".demoacct").forEach((b) => b.addEventListener("click", () => { $("email").value = b.dataset.email; $("password").value = "demo123"; $("password").focus(); }));

async function start(user) {
  me = user;
  if (!meta) meta = await api("/api/meta");
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("userName").textContent = me.name;
  $("role").textContent = me.role + (me.team_name ? ` · ${me.team_name}` : "");
  $("avatar").textContent = initials(me.name);
  if (!me.team_name && me.team_id) { const full = await api("/api/auth/me"); me = full; $("role").textContent = `${me.role} · ${me.team_name}`; }

  // Role-based visibility.
  document.querySelector('[data-page="users"]').classList.toggle("hidden", !can("manageUsers"));
  document.querySelectorAll("[data-role-create]").forEach((el) => el.classList.toggle("hidden", !can("createCase")));
  document.querySelectorAll("[data-role-export]").forEach((el) => el.classList.toggle("hidden", !can("exportReports")));
  document.querySelectorAll("[data-role-teams]").forEach((el) => el.classList.toggle("hidden", !can("manageTeams")));
  document.querySelectorAll("[data-role-vehicles]").forEach((el) => el.classList.toggle("hidden", !can("manageVehicles")));
  $("fMineWrap").classList.toggle("hidden", !me.team_id);

  fillSelect($("sev"), meta.severities, "All severities");
  fillSelect($("type"), meta.types, "All damage types");
  fillSelect($("status"), meta.statuses, "All statuses");
  fillSelect($("source"), meta.sources, "All sources");
  fillSelect($("roleFilter"), meta.roles, "All roles");
  $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }).toUpperCase() + " · CHENNAI";

  teamsCache = await api("/api/teams").catch(() => []);
  go("dashboard");
  refreshSystemBadge();
  refreshNotifications();
  clearInterval(start.timer);
  start.timer = setInterval(() => { if (me) { refreshNotifications(); refreshSystemBadge(); } }, 60000);
}

function fillSelect(sel, items, allLabel) {
  const v = sel.value;
  sel.innerHTML = `<option value="">${esc(allLabel)}</option>` + items.map((x) => `<option>${esc(x)}</option>`).join("");
  sel.value = v;
}

// ---------------------------------------------------------------- navigation
function go(page, opts = {}) {
  const target = $(page);
  if (!target) return;
  if (page === "users" && !can("manageUsers")) page = "dashboard";
  currentPage = page;
  document.querySelectorAll(".page").forEach((x) => x.classList.toggle("active", x.id === page));
  document.querySelectorAll("[data-page]").forEach((x) => x.classList.toggle("active", x.dataset.page === page));
  $("crumb").textContent = { dashboard: "Dashboard", cases: "Cases", vehicles: "Vehicles", analytics: "Analytics", teams: "Departments & Teams", users: "User Management" }[page];
  window.scrollTo(0, 0);
  const loaders = { dashboard: loadDashboard, cases: () => loadCases(opts), vehicles: loadVehicles, analytics: loadAnalytics, teams: loadTeams, users: loadUsers };
  Promise.resolve(loaders[page]()).catch((err) => toast(err.message, "error"));
}

function bindStatic() {
  document.querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  document.querySelectorAll("[data-jump]").forEach((el) => el.addEventListener("click", () => {
    const j = JSON.parse(el.dataset.jump); const page = j.page; delete j.page;
    go(page, { filters: j });
  }));
  $("logout").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); me = null; $("menu").classList.add("hidden"); showLogin(); });
  $("menuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("menu").classList.toggle("hidden"); });
  document.addEventListener("click", (e) => {
    if (!$("menu").contains(e.target)) $("menu").classList.add("hidden");
    if (!$("notifyPanel").contains(e.target) && e.target !== $("notifications") && !$("notifications").contains(e.target)) $("notifyPanel").classList.add("hidden");
  });
  $("profileBtn").addEventListener("click", editProfile);
  $("passwordBtn").addEventListener("click", changePassword);
  $("notifications").addEventListener("click", () => { $("notifyPanel").classList.toggle("hidden"); refreshNotifications(); });
  $("closeNotify").addEventListener("click", () => $("notifyPanel").classList.add("hidden"));
  $("notesBtn").addEventListener("click", aboutSystem);
  $("closeDrawer").addEventListener("click", closeDrawer);
  $("drawerBackdrop").addEventListener("click", (e) => { if (e.target === $("drawerBackdrop")) closeDrawer(); });
  $("closeModal").addEventListener("click", closeModal);
  $("cancel").addEventListener("click", closeModal);
  $("modalBackdrop").addEventListener("mousedown", (e) => { if (e.target === $("modalBackdrop")) closeModal(); });
  $("closeLightbox").addEventListener("click", () => $("lightbox").classList.add("hidden"));
  $("lightbox").addEventListener("click", (e) => { if (e.target === $("lightbox")) $("lightbox").classList.add("hidden"); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("lightbox").classList.contains("hidden")) $("lightbox").classList.add("hidden");
    else if (!$("modalBackdrop").classList.contains("hidden")) closeModal();
    else closeDrawer();
  });

  // Dashboard
  $("newCase").addEventListener("click", () => newCase());
  $("newCase2").addEventListener("click", () => newCase());
  $("period").addEventListener("change", loadTrend);
  $("vehiclesLayer").addEventListener("change", drawVehicleLayer);
  $("repairsLayer").addEventListener("change", drawRepairLayer);
  $("resetMap").addEventListener("click", () => map && fitChennai());
  $("mapSearchBtn").addEventListener("click", mapSearch);
  $("mapSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") mapSearch(); });
  $("mapSearch").addEventListener("input", () => drawMarkers());

  // Cases
  let t;
  $("searchCase").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { caseQuery.page = 1; loadCases(); }, 280); });
  ["sev", "type", "status", "source", "sort", "fOpen", "fOverdue", "fMine", "fReal"].forEach((id) => $(id).addEventListener("change", () => { caseQuery.page = 1; loadCases(); }));
  $("prevPage").addEventListener("click", () => { caseQuery.page--; loadCases(); });
  $("nextPage").addEventListener("click", () => { caseQuery.page++; loadCases(); });
  $("clearFilters").addEventListener("click", () => { resetCaseFilters(); loadCases(); });
  $("exportCsv").addEventListener("click", () => download(`/api/reports/cases.csv?${caseParams(true)}`));

  // Vehicles / analytics / teams / users
  $("searchVehicle").addEventListener("input", renderVehicles);
  $("sourceFilter").addEventListener("change", renderVehicles);
  $("addVehicle").addEventListener("click", () => editVehicle());
  $("downloadCsv").addEventListener("click", () => download("/api/reports/cases.csv"));
  $("downloadPdf").addEventListener("click", () => download("/api/reports/summary.pdf"));
  $("addTeam").addEventListener("click", () => editTeam());
  $("searchUser").addEventListener("input", renderUsers);
  $("roleFilter").addEventListener("change", renderUsers);
  $("createUser").addEventListener("click", () => editUser());
  $("refreshSystem").addEventListener("click", loadSystem);
}

async function download(url) {
  try {
    const res = await api(url, { raw: true });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Download failed."); }
    const blob = await res.blob();
    const name = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "roadwatch-export";
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Downloaded ${name}`);
  } catch (e) { toast(e.message, "error"); }
}

// ---------------------------------------------------------------- dashboard
async function loadDashboard() {
  const [d, prio] = await Promise.all([api(`/api/stats/dashboard?period=${$("period").value}`), api("/api/cases/priority?limit=6")]);
  const chg = (v, label) => v == null ? label : `${v >= 0 ? "↗" : "↘"} ${Math.abs(v)}% ${label}`;
  $("mValid").textContent = n0(d.valid);
  $("mValidNote").textContent = chg(d.newChange, "new cases vs previous 30 days");
  $("mCritical").textContent = n0(d.critical);
  $("mCriticalNote").textContent = `Across ${d.criticalAreas} area${d.criticalAreas === 1 ? "" : "s"}`;
  $("mOverdue").textContent = n0(d.overdue);
  $("mOverdueNote").textContent = `${d.dueToday} more due today`;
  $("mResolved").textContent = n0(d.resolved);
  $("mResolvedNote").textContent = chg(d.resolvedChange, "repairs vs previous 30 days");
  $("demoTag").classList.toggle("hidden", !d.synthetic);
  setCoverage(d.coverage);
  renderTrend("chart", d.trend);
  $("priority").innerHTML = prio.length ? prio.map((c) => `
    <div class="priorityitem" data-open="${c.id}" tabindex="0">
      <i class="stripe" style="background:${SEV_COLORS[c.severity]}"></i>
      <div><b>${esc(c.type)} · ${esc(c.road)}</b><p>${esc(c.area)} · ${esc(c.code)} · ${dlState(c.deadline_state)}</p>${sevPill(c.severity)} ${statPill(c.status)}</div>
    </div>`).join("") : `<p class="empty">No open cases. 🎉</p>`;
  bindOpen($("priority"));
  updateOpenBadge();
  await loadMap(d);
}

function setCoverage(c) {
  $("covAll").textContent = `${c.overall}%`;
  $("covRing").innerHTML = `<span>${c.overall}%</span>`;
  $("covRing").style.background = `conic-gradient(#2aa985 0 ${c.overall}%, #e8edf3 ${c.overall}% 100%)`;
  $("covBus").textContent = `${c.bus}%`; $("covBusBar").style.width = `${c.bus}%`;
  $("covGc").textContent = `${c.garbage}%`; $("covGcBar").style.width = `${c.garbage}%`;
}

async function loadTrend() {
  try { renderTrend("chart", await api(`/api/stats/trend?period=${$("period").value}`)); } catch (e) { toast(e.message, "error"); }
}

function renderTrend(id, t) {
  if (id === "chart") $("trendNote").textContent = `Last ${t.labels.length} ${t.unit}s · ${t.created.reduce((a, b) => a + b, 0)} new · ${t.resolved.reduce((a, b) => a + b, 0)} verified`;
  lineChart($(id), t.labels, [{ name: "New damage cases", values: t.created, color: "#4975e8" }, { name: "Verified repairs", values: t.resolved, color: "#23a57e" }]);
}

// Simple responsive SVG line chart with axes and hover tooltips.
function lineChart(el, labels, series) {
  const W = 700, H = 170, L = 34, R = 10, T = 10, B = 24;
  const max = Math.max(4, ...series.flatMap((s) => s.values));
  const step = Math.pow(10, Math.floor(Math.log10(max))) / (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 1 : 2);
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, labels.length - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  let grid = "";
  for (let v = 0; v <= top; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#edf1f6"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="ax">${v}</text>`;
  const every = Math.ceil(labels.length / 7);
  const xl = labels.map((l, i) => (i % every === 0 || i === labels.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${esc(l)}</text>` : "")).join("");
  const lines = series.map((s) => `<polyline points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>` +
    s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${labels.length > 14 ? 2 : 3.2}" fill="${s.color}"><title>${esc(labels[i])} · ${esc(s.name)}: ${v}</title></circle>`).join("")).join("");
  const hits = labels.map((l, i) => `<rect x="${x(i) - (W - L - R) / labels.length / 2}" y="${T}" width="${(W - L - R) / labels.length}" height="${H - T - B}" fill="transparent"><title>${esc(l)}\n${series.map((s) => `${s.name}: ${s.values[i]}`).join("\n")}</title></rect>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Trend chart">${grid}${xl}${lines}${hits}</svg>`;
}

// ---------------------------------------------------------------- map
function fitChennai() { map.setView(CHENNAI, 11); }

async function loadMap(dash) {
  if (!window.L) { $("mapNote").textContent = "Map library failed to load."; return; }
  mapData = await api("/api/stats/map");
  if (!map) {
    map = L.map("map", { preferCanvas: true }).setView(CHENNAI, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
    roadLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    vehicleLayer = L.layerGroup();
    repairLayer = L.layerGroup();
    map.on("zoomend", drawMarkers);
  }
  setTimeout(() => map.invalidateSize(), 80);
  drawRoads(); drawMarkers(); drawVehicleLayer(); drawRepairLayer();
  const osm = mapData.roads.filter((r) => r.geometry_source === "osm").length;
  $("mapNote").textContent = osm === mapData.roads.length
    ? "● Road lines follow OpenStreetMap centre-lines (© OpenStreetMap contributors)"
    : osm ? `● ${osm} of ${mapData.roads.length} road lines from OpenStreetMap; the rest are illustrative until fetched`
      : "● Road lines are illustrative until real geometry is fetched (npm run fetch-roads)";
  $("mapCount").textContent = `${mapData.cases.length.toLocaleString("en-IN")} open cases · ${mapData.roads.filter((r) => r.count).length} roads affected` + (dash && dash.synthetic ? " · includes demo data" : "");
}

function drawRoads() {
  roadLayer.clearLayers();
  for (const r of mapData.roads) {
    const color = r.worst ? SEV_COLORS[r.worst] : "#8a9bb3";
    const halo = L.polyline(r.geometry, { color, weight: 10, opacity: r.worst ? 0.18 : 0.08, lineCap: "round" }).addTo(roadLayer);
    const line = L.polyline(r.geometry, { color, weight: 5, opacity: r.worst ? 0.95 : 0.45, lineCap: "round", lineJoin: "round", dashArray: r.geometry_source === "osm" ? null : "12 8", className: "damage-road-line" }).addTo(roadLayer);
    const tip = r.count
      ? `<b>${esc(r.name)}</b> · ${esc(r.area)}<br>${r.count} open · ${["Critical", "High", "Medium", "Low"].map((s) => r.bySeverity[s] ? `${r.bySeverity[s]} ${s.toLowerCase()}` : "").filter(Boolean).join(", ")}`
      : `<b>${esc(r.name)}</b> · no open cases`;
    [halo, line].forEach((l) => {
      l.bindTooltip(tip, { sticky: true });
      l.on("click", () => {
        if (selectedRoad) selectedRoad.setStyle({ weight: 5 });
        selectedRoad = line; line.setStyle({ weight: 9 });
        openRoadCases(r);
      });
    });
  }
}

function caseMatches(c, q) { return !q || [c[1], c[6], c[8], c[9], c[10], c[5]].join(" ").toLowerCase().includes(q); }

function drawMarkers() {
  if (!map || !mapData) return;
  markerLayer.clearLayers();
  const q = $("mapSearch").value.trim().toLowerCase();
  if (map.getZoom() < 13 && !q) return;
  const renderer = drawMarkers.renderer || (drawMarkers.renderer = L.canvas({ padding: 0.3 }));
  for (const c of mapData.cases) {
    if (!caseMatches(c, q)) continue;
    L.circleMarker([c[2], c[3]], { renderer, radius: c[4] === "Critical" ? 7 : 5, color: "#fff", weight: 1.5, fillColor: SEV_COLORS[c[4]], fillOpacity: 0.95 })
      .bindTooltip(`<b>${esc(c[1])}</b>${c[11] ? " · demo" : ""}<br>${esc(c[5])} · ${esc(c[4])}<br>${esc(c[6])} · ${esc(c[7])}`)
      .on("click", () => openCase(c[0]))
      .addTo(markerLayer);
  }
}

function drawVehicleLayer() {
  if (!map) return;
  vehicleLayer.clearLayers();
  if (!$("vehiclesLayer").checked) { map.removeLayer(vehicleLayer); return; }
  for (const v of mapData.vehicles) {
    if (v.lat == null) continue;
    const bus = v.type === "Government bus";
    L.marker([v.lat, v.lng], { icon: L.divIcon({ className: "vehpin", html: `<span class="${bus ? "bus" : "gc"}">${bus ? "▤" : "♻"}</span>`, iconSize: [24, 24] }) })
      .bindTooltip(`<b>${esc(v.code)}</b><br>${esc(v.type)} · ${esc(v.route)}`).addTo(vehicleLayer);
  }
  vehicleLayer.addTo(map);
}

function drawRepairLayer() {
  if (!map) return;
  repairLayer.clearLayers();
  if (!$("repairsLayer").checked) { map.removeLayer(repairLayer); return; }
  const colors = { Resolved: "#169b70", "Awaiting Verification": "#8256c5", "Needs Rework": "#d83c4d" };
  for (const r of mapData.repairs) {
    L.circleMarker([r[2], r[3]], { radius: 6, color: "#fff", weight: 1.5, fillColor: colors[r[4]] || "#3976db", fillOpacity: 0.95 })
      .bindTooltip(`${esc(r[1])} · ${esc(r[4])}`).on("click", () => openCase(r[0])).addTo(repairLayer);
  }
  repairLayer.addTo(map);
}

async function mapSearch() {
  const q = $("mapSearch").value.trim().toLowerCase();
  if (!q) return drawMarkers();
  const hits = mapData.cases.filter((c) => caseMatches(c, q));
  drawMarkers();
  if (hits.length === 1 || (hits.length && hits[0][1].toLowerCase() === q)) {
    map.setView([hits[0][2], hits[0][3]], 17); openCase(hits[0][0]); return;
  }
  if (hits.length) { map.fitBounds(L.latLngBounds(hits.map((c) => [c[2], c[3]])).pad(0.2)); toast(`${hits.length} open cases match.`); return; }
  // Not among open cases: search everything on the server.
  try {
    const r = await api(`/api/cases?q=${encodeURIComponent(q)}&limit=1`);
    if (r.total) { const c = await api(`/api/cases/${r.items[0].id}`); map.setView([c.lat, c.lng], 17); renderCase(c); }
    else toast("No matching case found.");
  } catch (e) { toast(e.message, "error"); }
}

async function openRoadCases(r) {
  openDrawer(`ROAD · ${r.count} OPEN CASE${r.count === 1 ? "" : "S"}`, r.name, `<p class="empty">Loading…</p>`);
  const list = await api(`/api/cases?road_id=${r.id}&open=1&sort=severity&limit=80`);
  $("drawerBody").innerHTML = `
    <div class="road-selection-note"><b>${esc(r.area)}</b><p>${r.geometry_source === "osm" ? `OpenStreetMap road: ${esc(r.osm_name || r.name)}` : "Illustrative road line"} · select a case to inspect it.</p>
      <button class="link" id="roadAll">See all cases on this road in the table →</button></div>
    <div class="road-case-list">${list.items.map((c) => `<button class="road-case-option" data-open="${c.id}"><span class="severity-dot" style="background:${SEV_COLORS[c.severity]}"></span><span><b>${esc(c.code)} · ${esc(c.type)}</b><small>${esc(c.severity)} · ${esc(c.status)} · ${esc(c.deadline_state)}${c.is_synthetic ? " · demo" : ""}</small></span><span>›</span></button>`).join("") || `<p class="empty">No open cases on this road.</p>`}</div>
    ${list.total > list.items.length ? `<p class="sectionnote">Showing ${list.items.length} of ${list.total}.</p>` : ""}`;
  bindOpen($("drawerBody"));
  $("roadAll").addEventListener("click", () => { closeDrawer(); go("cases", { filters: { road_id: r.id, open: "1" }, label: r.name }); });
}

// ---------------------------------------------------------------- cases list
function resetCaseFilters() {
  ["searchCase", "sev", "type", "status", "source"].forEach((id) => ($(id).value = ""));
  $("sort").value = "newest";
  ["fOpen", "fOverdue", "fMine", "fReal"].forEach((id) => ($(id).checked = false));
  delete caseQuery.road_id; delete caseQuery.team_id; delete caseQuery.roadLabel;
  caseQuery.page = 1;
}

function caseParams(forExport) {
  const p = new URLSearchParams();
  const add = (k, v) => { if (v) p.set(k, v); };
  add("q", $("searchCase").value.trim()); add("severity", $("sev").value); add("type", $("type").value);
  add("status", $("status").value); add("source", $("source").value);
  if ($("fOpen").checked) p.set("open", "1");
  if ($("fOverdue").checked) p.set("overdue", "1");
  if ($("fMine").checked && me.team_id) p.set("team_id", me.team_id);
  if ($("fReal").checked) p.set("synthetic", "0");
  if (caseQuery.road_id) p.set("road_id", caseQuery.road_id);
  if (caseQuery.team_id) p.set("team_id", caseQuery.team_id);
  if (!forExport) { p.set("sort", $("sort").value); p.set("page", caseQuery.page); p.set("limit", 50); }
  return p.toString();
}

async function loadCases(opts = {}) {
  if (opts.filters) {
    resetCaseFilters();
    const f = opts.filters;
    if (f.severity) $("sev").value = f.severity;
    if (f.type) $("type").value = f.type;
    if (f.status) $("status").value = f.status;
    if (f.sort) $("sort").value = f.sort;
    if (f.q) $("searchCase").value = f.q;
    if (f.open) $("fOpen").checked = true;
    if (f.overdue) $("fOverdue").checked = true;
    if (f.road_id) { caseQuery.road_id = f.road_id; caseQuery.roadLabel = `on ${opts.label}`; }
    if (f.team_id) { caseQuery.team_id = f.team_id; caseQuery.roadLabel = `assigned to ${opts.label}`; }
  }
  const r = await api(`/api/cases?${caseParams()}`);
  caseQuery.page = r.page;
  $("caseCount").textContent = `${r.total.toLocaleString("en-IN")} case${r.total === 1 ? "" : "s"}${caseQuery.roadLabel ? ` ${caseQuery.roadLabel}` : ""}`;
  $("caseRows").innerHTML = r.items.map((c) => `
    <tr class="rowlink" data-open="${c.id}">
      <td><strong class="caseid">${esc(c.code)}</strong><small>${fmtDate(c.created_at)}${c.is_synthetic ? ' · <span class="demo-chip">demo</span>' : ""}</small></td>
      <td><strong>${esc(c.type)}</strong><small>${c.photos ? `📷 ${c.photos} · ` : ""}${esc(c.ai_status === "Simulated" ? c.cause : c.ai_status)}</small></td>
      <td><strong>${esc(c.road)}</strong><small>${esc(c.area)}</small></td>
      <td><strong>${esc(c.source)}</strong><small>${esc(c.vehicle || "—")}</small></td>
      <td>${sevPill(c.severity)}</td>
      <td>${statPill(c.status)}<small>${esc(c.team || "")}</small></td>
      <td>${dlState(c.deadline_state)}<small>${c.deadline ? fmtDate(c.deadline) : ""}</small></td>
      <td><button class="rowbtn" data-open="${c.id}">Inspect ↗</button></td>
    </tr>`).join("") || `<tr><td colspan="8" class="empty">No cases match these filters.</td></tr>`;
  $("pageInfo").textContent = `Page ${r.page} of ${r.pages}`;
  $("prevPage").disabled = r.page <= 1;
  $("nextPage").disabled = r.page >= r.pages;
  bindOpen($("caseRows"));
}

function bindOpen(root) {
  root.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); openCase(el.dataset.open); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openCase(el.dataset.open); });
  });
}

async function updateOpenBadge() {
  try { const r = await api("/api/cases?open=1&limit=1"); $("navOpen").textContent = r.total > 999 ? `${Math.floor(r.total / 100) / 10}k` : r.total; } catch { /* ignore */ }
}

// ---------------------------------------------------------------- case drawer
function openDrawer(eyebrow, title, html) {
  $("drawerId").textContent = eyebrow; $("drawerTitle").textContent = title; $("drawerBody").innerHTML = html;
  $("drawerBackdrop").classList.remove("hidden");
}
function closeDrawer() {
  $("drawerBackdrop").classList.add("hidden");
  if (selectedRoad) { selectedRoad.setStyle({ weight: 5 }); selectedRoad = null; }
}

async function openCase(id) {
  openDrawer("CASE", "Loading…", `<p class="empty">Loading case…</p>`);
  try { renderCase(await api(`/api/cases/${id}`)); }
  catch (e) { $("drawerBody").innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

const detail = (a, b) => `<div class="detail"><span>${esc(a)}</span><b>${esc(b ?? "—")}</b></div>`;
const val = (v, unit) => (v == null || v === "" ? "Not measured" : `${v} ${unit}`);

function renderCase(c) {
  const isMyTeam = me.team_id && c.team_id === me.team_id;
  const canEdit = can("editCase");
  const canRepair = can("repairUpdate") && (me.role !== "Repair Team" || isMyTeam) && !["Resolved", "Rejected"].includes(c.status);
  const evid = c.attachments.filter((a) => a.kind !== "repair");
  const repairs = c.attachments.filter((a) => a.kind === "repair");
  const main = evid[0];
  let photo;
  if (main) {
    const dets = main.detections?.detections;
    photo = `<div class="evidence-photo">${photoWithBoxes(main.url, dets)}
      <div class="photo-caption">${main.kind === "citizen" ? "Citizen photo" : "Evidence photo"} · ${fmtDate(main.created_at, true)}${main.detections ? ` · ${esc(main.detections.model)} · ${dets.length} detection${dets.length === 1 ? "" : "s"}` : " · not analysed by AI"}
      ${canEdit ? `<button class="link" data-redetect="${main.id}">Run AI again</button>` : ""}</div></div>`;
  } else if (c.is_synthetic) {
    photo = `<div class="evidence-photo"><img src="/reference_pothole.jpg" alt="Illustrative pothole reference photograph"><div class="photo-caption">Reference photo only — this is a synthetic demo record with no real evidence image.</div></div>`;
  } else {
    photo = `<div class="evidence-photo"><div class="no-evidence">▧<br>No evidence photo yet</div></div>`;
  }
  const thumbs = c.attachments.length > 1 || repairs.length ? `<div class="thumbs">${c.attachments.map((a) => `<button class="thumb" data-photo="${a.id}" title="${esc(a.kind)} · ${fmtDate(a.created_at, true)}"><img src="${esc(a.url)}" alt="" loading="lazy"><i>${a.kind === "repair" ? "after" : a.kind}</i></button>`).join("")}</div>` : "";

  const ai = c.ai_status === "Simulated"
    ? `<div class="aibox muted"><b>AI analysis</b><p>Demo record — no photo was analysed. Measurements and confidence below are simulated.</p></div>`
    : c.ai_status === "Not run" ? ""
      : `<div class="aibox ${c.ai_status === "Detected" ? "ok" : c.ai_status === "AI unavailable" ? "warn" : ""}"><b>AI analysis · ${esc(c.ai_status)}</b><p>${esc(c.ai_summary || "")}</p>${c.ai_status === "Detected" ? `<p class="sectionnote nopad">Severity from AI is a triage suggestion — confirm it on review.</p>` : ""}</div>`;

  const actions = [];
  if (canEdit) actions.push(`<button class="secondary" data-act="edit">Edit details</button>`, `<button class="secondary" data-act="photo">Add photo</button>`);
  if ((meta.statusRules[me.role] || []).length && (me.role !== "Repair Team" || isMyTeam)) actions.push(`<button class="secondary" data-act="status">Update status</button>`);
  if (canRepair) actions.push(`<button class="primary" data-act="repair">Add repair update</button>`);
  if (me.role !== "Read-Only Auditor") actions.push(`<button class="secondary" data-act="comment">Comment</button>`);

  $("drawerId").textContent = `${c.code}${c.is_synthetic ? " · DEMO RECORD" : ""}`;
  $("drawerTitle").textContent = `${c.type} inspection`;
  $("drawerBody").innerHTML = `
    ${photo}${thumbs}
    <div class="record-summary"><div><small>${esc(c.code)} · ${esc(c.source)}</small><h2>${esc(c.type)}</h2><p>⌖ ${esc(c.road)} — ${esc(c.area)}${c.snap_distance_m != null && !c.is_synthetic ? ` · ${c.snap_distance_m} m from road line` : ""}</p></div>${statPill(c.status)}</div>
    ${ai}
    <div class="details summary-details">
      ${detail("Severity", c.severity)}${detail("Deadline", `${c.deadline ? fmtDate(c.deadline) : "—"} · ${c.deadline_state}`)}
      ${detail("Defect dimensions", c.length_cm && c.width_cm ? `${c.length_cm} × ${c.width_cm} cm` : "Not measured")}${detail("Maximum depth", val(c.depth_mm, "mm"))}
      ${detail(c.ai_status === "Simulated" ? "Detection confidence (demo)" : "AI confidence", c.confidence != null ? `${Math.round(c.confidence * 100)}%` : "—")}${detail("Observations", c.observations)}
      ${detail("First observed", fmtDate(c.observed_at, true))}${detail("Assigned team", c.team || "Not assigned")}
    </div>
    ${actions.length ? `<div class="actions sticky">${actions.join("")}</div>` : ""}
    <div class="section"><h3>Location & source</h3><div class="details">
      ${detail("Road / area", `${c.road} · ${c.area}`)}${detail("GPS", `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`)}
      ${detail("Source", c.source)}${detail(c.source === "Government bus" ? "Bus ID" : "Vehicle", c.vehicle || "—")}
      ${detail("Route", c.route || "—")}${detail("Lane / direction", c.lane ? `Lane ${c.lane}${c.lane_count ? ` of ${c.lane_count}` : ""} · ${c.direction || "—"}` : c.direction || "—")}
      ${c.reporter_name || c.reporter_contact ? detail("Reported by", [c.reporter_name, c.reporter_contact].filter(Boolean).join(" · ")) : ""}
      ${c.description ? `<div class="detail wide"><span>Description</span><b>${esc(c.description)}</b></div>` : ""}
    </div><div class="minimap" id="caseMap"></div></div>
    <div class="section"><h3>Excavation & responsibility</h3><div class="details">
      ${detail("Suspected cause", c.cause)}${detail("Permit status", c.permit)}${detail("Responsibility", c.responsibility)}
      ${detail("Restoration", ["Utility road cut", "Failed patch"].includes(c.type) ? "Needs inspection" : "Not applicable")}
    </div>${canEdit ? `<div class="actions"><button class="secondary" data-act="review">Review permit / responsibility</button></div>` : ""}</div>
    ${repairs.length ? `<div class="section"><h3>Repair evidence</h3><div class="repairgrid">${repairs.map((a) => `<button class="thumb big" data-photo="${a.id}"><img src="${esc(a.url)}" alt="After-repair photo" loading="lazy"><i>${fmtDate(a.created_at, true)}</i></button>`).join("")}</div></div>` : ""}
    <div class="section"><h3>Case history</h3><div class="timeline">${c.events.map((t) => `<div class="tl"><b>${esc(t.title)}</b><p>${t.detail ? esc(t.detail) + " · " : ""}${esc(t.user_name || "System")} · ${fmtDate(t.created_at, true)}</p></div>`).join("")}</div></div>
    ${me.role === "Administrator" ? `<p class="dangerzone"><button class="link danger" data-act="delete">Delete this case permanently</button></p>` : ""}`;

  // Mini map
  if (window.L) {
    const mm = L.map("caseMap", { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false }).setView([c.lat, c.lng], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(mm);
    L.circleMarker([c.lat, c.lng], { radius: 8, color: "#fff", weight: 2, fillColor: SEV_COLORS[c.severity], fillOpacity: 1 }).addTo(mm);
    setTimeout(() => mm.invalidateSize(), 50);
  }
  $("drawerBody").querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => caseAction(c, b.dataset.act)));
  $("drawerBody").querySelectorAll("[data-photo]").forEach((b) => b.addEventListener("click", () => showPhoto(c.attachments.find((a) => a.id === +b.dataset.photo))));
  $("drawerBody").querySelectorAll(".evidence-photo .detwrap").forEach((b) => b.addEventListener("click", () => main && showPhoto(main)));
  $("drawerBody").querySelectorAll("[data-redetect]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Analysing…";
    try { renderCase(await api(`/api/cases/${c.id}/photos/${b.dataset.redetect}/detect`, { method: "POST" })); toast("AI analysis updated."); afterChange(); }
    catch (e) { toast(e.message, "error"); b.disabled = false; b.textContent = "Run AI again"; }
  }));
}

function showPhoto(a) {
  if (!a) return;
  const dets = a.detections?.detections || [];
  $("lightboxBody").innerHTML = `${photoWithBoxes(a.url, dets)}<p>${esc(a.kind === "repair" ? "After-repair photo" : a.kind === "citizen" ? "Citizen photo" : "Evidence photo")} · ${fmtDate(a.created_at, true)}${a.detections ? ` · ${esc(a.detections.model)} · ${dets.length} detection(s) · ${a.detections.inference_ms} ms` : ""}</p>`;
  $("lightbox").classList.remove("hidden");
}

// Refresh whatever page is behind the drawer after a change.
function afterChange() {
  if (currentPage === "dashboard") loadDashboard().catch(() => {});
  else if (currentPage === "cases") loadCases().catch(() => {});
  else if (currentPage === "teams") loadTeams().catch(() => {});
  else if (currentPage === "analytics") loadAnalytics().catch(() => {});
  mapData = null;
  updateOpenBadge(); refreshNotifications();
}

async function caseAction(c, act) {
  const done = (msg) => (updated) => { renderCase(updated); toast(msg); afterChange(); };
  if (act === "status") {
    const allowed = meta.statusRules[me.role].filter((s) => s !== c.status && !(s === "Resolved" && c.status !== "Awaiting Verification"));
    const repairTeams = teamsCache.filter((t) => t.kind === "Repair team");
    openModal({
      title: "Update case status", eyebrow: c.code,
      fields: [
        { name: "status", label: "New status", type: "select", value: allowed.includes("Confirmed") && c.status === "Under Review" ? "Confirmed" : allowed[0], options: allowed,
          help: c.status !== "Awaiting Verification" && meta.statusRules[me.role].includes("Resolved") ? "Resolved becomes available once repair evidence has been submitted." : "" },
        { name: "team_id", label: "Assign to team", type: "select", value: c.team_id || "", options: repairTeams.map((t) => ({ value: t.id, label: t.name })), showIf: (v) => v.status === "Assigned", required: true },
        { name: "note", label: "Note", type: "textarea", full: true, placeholder: "Why is the status changing?" },
      ],
      submitLabel: "Update status",
      onSubmit: (d) => api(`/api/cases/${c.id}/status`, { method: "POST", body: d }).then(done("Case status updated.")),
    });
  }
  if (act === "review") {
    openModal({
      title: "Permit & responsibility review", eyebrow: c.code,
      fields: [
        { name: "permit", label: "Permit status", type: "select", value: c.permit, options: meta.permits },
        { name: "responsibility", label: "Responsible department / party", type: "text", value: c.responsibility, list: teamsCache.filter((t) => t.kind === "Department").map((t) => t.name).concat(["Pending verification"]) },
        { name: "cause", label: "Suspected cause", type: "text", value: c.cause, full: true },
        { name: "note", label: "Review note", type: "textarea", full: true },
      ],
      onSubmit: (d) => api(`/api/cases/${c.id}/review`, { method: "POST", body: d }).then(done("Review saved.")),
    });
  }
  if (act === "repair") {
    openModal({
      title: "Add repair update", eyebrow: `${c.code} · ${c.road}`,
      fields: [
        { name: "status", label: "Repair status", type: "select", value: c.status === "In Repair" ? "Awaiting Verification" : "In Repair", options: ["In Repair", "Awaiting Verification"],
          help: "Awaiting Verification sends the repair to an officer, who checks the photo and marks the case Resolved." },
        { name: "photo", label: "After-repair photo", type: "file", accept: "image/*", capture: true, full: true },
        { name: "note", label: "Repair notes", type: "textarea", full: true, required: true, placeholder: "Materials used, area patched, anything left to do…" },
      ],
      submitLabel: "Submit update", multipart: true,
      onSubmit: (d, fd) => api(`/api/cases/${c.id}/repair`, { method: "POST", body: fd }).then(done("Repair update saved.")),
    });
  }
  if (act === "photo") {
    openModal({
      title: "Add evidence photo", eyebrow: c.code,
      fields: [
        { name: "photo", label: "Photo", type: "file", accept: "image/*", capture: true, full: true, required: true },
        { name: "adopt_severity", label: "Update severity to the AI suggestion", type: "checkbox", value: false, full: true },
      ],
      submitLabel: "Upload & analyse", multipart: true,
      onSubmit: (d, fd) => { fd.set("adopt_severity", d.adopt_severity ? "1" : "0"); return api(`/api/cases/${c.id}/photos`, { method: "POST", body: fd }).then(done("Photo uploaded.")); },
    });
  }
  if (act === "comment") {
    openModal({
      title: "Add comment", eyebrow: c.code,
      fields: [{ name: "note", label: "Comment", type: "textarea", full: true, required: true }],
      submitLabel: "Post comment",
      onSubmit: (d) => api(`/api/cases/${c.id}/comment`, { method: "POST", body: d }).then((u) => { renderCase(u); toast("Comment added."); }),
    });
  }
  if (act === "edit") {
    const roads = (mapData || (mapData = await api("/api/stats/map"))).roads;
    openModal({
      title: "Edit case details", eyebrow: c.code, wide: true,
      fields: [
        { name: "type", label: "Damage type", type: "select", value: c.type, options: meta.types },
        { name: "severity", label: "Severity", type: "select", value: c.severity, options: meta.severities, help: "Changing severity recalculates the deadline from the creation date." },
        { name: "length_cm", label: "Length (cm)", type: "number", value: c.length_cm ?? "" },
        { name: "width_cm", label: "Width (cm)", type: "number", value: c.width_cm ?? "" },
        { name: "depth_mm", label: "Depth (mm)", type: "number", value: c.depth_mm ?? "" },
        { name: "lane", label: "Lane", type: "number", value: c.lane ?? "" },
        { name: "direction", label: "Direction", type: "select", value: c.direction || "", options: ["", "Northbound", "Southbound", "Eastbound", "Westbound"] },
        { name: "deadline", label: "Deadline", type: "date", value: c.deadline ? c.deadline.slice(0, 10) : "" },
        { name: "location", label: "Location (drag the pin to move)", type: "map", full: true, value: [c.lat, c.lng], roads },
        { name: "description", label: "Description", type: "textarea", full: true, value: c.description || "" },
      ],
      onSubmit: (d) => {
        const body = { ...d }; delete body.location;
        if (d.location && (d.location.lat !== +c.lat.toFixed(6) || d.location.lng !== +c.lng.toFixed(6))) { body.lat = d.location.lat; body.lng = d.location.lng; }
        if (body.deadline === (c.deadline || "").slice(0, 10)) delete body.deadline;
        if (body.severity === c.severity) delete body.severity;
        return api(`/api/cases/${c.id}`, { method: "PATCH", body }).then(done("Case updated."));
      },
    });
  }
  if (act === "delete") {
    openModal({
      title: "Delete case?", eyebrow: c.code,
      fields: [{ type: "html", html: `<p>This permanently removes <b>${esc(c.code)}</b>, its history and photos. To close a case that is not real road damage, set its status to <b>Rejected</b> instead.</p>` }],
      submitLabel: "Delete permanently", danger: true,
      onSubmit: () => api(`/api/cases/${c.id}`, { method: "DELETE" }).then(() => { closeDrawer(); toast("Case deleted."); afterChange(); }),
    });
  }
}

async function newCase() {
  if (!can("createCase")) return toast("Your role cannot create cases.", "error");
  const roads = (mapData || (mapData = await api("/api/stats/map"))).roads;
  if (!vehiclesCache.length) vehiclesCache = (await api("/api/vehicles").catch(() => ({ items: [] }))).items;
  openModal({
    title: "Create damage case", eyebrow: "New inspection", wide: true,
    fields: [
      { name: "location", label: "Location — click the map, or use your current location", type: "map", full: true, roads, required: true, locate: true },
      { name: "photo", label: "Photo (analysed by the AI detector)", type: "file", accept: "image/*", capture: true, full: true },
      { name: "type", label: "Damage type", type: "select", options: meta.types },
      { name: "severity", label: "Severity", type: "select", value: "auto", options: [{ value: "auto", label: "Let AI suggest from photo" }, ...meta.severities] },
      { name: "source", label: "Observation source", type: "select", value: "Field officer", options: meta.sources.filter((s) => s !== "Citizen report") },
      { name: "vehicle", label: "Vehicle ID (if from a vehicle)", type: "text", list: vehiclesCache.map((v) => v.code), showIf: (v) => v.source === "Government bus" || v.source === "Garbage collection" },
      { name: "length_cm", label: "Length (cm, optional)", type: "number" },
      { name: "width_cm", label: "Width (cm, optional)", type: "number" },
      { name: "depth_mm", label: "Depth (mm, optional)", type: "number" },
      { name: "direction", label: "Direction (optional)", type: "select", options: ["", "Northbound", "Southbound", "Eastbound", "Westbound"] },
      { name: "description", label: "Observation notes", type: "textarea", full: true },
    ],
    submitLabel: "Create case", multipart: true,
    onSubmit: async (d, fd) => {
      if (!d.location) throw new Error("Click the map to set the damage location.");
      fd.delete("location"); fd.set("lat", d.location.lat); fd.set("lng", d.location.lng);
      if (d.severity === "auto" && !d.photo) fd.set("severity", "Medium");
      const v = vehiclesCache.find((x) => x.code === String(d.vehicle || "").toUpperCase());
      if (v) { fd.set("vehicle", v.code); fd.set("route", v.route); }
      const c = await api("/api/cases", { method: "POST", body: fd });
      afterChange();
      openDrawer(c.code, c.type, ""); renderCase(c);
      toast(c.ai_status === "Detected" ? `Case ${c.code} created · AI: ${c.ai_summary}` : `Case ${c.code} created.`);
    },
  });
}

// ---------------------------------------------------------------- generic modal
let modalCleanup = [];
function closeModal() {
  $("modalBackdrop").classList.add("hidden");
  modalCleanup.forEach((f) => f()); modalCleanup = [];
}

function openModal({ title, eyebrow, fields, onSubmit, submitLabel = "Save", wide, danger, readOnly }) {
  closeModal();
  $("modalTitle").textContent = title;
  $("modalEyebrow").textContent = eyebrow || "ROADWATCH AI";
  $("modal").classList.toggle("wide", !!wide);
  $("modalError").textContent = "";
  const save = $("modalSave");
  save.textContent = submitLabel; save.disabled = false;
  save.classList.toggle("dangerbtn", !!danger);
  save.classList.toggle("hidden", !!readOnly);
  $("cancel").textContent = readOnly ? "Close" : "Cancel";
  const pickers = {};
  const opt = (o) => (typeof o === "object" ? o : { value: o, label: o || "—" });
  $("fields").innerHTML = fields.map((f, i) => {
    const id = `f_${i}`;
    if (f.type === "html") return `<div class="field full">${f.html}</div>`;
    const req = f.required ? "required" : "";
    let el;
    if (f.type === "select") el = `<select id="${id}" name="${f.name}" ${req}>${f.options.map(opt).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
    else if (f.type === "textarea") el = `<textarea id="${id}" name="${f.name}" ${req} placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea>`;
    else if (f.type === "file") el = `<input id="${id}" name="${f.name}" type="file" accept="${esc(f.accept || "")}" ${req}><div class="filepreview" id="${id}_prev"></div>`;
    else if (f.type === "checkbox") return `<label class="field check full ${f.full ? "full" : ""}" data-fname="${f.name}"><span><input id="${id}" name="${f.name}" type="checkbox" ${f.value ? "checked" : ""}> ${esc(f.label)}</span></label>`;
    else if (f.type === "map") el = `<div class="pickmap" id="${id}"></div><div class="pickinfo"><span id="${id}_info">${f.value ? "" : "No location selected yet."}</span>${f.locate ? `<button type="button" class="secondary small" id="${id}_locate">⌖ Use my location</button>` : ""}</div>`;
    else el = `<input id="${id}" name="${f.name}" type="${f.type || "text"}" value="${esc(f.value ?? "")}" ${req} ${f.list ? `list="${id}_list"` : ""} ${f.type === "number" ? 'step="any" min="0"' : ""} autocomplete="${f.type === "password" ? "new-password" : "off"}">${f.list ? `<datalist id="${id}_list">${f.list.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>` : ""}`;
    return `<label class="field ${f.full ? "full" : ""}" data-fname="${f.name}"><span class="flabel">${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ""}</span>${el}${f.help ? `<small>${esc(f.help)}</small>` : ""}</label>`;
  }).join("");
  $("modalBackdrop").classList.remove("hidden");

  fields.forEach((f, i) => {
    if (f.type === "map" && window.L) {
      const info = $(`f_${i}_info`);
      const p = pickerMap($(`f_${i}`), {
        roads: f.roads, start: f.value,
        onChange: (v, near) => {
          info.innerHTML = `📍 ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)} · ${near && near.d <= 150 ? `on <b>${esc(near.road.name)}</b> (${Math.round(near.d)} m)` : near ? `not on a mapped road (nearest: ${esc(near.road.name)}, ${Math.round(near.d)} m)` : ""}`;
        },
      });
      pickers[f.name] = p;
      modalCleanup.push(() => p.map.remove());
      if (f.locate) $(`f_${i}_locate`).addEventListener("click", (e) => useMyLocation(p, e.currentTarget));
    }
    if (f.type === "file") {
      const input = $(`f_${i}`);
      input.addEventListener("change", () => {
        const file = input.files[0];
        const prev = $(`f_${i}_prev`);
        if (!file) { prev.innerHTML = ""; return; }
        const url = URL.createObjectURL(file);
        prev.innerHTML = `<img src="${url}" alt="Selected photo"><span>${esc(file.name)} · ${(file.size / 1048576).toFixed(1)} MB</span>`;
        modalCleanup.push(() => URL.revokeObjectURL(url));
      });
    }
  });

  const values = () => {
    const fd = new FormData($("modal"));
    const d = {};
    fields.forEach((f) => {
      if (!f.name) return;
      if (f.type === "map") d[f.name] = pickers[f.name] ? pickers[f.name].get() : null;
      else if (f.type === "checkbox") d[f.name] = $("modal").querySelector(`[name="${f.name}"]`).checked;
      else if (f.type === "file") { const file = fd.get(f.name); d[f.name] = file && file.size ? file : null; }
      else d[f.name] = fd.get(f.name);
    });
    return { d, fd };
  };
  const applyVisibility = () => {
    const { d } = values();
    fields.forEach((f) => {
      if (!f.showIf) return;
      const el = $("fields").querySelector(`[data-fname="${f.name}"]`);
      const show = f.showIf(d);
      el.classList.toggle("hidden", !show);
      el.querySelectorAll("input,select,textarea").forEach((x) => (x.disabled = !show));
    });
  };
  applyVisibility();
  $("fields").onchange = applyVisibility;

  $("modal").onsubmit = async (e) => {
    e.preventDefault();
    const { d, fd } = values();
    const missing = fields.find((f) => f.required && !(f.showIf && !f.showIf(d)) && (d[f.name] == null || d[f.name] === ""));
    if (missing) { $("modalError").textContent = `${missing.label.replace(/ —.*/, "")} is required.`; return; }
    // Remove empty file inputs so the server doesn't receive empty parts.
    fields.filter((f) => f.type === "file" && !d[f.name]).forEach((f) => fd.delete(f.name));
    // Drop hidden (showIf=false) fields.
    fields.filter((f) => f.showIf && !f.showIf(d)).forEach((f) => { fd.delete(f.name); delete d[f.name]; });
    save.disabled = true;
    const label = save.textContent;
    save.textContent = d.photo ? "Uploading & analysing…" : "Saving…";
    try { await onSubmit(d, fd); closeModal(); }
    catch (err) { $("modalError").textContent = err.message; }
    finally { save.disabled = false; save.textContent = label; }
  };
  setTimeout(() => { const first = $("fields").querySelector("input:not([type=file]):not([type=checkbox]),select,textarea"); if (first && !fields[0].type?.match(/map|html/)) first.focus(); }, 50);
}

// ---------------------------------------------------------------- vehicles
let vehicleSummary = null;
async function loadVehicles() {
  const r = await api("/api/vehicles");
  vehiclesCache = r.items; vehicleSummary = r.summary;
  $("vTotal").textContent = r.summary.total;
  $("vSplit").textContent = `${r.summary.bus} buses · ${r.summary.garbage} collection vehicles`;
  $("vCov").textContent = `${r.summary.coverage}%`;
  $("vStale").textContent = r.summary.stale;
  renderVehicles();
}

function renderVehicles() {
  const q = $("searchVehicle").value.toLowerCase(), src = $("sourceFilter").value;
  const list = vehiclesCache.filter((v) => (!q || [v.code, v.type, v.operator, v.route, v.area, v.road_name].join(" ").toLowerCase().includes(q)) && (!src || v.type === src));
  $("vehicleCards").innerHTML = list.map((v) => {
    const gc = v.type === "Garbage collection";
    return `<article class="vehicle ${v.status !== "Active" ? "inactive" : ""}">
      <div class="vehiclehead"><div class="vehicleicon ${gc ? "garbage" : ""}">${gc ? "♻" : "▤"}</div><div><b>${esc(v.code)}</b><small>${esc(v.type)}${v.status !== "Active" ? " · inactive" : ""}</small></div></div>
      <div class="vehstats"><div><b>${v.cases}</b><small>Linked cases (${v.open_cases} open)</small></div><div><b>${v.coverage}%</b><small>Route coverage</small></div></div>
      <p><b>${esc(v.route || "—")}</b><br>${esc(v.operator || "—")}<br>Main road: ${esc(v.road_name || "—")} · ${esc(v.area)}<br>Last seen: ${timeAgo(v.last_seen)}<br>Last detection: ${v.last_detection ? fmtDate(v.last_detection) : "—"}</p>
      <div class="cardbtns"><button class="rowbtn" data-vcases="${esc(v.code)}">View cases ↗</button>${can("manageVehicles") ? `<button class="rowbtn" data-vedit="${v.id}">Edit</button>` : ""}</div>
    </article>`;
  }).join("") || `<p class="empty">No vehicles match.</p>`;
  $("vehicleCards").querySelectorAll("[data-vcases]").forEach((b) => b.addEventListener("click", () => go("cases", { filters: { q: b.dataset.vcases } })));
  $("vehicleCards").querySelectorAll("[data-vedit]").forEach((b) => b.addEventListener("click", () => editVehicle(vehiclesCache.find((v) => v.id === +b.dataset.vedit))));
}

async function editVehicle(v) {
  const roads = await api("/api/vehicles/roads");
  openModal({
    title: v ? `Edit ${v.code}` : "Add vehicle", eyebrow: "Observation source",
    fields: [
      { name: "code", label: "Vehicle ID", value: v?.code || "", required: true },
      { name: "type", label: "Type", type: "select", value: v?.type, options: ["Government bus", "Garbage collection"] },
      { name: "operator", label: "Operator", value: v?.operator || "" },
      { name: "route", label: "Route name", value: v?.route || "" },
      { name: "road_id", label: "Main road on route", type: "select", value: v?.road_id || "", options: roads.map((r) => ({ value: r.id, label: `${r.name} · ${r.area}` })), required: true },
      { name: "coverage", label: "Route coverage (%)", type: "number", value: v?.coverage ?? 0 },
      { name: "status", label: "Status", type: "select", value: v?.status || "Active", options: ["Active", "Inactive"] },
    ],
    onSubmit: async (d) => {
      await api(v ? `/api/vehicles/${v.id}` : "/api/vehicles", { method: v ? "PUT" : "POST", body: d });
      toast(v ? "Vehicle updated." : "Vehicle added."); mapData = null; loadVehicles();
    },
  });
}

// ---------------------------------------------------------------- analytics
async function loadAnalytics() {
  const a = await api("/api/stats/analytics");
  $("aRepeat").textContent = n0(a.repeat);
  $("aAwaiting").textContent = n0(a.awaiting);
  $("aSla").textContent = a.slaMet == null ? "–" : `${a.slaMet}%`;
  $("aSlaNote").textContent = a.avgRepairDays == null ? "No verified repairs yet" : `Average ${a.avgRepairDays} days to verified repair`;
  $("aExc").textContent = n0(a.excavation);
  lineChart($("chart2"), a.trend.labels, [{ name: "New damage cases", values: a.trend.created, color: "#4975e8" }, { name: "Verified repairs", values: a.trend.resolved, color: "#23a57e" }]);
  const max = Math.max(1, ...a.typeCounts.map((x) => x.n));
  $("typeBars").innerHTML = a.typeCounts.sort((x, y) => y.n - x.n).map((x) => `<div class="clickable" data-type="${esc(x.type)}"><div class="barlabel"><span>${esc(x.type)}</span><b>${x.n}</b></div><div class="bar"><i style="width:${(x.n / max) * 100}%"></i></div></div>`).join("");
  $("typeBars").querySelectorAll("[data-type]").forEach((el) => el.addEventListener("click", () => go("cases", { filters: { type: el.dataset.type } })));
  $("wards").innerHTML = a.wards.map((w) => `<tr><td><b>${esc(w.area)}</b></td><td>${w.valid}</td><td>${w.critical ? `<span class="red">${w.critical}</span>` : 0}</td><td>${w.overdue ? `<span class="orange">${w.overdue}</span>` : 0}</td><td>${w.resolved}</td>
    <td>${w.coverage == null ? '<span class="muted">No vehicle data</span>' : `${w.coverage}% <div class="bar"><i style="width:${w.coverage}%"></i></div>`}</td></tr>`).join("");
}

// ---------------------------------------------------------------- teams
let teamsData = null;
async function loadTeams() {
  teamsData = await api("/api/stats/teams");
  teamsCache = teamsData.teams;
  $("tDepts").textContent = teamsData.departments;
  $("tTeams").textContent = teamsData.repairTeams;
  $("tAwait").textContent = teamsData.awaitingAssignment;
  const manage = can("manageTeams");
  $("teamCards").innerHTML = teamsData.teams.map((t) => `<article class="team">
      <small>${t.kind === "Department" ? "DEPARTMENT" : "REPAIR TEAM"}</small><h3>${esc(t.name)}</h3>
      <p>${esc(t.responsibility || "—")}<br>Lead: ${esc(t.lead || "—")}${t.kind === "Repair team" ? ` · ${t.members} user${t.members === 1 ? "" : "s"}` : ""}</p>
      <div class="teamstats"><div><b>${t.assigned}</b><small>Open</small></div><div><b class="red">${t.overdue}</b><small>Overdue</small></div><div><b class="green">${t.verified}</b><small>Verified</small></div></div>
      <div class="cardbtns">${t.kind === "Repair team" ? `<button class="rowbtn" data-tcases="${t.id}">View cases ↗</button>` : ""}${manage ? `<button class="rowbtn" data-tedit="${t.id}">Edit</button>` : ""}</div>
    </article>`).join("");
  $("teamCards").querySelectorAll("[data-tedit]").forEach((b) => b.addEventListener("click", () => editTeam(teamsData.teams.find((t) => t.id === +b.dataset.tedit))));
  $("teamCards").querySelectorAll("[data-tcases]").forEach((b) => b.addEventListener("click", () => {
    const t = teamsData.teams.find((x) => x.id === +b.dataset.tcases);
    go("cases", { filters: { team_id: t.id, open: "1" }, label: t.name });
  }));
  $("queueNote").textContent = `${teamsData.queueTotal} open case${teamsData.queueTotal === 1 ? "" : "s"} with unknown responsibility or unconfirmed excavation permits`;
  $("responsibility").innerHTML = teamsData.queue.map((c) => `<div class="review"><div><b>${esc(c.code)} · ${esc(c.road)}</b> ${sevPill(c.severity)}<p>${esc(c.cause)} · Permit: ${esc(c.permit)} · Responsibility: ${esc(c.responsibility)}</p></div><button class="rowbtn" data-open="${c.id}">Review case ↗</button></div>`).join("") || `<p class="empty">Nothing waiting for review.</p>`;
  bindOpen($("responsibility"));
}

function editTeam(t) {
  openModal({
    title: t ? `Edit ${t.name}` : "Add team or department", eyebrow: "Responsibility",
    fields: [
      { name: "name", label: "Name", value: t?.name || "", required: true, full: true },
      { name: "kind", label: "Type", type: "select", value: t?.kind || "Repair team", options: ["Repair team", "Department"], help: "Repair teams receive case assignments; departments own cases through the responsibility field." },
      { name: "lead", label: "Lead / contact", value: t?.lead || "" },
      { name: "responsibility", label: "Area / responsibility", value: t?.responsibility || "", full: true },
      ...(t ? [{ type: "html", html: `<p class="sectionnote nopad">Teams can be deleted only when they have no open cases and no users. <button type="button" class="link danger" id="delTeam">Delete this team</button></p>` }] : []),
    ],
    onSubmit: async (d) => {
      await api(t ? `/api/teams/${t.id}` : "/api/teams", { method: t ? "PUT" : "POST", body: d });
      toast(t ? "Team updated." : "Team added."); teamsCache = await api("/api/teams"); loadTeams();
    },
  });
  if (t) $("delTeam").addEventListener("click", async () => {
    try { await api(`/api/teams/${t.id}`, { method: "DELETE" }); closeModal(); toast("Team deleted."); teamsCache = await api("/api/teams"); loadTeams(); }
    catch (e) { $("modalError").textContent = e.message; }
  });
}

// ---------------------------------------------------------------- users
let usersCache = [];
async function loadUsers() {
  usersCache = await api("/api/users");
  if (!teamsCache.length) teamsCache = await api("/api/teams");
  renderUsers(); loadSystem();
}

function renderUsers() {
  const q = $("searchUser").value.toLowerCase(), r = $("roleFilter").value;
  const list = usersCache.filter((u) => (!q || [u.name, u.email, u.department, u.area, u.team_name].join(" ").toLowerCase().includes(q)) && (!r || u.role === r));
  $("userCount").textContent = `${list.length} user${list.length === 1 ? "" : "s"}`;
  $("userRows").innerHTML = list.map((u) => `<tr>
      <td><strong>${esc(u.name)}${u.id === me.id ? ' <span class="demo-chip">you</span>' : ""}</strong><small>RWU-${String(u.id).padStart(4, "0")}</small></td>
      <td>${esc(u.email)}</td><td>${esc(u.role)}</td>
      <td><strong>${esc(u.team_name || u.department || "—")}</strong><small>${esc(u.area || "")}</small></td>
      <td><span class="pill ${u.status === "Active" ? "low" : "high"}">${esc(u.status)}</span></td>
      <td>${timeAgo(u.last_active)}</td>
      <td><button class="rowbtn" data-uedit="${u.id}">Edit</button> ${u.id !== me.id ? `<button class="rowbtn" data-utoggle="${u.id}">${u.status === "Active" ? "Deactivate" : "Activate"}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No users found.</td></tr>`;
  $("userRows").querySelectorAll("[data-uedit]").forEach((b) => b.addEventListener("click", () => editUser(usersCache.find((u) => u.id === +b.dataset.uedit))));
  $("userRows").querySelectorAll("[data-utoggle]").forEach((b) => b.addEventListener("click", async () => {
    try { const u = await api(`/api/users/${b.dataset.utoggle}/toggle`, { method: "POST" }); toast(`${u.name} is now ${u.status.toLowerCase()}.`); loadUsers(); }
    catch (e) { toast(e.message, "error"); }
  }));
}

function editUser(u) {
  const repairTeams = teamsCache.filter((t) => t.kind === "Repair team");
  openModal({
    title: u ? `Edit ${u.name}` : "Create new user", eyebrow: "User account",
    fields: [
      { name: "name", label: "Full name", value: u?.name || "", required: true },
      { name: "email", label: "Email address", type: "email", value: u?.email || "", required: true },
      { name: "role", label: "Role", type: "select", value: u?.role || "Municipal Officer", options: meta.roles },
      { name: "team_id", label: "Repair team", type: "select", value: u?.team_id || "", options: repairTeams.map((t) => ({ value: t.id, label: t.name })), showIf: (v) => v.role === "Repair Team", required: true },
      { name: "department", label: "Department", value: u?.department || "" },
      { name: "area", label: "Assigned ward / area", value: u?.area || "" },
      { name: "password", label: u ? "New password (leave blank to keep)" : "Password", type: "password", required: !u, help: "At least 6 characters." },
    ],
    onSubmit: async (d) => {
      if (u && !d.password) delete d.password;
      await api(u ? `/api/users/${u.id}` : "/api/users", { method: u ? "PUT" : "POST", body: d });
      toast(u ? "User updated." : "User created."); loadUsers();
    },
  });
}

function editProfile() {
  $("menu").classList.add("hidden");
  openModal({
    title: "My profile", eyebrow: me.role,
    fields: [
      { name: "name", label: "Full name", value: me.name, required: true },
      { name: "email", label: "Email", type: "email", value: me.email, required: true },
      { name: "department", label: "Department", value: me.department || "" },
      { name: "area", label: "Area", value: me.area || "" },
    ],
    onSubmit: async (d) => {
      const u = await api("/api/auth/me", { method: "PUT", body: d });
      Object.assign(me, u); $("userName").textContent = me.name; $("avatar").textContent = initials(me.name); toast("Profile updated.");
    },
  });
}

function changePassword() {
  $("menu").classList.add("hidden");
  openModal({
    title: "Change password", eyebrow: me.email,
    fields: [
      { name: "current_password", label: "Current password", type: "password", required: true, full: true },
      { name: "new_password", label: "New password", type: "password", required: true, help: "At least 6 characters." },
      { name: "confirm", label: "Confirm new password", type: "password", required: true },
    ],
    onSubmit: async (d) => {
      if (d.new_password !== d.confirm) throw new Error("The new passwords do not match.");
      await api("/api/auth/me", { method: "PUT", body: { current_password: d.current_password, new_password: d.new_password } });
      toast("Password changed.");
    },
  });
}

// ---------------------------------------------------------------- system / notifications
async function refreshSystemBadge() {
  try {
    const s = await api("/api/system");
    $("aiDot").className = s.detector.ok ? "on" : "off";
    $("aiLabel").textContent = s.detector.ok ? "AI detector online" : "AI detector offline";
    $("aiSub").textContent = s.detector.ok ? s.detector.model : "Photos saved without analysis";
    $("demoTag").classList.toggle("hidden", !s.synthetic);
    return s;
  } catch { return null; }
}

async function loadSystem() {
  const s = await refreshSystemBadge();
  if (!s) return;
  $("systemPanel").innerHTML = `
    <div class="sysrow"><div><b>AI detector</b><p>${s.detector.ok ? `Online · ${esc(s.detector.model)} · classes: ${esc((s.detector.classes || []).join(", "))}` : `Offline — ${esc(s.detector.reason || s.detector.detail || "")}. Start it with the start script; new photos are stored and can be re-analysed later.`}</p></div><span class="pill ${s.detector.ok ? "low" : "high"}">${s.detector.ok ? "Online" : "Offline"}</span></div>
    <div class="sysrow"><div><b>Road geometry</b><p>${s.roads.osm} road${s.roads.osm === 1 ? "" : "s"} from OpenStreetMap, ${s.roads.illustrative} illustrative. Run <code>npm run fetch-roads</code> with internet, then reload.</p></div><button class="secondary" id="reloadRoads">Reload road geometry</button></div>
    <div class="sysrow"><div><b>Demo data</b><p>${s.synthetic.toLocaleString("en-IN")} synthetic demo cases · ${s.real.toLocaleString("en-IN")} real cases.</p></div>${s.synthetic ? `<button class="secondary dangerout" id="removeDemo">Remove demo cases</button>` : `<span class="pill low">None</span>`}</div>`;
  $("reloadRoads").addEventListener("click", async () => {
    try { const r = await api("/api/system/reload-roads", { method: "POST" }); toast(`Road geometry reloaded · ${r.osmRoads} OpenStreetMap roads.`); mapData = null; loadSystem(); }
    catch (e) { toast(e.message, "error"); }
  });
  if ($("removeDemo")) $("removeDemo").addEventListener("click", () => openModal({
    title: "Remove all demo cases?", eyebrow: "System",
    fields: [{ type: "html", html: `<p>This permanently deletes the <b>${s.synthetic}</b> synthetic demo cases. Real cases, users, teams and vehicles stay. To get demo data back later, delete <code>data/roadwatch.db</code> and restart.</p>` }],
    submitLabel: "Remove demo cases", danger: true,
    onSubmit: async () => { const r = await api("/api/system/remove-demo-cases", { method: "POST" }); toast(`${r.removed} demo cases removed.`); mapData = null; loadSystem(); updateOpenBadge(); },
  }));
}

async function refreshNotifications() {
  try {
    const items = await api("/api/stats/notifications");
    $("notifyCount").textContent = items.length;
    $("notifyCount").classList.toggle("hidden", !items.length);
    const icon = { critical: "🔴", warn: "🟠", info: "🔵" };
    $("notifyList").innerHTML = items.map((n) => `<button class="notifyitem" data-code="${esc(n.code)}">${icon[n.level]} ${esc(n.text)}<small>${esc(n.code)} · ${timeAgo(n.at)}</small></button>`).join("") || `<p class="empty">You're all caught up.</p>`;
    $("notifyList").querySelectorAll("[data-code]").forEach((b) => b.addEventListener("click", () => { $("notifyPanel").classList.add("hidden"); openCase(b.dataset.code); }));
  } catch { /* ignore */ }
}

function aboutSystem() {
  openModal({
    title: "About RoadWatch AI", eyebrow: "System notes", readOnly: true,
    fields: [{ type: "html", html: `
      <p><b>What's real:</b> sign-in with hashed passwords and role permissions, a SQLite database, photo uploads, YOLOv8 pothole detection on uploaded photos, the case workflow (report → review → assign → repair → verify), citizen reports, CSV/PDF exports and live analytics.</p>
      <p><b>Demo data:</b> records marked <span class="demo-chip">demo</span> are synthetic (1,500 seeded cases, vehicle coverage figures). Administrators can remove them under User Management → System.</p>
      <p><b>AI:</b> severity from the detector is a triage suggestion based on how much of the photo the damage covers. Depth and real-world size cannot be measured reliably from one photo — enter measurements on site.</p>
      <p><b>Roads:</b> map overlays follow OpenStreetMap road centre-lines once fetched (© OpenStreetMap contributors); otherwise illustrative lines are shown dashed.</p>
      <p><b>Not included:</b> live GPS/camera feeds from vehicles, government permit databases, email/SMS notifications.</p>` }],
  });
}
