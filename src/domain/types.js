/**
 * @file types.js
 * @description Core Domain Types, Enums, Typed Errors, Result Type, and Immutable Value Factories.
 * Strictly adheres to S-Tier Engineering: Zero external dependencies, pure ESM, defensive validation.
 */

/**
 * AccessTier defines permission boundaries for venue zones.
 * @readonly
 * @enum {string}
 */
export const AccessTier = Object.freeze({
  PUBLIC: 'PUBLIC',
  VIP: 'VIP',
  RESTRICTED: 'RESTRICTED',
});

/**
 * SessionStatus models the strict unidirectional lifecycle of an event session.
 * UPCOMING -> LIVE -> ENDED
 * @readonly
 * @enum {string}
 */
export const SessionStatus = Object.freeze({
  UPCOMING: 'UPCOMING',
  LIVE: 'LIVE',
  ENDED: 'ENDED',
});

/**
 * DensityTier represents crowd density classification for venue zones.
 * @readonly
 * @enum {string}
 */
export const DensityTier = Object.freeze({
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

// ============================================================================
// Domain Errors
// ============================================================================

/**
 * Base domain error class with proper prototype chaining and stack preservation.
 */
export class DomainError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown or returned when geospatial coordinates fail range or numerical checks.
 */
export class InvalidCoordinatesError extends DomainError {
  /**
   * @param {number} lat
   * @param {number} lng
   * @param {string} [reason='Coordinates out of allowable range']
   */
  constructor(lat, lng, reason = 'Coordinates out of allowable range') {
    super(`Invalid coordinates [lat: ${lat}, lng: ${lng}]: ${reason}`);
    this.lat = lat;
    this.lng = lng;
    this.reason = reason;
  }
}

/**
 * Thrown or returned when polygon vertices do not form a valid closed planar ring.
 */
export class PolygonClosureError extends DomainError {
  /**
   * @param {string} [reason='Polygon must contain at least 3 vertices to form a closed planar boundary']
   */
  constructor(reason = 'Polygon must contain at least 3 vertices to form a closed planar boundary') {
    super(`Polygon validation error: ${reason}`);
    this.reason = reason;
  }
}

/**
 * Thrown or returned when an illegal session state transition is attempted.
 */
export class InvalidStateTransitionError extends DomainError {
  /**
   * @param {string} fromStatus
   * @param {string} toStatus
   * @param {string} [reason]
   */
  constructor(fromStatus, toStatus, reason) {
    const detail = reason || `Illegal transition from ${fromStatus} to ${toStatus}`;
    super(`Invalid state transition [${fromStatus} -> ${toStatus}]: ${detail}`);
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.reason = detail;
  }
}

/**
 * Thrown or returned when a rating value violates business boundaries.
 */
export class InvalidRatingError extends DomainError {
  /**
   * @param {*} stars
   * @param {string} [reason='Rating stars must be an integer between 1 and 5']
   */
  constructor(stars, reason = 'Rating stars must be an integer between 1 and 5') {
    super(`Invalid rating [${stars}]: ${reason}`);
    this.stars = stars;
    this.reason = reason;
  }
}

// ============================================================================
// Result Type Utility (Railway-Oriented Programming)
// ============================================================================

/**
 * Constructs a successful Result.
 * @template T
 * @param {T} value
 * @returns {{ ok: true, value: T, error: null }}
 */
export function ok(value) {
  return Object.freeze({
    ok: true,
    value,
    error: null,
  });
}

/**
 * Constructs a failed Result.
 * @template E
 * @param {E} error
 * @returns {{ ok: false, value: null, error: E }}
 */
export function err(error) {
  return Object.freeze({
    ok: false,
    value: null,
    error,
  });
}

/**
 * Type guard for successful Result.
 * @param {*} result
 * @returns {boolean}
 */
export function isOk(result) {
  return Boolean(result && typeof result === 'object' && result.ok === true);
}

/**
 * Type guard for failure Result.
 * @param {*} result
 * @returns {boolean}
 */
export function isErr(result) {
  return Boolean(result && typeof result === 'object' && result.ok === false);
}

// ============================================================================
// Immutable Value Factories & Defensive Validators
// ============================================================================

/**
 * Validates and creates an immutable coordinate pair.
 * Latitude must be in [-90, 90], Longitude in [-180, 180].
 * Supports both createCoordinates(lat, lng) and createCoordinates({ lat, lng }).
 *
 * @param {number|{lat?: number, latitude?: number, lng?: number, longitude?: number}} latOrObj
 * @param {number} [optionalLng]
 * @returns {Readonly<{ lat: number, lng: number }>}
 * @throws {InvalidCoordinatesError}
 */
export function createCoordinates(latOrObj, optionalLng) {
  let lat;
  let lng;

  if (typeof latOrObj === 'object' && latOrObj !== null) {
    if (Array.isArray(latOrObj)) {
      // GeoJSON standard format: [longitude, latitude]
      lng = latOrObj[0];
      lat = latOrObj[1];
    } else {
      lat = latOrObj.lat ?? latOrObj.latitude;
      lng = latOrObj.lng ?? latOrObj.longitude ?? latOrObj.lon;
    }
  } else {
    lat = latOrObj;
    lng = optionalLng;
  }

  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    throw new InvalidCoordinatesError(lat, lng, 'Latitude must be a finite number');
  }

  if (typeof lng !== 'number' || !Number.isFinite(lng)) {
    throw new InvalidCoordinatesError(lat, lng, 'Longitude must be a finite number');
  }

  if (lat < -90 || lat > 90) {
    throw new InvalidCoordinatesError(lat, lng, 'Latitude must be within [-90, 90] degrees');
  }

  if (lng < -180 || lng > 180) {
    throw new InvalidCoordinatesError(lat, lng, 'Longitude must be within [-180, 180] degrees');
  }

  return Object.freeze({
    lat,
    lng,
  });
}

/**
 * Validates and creates an immutable GeoPolygon value object.
 * Enforces at least 3 valid coordinate vertices.
 *
 * @param {Array<Readonly<{ lat: number, lng: number }> | [number, number] | { lat: number, lng: number }>} rawVertices
 * @returns {Readonly<{ vertices: ReadonlyArray<Readonly<{ lat: number, lng: number }>> }>}
 * @throws {PolygonClosureError}
 */
export function createGeoPolygon(rawVertices) {
  if (!Array.isArray(rawVertices)) {
    throw new PolygonClosureError('Vertices must be provided as an array');
  }

  if (rawVertices.length < 3) {
    throw new PolygonClosureError(
      `Polygon must contain at least 3 vertices (received ${rawVertices.length})`
    );
  }

  const normalized = rawVertices.map((vertex, index) => {
    try {
      return createCoordinates(vertex);
    } catch (error) {
      throw new PolygonClosureError(
        `Vertex at index ${index} is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return Object.freeze({
    vertices: Object.freeze(normalized),
  });
}

/**
 * Validates and creates an immutable PresencePing value object from a mobile device.
 *
 * @param {Object} params
 * @param {string} params.deviceId
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {number} params.accuracyMeters
 * @param {number} [params.timestampMs]
 * @returns {Readonly<{ deviceId: string, lat: number, lng: number, accuracyMeters: number, timestampMs: number }>}
 * @throws {TypeError|InvalidCoordinatesError}
 */
export function createPresencePing({ deviceId, lat, lng, accuracyMeters, timestampMs }) {
  if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    throw new TypeError('deviceId must be a non-empty string');
  }

  const coords = createCoordinates(lat, lng);

  if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    throw new TypeError('accuracyMeters must be a non-negative finite number');
  }

  const resolvedTimestamp = timestampMs ?? Date.now();
  if (typeof resolvedTimestamp !== 'number' || !Number.isFinite(resolvedTimestamp) || resolvedTimestamp <= 0) {
    throw new TypeError('timestampMs must be a positive finite number');
  }

  return Object.freeze({
    deviceId: deviceId.trim(),
    lat: coords.lat,
    lng: coords.lng,
    accuracyMeters,
    timestampMs: resolvedTimestamp,
  });
}
