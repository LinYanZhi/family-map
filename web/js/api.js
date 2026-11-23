// @generated
// 统一 JSON 请求封装：所有高德调用都经本机 /api/*，前端不接触 Web 服务 key
export async function getJson(pathname) {
  const sep = pathname.includes('?') ? '&' : '?';
  const res = await fetch(`${pathname}${sep}t=${Date.now()}`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.error || 'http_error';
    throw err;
  }
  return data;
}

function fmt(location) {
  return `${location[0]},${location[1]}`;
}

export const api = {
  config: () => getJson('/api/config'),
  searchPoi: (keywords) => getJson(`/api/poi?keywords=${encodeURIComponent(keywords)}&city=${encodeURIComponent('广州')}`),
  regeo: (location) => getJson(`/api/regeo?location=${fmt(location)}`),
  route: ({ mode, origin, destination, waypoints = [] }) => {
    const params = new URLSearchParams({
      mode,
      origin: fmt(origin),
      destination: fmt(destination),
    });
    if (waypoints.length) params.set('waypoints', waypoints.map(fmt).join(';'));
    return getJson(`/api/route?${params.toString()}`);
  },
};
