/**
 * @file spatial.js
 * @description High-performance geospatial ray-casting engine adhering to the Jordan Curve Theorem.
 * Includes O(1) bounding box pruning and robust defensive handling of collinearity and vertices.
 * Pure zero-dependency Node.js ESM.
 */

const EPSILON = 1e-9;

/**
 * Safely extracts coordinate { x, y } where x is longitude and y is latitude.
 * Handles arrays [lng, lat], coordinate objects { lat, lng } or { latitude, longitude, x, y }.
 *
 * @param {*} point
 * @returns {{ x: number, y: number } | null}
 */
function extractPoint(point) {
  if (!point || typeof point !== 'object') {
    return null;
  }

  let x;
  let y;

  if (Array.isArray(point)) {
    if (point.length < 2) return null;
    x = point[0];
    y = point[1];
  } else {
    x = point.lng ?? point.longitude ?? point.lon ?? point.x;
    y = point.lat ?? point.latitude ?? point.y;
  }

  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;

  return { x, y };
}

/**
 * Safely extracts polygon vertices into normalized array of { x, y } points.
 *
 * @param {*} polygon
 * @returns {Array<{ x: number, y: number }> | null}
 */
function extractPolygonVertices(polygon) {
  if (!polygon || typeof polygon !== 'object') {
    return null;
  }

  let raw = Array.isArray(polygon)
    ? polygon
    : (polygon.vertices ?? polygon.coords ?? polygon.coordinates);

  // Support GeoJSON Polygon linear rings: coordinates: [ [ [lng, lat], ... ] ]
  if (Array.isArray(raw) && raw.length >= 1 && Array.isArray(raw[0]) && Array.isArray(raw[0][0])) {
    raw = raw[0];
  }

  if (!Array.isArray(raw) || raw.length < 3) {
    return null;
  }

  const vertices = [];
  for (let i = 0; i < raw.length; i++) {
    const pt = extractPoint(raw[i]);
    if (!pt) {
      return null;
    }
    vertices.push(pt);
  }

  // Remove redundant closing vertex if first and last vertices are identical
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (
    Math.abs(first.x - last.x) < EPSILON &&
    Math.abs(first.y - last.y) < EPSILON
  ) {
    vertices.pop();
  }

  return vertices.length >= 3 ? vertices : null;
}

/**
 * Tests whether a point P(px, py) lies on line segment A(ax, ay) -> B(bx, by).
 *
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {boolean}
 */
function isPointOnSegment(px, py, ax, ay, bx, by) {
  const minX = Math.min(ax, bx) - EPSILON;
  const maxX = Math.max(ax, bx) + EPSILON;
  const minY = Math.min(ay, by) - EPSILON;
  const maxY = Math.max(ay, by) + EPSILON;

  if (px < minX || px > maxX || py < minY || py > maxY) {
    return false;
  }

  // Collinearity check via cross product: (P - A) x (B - A) == 0
  const crossProduct = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  return Math.abs(crossProduct) <= EPSILON;
}

/**
 * SpatialRayCaster implements the Jordan Curve Theorem point-in-polygon algorithm
 * with O(1) bounding box pre-filtering and numerical stability guarantees.
 */
export class SpatialRayCaster {
  /**
   * Computes an axis-aligned bounding box (AABB) for a polygon.
   *
   * @param {Array|Object} polygon
   * @returns {Readonly<{ minX: number, maxX: number, minY: number, maxY: number, minLng: number, maxLng: number, minLat: number, maxLat: number }> | null}
   */
  static computeBoundingBox(polygon) {
    const vertices = extractPolygonVertices(polygon);
    if (!vertices) {
      return null;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }

    return Object.freeze({
      minX,
      maxX,
      minY,
      maxY,
      minLng: minX,
      maxLng: maxX,
      minLat: minY,
      maxLat: maxY,
    });
  }

  /**
   * O(1) Bounding Box check for early rejection.
   *
   * @param {*} point
   * @param {Object} box
   * @returns {boolean}
   */
  static isInBoundingBox(point, box) {
    if (!box || typeof box !== 'object') {
      return false;
    }

    const pt = extractPoint(point);
    if (!pt) {
      return false;
    }

    const minX = box.minX ?? box.minLng;
    const maxX = box.maxX ?? box.maxLng;
    const minY = box.minY ?? box.minLat;
    const maxY = box.maxY ?? box.maxLat;

    if (
      typeof minX !== 'number' || !Number.isFinite(minX) ||
      typeof maxX !== 'number' || !Number.isFinite(maxX) ||
      typeof minY !== 'number' || !Number.isFinite(minY) ||
      typeof maxY !== 'number' || !Number.isFinite(maxY)
    ) {
      return false;
    }

    return (
      pt.x >= minX - EPSILON &&
      pt.x <= maxX + EPSILON &&
      pt.y >= minY - EPSILON &&
      pt.y <= maxY + EPSILON
    );
  }

  /**
   * Determines if a point is contained within a polygon boundary using the Jordan Curve Theorem.
   * Defensively handles vertices and collinear boundary segments without throwing or returning NaN.
   *
   * @param {*} point Coordinate object or array
   * @param {*} polygon Polygon object or vertex array
   * @returns {boolean} True if point is inside or on the boundary
   */
  static containsPoint(point, polygon) {
    const pt = extractPoint(point);
    if (!pt) {
      return false;
    }

    const vertices = extractPolygonVertices(polygon);
    if (!vertices) {
      return false;
    }

    // Step 1: O(1) Bounding box pre-check for early rejection
    const bbox = SpatialRayCaster.computeBoundingBox(vertices);
    if (!bbox || !SpatialRayCaster.isInBoundingBox(pt, bbox)) {
      return false;
    }

    // Step 2: Ray-casting crossing count algorithm
    let inside = false;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x;
      const yi = vertices[i].y;
      const xj = vertices[j].x;
      const yj = vertices[j].y;

      // Handle points lying exactly on a boundary edge or vertex
      if (isPointOnSegment(pt.x, pt.y, xi, yi, xj, yj)) {
        return true;
      }

      // Jordan Curve Theorem ray intersection check
      // Tests whether a horizontal ray cast from (pt.x, pt.y) eastward intersects edge (j -> i)
      const crossesY = (yi > pt.y) !== (yj > pt.y);
      if (crossesY) {
        const intersectX = ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
        if (pt.x < intersectX) {
          inside = !inside;
        }
      }
    }

    return inside;
  }
}

export const containsPoint = SpatialRayCaster.containsPoint;
export const computeBoundingBox = SpatialRayCaster.computeBoundingBox;
export const isInBoundingBox = SpatialRayCaster.isInBoundingBox;
