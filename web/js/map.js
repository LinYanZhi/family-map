// @generated
// 地图视图封装：初始化、样式切换、搜索/定位/路线覆盖物
export const MAP_STYLES = [
  { key: 'dark', name: '暗黑', uri: 'amap://styles/dark', swatch: '#0d1626' },
  { key: 'normal', name: '标准', uri: 'amap://styles/normal', swatch: '#dfe8f2' },
  { key: 'light', name: '浅色', uri: 'amap://styles/light', swatch: '#f6f9fc' },
  { key: 'grey', name: '灰白', uri: 'amap://styles/grey', swatch: '#c9d1d9' },
];

const STYLE_KEY = 'map-app:style';
const HOME_CENTER = [113.272674, 23.156789]; // 白云区政府
const DEFAULT_ZOOM = 13;

export function geolocationMessage(err) {
  const messages = {
    1: '定位权限被拒绝（iPhone：设置 → Safari → 位置 → 允许）',
    2: '无法获取位置（检查系统定位服务是否开启）',
    3: '定位超时，请到空旷处重试',
  };
  if (err?.code && messages[err.code]) return messages[err.code];
  return err?.message || '定位失败';
}

export class MapView {
  constructor(AMap, el, options = {}) {
    this.AMap = AMap;
    this.el = el;
    this.onStyleResult = typeof options.onStyleResult === 'function' ? options.onStyleResult : null;
    this.styleCheck = options.styleCheck !== false;
    this.styleTimer = 0;
    this.darkFallback = false;
    this.styleKey = null;
    try {
      this.styleKey = localStorage.getItem(STYLE_KEY) || 'dark';
    } catch {
      this.styleKey = 'dark';
    }

    this.map = new AMap.Map(el, {
      zoom: DEFAULT_ZOOM,
      center: HOME_CENTER,
      viewMode: '2D',
      resizeEnable: true,
      mapStyle: this._styleUri(this.styleKey),
    });

    this.pendingPick = null;
    this.mapClickHandlers = new Set();
    this.routeMarkers = [];
    this.routeLines = [];
    this.routeLine = null;
    this.directLine = null;
    this.candidateMarkers = [];
    this.searchMarker = null;
    this.locationMarker = null;
    this.locationCircle = null;

    this.map.on('click', (event) => this._handleClick(event));
    if (this.styleCheck) this._scheduleStyleCheck(this.styleKey);
  }

  _styleUri(key) {
    const found = MAP_STYLES.find((style) => style.key === key);
    return (found || MAP_STYLES[0]).uri;
  }

  // 高德暗黑样式数据来自 custyle.amap.com；被网络拦截时会静默保持亮色，这里检测并兜底
  _styleEntries(key) {
    try {
      return performance.getEntriesByType('resource')
        .filter((entry) => entry.name.includes('custyle') && entry.name.includes(`styleid=${key}`));
    } catch {
      return [];
    }
  }

  _scheduleStyleCheck(key) {
    if (!this.styleCheck) return;
    clearTimeout(this.styleTimer);
    const baseline = this._styleEntries(key).length;
    this.styleTimer = setTimeout(() => {
      const entries = this._styleEntries(key);
      const latest = entries[entries.length - 1];
      // 缓存命中时 transferSize 可能为 0，用 decodedBodySize 兜底判断
      const hasBody = Boolean(latest && (latest.transferSize > 0 || latest.decodedBodySize > 0));
      const ok = key === 'normal' ? true : Boolean(hasBody && entries.length > baseline);
      this._setDarkFallback(key === 'dark' && !ok);
      this.onStyleResult?.(key, ok, {
        entries: entries.length,
        baseline,
        size: latest?.transferSize ?? 0,
      });
    }, 2800);
  }

  _setDarkFallback(on) {
    this.darkFallback = Boolean(on);
    this.el.classList.toggle('dark-fallback', this.darkFallback);
  }

  isDarkFallback() {
    return this.darkFallback;
  }

  _handleClick(event) {
    const lnglat = [event.lnglat.getLng(), event.lnglat.getLat()];
    const pending = this.pendingPick;
    this.pendingPick = null;
    this.el.classList.remove('picking');
    if (pending) {
      pending(lnglat);
      return;
    }
    for (const handler of this.mapClickHandlers) handler(event);
  }

  onMapClick(handler) {
    this.mapClickHandlers.add(handler);
    return () => this.mapClickHandlers.delete(handler);
  }

  pickOnce(callback) {
    this.pendingPick = callback;
    this.el.classList.add('picking');
  }

  cancelPick() {
    this.pendingPick = null;
    this.el.classList.remove('picking');
  }

  setStyle(key) {
    this.styleKey = key;
    this.map.setMapStyle(this._styleUri(key));
    try {
      localStorage.setItem(STYLE_KEY, key);
    } catch { /* ignore */ }
    if (this.styleCheck) this._scheduleStyleCheck(key);
    return key;
  }

  getStyle() {
    return this.styleKey;
  }

  focus(location, zoom = 16) {
    this.map.setZoomAndCenter(zoom, location);
  }

  _pin(location, text, variant) {
    const node = document.createElement('div');
    node.className = `pin pin-${variant}`;
    node.textContent = text;
    return new this.AMap.Marker({
      position: location,
      anchor: 'bottom-center',
      content: node,
      title: text,
    });
  }

  setSearchMarker(location) {
    this.clearSearchMarker();
    this.searchMarker = this._pin(location, '★', 'search');
    this.map.add(this.searchMarker);
  }

  clearSearchMarker() {
    if (!this.searchMarker) return;
    this.map.remove(this.searchMarker);
    this.searchMarker = null;
  }

  setLocation(location, accuracy) {
    const radius = Math.max(Number(accuracy) || 0, 10);
    if (!this.locationMarker) {
      const node = document.createElement('div');
      node.className = 'me-dot';
      this.locationMarker = new this.AMap.Marker({
        position: location,
        anchor: 'center',
        content: node,
        title: '我的位置',
        zIndex: 200,
      });
      this.map.add(this.locationMarker);
    } else {
      this.locationMarker.setPosition(location);
    }

    if (!this.locationCircle) {
      this.locationCircle = new this.AMap.Circle({
        center: location,
        radius,
        strokeColor: '#4c9aff',
        strokeOpacity: 0.8,
        strokeWeight: 1,
        fillColor: '#4c9aff',
        fillOpacity: 0.15,
      });
      this.map.add(this.locationCircle);
    } else {
      this.locationCircle.setCenter(location);
      this.locationCircle.setRadius(radius);
    }
  }

  async locate() {
    if (!navigator.geolocation) throw new Error('这个浏览器不支持定位');
    const isSecure = location.protocol === 'https:'
      || ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!isSecure) throw new Error('定位需要 HTTPS（iOS 限制），请用 https:// 地址打开');

    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
      });
    });
    const lnglat = [pos.coords.longitude, pos.coords.latitude];
    this.setLocation(lnglat, pos.coords.accuracy);
    this.focus(lnglat, 16);
    return { name: '我的位置', location: lnglat };
  }

  // 按途径点最近顶点把整条折线切成若干段，用于分段着色
  _splitByWaypoints(polyline, waypoints) {
    if (!waypoints.length || polyline.length < 3) return [polyline];
    const indices = waypoints
      .map((waypoint) => {
        let best = -1;
        let bestDistance = Infinity;
        polyline.forEach((point, index) => {
          const dx = point[0] - waypoint[0];
          const dy = point[1] - waypoint[1];
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        });
        return best;
      })
      .filter((index) => index > 0 && index < polyline.length - 1)
      .sort((a, b) => a - b);
    const unique = [...new Set(indices)];
    if (!unique.length) return [polyline];

    const segments = [];
    let start = 0;
    for (const index of unique) {
      segments.push(polyline.slice(start, index + 1));
      start = index;
    }
    segments.push(polyline.slice(start));
    return segments.filter((segment) => segment.length > 1);
  }

  setRoute({ origin, destination, waypoints = [], polyline = [], directPolyline = null }) {
    this.clearRoute();
    this.clearSearchMarker();
    this.clearCandidateMarkers();

    const markers = [];
    if (origin) markers.push(this._pin(origin, '起', 'origin'));
    waypoints.forEach((point, index) => markers.push(this._pin(point, String(index + 1), 'waypoint')));
    if (destination) markers.push(this._pin(destination, '终', 'destination'));
    if (markers.length) {
      this.map.add(markers);
      this.routeMarkers = markers;
    }

    const palette = ['#4c9aff', '#35d07f', '#ffb347', '#ff6b6b', '#b37cff'];
    const segments = this._splitByWaypoints(polyline, waypoints);
    this.routeLines = [];
    segments.forEach((segment, index) => {
      if (segment.length < 2) return;
      const line = new this.AMap.Polyline({
        path: segment,
        strokeColor: palette[index % palette.length],
        strokeWeight: 6,
        strokeOpacity: 0.92,
        lineJoin: 'round',
        showDir: true,
      });
      this.map.add(line);
      this.routeLines.push(line);
    });
    this.routeLine = this.routeLines[0] || null;

    if (directPolyline && directPolyline.length > 1) {
      this.directLine = new this.AMap.Polyline({
        path: directPolyline,
        strokeColor: '#c3d1e0',
        strokeWeight: 4,
        strokeOpacity: 0.85,
        strokeStyle: 'dashed',
        strokeDasharray: [8, 8],
        lineJoin: 'round',
        zIndex: 60,
      });
      this.map.add(this.directLine);
    }

    const overlays = [...markers, ...this.routeLines, this.directLine].filter(Boolean);
    if (overlays.length) this.map.setFitView(overlays, false, [90, 40, 260, 40]);
  }

  clearRoute() {
    if (this.routeMarkers.length) {
      this.map.remove(this.routeMarkers);
      this.routeMarkers = [];
    }
    for (const line of this.routeLines) this.map.remove(line);
    this.routeLines = [];
    this.routeLine = null;
    if (this.directLine) {
      this.map.remove(this.directLine);
      this.directLine = null;
    }
  }

  follow(location, zoom = 17) {
    this.map.setZoomAndCenter(zoom, location);
  }

  // 沿途候选点（数字小标记）
  setCandidateMarkers(points) {
    this.clearCandidateMarkers();
    if (!points || !points.length) return;
    this.candidateMarkers = points.map((location, index) => {
      const node = document.createElement('div');
      node.className = 'pin pin-candidate';
      node.textContent = String(index + 1);
      const marker = new this.AMap.Marker({
        position: location,
        anchor: 'bottom-center',
        content: node,
        title: `沿途候选 ${index + 1}`,
        zIndex: 120,
      });
      this.map.add(marker);
      return marker;
    });
  }

  clearCandidateMarkers() {
    if (this.candidateMarkers && this.candidateMarkers.length) {
      this.map.remove(this.candidateMarkers);
    }
    this.candidateMarkers = [];
  }
}
