// Citizen report + tracking page (no sign-in).
"use strict";

let picker = null, roads = [];
const FLOW = ["Reported", "Under Review", "Confirmed", "Assigned", "In Repair", "Awaiting Verification", "Resolved"];

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
  try {
    const info = await api("/api/public/info");
    $("dtype").innerHTML = info.types.map((t) => `<option ${t === "Pothole" ? "selected" : ""}>${esc(t)}</option>`).join("");
    roads = info.roads;
  } catch (e) { $("formError").textContent = e.message; }
  // Road list from the public endpoint has anchor points only; draw no lines.
  picker = window.L ? pickerMap($("pickMap"), {
    onChange: (v) => { $("locInfo").textContent = `📍 ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`; },
  }) : null;
  $("locateBtn").addEventListener("click", (e) => picker && useMyLocation(picker, e.currentTarget));

  $("photo").addEventListener("change", () => {
    const f = $("photo").files[0];
    if (!f) return;
    $("photoPreview").src = URL.createObjectURL(f);
    $("photoPreview").classList.remove("hidden");
    $("photoEmpty").classList.add("hidden");
  });

  $("reportForm").addEventListener("submit", submitReport);
  $("another").addEventListener("click", () => {
    $("reportForm").reset(); $("photoPreview").classList.add("hidden"); $("photoEmpty").classList.remove("hidden");
    $("result").classList.add("hidden"); $("reportForm").classList.remove("hidden");
    window.scrollTo(0, 0);
  });
  $("trackThis").addEventListener("click", () => { $("trackCode").value = $("resCode").textContent; tab("trackTab"); track(); });
  $("trackForm").addEventListener("submit", (e) => { e.preventDefault(); track(); });

  const q = new URLSearchParams(location.search).get("track");
  if (q) { $("trackCode").value = q; tab("trackTab"); track(); }
});

function tab(id) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  $("reportTab").classList.toggle("hidden", id !== "reportTab");
  $("trackTab").classList.toggle("hidden", id !== "trackTab");
  if (id === "reportTab" && picker) setTimeout(() => picker.map.invalidateSize(), 50);
}

async function submitReport(e) {
  e.preventDefault();
  const err = $("formError"); err.textContent = "";
  const file = $("photo").files[0];
  const loc = picker && picker.get();
  if (!file) return (err.textContent = "Please add a photo of the damage.");
  if (file.size > 8 * 1048576) return (err.textContent = "That photo is larger than 8 MB. Please choose a smaller one.");
  if (!loc) return (err.textContent = "Please mark the location on the map.");
  if (!$("consent").checked) return (err.textContent = "Please confirm the report is accurate.");
  const fd = new FormData($("reportForm"));
  fd.set("lat", loc.lat); fd.set("lng", loc.lng);
  const btn = $("submitBtn");
  btn.disabled = true; btn.textContent = "Uploading & checking photo…";
  try {
    const r = await api("/api/public/reports", { method: "POST", body: fd });
    showResult(r, file);
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; btn.textContent = "Send report"; }
}

function showResult(r, file) {
  $("reportForm").classList.add("hidden");
  $("result").classList.remove("hidden");
  $("resCode").textContent = r.code;
  $("resPhoto").innerHTML = `<div class="evidence-photo">${photoWithBoxes(URL.createObjectURL(file), r.detections)}<div class="photo-caption">${
    r.ai_status === "Detected" ? `AI found ${r.detections.length} damaged area${r.detections.length === 1 ? "" : "s"} (boxes shown).`
      : r.ai_status === "No damage detected" ? "The AI did not find damage in this photo — a staff member will still review it."
        : "Automatic photo check isn't available right now — a staff member will review your photo."}</div></div>`;
  const d = (a, b) => `<div class="detail"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;
  $("resDetails").innerHTML = d("Status", r.status) + d("Location", `${r.road} · ${r.area}`) + d("Initial priority", r.severity) + d("Photo check", r.ai_status);
  $("resNote").textContent = "Priority is a first estimate from the photo; road officers confirm it during review.";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function track() {
  const code = $("trackCode").value.trim().toUpperCase();
  $("trackError").textContent = ""; $("trackResult").innerHTML = "";
  if (!code) return;
  try {
    const c = await api(`/api/public/track/${encodeURIComponent(code)}`);
    const step = c.status === "Rejected" ? -1 : c.status === "Needs Rework" ? 4 : FLOW.indexOf(c.status);
    $("trackResult").innerHTML = `
      <div class="record-summary"><div><small>${esc(c.code)}</small><h2>${esc(c.type)}</h2><p>⌖ ${esc(c.road)} — ${esc(c.area)} · reported ${fmtDate(c.created_at)}</p></div><span class="pill statuspill">${esc(c.status)}</span></div>
      ${c.status === "Rejected" ? `<div class="aibox warn"><b>Closed without repair</b><p>On review, staff decided this report did not need road repair work.</p></div>` :
        `<ol class="cz-progress">${["Reported", "Under review", "Repair scheduled", "Being repaired", "Repaired & verified"].map((label, i) => {
          const at = [0, 1, 3, 4, 6][i];
          return `<li class="${step >= at ? "done" : ""}">${label}</li>`;
        }).join("")}</ol>`}
      <div class="section"><h3>History</h3><div class="timeline">${c.events.map((e) => `<div class="tl"><b>${esc(e.title)}</b><p>${fmtDate(e.created_at, true)}</p></div>`).join("")}</div></div>`;
  } catch (ex) { $("trackError").textContent = ex.message; }
}
