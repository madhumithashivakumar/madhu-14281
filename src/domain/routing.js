/**
 * @file routing.js
 * @description Campus Wayfinding & Turn-by-Turn Navigation Engine for Dayananda Sagar University (DSU).
 * Computes shortest walkable campus routes, exact segment distances, bearing changes,
 * and intuitive Left / Right turn indications and landmark hints.
 * Strictly adheres to S-Tier Engineering: Zero external dependencies, pure ESM, typed invariants.
 */

const METERS_PER_DEGREE_LAT = 111139;
const METERS_PER_DEGREE_LNG = 108420; // At lat ~12.66 deg

/**
 * Computes Euclidean ground distance in meters between two coordinates.
 *
 * @param {{ lat: number, lng: number }} p1
 * @param {{ lat: number, lng: number }} p2
 * @returns {number} Distance in meters
 */
export function calculateDistanceMeters(p1, p2) {
  const dLat = (p2.lat - p1.lat) * METERS_PER_DEGREE_LAT;
  const dLng = (p2.lng - p1.lng) * METERS_PER_DEGREE_LNG;
  return Math.hypot(dLat, dLng);
}

/**
 * Calculates initial bearing in degrees [0, 360) from p1 to p2.
 *
 * @param {{ lat: number, lng: number }} p1
 * @param {{ lat: number, lng: number }} p2
 * @returns {number} Bearing in degrees
 */
export function calculateBearing(p1, p2) {
  const y = (p2.lng - p1.lng) * METERS_PER_DEGREE_LNG;
  const x = (p2.lat - p1.lat) * METERS_PER_DEGREE_LAT;
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Determines turn direction based on angular difference between incoming and outgoing bearings.
 *
 * @param {number} b1 Incoming bearing [0, 360)
 * @param {number} b2 Outgoing bearing [0, 360)
 * @returns {'LEFT' | 'RIGHT' | 'STRAIGHT' | 'UTURN'}
 */
export function getTurnType(b1, b2) {
  let diff = (b2 - b1 + 360) % 360;
  if (diff > 180) diff -= 360;

  if (diff >= 30 && diff <= 150) return 'RIGHT';
  if (diff <= -30 && diff >= -150) return 'LEFT';
  if (Math.abs(diff) > 150) return 'UTURN';
  return 'STRAIGHT';
}

/**
 * DSU Campus Walkway Network Nodes (Verified Geodetic Coordinates).
 */
export const CAMPUS_NODES = Object.freeze({
  'gate1': {
    id: 'gate1',
    name: 'Gate 1 - Main Entrance (Kanakapura Rd)',
    zoneId: 'zone-dsu-gate1',
    lat: 12.663127,
    lng: 77.451032,
    landmark: 'Campus Main Gate Security Arch',
  },
  'junct-north': {
    id: 'junct-north',
    name: 'North Central Crossway',
    lat: 12.662700,
    lng: 77.451032,
    landmark: 'Welcome Fountain & Flag Mast',
  },
  'soe': {
    id: 'soe',
    name: 'DSU School of Engineering (Block A)',
    zoneId: 'zone-dsu-soe',
    lat: 12.661846,
    lng: 77.450515,
    landmark: 'School of Engineering Central Quad',
  },
  'quantum': {
    id: 'quantum',
    name: 'AI Quantum Lab',
    zoneId: 'zone-1793641357105',
    lat: 12.661600,
    lng: 77.450400,
    landmark: 'Cleanroom Wing, Block A Ground Floor',
  },
  'amphi': {
    id: 'amphi',
    name: 'Dr. Premachandra Sagar Open Amphitheater',
    zoneId: 'zone-dsu-amphitheater',
    lat: 12.662490,
    lng: 77.450897,
    landmark: 'Open Amphitheater Grand Steps',
  },
  'foodcourt': {
    id: 'foodcourt',
    name: 'Student Food Court & Tummy Trails',
    zoneId: 'zone-dsu-foodcourt',
    lat: 12.662410,
    lng: 77.451751,
    landmark: 'Food Court Plaza & Outdoor Seating',
  },
  'mech': {
    id: 'mech',
    name: 'Mechanical Engineering & Research Labs',
    zoneId: 'zone-dsu-mechanical',
    lat: 12.662308,
    lng: 77.452243,
    landmark: 'Automotive & Heavy Labs Workshop',
  },
  'pharm': {
    id: 'pharm',
    name: 'Department of Pharmacy',
    zoneId: 'zone-dsu-pharmacy',
    lat: 12.659613,
    lng: 77.452627,
    landmark: 'Pharmacy Block Medicinal Garden',
  },
  'sports': {
    id: 'sports',
    name: 'DSU Sports Complex & Cricket Ground',
    zoneId: 'zone-dsu-sports',
    lat: 12.661584,
    lng: 77.454830,
    landmark: 'Cricket Pavilion & Athletic Track',
  },
  'junct-central': {
    id: 'junct-central',
    name: 'Central Spine Avenue Junction',
    lat: 12.661200,
    lng: 77.450400,
    landmark: 'Clock Tower & Innovation Garden',
  },
  'hospital': {
    id: 'hospital',
    name: 'Dr. Chandramma DSU Medical Hospital (Block B)',
    zoneId: 'zone-dsu-cdsimer',
    lat: 12.660317,
    lng: 77.449615,
    landmark: 'Hospital Emergency & Outpatient Portico',
  },
  'healthsci': {
    id: 'healthsci',
    name: 'School of Health Sciences & Nursing',
    zoneId: 'zone-dsu-healthsci',
    lat: 12.658995,
    lng: 77.449755,
    landmark: 'Nursing Simulation Center',
  },
  'hostels': {
    id: 'hostels',
    name: 'S-Residency Student Living & Hostels',
    zoneId: 'zone-dsu-hostels',
    lat: 12.657577,
    lng: 77.447558,
    landmark: 'S-Residency Hostel Gatehouse',
  },
});

/**
 * Campus Walkway Network Adjacency Edges (bidirectional pedestrian walkways).
 */
export const CAMPUS_EDGES = Object.freeze([
  ['gate1', 'junct-north'],
  ['junct-north', 'amphi'],
  ['junct-north', 'foodcourt'],
  ['amphi', 'soe'],
  ['foodcourt', 'mech'],
  ['foodcourt', 'amphi'],
  ['soe', 'quantum'],
  ['soe', 'junct-central'],
  ['mech', 'sports'],
  ['mech', 'pharm'],
  ['junct-central', 'hospital'],
  ['junct-central', 'pharm'],
  ['hospital', 'healthsci'],
  ['healthsci', 'hostels'],
]);

export class CampusRoutingEngine {
  /**
   * Builds the internal adjacency graph.
   */
  constructor() {
    /** @type {Map<string, Array<{ to: string, dist: number }>>} */
    this.graph = new Map();

    for (const key of Object.keys(CAMPUS_NODES)) {
      this.graph.set(key, []);
    }

    for (const [u, v] of CAMPUS_EDGES) {
      const nodeU = CAMPUS_NODES[u];
      const nodeV = CAMPUS_NODES[v];
      if (nodeU && nodeV) {
        const dist = calculateDistanceMeters(nodeU, nodeV);
        this.graph.get(u).push({ to: v, dist });
        this.graph.get(v).push({ to: u, dist });
      }
    }
  }

  /**
   * Resolves nearest campus walkway node to a given point or zone ID.
   *
   * @param {string | { lat: number, lng: number }} query
   * @returns {string | null} Node key
   */
  resolveNode(query) {
    if (typeof query === 'string') {
      const clean = query.trim().toLowerCase();
      // Match by exact node ID
      if (this.graph.has(clean)) return clean;

      // Match by zone ID
      for (const [id, node] of Object.entries(CAMPUS_NODES)) {
        if (node.zoneId && node.zoneId.toLowerCase() === clean) {
          return id;
        }
      }

      // Match by substring in name
      for (const [id, node] of Object.entries(CAMPUS_NODES)) {
        if (node.name.toLowerCase().includes(clean)) {
          return id;
        }
      }
    } else if (query && typeof query.lat === 'number' && typeof query.lng === 'number') {
      let closestId = null;
      let minDist = Infinity;
      for (const [id, node] of Object.entries(CAMPUS_NODES)) {
        const d = calculateDistanceMeters(query, node);
        if (d < minDist) {
          minDist = d;
          closestId = id;
        }
      }
      return closestId;
    }

    return null;
  }

  /**
   * Computes shortest path between start and end nodes using Dijkstra's algorithm.
   *
   * @param {string} startNodeId
   * @param {string} endNodeId
   * @returns {Array<string> | null}
   */
  findShortestPath(startNodeId, endNodeId) {
    if (!this.graph.has(startNodeId) || !this.graph.has(endNodeId)) {
      return null;
    }

    if (startNodeId === endNodeId) {
      return [startNodeId];
    }

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(this.graph.keys());

    for (const node of this.graph.keys()) {
      distances.set(node, Infinity);
    }
    distances.set(startNodeId, 0);

    while (unvisited.size > 0) {
      // Find node with minimum distance
      let current = null;
      let minDis = Infinity;
      for (const node of unvisited) {
        const d = distances.get(node);
        if (d < minDis) {
          minDis = d;
          current = node;
        }
      }

      if (current === null || current === endNodeId) {
        break;
      }

      unvisited.delete(current);

      const neighbors = this.graph.get(current) || [];
      for (const { to, dist } of neighbors) {
        if (!unvisited.has(to)) continue;

        const alt = distances.get(current) + dist;
        if (alt < distances.get(to)) {
          distances.set(to, alt);
          previous.set(to, current);
        }
      }
    }

    // Reconstruct path
    const path = [];
    let curr = endNodeId;
    while (curr !== undefined) {
      path.unshift(curr);
      curr = previous.get(curr);
    }

    return path.length > 0 && path[0] === startNodeId ? path : null;
  }

  /**
   * Generates comprehensive turn-by-turn navigation instructions for a route.
   *
   * @param {string | { lat: number, lng: number }} from Start zone, node, or coordinate
   * @param {string | { lat: number, lng: number }} to Destination zone, node, or coordinate
   * @returns {Object} Route result with turn instructions, distances, and coordinates
   */
  generateDirections(from, to) {
    const startId = this.resolveNode(from) || 'gate1';
    const endId = this.resolveNode(to) || 'soe';

    const pathNodes = this.findShortestPath(startId, endId);
    if (!pathNodes || pathNodes.length === 0) {
      return {
        success: false,
        error: 'No pedestrian path found between origin and destination',
      };
    }

    const steps = [];
    const pathPoints = [];
    let totalDistanceMeters = 0;

    for (let i = 0; i < pathNodes.length; i++) {
      const node = CAMPUS_NODES[pathNodes[i]];
      pathPoints.push({
        id: node.id,
        name: node.name,
        zoneId: node.zoneId,
        lat: node.lat,
        lng: node.lng,
      });
    }

    // Step 1: Initial departure instruction
    const startNode = CAMPUS_NODES[pathNodes[0]];
    const destNode = CAMPUS_NODES[pathNodes[pathNodes.length - 1]];

    if (pathNodes.length === 1) {
      steps.push({
        stepIndex: 1,
        turnType: 'ARRIVE',
        instruction: `You have arrived at ${destNode.name}`,
        distanceMeters: 0,
        landmark: destNode.landmark,
        icon: 'place',
      });
    } else {
      let prevBearing = calculateBearing(CAMPUS_NODES[pathNodes[0]], CAMPUS_NODES[pathNodes[1]]);

      for (let i = 0; i < pathNodes.length - 1; i++) {
        const u = CAMPUS_NODES[pathNodes[i]];
        const v = CAMPUS_NODES[pathNodes[i + 1]];
        const segmentDist = calculateDistanceMeters(u, v);
        totalDistanceMeters += segmentDist;

        const currentBearing = calculateBearing(u, v);
        let turnType = 'STRAIGHT';
        let turnText = 'Head straight';
        let icon = 'straight';

        if (i === 0) {
          turnType = 'DEPART';
          turnText = `Start at ${u.name} and head towards ${v.name}`;
          icon = 'navigation';
        } else {
          turnType = getTurnType(prevBearing, currentBearing);
          if (turnType === 'RIGHT') {
            turnText = `Turn Right towards ${v.name}`;
            icon = 'turn_right';
          } else if (turnType === 'LEFT') {
            turnText = `Turn Left towards ${v.name}`;
            icon = 'turn_left';
          } else if (turnType === 'UTURN') {
            turnText = `Make a U-Turn towards ${v.name}`;
            icon = 'u_turn_left';
          } else {
            turnText = `Continue straight towards ${v.name}`;
            icon = 'straight';
          }
        }

        steps.push({
          stepIndex: i + 1,
          turnType,
          instruction: turnText,
          distanceMeters: Math.round(segmentDist),
          landmark: v.landmark || u.landmark,
          icon,
        });

        prevBearing = currentBearing;
      }

      // Final Arrival Step
      steps.push({
        stepIndex: steps.length + 1,
        turnType: 'ARRIVE',
        instruction: `Arrive at destination: ${destNode.name}`,
        distanceMeters: 0,
        landmark: destNode.landmark,
        icon: 'flag',
      });
    }

    const estimatedWalkingMinutes = Math.max(1, Math.ceil(totalDistanceMeters / 70)); // ~70m per min walk speed

    return {
      success: true,
      origin: startNode,
      destination: destNode,
      totalDistanceMeters: Math.round(totalDistanceMeters),
      estimatedWalkingMinutes,
      steps,
      pathPoints,
    };
  }
}
