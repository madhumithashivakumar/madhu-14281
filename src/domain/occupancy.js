/**
 * @file occupancy.js
 * @description Real-time venue zone occupancy aggregation and crowd density classification.
 * Pure zero-dependency Node.js ESM.
 */

import { DensityTier } from './types.js';
import { SpatialRayCaster } from './spatial.js';

export class OccupancyEngine {
  /**
   * Maps a density percentage [0, 100] to its corresponding DensityTier.
   * - < 40%     -> DensityTier.LOW ('LOW')
   * - 40%..69%  -> DensityTier.MODERATE ('MODERATE')
   * - 70%..89%  -> DensityTier.HIGH ('HIGH')
   * - >= 90%    -> DensityTier.CRITICAL ('CRITICAL')
   *
   * @param {number} densityPercent
   * @returns {string} DensityTier
   */
  static calculateDensityTier(densityPercent) {
    const percent = typeof densityPercent === 'number' && Number.isFinite(densityPercent)
      ? densityPercent
      : 0;

    if (percent < 40) {
      return DensityTier.LOW;
    }
    if (percent < 70) {
      return DensityTier.MODERATE;
    }
    if (percent < 90) {
      return DensityTier.HIGH;
    }
    return DensityTier.CRITICAL;
  }

  /**
   * Computes the real-time occupancy and density tier for a venue zone given active device pings.
   *
   * @param {Object} zone
   * @param {string} [zone.id]
   * @param {string} [zone.zoneId]
   * @param {number} zone.capacity
   * @param {Array|Object} [zone.polygon]
   * @param {Array|Object} [zone.boundary]
   * @param {Array|Object} [zone.coords]
   * @param {Array|Object} [zone.vertices]
   * @param {Array<Object>} activePings Array of active device presence pings
   * @returns {Readonly<{ zoneId: string, currentCount: number, capacity: number, densityPercent: number, densityTier: string }>}
   */
  static computeZoneOccupancy(zone, activePings) {
    if (!zone || typeof zone !== 'object') {
      throw new TypeError('Zone must be a valid object');
    }

    const zoneId = zone.zoneId ?? zone.id ?? 'unknown';
    const rawCapacity = zone.capacity;
    const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity >= 0
      ? Math.floor(rawCapacity)
      : 0;

    const polygon = zone.boundary?.vertices ?? zone.boundary ?? zone.polygon ?? zone.coords ?? zone.vertices ?? zone.coordinates;
    const pings = Array.isArray(activePings) ? activePings : [];

    let currentCount = 0;
    if (polygon) {
      for (let i = 0; i < pings.length; i++) {
        const ping = pings[i];
        if (SpatialRayCaster.containsPoint(ping, polygon)) {
          currentCount++;
        }
      }
    }

    let densityPercent = 0;
    if (capacity > 0) {
      const rawPercent = (currentCount / capacity) * 100;
      // Bounded density percent [0, 100]
      densityPercent = Math.min(100, Math.max(0, Math.round(rawPercent)));
    } else if (currentCount > 0) {
      densityPercent = 100;
    }

    const densityTier = OccupancyEngine.calculateDensityTier(densityPercent);

    return Object.freeze({
      zoneId,
      currentCount,
      capacity,
      densityPercent,
      densityTier,
    });
  }
}

export const calculateDensityTier = OccupancyEngine.calculateDensityTier;
export const computeZoneOccupancy = OccupancyEngine.computeZoneOccupancy;
