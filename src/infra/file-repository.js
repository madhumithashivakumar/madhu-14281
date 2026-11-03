/**
 * @file file-repository.js
 * @description Atomic file-backed repository for venue zones and sessions with write mutex serialization.
 * Strictly adheres to S-Tier Engineering: Zero external dependencies, pure ESM, crash-resilient persistence.
 */

import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export class AtomicFileVenueRepository {
  /**
   * @param {string} [filePath='data/db.json'] Path to database JSON file
   */
  constructor(filePath = 'data/db.json') {
    this.filePath = resolve(process.cwd(), filePath);
    /** @type {Promise<any>} Mutex promise chain to serialize concurrent mutations */
    this.mutex = Promise.resolve();
  }

  /**
   * Enqueues an operation onto the mutex chain, guaranteeing strict sequential execution
   * for read-modify-write operations across concurrent asynchronous callers.
   *
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   * @private
   */
  enqueueMutation(operation) {
    const next = this.mutex.then(operation, operation);
    // Ensure mutex chain never stays rejected so future operations always run
    this.mutex = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  /**
   * Default database schema if file does not exist.
   * @returns {{ events: Array<Object>, zones: Array<Object>, sessions: Array<Object>, alerts: Array<Object> }}
   */
  getDefaultData() {
    return {
      events: [],
      zones: [],
      sessions: [],
      alerts: [],
    };
  }

  /**
   * Reads and parses JSON database from disk.
   * If file does not exist, initializes directory and returns default structure.
   *
   * @returns {Promise<{ events: Array<Object>, zones: Array<Object>, sessions: Array<Object>, alerts: Array<Object> }>}
   */
  async readData() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      if (!raw || !raw.trim()) {
        const defaultData = this.getDefaultData();
        await this._writeAtomic(defaultData);
        return defaultData;
      }
      const parsed = JSON.parse(raw);
      return {
        events: Array.isArray(parsed.events) ? parsed.events : [],
        zones: Array.isArray(parsed.zones) ? parsed.zones : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        const defaultData = this.getDefaultData();
        await this._writeAtomic(defaultData);
        return defaultData;
      }
      throw new Error(`Failed to read repository database at ${this.filePath}: ${err.message}`);
    }
  }

  /**
   * Low-level atomic write implementation:
   * Writes payload to a uniquely named temporary file first, then atomically renames to target.
   * Cleans up orphaned temporary file in case of any filesystem write failure.
   *
   * @param {{ zones: Array<Object>, sessions: Array<Object> }} data
   * @returns {Promise<void>}
   * @private
   */
  async _writeAtomic(data) {
    if (!data || typeof data !== 'object') {
      throw new TypeError('Data to persist must be a valid object');
    }

    const payload = JSON.stringify(data, null, 2);
    await mkdir(dirname(this.filePath), { recursive: true });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tmpPath = `${this.filePath}.tmp.${uniqueSuffix}`;

    try {
      await writeFile(tmpPath, payload, 'utf8');
      await rename(tmpPath, this.filePath);
    } catch (err) {
      try {
        await rm(tmpPath, { force: true });
      } catch (cleanupErr) {
        console.warn(`[AtomicFileVenueRepository] Secondary cleanup of ${tmpPath} failed:`, cleanupErr?.message);
      }
      throw err;
    }
  }

  /**
   * Atomically writes data to disk by serializing through the mutation mutex.
   *
   * @param {{ zones: Array<Object>, sessions: Array<Object> }} data
   * @returns {Promise<void>}
   */
  async writeData(data) {
    return this.enqueueMutation(async () => {
      await this._writeAtomic(data);
    });
  }

  /**
   * Fetches all venue zones.
   * @returns {Promise<Array<Object>>}
   */
  async getZones() {
    const data = await this.readData();
    return data.zones;
  }

  /**
   * Fetches a single zone by ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getZone(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return null;
    }
    const zones = await this.getZones();
    return zones.find((z) => z.id === id.trim()) || null;
  }

  /**
   * Saves or updates a venue zone atomically within a serialized transaction mutex.
   * If a zone with matching ID or normalized name already exists, it is updated in-place
   * to guarantee zero duplicate records in the authoritative store.
   *
   * @param {Object} zone
   * @returns {Promise<Object>} The persisted zone
   */
  async saveZone(zone) {
    if (!zone || typeof zone !== 'object') {
      throw new TypeError('Zone must be a valid object');
    }
    if (typeof zone.id !== 'string' || zone.id.trim().length === 0) {
      throw new TypeError('Zone requires a non-empty string id');
    }

    const normalizedZone = { ...zone, id: zone.id.trim() };
    const normalizedName = typeof normalizedZone.name === 'string' ? normalizedZone.name.trim().toLowerCase() : '';

    return this.enqueueMutation(async () => {
      const data = await this.readData();
      let index = data.zones.findIndex((z) => z.id === normalizedZone.id);
      if (index === -1 && normalizedName) {
        index = data.zones.findIndex((z) => typeof z.name === 'string' && z.name.trim().toLowerCase() === normalizedName);
      }

      if (index >= 0) {
        data.zones[index] = { ...data.zones[index], ...normalizedZone, id: data.zones[index].id };
      } else {
        data.zones.push(normalizedZone);
      }

      await this._writeAtomic(data);
      return index >= 0 ? data.zones[index] : normalizedZone;
    });
  }

  /**
   * Deletes a venue zone by ID atomically.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteZone(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return false;
    }
    const targetId = id.trim();
    return this.enqueueMutation(async () => {
      const data = await this.readData();
      const prevLength = data.zones.length;
      data.zones = data.zones.filter((z) => z.id !== targetId);
      if (data.zones.length !== prevLength) {
        await this._writeAtomic(data);
        return true;
      }
      return false;
    });
  }

  /**
   * Fetches all event sessions.
   * @returns {Promise<Array<Object>>}
   */
  async getSessions() {
    const data = await this.readData();
    return data.sessions;
  }

  /**
   * Fetches a single session by ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getSession(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return null;
    }
    const sessions = await this.getSessions();
    return sessions.find((s) => s.id === id.trim()) || null;
  }

  /**
   * Saves or updates an event session atomically within a serialized transaction mutex.
   *
   * @param {Object} session
   * @returns {Promise<Object>} The persisted session
   */
  async saveSession(session) {
    if (!session || typeof session !== 'object') {
      throw new TypeError('Session must be a valid object');
    }
    if (typeof session.id !== 'string' || session.id.trim().length === 0) {
      throw new TypeError('Session requires a non-empty string id');
    }

    const normalizedSession = { ...session, id: session.id.trim() };

    return this.enqueueMutation(async () => {
      const data = await this.readData();
      const index = data.sessions.findIndex((s) => s.id === normalizedSession.id);

      if (index >= 0) {
        data.sessions[index] = { ...data.sessions[index], ...normalizedSession };
      } else {
        data.sessions.push(normalizedSession);
      }

      await this._writeAtomic(data);
      return index >= 0 ? data.sessions[index] : normalizedSession;
    });
  }

  /**
   * Deletes an event session by ID atomically.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteSession(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return false;
    }
    const targetId = id.trim();
    return this.enqueueMutation(async () => {
      const data = await this.readData();
      const prevLength = data.sessions.length;
      data.sessions = data.sessions.filter((s) => s.id !== targetId);
      if (data.sessions.length !== prevLength) {
        await this._writeAtomic(data);
        return true;
      }
      return false;
    });
  }

  /**
   * Fetches all events.
   * @returns {Promise<Array<Object>>}
   */
  async getEvents() {
    const data = await this.readData();
    return data.events;
  }

  /**
   * Fetches the currently active event.
   * @returns {Promise<Object|null>}
   */
  async getActiveEvent() {
    const events = await this.getEvents();
    return events.find((e) => e.isActive === true) || events[0] || null;
  }

  /**
   * Sets the active event by ID atomically.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async setActiveEvent(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return null;
    }
    const targetId = id.trim();
    return this.enqueueMutation(async () => {
      const data = await this.readData();
      let active = null;
      data.events = data.events.map((e) => {
        if (e.id === targetId) {
          active = { ...e, isActive: true };
          return active;
        }
        return { ...e, isActive: false };
      });
      if (active) {
        await this._writeAtomic(data);
      }
      return active;
    });
  }

  /**
   * Saves or updates an event atomically.
   * @param {Object} event
   * @returns {Promise<Object>}
   */
  async saveEvent(event) {
    if (!event || typeof event !== 'object') {
      throw new TypeError('Event must be a valid object');
    }
    if (typeof event.id !== 'string' || event.id.trim().length === 0) {
      throw new TypeError('Event requires a non-empty string id');
    }

    const normalized = { ...event, id: event.id.trim() };
    return this.enqueueMutation(async () => {
      const data = await this.readData();
      const index = data.events.findIndex((e) => e.id === normalized.id);
      if (index >= 0) {
        data.events[index] = { ...data.events[index], ...normalized };
      } else {
        data.events.push(normalized);
      }
      await this._writeAtomic(data);
      return index >= 0 ? data.events[index] : normalized;
    });
  }

  /**
   * Fetches all alerts, optionally filtering by active state.
   * @param {boolean} [activeOnly=false]
   * @returns {Promise<Array<Object>>}
   */
  async getAlerts(activeOnly = false) {
    const data = await this.readData();
    if (activeOnly) {
      return data.alerts.filter((a) => a.isActive !== false);
    }
    return data.alerts;
  }

  /**
   * Saves or updates a broadcast alert atomically.
   * @param {Object} alert
   * @returns {Promise<Object>}
   */
  async saveAlert(alert) {
    if (!alert || typeof alert !== 'object') {
      throw new TypeError('Alert must be a valid object');
    }
    const alertId = (typeof alert.id === 'string' && alert.id.trim().length > 0)
      ? alert.id.trim()
      : `alert-${Date.now()}`;

    const normalized = {
      id: alertId,
      title: alert.title || 'Venue Notice',
      message: alert.message || '',
      severity: alert.severity || alert.level?.toUpperCase() || 'INFO',
      targetZoneId: alert.targetZoneId || 'ALL',
      createdAtMs: alert.createdAtMs || Date.now(),
      isActive: alert.isActive !== false,
    };

    return this.enqueueMutation(async () => {
      const data = await this.readData();
      const index = data.alerts.findIndex((a) => a.id === normalized.id);
      if (index >= 0) {
        data.alerts[index] = { ...data.alerts[index], ...normalized };
      } else {
        data.alerts.push(normalized);
      }
      await this._writeAtomic(data);
      return index >= 0 ? data.alerts[index] : normalized;
    });
  }

  /**
   * Dismisses an alert by setting isActive: false.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async dismissAlert(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return false;
    }
    const targetId = id.trim();
    return this.enqueueMutation(async () => {
      const data = await this.readData();
      const alert = data.alerts.find((a) => a.id === targetId);
      if (!alert) {
        return false;
      }
      alert.isActive = false;
      await this._writeAtomic(data);
      return true;
    });
  }
}
