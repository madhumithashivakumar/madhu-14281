# TierTracker: DSU Campus Spatial Operations & Attendance Platform

[![Node.js](https://img.shields.io/badge/Node.js-20+-68a063?style=flat&logo=node.js)](https://nodejs.org/)
[![Pure ESM](https://img.shields.io/badge/Architecture-Hexagonal%20%7C%20Pure%20ESM-6366f1?style=flat)](https://nodejs.org/api/esm.html)
[![Zero Runtime Dependencies](https://img.shields.io/badge/Dependencies-0%20Runtime%20NPM-10b981?style=flat)](package.json)
[![Tests Passing](https://img.shields.io/badge/Unit%20Tests-60%2F60%20Pass-10b981?style=flat)](tests/domain.test.js)
[![Playwright E2E](https://img.shields.io/badge/Playwright%20E2E-33%2F33%20Pass-10b981?style=flat)](tests/browser-e2e.js)

An enterprise-grade, lightweight 3D spatial operations and real-time student attendance platform designed for **Dayananda Sagar University (DSU)**. Built strictly following **S-Tier Engineering & Software Craftsmanship Standards**: zero runtime external npm dependencies, pure native Node.js ESM, thread-safe atomic persistence, and sub-millisecond geodetic spatial computation.

---

## Architecture & Core Modules

TierTracker follows **Hexagonal Architecture (Ports & Adapters)** with complete separation between the pure domain core, infrastructure adapters, and transport layers:

```text
[ HTTP Gateway & Static Server (src/server.js) ]
               │
               ▼
[ API Routes & Controllers (src/api/routes.js) ]
       │                               │
       ▼                               ▼
[ Domain Services ]            [ Infrastructure Adapters ]
 - SpatialRayCaster (Jordan Curve)  - AtomicFileVenueRepository (data/db.json)
 - OccupancyEngine (Crowd Density)  - SlidingWindowPresenceStore (In-memory TTL)
 - CampusRoutingEngine (Dijkstra)   - CampusWifiTelemetryService (AP Ingestion)
 - SessionStateMachine
```

### Key Capabilities

1. **Dual Specialized Dashboards:**
   - **Admin Operations Studio (`/admin`):** Desktop-optimized spatial CAD console featuring interactive 3D extruded zones, live telemetry bar, zone hierarchy outliner, session controllers, broadcast alerts, and GeoJSON export.
   - **Participant Campus Navigator (`/app`):** Mobile-first progressive navigator with indoor localization badges, interactive bottom sheet drawer, today's schedule, session review submission, and walk simulation.

2. **Campus Wi-Fi Student Presence Telemetry:**
   - Ingests mobile device connectivity across DSU campus Wi-Fi access points (`AP-DSU-SOE-A1`, `AP-DSU-MED-B1`, `AP-DSU-FOODCOURT-01`, `AP-DSU-RESNET-MESH`, etc.).
   - Computes live occupancy percentages, active ping counts, and crowd density tiers (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`).

3. **Turn-by-Turn Wayfinding with Left & Right Turn Indications:**
   - Sub-millisecond Dijkstra shortest path solver across campus pedestrian walkway network.
   - Computes segment bearings and relative turn angles:
     - `↰ Turn Left` (Amber badge, $-150^\circ \le \Delta\theta \le -30^\circ$)
     - `↱ Turn Right` (Emerald badge, $30^\circ \le \Delta\theta \le 150^\circ$)
     - `Straight` and `Arrived` instructions with ground distances (meters) and walking ETA (minutes).
   - Real-time animated neon route corridor rendered on HTML5 Canvas.

---

## Getting Started

### Prerequisites
- Node.js `v20.0.0` or later (`v22` / `v26` supported)
- npm `v10.0.0` or later

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/madhumithashivakumar/madhu-14281.git
   cd madhu-14281
   ```

2. **Install development dependencies (Cypress & Playwright for testing):**
   ```bash
   npm install
   ```

3. **Configure environment variables (optional):**
   ```bash
   cp .env.example .env
   ```

4. **Start the local server:**
   ```bash
   npm start
   ```

The server binds to `http://0.0.0.0:3000`:
- **Admin Studio:** [http://localhost:3000/admin](http://localhost:3000/admin)
- **Participant App:** [http://localhost:3000/app](http://localhost:3000/app)
- **Health / Occupancy API:** [http://localhost:3000/api/occupancy](http://localhost:3000/api/occupancy)

---

## Verification & Automated Testing

The project includes unit and browser-based end-to-end regression suites:

```bash
# Run pure native Node.js unit & domain tests (60/60 tests)
npm test

# Run domain logic tests only
npm run test:domain

# Run infrastructure & API route tests only
npm run test:infra

# Run Playwright end-to-end browser audit (33/33 tests)
npm run test:playwright

# Run Cypress headless test suite
npm run test:cypress
```

---

## Project Structure

```text
├── .idea/                 # IntelliJ IDEA project configuration (VCS, modules)
├── .env.example           # Environment configuration template
├── .gitattributes         # Enforced LF normalization & binary rules
├── .gitignore             # Standard exclusion rules
├── .node-version          # Target Node.js major version
├── .nvmrc                 # NVM version definition
├── cypress/               # Cypress E2E test suite
├── cypress.config.js      # Cypress configuration
├── data/
│   └── db.json            # Authoritative atomic JSON database
├── execution-plan.md      # Platform execution plan
├── GEMINI.md              # S-Tier software craftsmanship rules
├── package.json           # Project manifest (ESM type, scripts, devDeps)
├── public/
│   ├── admin/             # Desktop Admin Operations Studio (HTML, CSS, JS)
│   └── app/               # Mobile Participant Campus Navigator (HTML, CSS, JS)
├── src/
│   ├── api/
│   │   └── routes.js      # REST API request router and endpoints
│   ├── domain/            # Zero-dependency business domain logic
│   │   ├── occupancy.js   # Crowd density calculator & tier classifier
│   │   ├── routing.js     # Campus Dijkstra wayfinding & turn classification
│   │   ├── session.js     # State machine for sessions & rating math
│   │   ├── spatial.js     # Jordan Curve raycasting & bounding box math
│   │   └── types.js       # Frozen domain value objects, enums, Result types
│   ├── infra/             # Infrastructure ports & persistence adapters
│   │   ├── campus-wifi-telemetry.js # AP telemetry & device presence simulation
│   │   ├── file-repository.js       # Atomic serialized JSON repository
│   │   └── presence-store.js        # Bounded sliding-window presence store
│   └── server.js          # HTTP gateway & static file web server
└── tests/
    ├── browser-e2e.js     # Playwright full product audit suite
    ├── domain.test.js     # Pure domain unit tests
    └── infra.test.js      # Infrastructure & API integration tests
```

---

## IntelliJ IDEA Integration

This repository includes first-class IntelliJ IDEA support in `.idea/`:
- **Git VCS Auto-Detection:** Configured in `.idea/vcs.xml` so IntelliJ automatically enables the Git tool window (`⌘9`), Commit tool window (`⌘K`), branch switcher, and line-level diff gutters.
- **Node.js & JavaScript ES6+:** Configured in `.idea/misc.xml` and `.idea/tiertracker.iml`.

To open in IntelliJ IDEA:
1. Select **File ➔ Open...**
2. Choose the project directory (`TierTracker` / `madhu-14281`).
3. IntelliJ IDEA will immediately index the project, detect Git, and mark `node_modules` as excluded.

---

## License

ISC License. Copyright (c) 2026.
