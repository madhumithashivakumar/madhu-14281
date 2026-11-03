/**
 * @file domain.test.js
 * @description Hermetic, zero-mock unit test suite for TierTracker Domain Core & Geospatial Engine.
 * Uses native Node.js test runner (`node:test`) and assertion library (`node:assert/strict`).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  AccessTier,
  SessionStatus,
  DensityTier,
  DomainError,
  InvalidCoordinatesError,
  PolygonClosureError,
  InvalidStateTransitionError,
  InvalidRatingError,
  ok,
  err,
  isOk,
  isErr,
  createCoordinates,
  createGeoPolygon,
  createPresencePing,
} from '../src/domain/types.js';

import {
  SpatialRayCaster,
  containsPoint,
  computeBoundingBox,
  isInBoundingBox,
} from '../src/domain/spatial.js';

import {
  OccupancyEngine,
  calculateDensityTier,
  computeZoneOccupancy,
} from '../src/domain/occupancy.js';

import {
  SessionStateMachine,
  RatingCalculator,
  transitionSession,
  addRating,
} from '../src/domain/session.js';

import {
  CampusRoutingEngine,
  calculateDistanceMeters,
  calculateBearing,
  getTurnType,
  CAMPUS_NODES,
} from '../src/domain/routing.js';

// ============================================================================
// 1. Types, Enums, Errors & Value Object Factories
// ============================================================================

describe('Domain Core: Types, Enums & Result Utilities', () => {
  test('Enums are immutable frozen dictionaries', () => {
    assert.deepEqual(AccessTier, {
      PUBLIC: 'PUBLIC',
      VIP: 'VIP',
      RESTRICTED: 'RESTRICTED',
    });
    assert.deepEqual(SessionStatus, {
      UPCOMING: 'UPCOMING',
      LIVE: 'LIVE',
      ENDED: 'ENDED',
    });
    assert.deepEqual(DensityTier, {
      LOW: 'LOW',
      MODERATE: 'MODERATE',
      HIGH: 'HIGH',
      CRITICAL: 'CRITICAL',
    });

    assert.ok(Object.isFrozen(AccessTier));
    assert.ok(Object.isFrozen(SessionStatus));
    assert.ok(Object.isFrozen(DensityTier));

    // Verify mutations fail silently or throw in strict mode
    assert.throws(() => {
      AccessTier.NEW_TIER = 'NEW_TIER';
    }, TypeError);
  });

  test('Result type utility creates valid ok and err structures', () => {
    const success = ok({ id: 'evt-100', name: 'Keynote' });
    assert.equal(success.ok, true);
    assert.equal(success.error, null);
    assert.equal(success.value.name, 'Keynote');
    assert.ok(isOk(success));
    assert.equal(isErr(success), false);
    assert.ok(Object.isFrozen(success));

    const failure = err(new InvalidRatingError(6));
    assert.equal(failure.ok, false);
    assert.equal(failure.value, null);
    assert.ok(failure.error instanceof InvalidRatingError);
    assert.ok(isErr(failure));
    assert.equal(isOk(failure), false);
    assert.ok(Object.isFrozen(failure));
  });

  test('Domain error hierarchy preserves names and prototypes', () => {
    const coordErr = new InvalidCoordinatesError(95, 10);
    assert.ok(coordErr instanceof Error);
    assert.ok(coordErr instanceof DomainError);
    assert.ok(coordErr instanceof InvalidCoordinatesError);
    assert.equal(coordErr.name, 'InvalidCoordinatesError');
    assert.equal(coordErr.lat, 95);
    assert.equal(coordErr.lng, 10);

    const polyErr = new PolygonClosureError('Too few points');
    assert.ok(polyErr instanceof DomainError);
    assert.equal(polyErr.name, 'PolygonClosureError');

    const stateErr = new InvalidStateTransitionError('UPCOMING', 'ENDED');
    assert.ok(stateErr instanceof DomainError);
    assert.equal(stateErr.name, 'InvalidStateTransitionError');
    assert.equal(stateErr.fromStatus, 'UPCOMING');
    assert.equal(stateErr.toStatus, 'ENDED');

    const ratingErr = new InvalidRatingError(0);
    assert.ok(ratingErr instanceof DomainError);
    assert.equal(ratingErr.name, 'InvalidRatingError');
    assert.equal(ratingErr.stars, 0);
  });
});

describe('Domain Core: Value Object Factories', () => {
  test('createCoordinates accepts valid inputs across boundary ranges', () => {
    const c1 = createCoordinates(37.7749, -122.4194);
    assert.equal(c1.lat, 37.7749);
    assert.equal(c1.lng, -122.4194);
    assert.ok(Object.isFrozen(c1));

    // Bounds boundaries
    const cNorthPole = createCoordinates(90, 0);
    assert.equal(cNorthPole.lat, 90);
    const cSouthPole = createCoordinates(-90, 0);
    assert.equal(cSouthPole.lat, -90);
    const cAntimeridian1 = createCoordinates(0, 180);
    assert.equal(cAntimeridian1.lng, 180);
    const cAntimeridian2 = createCoordinates(0, -180);
    assert.equal(cAntimeridian2.lng, -180);

    // Object signature
    const cObj = createCoordinates({ lat: 12.9716, lng: 77.5946 });
    assert.equal(cObj.lat, 12.9716);
    assert.equal(cObj.lng, 77.5946);

    // GeoJSON array [lng, lat]
    const cGeoJson = createCoordinates([77.5946, 12.9716]);
    assert.equal(cGeoJson.lat, 12.9716);
    assert.equal(cGeoJson.lng, 77.5946);

    // Object signature with lon alias
    const cLonObj = createCoordinates({ lat: 12.9716, lon: 77.5946 });
    assert.equal(cLonObj.lat, 12.9716);
    assert.equal(cLonObj.lng, 77.5946);
  });

  test('createCoordinates rejects out-of-bounds or non-finite inputs', () => {
    assert.throws(() => createCoordinates(90.1, 0), InvalidCoordinatesError);
    assert.throws(() => createCoordinates(-90.1, 0), InvalidCoordinatesError);
    assert.throws(() => createCoordinates(0, 180.1), InvalidCoordinatesError);
    assert.throws(() => createCoordinates(0, -180.1), InvalidCoordinatesError);
    assert.throws(() => createCoordinates(NaN, 0), InvalidCoordinatesError);
    assert.throws(() => createCoordinates(0, Infinity), InvalidCoordinatesError);
    assert.throws(() => createCoordinates('45', '90'), InvalidCoordinatesError);
    assert.throws(() => createCoordinates(null, undefined), InvalidCoordinatesError);
  });

  test('createGeoPolygon enforces at least 3 vertices and validates them', () => {
    const validTriangle = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 5 },
    ];
    const poly = createGeoPolygon(validTriangle);
    assert.equal(poly.vertices.length, 3);
    assert.ok(Object.isFrozen(poly));
    assert.ok(Object.isFrozen(poly.vertices));

    // Rejects non-array or fewer than 3 vertices
    assert.throws(() => createGeoPolygon(null), PolygonClosureError);
    assert.throws(() => createGeoPolygon([]), PolygonClosureError);
    assert.throws(() => createGeoPolygon([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]), PolygonClosureError);

    // Rejects invalid coordinate entries
    assert.throws(() => createGeoPolygon([
      { lat: 0, lng: 0 },
      { lat: 100, lng: 0 }, // Out of bounds
      { lat: 5, lng: 5 },
    ]), PolygonClosureError);
  });

  test('createPresencePing validates device metadata, coordinates, and accuracy', () => {
    const validPing = createPresencePing({
      deviceId: 'phone-xyz-001',
      lat: 37.7749,
      lng: -122.4194,
      accuracyMeters: 4.5,
      timestampMs: 1730000000000,
    });

    assert.equal(validPing.deviceId, 'phone-xyz-001');
    assert.equal(validPing.lat, 37.7749);
    assert.equal(validPing.lng, -122.4194);
    assert.equal(validPing.accuracyMeters, 4.5);
    assert.equal(validPing.timestampMs, 1730000000000);
    assert.ok(Object.isFrozen(validPing));

    // Rejects missing or invalid deviceId
    assert.throws(() => createPresencePing({
      deviceId: '',
      lat: 0,
      lng: 0,
      accuracyMeters: 5,
    }), TypeError);

    assert.throws(() => createPresencePing({
      deviceId: 12345,
      lat: 0,
      lng: 0,
      accuracyMeters: 5,
    }), TypeError);

    // Rejects negative accuracy
    assert.throws(() => createPresencePing({
      deviceId: 'dev-1',
      lat: 0,
      lng: 0,
      accuracyMeters: -1,
    }), TypeError);

    // Rejects invalid coordinates
    assert.throws(() => createPresencePing({
      deviceId: 'dev-1',
      lat: 95,
      lng: 0,
      accuracyMeters: 5,
    }), InvalidCoordinatesError);

    // Rejects non-positive or invalid timestampMs
    assert.throws(() => createPresencePing({
      deviceId: 'dev-1',
      lat: 0,
      lng: 0,
      accuracyMeters: 5,
      timestampMs: -100,
    }), TypeError);

    assert.throws(() => createPresencePing({
      deviceId: 'dev-1',
      lat: 0,
      lng: 0,
      accuracyMeters: 5,
      timestampMs: 0,
    }), TypeError);

    // Accepts accuracyMeters: 0 (sub-meter accuracy)
    const exactPing = createPresencePing({
      deviceId: 'exact-dev',
      lat: 10,
      lng: 20,
      accuracyMeters: 0,
    });
    assert.equal(exactPing.accuracyMeters, 0);
  });
});

// ============================================================================
// 2. Geospatial Ray-Casting & Bounding Box Pruning
// ============================================================================

describe('Geospatial Engine: SpatialRayCaster & Jordan Curve Math', () => {
  // Unit Square: [0, 0] to [10, 10] in (lng, lat) space
  const squarePolygon = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  test('computeBoundingBox computes exact axis-aligned bounds', () => {
    const box = computeBoundingBox(squarePolygon);
    assert.equal(box.minX, 0);
    assert.equal(box.maxX, 10);
    assert.equal(box.minY, 0);
    assert.equal(box.maxY, 10);
    assert.equal(box.minLng, 0);
    assert.equal(box.maxLng, 10);
    assert.equal(box.minLat, 0);
    assert.equal(box.maxLat, 10);
    assert.ok(Object.isFrozen(box));

    // Invalid inputs return null
    assert.equal(computeBoundingBox(null), null);
    assert.equal(computeBoundingBox([]), null);
  });

  test('isInBoundingBox accurately rejects points outside in O(1)', () => {
    const box = computeBoundingBox(squarePolygon);

    assert.equal(isInBoundingBox([5, 5], box), true);
    assert.equal(isInBoundingBox([0, 0], box), true);
    assert.equal(isInBoundingBox([10, 10], box), true);

    // Outside bounds
    assert.equal(isInBoundingBox([15, 5], box), false);
    assert.equal(isInBoundingBox([-1, 5], box), false);
    assert.equal(isInBoundingBox([5, 12], box), false);
    assert.equal(isInBoundingBox([5, -0.5], box), false);

    // Degenerate inputs safely return false
    assert.equal(isInBoundingBox(null, box), false);
    assert.equal(isInBoundingBox([5, 5], null), false);
  });

  test('Convex polygon raycasting detects interior, exterior, edge, and vertex points', () => {
    // Strictly inside
    assert.equal(containsPoint([5, 5], squarePolygon), true);
    assert.equal(containsPoint({ lat: 5, lng: 5 }, squarePolygon), true);
    assert.equal(containsPoint([1, 1], squarePolygon), true);
    assert.equal(containsPoint([9, 9], squarePolygon), true);

    // Strictly outside
    assert.equal(containsPoint([15, 5], squarePolygon), false);
    assert.equal(containsPoint([-2, 5], squarePolygon), false);
    assert.equal(containsPoint([5, 12], squarePolygon), false);
    assert.equal(containsPoint([5, -2], squarePolygon), false);
    assert.equal(containsPoint([-1, -1], squarePolygon), false);
    assert.equal(containsPoint([11, 11], squarePolygon), false);

    // Boundary edges
    assert.equal(containsPoint([0, 5], squarePolygon), true);  // West edge
    assert.equal(containsPoint([10, 5], squarePolygon), true); // East edge
    assert.equal(containsPoint([5, 0], squarePolygon), true);  // South edge
    assert.equal(containsPoint([5, 10], squarePolygon), true); // North edge

    // Corner vertices
    assert.equal(containsPoint([0, 0], squarePolygon), true);
    assert.equal(containsPoint([10, 0], squarePolygon), true);
    assert.equal(containsPoint([10, 10], squarePolygon), true);
    assert.equal(containsPoint([0, 10], squarePolygon), true);
  });

  test('Concave polygon (L-shape) distinguishes interior from cutout void', () => {
    // L-shaped polygon in [0, 6] x [0, 6]
    // (0, 0) -> (6, 0) -> (6, 2) -> (2, 2) -> (2, 6) -> (0, 6)
    const lShapePolygon = [
      [0, 0],
      [6, 0],
      [6, 2],
      [2, 2],
      [2, 6],
      [0, 6],
    ];

    // Inside lower horizontal bar
    assert.equal(containsPoint([1, 1], lShapePolygon), true);
    assert.equal(containsPoint([5, 1], lShapePolygon), true);

    // Inside vertical left bar
    assert.equal(containsPoint([1, 4], lShapePolygon), true);
    assert.equal(containsPoint([1, 5], lShapePolygon), true);

    // Inside reflex corner
    assert.equal(containsPoint([2, 2], lShapePolygon), true);

    // Cutout void: Inside bounding box [0, 6] x [0, 6], but outside polygon!
    assert.equal(containsPoint([4, 4], lShapePolygon), false);
    assert.equal(containsPoint([5, 5], lShapePolygon), false);
    assert.equal(containsPoint([3, 3], lShapePolygon), false);

    // Far exterior
    assert.equal(containsPoint([8, 8], lShapePolygon), false);
    assert.equal(containsPoint([-2, 2], lShapePolygon), false);
  });

  test('Handles horizontal ray alignment collinear with vertices cleanly', () => {
    // Triangle with a sharp apex
    const triangle = [
      [0, 0],
      [10, 0],
      [5, 5],
    ];

    // Point to the left of the apex at exact apex altitude y = 5
    // Ray cast eastward will strike apex (5, 5)
    assert.equal(containsPoint([2, 5], triangle), false);

    // Point to the right of apex at y = 5
    assert.equal(containsPoint([8, 5], triangle), false);

    // Apex itself
    assert.equal(containsPoint([5, 5], triangle), true);

    // Interior below apex
    assert.equal(containsPoint([5, 2], triangle), true);
  });

  test('Handles closed GeoJSON rings where last vertex equals first vertex', () => {
    const closedRing = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0], // Duplicate closing vertex
    ];

    assert.equal(containsPoint([5, 5], closedRing), true);
    assert.equal(containsPoint([15, 5], closedRing), false);
    assert.equal(containsPoint([0, 0], closedRing), true);
  });

  test('Polygon winding invariance: operates identically for clockwise and counter-clockwise vertices', () => {
    // Clockwise square
    const cwSquare = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ];

    // Counter-clockwise square
    const ccwSquare = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];

    // Inside
    assert.equal(containsPoint([5, 5], cwSquare), true);
    assert.equal(containsPoint([5, 5], ccwSquare), true);

    // Outside
    assert.equal(containsPoint([15, 5], cwSquare), false);
    assert.equal(containsPoint([15, 5], ccwSquare), false);

    // Boundary edge
    assert.equal(containsPoint([0, 5], cwSquare), true);
    assert.equal(containsPoint([0, 5], ccwSquare), true);
  });

  test('Supports GeoJSON Polygon structure with nested linear ring coordinates', () => {
    const geoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-122.4018, 37.7842],
          [-122.4018, 37.7848],
          [-122.4010, 37.7848],
          [-122.4010, 37.7842],
          [-122.4018, 37.7842],
        ],
      ],
    };

    // Point inside Main Auditorium
    assert.equal(containsPoint([-122.4014, 37.7845], geoJsonPolygon), true);
    assert.equal(containsPoint({ lat: 37.7845, lng: -122.4014 }, geoJsonPolygon), true);
    assert.equal(containsPoint({ latitude: 37.7845, longitude: -122.4014 }, geoJsonPolygon), true);
    assert.equal(containsPoint({ lat: 37.7845, lon: -122.4014 }, geoJsonPolygon), true);

    // Point outside Main Auditorium
    assert.equal(containsPoint([-122.4030, 37.7845], geoJsonPolygon), false);
  });

  test('Real-world venue coordinate calculations with micro-degree precision', () => {
    // Exact polygon from data/db.json: Main Auditorium
    const mainAuditorium = {
      id: 'zone-main-auditorium',
      boundary: {
        vertices: [
          { lat: 37.7842, lng: -122.4018 },
          { lat: 37.7848, lng: -122.4018 },
          { lat: 37.7848, lng: -122.4010 },
          { lat: 37.7842, lng: -122.4010 },
        ],
      },
    };

    // Centroid: (-122.4014, 37.7845)
    assert.equal(containsPoint({ lat: 37.7845, lng: -122.4014 }, mainAuditorium.boundary.vertices), true);

    // Exact corner vertex
    assert.equal(containsPoint({ lat: 37.7842, lng: -122.4018 }, mainAuditorium.boundary.vertices), true);

    // Point along edge
    assert.equal(containsPoint({ lat: 37.7845, lng: -122.4018 }, mainAuditorium.boundary.vertices), true);

    // Point 10 meters east of zone
    assert.equal(containsPoint({ lat: 37.7845, lng: -122.4005 }, mainAuditorium.boundary.vertices), false);
  });

  test('Handles degenerate geometries and invalid vertices defensively', () => {
    // 2-point line segment disguised with duplicate closing vertex [A, B, A]
    const degenerateLine = [
      [0, 0],
      [10, 10],
      [0, 0],
    ];
    assert.equal(containsPoint([5, 5], degenerateLine), false);

    // Polygon containing corrupt vertex
    const corruptVertices = [
      [0, 0],
      [null, 'invalid'],
      [10, 10],
      [0, 10],
    ];
    assert.equal(containsPoint([5, 5], corruptVertices), false);

    // isInBoundingBox with corrupted box dimensions
    assert.equal(isInBoundingBox([5, 5], { minX: NaN, maxX: 10, minY: 0, maxY: 10 }), false);
    assert.equal(isInBoundingBox([5, 5], { minX: 0, maxX: Infinity, minY: 0, maxY: 10 }), false);
  });

  test('Defensively returns false for null, undefined, or corrupt inputs without throwing', () => {
    assert.equal(containsPoint(null, squarePolygon), false);
    assert.equal(containsPoint(undefined, squarePolygon), false);
    assert.equal(containsPoint([NaN, 5], squarePolygon), false);
    assert.equal(containsPoint([5, Infinity], squarePolygon), false);
    assert.equal(containsPoint([5, 5], null), false);
    assert.equal(containsPoint([5, 5], []), false);
    assert.equal(containsPoint([5, 5], 'not-a-polygon'), false);
  });
});

// ============================================================================
// 3. Occupancy Engine & Density Classification
// ============================================================================

describe('Occupancy Engine: Density Tier Calculation & Zone Aggregation', () => {
  test('calculateDensityTier enforces exact threshold boundaries', () => {
    // < 40% -> LOW
    assert.equal(calculateDensityTier(0), DensityTier.LOW);
    assert.equal(calculateDensityTier(25), DensityTier.LOW);
    assert.equal(calculateDensityTier(39), DensityTier.LOW);
    assert.equal(calculateDensityTier(39.9), DensityTier.LOW);

    // 40%..69% -> MODERATE
    assert.equal(calculateDensityTier(40), DensityTier.MODERATE);
    assert.equal(calculateDensityTier(50), DensityTier.MODERATE);
    assert.equal(calculateDensityTier(69), DensityTier.MODERATE);
    assert.equal(calculateDensityTier(69.9), DensityTier.MODERATE);

    // 70%..89% -> HIGH
    assert.equal(calculateDensityTier(70), DensityTier.HIGH);
    assert.equal(calculateDensityTier(80), DensityTier.HIGH);
    assert.equal(calculateDensityTier(89), DensityTier.HIGH);
    assert.equal(calculateDensityTier(89.9), DensityTier.HIGH);

    // >= 90% -> CRITICAL
    assert.equal(calculateDensityTier(90), DensityTier.CRITICAL);
    assert.equal(calculateDensityTier(95), DensityTier.CRITICAL);
    assert.equal(calculateDensityTier(100), DensityTier.CRITICAL);
    assert.equal(calculateDensityTier(150), DensityTier.CRITICAL);

    // Degenerate inputs safely resolve to LOW
    assert.equal(calculateDensityTier(NaN), DensityTier.LOW);
    assert.equal(calculateDensityTier(null), DensityTier.LOW);
  });

  test('computeZoneOccupancy counts pings inside boundary and binds density percent [0, 100]', () => {
    const mainHallZone = {
      id: 'zone-main-hall',
      name: 'Main Stage Hall',
      capacity: 10,
      coords: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    };

    // 3 pings inside, 2 pings outside
    const activePings = [
      createPresencePing({ deviceId: 'dev-1', lat: 2, lng: 2, accuracyMeters: 5 }),
      createPresencePing({ deviceId: 'dev-2', lat: 5, lng: 5, accuracyMeters: 5 }),
      createPresencePing({ deviceId: 'dev-3', lat: 8, lng: 8, accuracyMeters: 5 }),
      createPresencePing({ deviceId: 'dev-4', lat: 15, lng: 5, accuracyMeters: 5 }), // Outside
      createPresencePing({ deviceId: 'dev-5', lat: 5, lng: -5, accuracyMeters: 5 }), // Outside
    ];

    const result = computeZoneOccupancy(mainHallZone, activePings);

    assert.equal(result.zoneId, 'zone-main-hall');
    assert.equal(result.currentCount, 3);
    assert.equal(result.capacity, 10);
    assert.equal(result.densityPercent, 30);
    assert.equal(result.densityTier, DensityTier.LOW);
    assert.ok(Object.isFrozen(result));
  });

  test('computeZoneOccupancy bounds density at 100% when capacity is exceeded', () => {
    const compactZone = {
      zoneId: 'vip-lounge',
      capacity: 4,
      coords: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    };

    // 6 pings inside a zone with capacity 4 (150% raw density)
    const activePings = [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
      { lat: 4, lng: 4 },
      { lat: 5, lng: 5 },
      { lat: 6, lng: 6 },
    ];

    const result = computeZoneOccupancy(compactZone, activePings);

    assert.equal(result.zoneId, 'vip-lounge');
    assert.equal(result.currentCount, 6);
    assert.equal(result.capacity, 4);
    assert.equal(result.densityPercent, 100); // Bounded at 100
    assert.equal(result.densityTier, DensityTier.CRITICAL);
  });

  test('computeZoneOccupancy handles empty pings and empty capacity safely', () => {
    const emptyZone = {
      id: 'zone-empty',
      capacity: 50,
      coords: [[0, 0], [10, 0], [10, 10], [0, 10]],
    };

    const result = computeZoneOccupancy(emptyZone, []);
    assert.equal(result.currentCount, 0);
    assert.equal(result.densityPercent, 0);
    assert.equal(result.densityTier, DensityTier.LOW);

    // Zone with 0 capacity
    const zeroCapZone = {
      id: 'zero-cap',
      capacity: 0,
      coords: [[0, 0], [10, 0], [10, 10], [0, 10]],
    };
    const zeroResult = computeZoneOccupancy(zeroCapZone, [{ lat: 5, lng: 5 }]);
    assert.equal(zeroResult.currentCount, 1);
    assert.equal(zeroResult.densityPercent, 100);
    assert.equal(zeroResult.densityTier, DensityTier.CRITICAL);

    // Zone without polygon
    const noPolyZone = {
      id: 'no-poly',
      capacity: 50,
    };
    const noPolyResult = computeZoneOccupancy(noPolyZone, [{ lat: 5, lng: 5 }]);
    assert.equal(noPolyResult.currentCount, 0);
    assert.equal(noPolyResult.densityPercent, 0);
    assert.equal(noPolyResult.densityTier, DensityTier.LOW);

    // Rejects non-object zone input
    assert.throws(() => computeZoneOccupancy(null, []), TypeError);
    assert.throws(() => computeZoneOccupancy('invalid', []), TypeError);
  });
});

// ============================================================================
// 4. Session Lifecycle State Machine
// ============================================================================

describe('Session Lifecycle: SessionStateMachine Transitions', () => {
  const initialSession = Object.freeze({
    id: 'sess-001',
    title: 'Future of Spatial Web',
    status: SessionStatus.UPCOMING,
    scheduledStartTimeMs: 1730000000000,
  });

  test('Applies valid transition: UPCOMING -> LIVE', () => {
    const now = 1730000010000;
    const res = SessionStateMachine.transition(initialSession, SessionStatus.LIVE, now);

    assert.equal(res.ok, true);
    assert.equal(res.value.status, SessionStatus.LIVE);
    assert.equal(res.value.actualStartTimeMs, now);
    assert.equal(res.value.updatedAtMs, now);
    assert.ok(Object.isFrozen(res.value));
  });

  test('Applies valid transition: LIVE -> ENDED', () => {
    const liveSession = Object.freeze({
      ...initialSession,
      status: SessionStatus.LIVE,
      actualStartTimeMs: 1730000010000,
    });

    const now = 1730003600000;
    const res = SessionStateMachine.transition(liveSession, SessionStatus.ENDED, now);

    assert.equal(res.ok, true);
    assert.equal(res.value.status, SessionStatus.ENDED);
    assert.equal(res.value.actualEndTimeMs, now);
    assert.equal(res.value.updatedAtMs, now);
  });

  test('Rejects invalid transitions and returns typed InvalidStateTransitionError', () => {
    // UPCOMING -> ENDED (Skipping LIVE)
    const errSkip = SessionStateMachine.transition(initialSession, SessionStatus.ENDED);
    assert.equal(errSkip.ok, false);
    assert.ok(errSkip.error instanceof InvalidStateTransitionError);
    assert.equal(errSkip.error.fromStatus, SessionStatus.UPCOMING);
    assert.equal(errSkip.error.toStatus, SessionStatus.ENDED);

    // LIVE -> UPCOMING (Backward transition)
    const liveSession = { ...initialSession, status: SessionStatus.LIVE };
    const errBackward = SessionStateMachine.transition(liveSession, SessionStatus.UPCOMING);
    assert.equal(errBackward.ok, false);
    assert.ok(errBackward.error instanceof InvalidStateTransitionError);

    // ENDED -> LIVE (Reviving ended session)
    const endedSession = { ...initialSession, status: SessionStatus.ENDED };
    const errRevive = SessionStateMachine.transition(endedSession, SessionStatus.LIVE);
    assert.equal(errRevive.ok, false);
    assert.ok(errRevive.error instanceof InvalidStateTransitionError);

    // Same state transition (UPCOMING -> UPCOMING)
    const errSame = SessionStateMachine.transition(initialSession, SessionStatus.UPCOMING);
    assert.equal(errSame.ok, false);
    assert.ok(errSame.error instanceof InvalidStateTransitionError);

    // Arbitrary target status
    const errBogus = SessionStateMachine.transition(initialSession, 'UNKNOWN_STATUS');
    assert.equal(errBogus.ok, false);
    assert.ok(errBogus.error instanceof InvalidStateTransitionError);

    // Invalid session object
    const errNull = SessionStateMachine.transition(null, SessionStatus.LIVE);
    assert.equal(errNull.ok, false);
    assert.ok(errNull.error instanceof InvalidStateTransitionError);
  });
});

// ============================================================================
// 5. Rating Calculator & Review Aggregation
// ============================================================================

describe('Rating System: RatingCalculator & Rolling Averages', () => {
  const baseSession = Object.freeze({
    id: 'sess-ai-keynote',
    title: 'Autonomous Multi-Agent Architectures',
    status: SessionStatus.LIVE,
    ratings: [],
  });

  test('Appends valid ratings and updates averageRating dynamically', () => {
    // First rating: 5 stars
    const res1 = RatingCalculator.addRating(baseSession, {
      deviceId: 'user-phone-1',
      stars: 5,
      comment: 'Incredible demo!',
      createdAtMs: 1730001000000,
    });

    assert.equal(res1.ok, true);
    assert.equal(res1.value.ratings.length, 1);
    assert.equal(res1.value.ratings[0].stars, 5);
    assert.equal(res1.value.ratings[0].comment, 'Incredible demo!');
    assert.equal(res1.value.averageRating, 5);
    assert.ok(Object.isFrozen(res1.value));

    // Second rating: 4 stars -> avg = 4.5
    const res2 = RatingCalculator.addRating(res1.value, {
      deviceId: 'user-phone-2',
      stars: 4,
      comment: 'Very solid depth',
    });

    assert.equal(res2.ok, true);
    assert.equal(res2.value.ratings.length, 2);
    assert.equal(res2.value.averageRating, 4.5);

    // Third rating: 2 stars -> (5 + 4 + 2) / 3 = 11 / 3 = 3.67
    const res3 = RatingCalculator.addRating(res2.value, {
      deviceId: 'user-phone-3',
      stars: 2,
      comment: 'Room was crowded',
    });

    assert.equal(res3.ok, true);
    assert.equal(res3.value.ratings.length, 3);
    assert.equal(res3.value.averageRating, 3.67);
  });

  test('Validates rating stars integer boundary [1, 5] and rejects illegal values', () => {
    // 0 stars
    const err0 = RatingCalculator.addRating(baseSession, { deviceId: 'dev-1', stars: 0 });
    assert.equal(err0.ok, false);
    assert.ok(err0.error instanceof InvalidRatingError);

    // 6 stars
    const err6 = RatingCalculator.addRating(baseSession, { deviceId: 'dev-1', stars: 6 });
    assert.equal(err6.ok, false);
    assert.ok(err6.error instanceof InvalidRatingError);

    // Float stars (4.5)
    const errFloat = RatingCalculator.addRating(baseSession, { deviceId: 'dev-1', stars: 4.5 });
    assert.equal(errFloat.ok, false);
    assert.ok(errFloat.error instanceof InvalidRatingError);

    // String stars ('5')
    const errStr = RatingCalculator.addRating(baseSession, { deviceId: 'dev-1', stars: '5' });
    assert.equal(errStr.ok, false);
    assert.ok(errStr.error instanceof InvalidRatingError);

    // Missing deviceId
    const errNoDev = RatingCalculator.addRating(baseSession, { deviceId: '', stars: 5 });
    assert.equal(errNoDev.ok, false);
    assert.ok(errNoDev.error instanceof InvalidRatingError);

    // Null session
    const errNullSess = RatingCalculator.addRating(null, { deviceId: 'dev-1', stars: 5 });
    assert.equal(errNullSess.ok, false);
    assert.ok(errNullSess.error instanceof InvalidRatingError);
  });

  test('Updates existing rating idempotently when same deviceId submits again', () => {
    // Initial rating: 3 stars
    const res1 = RatingCalculator.addRating(baseSession, {
      deviceId: 'user-unique-device',
      stars: 3,
      comment: 'Average talk',
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.value.ratings.length, 1);
    assert.equal(res1.value.averageRating, 3.0);

    // Same device submits an updated rating: 5 stars
    const res2 = RatingCalculator.addRating(res1.value, {
      deviceId: 'user-unique-device',
      stars: 5,
      comment: 'Updated: Q&A was spectacular!',
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.value.ratings.length, 1, 'Ratings array must not grow when same device rates again');
    assert.equal(res2.value.ratings[0].stars, 5);
    assert.equal(res2.value.ratings[0].comment, 'Updated: Q&A was spectacular!');
    assert.equal(res2.value.averageRating, 5.0);
  });
});

// ============================================================================
// 7. Campus Wayfinding & Turn-by-Turn Navigation Engine
// ============================================================================

describe('Campus Navigation: CampusRoutingEngine & Wayfinding Math', () => {
  const engine = new CampusRoutingEngine();

  test('calculateDistanceMeters computes accurate ground distance between geodetic coordinates', () => {
    const p1 = { lat: 12.663127, lng: 77.451032 };
    const p2 = { lat: 12.662700, lng: 77.451032 };
    const dist = calculateDistanceMeters(p1, p2);
    // ~47 meters
    assert.ok(dist >= 45 && dist <= 50, `Distance should be ~47m, got ${dist}`);
  });

  test('getTurnType classifies bearing deltas into LEFT, RIGHT, STRAIGHT, and UTURN', () => {
    // Going North (0 deg) -> Turning East (90 deg) is RIGHT
    assert.equal(getTurnType(0, 90), 'RIGHT');
    // Going North (0 deg) -> Turning West (270 deg) is LEFT
    assert.equal(getTurnType(0, 270), 'LEFT');
    // Slight deviation (<30 deg) is STRAIGHT
    assert.equal(getTurnType(0, 15), 'STRAIGHT');
    assert.equal(getTurnType(0, 350), 'STRAIGHT');
    // Reverse direction is UTURN
    assert.equal(getTurnType(0, 180), 'UTURN');
  });

  test('Generates walking directions from Gate 1 to Food Court with explicit LEFT turn', () => {
    const result = engine.generateDirections('gate1', 'foodcourt');
    assert.equal(result.success, true);
    assert.equal(result.origin.id, 'gate1');
    assert.equal(result.destination.id, 'foodcourt');
    assert.ok(result.totalDistanceMeters > 100);
    assert.ok(result.estimatedWalkingMinutes >= 1);

    // Verify turn steps
    const leftTurnStep = result.steps.find((s) => s.turnType === 'LEFT');
    assert.ok(leftTurnStep, 'Must include a turn step with turnType LEFT');
    assert.ok(leftTurnStep.instruction.includes('Turn Left'));
    assert.equal(leftTurnStep.icon, 'turn_left');
    assert.ok(leftTurnStep.distanceMeters > 0);

    const arriveStep = result.steps[result.steps.length - 1];
    assert.equal(arriveStep.turnType, 'ARRIVE');
    assert.equal(arriveStep.icon, 'flag');
  });

  test('Generates walking directions from Gate 1 to School of Engineering with explicit RIGHT turn', () => {
    const result = engine.generateDirections('gate1', 'soe');
    assert.equal(result.success, true);
    assert.equal(result.destination.id, 'soe');

    const rightTurnStep = result.steps.find((s) => s.turnType === 'RIGHT');
    assert.ok(rightTurnStep, 'Must include a turn step with turnType RIGHT');
    assert.ok(rightTurnStep.instruction.includes('Turn Right'));
    assert.equal(rightTurnStep.icon, 'turn_right');
  });

  test('Resolves node by zone ID, partial name, and closest coordinates', () => {
    assert.equal(engine.resolveNode('zone-dsu-foodcourt'), 'foodcourt');
    assert.equal(engine.resolveNode('food'), 'foodcourt');
    assert.equal(engine.resolveNode('quantum'), 'quantum');
    assert.equal(engine.resolveNode({ lat: 12.66312, lng: 77.45103 }), 'gate1');
  });

  test('Returns safe fallback when origin and destination are the same node', () => {
    const result = engine.generateDirections('foodcourt', 'foodcourt');
    assert.equal(result.success, true);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].turnType, 'ARRIVE');
  });
});
