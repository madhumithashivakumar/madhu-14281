/**
 * @file presence-store.js
 * @description In-memory presence tracking with bounded sliding-window TTL eviction.
 * Strictly adheres to S-Tier Engineering: Zero external dependencies, pure ESM, bounded memory.
 */

/**
 * @typedef {Object} PresencePing
 * @property {string} deviceId
 * @property {number} lat
 * @property {number} lng
 * @property {number} accuracyMeters
 * @property {number} timestampMs
 */

export class SlidingWindowPresenceStore {
  /**
   * @param {number} [windowSec=60] Time-to-live window in seconds for presence pings
   * @param {number} [maxCapacity=50000] Maximum active pings stored in memory to bound footprint
   */
  constructor(windowSec = 60, maxCapacity = 50000) {
    if (typeof windowSec !== 'number' || !Number.isFinite(windowSec) || windowSec <= 0) {
      throw new TypeError(`windowSec must be a positive finite number, received: ${windowSec}`);
    }
    if (typeof maxCapacity !== 'number' || !Number.isFinite(maxCapacity) || maxCapacity <= 0) {
      throw new TypeError(`maxCapacity must be a positive finite number, received: ${maxCapacity}`);
    }
    this.windowSec = windowSec;
    this.windowMs = windowSec * 1000;
    this.maxCapacity = Math.floor(maxCapacity);
    /** @type {Map<string, PresencePing>} */
    this.pings = new Map();
  }

  /**
   * Validates and records an incoming device presence ping.
   * Updates existing device entry and automatically prunes stale pings.
   *
   * @param {Object} ping
   * @param {string} [ping.deviceId]
   * @param {string} [ping.uid]
   * @param {number} ping.lat
   * @param {number} ping.lng
   * @param {number} [ping.accuracyMeters]
   * @param {number} [ping.acc]
   * @param {number} [ping.timestampMs]
   * @param {number} [ping.timestamp]
   * @returns {PresencePing} The normalized and recorded ping
   */
  recordPing(ping) {
    if (!ping || typeof ping !== 'object') {
      throw new TypeError('Presence ping must be a non-null object');
    }

    const deviceIdRaw = ping.deviceId ?? ping.uid;
    if (typeof deviceIdRaw !== 'string' || deviceIdRaw.trim().length === 0) {
      throw new TypeError('Presence ping requires a non-empty string deviceId / uid');
    }
    const deviceId = deviceIdRaw.trim();

    const lat = ping.lat ?? ping.latitude;
    const lng = ping.lng ?? ping.longitude;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new TypeError(`Presence ping requires a valid latitude [-90, 90], received: ${lat}`);
    }
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new TypeError(`Presence ping requires a valid longitude [-180, 180], received: ${lng}`);
    }

    const accuracyRaw = ping.accuracyMeters ?? ping.acc ?? 0;
    if (typeof accuracyRaw !== 'number' || !Number.isFinite(accuracyRaw) || accuracyRaw < 0) {
      throw new TypeError(`accuracyMeters / acc must be a non-negative finite number, received: ${accuracyRaw}`);
    }

    const now = Date.now();
    const timestampRaw = ping.timestampMs ?? ping.timestamp ?? now;
    if (typeof timestampRaw !== 'number' || !Number.isFinite(timestampRaw) || timestampRaw <= 0) {
      throw new TypeError(`timestampMs must be a positive finite number, received: ${timestampRaw}`);
    }

    const normalizedPing = Object.freeze({
      deviceId,
      lat,
      lng,
      accuracyMeters: accuracyRaw,
      timestampMs: timestampRaw,
    });

    // Delete first so re-insertion places it at the end (MRU order)
    this.pings.delete(deviceId);
    this.pings.set(deviceId, normalizedPing);

    // Bound memory footprint under high throughput: evict oldest entry if exceeding maxCapacity
    while (this.pings.size > this.maxCapacity) {
      const oldestKey = this.pings.keys().next().value;
      if (oldestKey !== undefined) {
        this.pings.delete(oldestKey);
      } else {
        break;
      }
    }

    // Prune stale pings on write to bound memory
    this.prune(now);

    return normalizedPing;
  }

  /**
   * Prunes pings older than (nowMs - windowMs) and returns all active pings.
   *
   * @param {number} [nowMs=Date.now()]
   * @returns {Array<PresencePing>}
   */
  getActivePings(nowMs = Date.now()) {
    const referenceTime = typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs > 0
      ? nowMs
      : Date.now();

    this.prune(referenceTime);

    return Array.from(this.pings.values());
  }

  /**
   * Internal eviction helper removing pings outside the sliding window.
   *
   * @param {number} referenceTime
   * @private
   */
  prune(referenceTime) {
    const cutoff = referenceTime - this.windowMs;
    for (const [id, ping] of this.pings.entries()) {
      if (ping.timestampMs < cutoff) {
        this.pings.delete(id);
      }
    }
  }

  /**
   * Resets and empties all recorded pings.
   */
  clear() {
    this.pings.clear();
  }

  /**
   * Returns count of currently stored pings.
   * @returns {number}
   */
  get size() {
    return this.pings.size;
  }
}
