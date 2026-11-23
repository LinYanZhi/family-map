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
  constructor(AMap, el) {
    this.AMap = AMap;
    this.el = el;
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
    this.routeLine = null;
    this.searchMarker = null;
    this.locationMarker = null;
    this.locationCircle = null;

    this.map.on('click', (event) => this._handleClick(event));
  }

  _styleUri(key) {
    const found = MAP_STYLES.find((style) => style.key === key);
    return (found || MAP_STYLES[0]).uri;
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

  setRoute({ origin, destination, waypoints = [], polyline = [] }) {
    this.clearRoute();
    this.clearSearchMarker();

    const markers = [];
    if (origin) markers.push(this._pin(origin, '起', 'origin'));
    waypoints.forEach((point, index) => markers.push(this._pin(point, `途${index + 1}`, 'waypoint')));
    if (destination) markers.push(this._pin(destination, '终', 'destination'));
    if (markers.length) {
      this.map.add(markers);
      this.routeMarkers = markers;
    }

    if (polyline.length > 1) {
      this.routeLine = new this.AMap.Polyline({
        path: polyline,
        strokeColor: '#4c9aff',
        strokeWeight: 6,
        strokeOpacity: 0.92,
        lineJoin: 'round',
        showDir: true,
      });
      this.map.add(this.routeLine);
    }

    const overlays = [...markers, this.routeLine].filter(Boolean);
    if (overlays.length) this.map.setFitView(overlays, false, [90, 40, 260, 40]);
  }

  clearRoute() {
    if (this.routeMarkers.length) {
      this.map.remove(this.routeMarkers);
      this.routeMarkers = [];
    }
    if (this.routeLine) {
      this.map.remove(this.routeLine);
      this.routeLine = null;
    }
  }
}
