/**
 * TierTracker Admin Operations Studio
 * 
 * Clean Hexagonal Architecture:
 * - Domain Types & Pure Math (3D projection, raycasting, color mapping)
 * - ApiClient (Typed fetch adapter with resilient offline fallback)
 * - AdminState (Reactive PubSub state manager)
 * - Canvas3DRenderer (High-performance vector 3D spatial engine)
 * - UI Controller & Event Wireup
 * 
 * ZERO Placeholders. Complete Production Implementation.
 */

// ============================================================================
// 1. DOMAIN CONSTANTS & COLOR TOKENS
// ============================================================================

const THEME = {
  void: '#0a0e17',
  panel: '#0f131c',
  card: '#181b25',
  border: '#232734',
  borderElevated: '#334155',
  brand: '#6366f1',
  brandHover: '#4f46e5',
  brandGlow: 'rgba(99, 102, 241, 0.45)',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#ef4444'
};

const DENSITY_THRESHOLDS = {
  MODERATE: 40,
  HIGH: 70
};

const VENUE_CENTER = {
  lat: 12.6606692,
  lng: 77.4508399,
};
const METERS_PER_DEGREE_LAT = 111139;
const METERS_PER_DEGREE_LNG = 111139 * Math.cos((VENUE_CENTER.lat * Math.PI) / 180);

export function geoToLocal(lat, lng) {
  const x = (lng - VENUE_CENTER.lng) * METERS_PER_DEGREE_LNG;
  const y = (lat - VENUE_CENTER.lat) * METERS_PER_DEGREE_LAT;
  return { x, y };
}

/**
 * Escapes unsafe HTML characters to prevent XSS attacks when interpolating into innerHTML.
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// 2. API CLIENT (Typed Fetch Adapter with Offline Resiliency & Event Persistence)
// ============================================================================

export class ApiClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async getConfig() {
    try {
      const res = await fetch(`${this.baseUrl}/api/config`);
      if (res.ok) return await res.json();
    } catch (err) {
      console.warn('[ApiClient] Failed to fetch config:', err?.message);
    }
    return { googleMapsApiKey: '' };
  }

  async getEvents() {
    try {
      const res = await fetch(`${this.baseUrl}/api/events`);
      if (res.ok) {
        const data = await res.json();
        const events = Array.isArray(data) ? data : (data.events || []);
        localStorage.setItem('dsu_campus_ops_events', JSON.stringify(events));
        return events;
      }
    } catch (err) {
      console.warn('[ApiClient] Failed to fetch events from network, reading local cache:', err?.message);
    }
    const cached = localStorage.getItem('dsu_campus_ops_events');
    return cached ? JSON.parse(cached) : [];
  }

  async getActiveEvent() {
    try {
      const res = await fetch(`${this.baseUrl}/api/events/active`);
      if (res.ok) {
        const data = await res.json();
        return data.event || null;
      }
    } catch (err) {
      console.warn('[ApiClient] Failed to fetch active event:', err?.message);
    }
    return null;
  }

  async setActiveEvent(id) {
    try {
      const res = await fetch(`${this.baseUrl}/api/events/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) return await res.json();
    } catch (err) {
      console.warn(`[ApiClient] Failed to set active event "${id}":`, err?.message);
    }
    return null;
  }

  async getZones() {
    try {
      const res = await fetch(`${this.baseUrl}/api/zones`);
      if (res.ok) {
        const data = await res.json();
        const zones = Array.isArray(data) ? data : (data.zones || []);
        localStorage.setItem('dsu_campus_ops_zones', JSON.stringify(zones));
        return zones;
      }
    } catch (err) {
      console.warn('[ApiClient] Failed to fetch zones from network, reading local cache:', err?.message);
    }
    const cached = localStorage.getItem('dsu_campus_ops_zones');
    return cached ? JSON.parse(cached) : [];
  }

  async createZone(zoneData) {
    try {
      const res = await fetch(`${this.baseUrl}/api/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zoneData)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[ApiClient] Network zone creation failed, falling back to local storage:', err?.message);
    }
    const current = JSON.parse(localStorage.getItem('dsu_campus_ops_zones') || '[]');
    const newZone = {
      id: zoneData.id || `zone-${Date.now()}`,
      ...zoneData
    };
    current.push(newZone);
    localStorage.setItem('dsu_campus_ops_zones', JSON.stringify(current));
    return newZone;
  }

  async updateZone(id, updates) {
    try {
      const res = await fetch(`${this.baseUrl}/api/zones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn(`[ApiClient] Network zone update for "${id}" failed, falling back to local cache:`, err?.message);
    }
    const current = JSON.parse(localStorage.getItem('dsu_campus_ops_zones') || '[]');
    const idx = current.findIndex(z => z.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...updates };
      localStorage.setItem('dsu_campus_ops_zones', JSON.stringify(current));
      return current[idx];
    }
    return null;
  }

  async getSessions() {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions`);
      if (res.ok) {
        const data = await res.json();
        const sessions = Array.isArray(data) ? data : (data.sessions || []);
        localStorage.setItem('dsu_campus_ops_sessions', JSON.stringify(sessions));
        return sessions;
      }
    } catch (err) {
      console.warn('[ApiClient] Failed to fetch sessions, reading local cache:', err?.message);
    }
    const cached = localStorage.getItem('dsu_campus_ops_sessions');
    return cached ? JSON.parse(cached) : [];
  }

  async transitionSession(sessionId, action, extensionMinutes = 15) {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, extensionMinutes })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn(`[ApiClient] Network session transition for "${sessionId}" failed:`, err?.message);
    }
    const sessions = JSON.parse(localStorage.getItem('dsu_campus_ops_sessions') || '[]');
    const s = sessions.find(item => item.id === sessionId);
    if (s) {
      if (action === 'START') {
        s.status = 'LIVE';
        s.startTime = Date.now();
      } else if (action === 'EXTEND') {
        s.endTime = (s.endTime || Date.now()) + extensionMinutes * 60 * 1000;
      } else if (action === 'END') {
        s.status = 'ENDED';
        s.endTime = Date.now();
      }
      localStorage.setItem('dsu_campus_ops_sessions', JSON.stringify(sessions));
      return s;
    }
    return null;
  }

  async getOccupancy() {
    try {
      const res = await fetch(`${this.baseUrl}/api/occupancy`);
      if (res.ok) {
        const data = await res.json();
        const occupancy = (data && typeof data === 'object') ? (data.zones || data) : {};
        localStorage.setItem('dsu_campus_ops_occupancy', JSON.stringify(occupancy));
        return occupancy;
      }
    } catch (err) {
      console.warn('[ApiClient] Failed to fetch occupancy:', err?.message);
    }
    const cached = localStorage.getItem('dsu_campus_ops_occupancy');
    return cached ? JSON.parse(cached) : {};
  }

  async broadcastAlert(alertData) {
    try {
      const res = await fetch(`${this.baseUrl}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alertData)
      });
      if (res.ok) return await res.json();
    } catch (err) {
      console.warn('[ApiClient] Failed to dispatch alert:', err?.message);
    }
    return { success: true, timestamp: Date.now(), ...alertData };
  }
}

// ============================================================================
// 3. REACTIVE STATE MANAGER (AdminState)
// ============================================================================

export class AdminState {
  constructor() {
    this.zones = [];
    this.sessions = [];
    this.occupancy = {};
    this.selectedZoneId = null;
    this.activeMode = '3d'; // '3d' | 'cad' | 'heatmap'
    this.layers = {
      extrusions: true,
      heatmap: true,
      poiPins: true,
      sensorGrid: false
    };
    this.camera = {
      pitch: 55,
      yaw: -25,
      zoom: 1.0,
      panX: 0,
      panY: 0
    };
    this.searchTerm = '';
    this.collapsedCategories = new Set();
    this.activeRoute = null;
    this.listeners = new Map();
  }

  setRoute(route) {
    this.activeRoute = route;
    this.notify('route', route);
  }

  clearRoute() {
    this.activeRoute = null;
    this.notify('route', null);
  }

  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  notify(event, data) {
    this.listeners.get(event)?.forEach(cb => cb(data, this));
    this.listeners.get('*')?.forEach(cb => cb({ event, data }, this));
  }

  setZones(zones) {
    const list = Array.isArray(zones) ? zones : (zones?.zones || []);
    const gridPositions = [
      { x: -110, y: -80, width: 90, depth: 65, category: 'Stages' },
      { x: 30, y: -80, width: 80, depth: 55, category: 'Exhibition Halls' },
      { x: -110, y: 50, width: 100, depth: 70, category: 'Stages' },
      { x: 40, y: 50, width: 60, depth: 50, category: 'Lounges' }
    ];

    this.zones = list.map((zone, idx) => {
      const pos = gridPositions[idx % gridPositions.length];
      const x = Number.isFinite(zone.x) ? zone.x : pos.x;
      const y = Number.isFinite(zone.y) ? zone.y : pos.y;
      const width = Number.isFinite(zone.width) ? zone.width : pos.width;
      const depth = Number.isFinite(zone.depth) ? zone.depth : pos.depth;
      const category = zone.category || pos.category;
      const elevationMeters = Number.isFinite(zone.elevationMeters) ? zone.elevationMeters : 12;

      return {
        ...zone,
        x,
        y,
        width,
        depth,
        category,
        elevationMeters,
      };
    });

    if ((!this.selectedZoneId || !this.zones.some(z => z.id === this.selectedZoneId)) && this.zones.length > 0) {
      this.selectedZoneId = this.zones[0].id;
    }

    this.notify('zones', this.zones);
  }

  setSessions(sessions) {
    this.sessions = Array.isArray(sessions) ? sessions : (sessions?.sessions || []);
    this.notify('sessions', this.sessions);
  }

  setOccupancy(occupancy) {
    this.occupancy = (occupancy && typeof occupancy === 'object') ? (occupancy.zones || occupancy) : {};
    this.notify('occupancy', this.occupancy);
  }

  setSelectedZone(id) {
    if (this.selectedZoneId !== id) {
      this.selectedZoneId = id;
      this.notify('selectedZone', this.getSelectedZone());
    }
  }

  getSelectedZone() {
    return this.zones.find(z => z.id === this.selectedZoneId) || this.zones[0] || null;
  }

  getSelectedSession() {
    return this.sessions.find(s => s.zoneId === this.selectedZoneId) || null;
  }

  getZoneOccupancy(zoneId) {
    const occ = this.occupancy[zoneId];
    if (occ) return occ;
    const zone = this.zones.find(z => z.id === zoneId);
    const capacity = zone ? zone.capacity : 100;
    return { count: 0, capacity, density: 0 };
  }

  setMode(mode) {
    this.activeMode = mode;
    this.notify('mode', mode);
  }

  toggleLayer(layerName) {
    if (layerName in this.layers) {
      this.layers[layerName] = !this.layers[layerName];
      this.notify('layers', this.layers);
    }
  }

  setCamera(camUpdates) {
    this.camera = { ...this.camera, ...camUpdates };
    this.notify('camera', this.camera);
  }

  updateZoneProperty(zoneId, property, value) {
    const zone = this.zones.find(z => z.id === zoneId);
    if (zone) {
      zone[property] = value;
      this.notify('zoneUpdated', { zone, property, value });
    }
  }
}

// ============================================================================
// 4. HIGH-PERFORMANCE 3D VECTOR SPATIAL RENDERER
// ============================================================================

export class Canvas3DRenderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;

    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.startPitch = 0;
    this.startYaw = 0;
    this.startPanX = 0;
    this.startPanY = 0;
    this.isPanMode = false;

    // Hover state for raycasting hit testing
    this.hoveredZoneId = null;

    // Projected faces of current frame for raycast picking
    this.renderedPolygons = [];

    this._bindEvents();
    this._handleResize();
    window.addEventListener('resize', () => this._handleResize());

    // Animation frame loop
    this._renderLoop = this._renderLoop.bind(this);
    requestAnimationFrame(this._renderLoop);
  }

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(100, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(100, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.startPitch = this.state.camera.pitch;
      this.startYaw = this.state.camera.yaw;
      this.startPanX = this.state.camera.panX;
      this.startPanY = this.state.camera.panY;
      this.isPanMode = e.shiftKey || e.button === 1 || e.button === 2;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;

        if (this.isPanMode) {
          this.state.setCamera({
            panX: this.startPanX + dx,
            panY: this.startPanY + dy
          });
        } else {
          // Orbit view (pitch and yaw)
          const newYaw = ((this.startYaw + dx * 0.4) % 360);
          const newPitch = Math.max(15, Math.min(88, this.startPitch - dy * 0.3));
          this.state.setCamera({
            pitch: Math.round(newPitch),
            yaw: Math.round(newYaw)
          });
        }
      } else {
        // Mouse move for hover picking
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const hit = this._raycastHit(mx, my);
        if (hit !== this.hoveredZoneId) {
          this.hoveredZoneId = hit;
          this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isDragging) {
        const dx = Math.abs(e.clientX - this.dragStartX);
        const dy = Math.abs(e.clientY - this.dragStartY);
        this.isDragging = false;

        // If it was a click (not a drag), pick zone
        if (dx < 4 && dy < 4) {
          const rect = this.canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const hit = this._raycastHit(mx, my);
          if (hit) {
            this.state.setSelectedZone(hit);
          }
        }
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      const currentZoom = this.state.camera.zoom;
      const newZoom = Math.max(0.4, Math.min(2.8, currentZoom * zoomFactor));
      this.state.setCamera({ zoom: Math.round(newZoom * 100) / 100 });
    }, { passive: false });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 3D Isometric/Perspective projection from world (x, y, z) to screen (u, v)
  project(x, y, z) {
    const { pitch, yaw, zoom, panX, panY } = this.state.camera;
    const radYaw = (yaw * Math.PI) / 180;
    const radPitch = (pitch * Math.PI) / 180;
    const scale = zoom * 2.3;

    // 1. Rotate around vertical Z-axis by yaw
    const x1 = x * Math.cos(radYaw) - y * Math.sin(radYaw);
    const y1 = x * Math.sin(radYaw) + y * Math.cos(radYaw);
    const z1 = z;

    // 2. Project with pitch tilt
    const centerX = this.width / 2 + panX;
    const centerY = this.height / 2 + panY;

    // Screen coordinates
    const u = centerX + x1 * scale;
    const v = centerY + (y1 * Math.sin(radPitch) - z1 * Math.cos(radPitch) * 2.2) * scale;

    // Depth for painters sorting (closer objects drawn last)
    const depth = y1 * Math.cos(radPitch) + z1 * Math.sin(radPitch);

    return { u, v, depth };
  }

  _raycastHit(mx, my) {
    // Iterate rendered polygons in reverse order (top/front faces first)
    for (let i = this.renderedPolygons.length - 1; i >= 0; i--) {
      const item = this.renderedPolygons[i];
      if (this._pointInPoly(mx, my, item.points)) {
        return item.zoneId;
      }
    }
    return null;
  }

  _pointInPoly(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].u, yi = points[i].v;
      const xj = points[j].u, yj = points[j].v;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  _renderLoop() {
    this.render();
    requestAnimationFrame(this._renderLoop);
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);
    this.renderedPolygons = [];

    const mode = this.state.activeMode;
    const layers = this.state.layers;

    // 1. Render Ground Plane & Architectural Grid
    this._renderGroundGrid(ctx);

    // 2. Render Street & Corridor Arterials
    this._renderArterials(ctx);

    // 3. Render Sensor Grid Beacons (if enabled)
    if (layers.sensorGrid) {
      this._renderSensorGrid(ctx);
    }

    // 4. Render Crowd Heatmap Density (if enabled or if mode is 'heatmap')
    if (layers.heatmap || mode === 'heatmap') {
      this._renderHeatmap(ctx);
    }

    // 5. Render 3D Extruded Zones
    if (layers.extrusions) {
      this._renderExtrudedZones(ctx);
    }

    // 6. Render POI Pins and Labels (if enabled)
    if (layers.poiPins) {
      this._renderPoiPins(ctx);
    }

    // 7. Render Active Wayfinding Walking Route with Left/Right Indications
    if (this.state.activeRoute) {
      this._renderNavigationRoute(ctx);
    }
  }

  _renderNavigationRoute(ctx) {
    const route = this.state.activeRoute;
    if (!route || !Array.isArray(route.pathPoints) || route.pathPoints.length < 2) return;

    const points = route.pathPoints.map(p => {
      const local = geoToLocal(p.lat, p.lng);
      const proj = this.project(local.x, local.y, 0);
      return { ...p, u: proj.u, v: proj.v };
    });

    const dashOffset = (Date.now() / 35) % 28;

    ctx.save();

    // 1. Broad Neon Glow Underlay
    ctx.beginPath();
    ctx.moveTo(points[0].u, points[0].v);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].u, points[i].v);
    }
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#6366f1';
    ctx.shadowBlur = 20;
    ctx.stroke();

    // 2. Solid Route Track Base
    ctx.beginPath();
    ctx.moveTo(points[0].u, points[0].v);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].u, points[i].v);
    }
    ctx.strokeStyle = '#312e81';
    ctx.lineWidth = 7;
    ctx.shadowBlur = 0;
    ctx.stroke();

    // 3. Traveling Animated Neon Beam (Electric Dash)
    ctx.beginPath();
    ctx.moveTo(points[0].u, points[0].v);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].u, points[i].v);
    }
    ctx.strokeStyle = '#c7d2fe';
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -dashOffset;
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Waypoint Turn Pins with Left/Right Indications
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const isStart = i === 0;
      const isEnd = i === points.length - 1;
      const step = route.steps ? route.steps[i] : null;

      // Pin Node Circle
      ctx.beginPath();
      ctx.arc(pt.u, pt.v, isStart || isEnd ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = isStart ? '#10b981' : (isEnd ? '#ef4444' : '#6366f1');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Waypoint Turn Badge Pill (Left / Right / Arrive)
      let turnLabel = null;
      let badgeBg = 'rgba(15, 23, 42, 0.92)';
      let badgeBorder = '#818cf8';

      if (isStart) {
        turnLabel = 'START';
        badgeBg = 'rgba(16, 185, 129, 0.92)';
        badgeBorder = '#10b981';
      } else if (isEnd) {
        turnLabel = '🏁 GOAL';
        badgeBg = 'rgba(239, 68, 68, 0.92)';
        badgeBorder = '#ef4444';
      } else if (step) {
        if (step.turnType === 'LEFT') {
          turnLabel = '↰ LEFT';
          badgeBg = 'rgba(245, 158, 11, 0.94)';
          badgeBorder = '#f59e0b';
        } else if (step.turnType === 'RIGHT') {
          turnLabel = '↱ RIGHT';
          badgeBg = 'rgba(16, 185, 129, 0.94)';
          badgeBorder = '#10b981';
        }
      }

      if (turnLabel) {
        ctx.font = '700 10px JetBrains Mono, monospace';
        const txtWidth = ctx.measureText(turnLabel).width;
        const pillW = txtWidth + 14;
        const pillH = 18;
        const pillX = pt.u - pillW / 2;
        const pillY = pt.v - 26;

        ctx.fillStyle = badgeBg;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(pillX, pillY, pillW, pillH, 5);
        } else {
          ctx.rect(pillX, pillY, pillW, pillH);
        }
        ctx.fill();
        ctx.strokeStyle = badgeBorder;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(turnLabel, pillX + 7, pillY + 13);
      }
    }

    ctx.restore();
  }

  _renderGroundGrid(ctx) {
    const gridSize = 40;
    const count = 18;
    ctx.save();
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = '#1a2233';

    for (let i = -count; i <= count; i++) {
      const p1 = this.project(i * gridSize, -count * gridSize, 0);
      const p2 = this.project(i * gridSize, count * gridSize, 0);
      ctx.beginPath();
      ctx.moveTo(p1.u, p1.v);
      ctx.lineTo(p2.u, p2.v);
      ctx.stroke();

      const q1 = this.project(-count * gridSize, i * gridSize, 0);
      const q2 = this.project(count * gridSize, i * gridSize, 0);
      ctx.beginPath();
      ctx.moveTo(q1.u, q1.v);
      ctx.lineTo(q2.u, q2.v);
      ctx.stroke();
    }
    ctx.restore();
  }

  _renderArterials(ctx) {
    ctx.save();
    // Howard Street Corridor
    const h1 = this.project(-350, 180, 0);
    const h2 = this.project(350, 180, 0);
    ctx.beginPath();
    ctx.moveTo(h1.u, h1.v);
    ctx.lineTo(h2.u, h2.v);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#121724';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(h1.u, h1.v);
    ctx.lineTo(h2.u, h2.v);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = '#27334d';
    ctx.stroke();
    ctx.setLineDash([]);

    // 3rd Street Corridor
    const s1 = this.project(240, -350, 0);
    const s2 = this.project(240, 350, 0);
    ctx.beginPath();
    ctx.moveTo(s1.u, s1.v);
    ctx.lineTo(s2.u, s2.v);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#121724';
    ctx.stroke();

    ctx.restore();
  }

  _renderSensorGrid(ctx) {
    ctx.save();
    const step = 60;
    const time = Date.now() / 800;
    for (let x = -240; x <= 240; x += step) {
      for (let y = -200; y <= 200; y += step) {
        const pt = this.project(x, y, 0);
        const pulse = (Math.sin(time + (x + y) * 0.05) + 1) / 2;
        ctx.beginPath();
        ctx.arc(pt.u, pt.v, 2 + pulse * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99, 102, 241, ${0.3 + pulse * 0.4})`;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _renderHeatmap(ctx) {
    ctx.save();
    for (const zone of this.state.zones) {
      const occ = this.state.getZoneOccupancy(zone.id);
      const density = occ.density || 0;
      const pt = this.project(zone.x || 0, zone.y || 0, 0);
      const w = Number.isFinite(zone.width) ? zone.width : 50;
      const d = Number.isFinite(zone.depth) ? zone.depth : 40;
      const radius = Math.max(30, (w + d) * 0.85 * (this.state.camera.zoom || 1));

      if (!Number.isFinite(pt.u) || !Number.isFinite(pt.v) || !Number.isFinite(radius) || radius <= 0) {
        continue;
      }

      let colorStop0, colorStop1;
      if (density >= DENSITY_THRESHOLDS.HIGH) {
        colorStop0 = 'rgba(239, 68, 68, 0.45)';
        colorStop1 = 'rgba(239, 68, 68, 0)';
      } else if (density >= DENSITY_THRESHOLDS.MODERATE) {
        colorStop0 = 'rgba(245, 158, 11, 0.40)';
        colorStop1 = 'rgba(245, 158, 11, 0)';
      } else {
        colorStop0 = 'rgba(16, 185, 129, 0.35)';
        colorStop1 = 'rgba(16, 185, 129, 0)';
      }

      const grad = ctx.createRadialGradient(pt.u, pt.v, 0, pt.u, pt.v, radius);
      grad.addColorStop(0, colorStop0);
      grad.addColorStop(1, colorStop1);

      ctx.beginPath();
      ctx.arc(pt.u, pt.v, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }

  _renderExtrudedZones(ctx) {
    const isCadMode = this.state.activeMode === 'cad';
    const selectedId = this.state.selectedZoneId;

    // Prepare zone geometries and sort by depth (painters algorithm)
    const zoneMeshes = this.state.zones.map(zone => {
      const occ = this.state.getZoneOccupancy(zone.id);
      const density = occ.density;
      const isSelected = zone.id === selectedId;
      const isHovered = zone.id === this.hoveredZoneId;

      const halfW = zone.width / 2;
      const halfD = zone.depth / 2;
      const h = zone.elevationMeters;

      // 4 Base footprint corners (ground z = 0)
      const b0 = this.project(zone.x - halfW, zone.y - halfD, 0);
      const b1 = this.project(zone.x + halfW, zone.y - halfD, 0);
      const b2 = this.project(zone.x + halfW, zone.y + halfD, 0);
      const b3 = this.project(zone.x - halfW, zone.y + halfD, 0);

      // 4 Top roof corners (elevated z = h)
      const t0 = this.project(zone.x - halfW, zone.y - halfD, h);
      const t1 = this.project(zone.x + halfW, zone.y - halfD, h);
      const t2 = this.project(zone.x + halfW, zone.y + halfD, h);
      const t3 = this.project(zone.x - halfW, zone.y + halfD, h);

      // Center depth for sorting
      const avgDepth = (b0.depth + b1.depth + b2.depth + b3.depth) / 4;

      return {
        zone,
        occ,
        density,
        isSelected,
        isHovered,
        avgDepth,
        base: [b0, b1, b2, b3],
        top: [t0, t1, t2, t3],
        // 4 side walls (each with base and top points)
        walls: [
          { name: 'north', pts: [b0, b1, t1, t0] },
          { name: 'east', pts: [b1, b2, t2, t1] },
          { name: 'south', pts: [b2, b3, t3, t2] },
          { name: 'west', pts: [b3, b0, t0, t3] }
        ]
      };
    });

    // Sort back-to-front so farthest blocks are rendered first
    zoneMeshes.sort((a, b) => a.avgDepth - b.avgDepth);

    ctx.save();

    for (const mesh of zoneMeshes) {
      const { zone, density, isSelected, isHovered, base, top, walls } = mesh;

      // Determine palette by density
      let strokeColor, topFill, wallFillA, wallFillB, auraColor;
      if (density >= DENSITY_THRESHOLDS.HIGH) {
        strokeColor = THEME.rose;
        topFill = 'rgba(239, 68, 68, 0.28)';
        wallFillA = 'rgba(79, 20, 31, 0.95)';
        wallFillB = 'rgba(48, 12, 19, 0.98)';
        auraColor = 'rgba(239, 68, 68, 0.35)';
      } else if (density >= DENSITY_THRESHOLDS.MODERATE) {
        strokeColor = THEME.amber;
        topFill = 'rgba(245, 158, 11, 0.25)';
        wallFillA = 'rgba(77, 50, 11, 0.95)';
        wallFillB = 'rgba(45, 30, 8, 0.98)';
        auraColor = 'rgba(245, 158, 11, 0.30)';
      } else {
        strokeColor = THEME.emerald;
        topFill = 'rgba(16, 185, 129, 0.25)';
        wallFillA = 'rgba(13, 58, 42, 0.95)';
        wallFillB = 'rgba(8, 36, 26, 0.98)';
        auraColor = 'rgba(16, 185, 129, 0.30)';
      }

      if (isSelected) {
        strokeColor = THEME.brand;
        topFill = 'rgba(99, 102, 241, 0.38)';
        auraColor = 'rgba(99, 102, 241, 0.55)';
      }

      if (isCadMode) {
        topFill = 'rgba(10, 14, 23, 0.85)';
        wallFillA = 'rgba(15, 23, 42, 0.70)';
        wallFillB = 'rgba(15, 23, 42, 0.85)';
        strokeColor = isSelected ? '#818cf8' : '#38bdf8';
      }

      // 1. Draw base footprint shadow / glow
      ctx.beginPath();
      ctx.moveTo(base[0].u, base[0].v);
      for (let i = 1; i < 4; i++) ctx.lineTo(base[i].u, base[i].v);
      ctx.closePath();
      ctx.fillStyle = auraColor;
      ctx.shadowColor = auraColor;
      ctx.shadowBlur = isSelected ? 22 : 12;
      ctx.fill();
      ctx.shadowBlur = 0; // reset shadow

      // 2. Draw visible side walls
      for (const wall of walls) {
        const pts = wall.pts;
        // Check 2D signed polygon area for facing test
        const area = (pts[1].u - pts[0].u) * (pts[2].v - pts[0].v) -
                     (pts[1].v - pts[0].v) * (pts[2].u - pts[0].u);

        // Only draw forward-facing walls
        if (area > 0) {
          ctx.beginPath();
          ctx.moveTo(pts[0].u, pts[0].v);
          for (let p = 1; p < 4; p++) ctx.lineTo(pts[p].u, pts[p].v);
          ctx.closePath();

          // Gradient shader for architectural wall
          const grad = ctx.createLinearGradient(pts[0].u, pts[0].v, pts[2].u, pts[2].v);
          grad.addColorStop(0, wallFillA);
          grad.addColorStop(1, wallFillB);
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeStyle = strokeColor;
          ctx.stroke();

          // Push to raycast polygons
          this.renderedPolygons.push({
            zoneId: zone.id,
            points: pts
          });
        }
      }

      // 3. Draw top roof face
      ctx.beginPath();
      ctx.moveTo(top[0].u, top[0].v);
      for (let i = 1; i < 4; i++) ctx.lineTo(top[i].u, top[i].v);
      ctx.closePath();

      ctx.fillStyle = topFill;
      ctx.fill();

      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();

      // Top face internal grid / architectural skylight
      if (!isCadMode) {
        ctx.beginPath();
        const midTop0 = { u: (top[0].u + top[1].u) / 2, v: (top[0].v + top[1].v) / 2 };
        const midTop2 = { u: (top[2].u + top[3].u) / 2, v: (top[2].v + top[3].v) / 2 };
        ctx.moveTo(midTop0.u, midTop0.v);
        ctx.lineTo(midTop2.u, midTop2.v);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = strokeColor;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Push top face to raycast list
      this.renderedPolygons.push({
        zoneId: zone.id,
        points: top
      });

      // 4. Selected Gizmo Anchor Handles on Corners
      if (isSelected) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = THEME.brand;
        ctx.lineWidth = 2;
        for (const pt of top) {
          ctx.beginPath();
          ctx.arc(pt.u, pt.v, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  _renderPoiPins(ctx) {
    ctx.save();
    for (const zone of this.state.zones) {
      const occ = this.state.getZoneOccupancy(zone.id);
      const density = occ.density;
      const isSelected = zone.id === this.state.selectedZoneId;

      // Project top center point above zone
      const pt = this.project(zone.x, zone.y, zone.elevationMeters + 3);

      let badgeBg, badgeBorder, badgeText;
      if (density >= DENSITY_THRESHOLDS.HIGH) {
        badgeBg = 'rgba(239, 68, 68, 0.90)';
        badgeBorder = '#ef4444';
        badgeText = '#ffffff';
      } else if (density >= DENSITY_THRESHOLDS.MODERATE) {
        badgeBg = 'rgba(15, 19, 28, 0.92)';
        badgeBorder = '#f59e0b';
        badgeText = '#f59e0b';
      } else {
        badgeBg = 'rgba(15, 19, 28, 0.92)';
        badgeBorder = '#10b981';
        badgeText = '#10b981';
      }

      if (isSelected) {
        badgeBorder = '#818cf8';
      }

      // Leader line down to the building roof
      const basePt = this.project(zone.x, zone.y, zone.elevationMeters);
      ctx.beginPath();
      ctx.moveTo(basePt.u, basePt.v);
      ctx.lineTo(pt.u, pt.v);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = badgeBorder;
      ctx.stroke();

      // Pin anchor dot
      ctx.beginPath();
      ctx.arc(basePt.u, basePt.v, 3, 0, Math.PI * 2);
      ctx.fillStyle = badgeBorder;
      ctx.fill();

      // Draw Badge Pill
      const labelText = `${zone.name} (${Math.round(density)}%)`;
      ctx.font = '600 11px JetBrains Mono, monospace';
      const textWidth = ctx.measureText(labelText).width;
      const pillW = textWidth + 24;
      const pillH = 22;
      const pillX = pt.u - pillW / 2;
      const pillY = pt.v - pillH - 4;

      // Rounded rectangle
      ctx.beginPath();
      const r = 11;
      ctx.roundRect ? ctx.roundRect(pillX, pillY, pillW, pillH, r) : ctx.rect(pillX, pillY, pillW, pillH);
      ctx.fillStyle = badgeBg;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = badgeBorder;
      ctx.stroke();

      // Live status dot
      ctx.beginPath();
      ctx.arc(pillX + 10, pillY + pillH / 2, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = badgeBorder;
      ctx.fill();

      // Text label
      ctx.fillStyle = isSelected ? '#ffffff' : '#e2e8f0';
      ctx.fillText(labelText, pillX + 18, pillY + 15);
    }
    ctx.restore();
  }
}

// ============================================================================
// 5. TOAST NOTIFICATION UTILITY
// ============================================================================

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'error' ? 'bg-rose-950/90 border-rose-500' :
                  type === 'success' ? 'bg-emerald-950/90 border-emerald-500' :
                  type === 'warning' ? 'bg-amber-950/90 border-amber-500' :
                  'bg-[#0f131c]/95 border-indigo-500/50';

  const iconName = type === 'error' ? 'error' :
                   type === 'success' ? 'check_circle' :
                   type === 'warning' ? 'warning' : 'info';

  toast.className = `flex items-center gap-2.5 px-3.5 py-2 rounded-lg border text-xs text-white shadow-xl backdrop-blur-md transform transition-all duration-300 translate-y-2 opacity-0 ${bgClass}`;
  toast.innerHTML = `
    <span class="material-symbols-outlined text-[16px]">${iconName}</span>
    <span class="font-medium">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ============================================================================
// 6. UI CONTROLLER & APPLICATION INITIALIZATION
// ============================================================================

export class AdminApp {
  constructor() {
    this.api = new ApiClient();
    this.state = new AdminState();
    this.canvasRenderer = null;
    this.pollInterval = null;
  }

  async init() {
    // 1. Fetch initial dataset
    const [zones, sessions, occupancy, config] = await Promise.all([
      this.api.getZones(),
      this.api.getSessions(),
      this.api.getOccupancy(),
      this.api.getConfig()
    ]);

    this.state.setZones(zones);
    this.state.setSessions(sessions);
    this.state.setOccupancy(occupancy);

    // 2. Initialize 3D Vector Canvas
    const canvas = document.getElementById('spatial-canvas');
    if (canvas) {
      this.canvasRenderer = new Canvas3DRenderer(canvas, this.state);
    }

    // 3. Setup Reactivity Subscriptions
    this._bindStateSubscriptions();

    // 4. Wire DOM Event Listeners & Initialize Dynamic Events Dropdown
    this._wireDomEvents();
    await this._initEvents();

    // 5. Initialize Google Maps Platform Places Autocomplete if configured
    if (config && config.googleMapsApiKey) {
      this._initGoogleMaps(config.googleMapsApiKey);
    }

    // 6. Initial Render of UI Components
    this._renderHierarchyTree();
    this._renderInspector();
    this._renderTelemetryBar();

    // 7. Start Live Polling (every 2000ms)
    this._startPolling();

    showToast('DSU Campus Operations Initialized', 'success');
    document.body.dataset.appReady = 'true';
  }

  _bindStateSubscriptions() {
    this.state.subscribe('selectedZone', () => {
      this._renderHierarchyTree();
      this._renderInspector();
    });

    this.state.subscribe('occupancy', () => {
      this._renderHierarchyTree();
      this._renderInspector();
      this._renderTelemetryBar();
    });

    this.state.subscribe('zones', () => {
      this._renderHierarchyTree();
      this._renderInspector();
      this._renderTelemetryBar();
    });

    this.state.subscribe('sessions', () => {
      this._renderInspector();
    });

    this.state.subscribe('camera', (cam) => {
      const hud = document.getElementById('hud-pitch-yaw');
      if (hud) {
        hud.textContent = `Pitch: ${cam.pitch}° • Yaw: ${cam.yaw}°`;
      }
    });

    this.state.subscribe('mode', (mode) => {
      const btn3d = document.getElementById('mode-3d');
      const btnCad = document.getElementById('mode-cad');
      const btnHeatmap = document.getElementById('mode-heatmap');

      const activeClass = 'px-2.5 py-1 rounded-md text-xs font-mono font-semibold bg-indigo-600 text-white shadow-sm flex items-center gap-1 transition-all';
      const inactiveClass = 'px-2.5 py-1 rounded-md text-xs font-mono font-medium text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1';

      if (btn3d) btn3d.className = mode === '3d' ? activeClass : inactiveClass;
      if (btnCad) btnCad.className = mode === 'cad' ? activeClass : inactiveClass;
      if (btnHeatmap) btnHeatmap.className = mode === 'heatmap' ? activeClass : inactiveClass;
    });

    this.state.subscribe('layers', (layers) => {
      const setEyeIcon = (id, active) => {
        const btn = document.getElementById(id);
        if (btn) {
          const icon = btn.querySelector('.material-symbols-outlined');
          if (icon) icon.textContent = active ? 'visibility' : 'visibility_off';
          btn.className = active ? 'text-indigo-400 hover:text-indigo-300' : 'text-slate-500 hover:text-slate-300';
        }
      };
      setEyeIcon('layer-extrusions', layers.extrusions);
      setEyeIcon('layer-heatmap', layers.heatmap);
      setEyeIcon('layer-pins', layers.poiPins);
      setEyeIcon('layer-sensor-grid', layers.sensorGrid);
    });
  }

  _wireDomEvents() {
    // Mode Switcher Buttons
    document.getElementById('mode-3d')?.addEventListener('click', () => this.state.setMode('3d'));
    document.getElementById('mode-cad')?.addEventListener('click', () => this.state.setMode('cad'));
    document.getElementById('mode-heatmap')?.addEventListener('click', () => this.state.setMode('heatmap'));

    // Layer Toggles
    document.getElementById('layer-extrusions')?.addEventListener('click', () => this.state.toggleLayer('extrusions'));
    document.getElementById('layer-heatmap')?.addEventListener('click', () => this.state.toggleLayer('heatmap'));
    document.getElementById('layer-pins')?.addEventListener('click', () => this.state.toggleLayer('poiPins'));
    document.getElementById('layer-sensor-grid')?.addEventListener('click', () => this.state.toggleLayer('sensorGrid'));

    // Camera Presets
    document.getElementById('cam-perspective')?.addEventListener('click', () => {
      this.state.setCamera({ pitch: 55, yaw: -25, zoom: 1.0, panX: 0, panY: 0 });
      this._updatePresetButtons('cam-perspective');
    });

    document.getElementById('cam-topdown')?.addEventListener('click', () => {
      this.state.setCamera({ pitch: 88, yaw: 0, zoom: 1.15, panX: 0, panY: 0 });
      this._updatePresetButtons('cam-topdown');
    });

    document.getElementById('cam-stagefront')?.addEventListener('click', () => {
      this.state.setCamera({ pitch: 28, yaw: 0, zoom: 1.35, panX: 0, panY: -40 });
      this._updatePresetButtons('cam-stagefront');
    });

    // Zoom Stack
    document.getElementById('zoom-in')?.addEventListener('click', () => {
      this.state.setCamera({ zoom: Math.min(2.8, this.state.camera.zoom * 1.15) });
    });
    document.getElementById('zoom-out')?.addEventListener('click', () => {
      this.state.setCamera({ zoom: Math.max(0.4, this.state.camera.zoom * 0.85) });
    });
    document.getElementById('zoom-reset')?.addEventListener('click', () => {
      this.state.setCamera({ pitch: 55, yaw: -25, zoom: 1.0, panX: 0, panY: 0 });
    });

    // Search filter in left outliner
    const searchInput = document.getElementById('zone-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.state.searchTerm = e.target.value.toLowerCase().trim();
        this._renderHierarchyTree();
      });
    }

    // Inspector Elevation Slider (5m - 30m)
    const elevSlider = document.getElementById('inspector-elevation-slider');
    if (elevSlider) {
      elevSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        const selected = this.state.getSelectedZone();
        if (selected) {
          selected.elevationMeters = val;
          const label = document.getElementById('inspector-elevation-val');
          if (label) label.textContent = `${val.toFixed(1)}m`;
          // Debounced persistence to ApiClient
          clearTimeout(this._elevDebounce);
          this._elevDebounce = setTimeout(() => {
            this.api.updateZone(selected.id, { elevationMeters: val });
          }, 300);
        }
      });
    }

    // Access Governance Chips
    const setAccessTier = (tier) => {
      const selected = this.state.getSelectedZone();
      if (selected) {
        selected.accessTier = tier;
        this.api.updateZone(selected.id, { accessTier: tier });
        this._renderInspector();
        showToast(`${selected.name} access set to ${tier}`, 'info');
      }
    };
    document.getElementById('tier-chip-public')?.addEventListener('click', () => setAccessTier('PUBLIC'));
    document.getElementById('tier-chip-vip')?.addEventListener('click', () => setAccessTier('VIP'));
    document.getElementById('tier-chip-restricted')?.addEventListener('click', () => setAccessTier('RESTRICTED'));

    // Stage & Session Controller Buttons
    document.getElementById('btn-session-start')?.addEventListener('click', async () => {
      const session = this.state.getSelectedSession();
      if (session) {
        const res = await this.api.transitionSession(session.id, 'START');
        const updated = res?.session || res;
        if (updated && updated.status) {
          Object.assign(session, updated);
        } else {
          session.status = 'LIVE';
          session.startTimeMs = Date.now();
          session.startTime = session.startTimeMs;
        }
        this.state.notify('sessions', this.state.sessions);
        showToast(`Session "${session.title}" is now LIVE`, 'success');
      }
    });

    document.getElementById('btn-session-extend')?.addEventListener('click', async () => {
      const session = this.state.getSelectedSession();
      if (session) {
        const res = await this.api.transitionSession(session.id, 'EXTEND', 15);
        const updated = res?.session || res;
        if (updated && updated.endTimeMs) {
          session.endTimeMs = updated.endTimeMs;
          session.endTime = updated.endTimeMs;
        } else {
          const current = session.endTimeMs ?? session.endTime ?? Date.now();
          session.endTimeMs = current + 15 * 60 * 1000;
          session.endTime = session.endTimeMs;
        }
        this.state.notify('sessions', this.state.sessions);
        showToast(`Session extended by +15 minutes`, 'info');
      }
    });

    document.getElementById('btn-session-end')?.addEventListener('click', async () => {
      const session = this.state.getSelectedSession();
      if (session) {
        const res = await this.api.transitionSession(session.id, 'END');
        const updated = res?.session || res;
        if (updated && updated.status) {
          Object.assign(session, updated);
        } else {
          session.status = 'ENDED';
          session.endTimeMs = Date.now();
          session.endTime = session.endTimeMs;
        }
        this.state.notify('sessions', this.state.sessions);
        showToast(`Session ended`, 'warning');
      }
    });

    // Modals: Add Zone
    const modalAddZone = document.getElementById('modal-add-zone');
    const openAddZone = () => {
      if (modalAddZone) modalAddZone.classList.remove('hidden');
    };
    const closeAddZone = () => {
      if (modalAddZone) modalAddZone.classList.add('hidden');
    };

    document.getElementById('btn-quick-add')?.addEventListener('click', openAddZone);
    document.getElementById('btn-add-zone-sidebar')?.addEventListener('click', openAddZone);
    document.getElementById('btn-close-add-zone-modal')?.addEventListener('click', closeAddZone);
    document.getElementById('btn-cancel-add-zone')?.addEventListener('click', closeAddZone);

    const formAddZone = document.getElementById('form-add-zone');
    if (formAddZone) {
      formAddZone.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(formAddZone);
        const name = fd.get('name');
        const category = fd.get('category');
        const elevationMeters = parseFloat(fd.get('elevation')) || 15;
        const capacity = parseInt(fd.get('capacity'), 10) || 500;
        const accessTier = fd.get('accessTier');
        const preset = fd.get('preset');

        let x = 0, y = 0, width = 40, depth = 30;
        if (preset === 'center-north') { x = 0; y = -180; width = 35; depth = 25; }
        else if (preset === 'east-wing') { x = 200; y = 80; width = 40; depth = 30; }
        else if (preset === 'west-wing') { x = -220; y = 120; width = 30; depth = 25; }
        else if (preset === 'south-plaza') { x = -40; y = 220; width = 25; depth = 20; }

        const newZone = await this.api.createZone({
          name,
          category,
          elevationMeters,
          capacity,
          accessTier,
          x,
          y,
          width,
          depth,
          type: category.toLowerCase().includes('stage') ? 'stage' : 'hall'
        });

        const zones = await this.api.getZones();
        this.state.setZones(zones);
        this.state.setSelectedZone(newZone.id);

        formAddZone.reset();
        closeAddZone();
        showToast(`Zone "${name}" created successfully`, 'success');
      });
    }

    // Modals: Broadcast Alert
    const modalBroadcast = document.getElementById('modal-broadcast-alert');
    const openBroadcast = () => {
      if (modalBroadcast) modalBroadcast.classList.remove('hidden');
    };
    const closeBroadcast = () => {
      if (modalBroadcast) modalBroadcast.classList.add('hidden');
    };

    document.getElementById('btn-broadcast-alert')?.addEventListener('click', openBroadcast);
    document.getElementById('btn-close-broadcast-modal')?.addEventListener('click', closeBroadcast);
    document.getElementById('btn-cancel-broadcast')?.addEventListener('click', closeBroadcast);

    const formBroadcast = document.getElementById('form-broadcast-alert');
    if (formBroadcast) {
      formBroadcast.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(formBroadcast);
        const title = fd.get('title');
        const severity = fd.get('severity');
        const message = fd.get('message');

        await this.api.broadcastAlert({ title, severity, message });
        formBroadcast.reset();
        closeBroadcast();
        showToast(`Dispatched Broadcast Alert: "${title}"`, severity === 'CRITICAL' ? 'error' : 'warning');
      });
    }

    // Export GeoJSON
    document.getElementById('btn-export-geojson')?.addEventListener('click', () => {
      this._exportGeoJSON();
    });

    // Omnibar & Command Palette (⌘K)
    const modalCmd = document.getElementById('modal-command-palette');
    const cmdInput = document.getElementById('command-palette-input');
    const openCmd = () => {
      if (modalCmd) {
        modalCmd.classList.remove('hidden');
        if (cmdInput) {
          cmdInput.value = '';
          cmdInput.focus();
          this._renderCommandResults('');
        }
      }
    };
    const closeCmd = () => {
      if (modalCmd) modalCmd.classList.add('hidden');
    };

    document.getElementById('omnibar-trigger')?.addEventListener('click', openCmd);

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (modalCmd && !modalCmd.classList.contains('hidden')) {
          closeCmd();
        } else {
          openCmd();
        }
      }
      if (e.key === 'Escape') {
        closeCmd();
        closeAddZone();
        closeBroadcast();
      }
    });

    if (cmdInput) {
      cmdInput.addEventListener('input', (e) => {
        this._renderCommandResults(e.target.value);
      });
    }

    // Walking Directions / Wayfinding
    document.getElementById('btn-inspector-directions')?.addEventListener('click', () => {
      const zoneId = this.state.selectedZoneId || (this.state.zones[0] && this.state.zones[0].id);
      if (zoneId) {
        this._calculateAndDisplayRoute(zoneId);
      }
    });

    document.getElementById('btn-admin-close-directions')?.addEventListener('click', () => {
      this.state.clearRoute();
      document.getElementById('admin-directions-card')?.classList.add('hidden');
    });

    // Event Selector Dropdown Toggle
    const eventBtn = document.getElementById('event-selector-btn');
    const eventMenu = document.getElementById('event-dropdown-menu');
    if (eventBtn && eventMenu) {
      eventBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        eventMenu.classList.toggle('hidden');
      });
      window.addEventListener('click', () => {
        eventMenu.classList.add('hidden');
      });
    }
  }

  async _initEvents() {
    const eventMenu = document.getElementById('event-dropdown-menu');
    const currentLabel = document.getElementById('current-event-name');
    if (!eventMenu) return;

    const events = await this.api.getEvents();
    if (!events || events.length === 0) return;

    const activeEvent = events.find((e) => e.isActive) || events[0];
    if (currentLabel && activeEvent) {
      currentLabel.textContent = activeEvent.name;
    }

    eventMenu.innerHTML = '<div class="px-3 py-1.5 text-[10px] font-mono text-slate-400 uppercase tracking-wider">Switch Event</div>';

    events.forEach((ev) => {
      const btn = document.createElement('button');
      btn.dataset.eventId = ev.id;
      const isActive = ev.id === activeEvent.id;
      btn.className = isActive
        ? 'w-full text-left px-3 py-1.5 text-xs text-white hover:bg-indigo-600/20 flex items-center justify-between font-medium'
        : 'w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 flex items-center justify-between';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = ev.name;
      btn.appendChild(labelSpan);

      if (isActive) {
        const check = document.createElement('span');
        check.className = 'material-symbols-outlined text-[14px] text-indigo-400';
        check.textContent = 'check';
        btn.appendChild(check);
      }

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (currentLabel) currentLabel.textContent = ev.name;
        eventMenu.querySelectorAll('button').forEach((other) => {
          other.className = 'w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 flex items-center justify-between';
          const ch = other.querySelector('.material-symbols-outlined');
          if (ch) ch.remove();
        });
        btn.className = 'w-full text-left px-3 py-1.5 text-xs text-white hover:bg-indigo-600/20 flex items-center justify-between font-medium';
        const ch = document.createElement('span');
        ch.className = 'material-symbols-outlined text-[14px] text-indigo-400';
        ch.textContent = 'check';
        btn.appendChild(ch);
        eventMenu.classList.add('hidden');

        await this.api.setActiveEvent(ev.id);
        showToast(`Switched active event to "${ev.name}"`, 'info');
      });

      eventMenu.appendChild(btn);
    });
  }

  async _initGoogleMaps(apiKey) {
    if (!apiKey) return;
    try {
      if (!window.google?.maps?.places) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
          script.async = true;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      if (window.google?.maps?.places) {
        const dsuBounds = new window.google.maps.LatLngBounds(
          new window.google.maps.LatLng(12.64, 77.43),
          new window.google.maps.LatLng(12.68, 77.47)
        );
        const zoneSearch = document.getElementById('zone-search-input');
        if (zoneSearch) {
          const ac = new window.google.maps.places.Autocomplete(zoneSearch, {
            bounds: dsuBounds,
            types: ['establishment', 'geocode'],
            componentRestrictions: { country: 'in' },
          });
          ac.addListener('place_changed', () => {
            const place = ac.getPlace();
            if (place && place.name) {
              this.state.searchTerm = place.name.toLowerCase().trim();
              this._renderHierarchyTree();
              showToast(`Google Place selected: ${place.name}`, 'info');
            }
          });
        }

        const cmdInput = document.getElementById('command-palette-input');
        if (cmdInput) {
          const acCmd = new window.google.maps.places.Autocomplete(cmdInput, {
            bounds: dsuBounds,
            types: ['establishment', 'geocode'],
            componentRestrictions: { country: 'in' },
          });
          acCmd.addListener('place_changed', () => {
            const place = acCmd.getPlace();
            if (place && place.name) {
              showToast(`Google Place: ${place.name}`, 'info');
            }
          });
        }
      }
    } catch {
      // Graceful fallback to 3D Vector Canvas
    }
  }

  _updatePresetButtons(activeId) {
    const ids = ['cam-perspective', 'cam-topdown', 'cam-stagefront'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        if (id === activeId) {
          el.className = 'px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold bg-indigo-600 text-white shadow-sm transition-all';
        } else {
          el.className = 'px-2.5 py-1 rounded-lg font-mono text-[11px] text-slate-400 hover:text-slate-200 transition-all';
        }
      }
    }
  }

  _renderCommandResults(query) {
    const container = document.getElementById('command-palette-results');
    if (!container) return;

    const q = query.toLowerCase().trim();
    const actions = [
      { name: 'Switch to 3D View', category: 'Mode', action: () => this.state.setMode('3d') },
      { name: 'Switch to Architectural Cad Trace', category: 'Mode', action: () => this.state.setMode('cad') },
      { name: 'Switch to Crowd Density Heatmap', category: 'Mode', action: () => this.state.setMode('heatmap') },
      { name: 'Camera: Perspective Preset', category: 'Camera', action: () => this.state.setCamera({ pitch: 55, yaw: -25, zoom: 1.0 }) },
      { name: 'Camera: Top-Down Planar', category: 'Camera', action: () => this.state.setCamera({ pitch: 88, yaw: 0, zoom: 1.15 }) },
      { name: 'Camera: Stage Front View', category: 'Camera', action: () => this.state.setCamera({ pitch: 28, yaw: 0, zoom: 1.35 }) },
      { name: 'Add New Spatial Zone', category: 'Action', action: () => document.getElementById('btn-quick-add')?.click() },
      { name: 'Broadcast Emergency Alert', category: 'Action', action: () => document.getElementById('btn-broadcast-alert')?.click() },
      { name: 'Export Venue as GeoJSON', category: 'Action', action: () => this._exportGeoJSON() }
    ];

    // Add zones to searchable items
    for (const z of this.state.zones) {
      actions.push({
        name: `🚶 Walking Directions to ${z.name}`,
        category: 'Wayfinding',
        action: () => {
          this.state.setSelectedZone(z.id);
          this._calculateAndDisplayRoute(z.id);
        }
      });
      actions.push({
        name: `Jump to Zone: ${z.name}`,
        category: 'Zones',
        action: () => {
          this.state.setSelectedZone(z.id);
          this.state.setCamera({ panX: -z.x * 1.5, panY: -z.y * 1.5 });
        }
      });
    }

    const filtered = q ? actions.filter(a => a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)) : actions;

    container.innerHTML = '';
    for (const item of filtered) {
      const row = document.createElement('button');
      row.className = 'w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-600/20 text-xs flex items-center justify-between text-slate-200 hover:text-white transition-colors';
      row.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[15px] ${item.category === 'Wayfinding' ? 'text-emerald-400' : 'text-indigo-400'}">${item.category === 'Wayfinding' ? 'directions_walk' : 'arrow_forward'}</span>
          <span>${escapeHtml(item.name)}</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-[#181b25] border border-[#232734]">${escapeHtml(item.category)}</span>
      `;
      row.addEventListener('click', () => {
        document.getElementById('modal-command-palette')?.classList.add('hidden');
        item.action();
      });
      container.appendChild(row);
    }
  }

  async _calculateAndDisplayRoute(destId) {
    try {
      showToast('Calculating walking route from Gate 1...', 'info');

      const res = await fetch(`/api/routes?from=gate1&to=${encodeURIComponent(destId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to calculate route');

      this.state.setRoute(data);

      const card = document.getElementById('admin-directions-card');
      const iconEl = document.getElementById('admin-hud-turn-icon');
      const badgeEl = document.getElementById('admin-hud-turn-badge');
      const distEl = document.getElementById('admin-hud-distance-badge');
      const titleEl = document.getElementById('admin-hud-dest-title');
      const totalDistEl = document.getElementById('admin-hud-total-dist');
      const totalTimeEl = document.getElementById('admin-hud-total-time');
      const stepsListEl = document.getElementById('admin-hud-steps-list');

      const nextTurnStep = data.steps.find(s => s.turnType === 'LEFT' || s.turnType === 'RIGHT' || s.turnType === 'STRAIGHT') || data.steps[0];

      let icon = 'turn_right';
      let badgeText = 'TURN RIGHT';
      let badgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';

      if (nextTurnStep.turnType === 'LEFT') {
        icon = 'turn_left';
        badgeText = 'TURN LEFT';
        badgeClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
      } else if (nextTurnStep.turnType === 'RIGHT') {
        icon = 'turn_right';
        badgeText = 'TURN RIGHT';
        badgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      } else if (nextTurnStep.turnType === 'STRAIGHT') {
        icon = 'straight';
        badgeText = 'STRAIGHT';
        badgeClass = 'bg-blue-500/20 text-blue-300 border border-blue-500/40';
      } else if (nextTurnStep.turnType === 'ARRIVE') {
        icon = 'flag';
        badgeText = 'ARRIVED';
        badgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      }

      if (iconEl) iconEl.textContent = icon;
      if (badgeEl) {
        badgeEl.textContent = badgeText;
        badgeEl.className = `px-1.5 py-0.2 rounded font-mono text-[9px] font-bold uppercase ${badgeClass}`;
      }
      if (distEl) distEl.textContent = `${nextTurnStep.distanceMeters}m`;
      if (titleEl) titleEl.textContent = data.destination.name;
      if (totalDistEl) totalDistEl.textContent = `${data.totalDistanceMeters}m`;
      if (totalTimeEl) totalTimeEl.textContent = `~${data.estimatedWalkingMinutes} min walk`;

      if (stepsListEl) {
        stepsListEl.innerHTML = data.steps.map((s, idx) => {
          let turnPill = '';
          if (s.turnType === 'LEFT') {
            turnPill = '<span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">↰ LEFT</span>';
          } else if (s.turnType === 'RIGHT') {
            turnPill = '<span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">↱ RIGHT</span>';
          } else if (s.turnType === 'ARRIVE') {
            turnPill = '<span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">ARRIVE</span>';
          } else {
            turnPill = '<span class="text-[9px] font-mono text-slate-400 px-1.5 py-0.2 rounded bg-[#0a0e17] border border-[#232734]">STRAIGHT</span>';
          }

          return `
            <div class="p-2 rounded-lg bg-[#0a0e17] border border-[#232734] space-y-1">
              <div class="flex items-center justify-between text-[10px] font-mono">
                <span class="text-slate-400">Step ${idx + 1}</span>
                ${turnPill}
              </div>
              <p class="text-xs text-white leading-snug">${escapeHtml(s.instruction)}</p>
              ${s.landmark ? `<p class="text-[9.5px] font-mono text-slate-400">📍 ${escapeHtml(s.landmark)}</p>` : ''}
              <div class="text-right text-[9.5px] font-mono text-indigo-300">${s.distanceMeters > 0 ? s.distanceMeters + 'm' : 'Arrival'}</div>
            </div>
          `;
        }).join('');
      }

      if (card) card.classList.remove('hidden');

      // Center camera towards route
      if (data.pathPoints && data.pathPoints.length > 0) {
        let midLat = 0, midLng = 0;
        for (const p of data.pathPoints) { midLat += p.lat; midLng += p.lng; }
        midLat /= data.pathPoints.length;
        midLng /= data.pathPoints.length;
        const local = geoToLocal(midLat, midLng);
        this.state.setCamera({ panX: -local.x * 1.2, panY: -local.y * 1.2 });
      }

      showToast(`Route to ${data.destination.name}: ${data.totalDistanceMeters}m (${data.estimatedWalkingMinutes} min walk)`, 'success');
    } catch (err) {
      console.error('[AdminApp] _calculateAndDisplayRoute failed:', err);
      showToast(`Wayfinding error: ${err.message}`, 'error');
    }
  }

  _renderHierarchyTree() {
    const container = document.getElementById('hierarchy-tree-container');
    if (!container) return;

    const searchTerm = this.state.searchTerm;
    const selectedId = this.state.selectedZoneId;

    // Group zones by category dynamically
    const categoryOrder = [
      'Academic Blocks',
      'Healthcare & CDSIMER',
      'Auditoriums & Arenas',
      'Sports & Recreation',
      'Student Amenities',
      'Campus Access & Gates',
    ];
    const categorySet = new Set(categoryOrder);
    for (const z of this.state.zones) {
      if (z.category) categorySet.add(z.category);
    }
    const categories = Array.from(categorySet);
    const grouped = {};
    for (const cat of categories) grouped[cat] = [];

    for (const zone of this.state.zones) {
      const cat = zone.category || 'Academic Blocks';
      if (!grouped[cat]) grouped[cat] = [];
      if (!searchTerm || zone.name.toLowerCase().includes(searchTerm)) {
        grouped[cat].push(zone);
      }
    }

    const totalBadge = document.getElementById('zone-total-badge');
    if (totalBadge) totalBadge.textContent = `${this.state.zones.length} Zones`;

    container.innerHTML = '';

    for (const cat of categories) {
      const zonesInCat = grouped[cat] || [];
      if (zonesInCat.length === 0 && searchTerm) continue;
      const isCollapsed = this.state.collapsedCategories.has(cat);

      const section = document.createElement('div');
      section.className = 'space-y-1';

      // Collapsible category header
      const header = document.createElement('button');
      header.className = 'w-full flex items-center justify-between px-2 py-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition-colors uppercase tracking-wider font-semibold';
      header.innerHTML = `
        <div class="flex items-center gap-1">
          <span class="material-symbols-outlined text-[14px] transition-transform ${isCollapsed ? '-rotate-90' : ''}">expand_more</span>
          <span>${escapeHtml(cat)}</span>
        </div>
        <span class="text-[10px] text-slate-500">${zonesInCat.length}</span>
      `;

      header.addEventListener('click', () => {
        if (this.state.collapsedCategories.has(cat)) {
          this.state.collapsedCategories.delete(cat);
        } else {
          this.state.collapsedCategories.add(cat);
        }
        this._renderHierarchyTree();
      });

      section.appendChild(header);

      // Zones list inside category
      if (!isCollapsed) {
        const list = document.createElement('div');
        list.className = 'space-y-1 pl-1';

        for (const zone of zonesInCat) {
          const occ = this.state.getZoneOccupancy(zone.id);
          const density = occ.density;
          const isSelected = zone.id === selectedId;

          let badgeColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
          let dotColor = 'bg-emerald-400';
          if (density >= DENSITY_THRESHOLDS.HIGH) {
            badgeColor = 'text-rose-400 bg-rose-500/10 border-rose-500/30';
            dotColor = 'bg-rose-400 animate-pulse';
          } else if (density >= DENSITY_THRESHOLDS.MODERATE) {
            badgeColor = 'text-amber-400 bg-amber-500/10 border-amber-500/30';
            dotColor = 'bg-amber-400';
          }

          const card = document.createElement('div');
          card.setAttribute('data-zone-id', zone.id);
          card.className = `p-2 rounded-lg cursor-pointer transition-all border ${
            isSelected
              ? 'bg-[#181b25] border-indigo-500 shadow-md shadow-indigo-500/10'
              : 'bg-[#181b25]/60 hover:bg-[#181b25] border-[#232734]'
          }`;

          const wifi = occ.wifi || {};
          const apLabel = wifi.apName || `${zone.elevationMeters}m H`;

          card.innerHTML = `
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-1.5 truncate">
                <span class="w-1.5 h-1.5 rounded-full ${dotColor} shrink-0"></span>
                <span class="text-xs font-medium ${isSelected ? 'text-white font-semibold' : 'text-slate-300'} truncate">${escapeHtml(zone.name)}</span>
              </div>
              <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${badgeColor}">
                ${Math.round(density)}%
              </span>
            </div>
            <div class="w-full bg-[#0a0e17] rounded-full h-1.5 overflow-hidden">
              <div class="h-full rounded-full transition-all duration-300 ${
                density >= DENSITY_THRESHOLDS.HIGH ? 'bg-rose-500' :
                density >= DENSITY_THRESHOLDS.MODERATE ? 'bg-amber-400' : 'bg-emerald-400'
              }" style="width: ${Math.min(100, Math.max(density > 0 ? 3 : 0, density))}%"></div>
            </div>
            <div class="flex justify-between items-center mt-1 text-[9px] font-mono text-slate-400">
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[11px] text-indigo-400">wifi</span>
                <span><strong class="text-slate-200">${occ.count.toLocaleString()}</strong> / ${zone.capacity.toLocaleString()}</span>
              </span>
              <span class="text-slate-500">${escapeHtml(apLabel)}</span>
            </div>
          `;

          card.addEventListener('click', () => {
            this.state.setSelectedZone(zone.id);
          });

          list.appendChild(card);
        }
        section.appendChild(list);
      }

      container.appendChild(section);
    }
  }

  _renderInspector() {
    const selected = this.state.getSelectedZone();
    if (!selected) return;

    const occ = this.state.getZoneOccupancy(selected.id);
    const density = occ.density;

    // Header info
    const nameEl = document.getElementById('inspector-zone-name');
    const idEl = document.getElementById('inspector-zone-id');
    const catEl = document.getElementById('inspector-zone-category');
    const badgeEl = document.getElementById('inspector-status-badge');

    if (nameEl) nameEl.textContent = selected.name;
    if (idEl) idEl.textContent = selected.id.toUpperCase();
    if (catEl) catEl.textContent = `${selected.category || 'Stages'} • Extruded Mesh`;

    if (badgeEl) {
      if (density >= DENSITY_THRESHOLDS.HIGH) {
        badgeEl.textContent = 'CRITICAL DENSITY';
        badgeEl.className = 'px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30';
      } else if (density >= DENSITY_THRESHOLDS.MODERATE) {
        badgeEl.textContent = 'MODERATE FLOW';
        badgeEl.className = 'px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30';
      } else {
        badgeEl.textContent = 'LOW DENSITY';
        badgeEl.className = 'px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      }
    }

    // Occupancy Progress
    const countEl = document.getElementById('inspector-occupancy-count');
    const capEl = document.getElementById('inspector-occupancy-capacity');
    const pctEl = document.getElementById('inspector-occupancy-pct');
    const barEl = document.getElementById('inspector-occupancy-bar');

    if (countEl) countEl.textContent = occ.count.toLocaleString();
    if (capEl) capEl.textContent = selected.capacity.toLocaleString();
    if (pctEl) {
      pctEl.textContent = `${Math.round(density)}%`;
      pctEl.className = `font-mono text-xs font-bold ${
        density >= DENSITY_THRESHOLDS.HIGH ? 'text-rose-400' :
        density >= DENSITY_THRESHOLDS.MODERATE ? 'text-amber-400' : 'text-emerald-400'
      }`;
    }
    if (barEl) {
      barEl.style.width = `${Math.min(100, density)}%`;
      barEl.className = `h-full rounded-full transition-all duration-500 ${
        density >= DENSITY_THRESHOLDS.HIGH ? 'bg-rose-500' :
        density >= DENSITY_THRESHOLDS.MODERATE ? 'bg-amber-400' : 'bg-emerald-400'
      }`;
    }

    // Wi-Fi Access Point Details
    const wifi = occ.wifi || {};
    const wifiSsidEl = document.getElementById('inspector-wifi-ssid');
    const wifiApEl = document.getElementById('inspector-wifi-ap');
    const wifiClientsEl = document.getElementById('inspector-wifi-clients');
    const wifiSignalEl = document.getElementById('inspector-wifi-signal');

    if (wifiSsidEl) wifiSsidEl.textContent = wifi.ssid || 'DSU-Student-5G';
    if (wifiApEl) wifiApEl.textContent = wifi.apName || `AP-DSU-${selected.id.slice(-6).toUpperCase()}`;
    if (wifiClientsEl) wifiClientsEl.textContent = occ.count.toLocaleString();
    if (wifiSignalEl) wifiSignalEl.textContent = `${wifi.signalDbm || -52} dBm (${wifi.band || '5GHz'})`;

    // Elevation Slider & Geometry Readouts
    const elevSlider = document.getElementById('inspector-elevation-slider');
    const elevVal = document.getElementById('inspector-elevation-val');
    const widthVal = document.getElementById('inspector-width-val');
    const depthVal = document.getElementById('inspector-depth-val');

    if (elevSlider) elevSlider.value = selected.elevationMeters || 15;
    if (elevVal) elevVal.textContent = `${(selected.elevationMeters || 15).toFixed(1)}m`;
    if (widthVal) widthVal.textContent = `${(selected.width || 45).toFixed(1)}m`;
    if (depthVal) depthVal.textContent = `${(selected.depth || 30).toFixed(1)}m`;

    // Access Governance Chips
    const tier = selected.accessTier || 'PUBLIC';
    const chipPublic = document.getElementById('tier-chip-public');
    const chipVip = document.getElementById('tier-chip-vip');
    const chipRestricted = document.getElementById('tier-chip-restricted');
    const descEl = document.getElementById('tier-description');

    const activeChipClass = 'py-1 px-1 rounded text-center text-[10px] font-mono font-semibold bg-emerald-600 text-white shadow-sm transition-all';
    const activeVipClass = 'py-1 px-1 rounded text-center text-[10px] font-mono font-semibold bg-indigo-600 text-white shadow-sm transition-all';
    const activeRestrictedClass = 'py-1 px-1 rounded text-center text-[10px] font-mono font-semibold bg-rose-600 text-white shadow-sm transition-all';
    const inactiveChipClass = 'py-1 px-1 rounded text-center text-[10px] font-mono font-medium text-slate-400 hover:text-slate-200 transition-all';

    if (chipPublic) chipPublic.className = tier === 'PUBLIC' ? activeChipClass : inactiveChipClass;
    if (chipVip) chipVip.className = tier === 'VIP' ? activeVipClass : inactiveChipClass;
    if (chipRestricted) chipRestricted.className = tier === 'RESTRICTED' ? activeRestrictedClass : inactiveChipClass;

    if (descEl) {
      descEl.textContent = tier === 'PUBLIC'
        ? 'Visible on public attendee mobile app with standard credentials.'
        : tier === 'VIP'
        ? 'Restricted to verified VIP passes & speakers only.'
        : 'Restricted corridor; operational personnel & emergency access.';
    }

    // Stage & Session Controller
    const session = this.state.getSelectedSession();
    const sessionTitle = document.getElementById('session-title');
    const sessionTimer = document.getElementById('session-timer');
    const speakerAvatar = document.getElementById('session-speaker-avatar');
    const speakerName = document.getElementById('session-speaker-name');
    const speakerRole = document.getElementById('session-speaker-role');
    const sessionAttendees = document.getElementById('session-attendees');
    const sessionBadge = document.getElementById('session-status-badge');

    if (session) {
      if (sessionTitle) sessionTitle.textContent = session.title;
      if (speakerName) speakerName.textContent = session.speaker || 'Unscheduled Speaker';
      if (speakerRole) speakerRole.textContent = session.speakerRole || 'Featured Presenter';
      if (sessionAttendees) sessionAttendees.textContent = occ.count.toLocaleString();

      if (speakerAvatar) {
        const initials = (session.speaker || 'OP').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2);
        speakerAvatar.textContent = initials || 'OP';
      }

      if (sessionBadge) {
        const isLive = session.status === 'LIVE';
        sessionBadge.className = `px-2 py-0.5 rounded font-mono text-[10px] font-bold flex items-center gap-1 ${
          isLive
            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            : session.status === 'UPCOMING'
            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
            : 'bg-slate-700/40 text-slate-400 border border-slate-700'
        }`;
        sessionBadge.innerHTML = `
          <span class="h-1.5 w-1.5 rounded-full ${isLive ? 'bg-rose-500 animate-pulse' : 'bg-indigo-400'}"></span>
          <span>${session.status}</span>
        `;
      }

      if (sessionTimer) {
        if (session.status === 'LIVE') {
          const endTime = session.endTimeMs ?? session.endTime ?? (Date.now() + 1800000);
          const diff = Math.max(0, endTime - Date.now());
          const mins = Math.floor(diff / 60000);
          const secs = Math.floor((diff % 60000) / 1000);
          sessionTimer.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs} left`;
        } else if (session.status === 'UPCOMING') {
          sessionTimer.textContent = 'Scheduled';
        } else {
          sessionTimer.textContent = 'Concluded';
        }
      }
    } else {
      if (sessionTitle) sessionTitle.textContent = 'Open Space / Free Flow';
      if (speakerName) speakerName.textContent = 'Unscheduled';
      if (speakerRole) speakerRole.textContent = 'Open Navigation';
      if (sessionTimer) sessionTimer.textContent = 'Idle';
      if (sessionBadge) {
        sessionBadge.className = 'px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-700/40 text-slate-400 border border-slate-700';
        sessionBadge.textContent = 'IDLE';
      }
    }
  }

  _renderTelemetryBar() {
    let totalDevices = 0;
    let totalCapacity = 0;

    for (const zone of this.state.zones) {
      const occ = this.state.getZoneOccupancy(zone.id);
      totalDevices += occ.count;
      totalCapacity += zone.capacity;
    }

    const avgDensity = totalCapacity > 0 ? (totalDevices / totalCapacity) * 100 : 0;

    const devicesEl = document.getElementById('telemetry-devices-count');
    const densityEl = document.getElementById('telemetry-avg-density');
    const apsEl = document.getElementById('telemetry-aps-count');

    if (devicesEl) devicesEl.textContent = totalDevices.toLocaleString();
    if (apsEl) apsEl.textContent = `${this.state.zones.length} ONLINE`;
    if (densityEl) {
      densityEl.textContent = `${avgDensity.toFixed(1)}%`;
      densityEl.className = `font-mono font-bold text-[11px] ${
        avgDensity >= DENSITY_THRESHOLDS.HIGH ? 'text-rose-400' :
        avgDensity >= DENSITY_THRESHOLDS.MODERATE ? 'text-amber-400' : 'text-emerald-400'
      }`;
    }
  }

  _startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(async () => {
      const occupancy = await this.api.getOccupancy();
      this.state.setOccupancy(occupancy);
    }, 2000);
  }

  _exportGeoJSON() {
    const activeEvent = this.state.events.find(e => e.isActive) || { name: 'Dayananda_Sagar_University_Main_Campus' };
    const featureCollection = {
      type: 'FeatureCollection',
      name: `${activeEvent.name.replace(/\s+/g, '_')}_Spatial_Twin`,
      crs: {
        type: 'name',
        properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' }
      },
      features: this.state.zones.map(z => {
        let coordinates;
        if (z.boundary && Array.isArray(z.boundary.vertices) && z.boundary.vertices.length >= 3) {
          const ring = z.boundary.vertices.map(v => [v.lng, v.lat]);
          if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
            ring.push([ring[0][0], ring[0][1]]);
          }
          coordinates = [ring];
        } else {
          const METERS_PER_DEGREE_LAT = 111139;
          const METERS_PER_DEGREE_LNG = 111139 * Math.cos((12.6606692 * Math.PI) / 180);
          const cLng = 77.4508399 + (z.x / METERS_PER_DEGREE_LNG);
          const cLat = 12.6606692 + (z.y / METERS_PER_DEGREE_LAT);
          const halfW = (z.width / 2) / METERS_PER_DEGREE_LNG;
          const halfD = (z.depth / 2) / METERS_PER_DEGREE_LAT;
          coordinates = [[
            [cLng - halfW, cLat - halfD],
            [cLng + halfW, cLat - halfD],
            [cLng + halfW, cLat + halfD],
            [cLng - halfW, cLat + halfD],
            [cLng - halfW, cLat - halfD],
          ]];
        }
        const occ = this.state.getZoneOccupancy(z.id);

        return {
          type: 'Feature',
          id: z.id,
          properties: {
            id: z.id,
            name: z.name,
            category: z.category,
            elevationMeters: z.elevationMeters,
            capacity: z.capacity,
            accessTier: z.accessTier,
            occupancy: occ.count,
            densityPercentage: occ.density
          },
          geometry: {
            type: 'Polygon',
            coordinates
          }
        };
      })
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(featureCollection, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `dsu_campus_twin_${Date.now()}.geojson`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    showToast('Exported GeoJSON Spatial Twin', 'success');
  }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AdminApp();
  window.adminApp = app;
  app.init().catch(err => {
    console.error('Fatal initialization error in AdminApp:', err);
    showToast('Failed to initialize operations studio', 'error');
  });
});
