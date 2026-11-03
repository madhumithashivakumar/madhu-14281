/**
 * @file routes.js
 * @description API route dispatcher for TierTracker REST endpoints.
 * Strictly adheres to S-Tier Engineering: Zero external dependencies, pure ESM, typed HTTP responses.
 */

import { OccupancyEngine } from '../domain/occupancy.js';
import { SessionStateMachine, RatingCalculator } from '../domain/session.js';
import { SessionStatus } from '../domain/types.js';
import { CampusRoutingEngine } from '../domain/routing.js';

/**
 * Sends a structured JSON HTTP response with proper headers.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {Object} data
 */
export function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Creates an API request handler bound to the repository and presence store instances.
 *
 * @param {Object} dependencies
 * @param {import('../infra/file-repository.js').AtomicFileVenueRepository} dependencies.repository
 * @param {import('../infra/presence-store.js').SlidingWindowPresenceStore} dependencies.presenceStore
 * @param {import('../infra/campus-wifi-telemetry.js').CampusWifiTelemetryService} [dependencies.wifiTelemetryService]
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, parsedUrl: URL, body: any) => Promise<boolean>}
 */
export function createApiHandler({ repository, presenceStore, wifiTelemetryService }) {
  if (!repository) {
    throw new TypeError('API handler requires a valid repository instance');
  }
  if (!presenceStore) {
    throw new TypeError('API handler requires a valid presenceStore instance');
  }

  const routingEngine = new CampusRoutingEngine();

  return async function handleApiRequest(req, res, parsedUrl, body) {
    const { pathname } = parsedUrl;
    const method = req.method?.toUpperCase();

    // 0. GET /api/config
    if (pathname === '/api/config' && method === 'GET') {
      sendJson(res, 200, {
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      });
      return true;
    }

    // 0b. GET /api/events & POST /api/events/active
    if (pathname === '/api/events' && method === 'GET') {
      const events = await repository.getEvents();
      sendJson(res, 200, { events });
      return true;
    }

    if (pathname === '/api/events/active' && method === 'GET') {
      const event = await repository.getActiveEvent();
      sendJson(res, 200, { event });
      return true;
    }

    if (pathname === '/api/events/active' && method === 'POST') {
      const eventId = body?.id;
      if (!eventId || typeof eventId !== 'string') {
        sendJson(res, 400, { error: 'Event id is required' });
        return true;
      }
      const updated = await repository.setActiveEvent(eventId);
      if (!updated) {
        sendJson(res, 404, { error: 'Event not found', id: eventId });
        return true;
      }
      sendJson(res, 200, { success: true, event: updated });
      return true;
    }

    // 1. POST /api/presence
    if (pathname === '/api/presence' && method === 'POST') {
      const payload = body || {};
      const uid = payload.uid ?? payload.deviceId;
      const lat = payload.lat ?? payload.latitude;
      const lng = payload.lng ?? payload.longitude;
      const acc = payload.acc ?? payload.accuracyMeters;

      if (typeof acc !== 'number' || !Number.isFinite(acc)) {
        sendJson(res, 400, { error: 'Missing or invalid accuracy (acc)' });
        return true;
      }

      // Accuracy boundary check (reject noisy GPS drift > 35m)
      if (acc > 35) {
        sendJson(res, 422, {
          error: 'Accuracy too low for reliable venue localization',
          acc,
        });
        return true;
      }

      if (typeof uid !== 'string' || uid.trim().length === 0) {
        sendJson(res, 400, { error: 'Missing or invalid device id (uid)' });
        return true;
      }

      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        sendJson(res, 400, { error: 'Missing or invalid coordinates (lat, lng)' });
        return true;
      }

      const timestamp = Date.now();
      presenceStore.recordPing({
        deviceId: uid.trim(),
        lat,
        lng,
        accuracyMeters: acc,
        timestampMs: timestamp,
      });

      sendJson(res, 200, {
        success: true,
        uid: uid.trim(),
        timestamp,
      });
      return true;
    }

    // 2. GET /api/occupancy
    if (pathname === '/api/occupancy' && method === 'GET') {
      const zones = await repository.getZones();
      const activePings = presenceStore.getActivePings();
      const zonesOccupancy = {};

      for (const zone of zones) {
        const occ = OccupancyEngine.computeZoneOccupancy(zone, activePings);
        const wifi = wifiTelemetryService ? wifiTelemetryService.getZoneWifi(zone.id) : null;
        zonesOccupancy[zone.id] = {
          ...occ,
          count: occ.currentCount,
          density: occ.densityPercent,
          wifi: wifi ? {
            ...wifi,
            connectedClients: occ.currentCount,
          } : undefined,
        };
      }

      sendJson(res, 200, {
        timestamp: Date.now(),
        activePingsCount: activePings.length,
        zones: zonesOccupancy,
      });
      return true;
    }

    // 2b. GET /api/wifi
    if (pathname === '/api/wifi' && method === 'GET') {
      const status = wifiTelemetryService
        ? wifiTelemetryService.getInfrastructureStatus()
        : { status: 'OFFLINE', message: 'Campus Wi-Fi telemetry service inactive' };
      sendJson(res, 200, status);
      return true;
    }

    // 2c. POST /api/wifi/profile
    if (pathname === '/api/wifi/profile' && method === 'POST') {
      const { profile } = body || {};
      if (!profile || !['NORMAL', 'PEAK', 'OFFPEAK'].includes(profile)) {
        sendJson(res, 400, { error: 'Invalid profile. Allowed: NORMAL, PEAK, OFFPEAK' });
        return true;
      }
      if (wifiTelemetryService) {
        await wifiTelemetryService.setTrafficProfile(profile);
      }
      sendJson(res, 200, { success: true, profile });
      return true;
    }

    // 2d. POST /api/wifi/telemetry
    if (pathname === '/api/wifi/telemetry' && method === 'POST') {
      const { zoneId, count } = body || {};
      if (!zoneId || typeof count !== 'number' || count < 0) {
        sendJson(res, 400, { error: 'Missing or invalid zoneId or count' });
        return true;
      }
      if (wifiTelemetryService) {
        await wifiTelemetryService.setZoneClients(zoneId, count);
      }
      sendJson(res, 200, { success: true, zoneId, count });
      return true;
    }

    // 2e. GET /api/routes
    if (pathname === '/api/routes' && method === 'GET') {
      const from = parsedUrl.searchParams.get('from') || 'gate1';
      const to = parsedUrl.searchParams.get('to') || 'soe';
      const directions = routingEngine.generateDirections(from, to);
      sendJson(res, 200, directions);
      return true;
    }

    // 3. GET /api/zones
    if (pathname === '/api/zones' && method === 'GET') {
      const zones = await repository.getZones();
      sendJson(res, 200, { zones });
      return true;
    }

    // 4. POST /api/zones
    if (pathname === '/api/zones' && method === 'POST') {
      const zoneData = body || {};
      if (!zoneData.name || typeof zoneData.name !== 'string' || zoneData.name.trim().length === 0) {
        sendJson(res, 400, { error: 'Zone requires a valid name' });
        return true;
      }

      const zoneId = (typeof zoneData.id === 'string' && zoneData.id.trim().length > 0)
        ? zoneData.id.trim()
        : `zone-${Date.now()}`;

      const newZone = {
        ...zoneData,
        id: zoneId,
        name: zoneData.name.trim(),
        elevationMeters: typeof zoneData.elevationMeters === 'number' && Number.isFinite(zoneData.elevationMeters)
          ? zoneData.elevationMeters
          : 10,
        capacity: typeof zoneData.capacity === 'number' && Number.isFinite(zoneData.capacity) && zoneData.capacity >= 0
          ? Math.floor(zoneData.capacity)
          : 50,
        accessTier: zoneData.accessTier || 'PUBLIC',
      };

      const savedZone = await repository.saveZone(newZone);
      sendJson(res, 201, { zone: savedZone });
      return true;
    }

    // 4b. PATCH /api/zones/:id or PUT /api/zones/:id
    const zoneItemMatch = pathname.match(/^\/api\/zones\/([^/]+)$/);
    if (zoneItemMatch && (method === 'PATCH' || method === 'PUT')) {
      const zoneId = decodeURIComponent(zoneItemMatch[1]).trim();
      const existing = await repository.getZone(zoneId);
      if (!existing) {
        sendJson(res, 404, { error: 'Zone not found', id: zoneId });
        return true;
      }

      const updates = body || {};
      const updatedZone = await repository.saveZone({
        ...existing,
        ...updates,
        id: zoneId,
      });
      sendJson(res, 200, { zone: updatedZone });
      return true;
    }

    // 4c. DELETE /api/zones/:id
    if (zoneItemMatch && method === 'DELETE') {
      const zoneId = decodeURIComponent(zoneItemMatch[1]).trim();
      const deleted = await repository.deleteZone(zoneId);
      if (!deleted) {
        sendJson(res, 404, { error: 'Zone not found', id: zoneId });
        return true;
      }
      sendJson(res, 200, { success: true, id: zoneId });
      return true;
    }

    // 5. GET /api/sessions
    if (pathname === '/api/sessions' && method === 'GET') {
      const sessions = await repository.getSessions();
      sendJson(res, 200, { sessions });
      return true;
    }

    // 5b. POST /api/sessions
    if (pathname === '/api/sessions' && method === 'POST') {
      const sessionData = body || {};
      if (!sessionData.title || typeof sessionData.title !== 'string' || sessionData.title.trim().length === 0) {
        sendJson(res, 400, { error: 'Session requires a valid title' });
        return true;
      }

      if (!sessionData.zoneId || typeof sessionData.zoneId !== 'string' || sessionData.zoneId.trim().length === 0) {
        sendJson(res, 400, { error: 'Session requires a valid zoneId' });
        return true;
      }

      const sessionId = (typeof sessionData.id === 'string' && sessionData.id.trim().length > 0)
        ? sessionData.id.trim()
        : `session-${Date.now()}`;

      const now = Date.now();
      const rawStatus = sessionData.status ? String(sessionData.status).toUpperCase().trim() : SessionStatus.UPCOMING;
      const validStatuses = Object.values(SessionStatus);
      const status = validStatuses.includes(rawStatus) ? rawStatus : SessionStatus.UPCOMING;

      const newSession = {
        ...sessionData,
        id: sessionId,
        title: sessionData.title.trim(),
        zoneId: sessionData.zoneId.trim(),
        speaker: typeof sessionData.speaker === 'string' ? sessionData.speaker.trim() : '',
        startTimeMs: typeof sessionData.startTimeMs === 'number' && Number.isFinite(sessionData.startTimeMs)
          ? sessionData.startTimeMs
          : now,
        endTimeMs: typeof sessionData.endTimeMs === 'number' && Number.isFinite(sessionData.endTimeMs)
          ? sessionData.endTimeMs
          : now + 3600000,
        status,
        ratings: Array.isArray(sessionData.ratings) ? sessionData.ratings : [],
        averageRating: typeof sessionData.averageRating === 'number' && Number.isFinite(sessionData.averageRating)
          ? sessionData.averageRating
          : 0,
      };

      const savedSession = await repository.saveSession(newSession);
      sendJson(res, 201, { session: savedSession });
      return true;
    }

    // 5c. DELETE /api/sessions/:id
    const sessionItemMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionItemMatch && method === 'DELETE') {
      const sessionId = decodeURIComponent(sessionItemMatch[1]).trim();
      const deleted = await repository.deleteSession(sessionId);
      if (!deleted) {
        sendJson(res, 404, { error: 'Session not found', id: sessionId });
        return true;
      }
      sendJson(res, 200, { success: true, id: sessionId });
      return true;
    }

    // 6. POST /api/sessions/:id/transition
    const transitionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/transition$/);
    if (transitionMatch && method === 'POST') {
      const sessionId = decodeURIComponent(transitionMatch[1]).trim();
      const session = await repository.getSession(sessionId);
      if (!session) {
        sendJson(res, 404, { error: 'Session not found', id: sessionId });
        return true;
      }

      // Check action: 'START' -> 'LIVE', 'END' -> 'ENDED', 'EXTEND' -> extend endTimeMs
      const action = body?.action ? String(body.action).toUpperCase().trim() : null;

      if (action === 'EXTEND') {
        const extensionMinutes = typeof body?.extensionMinutes === 'number' && Number.isFinite(body.extensionMinutes) && body.extensionMinutes > 0
          ? body.extensionMinutes
          : 15;
        const currentEndTime = session.endTimeMs || Date.now();
        const baseTime = Math.max(currentEndTime, Date.now());
        const updatedSession = {
          ...session,
          endTimeMs: baseTime + extensionMinutes * 60 * 1000,
          updatedAtMs: Date.now(),
        };
        const saved = await repository.saveSession(updatedSession);
        sendJson(res, 200, { session: saved });
        return true;
      }

      let targetStatus = body?.status ?? body?.targetStatus;
      if (!targetStatus && action) {
        if (action === 'START') targetStatus = SessionStatus.LIVE;
        else if (action === 'END') targetStatus = SessionStatus.ENDED;
      }

      if (!targetStatus || typeof targetStatus !== 'string') {
        sendJson(res, 400, { error: 'Missing or invalid status for transition' });
        return true;
      }

      const result = SessionStateMachine.transition(session, targetStatus.trim());
      if (!result.ok) {
        sendJson(res, 400, { error: result.error.message, code: result.error.name });
        return true;
      }

      const updated = await repository.saveSession(result.value);
      sendJson(res, 200, { session: updated });
      return true;
    }

    // 7. POST /api/sessions/:id/rate
    const rateMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/rate$/);
    if (rateMatch && method === 'POST') {
      const sessionId = decodeURIComponent(rateMatch[1]).trim();
      const session = await repository.getSession(sessionId);

      if (!session) {
        sendJson(res, 404, { error: 'Session not found', id: sessionId });
        return true;
      }

      const deviceId = body?.deviceId ?? body?.uid;
      const stars = body?.stars;
      const comment = body?.comment ?? '';

      const result = RatingCalculator.addRating(session, {
        deviceId,
        stars,
        comment,
      });

      if (!result.ok) {
        sendJson(res, 400, { error: result.error.message, code: result.error.name });
        return true;
      }

      const updated = await repository.saveSession(result.value);
      sendJson(res, 200, { session: updated });
      return true;
    }

    // 8. GET /api/alerts
    if (pathname === '/api/alerts' && method === 'GET') {
      const activeOnly = parsedUrl.searchParams.get('activeOnly') === 'true';
      const alerts = await repository.getAlerts(activeOnly);
      sendJson(res, 200, { alerts });
      return true;
    }

    // 8b. POST /api/alerts (Admin Broadcast Alert - Persisted)
    if (pathname === '/api/alerts' && method === 'POST') {
      const alertData = body || {};
      if (!alertData.message || typeof alertData.message !== 'string' || alertData.message.trim().length === 0) {
        sendJson(res, 400, { error: 'Alert requires a non-empty message' });
        return true;
      }
      const savedAlert = await repository.saveAlert(alertData);
      sendJson(res, 201, {
        success: true,
        alert: savedAlert,
        timestamp: savedAlert.createdAtMs,
        message: savedAlert.message,
        level: savedAlert.severity.toLowerCase(),
        targetZoneId: savedAlert.targetZoneId,
      });
      return true;
    }

    // 8c. DELETE /api/alerts/:id
    const alertItemMatch = pathname.match(/^\/api\/alerts\/([^/]+)$/);
    if (alertItemMatch && method === 'DELETE') {
      const alertId = decodeURIComponent(alertItemMatch[1]).trim();
      const dismissed = await repository.dismissAlert(alertId);
      if (!dismissed) {
        sendJson(res, 404, { error: 'Alert not found', id: alertId });
        return true;
      }
      sendJson(res, 200, { success: true, id: alertId });
      return true;
    }

    // Fallback: If starts with /api/ but no matching route
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: `Endpoint not found: ${method} ${pathname}` });
      return true;
    }

    return false;
  };
}
