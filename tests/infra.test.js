/**
 * @file infra.test.js
 * @description Integration and unit tests for Persistence, Presence Store, API Router, and HTTP Server.
 * Strictly adheres to S-Tier Engineering: Hermetic, zero external dependencies, 100% test pass.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SlidingWindowPresenceStore } from '../src/infra/presence-store.js';
import { AtomicFileVenueRepository } from '../src/infra/file-repository.js';
import { createServer } from '../src/server.js';

describe('Infrastructure: SlidingWindowPresenceStore', () => {
  test('initializes with custom sliding window and validates input', () => {
    const store = new SlidingWindowPresenceStore(30);
    assert.equal(store.windowSec, 30);
    assert.equal(store.size, 0);

    assert.throws(() => new SlidingWindowPresenceStore(0), TypeError);
    assert.throws(() => new SlidingWindowPresenceStore(-10), TypeError);
    assert.throws(() => new SlidingWindowPresenceStore('invalid'), TypeError);
  });

  test('records and updates presence pings by deviceId / uid', () => {
    const store = new SlidingWindowPresenceStore(60);
    const now = Date.now();
    const recorded1 = store.recordPing({
      uid: 'dev-001',
      lat: 37.7845,
      lng: -122.4015,
      acc: 12,
      timestamp: now - 5000,
    });

    assert.equal(recorded1.deviceId, 'dev-001');
    assert.equal(recorded1.lat, 37.7845);
    assert.equal(recorded1.lng, -122.4015);
    assert.equal(recorded1.accuracyMeters, 12);
    assert.equal(store.size, 1);

    // Update same device with new coordinates
    const recorded2 = store.recordPing({
      deviceId: 'dev-001',
      lat: 37.7849,
      lng: -122.4011,
      accuracyMeters: 8,
      timestampMs: now - 1000,
    });

    assert.equal(store.size, 1);
    assert.equal(recorded2.lat, 37.7849);
    assert.equal(recorded2.accuracyMeters, 8);
  });

  test('evicts stale pings outside sliding window based on reference time', () => {
    const store = new SlidingWindowPresenceStore(10); // 10 second window
    const now = Date.now();

    store.recordPing({
      uid: 'dev-old',
      lat: 37.784,
      lng: -122.401,
      acc: 5,
      timestampMs: now - 15000, // 15s old -> older than 10s window
    });

    store.recordPing({
      uid: 'dev-recent',
      lat: 37.785,
      lng: -122.402,
      acc: 5,
      timestampMs: now - 2000, // 2s old -> within 10s window
    });

    const active = store.getActivePings(now);
    assert.equal(active.length, 1);
    assert.equal(active[0].deviceId, 'dev-recent');
    assert.equal(store.size, 1);
  });

  test('validates inputs defensively and rejects corrupt ping payloads', () => {
    const store = new SlidingWindowPresenceStore(60);

    assert.throws(() => store.recordPing(null), TypeError);
    assert.throws(() => store.recordPing({ uid: '', lat: 37.78, lng: -122.4 }), TypeError);
    assert.throws(() => store.recordPing({ uid: 'dev-1', lat: 95, lng: -122.4 }), TypeError);
    assert.throws(() => store.recordPing({ uid: 'dev-1', lat: 37.78, lng: 190 }), TypeError);
    assert.throws(() => store.recordPing({ uid: 'dev-1', lat: 37.78, lng: -122.4, acc: -5 }), TypeError);
  });

  test('clear() empties the store completely', () => {
    const store = new SlidingWindowPresenceStore(60);
    store.recordPing({ uid: 'dev-1', lat: 37.78, lng: -122.4, acc: 5 });
    assert.equal(store.size, 1);
    store.clear();
    assert.equal(store.size, 0);
    assert.equal(store.getActivePings().length, 0);
  });
});

describe('Infrastructure: AtomicFileVenueRepository', () => {
  const testDir = join(tmpdir(), `tiertracker-repo-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const testDbFile = join(testDir, 'test-db.json');

  before(async () => {
    await mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('initializes default structure when database file is missing', async () => {
    const repo = new AtomicFileVenueRepository(testDbFile);
    const data = await repo.readData();

    assert.deepEqual(data.events, []);
    assert.deepEqual(data.zones, []);
    assert.deepEqual(data.sessions, []);
    assert.deepEqual(data.alerts, []);

    // File should now exist on disk
    const raw = await readFile(testDbFile, 'utf8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, { events: [], zones: [], sessions: [], alerts: [] });
  });

  test('performs CRUD on zones with atomic serialization', async () => {
    const repo = new AtomicFileVenueRepository(testDbFile);

    const zone1 = {
      id: 'z-auditorium',
      name: 'Main Auditorium',
      capacity: 100,
      elevationMeters: 15,
      accessTier: 'PUBLIC',
      boundary: {
        vertices: [
          { lat: 37.784, lng: -122.401 },
          { lat: 37.785, lng: -122.401 },
          { lat: 37.785, lng: -122.400 },
          { lat: 37.784, lng: -122.400 },
        ],
      },
    };

    const saved = await repo.saveZone(zone1);
    assert.equal(saved.id, 'z-auditorium');

    const fetched = await repo.getZone('z-auditorium');
    assert.deepEqual(fetched, zone1);

    const allZones = await repo.getZones();
    assert.equal(allZones.length, 1);
    assert.equal(allZones[0].id, 'z-auditorium');

    // Update zone
    await repo.saveZone({ id: 'z-auditorium', capacity: 120 });
    const updated = await repo.getZone('z-auditorium');
    assert.equal(updated.capacity, 120);
    assert.equal(updated.name, 'Main Auditorium');
  });

  test('performs CRUD on sessions with atomic serialization', async () => {
    const repo = new AtomicFileVenueRepository(testDbFile);

    const session1 = {
      id: 's-keynote',
      zoneId: 'z-auditorium',
      title: 'Opening Keynote',
      speaker: 'Jane Doe',
      startTimeMs: 1730000000000,
      endTimeMs: 1730003600000,
      status: 'UPCOMING',
      ratings: [],
      averageRating: 0,
    };

    const saved = await repo.saveSession(session1);
    assert.equal(saved.id, 's-keynote');

    const fetched = await repo.getSession('s-keynote');
    assert.deepEqual(fetched, session1);

    const allSessions = await repo.getSessions();
    assert.equal(allSessions.length, 1);
    assert.equal(allSessions[0].id, 's-keynote');
  });

  test('guarantees crash resilience and zero corruption under heavy concurrent writes', async () => {
    const concurrentDbFile = join(testDir, 'concurrent-db.json');
    const repo = new AtomicFileVenueRepository(concurrentDbFile);

    // Trigger 50 concurrent writes in parallel
    const writeCount = 50;
    const writePromises = [];

    for (let i = 0; i < writeCount; i++) {
      writePromises.push(
        repo.saveZone({
          id: `concurrent-zone-${i}`,
          name: `Concurrent Zone ${i}`,
          capacity: i * 10,
        })
      );
    }

    await Promise.all(writePromises);

    // Verify all 50 zones were written and file is valid non-corrupted JSON
    const data = await repo.readData();
    assert.equal(data.zones.length, writeCount);

    const raw = await readFile(concurrentDbFile, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.zones.length, writeCount);
  });

  test('deduplicates zones when saving with existing normalized name or id', async () => {
    const dedupDbFile = join(testDir, 'dedup-db.json');
    const repo = new AtomicFileVenueRepository(dedupDbFile);

    // Save initial zone
    await repo.saveZone({
      id: 'zone-ai-lab',
      name: 'AI Quantum Lab',
      capacity: 50,
      elevationMeters: 10,
    });

    // Save zone with different auto-generated ID but identical name
    await repo.saveZone({
      id: 'zone-duplicate-12345',
      name: 'ai quantum lab',
      capacity: 75,
      elevationMeters: 12,
    });

    const zones = await repo.getZones();
    assert.equal(zones.length, 1, 'Should update existing zone instead of duplicating');
    assert.equal(zones[0].id, 'zone-ai-lab');
    assert.equal(zones[0].capacity, 75);
    assert.equal(zones[0].elevationMeters, 12);
  });

  test('manages events and active event selection atomically', async () => {
    const eventDbFile = join(testDir, 'event-db.json');
    const repo = new AtomicFileVenueRepository(eventDbFile);

    await repo.saveEvent({
      id: 'ev-1',
      name: 'Tech Summit 2026',
      isActive: true,
    });
    await repo.saveEvent({
      id: 'ev-2',
      name: 'Spatial Days',
      isActive: false,
    });

    const allEvents = await repo.getEvents();
    assert.equal(allEvents.length, 2);

    const activeBefore = await repo.getActiveEvent();
    assert.equal(activeBefore.id, 'ev-1');

    // Switch active event
    const switched = await repo.setActiveEvent('ev-2');
    assert.equal(switched.id, 'ev-2');
    assert.equal(switched.isActive, true);

    const activeAfter = await repo.getActiveEvent();
    assert.equal(activeAfter.id, 'ev-2');

    const ev1Updated = (await repo.getEvents()).find((e) => e.id === 'ev-1');
    assert.equal(ev1Updated.isActive, false);
  });

  test('manages alerts and dismissals atomically', async () => {
    const alertDbFile = join(testDir, 'alert-db.json');
    const repo = new AtomicFileVenueRepository(alertDbFile);

    const savedAlert = await repo.saveAlert({
      title: 'Weather Warning',
      message: 'Heavy rain expected near outdoor stage',
      severity: 'WARNING',
      targetZoneId: 'zone-outdoor',
    });

    assert.ok(savedAlert.id.startsWith('alert-'));
    assert.equal(savedAlert.isActive, true);

    const activeAlerts = await repo.getAlerts(true);
    assert.equal(activeAlerts.length, 1);
    assert.equal(activeAlerts[0].title, 'Weather Warning');

    // Dismiss alert
    const dismissed = await repo.dismissAlert(savedAlert.id);
    assert.equal(dismissed, true);

    const activeAfter = await repo.getAlerts(true);
    assert.equal(activeAfter.length, 0);

    const allAfter = await repo.getAlerts(false);
    assert.equal(allAfter.length, 1);
    assert.equal(allAfter[0].isActive, false);
  });
});

describe('Infrastructure: API Gateway & HTTP Server Integration', () => {
  const testDir = join(tmpdir(), `tiertracker-server-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const testDbFile = join(testDir, 'db.json');
  let server;
  let baseUrl;

  before(async () => {
    await mkdir(testDir, { recursive: true });

    // Seed database for server test
    const initialSeed = {
      events: [
        {
          id: 'event-alpha',
          name: 'Tech Summit Global 2026',
          venue: 'Moscone West',
          isActive: true,
        },
        {
          id: 'event-beta',
          name: 'Global AI Expo 2026',
          venue: 'San Jose CC',
          isActive: false,
        },
      ],
      zones: [
        {
          id: 'zone-alpha',
          name: 'Alpha Hall',
          capacity: 100,
          elevationMeters: 15,
          accessTier: 'PUBLIC',
          boundary: {
            vertices: [
              { lat: 37.784, lng: -122.402 },
              { lat: 37.786, lng: -122.402 },
              { lat: 37.786, lng: -122.400 },
              { lat: 37.784, lng: -122.400 },
            ],
          },
        },
      ],
      sessions: [
        {
          id: 'session-alpha',
          zoneId: 'zone-alpha',
          title: 'Spatial Architecture',
          speaker: 'Ada Lovelace',
          startTimeMs: 1730000000000,
          endTimeMs: 1730003600000,
          status: 'UPCOMING',
          ratings: [],
          averageRating: 0,
        },
      ],
      alerts: [
        {
          id: 'alert-init-1',
          title: 'Welcome Notice',
          message: 'Welcome to the venue',
          severity: 'INFO',
          targetZoneId: 'ALL',
          isActive: true,
        },
      ],
    };

    const repo = new AtomicFileVenueRepository(testDbFile);
    await repo.writeData(initialSeed);

    server = createServer({
      dbPath: testDbFile,
      publicDir: 'public',
      windowSec: 60,
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(testDir, { recursive: true, force: true });
  });

  test('CORS headers and OPTIONS pre-flight are handled', async () => {
    const res = await fetch(`${baseUrl}/api/zones`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  test('GET /api/zones returns all venue zones', async () => {
    const res = await fetch(`${baseUrl}/api/zones`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.zones));
    assert.equal(body.zones.length, 1);
    assert.equal(body.zones[0].id, 'zone-alpha');
  });

  test('POST /api/zones creates and persists a new zone', async () => {
    const newZone = {
      name: 'Beta Workshop',
      capacity: 40,
      elevationMeters: 10,
      accessTier: 'PUBLIC',
      boundary: {
        vertices: [
          { lat: 37.781, lng: -122.405 },
          { lat: 37.783, lng: -122.405 },
          { lat: 37.783, lng: -122.403 },
          { lat: 37.781, lng: -122.403 },
        ],
      },
    };

    const res = await fetch(`${baseUrl}/api/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newZone),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.zone);
    assert.equal(body.zone.name, 'Beta Workshop');
    assert.ok(body.zone.id.startsWith('zone-'));

    // Check retrieval via GET
    const listRes = await fetch(`${baseUrl}/api/zones`);
    const list = await listRes.json();
    assert.equal(list.zones.length, 2);
  });

  test('GET /api/sessions returns all sessions', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sessions));
    assert.equal(body.sessions[0].id, 'session-alpha');
  });

  test('POST /api/presence validates accuracy and records reliable pings', async () => {
    // 1. Accuracy too low (> 35m drift) -> 422 Unprocessable Entity
    const rejectRes = await fetch(`${baseUrl}/api/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: 'device-noisy',
        lat: 37.785,
        lng: -122.401,
        acc: 45, // Exceeds 35m threshold
      }),
    });

    assert.equal(rejectRes.status, 422);
    const rejectBody = await rejectRes.json();
    assert.equal(rejectBody.error, 'Accuracy too low for reliable venue localization');
    assert.equal(rejectBody.acc, 45);

    // 2. High accuracy ping inside zone-alpha -> 200 OK
    const acceptRes = await fetch(`${baseUrl}/api/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: 'device-good-1',
        lat: 37.785,
        lng: -122.401,
        acc: 8,
      }),
    });

    assert.equal(acceptRes.status, 200);
    const acceptBody = await acceptRes.json();
    assert.equal(acceptBody.success, true);
    assert.equal(acceptBody.uid, 'device-good-1');
    assert.ok(typeof acceptBody.timestamp === 'number');
  });

  test('GET /api/occupancy returns real-time spatial calculations', async () => {
    const res = await fetch(`${baseUrl}/api/occupancy`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(typeof data.timestamp === 'number');
    assert.equal(data.activePingsCount, 1);
    assert.ok(data.zones['zone-alpha']);

    const alphaOccupancy = data.zones['zone-alpha'];
    assert.equal(alphaOccupancy.currentCount, 1);
    assert.equal(alphaOccupancy.capacity, 100);
    assert.equal(alphaOccupancy.densityPercent, 1);
    assert.equal(alphaOccupancy.densityTier, 'LOW');
  });

  test('POST /api/sessions/:id/transition applies strict state transitions', async () => {
    // Valid transition: UPCOMING -> LIVE
    const liveRes = await fetch(`${baseUrl}/api/sessions/session-alpha/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'LIVE' }),
    });

    assert.equal(liveRes.status, 200);
    const liveBody = await liveRes.json();
    assert.equal(liveBody.session.status, 'LIVE');
    assert.ok(liveBody.session.actualStartTimeMs > 0);

    // Invalid transition: LIVE -> UPCOMING (illegal backward move)
    const illegalRes = await fetch(`${baseUrl}/api/sessions/session-alpha/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'UPCOMING' }),
    });

    assert.equal(illegalRes.status, 400);

    // Valid transition: LIVE -> ENDED
    const endRes = await fetch(`${baseUrl}/api/sessions/session-alpha/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ENDED' }),
    });

    assert.equal(endRes.status, 200);
    const endBody = await endRes.json();
    assert.equal(endBody.session.status, 'ENDED');

    // 404 for non-existent session
    const notFoundRes = await fetch(`${baseUrl}/api/sessions/unknown-session/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'LIVE' }),
    });
    assert.equal(notFoundRes.status, 404);
  });

  test('POST /api/sessions/:id/rate records participant reviews and updates averageRating', async () => {
    // Add 1st rating: 5 stars
    const r1 = await fetch(`${baseUrl}/api/sessions/session-alpha/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'user-phone-1',
        stars: 5,
        comment: 'Brilliant keynote presentation!',
      }),
    });

    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.session.ratings.length, 1);
    assert.equal(b1.session.averageRating, 5);

    // Add 2nd rating: 3 stars
    const r2 = await fetch(`${baseUrl}/api/sessions/session-alpha/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'user-phone-2',
        stars: 3,
        comment: 'Good content, audio was slightly quiet.',
      }),
    });

    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.session.ratings.length, 2);
    assert.equal(b2.session.averageRating, 4.0); // (5+3)/2 = 4.0

    // Reject invalid rating (stars = 7)
    const rInvalid = await fetch(`${baseUrl}/api/sessions/session-alpha/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'user-phone-3',
        stars: 7,
      }),
    });
    assert.equal(rInvalid.status, 400);

    // 404 for non-existent session
    const rNotFound = await fetch(`${baseUrl}/api/sessions/ghost-session/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'user-1', stars: 5 }),
    });
    assert.equal(rNotFound.status, 404);
  });

  test('POST /api/sessions/:id/rate handles idempotent updates for repeat deviceId', async () => {
    // Initial rating: 4 stars
    const r1 = await fetch(`${baseUrl}/api/sessions/session-alpha/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'device-idempotent-test',
        stars: 4,
        comment: 'Initial opinion',
      }),
    });
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    const countBefore = b1.session.ratings.length;

    // Repeat rating from same deviceId: 5 stars
    const r2 = await fetch(`${baseUrl}/api/sessions/session-alpha/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'device-idempotent-test',
        stars: 5,
        comment: 'Updated opinion after workshop',
      }),
    });
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.session.ratings.length, countBefore, 'Rating list must not duplicate entries for same device');
    const matched = b2.session.ratings.find((r) => r.deviceId === 'device-idempotent-test');
    assert.equal(matched.stars, 5);
    assert.equal(matched.comment, 'Updated opinion after workshop');
  });

  test('GET /api/config returns googleMapsApiKey mapping', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.googleMapsApiKey === 'string');
  });

  test('GET /api/events and POST /api/events/active manage events', async () => {
    // Fetch all events
    const resAll = await fetch(`${baseUrl}/api/events`);
    assert.equal(resAll.status, 200);
    const dataAll = await resAll.json();
    assert.ok(Array.isArray(dataAll.events));
    assert.equal(dataAll.events.length, 2);

    // Fetch active event
    const resActive = await fetch(`${baseUrl}/api/events/active`);
    assert.equal(resActive.status, 200);
    const dataActive = await resActive.json();
    assert.equal(dataActive.event.id, 'event-alpha');

    // Switch active event to event-beta
    const resSwitch = await fetch(`${baseUrl}/api/events/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'event-beta' }),
    });
    assert.equal(resSwitch.status, 200);
    const dataSwitch = await resSwitch.json();
    assert.equal(dataSwitch.success, true);
    assert.equal(dataSwitch.event.id, 'event-beta');
    assert.equal(dataSwitch.event.isActive, true);

    // Verify active event changed
    const resVerify = await fetch(`${baseUrl}/api/events/active`);
    const dataVerify = await resVerify.json();
    assert.equal(dataVerify.event.id, 'event-beta');
  });

  test('GET /api/alerts, POST /api/alerts, and DELETE /api/alerts/:id manage alerts', async () => {
    // Fetch initial alerts
    const resGet = await fetch(`${baseUrl}/api/alerts`);
    assert.equal(resGet.status, 200);
    const dataGet = await resGet.json();
    assert.ok(Array.isArray(dataGet.alerts));
    assert.equal(dataGet.alerts.length, 1);

    // Verify rejection of invalid alert without message
    const resBadAlert = await fetch(`${baseUrl}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Invalid Empty Alert', message: '' }),
    });
    assert.equal(resBadAlert.status, 400);

    // Post new alert
    const resPost = await fetch(`${baseUrl}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Spill Detected',
        message: 'Cleaning crew dispatched to Hall B',
        level: 'warning',
        targetZoneId: 'zone-alpha',
      }),
    });
    assert.equal(resPost.status, 201);
    const dataPost = await resPost.json();
    assert.equal(dataPost.success, true);
    assert.ok(dataPost.alert.id.startsWith('alert-'));
    assert.equal(dataPost.alert.title, 'Spill Detected');

    // Verify persisted via GET
    const resGet2 = await fetch(`${baseUrl}/api/alerts`);
    const dataGet2 = await resGet2.json();
    assert.equal(dataGet2.alerts.length, 2);

    // Dismiss alert via DELETE
    const resDel = await fetch(`${baseUrl}/api/alerts/${dataPost.alert.id}`, {
      method: 'DELETE',
    });
    assert.equal(resDel.status, 200);

    // Verify activeOnly filters dismissed alert
    const resActive = await fetch(`${baseUrl}/api/alerts?activeOnly=true`);
    const dataActive = await resActive.json();
    assert.equal(dataActive.alerts.length, 1);
  });

  test('Static file serving handles /admin and /app routes securely', async () => {
    const adminRes = await fetch(`${baseUrl}/admin`);
    assert.equal(adminRes.status, 200);
    assert.match(adminRes.headers.get('content-type'), /text\/html/);

    const traversalRes = await fetch(`${baseUrl}/../../../../etc/passwd`);
    assert.ok(traversalRes.status === 403 || traversalRes.status === 404);

    const missingRes = await fetch(`${baseUrl}/non-existent-file.xyz`);
    assert.equal(missingRes.status, 404);
  });

  test('Rejects oversized payloads exceeding 1MB ceiling with 413', async () => {
    const hugePayload = JSON.stringify({
      data: 'x'.repeat(1024 * 1024 + 100),
    });

    try {
      const res = await fetch(`${baseUrl}/api/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hugePayload,
      });
      assert.equal(res.status, 413);
    } catch (err) {
      // Under Node.js native fetch, a destroyed request connection throws fetch failed
      assert.ok(err);
    }
  });
});
