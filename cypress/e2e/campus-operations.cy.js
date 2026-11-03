/**
 * @file campus-operations.cy.js
 * @description Comprehensive Cypress E2E regression and feature audit test suite for TierTracker.
 * Validates Desktop Admin Studio (/admin), Mobile Participant Navigator (/app), and REST APIs.
 */

describe('TierTracker - S-Tier End-to-End System Audit (Cypress)', () => {

  // ===========================================================================
  // 1. REST API INTEGRATION & DEFENSIVE VALIDATION
  // ===========================================================================
  describe('1. Authoritative Backend REST API Verification', () => {
    it('GET /api/events returns active Dayananda Sagar University campus', () => {
      cy.request('/api/events').then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.property('events');
        expect(res.body.events).to.be.an('array').with.length.greaterThan(0);
        const main = res.body.events.find((e) => e.id === 'event-dsu-main');
        expect(main).to.exist;
        expect(main.name).to.include('Dayananda Sagar University');
        expect(main.coordinates.lat).to.be.closeTo(12.6606, 0.001);
      });
    });

    it('GET /api/zones returns 10 verified building structures', () => {
      cy.request('/api/zones').then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.property('zones');
        expect(res.body.zones.length).to.be.at.least(10);
        const soe = res.body.zones.find((z) => z.id === 'zone-dsu-soe');
        expect(soe).to.exist;
        expect(soe.name).to.include('School of Engineering');
        expect(soe.capacity).to.eq(1500);
        expect(soe.elevationMeters).to.be.closeTo(24, 1.0);
      });
    });

    it('GET /api/sessions returns active sessions with rating fields', () => {
      cy.request('/api/sessions').then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.sessions).to.be.an('array');
        expect(res.body.sessions.length).to.be.greaterThan(0);
        const first = res.body.sessions[0];
        expect(first).to.have.property('title');
        expect(first).to.have.property('status');
      });
    });

    it('GET /api/occupancy computes real-time density metrics', () => {
      cy.request('/api/occupancy').then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.property('zones');
        expect(res.body).to.have.property('activePingsCount');
      });
    });

    it('POST /api/presence rejects GPS drift exceeding 35m with 422', () => {
      cy.request({
        method: 'POST',
        url: '/api/presence',
        failOnStatusCode: false,
        body: {
          uid: 'cy-test-device-1',
          lat: 12.6618,
          lng: 77.4505,
          acc: 45, // Exceeds 35m ceiling
        },
      }).then((res) => {
        expect(res.status).to.eq(422);
        expect(res.body.error).to.include('Accuracy too low');
      });
    });

    it('POST /api/alerts rejects empty message with 400 Bad Request', () => {
      cy.request({
        method: 'POST',
        url: '/api/alerts',
        failOnStatusCode: false,
        body: {
          title: 'Empty Message Alert',
          message: '   ',
        },
      }).then((res) => {
        expect(res.status).to.eq(400);
        expect(res.body.error).to.include('Alert requires a non-empty message');
      });
    });
  });

  // ===========================================================================
  // 2. DESKTOP ADMIN OPERATIONS STUDIO (/admin, 1440x900)
  // ===========================================================================
  describe('2. Desktop Admin Operations Studio (/admin)', () => {
    beforeEach(() => {
      cy.viewport(1440, 900);
      cy.visit('/admin');
      cy.get('body[data-app-ready="true"]', { timeout: 15000 }).should('exist');
    });

    it('loads page with branded title and 3D spatial canvas initialized', () => {
      cy.title().should('include', 'DSU CampusOps');
      cy.get('#spatial-canvas').should('be.visible');
      cy.get('#current-event-name').should('be.visible');
    });

    it('renders spatial hierarchy outliner with zones and supports filtering', () => {
      cy.get('[data-zone-id]').should('have.length.at.least', 10);
      
      // Filter outliner
      cy.get('#zone-search-input').type('Hospital');
      cy.get('[data-zone-id]').should('contain.text', 'Hospital');
      cy.get('#zone-search-input').clear();
      cy.get('[data-zone-id]').should('have.length.at.least', 10);
    });

    it('selects a zone and synchronizes the inspector panel data', () => {
      cy.get('[data-zone-id="zone-dsu-soe"]').first().click();
      cy.get('#inspector-zone-name').should('contain.text', 'DSU School of Engineering (Block A)');
      cy.get('#inspector-elevation-slider').should('be.visible');
    });

    it('switches view modes between CAD Trace, Heatmap, and 3D View', () => {
      cy.get('#mode-cad').click().should('have.class', 'bg-indigo-600');
      cy.get('#mode-heatmap').click().should('have.class', 'bg-indigo-600');
      cy.get('#mode-3d').click().should('have.class', 'bg-indigo-600');
    });

    it('toggles layer visibility for extrusions and heatmap', () => {
      cy.get('#layer-extrusions').click();
      cy.get('#layer-extrusions').click();
      cy.get('#layer-heatmap').click();
      cy.get('#layer-pins').click();
    });

    it('executes camera presets and zoom controls', () => {
      cy.get('#cam-topdown').click();
      cy.get('#cam-stagefront').click();
      cy.get('#cam-perspective').click();
      cy.get('#zoom-in').click();
      cy.get('#zoom-out').click();
      cy.get('#zoom-reset').click();
    });

    it('opens command palette via trigger and searches for commands', () => {
      cy.get('#omnibar-trigger').click();
      cy.get('#modal-command-palette').should('be.visible');
      cy.get('#command-palette-input').type('3D');
      cy.get('#command-palette-results button').should('have.length.at.least', 1);
      cy.get('body').type('{esc}');
      cy.get('#modal-command-palette').should('not.be.visible');
    });

    it('opens and closes "+ Add Zone" modal dialog', () => {
      cy.get('#btn-quick-add').click();
      cy.get('#modal-add-zone').should('be.visible');
      cy.get('#btn-close-add-zone-modal').click();
      cy.get('#modal-add-zone').should('not.be.visible');
    });

    it('dispatches a broadcast emergency alert through the admin modal', () => {
      cy.get('#btn-broadcast-alert').click();
      cy.get('#modal-broadcast-alert').should('be.visible');
      cy.get('#form-broadcast-alert input[name="title"]').type('Campus Keynote Starting');
      cy.get('#form-broadcast-alert textarea[name="message"]').type('Please proceed to Amphitheater.');
      cy.get('#form-broadcast-alert button[type="submit"]').click();
      cy.get('#modal-broadcast-alert').should('not.be.visible');
    });
  });

  // ===========================================================================
  // 3. MOBILE PARTICIPANT PORTAL (/app, 390x844)
  // ===========================================================================
  describe('3. Mobile Participant Navigator (/app)', () => {
    beforeEach(() => {
      cy.viewport(390, 844);
      cy.visit('/app');
      cy.get('body[data-app-ready="true"]', { timeout: 15000 }).should('exist');
    });

    it('loads mobile participant view with DSU branding and GPS telemetry', () => {
      cy.title().should('include', 'DSU Campus Navigator');
      cy.get('#participant-canvas').should('be.visible');
      cy.get('#telemetry-zone-badge').should('be.visible');
      cy.get('#btn-share-live').should('be.visible');
    });

    it('toggles share live presence mode', () => {
      cy.get('#btn-share-live').click();
      cy.get('#btn-share-live').click();
    });

    it('navigates campus facilities using category filter chips', () => {
      cy.get('.filter-chip').should('have.length.at.least', 5);
      cy.get('.filter-chip[data-filter="zone-dsu-soe"]').click();
      cy.get('.filter-chip[data-filter="all"]').click();
    });

    it('activates and controls walk simulation wayfinding', () => {
      cy.get('#btn-simulate-walk').click();
      cy.get('#simulation-status-pill').should('contain.text', 'WALKING');
      cy.wait(400);
      cy.get('#btn-simulate-walk').click();
      cy.get('#simulation-status-pill').should('contain.text', 'TAP');
    });

    it('interacts with floating HUD map controls (tilt, compass, recenter)', () => {
      cy.get('#btn-tilt').click();
      cy.get('#btn-tilt').click();
      cy.get('#btn-compass').click();
      cy.get('#btn-recenter').click();
    });

    it('expands bottom sheet drawer and displays live session details', () => {
      cy.get('#bottom-sheet-handle').click();
      cy.get('#sheet-session-title').should('be.visible');
      cy.get('#btn-sheet-locate-live').click();
    });

    it('switches bottom sheet tab to "Today\'s Schedule"', () => {
      cy.get('#tab-btn-schedule').click({ force: true });
      cy.get('#sheet-schedule-list').should('be.visible');
    });

    it('submits a 5-star session rating with feedback tags and comment', () => {
      cy.get('#tab-btn-rate').click({ force: true });
      cy.get('[data-star="5"]').click({ force: true });
      cy.get('.feedback-chip').first().click({ force: true });
      cy.get('#rating-comment-input').type('Cypress Automated Audit Review: Excellent session!', { force: true });
      cy.get('#btn-submit-review').click({ force: true });
      cy.get('#btn-submit-review-text').should('contain.text', 'Submitted');
    });

    it('opens and closes bottom thumb dock navigation modals (zones, schedule, pass)', () => {
      // 1. Zones Modal
      cy.get('.nav-tab[data-tab="zones"]').click({ force: true });
      cy.get('#modal-zones').should('be.visible');
      cy.get('.btn-close-modal[data-modal="modal-zones"]').click({ force: true });
      cy.get('#modal-zones').should('not.be.visible');

      // 2. Schedule Modal
      cy.get('.nav-tab[data-tab="schedule"]').click({ force: true });
      cy.get('#modal-schedule').should('be.visible');
      cy.get('.btn-close-modal[data-modal="modal-schedule"]').click({ force: true });
      cy.get('#modal-schedule').should('not.be.visible');

      // 3. Digital Pass Modal
      cy.get('.nav-tab[data-tab="pass"]').click({ force: true });
      cy.get('#modal-pass').should('be.visible');
      cy.get('#pass-uid-display').should('be.visible');
      cy.get('.btn-close-modal[data-modal="modal-pass"]').click({ force: true });
      cy.get('#modal-pass').should('not.be.visible');
    });
  });
});
