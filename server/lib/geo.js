// Small geometry helpers. Coordinates are [lat, lng]. Distances are in metres,
// using a local equirectangular projection (accurate enough at city scale).
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function project(p, origin) {
  const x = toRad(p[1] - origin[1]) * Math.cos(toRad(origin[0])) * R;
  const y = toRad(p[0] - origin[0]) * R;
  return [x, y];
}

function unproject(xy, origin) {
  const lat = origin[0] + (xy[1] / R) * (180 / Math.PI);
  const lng = origin[1] + (xy[0] / (R * Math.cos(toRad(origin[0])))) * (180 / Math.PI);
  return [lat, lng];
}

// Nearest point on a polyline to p. Returns { point, distance, segment, t }.
function nearestOnLine(p, line) {
  let best = { point: line[0], distance: Infinity, segment: 0, t: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = project(line[i], p), b = project(line[i + 1], p);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(a[0] * dx + a[1] * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(q[0], q[1]);
    if (d < best.distance) best = { point: unproject(q, p), distance: d, segment: i, t };
  }
  return best;
}

function lineLength(line) {
  let L = 0;
  for (let i = 0; i < line.length - 1; i++) L += haversine(line[i], line[i + 1]);
  return L;
}

// Point at fraction f (0..1) of the way along a polyline.
function pointAlong(line, f) {
  const total = lineLength(line);
  let target = total * Math.max(0, Math.min(1, f));
  for (let i = 0; i < line.length - 1; i++) {
    const seg = haversine(line[i], line[i + 1]);
    if (target <= seg || i === line.length - 2) {
      const t = seg ? Math.min(1, target / seg) : 0;
      return {
        point: [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t],
        segment: i,
      };
    }
    target -= seg;
  }
  return { point: line[line.length - 1], segment: line.length - 2 };
}

module.exports = { haversine, nearestOnLine, lineLength, pointAlong };
