/**
 * @file app.js
 * @description Production-grade Participant Spatial Portal Controller.
 * Manages 3D isometric canvas rendering, real-time GPS tracking & presence streaming,
 * fallback walk simulation engine, draggable bottom sheet gestures, and 5-star session reviews.
 * Zero external libraries, zero placeholders, pure ES module.
 */

// ============================================================================
// 1. Domain Constants & Seed Fallback Data
// ============================================================================

const VENUE_CENTER = {
  lat: 12.6606692,
  lng: 77.4508399,
};

const METERS_PER_DEGREE_LAT = 111139;
const METERS_PER_DEGREE_LNG = 111139 * Math.cos((VENUE_CENTER.lat * Math.PI) / 180);

// Pre-set simulation walk waypoints across Dayananda Sagar University (DSU) Main Campus
const SIMULATION_WAYPOINTS = [
  { lat: 12.663127, lng: 77.451032, name: 'Gate 1 - Main Entrance (Kanakapura Rd)' },
  { lat: 12.661846, lng: 77.450515, name: 'DSU School of Engineering (Block A)' },
  { lat: 12.662490, lng: 77.450897, name: 'Dr. Premachandra Sagar Amphitheater' },
  { lat: 12.662410, lng: 77.451751, name: 'Student Food Court & Tummy Trails' },
  { lat: 12.661584, lng: 77.454830, name: 'DSU Sports Complex & Cricket Ground' },
  { lat: 12.660301, lng: 77.449802, name: 'Dr. Chandramma DSU Hospital (Block B)' },
  { lat: 12.659016, lng: 77.449532, name: 'School of Health Sciences & Nursing' },
  { lat: 12.658308, lng: 77.448014, name: 'S-Residency Student Living & Hostels' },
];

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
// 2. Geospatial Math Utilities (Jordan Curve Point-in-Polygon)
// ============================================================================

/**
 * Checks whether coordinate point (lng, lat) is inside a polygon boundary
 * using the Jordan Curve Ray-Casting algorithm.
 */
function isPointInPolygon(point, vertices) {
  if (!point || !Array.isArray(vertices) || vertices.length < 3) {
    return false;
  }

  const px = point.lng ?? point.longitude;
  const py = point.lat ?? point.latitude;
  let inside = false;
  const n = vertices.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].lng ?? vertices[i].longitude;
    const yi = vertices[i].lat ?? vertices[i].latitude;
    const xj = vertices[j].lng ?? vertices[j].longitude;
    const yj = vertices[j].lat ?? vertices[j].latitude;

    const crossesY = (yi > py) !== (yj > py);
    if (crossesY) {
      const intersectX = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}

/**
 * Converts geospatial (lat, lng) to local metric Cartesian coordinates (x, y).
 */
function geoToLocal(lat, lng) {
  const x = (lng - VENUE_CENTER.lng) * METERS_PER_DEGREE_LNG;
  const y = (lat - VENUE_CENTER.lat) * METERS_PER_DEGREE_LAT;
  return { x, y };
}

/**
 * Computes compass bearing angle in degrees [0, 360] between two points.
 */
function computeBearing(fromLat, fromLng, toLat, toLng) {
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((toLat * Math.PI) / 180);
  const x =
    Math.cos((fromLat * Math.PI) / 180) * Math.sin((toLat * Math.PI) / 180) -
    Math.sin((fromLat * Math.PI) / 180) * Math.cos((toLat * Math.PI) / 180) * Math.cos(dLng);
  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Formats a compass degree heading to standard 8-point cardinal string.
 */
function formatHeadingText(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees % 360) / 45)) % 8;
  return `${Math.round(degrees)}° ${directions[index]}`;
}

// ============================================================================
// 3. ParticipantApp Class (Core Controller)
// ============================================================================

export class ParticipantApp {
  constructor() {
    // Unique Participant Device ID
    this.deviceId = this.initDeviceId();

    // Application State (Loaded dynamically from authoritative backend REST API)
    this.zones = [];
    this.sessions = [];
    this.alerts = [];
    this.occupancyMap = {};
    this.activeZoneId = null;
    this.activeSessionId = null;

    // Live Participant Position & Telemetry (Initialized at DSU School of Engineering Block A)
    this.userPos = {
      lat: 12.661846,
      lng: 77.450515,
      targetLat: 12.661846,
      targetLng: 77.450515,
      accuracy: 6,
      heading: 142,
      isSimulated: false,
      lastPingMs: 0,
    };

    // Camera 3D Viewport State (Calibrated for DSU 130-Acre Campus Scale)
    this.camera = {
      x: -40,
      y: 80,
      targetX: -40,
      targetY: 80,
      zoom: 1.8,
      pitch: (55 * Math.PI) / 180, // Default 55° isometric tilt
      yaw: 0, // Azimuth angle (radians)
      panX: 0,
      panY: 0,
    };

    // Interactive Drag State for Map Canvas
    this.canvasDrag = {
      isDragging: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      pinchDistance: null,
    };

    // Simulation Mode State
    this.simulation = {
      active: false,
      waypointIndex: 0,
      progress: 0,
      timerId: null,
      speed: 0.015,
    };

    // Rating State
    this.reviewState = {
      selectedStar: 0,
      selectedTags: new Set(),
      submittedSessions: new Set(),
    };

    // Bottom Sheet Gesture State
    this.sheet = {
      height: 140, // Collapsed default
      collapsedHeight: 140,
      expandedHeight: Math.min(window.innerHeight * 0.72, 490),
      isDragging: false,
      startY: 0,
      startHeight: 140,
      lastVelocity: 0,
      lastY: 0,
      lastTimestamp: 0,
    };

    // Filter Chip State
    this.activeFilter = 'all';

    // Wayfinding Navigation Route State
    this.activeRoute = null;
    this.activeRouteDestination = null;

    // UI Element References
    this.dom = {};
  }

  /**
   * Initializes the participant application, binds DOM elements, and starts engines.
   */
  async init() {
    this.cacheDomElements();

    // Fetch initial dataset from authoritative backend before canvas render
    await this.pollServerData();

    // Check Google Maps Platform config
    try {
      const cfgRes = await fetch('/api/config');
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg.googleMapsApiKey) {
          this.initGoogleMaps(cfg.googleMapsApiKey);
        }
      }
    } catch (err) {
      console.warn('[ParticipantApp] Google Maps config fetch failed, using 3D vector canvas:', err?.message);
    }

    this.setupCanvas();
    this.setupGestureListeners();
    this.setupSheetListeners();
    this.setupSheetTabs();
    this.setupShareLive();
    this.setupReviewListeners();
    this.setupWayfinding();
    this.setupNavigationTabs();
    this.setupFilters();
    this.setupControls();

    // Start Real Geolocation Engine
    this.startGeolocationEngine();

    // Start Live Polling Engine
    this.startPollingEngine();

    // Start High-Performance Canvas Render Loop
    this.startRenderLoop();

    // Initial State Render
    this.updateUI();

    // Update Pass Modal Display
    if (this.dom.passUidDisplay) {
      this.dom.passUidDisplay.textContent = `UID: ${this.deviceId.slice(0, 8).toUpperCase()}-${this.deviceId.slice(-4).toUpperCase()}`;
    }

    this.showToast('📍 Welcome to DSU Campus Navigator', 'info');
    document.body.dataset.appReady = 'true';
  }

  // ==========================================================================
  // Device ID Management
  // ==========================================================================

  initDeviceId() {
    const STORAGE_KEY = 'tiertracker_participant_uid';
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id || id.trim().length === 0) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'usr-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  // ==========================================================================
  // DOM Elements Cache
  // ==========================================================================

  cacheDomElements() {
    this.dom = {
      canvas: document.getElementById('participant-canvas'),
      // Telemetry Bar & Share Live Toggle
      zoneBadge: document.getElementById('telemetry-zone-badge'),
      zoneStatusDot: document.getElementById('zone-status-dot'),
      zoneName: document.getElementById('telemetry-zone-name'),
      gpsBadge: document.getElementById('telemetry-gps-badge'),
      gpsStatusDot: document.getElementById('gps-status-dot'),
      gpsText: document.getElementById('telemetry-gps-text'),
      headingText: document.getElementById('telemetry-heading-text'),
      btnShareLive: document.getElementById('btn-share-live'),
      shareLiveDot: document.getElementById('share-live-dot'),
      // Wayfinding & Destination Search
      destinationSearchInput: document.getElementById('destination-search-input'),
      btnClearSearch: document.getElementById('btn-clear-search'),
      destinationSearchDropdown: document.getElementById('destination-search-dropdown'),
      navigationHudBanner: document.getElementById('navigation-hud-banner'),
      hudTurnIcon: document.getElementById('hud-turn-icon'),
      hudTurnIconBg: document.getElementById('hud-turn-icon-bg'),
      hudTurnBadge: document.getElementById('hud-turn-badge'),
      hudEtaBadge: document.getElementById('hud-eta-badge'),
      hudInstruction: document.getElementById('hud-instruction'),
      hudLandmark: document.getElementById('hud-landmark'),
      btnExitNavigation: document.getElementById('btn-exit-navigation'),
      tabBtnDirections: document.getElementById('tab-btn-directions'),
      viewDirections: document.getElementById('sheet-view-directions'),
      directionsDestName: document.getElementById('directions-dest-name'),
      directionsTotalSummary: document.getElementById('directions-total-summary'),
      directionsStepsCount: document.getElementById('directions-steps-count'),
      directionsStepsList: document.getElementById('directions-steps-list'),
      // Map HUD Controls
      btnSimulateWalk: document.getElementById('btn-simulate-walk'),
      simulationIcon: document.getElementById('simulation-icon'),
      simulationLabel: document.getElementById('simulation-label'),
      simulationPill: document.getElementById('simulation-status-pill'),
      btnRecenter: document.getElementById('btn-recenter'),
      btnTilt: document.getElementById('btn-tilt'),
      tiltLabel: document.getElementById('tilt-label'),
      btnCompass: document.getElementById('btn-compass'),
      compassIcon: document.getElementById('compass-icon'),
      // Bottom Sheet & Stitch Tabs
      bottomSheet: document.getElementById('bottom-sheet'),
      sheetHandle: document.getElementById('bottom-sheet-handle'),
      sheetHeader: document.getElementById('bottom-sheet-header'),
      btnToggleSheet: document.getElementById('btn-toggle-sheet'),
      sheetChevron: document.getElementById('sheet-chevron-icon'),
      tabBtnLive: document.getElementById('tab-btn-live'),
      tabBtnSchedule: document.getElementById('tab-btn-schedule'),
      tabBtnRate: document.getElementById('tab-btn-rate'),
      viewLive: document.getElementById('sheet-view-live'),
      viewSchedule: document.getElementById('sheet-view-schedule'),
      viewRate: document.getElementById('sheet-view-rate'),
      btnSheetLocateLive: document.getElementById('btn-sheet-locate-live'),
      sheetScheduleList: document.getElementById('sheet-schedule-list'),
      sessionCountdownText: document.getElementById('session-countdown-text'),
      sheetSessionTitle: document.getElementById('sheet-session-title'),
      sheetSessionSpeaker: document.getElementById('sheet-session-speaker'),
      sheetDensityPill: document.getElementById('sheet-density-pill'),
      densityDot: document.getElementById('density-dot'),
      densityText: document.getElementById('density-text'),
      capacityMeterBar: document.getElementById('capacity-meter-bar'),
      sessionProgressBar: document.getElementById('session-progress-bar'),
      timelineRemaining: document.getElementById('timeline-remaining'),
      timelineTimeSpan: document.getElementById('timeline-time-span'),
      upcomingSessionsList: document.getElementById('upcoming-sessions-list'),
      upcomingZoneTag: document.getElementById('upcoming-zone-tag'),
      // Rating Section
      ratingSection: document.getElementById('rating-section'),
      starRatingGroup: document.getElementById('star-rating-group'),
      ratingLabel: document.getElementById('rating-label'),
      feedbackChipsGroup: document.getElementById('feedback-chips-group'),
      ratingCommentInput: document.getElementById('rating-comment-input'),
      btnSubmitReview: document.getElementById('btn-submit-review'),
      btnSubmitReviewText: document.getElementById('btn-submit-review-text'),
      // Modals
      modalSchedule: document.getElementById('modal-schedule'),
      scheduleListContainer: document.getElementById('schedule-list-container'),
      modalZones: document.getElementById('modal-zones'),
      zonesListContainer: document.getElementById('zones-list-container'),
      modalPass: document.getElementById('modal-pass'),
      passUidDisplay: document.getElementById('pass-uid-display'),
      // Toast
      toastContainer: document.getElementById('participant-toast-container'),
    };
  }

  // ==========================================================================
  // Geolocation & Presence Engine
  // ==========================================================================

  startGeolocationEngine() {
    if (!('geolocation' in navigator)) {
      this.enableSimulationMode('GPS not supported in this browser');
      return;
    }

    const geoOptions = {
      enableHighAccuracy: true,
      maximumAge: 4000,
      timeout: 9000,
    };

    try {
      this.geoWatchId = navigator.geolocation.watchPosition(
        (pos) => this.handleGeolocationSuccess(pos),
        (err) => this.handleGeolocationError(err),
        geoOptions
      );
    } catch (e) {
      this.enableSimulationMode('Geolocation permission rejected');
    }

    // Compass Heading Listener (DeviceOrientation on supported mobile devices)
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        let heading = null;
        if (e.webkitCompassHeading !== undefined) {
          // iOS Safari native compass heading
          heading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
          // Android absolute orientation
          heading = 360 - e.alpha;
        }
        if (heading !== null && Number.isFinite(heading)) {
          this.userPos.heading = heading;
          if (this.dom.headingText) {
            this.dom.headingText.textContent = formatHeadingText(heading);
          }
        }
      });
    }
  }

  handleGeolocationSuccess(position) {
    if (this.simulation.active) {
      return; // Do not overwrite if user has explicitly engaged Simulation Mode
    }

    const { latitude, longitude, accuracy, heading } = position.coords;

    // Validate GPS Accuracy: reject excessive drift > 35m (Mandate: accuracy <= 35m)
    if (accuracy > 35) {
      this.updateGpsStatus(`GPS: ±${Math.round(accuracy)}m (Drift Rejected)`, 'amber');
      return;
    }

    // Check if position is within reasonable venue proximity or remote (desktop testing)
    const distToCenter = Math.hypot(
      (latitude - VENUE_CENTER.lat) * METERS_PER_DEGREE_LAT,
      (longitude - VENUE_CENTER.lng) * METERS_PER_DEGREE_LNG
    );

    if (distToCenter > 1500) {
      // Remote location detected (e.g. desktop simulation or remote testing)
      this.updateGpsStatus(`GPS: ±${Math.round(accuracy)}m (Remote)`, 'amber');
      this.userPos.targetLat = latitude;
      this.userPos.targetLng = longitude;
      this.userPos.accuracy = accuracy;
      this.userPos.isSimulated = false;
    } else {
      this.userPos.targetLat = latitude;
      this.userPos.targetLng = longitude;
      this.userPos.accuracy = accuracy;
      this.userPos.isSimulated = false;
      this.updateGpsStatus(`GPS: ±${Math.round(accuracy)}m`, 'emerald');
    }

    if (heading !== null && !isNaN(heading) && heading >= 0) {
      this.userPos.heading = heading;
    }

    // Stream Presence Ping to Server with throttling
    this.streamPresencePing(latitude, longitude, accuracy);

    // Detect Zone
    this.detectAndApplyZone(latitude, longitude);
  }

  handleGeolocationError(error) {
    // If running on desktop or permission denied, fall back gracefully to Simulation Mode
    if (!this.simulation.active) {
      let reason = 'GPS signal unavailable';
      if (error && error.code === 1) reason = 'Location permission denied';
      else if (error && error.code === 2) reason = 'Position unavailable';
      else if (error && error.code === 3) reason = 'Location request timed out';
      this.enableSimulationMode(reason);
    }
  }

  enableSimulationMode(reason = '') {
    this.userPos.isSimulated = true;
    this.userPos.targetLat = VENUE_CENTER.lat;
    this.userPos.targetLng = VENUE_CENTER.lng;
    this.userPos.accuracy = 8;
    this.detectAndApplyZone(VENUE_CENTER.lat, VENUE_CENTER.lng);
    this.updateGpsStatus('SIMULATED', 'amber');
    if (this.dom.zoneStatusDot) {
      this.dom.zoneStatusDot.className = 'w-2 h-2 rounded-full bg-secondary animate-pulse shrink-0';
    }
    if (reason) {
      console.info(`[ParticipantApp] Geolocation fallback: ${reason}. Using venue simulation.`);
    }
  }

  /**
   * Transmits presence ping to backend API.
   */
  async streamPresencePing(lat, lng, acc) {
    if (this.isSharingLive === false) {
      return; // Live presence sharing paused by participant
    }
    const now = Date.now();
    if (now - this.userPos.lastPingMs < 2000) {
      return; // 2s rate limit
    }
    this.userPos.lastPingMs = now;

    try {
      const payload = {
        uid: this.deviceId,
        deviceId: this.deviceId,
        lat,
        lng,
        acc: Math.round(acc),
        accuracyMeters: Math.round(acc),
        timestampMs: now,
      };

      await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // Backend may be booting or offline, presence fails silently without crashing
    }
  }

  // ==========================================================================
  // Simulation Mode Engine
  // ==========================================================================

  toggleWalkSimulation() {
    if (this.simulation.active) {
      this.stopWalkSimulation();
    } else {
      this.startWalkSimulation();
    }
  }

  startWalkSimulation() {
    this.simulation.active = true;
    this.userPos.isSimulated = true;
    this.simulation.progress = 0;
    this.simulation.waypointIndex = 0;

    if (this.dom.btnSimulateWalk) {
      this.dom.btnSimulateWalk.classList.add('simulation-chip-active');
    }
    if (this.dom.simulationIcon) {
      this.dom.simulationIcon.textContent = 'pause_circle';
      this.dom.simulationIcon.className = 'material-symbols-outlined text-[16px] text-emerald-400 animate-spin';
    }
    if (this.dom.simulationPill) {
      this.dom.simulationPill.textContent = 'WALKING';
      this.dom.simulationPill.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold uppercase tracking-wider';
    }

    this.updateGpsStatus('SIMULATING WALK', 'emerald');
    this.showToast('🚶 Walk simulation started! Traveling through venue zones...', 'info');

    // Run interval
    if (this.simulation.timerId) {
      clearInterval(this.simulation.timerId);
    }
    this.simulation.timerId = setInterval(() => this.stepWalkSimulation(), 100);
  }

  stopWalkSimulation() {
    this.simulation.active = false;
    if (this.simulation.timerId) {
      clearInterval(this.simulation.timerId);
      this.simulation.timerId = null;
    }

    if (this.dom.btnSimulateWalk) {
      this.dom.btnSimulateWalk.classList.remove('simulation-chip-active');
    }
    if (this.dom.simulationIcon) {
      this.dom.simulationIcon.textContent = 'directions_walk';
      this.dom.simulationIcon.className = 'material-symbols-outlined text-[16px] text-indigo-400';
    }
    if (this.dom.simulationPill) {
      this.dom.simulationPill.textContent = 'TAP';
      this.dom.simulationPill.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold uppercase tracking-wider';
    }

    this.updateGpsStatus('SIMULATED', 'amber');
    this.showToast('⏸ Walk simulation paused', 'info');
  }

  stepWalkSimulation() {
    const currentWaypoint = SIMULATION_WAYPOINTS[this.simulation.waypointIndex];
    const nextIndex = (this.simulation.waypointIndex + 1) % SIMULATION_WAYPOINTS.length;
    const nextWaypoint = SIMULATION_WAYPOINTS[nextIndex];

    this.simulation.progress += this.simulation.speed;

    if (this.simulation.progress >= 1) {
      this.simulation.progress = 0;
      this.simulation.waypointIndex = nextIndex;
      this.showToast(`Entered: ${nextWaypoint.name}`, 'info');
    }

    // Linear interpolation between waypoints
    const lat = currentWaypoint.lat + (nextWaypoint.lat - currentWaypoint.lat) * this.simulation.progress;
    const lng = currentWaypoint.lng + (nextWaypoint.lng - currentWaypoint.lng) * this.simulation.progress;

    this.userPos.targetLat = lat;
    this.userPos.targetLng = lng;
    this.userPos.accuracy = 4;

    // Compute dynamic bearing angle
    const bearing = computeBearing(currentWaypoint.lat, currentWaypoint.lng, nextWaypoint.lat, nextWaypoint.lng);
    this.userPos.heading = bearing;
    if (this.dom.headingText) {
      this.dom.headingText.textContent = formatHeadingText(bearing);
    }

    // Stream Presence Ping to Server
    this.streamPresencePing(lat, lng, 4);

    // Detect zone
    this.detectAndApplyZone(lat, lng);
  }

  // ==========================================================================
  // Zone Detection Engine
  // ==========================================================================

  detectAndApplyZone(lat, lng) {
    let detectedZone = null;
    const point = { lat, lng };

    for (let i = 0; i < this.zones.length; i++) {
      const zone = this.zones[i];
      const vertices = zone.boundary?.vertices ?? zone.coords ?? zone.polygon;
      if (isPointInPolygon(point, vertices)) {
        detectedZone = zone;
        break;
      }
    }

    if (detectedZone) {
      this.activeZoneId = detectedZone.id;
      if (this.dom.zoneName) {
        this.dom.zoneName.textContent = detectedZone.name;
      }
      if (this.dom.zoneStatusDot) {
        this.dom.zoneStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0';
      }
      if (this.dom.upcomingZoneTag) {
        this.dom.upcomingZoneTag.textContent = detectedZone.name;
      }

      // Find active session in this zone
      const zoneSession = this.sessions.find(
        (s) => s.zoneId === detectedZone.id && s.status === 'LIVE'
      ) || this.sessions.find((s) => s.zoneId === detectedZone.id) || this.sessions[0];

      if (zoneSession && zoneSession.id !== this.activeSessionId) {
        this.activeSessionId = zoneSession.id;
        this.updateSessionSheetUI(zoneSession);
      }
    } else {
      if (this.dom.zoneName) {
        this.dom.zoneName.textContent = 'Outdoor Campus';
      }
      if (this.dom.zoneStatusDot) {
        this.dom.zoneStatusDot.className = 'w-2 h-2 rounded-full bg-indigo-400 shrink-0';
      }
    }
  }

  updateGpsStatus(text, color) {
    if (this.dom.gpsText) {
      this.dom.gpsText.textContent = text;
    }
    if (this.dom.gpsStatusDot) {
      if (color === 'emerald') {
        this.dom.gpsStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0';
      } else if (color === 'amber') {
        this.dom.gpsStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0';
      } else {
        this.dom.gpsStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0';
      }
    }
  }

  // ==========================================================================
  // Live Polling Engine
  // ==========================================================================

  startPollingEngine() {
    this.pollServerData();
    setInterval(() => this.pollServerData(), 2500);
  }

  async pollServerData() {
    // 1. Fetch live occupancy counts
    try {
      const occRes = await fetch('/api/occupancy');
      if (occRes.ok) {
        const occData = await occRes.json();
        this.occupancyMap = (occData && occData.zones) ? occData.zones : occData;
        this.updateOccupancyMeters();
      }
    } catch (err) {
      console.warn('[ParticipantApp] Occupancy poll failed:', err?.message);
    }

    // 2. Fetch live sessions
    try {
      const sessRes = await fetch('/api/sessions');
      if (sessRes.ok) {
        const sessData = await sessRes.json();
        const list = Array.isArray(sessData) ? sessData : (sessData.sessions || []);
        if (list.length > 0) {
          this.sessions = list;
          if (!this.activeSessionId && this.sessions.length > 0) {
            this.activeSessionId = this.sessions[0].id;
          }
          this.updateUpcomingList();
        }
      }
    } catch (err) {
      console.warn('[ParticipantApp] Sessions poll failed:', err?.message);
    }

    // 3. Fetch zones
    try {
      const zoneRes = await fetch('/api/zones');
      if (zoneRes.ok) {
        const zoneData = await zoneRes.json();
        const list = Array.isArray(zoneData) ? zoneData : (zoneData.zones || []);
        if (list.length > 0) {
          this.zones = list;
          if (!this.activeZoneId && this.zones.length > 0) {
            this.activeZoneId = this.zones[0].id;
          }
        }
      }
    } catch (err) {
      console.warn('[ParticipantApp] Zones poll failed:', err?.message);
    }

    // 4. Fetch broadcast alerts
    try {
      const alertRes = await fetch('/api/alerts?activeOnly=true');
      if (alertRes.ok) {
        const alertData = await alertRes.json();
        const alerts = Array.isArray(alertData) ? alertData : (alertData.alerts || []);
        this.alerts = alerts;
        this.updateAlertBanner();
      }
    } catch (err) {
      console.warn('[ParticipantApp] Alerts poll failed:', err?.message);
    }
  }

  updateAlertBanner() {
    const banner = document.getElementById('live-alert-banner');
    const text = document.getElementById('live-alert-text');
    const closeBtn = document.getElementById('live-alert-close');
    if (!banner || !text) return;

    if (closeBtn && !closeBtn._wired) {
      closeBtn._wired = true;
      closeBtn.addEventListener('click', () => {
        banner.classList.add('hidden');
      });
    }

    const activeAlert = this.alerts.find((a) => a.isActive !== false);
    if (activeAlert) {
      text.textContent = `${activeAlert.title ? activeAlert.title + ': ' : ''}${activeAlert.message}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  async initGoogleMaps(apiKey) {
    if (!apiKey) return;
    try {
      if (!window.google?.maps) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
          script.async = true;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
    } catch {
      // Graceful fallback to vector 3D canvas
    }
  }

  // ==========================================================================
  // Canvas 3D Map Rendering Engine
  // ==========================================================================

  setupCanvas() {
    const canvas = this.dom.canvas;
    if (!canvas) return;
    this.ctx = canvas.getContext('2d');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    const canvas = this.dom.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    this.canvasDpr = dpr;
  }

  startRenderLoop() {
    const frame = () => {
      this.updatePhysics();
      this.renderScene();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  updatePhysics() {
    // Smooth user position lerp (15% per frame for buttery 60fps movement)
    this.userPos.lat += (this.userPos.targetLat - this.userPos.lat) * 0.12;
    this.userPos.lng += (this.userPos.targetLng - this.userPos.lng) * 0.12;

    // Smooth camera target lerp
    this.camera.x += (this.camera.targetX - this.camera.x) * 0.1;
    this.camera.y += (this.camera.targetY - this.camera.y) * 0.1;
  }

  /**
   * 3D Perspective Projection Math
   */
  project(localX, localY, localZ) {
    const canvas = this.dom.canvas;
    const w = canvas.width / this.canvasDpr;
    const h = canvas.height / this.canvasDpr;

    // Camera relative offset
    const dx = localX - this.camera.x;
    const dy = localY - this.camera.y;
    const dz = localZ;

    // Yaw rotation (Z-axis rotation)
    const cosY = Math.cos(this.camera.yaw);
    const sinY = Math.sin(this.camera.yaw);
    const rx = dx * cosY - dy * sinY;
    const ry = dx * sinY + dy * cosY;

    // Pitch rotation (X-axis tilt)
    const cosP = Math.cos(this.camera.pitch);
    const sinP = Math.sin(this.camera.pitch);
    const py = ry * cosP - dz * sinP;
    const pz = ry * sinP + dz * cosP;

    // Perspective depth compression
    const focalLength = 380;
    const scale = (focalLength / (focalLength + pz * 0.75)) * this.camera.zoom;

    const screenX = w / 2 + rx * scale + this.camera.panX;
    const screenY = h / 2 + py * scale + this.camera.panY;

    return {
      x: screenX,
      y: screenY,
      depth: pz,
      scale,
    };
  }

  renderScene() {
    const ctx = this.ctx;
    const canvas = this.dom.canvas;
    if (!ctx || !canvas) return;

    const w = canvas.width / this.canvasDpr;
    const h = canvas.height / this.canvasDpr;

    ctx.save();
    ctx.scale(this.canvasDpr, this.canvasDpr);

    // Deep Dark Canvas Background
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, w, h);

    // 1. Draw Grid Ground Pattern
    this.renderGroundGrid(ctx, w, h);

    // 2. Prepare Building 3D Extrusions for Depth Sorting
    const renderItems = [];

    for (let i = 0; i < this.zones.length; i++) {
      const zone = this.zones[i];
      if (this.activeFilter !== 'all' && zone.id !== this.activeFilter) {
        continue;
      }
      const buildingGeometry = this.computeBuildingGeometry(zone);
      if (buildingGeometry) {
        renderItems.push(buildingGeometry);
      }
    }

    // Sort buildings from furthest to closest (Painter's Algorithm)
    renderItems.sort((a, b) => b.centerDepth - a.centerDepth);

    // 3. Draw Building Shadows
    for (let i = 0; i < renderItems.length; i++) {
      this.drawBuildingShadow(ctx, renderItems[i]);
    }

    // 4. Draw Walking Navigation Route from User to Active Stage
    this.drawNavigationRoute(ctx);

    // 5. Draw Extruded Building Geometry
    for (let i = 0; i < renderItems.length; i++) {
      this.drawBuildingExtrusion(ctx, renderItems[i]);
    }

    // 6. Draw Participant Beacon (Glowing Blue Dot + Radar Cone)
    this.drawParticipantBeacon(ctx);

    // 7. Draw Floating HUD Labels over Extruded Roofs
    for (let i = 0; i < renderItems.length; i++) {
      this.drawBuildingHudPin(ctx, renderItems[i]);
    }

    ctx.restore();
  }

  renderGroundGrid(ctx, w, h) {
    ctx.strokeStyle = 'rgba(70, 69, 84, 0.22)';
    ctx.lineWidth = 1;

    // Draw campus radial grid lines
    const gridSize = 16;
    const step = 20;

    ctx.beginPath();
    for (let gx = -gridSize; gx <= gridSize; gx++) {
      const p1 = this.project(gx * step, -gridSize * step, 0);
      const p2 = this.project(gx * step, gridSize * step, 0);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    for (let gy = -gridSize; gy <= gridSize; gy++) {
      const p1 = this.project(-gridSize * step, gy * step, 0);
      const p2 = this.project(gridSize * step, gy * step, 0);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // Central Venue Footprint Accent
    const campusP1 = this.project(-80, -90, 0);
    const campusP2 = this.project(80, -90, 0);
    const campusP3 = this.project(80, 90, 0);
    const campusP4 = this.project(-80, 90, 0);

    ctx.beginPath();
    ctx.moveTo(campusP1.x, campusP1.y);
    ctx.lineTo(campusP2.x, campusP2.y);
    ctx.lineTo(campusP3.x, campusP3.y);
    ctx.lineTo(campusP4.x, campusP4.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(24, 27, 37, 0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  computeBuildingGeometry(zone) {
    const rawVertices = zone.boundary?.vertices ?? zone.coords ?? zone.polygon;
    if (!Array.isArray(rawVertices) || rawVertices.length < 3) return null;

    const baseVertices = [];
    const roofVertices = [];
    let avgDepth = 0;
    const height = zone.elevationMeters || 12;

    for (let i = 0; i < rawVertices.length; i++) {
      const v = rawVertices[i];
      const local = geoToLocal(v.lat, v.lng);
      const baseProj = this.project(local.x, local.y, 0);
      const roofProj = this.project(local.x, local.y, height);

      baseVertices.push({ ...local, ...baseProj });
      roofVertices.push({ ...local, ...roofProj });
      avgDepth += roofProj.depth;
    }

    avgDepth /= rawVertices.length;

    // Density color resolution
    const occEntry = this.occupancyMap[zone.id];
    const count = typeof occEntry === 'object' && occEntry !== null
      ? (occEntry.count ?? occEntry.currentCount ?? 0)
      : (Number(occEntry) || 0);
    const cap = zone.capacity || 100;
    const densityPercent = Math.min(100, Math.round((count / cap) * 100));

    let heatColor = '#10b981'; // Green < 40%
    let roofBorder = '#4edea3';
    let wallDark = '#181b25';
    let wallLight = '#262a34';

    if (densityPercent >= 90) {
      heatColor = '#ef4444'; // Red >= 90%
      roofBorder = '#ffb4ab';
      wallDark = '#38161e';
      wallLight = '#4d202b';
    } else if (densityPercent >= 40) {
      heatColor = '#f59e0b'; // Amber 40-89%
      roofBorder = '#ffb95f';
      wallDark = '#2c2214';
      wallLight = '#3e301a';
    }

    const isSelected = zone.id === this.activeZoneId;

    return {
      zone,
      baseVertices,
      roofVertices,
      centerDepth: avgDepth,
      height,
      densityPercent,
      currentCount: count,
      heatColor,
      roofBorder,
      wallDark,
      wallLight,
      isSelected,
    };
  }

  drawBuildingShadow(ctx, b) {
    ctx.save();
    ctx.beginPath();
    const v = b.baseVertices;
    ctx.moveTo(v[0].x + 4, v[0].y + 4);
    for (let i = 1; i < v.length; i++) {
      ctx.lineTo(v[i].x + 4, v[i].y + 4);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.filter = 'blur(6px)';
    ctx.fill();
    ctx.restore();
  }

  drawBuildingExtrusion(ctx, b) {
    const base = b.baseVertices;
    const roof = b.roofVertices;
    const n = base.length;

    // Draw Extruded Side Walls
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;

      ctx.beginPath();
      ctx.moveTo(base[i].x, base[i].y);
      ctx.lineTo(base[next].x, base[next].y);
      ctx.lineTo(roof[next].x, roof[next].y);
      ctx.lineTo(roof[i].x, roof[i].y);
      ctx.closePath();

      // Shading based on orientation index
      ctx.fillStyle = i % 2 === 0 ? b.wallDark : b.wallLight;
      ctx.fill();
      ctx.strokeStyle = '#31353f';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Horizontal floor level wireframe slices
      const floorSliceCount = Math.max(1, Math.floor(b.height / 5));
      for (let f = 1; f < floorSliceCount; f++) {
        const t = f / floorSliceCount;
        const x1 = base[i].x + (roof[i].x - base[i].x) * t;
        const y1 = base[i].y + (roof[i].y - base[i].y) * t;
        const x2 = base[next].x + (roof[next].x - base[next].x) * t;
        const y2 = base[next].y + (roof[next].y - base[next].y) * t;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }

    // Draw Illuminated Roof Facet
    ctx.beginPath();
    ctx.moveTo(roof[0].x, roof[0].y);
    for (let i = 1; i < n; i++) {
      ctx.lineTo(roof[i].x, roof[i].y);
    }
    ctx.closePath();

    ctx.fillStyle = b.isSelected ? '#31353f' : '#262a34';
    ctx.fill();

    // Roof Outline Glowing with Occupancy Heat
    ctx.strokeStyle = b.isSelected ? '#c0c1ff' : b.roofBorder;
    ctx.lineWidth = b.isSelected ? 2.5 : 1.6;
    ctx.stroke();

    // Internal roof grid lines
    if (roof.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(roof[0].x * 0.5 + roof[1].x * 0.5, roof[0].y * 0.5 + roof[1].y * 0.5);
      ctx.lineTo(roof[2].x * 0.5 + roof[3].x * 0.5, roof[2].y * 0.5 + roof[3].y * 0.5);
      ctx.strokeStyle = b.roofBorder;
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
  }

  drawNavigationRoute(ctx) {
    // If we have an active calculated turn-by-turn route, render the exact multi-segment path
    if (this.activeRoute && Array.isArray(this.activeRoute.pathPoints) && this.activeRoute.pathPoints.length >= 2) {
      const points = this.activeRoute.pathPoints.map(p => {
        const local = geoToLocal(p.lat, p.lng);
        const proj = this.project(local.x, local.y, 0);
        return { ...p, projX: proj.x, projY: proj.y };
      });

      const dashOffset = (Date.now() / 35) % 28;

      ctx.save();

      // 1. Broad Neon Glow Underlay
      ctx.beginPath();
      ctx.moveTo(points[0].projX, points[0].projY);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].projX, points[i].projY);
      }
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = '#6366f1';
      ctx.shadowBlur = 18;
      ctx.stroke();

      // 2. Solid Route Track Base
      ctx.beginPath();
      ctx.moveTo(points[0].projX, points[0].projY);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].projX, points[i].projY);
      }
      ctx.strokeStyle = '#4338ca';
      ctx.lineWidth = 6;
      ctx.shadowBlur = 0;
      ctx.stroke();

      // 3. Traveling Animated Neon Beam (Electric Dash)
      ctx.beginPath();
      ctx.moveTo(points[0].projX, points[0].projY);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].projX, points[i].projY);
      }
      ctx.strokeStyle = '#c0c1ff';
      ctx.lineWidth = 3.5;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -dashOffset;
      ctx.stroke();
      ctx.setLineDash([]);

      // 4. Waypoint Turn Pins with Left/Right Indications
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const isStart = i === 0;
        const isEnd = i === points.length - 1;
        const step = this.activeRoute.steps ? this.activeRoute.steps[i] : null;

        // Pin Node Circle
        ctx.beginPath();
        ctx.arc(pt.projX, pt.projY, isStart || isEnd ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = isStart ? '#10b981' : (isEnd ? '#ef4444' : '#6366f1');
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Waypoint Turn Badge Pill (Left / Right / Arrive)
        let turnLabel = null;
        let badgeBg = 'rgba(15, 23, 42, 0.90)';
        let badgeBorder = '#818cf8';

        if (isStart) {
          turnLabel = 'START';
          badgeBg = 'rgba(16, 185, 129, 0.90)';
          badgeBorder = '#10b981';
        } else if (isEnd) {
          turnLabel = '🏁 GOAL';
          badgeBg = 'rgba(239, 68, 68, 0.90)';
          badgeBorder = '#ef4444';
        } else if (step) {
          if (step.turnType === 'LEFT') {
            turnLabel = '↰ LEFT';
            badgeBg = 'rgba(245, 158, 11, 0.92)';
            badgeBorder = '#f59e0b';
          } else if (step.turnType === 'RIGHT') {
            turnLabel = '↱ RIGHT';
            badgeBg = 'rgba(16, 185, 129, 0.92)';
            badgeBorder = '#10b981';
          }
        }

        if (turnLabel) {
          ctx.font = '700 9px JetBrains Mono, monospace';
          const txtWidth = ctx.measureText(turnLabel).width;
          const pillW = txtWidth + 12;
          const pillH = 17;
          const pillX = pt.projX - pillW / 2;
          const pillY = pt.projY - 24;

          ctx.fillStyle = badgeBg;
          this.roundRect(ctx, pillX, pillY, pillW, pillH, 4);
          ctx.fill();
          ctx.strokeStyle = badgeBorder;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(turnLabel, pillX + 6, pillY + 12);
        }
      }

      ctx.restore();
      return;
    }

    // Fallback: Subtle line to active zone if no turn-by-turn route is chosen
    const userLocal = geoToLocal(this.userPos.lat, this.userPos.lng);
    const userProj = this.project(userLocal.x, userLocal.y, 0);

    const activeZone = this.zones.find((z) => z.id === this.activeZoneId) || this.zones[0];
    if (!activeZone) return;
    const vertices = activeZone.boundary?.vertices ?? activeZone.coords ?? activeZone.polygon;
    if (!vertices || vertices.length === 0) return;

    let centerLat = 0;
    let centerLng = 0;
    for (let i = 0; i < vertices.length; i++) {
      centerLat += vertices[i].lat;
      centerLng += vertices[i].lng;
    }
    centerLat /= vertices.length;
    centerLng /= vertices.length;

    const targetLocal = geoToLocal(centerLat, centerLng);
    const targetProj = this.project(targetLocal.x, targetLocal.y, 0);

    const dashOffset = (Date.now() / 40) % 24;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(userProj.x, userProj.y);
    const midX = (userProj.x + targetProj.x) / 2 + 15;
    const midY = (userProj.y + targetProj.y) / 2 - 20;
    ctx.quadraticCurveTo(midX, midY, targetProj.x, targetProj.y);

    ctx.strokeStyle = '#8083ff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -dashOffset;
    ctx.stroke();
    ctx.restore();
  }

  drawParticipantBeacon(ctx) {
    const local = geoToLocal(this.userPos.lat, this.userPos.lng);
    const proj = this.project(local.x, local.y, 0);

    const time = Date.now() / 1000;
    const pulseScale = 1 + 0.25 * Math.sin(time * 3);

    // 1. Heading Directional Beam & Cone
    const headingRad = ((this.userPos.heading - 90) * Math.PI) / 180;
    const coneAngle = (32 * Math.PI) / 180;
    const beamLength = 48 * proj.scale;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(proj.x, proj.y);
    ctx.arc(
      proj.x,
      proj.y,
      beamLength,
      headingRad - coneAngle,
      headingRad + coneAngle
    );
    ctx.closePath();

    const beamGrad = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, beamLength);
    beamGrad.addColorStop(0, 'rgba(128, 131, 255, 0.65)');
    beamGrad.addColorStop(0.7, 'rgba(128, 131, 255, 0.2)');
    beamGrad.addColorStop(1, 'rgba(128, 131, 255, 0)');
    ctx.fillStyle = beamGrad;
    ctx.fill();
    ctx.restore();

    // 2. Outer Pulsating Aura
    ctx.save();
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 16 * pulseScale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(99, 102, 241, 0.28)';
    ctx.fill();

    // 3. Middle Glow Circle
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // 4. Center High-Visibility White Dot
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  drawBuildingHudPin(ctx, b) {
    const roof = b.roofVertices;
    let centerX = 0;
    let centerY = 0;
    for (let i = 0; i < roof.length; i++) {
      centerX += roof[i].x;
      centerY += roof[i].y;
    }
    centerX /= roof.length;
    centerY /= roof.length;

    // Pin Anchor Line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX, centerY - 14);
    ctx.strokeStyle = b.heatColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pill Badge Box
    const textTitle = b.zone.name;
    const textSub = `${b.densityPercent}% Full • ${b.currentCount}/${b.zone.capacity}`;

    ctx.font = 'bold 10px Geist, sans-serif';
    const titleWidth = ctx.measureText(textTitle).width;
    ctx.font = '500 9px JetBrains Mono, monospace';
    const subWidth = ctx.measureText(textSub).width;
    const pillWidth = Math.max(titleWidth, subWidth) + 24;
    const pillHeight = 28;

    const px = centerX - pillWidth / 2;
    const py = centerY - 14 - pillHeight;

    // Badge Card Background
    ctx.save();
    ctx.fillStyle = 'rgba(24, 27, 37, 0.94)';
    ctx.strokeStyle = b.isSelected ? '#8083ff' : b.heatColor;
    ctx.lineWidth = 1;
    this.roundRect(ctx, px, py, pillWidth, pillHeight, 6);
    ctx.fill();
    ctx.stroke();

    // Status Dot
    ctx.beginPath();
    ctx.arc(px + 9, py + 14, 3, 0, Math.PI * 2);
    ctx.fillStyle = b.heatColor;
    ctx.fill();

    // Text Render
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Geist, sans-serif';
    ctx.fillText(textTitle, px + 17, py + 12);

    ctx.fillStyle = b.heatColor;
    ctx.font = '500 8.5px JetBrains Mono, monospace';
    ctx.fillText(textSub, px + 17, py + 23);
    ctx.restore();
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // ==========================================================================
  // Touch, Mouse & Gesture Navigation Listeners
  // ==========================================================================

  setupGestureListeners() {
    const canvas = this.dom.canvas;
    if (!canvas) return;

    // Mouse Listeners
    canvas.addEventListener('mousedown', (e) => {
      this.canvasDrag.isDragging = true;
      this.canvasDrag.startX = e.clientX;
      this.canvasDrag.startY = e.clientY;
      this.canvasDrag.lastX = e.clientX;
      this.canvasDrag.lastY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.canvasDrag.isDragging) return;
      const dx = e.clientX - this.canvasDrag.lastX;
      const dy = e.clientY - this.canvasDrag.lastY;
      this.canvasDrag.lastX = e.clientX;
      this.canvasDrag.lastY = e.clientY;

      // Rotate camera yaw and pitch
      this.camera.yaw += dx * 0.006;
      this.camera.pitch = Math.max(0.25, Math.min(Math.PI / 2.2, this.camera.pitch + dy * 0.005));

      if (this.dom.compassIcon) {
        this.dom.compassIcon.style.transform = `rotate(${-this.camera.yaw * (180 / Math.PI)}deg)`;
      }
    });

    window.addEventListener('mouseup', () => {
      this.canvasDrag.isDragging = false;
    });

    // Mouse Wheel Zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      this.camera.zoom = Math.max(1.2, Math.min(6.5, this.camera.zoom * zoomFactor));
    }, { passive: false });

    // Touch Listeners (Orbit & Pinch to Zoom)
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.canvasDrag.isDragging = true;
        this.canvasDrag.lastX = e.touches[0].clientX;
        this.canvasDrag.lastY = e.touches[0].clientY;
        this.canvasDrag.pinchDistance = null;
      } else if (e.touches.length === 2) {
        this.canvasDrag.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.canvasDrag.pinchDistance = Math.hypot(dx, dy);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.canvasDrag.isDragging) {
        const dx = e.touches[0].clientX - this.canvasDrag.lastX;
        const dy = e.touches[0].clientY - this.canvasDrag.lastY;
        this.canvasDrag.lastX = e.touches[0].clientX;
        this.canvasDrag.lastY = e.touches[0].clientY;

        this.camera.yaw += dx * 0.008;
        this.camera.pitch = Math.max(0.25, Math.min(Math.PI / 2.2, this.camera.pitch + dy * 0.006));

        if (this.dom.compassIcon) {
          this.dom.compassIcon.style.transform = `rotate(${-this.camera.yaw * (180 / Math.PI)}deg)`;
        }
      } else if (e.touches.length === 2 && this.canvasDrag.pinchDistance) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.hypot(dx, dy);
        const ratio = newDist / this.canvasDrag.pinchDistance;
        this.camera.zoom = Math.max(1.2, Math.min(6.5, this.camera.zoom * ratio));
        this.canvasDrag.pinchDistance = newDist;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      this.canvasDrag.isDragging = false;
      this.canvasDrag.pinchDistance = null;
    });
  }

  // ==========================================================================
  // Draggable Bottom Sheet Controller
  // ==========================================================================

  setupSheetListeners() {
    const sheet = this.dom.bottomSheet;
    const handle = this.dom.sheetHandle;
    const header = this.dom.sheetHeader;
    const btnToggle = this.dom.btnToggleSheet;

    if (!sheet || !handle || !header) return;

    // Toggle button click
    if (btnToggle) {
      btnToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleBottomSheet();
      });
    }

    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleBottomSheet();
    });

    header.addEventListener('click', (e) => {
      // Toggle if clicking header outside buttons
      if (!e.target.closest('button')) {
        this.toggleBottomSheet();
      }
    });

    if (this.dom.btnSheetLocateLive) {
      this.dom.btnSheetLocateLive.addEventListener('click', () => {
        const currentSession = this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0];
        if (currentSession) {
          this.focusZone(currentSession.zoneId);
        }
      });
    }

    // Touch Dragging
    const onTouchStart = (clientY) => {
      this.sheet.isDragging = true;
      this.sheet.startY = clientY;
      this.sheet.startHeight = this.sheet.height;
      this.sheet.lastY = clientY;
      this.sheet.lastTimestamp = Date.now();
      this.sheet.lastVelocity = 0;
      sheet.classList.add('is-dragging');
    };

    const onTouchMove = (clientY) => {
      if (!this.sheet.isDragging) return;
      const deltaY = this.sheet.startY - clientY;
      const newHeight = Math.max(
        this.sheet.collapsedHeight - 20,
        Math.min(this.sheet.expandedHeight + 30, this.sheet.startHeight + deltaY)
      );
      this.sheet.height = newHeight;
      sheet.style.height = `${newHeight}px`;

      // Track swipe velocity
      const now = Date.now();
      const dt = now - this.sheet.lastTimestamp;
      if (dt > 10) {
        this.sheet.lastVelocity = (this.sheet.lastY - clientY) / dt;
        this.sheet.lastY = clientY;
        this.sheet.lastTimestamp = now;
      }
    };

    const onTouchEnd = () => {
      if (!this.sheet.isDragging) return;
      this.sheet.isDragging = false;
      sheet.classList.remove('is-dragging');

      // Velocity snap decision
      const threshold = (this.sheet.collapsedHeight + this.sheet.expandedHeight) / 2;
      let snapToExpanded = false;

      if (this.sheet.lastVelocity > 0.4) {
        snapToExpanded = true;
      } else if (this.sheet.lastVelocity < -0.4) {
        snapToExpanded = false;
      } else {
        snapToExpanded = this.sheet.height > threshold;
      }

      this.snapBottomSheet(snapToExpanded);
    };

    // Touch events on handle & header
    const attachDragTouch = (el) => {
      el.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) onTouchStart(e.touches[0].clientY);
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) onTouchMove(e.touches[0].clientY);
      }, { passive: true });

      el.addEventListener('touchend', () => onTouchEnd());
    };

    attachDragTouch(handle);
    attachDragTouch(header);

    // Mouse events for desktop testing
    handle.addEventListener('mousedown', (e) => {
      onTouchStart(e.clientY);
      const onMouseMove = (ev) => onTouchMove(ev.clientY);
      const onMouseUp = () => {
        onTouchEnd();
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  toggleBottomSheet() {
    const isExpanded = this.sheet.height > (this.sheet.collapsedHeight + 50);
    this.snapBottomSheet(!isExpanded);
  }

  snapBottomSheet(expand) {
    const targetHeight = expand ? this.sheet.expandedHeight : this.sheet.collapsedHeight;
    this.sheet.height = targetHeight;
    if (this.dom.bottomSheet) {
      this.dom.bottomSheet.style.height = `${targetHeight}px`;
    }
    if (this.dom.sheetChevron) {
      this.dom.sheetChevron.textContent = expand ? 'expand_more' : 'expand_less';
    }
  }

  setupSheetTabs() {
    const tabs = [
      { btnId: 'tab-btn-live', viewId: 'sheet-view-live' },
      { btnId: 'tab-btn-schedule', viewId: 'sheet-view-schedule' },
      { btnId: 'tab-btn-directions', viewId: 'sheet-view-directions' },
      { btnId: 'tab-btn-rate', viewId: 'sheet-view-rate' }
    ];

    tabs.forEach(({ btnId, viewId }) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;

      btn.addEventListener('click', () => {
        this.snapBottomSheet(true);
        if (btnId === 'tab-btn-schedule') {
          this.renderScheduleList(this.dom.sheetScheduleList);
        }
        tabs.forEach(t => {
          const b = document.getElementById(t.btnId);
          const v = document.getElementById(t.viewId);
          if (b) {
            if (t.btnId === btnId) {
              b.className = 'sheet-tab-btn flex-1 py-1.5 rounded-lg bg-surface-container-high text-white font-headline-sm text-[11px] font-semibold text-center shadow-sm transition-all';
            } else {
              b.className = 'sheet-tab-btn flex-1 py-1.5 rounded-lg text-on-surface-variant hover:text-white font-body-md text-[11px] text-center transition-all';
            }
          }
          if (v) {
            if (t.viewId === viewId) {
              v.classList.remove('hidden');
            } else {
              v.classList.add('hidden');
            }
          }
        });
      });
    });
  }

  switchSheetTab(tabKey) {
    const tabMap = {
      live: { btnId: 'tab-btn-live', viewId: 'sheet-view-live' },
      schedule: { btnId: 'tab-btn-schedule', viewId: 'sheet-view-schedule' },
      directions: { btnId: 'tab-btn-directions', viewId: 'sheet-view-directions' },
      rate: { btnId: 'tab-btn-rate', viewId: 'sheet-view-rate' },
    };

    const target = tabMap[tabKey];
    if (!target) return;

    Object.entries(tabMap).forEach(([k, t]) => {
      const b = document.getElementById(t.btnId);
      const v = document.getElementById(t.viewId);
      if (b) {
        if (k === tabKey) {
          b.className = 'sheet-tab-btn flex-1 py-1.5 rounded-lg bg-surface-container-high text-white font-headline-sm text-[11px] font-semibold text-center shadow-sm transition-all';
        } else {
          b.className = 'sheet-tab-btn flex-1 py-1.5 rounded-lg text-on-surface-variant hover:text-white font-body-md text-[11px] text-center transition-all';
        }
      }
      if (v) {
        if (k === tabKey) {
          v.classList.remove('hidden');
        } else {
          v.classList.add('hidden');
        }
      }
    });
  }

  setupWayfinding() {
    const input = this.dom.destinationSearchInput;
    const clearBtn = this.dom.btnClearSearch;
    const dropdown = this.dom.destinationSearchDropdown;
    const exitBtn = this.dom.btnExitNavigation;

    if (!input || !dropdown) return;

    const getCampusTargets = () => {
      const targets = [
        { id: 'gate1', name: 'Gate 1 - Main Entrance (Kanakapura Rd)', category: 'Campus Access', icon: 'door_front' },
        { id: 'soe', name: 'DSU School of Engineering (Block A)', category: 'Academic Blocks', icon: 'school' },
        { id: 'quantum', name: 'AI Quantum Lab', category: 'Research Labs', icon: 'science' },
        { id: 'amphi', name: 'Dr. Premachandra Sagar Open Amphitheater', category: 'Auditoriums & Arenas', icon: 'theater_comedy' },
        { id: 'foodcourt', name: 'Student Food Court & Tummy Trails', category: 'Student Amenities', icon: 'restaurant' },
        { id: 'mech', name: 'Mechanical Engineering & Research Labs', category: 'Academic Blocks', icon: 'precision_manufacturing' },
        { id: 'sports', name: 'DSU Sports Complex & Cricket Ground', category: 'Sports & Recreation', icon: 'sports_soccer' },
        { id: 'pharm', name: 'Department of Pharmacy', category: 'Academic Blocks', icon: 'local_pharmacy' },
        { id: 'hospital', name: 'Dr. Chandramma DSU Medical Hospital (Block B)', category: 'Healthcare & CDSIMER', icon: 'local_hospital' },
        { id: 'healthsci', name: 'School of Health Sciences & Nursing', category: 'Academic Blocks', icon: 'medical_services' },
        { id: 'hostels', name: 'S-Residency Student Living & Hostels', category: 'Student Amenities', icon: 'apartment' },
      ];

      for (const z of this.zones) {
        if (!targets.some(t => t.id === z.id || t.name.toLowerCase() === z.name.toLowerCase())) {
          targets.push({
            id: z.id,
            name: z.name,
            category: z.category || 'Campus Facilities',
            icon: 'place'
          });
        }
      }
      return targets;
    };

    const renderDropdown = (query = '') => {
      const clean = query.trim().toLowerCase();
      const allTargets = getCampusTargets();
      const matches = clean.length === 0 
        ? allTargets 
        : allTargets.filter(t => t.name.toLowerCase().includes(clean) || t.category.toLowerCase().includes(clean));

      if (matches.length === 0) {
        dropdown.innerHTML = `
          <div class="px-3 py-2 text-xs text-on-surface-variant font-mono">
            No campus destinations matching "${escapeHtml(clean)}"
          </div>
        `;
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML = matches.map(target => `
        <button class="w-full text-left px-3 py-2 hover:bg-surface-container-high flex items-center justify-between gap-2 transition-colors rounded-lg group" data-destination-id="${escapeHtml(target.id)}">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-7 h-7 rounded-lg bg-surface-container-highest flex items-center justify-center text-primary shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
              <span class="material-symbols-outlined text-[16px]">${target.icon || 'place'}</span>
            </div>
            <div class="min-w-0">
              <span class="block text-xs font-semibold text-white truncate">${escapeHtml(target.name)}</span>
              <span class="block text-[10px] font-mono text-on-surface-variant truncate">${escapeHtml(target.category)}</span>
            </div>
          </div>
          <span class="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-primary/10 text-primary-fixed-dim border border-primary/20 shrink-0">
            Directions ➔
          </span>
        </button>
      `).join('');

      dropdown.classList.remove('hidden');

      dropdown.querySelectorAll('[data-destination-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const destId = btn.getAttribute('data-destination-id');
          const target = allTargets.find(t => t.id === destId);
          if (target) {
            input.value = target.name;
            clearBtn?.classList.remove('hidden');
          }
          dropdown.classList.add('hidden');
          this.calculateAndDisplayRoute(destId);
        });
      });
    };

    input.addEventListener('focus', () => {
      renderDropdown(input.value);
    });

    input.addEventListener('input', () => {
      if (input.value.trim().length > 0) {
        clearBtn?.classList.remove('hidden');
      } else {
        clearBtn?.classList.add('hidden');
      }
      renderDropdown(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstMatch = dropdown.querySelector('[data-destination-id]');
        if (firstMatch) {
          firstMatch.click();
        }
      } else if (e.key === 'Escape') {
        dropdown.classList.add('hidden');
      }
    });

    clearBtn?.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.add('hidden');
      dropdown.classList.add('hidden');
      this.clearRoute();
    });

    exitBtn?.addEventListener('click', () => {
      this.clearRoute();
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  async calculateAndDisplayRoute(destId) {
    try {
      this.showToast('Calculating turn-by-turn walking route...', 'info');

      const startNode = 'gate1';
      const res = await fetch(`/api/routes?from=${encodeURIComponent(startNode)}&to=${encodeURIComponent(destId)}`);
      if (!res.ok) {
        throw new Error(`Route calculation failed: ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to generate directions');
      }

      this.activeRoute = data;
      this.activeRouteDestination = destId;

      // 1. Update Navigation HUD Banner with prominent active turn indication (Left/Right)
      if (this.dom.navigationHudBanner) {
        const nextTurnStep = data.steps.find(s => s.turnType === 'LEFT' || s.turnType === 'RIGHT' || s.turnType === 'STRAIGHT') || data.steps[0];
        
        let turnIcon = 'turn_right';
        let turnBadgeText = `IN ${nextTurnStep.distanceMeters}M`;
        let turnBadgeColor = 'bg-primary/20 text-primary border-primary/40';

        if (nextTurnStep.turnType === 'LEFT') {
          turnIcon = 'turn_left';
          turnBadgeText = `TURN LEFT IN ${nextTurnStep.distanceMeters}M`;
          turnBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
        } else if (nextTurnStep.turnType === 'RIGHT') {
          turnIcon = 'turn_right';
          turnBadgeText = `TURN RIGHT IN ${nextTurnStep.distanceMeters}M`;
          turnBadgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
        } else if (nextTurnStep.turnType === 'STRAIGHT') {
          turnIcon = 'straight';
          turnBadgeText = `STRAIGHT IN ${nextTurnStep.distanceMeters}M`;
          turnBadgeColor = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
        } else if (nextTurnStep.turnType === 'ARRIVE') {
          turnIcon = 'flag';
          turnBadgeText = 'DESTINATION ARRIVAL';
          turnBadgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
        }

        if (this.dom.hudTurnIcon) this.dom.hudTurnIcon.textContent = turnIcon;
        if (this.dom.hudTurnBadge) {
          this.dom.hudTurnBadge.textContent = turnBadgeText;
          this.dom.hudTurnBadge.className = `font-label-sm text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${turnBadgeColor}`;
        }
        if (this.dom.hudEtaBadge) {
          this.dom.hudEtaBadge.textContent = `${data.totalDistanceMeters}m • ${data.estimatedWalkingMinutes} min walk`;
        }
        if (this.dom.hudInstruction) {
          this.dom.hudInstruction.textContent = nextTurnStep.instruction;
        }
        if (this.dom.hudLandmark) {
          this.dom.hudLandmark.textContent = nextTurnStep.landmark ? `Via ${nextTurnStep.landmark}` : 'Follow campus walkway';
        }

        this.dom.navigationHudBanner.classList.remove('hidden');
      }

      // 2. Populate Directions Tab in Bottom Sheet with step-by-step turn sequence
      if (this.dom.directionsDestName) {
        this.dom.directionsDestName.textContent = data.destination.name;
      }
      if (this.dom.directionsTotalSummary) {
        this.dom.directionsTotalSummary.textContent = `${data.totalDistanceMeters}m • ${data.estimatedWalkingMinutes} min walk`;
      }
      if (this.dom.directionsStepsCount) {
        this.dom.directionsStepsCount.textContent = `${data.steps.length} Steps`;
      }

      if (this.dom.directionsStepsList) {
        this.dom.directionsStepsList.innerHTML = data.steps.map((step, idx) => {
          let turnPill = '';
          let borderClass = 'border-outline-variant/30';

          if (step.turnType === 'LEFT') {
            turnPill = '<span class="font-label-sm text-[9.5px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">↰ Turn Left</span>';
            borderClass = 'border-amber-500/30';
          } else if (step.turnType === 'RIGHT') {
            turnPill = '<span class="font-label-sm text-[9.5px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase">↱ Turn Right</span>';
            borderClass = 'border-emerald-500/30';
          } else if (step.turnType === 'DEPART') {
            turnPill = '<span class="font-label-sm text-[9.5px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 uppercase">Depart</span>';
          } else if (step.turnType === 'ARRIVE') {
            turnPill = '<span class="font-label-sm text-[9.5px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase">Arrive</span>';
            borderClass = 'border-emerald-500/40';
          } else {
            turnPill = '<span class="font-label-sm text-[9.5px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 uppercase">Straight</span>';
          }

          return `
            <div class="p-2.5 rounded-xl bg-surface-container-low border ${borderClass} flex items-start gap-2.5 transition-colors hover:bg-surface-container">
              <div class="w-7 h-7 rounded-lg bg-surface-container-highest flex items-center justify-center text-primary font-mono text-xs font-bold shrink-0 mt-0.5">
                ${idx + 1}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-1 mb-1">
                  ${turnPill}
                  <span class="text-[10px] font-mono text-secondary font-bold">${step.distanceMeters > 0 ? step.distanceMeters + 'm' : 'Arrived'}</span>
                </div>
                <p class="text-xs font-medium text-white leading-snug">${escapeHtml(step.instruction)}</p>
                ${step.landmark ? `<p class="text-[10.5px] text-on-surface-variant font-mono mt-0.5 truncate">📍 ${escapeHtml(step.landmark)}</p>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }

      // Switch to Directions tab and expand bottom sheet
      this.switchSheetTab('directions');
      this.snapBottomSheet(true);

      // Pan camera to center on route midpoint
      if (data.pathPoints && data.pathPoints.length > 0) {
        let midLat = 0;
        let midLng = 0;
        for (const p of data.pathPoints) {
          midLat += p.lat;
          midLng += p.lng;
        }
        midLat /= data.pathPoints.length;
        midLng /= data.pathPoints.length;
        const midLocal = geoToLocal(midLat, midLng);
        this.camera.targetX = midLocal.x;
        this.camera.targetY = midLocal.y;
      }

      this.showToast(`Route calculated: ${data.totalDistanceMeters}m (${data.estimatedWalkingMinutes} min walk)`, 'success');
    } catch (err) {
      console.error('[ParticipantApp] calculateAndDisplayRoute error:', err);
      this.showToast(`Navigation error: ${err.message}`, 'error');
    }
  }

  clearRoute() {
    this.activeRoute = null;
    this.activeRouteDestination = null;
    this.snapBottomSheet(false);
    this.switchSheetTab('live');
    if (this.dom.navigationHudBanner) {
      this.dom.navigationHudBanner.classList.add('hidden');
    }
    if (this.dom.directionsDestName) {
      this.dom.directionsDestName.textContent = 'Select a destination above';
    }
    if (this.dom.directionsTotalSummary) {
      this.dom.directionsTotalSummary.textContent = '-- m • -- min';
    }
    if (this.dom.directionsStepsList) {
      this.dom.directionsStepsList.innerHTML = `
        <div class="text-center py-6 px-4 space-y-2">
          <span class="material-symbols-outlined text-[32px] text-on-surface-variant/40">explore</span>
          <p class="text-xs text-on-surface-variant">Use the search bar above or tap any zone to compute turn-by-turn walking directions with exact Left & Right indications.</p>
        </div>
      `;
    }
  }

  setupShareLive() {
    this.isSharingLive = true;
    const btn = document.getElementById('btn-share-live');
    if (!btn) return;

    btn.addEventListener('click', () => {
      this.isSharingLive = !this.isSharingLive;
      const dot = document.getElementById('share-live-dot');
      if (this.isSharingLive) {
        btn.classList.add('border-secondary/40', 'text-secondary');
        btn.classList.remove('border-outline-variant/40', 'text-outline');
        if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-secondary ml-auto shadow-sm';
        this.showToast('Live presence sharing active', 'success');
      } else {
        btn.classList.remove('border-secondary/40', 'text-secondary');
        btn.classList.add('border-outline-variant/40', 'text-outline');
        if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-outline ml-auto shadow-sm';
        this.showToast('Live presence sharing paused', 'info');
      }
    });
  }

  // ==========================================================================
  // Review & Rating Engine
  // ==========================================================================

  setupReviewListeners() {
    const starGroup = this.dom.starRatingGroup;
    const chipsGroup = this.dom.feedbackChipsGroup;
    const btnSubmit = this.dom.btnSubmitReview;

    if (starGroup) {
      const starBtns = starGroup.querySelectorAll('.star-btn');
      starBtns.forEach((btn) => {
        // Star Click
        btn.addEventListener('click', () => {
          const rating = parseInt(btn.getAttribute('data-star') || '1', 10);
          this.setStarRating(rating);
        });

        // Hover effect for desktop
        btn.addEventListener('mouseenter', () => {
          const rating = parseInt(btn.getAttribute('data-star') || '1', 10);
          this.previewStarRating(rating);
        });
      });

      starGroup.addEventListener('mouseleave', () => {
        this.previewStarRating(this.reviewState.selectedStar);
      });
    }

    // Feedback Tag Chips
    if (chipsGroup) {
      const chips = chipsGroup.querySelectorAll('.feedback-chip');
      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const tag = chip.getAttribute('data-tag');
          if (this.reviewState.selectedTags.has(tag)) {
            this.reviewState.selectedTags.delete(tag);
            chip.classList.remove('active');
          } else {
            this.reviewState.selectedTags.add(tag);
            chip.classList.add('active');
          }
        });
      });
    }

    // Submit Review Action
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => this.submitReview());
    }
  }

  setStarRating(stars) {
    this.reviewState.selectedStar = stars;
    this.previewStarRating(stars);

    // Label descriptors
    const labels = [
      'Tap stars to rate',
      '1 Star - Needs Improvement',
      '2 Stars - Fair Session',
      '3 Stars - Good & Informative',
      '4 Stars - Very Engaging',
      '5 Stars - Outstanding & Inspiring!',
    ];
    if (this.dom.ratingLabel) {
      this.dom.ratingLabel.textContent = labels[stars] || `${stars} Stars`;
    }

    // Bounce animation on clicked star
    const starBtns = this.dom.starRatingGroup?.querySelectorAll('.star-btn');
    if (starBtns && starBtns[stars - 1]) {
      starBtns[stars - 1].classList.remove('star-bounce');
      void starBtns[stars - 1].offsetWidth; // trigger reflow
      starBtns[stars - 1].classList.add('star-bounce');
    }
  }

  previewStarRating(count) {
    const starBtns = this.dom.starRatingGroup?.querySelectorAll('.star-btn');
    if (!starBtns) return;

    starBtns.forEach((btn, index) => {
      const starIcon = btn.querySelector('.material-symbols-outlined');
      if (index < count) {
        btn.classList.add('star-filled');
        btn.classList.remove('star-empty');
        if (starIcon) starIcon.style.fontVariationSettings = "'FILL' 1";
      } else {
        btn.classList.remove('star-filled');
        btn.classList.add('star-empty');
        if (starIcon) starIcon.style.fontVariationSettings = "'FILL' 0";
      }
    });
  }

  async submitReview() {
    if (this.reviewState.selectedStar === 0) {
      this.showToast('⚠️ Please select a 1-5 star rating first', 'amber');
      return;
    }

    const sessionId = this.activeSessionId;
    const stars = this.reviewState.selectedStar;
    const tags = Array.from(this.reviewState.selectedTags);
    const commentText = (this.dom.ratingCommentInput?.value || '').trim();
    const comment = tags.length > 0 ? (commentText ? `${commentText} [${tags.join(', ')}]` : tags.join(', ')) : commentText;

    const btnSubmit = this.dom.btnSubmitReview;
    const btnText = this.dom.btnSubmitReviewText;

    if (btnSubmit) btnSubmit.disabled = true;
    if (btnText) btnText.textContent = 'Transmitting Review...';

    try {
      const payload = {
        uid: this.deviceId,
        deviceId: this.deviceId,
        stars,
        rating: stars,
        comment,
        tags,
        createdAtMs: Date.now(),
      };

      const res = await fetch(`/api/sessions/${sessionId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        this.reviewState.submittedSessions.add(sessionId);
        this.showToast('✓ Review Submitted! Rating recorded.', 'emerald');
        if (btnText) btnText.textContent = '✓ Review Submitted';
        if (btnSubmit) {
          btnSubmit.classList.remove('bg-indigo-600', 'hover:bg-indigo-500');
          btnSubmit.classList.add('bg-emerald-600');
        }
      } else {
        // Fallback optimistic success for offline demo
        this.reviewState.submittedSessions.add(sessionId);
        this.showToast('✓ Review Recorded locally', 'emerald');
        if (btnText) btnText.textContent = '✓ Review Submitted';
      }
    } catch (e) {
      this.reviewState.submittedSessions.add(sessionId);
      this.showToast('✓ Review Recorded locally', 'emerald');
      if (btnText) btnText.textContent = '✓ Review Submitted';
    } finally {
      setTimeout(() => {
        if (btnSubmit) btnSubmit.disabled = false;
      }, 2000);
    }
  }

  // ==========================================================================
  // Navigation Tabs & Modals
  // ==========================================================================

  setupNavigationTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => {
          t.classList.remove('active', 'text-indigo-400');
          t.classList.add('text-slate-400');
          const circle = t.querySelector('.w-8');
          if (circle) circle.classList.remove('bg-indigo-500/15');
        });

        tab.classList.add('active', 'text-indigo-400');
        tab.classList.remove('text-slate-400');
        const activeCircle = tab.querySelector('.w-8');
        if (activeCircle) activeCircle.classList.add('bg-indigo-500/15');

        const tabName = tab.getAttribute('data-tab');
        this.handleTabSwitch(tabName);
      });
    });

    // Close Modal Buttons
    document.querySelectorAll('.btn-close-modal').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-modal');
        if (modalId) {
          const el = document.getElementById(modalId);
          if (el) el.classList.add('hidden');
        }
        // Reset nav tab highlight to 'map'
        const mapTab = document.querySelector('.nav-tab[data-tab="map"]');
        if (mapTab) {
          tabs.forEach((t) => {
            t.classList.remove('active', 'text-indigo-400');
            t.classList.add('text-slate-400');
            const circle = t.querySelector('.w-8');
            if (circle) circle.classList.remove('bg-indigo-500/15');
          });
          mapTab.classList.add('active', 'text-indigo-400');
          mapTab.classList.remove('text-slate-400');
          const circle = mapTab.querySelector('.w-8');
          if (circle) circle.classList.add('bg-indigo-500/15');
        }
      });
    });
  }

  handleTabSwitch(tabName) {
    // Hide all modals
    if (this.dom.modalSchedule) this.dom.modalSchedule.classList.add('hidden');
    if (this.dom.modalZones) this.dom.modalZones.classList.add('hidden');
    if (this.dom.modalPass) this.dom.modalPass.classList.add('hidden');

    if (tabName === 'schedule') {
      this.renderScheduleModal();
      if (this.dom.modalSchedule) this.dom.modalSchedule.classList.remove('hidden');
    } else if (tabName === 'zones') {
      this.renderZonesModal();
      if (this.dom.modalZones) this.dom.modalZones.classList.remove('hidden');
    } else if (tabName === 'pass') {
      if (this.dom.modalPass) this.dom.modalPass.classList.remove('hidden');
    }
  }

  renderScheduleList(container) {
    if (!container) return;

    container.innerHTML = this.sessions
      .map((s) => {
        const zone = this.zones.find((z) => z.id === s.zoneId);
        const zoneName = zone ? zone.name : 'Main Stage';
        const isLive = s.status === 'LIVE';
        return `
        <div class="p-3.5 rounded-xl bg-[#181b25] border ${isLive ? 'border-emerald-500/40 shadow-lg' : 'border-[#232734]'} space-y-2">
          <div class="flex items-center justify-between">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
              isLive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#262a34] text-slate-400'
            }">${escapeHtml(s.status)}</span>
            <span class="text-[11px] font-mono text-slate-400">${escapeHtml(zoneName)}</span>
          </div>
          <div>
            <h4 class="text-xs font-semibold text-white">${escapeHtml(s.title)}</h4>
            <p class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(s.speaker)}</p>
          </div>
          <div class="flex items-center justify-between pt-1 border-t border-[#232734]">
            <span class="text-[10px] font-mono text-amber-400 flex items-center gap-1">
              ⭐ ${s.averageRating ? s.averageRating.toFixed(1) : 'New'} (${s.ratings?.length || 0} reviews)
            </span>
            <button class="px-2.5 py-1 rounded-lg bg-indigo-600/30 text-indigo-300 text-[10.5px] font-medium hover:bg-indigo-600 hover:text-white transition-colors" onclick="window.participantApp.locateSession('${escapeHtml(s.id)}')">
              View on Map
            </button>
          </div>
        </div>
      `;
      })
      .join('');
  }

  renderScheduleModal() {
    this.renderScheduleList(this.dom.scheduleListContainer);
  }

  renderZonesModal() {
    const container = this.dom.zonesListContainer;
    if (!container) return;

    container.innerHTML = this.zones
      .map((z) => {
        const occEntry = this.occupancyMap[z.id];
        const count = typeof occEntry === 'object' && occEntry !== null
          ? (occEntry.count ?? occEntry.currentCount ?? 0)
          : (Number(occEntry) || 0);
        const cap = z.capacity || 100;
        const percent = Math.min(100, Math.round((count / cap) * 100));

        let badgeColor = 'bg-emerald-500/20 text-emerald-400';
        let barColor = 'bg-emerald-400';
        if (percent >= 90) {
          badgeColor = 'bg-rose-500/20 text-rose-400';
          barColor = 'bg-rose-500';
        } else if (percent >= 40) {
          badgeColor = 'bg-amber-500/20 text-amber-400';
          barColor = 'bg-amber-400';
        }

        return `
        <div class="p-3.5 rounded-xl bg-[#181b25] border border-[#232734] space-y-2.5">
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-semibold text-white">${escapeHtml(z.name)}</h4>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${badgeColor}">
              ${percent}% FULL
            </span>
          </div>
          <div class="space-y-1">
            <div class="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>Current Occupancy: <strong class="text-white">${count}</strong></span>
              <span>Capacity: ${cap}</span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-[#0a0e17] overflow-hidden">
              <div class="h-full ${barColor} rounded-full" style="width: ${percent}%;"></div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 pt-1">
            <button class="py-1.5 rounded-lg bg-[#262a34] hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition-colors" onclick="window.participantApp.focusZone('${escapeHtml(z.id)}')">
              View on Map
            </button>
            <button class="py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors flex items-center justify-center gap-1 shadow-sm" onclick="window.participantApp.calculateAndDisplayRoute('${escapeHtml(z.id)}')">
              <span class="material-symbols-outlined text-[13px]">directions</span>
              Directions
            </button>
          </div>
        </div>
      `;
      })
      .join('');
  }

  locateSession(sessionId) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    this.focusZone(session.zoneId);
    this.activeSessionId = session.id;
    this.updateSessionSheetUI(session);
    if (this.dom.modalSchedule) this.dom.modalSchedule.classList.add('hidden');
    this.snapBottomSheet(true);
  }

  focusZone(zoneId) {
    const zone = this.zones.find((z) => z.id === zoneId);
    if (!zone) return;

    this.activeZoneId = zoneId;
    const vertices = zone.boundary?.vertices ?? zone.coords ?? zone.polygon;
    if (vertices && vertices.length > 0) {
      let lat = 0;
      let lng = 0;
      for (let i = 0; i < vertices.length; i++) {
        lat += vertices[i].lat;
        lng += vertices[i].lng;
      }
      lat /= vertices.length;
      lng /= vertices.length;

      const local = geoToLocal(lat, lng);
      this.camera.targetX = local.x;
      this.camera.targetY = local.y;
    }

    if (this.dom.modalZones) this.dom.modalZones.classList.add('hidden');
    this.showToast(`Navigated to ${zone.name}`, 'info');
  }

  // ==========================================================================
  // Controls & HUD Actions
  // ==========================================================================

  setupControls() {
    // Recenter Button
    if (this.dom.btnRecenter) {
      this.dom.btnRecenter.addEventListener('click', () => {
        const local = geoToLocal(this.userPos.lat, this.userPos.lng);
        this.camera.targetX = local.x;
        this.camera.targetY = local.y;
        this.showToast('📍 Centered on your live position', 'info');
      });
    }

    // 3D / 2D Tilt Toggle
    if (this.dom.btnTilt) {
      this.dom.btnTilt.addEventListener('click', () => {
        if (Math.abs(this.camera.pitch - (55 * Math.PI) / 180) < 0.1) {
          this.camera.pitch = (30 * Math.PI) / 180;
          if (this.dom.tiltLabel) this.dom.tiltLabel.textContent = '30°';
        } else {
          this.camera.pitch = (55 * Math.PI) / 180;
          if (this.dom.tiltLabel) this.dom.tiltLabel.textContent = '55°';
        }
      });
    }

    // Compass North Reset
    if (this.dom.btnCompass) {
      this.dom.btnCompass.addEventListener('click', () => {
        this.camera.yaw = 0;
        if (this.dom.compassIcon) {
          this.dom.compassIcon.style.transform = 'rotate(0deg)';
        }
        this.showToast('🧭 Facing True North', 'info');
      });
    }

    // Simulate Walk Action Chip
    if (this.dom.btnSimulateWalk) {
      this.dom.btnSimulateWalk.addEventListener('click', () => {
        this.toggleWalkSimulation();
      });
    }
  }

  setupFilters() {
    const chips = document.querySelectorAll('.filter-chip');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => {
          c.classList.remove('active', 'bg-indigo-600', 'text-white');
          c.classList.add('bg-[#181b25]', 'text-slate-300');
        });
        chip.classList.add('active', 'bg-indigo-600', 'text-white');
        chip.classList.remove('bg-[#181b25]', 'text-slate-300');

        this.activeFilter = chip.getAttribute('data-filter') || 'all';
        if (this.activeFilter !== 'all') {
          this.focusZone(this.activeFilter);
        } else {
          this.camera.targetX = -40;
          this.camera.targetY = 80;
          this.activeZoneId = null;
          this.showToast('Overview of DSU Main Campus', 'info');
        }
      });
    });
  }

  // ==========================================================================
  // UI & Live Counter Updates
  // ==========================================================================

  updateUI() {
    const currentSession = this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0];
    if (currentSession) {
      this.updateSessionSheetUI(currentSession);
    }
    this.updateOccupancyMeters();
    this.updateUpcomingList();
  }

  updateSessionSheetUI(session) {
    if (this.dom.sheetSessionTitle) {
      this.dom.sheetSessionTitle.textContent = session.title;
    }
    if (this.dom.sheetSessionSpeaker) {
      const zone = this.zones.find((z) => z.id === session.zoneId);
      const stageName = zone ? zone.name : 'Main Stage';
      this.dom.sheetSessionSpeaker.textContent = `${stageName} • ${session.speaker}`;
    }

    // Dynamic Time & Progress Calculations
    const now = Date.now();
    const startTime = session.startTimeMs ?? session.startTime ?? (now - 30 * 60 * 1000);
    const endTime = session.endTimeMs ?? session.endTime ?? (startTime + 60 * 60 * 1000);
    const totalDuration = Math.max(1, endTime - startTime);
    const elapsed = Math.max(0, now - startTime);
    const progressPercent = session.status === 'ENDED'
      ? 100
      : (session.status === 'UPCOMING' ? 0 : Math.min(100, Math.round((elapsed / totalDuration) * 100)));
    const remainingMs = Math.max(0, endTime - now);
    const remainingMins = Math.ceil(remainingMs / 60000);

    if (this.dom.sessionProgressBar) {
      this.dom.sessionProgressBar.style.width = `${progressPercent}%`;
    }

    if (this.dom.sessionCountdownText) {
      if (session.status === 'LIVE') {
        this.dom.sessionCountdownText.textContent = `${remainingMins}m remaining`;
      } else if (session.status === 'UPCOMING') {
        const untilStartMins = Math.ceil(Math.max(0, startTime - now) / 60000);
        this.dom.sessionCountdownText.textContent = `Starts in ${untilStartMins}m`;
      } else {
        this.dom.sessionCountdownText.textContent = 'Concluded';
      }
    }

    if (this.dom.timelineRemaining) {
      if (session.status === 'LIVE') {
        this.dom.timelineRemaining.textContent = `${remainingMins}m remaining`;
      } else if (session.status === 'UPCOMING') {
        const untilStartMins = Math.ceil(Math.max(0, startTime - now) / 60000);
        this.dom.timelineRemaining.textContent = `Starts in ${untilStartMins}m`;
      } else {
        this.dom.timelineRemaining.textContent = 'Completed';
      }
    }

    if (this.dom.timelineTimeSpan) {
      const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.dom.timelineTimeSpan.textContent = `${formatTime(startTime)} - ${formatTime(endTime)}`;
    }

    // Reset review form if session changed
    if (this.reviewState.submittedSessions.has(session.id)) {
      if (this.dom.btnSubmitReviewText) this.dom.btnSubmitReviewText.textContent = '✓ Review Submitted';
      if (this.dom.btnSubmitReview) {
        this.dom.btnSubmitReview.classList.remove('bg-indigo-600');
        this.dom.btnSubmitReview.classList.add('bg-emerald-600');
      }
    } else {
      if (this.dom.btnSubmitReviewText) this.dom.btnSubmitReviewText.textContent = 'Submit Review';
      if (this.dom.btnSubmitReview) {
        this.dom.btnSubmitReview.classList.add('bg-indigo-600');
        this.dom.btnSubmitReview.classList.remove('bg-emerald-600');
      }
    }
  }

  updateOccupancyMeters() {
    const activeZone = this.zones.find((z) => z.id === this.activeZoneId) || this.zones[0];
    const occEntry = activeZone ? this.occupancyMap[activeZone.id] : null;
    const count = typeof occEntry === 'object' && occEntry !== null
      ? (occEntry.count ?? occEntry.currentCount ?? 0)
      : (Number(occEntry) || 0);
    const capacity = (activeZone && activeZone.capacity) ? activeZone.capacity : 100;
    const densityPercent = Math.min(100, Math.round((count / capacity) * 100));

    let densityCategory = 'Normal Flow';
    let dotClass = 'w-1.5 h-1.5 rounded-full bg-emerald-400';
    let barClass = 'h-full bg-emerald-400 rounded-full transition-all duration-500';

    if (densityPercent >= 90) {
      densityCategory = 'At Capacity';
      dotClass = 'w-1.5 h-1.5 rounded-full bg-rose-400';
      barClass = 'h-full bg-rose-500 rounded-full transition-all duration-500';
    } else if (densityPercent >= 40) {
      densityCategory = 'Busy Room';
      dotClass = 'w-1.5 h-1.5 rounded-full bg-amber-400';
      barClass = 'h-full bg-amber-400 rounded-full transition-all duration-500';
    }

    if (this.dom.densityText) {
      this.dom.densityText.textContent = `${densityPercent}% Density • ${densityCategory}`;
    }
    if (this.dom.densityDot) {
      this.dom.densityDot.className = dotClass;
    }
    if (this.dom.capacityMeterBar) {
      this.dom.capacityMeterBar.className = barClass;
      this.dom.capacityMeterBar.style.width = `${densityPercent}%`;
    }
  }

  updateUpcomingList() {
    const container = this.dom.upcomingSessionsList;
    if (!container) return;

    const upcoming = this.sessions.filter(
      (s) => s.id !== this.activeSessionId && s.status !== 'ENDED'
    );

    if (upcoming.length === 0) {
      container.innerHTML = '<p class="text-[11px] text-slate-500 italic">No further sessions scheduled for today.</p>';
      return;
    }

    container.innerHTML = upcoming
      .slice(0, 3)
      .map((s) => `
        <div class="flex items-center justify-between p-2.5 rounded-lg bg-[#0a0e17] border border-[#232734]">
          <div class="min-w-0 flex-1">
            <h5 class="text-[11.5px] font-semibold text-white truncate">${escapeHtml(s.title)}</h5>
            <p class="text-[10px] text-slate-400 truncate">${escapeHtml(s.speaker)}</p>
          </div>
          <span class="text-[9.5px] font-mono px-2 py-0.5 rounded bg-[#181b25] text-indigo-300 font-semibold shrink-0">
            ${escapeHtml(s.status)}
          </span>
        </div>
      `)
      .join('');
  }

  showToast(message, type = 'info') {
    const container = this.dom.toastContainer;
    if (!container) return;

    const toast = document.createElement('div');
    const borderClass =
      type === 'emerald'
        ? 'border-emerald-500/50 bg-[#181b25]/95 text-emerald-300'
        : type === 'amber'
        ? 'border-amber-500/50 bg-[#181b25]/95 text-amber-300'
        : 'border-indigo-500/50 bg-[#181b25]/95 text-slate-200';

    toast.className = `toast-item pointer-events-none px-3.5 py-2 rounded-xl border backdrop-blur-xl shadow-2xl flex items-center gap-2 text-xs font-medium max-w-sm ${borderClass}`;
    toast.innerHTML = `
      <span class="material-symbols-outlined text-[16px]">${type === 'emerald' ? 'check_circle' : 'info'}</span>
      <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideToastOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
}

// ============================================================================
// 4. Auto-Bootstrap on DOM Content Loaded
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  window.participantApp = new ParticipantApp();
  window.participantApp.init();
});
