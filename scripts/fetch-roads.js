#!/usr/bin/env node
// Fetches real road centre-line geometry for the 24 Chennai road anchors from
// OpenStreetMap (Overpass API) and saves it to data/roads.osm.json.
// The app then draws severity overlays along the real roads and snaps new
// reports to them. Run with internet access:  npm run fetch-roads
//
// Road data © OpenStreetMap contributors, available under the ODbL.
const fs = require("fs");
const path = require("path");
const { ANCHORS, OSM_FILE } = require("../server/lib/roads");
const { haversine, nearestOnLine } = require("../server/lib/geo");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const RADIUS = 1400;          // search radius around each anchor (m)
const MAX_LEN = 2600;         // longest stretch to keep (m)
const MAJOR = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(query),
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "RoadWatchAI/1.0 (student project)" },
          signal: AbortSignal.timeout(45000),
        });
        if (r.status === 429 || r.status === 504) { await sleep(4000); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
  }
  throw lastErr || new Error("Overpass unavailable");
}

// Chooses the named road nearest the anchor and chains connected ways with the
// same name into one polyline, trimmed to a stretch around the anchor.
function buildLine(anchor, ways) {
  const re = new RegExp(anchor.osm, "i");
  const withGeom = ways.filter((w) => w.geometry && w.geometry.length > 1 && w.nodes);
  let pool = withGeom.filter((w) => re.test(w.tags.name || "") || re.test(w.tags["name:en"] || "") || re.test(w.tags.ref || ""));
  let matchedBy = "name";
  if (!pool.length) { pool = withGeom.filter((w) => MAJOR.test(w.tags.highway)); matchedBy = "nearest major road"; }
  if (!pool.length) return null;

  const pt = [anchor.lat, anchor.lng];
  const line = (w) => w.geometry.map((g) => [g.lat, g.lon]);
  const dist = (w) => nearestOnLine(pt, line(w)).distance;
  const start = pool.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
  const name = start.tags.name || start.tags.ref || "";
  const same = pool.filter((w) => (w.tags.name || w.tags.ref || "") === name);

  // Chain: extend the head and tail through ways that share an end node.
  let nodes = [...start.nodes], coords = line(start);
  const used = new Set([start.id]);
  const extend = (atEnd) => {
    for (let guard = 0; guard < 40; guard++) {
      const endNode = atEnd ? nodes[nodes.length - 1] : nodes[0];
      const next = same.find((w) => !used.has(w.id) && (w.nodes[0] === endNode || w.nodes[w.nodes.length - 1] === endNode));
      if (!next) return;
      used.add(next.id);
      let n = [...next.nodes], c = line(next);
      const forward = atEnd ? n[0] === endNode : n[n.length - 1] === endNode;
      if (!forward) { n.reverse(); c.reverse(); }
      if (atEnd) { nodes = nodes.concat(n.slice(1)); coords = coords.concat(c.slice(1)); }
      else { nodes = n.slice(0, -1).concat(nodes); coords = c.slice(0, -1).concat(coords); }
    }
  };
  extend(true); extend(false);

  // Trim to points within RADIUS of the anchor, then cap total length.
  let kept = coords.filter((c) => haversine(c, pt) <= RADIUS);
  if (kept.length < 2) kept = coords;
  const near = nearestOnLine(pt, kept).segment;
  let lo = near, hi = near + 1, len = haversine(kept[lo], kept[hi] || kept[lo]);
  while (len < MAX_LEN && (lo > 0 || hi < kept.length - 1)) {
    if (hi < kept.length - 1) { len += haversine(kept[hi], kept[hi + 1]); hi++; }
    if (lo > 0 && len < MAX_LEN) { len += haversine(kept[lo - 1], kept[lo]); lo--; }
  }
  const geometry = kept.slice(lo, hi + 1).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]);
  if (geometry.length < 2) return null;
  return { osm_name: name, matched_by: matchedBy, length_m: Math.round(len), geometry };
}

async function main() {
  const out = { fetched_at: new Date().toISOString(), attribution: "© OpenStreetMap contributors (ODbL)", roads: {} };
  let ok = 0;
  for (const a of ANCHORS) {
    const q = `[out:json][timeout:30];way(around:${RADIUS},${a.lat},${a.lng})["highway"]["highway"!~"footway|path|cycleway|service|steps|pedestrian|track|construction|proposed"];out geom;`;
    try {
      const data = await overpass(q);
      const res = buildLine(a, (data.elements || []).map((w) => ({ ...w, tags: w.tags || {} })));
      if (res) {
        out.roads[a.name] = res; ok++;
        console.log(`✓ ${a.name.padEnd(26)} → ${res.osm_name || "(unnamed)"} · ${res.length_m} m · ${res.matched_by}`);
      } else console.log(`· ${a.name.padEnd(26)} → no suitable road found, keeping illustrative line`);
    } catch (e) {
      console.log(`✗ ${a.name.padEnd(26)} → ${e.message}`);
      // If nothing has worked after three roads, the network is likely offline.
      if (!ok && ANCHORS.indexOf(a) >= 2) break;
    }
    await sleep(1200); // be polite to the public Overpass servers
  }
  if (!ok) {
    console.log("\nCould not reach OpenStreetMap. The app will keep using illustrative road lines.");
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(OSM_FILE), { recursive: true });
  fs.writeFileSync(OSM_FILE, JSON.stringify(out));
  console.log(`\nSaved ${ok}/${ANCHORS.length} roads to ${path.relative(process.cwd(), OSM_FILE)}`);

  // Apply to an existing database right away (new databases pick it up when created).
  const config = require("../server/config");
  if (fs.existsSync(config.dbFile)) {
    const db = require("../server/db");
    const { refreshRoadGeometry } = require("../server/seed");
    refreshRoadGeometry(db);
    console.log("Database updated with real road geometry. Restart the server if it is running.");
  }
}

if (require.main === module) main();
module.exports = { buildLine };
