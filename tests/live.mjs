// @generated
// 真实高德接口自测（会消耗少量配额；服务端有 5 分钟缓存）
// 用法：node tests/live.mjs [baseUrl]
const BASE = process.argv[2] || process.env.MAP_BASE || 'http://127.0.0.1:8800';

const checks = [];
async function getJson(pathname) {
  const res = await fetch(`${BASE}${pathname}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}: ${data?.message || data?.error || ''}`);
  return data;
}

function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function fail(name, err) {
  checks.push({ name, ok: false });
  console.log(`FAIL  ${name}  (${err.message})`);
}

try {
  const poi = await getJson(`/api/poi?keywords=${encodeURIComponent('白云万达广场')}`);
  check('POI 搜索有结果', poi.ok && poi.count > 0, `count=${poi.count}`);
} catch (err) {
  fail('POI 搜索有结果', err);
}

try {
  const regeo = await getJson('/api/regeo?location=113.272674,23.156789');
  check('逆地理返回地址', Boolean(regeo.address), regeo.address);
} catch (err) {
  fail('逆地理返回地址', err);
}

let destination = null;
try {
  const poi = await getJson(`/api/poi?keywords=${encodeURIComponent('广州塔')}`);
  destination = poi.pois?.[0]?.location || null;
} catch { /* ignore */ }

if (destination) {
  try {
    const route = await getJson(`/api/route?mode=driving&origin=113.272674,23.156789&destination=${destination[0]},${destination[1]}`);
    check('驾车路线有距离', route.distance > 0, `${route.distance} 米 / ${route.duration} 秒`);
    check('驾车路线有折线', Array.isArray(route.polyline) && route.polyline.length > 5, `points=${route.polyline?.length}`);
    check('驾车路线有步骤', Array.isArray(route.steps) && route.steps.length > 0, `steps=${route.steps?.length}`);
  } catch (err) {
    fail('驾车路线', err);
  }

  try {
    const routeWp = await getJson(`/api/route?mode=driving&origin=113.272674,23.156789&destination=${destination[0]},${destination[1]}&waypoints=113.32,23.14`);
    check('带途径点路线可用', routeWp.distance > 0, `${routeWp.distance} 米`);
  } catch (err) {
    fail('带途径点路线可用', err);
  }

  try {
    const walking = await getJson(`/api/route?mode=walking&origin=113.272674,23.156789&destination=${destination[0]},${destination[1]}`);
    check('步行路线可用', walking.distance > 0, `${walking.distance} 米`);
  } catch (err) {
    fail('步行路线可用', err);
  }
} else {
  console.log('SKIP  路线测试（拿不到目的地坐标）');
}

const failed = checks.filter((item) => !item.ok);
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} 通过`);
process.exit(failed.length ? 1 : 0);
