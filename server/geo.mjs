// @generated
// 路线相关几何计算：距离、折线累计、采样、走廊多边形
const EARTH = 6371000;

export function meters(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 110540;
  return Math.hypot(dx, dy);
}

export function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + meters(points[i - 1], points[i]));
  return cum;
}

// 点到折线的最近距离（米）
export function distanceToPolyline(points, point) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const latRad = (a[1] * Math.PI) / 180;
    const kx = 111320 * Math.cos(latRad);
    const ky = 110540;
    const ax = a[0] * kx;
    const ay = a[1] * ky;
    const bx = b[0] * kx;
    const by = b[1] * ky;
    const px = point[0] * kx;
    const py = point[1] * ky;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
    const dx = px - (ax + vx * t);
    const dy = py - (ay + vy * t);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

// 沿折线按里程均匀取最多 count 个点（含起终点）
export function sampleEvenly(points, count) {
  if (points.length <= count) return points.slice();
  const cum = cumulative(points);
  const total = cum[cum.length - 1];
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    const target = (total * i) / (count - 1);
    let index = 1;
    while (index < cum.length - 1 && cum[index] < target) index += 1;
    const segStart = cum[index - 1];
    const segLen = cum[index] - segStart || 1;
    const t = Math.max(0, Math.min(1, (target - segStart) / segLen));
    const a = points[index - 1];
    const b = points[index];
    samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return samples;
}

function offsetPoint(point, bearingRad, distanceMeters) {
  const latRad = (point[1] * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(bearingRad)) / 110540;
  const dLng = (distanceMeters * Math.sin(bearingRad)) / (111320 * Math.cos(latRad));
  return [point[0] + dLng, point[1] + dLat];
}

// 以采样点为中心构造一条带状走廊多边形（左行 + 右行倒序，最多 16 个顶点）
export function buildCorridorPolygon(samples, bufferMeters) {
  const left = [];
  const right = [];
  for (let i = 0; i < samples.length; i += 1) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const latRad = (samples[i][1] * Math.PI) / 180;
    const dx = (next[0] - prev[0]) * 111320 * Math.cos(latRad);
    const dy = (next[1] - prev[1]) * 110540;
    const bearing = Math.atan2(dy, dx);
    left.push(offsetPoint(samples[i], bearing + Math.PI / 2, bufferMeters));
    right.push(offsetPoint(samples[i], bearing - Math.PI / 2, bufferMeters));
  }
  const polygon = [...left, ...right.reverse()];
  return polygon.map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).join('|');
}

export { EARTH };
