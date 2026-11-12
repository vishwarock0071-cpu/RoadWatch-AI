// The 24 Chennai road anchors used by the app.
// `osm` is a regular expression matched against OpenStreetMap road names when
// scripts/fetch-roads.js pulls real centre-line geometry.
const fs = require("fs");
const path = require("path");

const ANCHORS = [
  { name: "Anna Salai", area: "Teynampet", lat: 13.0418, lng: 80.2482, osm: "anna salai|mount road" },
  { name: "Poonamallee High Road", area: "Kilpauk", lat: 13.0827, lng: 80.2391, osm: "poonamallee high road|periyar e\\.?v\\.?r|evr periyar" },
  { name: "Velachery Main Road", area: "Velachery", lat: 12.9815, lng: 80.2209, osm: "velachery main road|velachery road|velachery tambaram" },
  { name: "Arcot Road", area: "Vadapalani", lat: 13.0502, lng: 80.2121, osm: "arcot road|n\\.?s\\.?k\\.? salai" },
  { name: "ECR Link Road", area: "Thiruvanmiyur", lat: 12.9856, lng: 80.2594, osm: "east coast road|kamarajar salai|ecr|lattice bridge" },
  { name: "GST Road", area: "Guindy", lat: 13.0067, lng: 80.2206, osm: "grand southern trunk|gst road|anna salai" },
  { name: "Perambur High Road", area: "Perambur", lat: 13.1131, lng: 80.2335, osm: "perambur high road|perambur barracks" },
  { name: "OMR", area: "Sholinganallur", lat: 12.9002, lng: 80.2279, osm: "rajiv gandhi salai|old mahabalipuram|omr" },
  { name: "T Nagar Main Road", area: "T Nagar", lat: 13.0411, lng: 80.2337, osm: "usman road|thyagaraya road|venkatanarayana|g\\.?n\\.? chetty" },
  { name: "Mylapore Road", area: "Mylapore", lat: 13.0335, lng: 80.2697, osm: "luz church|kutchery|radhakrishnan salai|royapettah high|santhome" },
  { name: "Ambattur Industrial Road", area: "Ambattur", lat: 13.1142, lng: 80.1544, osm: "ambattur|red hills|ct?h road|madras thiruvallur" },
  { name: "Adyar Bridge Road", area: "Adyar", lat: 13.0064, lng: 80.2561, osm: "adyar bridge|sardar patel|lattice bridge|gandhi nagar" },
  { name: "Medavakkam Road", area: "Medavakkam", lat: 12.9224, lng: 80.192, osm: "medavakkam|velachery tambaram" },
  { name: "Kolathur Main Road", area: "Kolathur", lat: 13.1242, lng: 80.213, osm: "kolathur|red hills|paper mills" },
  { name: "Royapettah High Road", area: "Royapettah", lat: 13.0554, lng: 80.263, osm: "royapettah high|peters road|lloyds road|avvai shanmugam" },
  { name: "Thoraipakkam Road", area: "Thoraipakkam", lat: 12.9411, lng: 80.2367, osm: "rajiv gandhi salai|old mahabalipuram|thoraipakkam|pallavaram.?thoraipakkam" },
  { name: "Nungambakkam High Road", area: "Nungambakkam", lat: 13.0604, lng: 80.2428, osm: "nungambakkam high|uthamar gandhi|sterling road" },
  { name: "Mogappair Road", area: "Mogappair", lat: 13.0837, lng: 80.1769, osm: "mogappair|jawaharlal nehru|100 feet road|inner ring" },
  { name: "Pallavaram Road", area: "Pallavaram", lat: 12.9675, lng: 80.1491, osm: "grand southern trunk|gst road|pallavaram|radial road" },
  { name: "Washermanpet Road", area: "Washermanpet", lat: 13.1124, lng: 80.2873, osm: "ennore high|thiruvottiyur high|tiruvottiyur high|g\\.?a\\.? road|old washermenpet" },
  { name: "Porur Main Road", area: "Porur", lat: 13.0358, lng: 80.1585, osm: "mount poonamallee|arcot road|porur|kundrathur" },
  { name: "Besant Avenue", area: "Adyar", lat: 13.0068, lng: 80.2577, osm: "besant avenue|lattice bridge|m\\.?g\\.? road|kasturba" },
  { name: "Thirumangalam Road", area: "Anna Nagar", lat: 13.0845, lng: 80.205, osm: "thirumangalam|2nd avenue|second avenue|jawaharlal nehru|inner ring|100 feet" },
  { name: "Koyambedu Market Road", area: "Koyambedu", lat: 13.0694, lng: 80.1948, osm: "koyambedu|jawaharlal nehru|100 feet road|inner ring|market road" },
];

// Illustrative fallback geometry (same shape as the original prototype),
// used only when real OpenStreetMap geometry has not been fetched.
function illustrativePath(r, i) {
  const angle = ((i * 37) % 180) * Math.PI / 180;
  const scale = 0.0022 + (i % 4) * 0.00035;
  const bend = i % 2 ? 1 : -1;
  return Array.from({ length: 7 }, (_, j) => {
    const t = (j - 3) / 3;
    const curve = Math.sin((j / 6) * Math.PI) * scale * 0.38 * bend;
    return [
      +(r.lat + Math.sin(angle) * t * scale + curve * Math.cos(angle)).toFixed(6),
      +(r.lng + Math.cos(angle) * t * scale - curve * Math.sin(angle)).toFixed(6),
    ];
  });
}

const OSM_FILE = path.join(__dirname, "..", "..", "data", "roads.osm.json");

// Returns the anchor list with geometry attached: real OSM geometry where the
// fetch script found a match, illustrative geometry otherwise.
function loadRoadGeometry() {
  let osm = {};
  try { osm = JSON.parse(fs.readFileSync(OSM_FILE, "utf8")).roads || {}; } catch { /* not fetched yet */ }
  return ANCHORS.map((r, i) => {
    const hit = osm[r.name];
    if (hit && Array.isArray(hit.geometry) && hit.geometry.length >= 2) {
      return { ...r, geometry: hit.geometry, geometry_source: "osm", osm_name: hit.osm_name || null };
    }
    return { ...r, geometry: illustrativePath(r, i), geometry_source: "illustrative", osm_name: null };
  });
}

module.exports = { ANCHORS, loadRoadGeometry, illustrativePath, OSM_FILE };
