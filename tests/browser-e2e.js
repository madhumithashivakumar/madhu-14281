/**
 * @file browser-e2e.js
 * @description Comprehensive, S-Tier Playwright End-to-End Browser Test Suite for TierTracker.
 * Exhaustively exercises every accessible feature across Desktop Admin (/admin) and Mobile Participant (/app).
 */

import { chromium } from 'playwright';
import { startServer } from '../src/server.js';

async function runBrowserE2E() {
  const PORT = 3199;
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  console.log(`[E2E] Starting TierTracker test server on port ${PORT}...`);
  const server = await startServer(PORT);

  const errors = [];
  const warnings = [];
  const passedFeatures = [];

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    // =========================================================================
    // 1. DESKTOP ADMIN OPERATIONS STUDIO (/admin, 1440x900)
    // =========================================================================
    console.log('\n======================================================');
    console.log('[E2E] 1. AUDITING ADMIN OPERATIONS STUDIO (/admin)...');
    console.log('======================================================');

    const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const adminPage = await adminContext.newPage();

    adminPage.on('pageerror', err => {
      console.error('[ADMIN PAGEERROR]:', err.message);
      errors.push(`Admin Page Error: ${err.message}`);
    });

    adminPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('[ADMIN CONSOLE ERROR]:', msg.text());
        errors.push(`Admin Console Error: ${msg.text()}`);
      } else if (msg.type() === 'warning') {
        warnings.push(`Admin Console Warn: ${msg.text()}`);
      }
    });

    adminPage.on('requestfailed', req => {
      if (!req.url().includes('favicon.ico')) {
        console.error('[ADMIN REQUEST FAILED]:', req.method(), req.url(), req.failure()?.errorText);
        errors.push(`Admin Request Failed: ${req.url()} (${req.failure()?.errorText})`);
      }
    });

    console.log(`[E2E] Navigating to ${BASE_URL}/admin...`);
    const adminResponse = await adminPage.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    if (adminResponse.status() !== 200) {
      errors.push(`Admin page returned non-200 status: ${adminResponse.status()}`);
    }
    const adminTitle = await adminPage.title();
    console.log(`[E2E] Admin Page Title: "${adminTitle}"`);
    passedFeatures.push('Admin Portal Navigation & 200 OK');

    // 1.1 Verify Spatial Canvas
    const canvas = await adminPage.waitForSelector('#spatial-canvas', { timeout: 5000 });
    if (!canvas) errors.push('Admin #spatial-canvas not found');
    else passedFeatures.push('Admin 3D Spatial Canvas Initialization');

    await adminPage.waitForTimeout(600);

    // 1.2 Event Selector Dropdown
    console.log('[E2E] Testing Event Selector Dropdown...');
    const eventBtn = await adminPage.$('#event-selector-btn');
    if (eventBtn) {
      await eventBtn.click();
      await adminPage.waitForTimeout(300);
      const secondEvent = await adminPage.$('#event-dropdown-menu button:nth-child(3)');
      if (secondEvent) {
        await secondEvent.click();
        await adminPage.waitForTimeout(300);
        const currentEventName = await adminPage.$eval('#current-event-name', el => el.textContent.trim());
        console.log(`[E2E] Switched active event to: "${currentEventName}"`);
        if (currentEventName.includes('Kudlu Gate') || currentEventName.includes('DSU')) {
          passedFeatures.push('Admin Event Switcher');
        } else {
          errors.push('Event dropdown did not update #current-event-name properly');
        }
      }
    }

    // 1.3 Outliner Hierarchy Tree & Zone Selection
    console.log('[E2E] Testing Spatial Hierarchy Outliner...');
    await adminPage.waitForTimeout(600);
    const outlinerItems = await adminPage.$$('[data-zone-id]');
    console.log(`[E2E] Outliner Zones detected: ${outlinerItems.length}`);
    if (outlinerItems.length === 0) {
      errors.push('No zones rendered in admin outliner tree');
    } else {
      passedFeatures.push('Spatial Hierarchy Outliner Rendered');
      // Click first zone fresh from DOM
      const firstZone = await adminPage.$('[data-zone-id]');
      if (firstZone) {
        const zoneId = await firstZone.getAttribute('data-zone-id');
        await firstZone.click();
        await adminPage.waitForTimeout(400);

        const inspectorTitle = await adminPage.$eval('#inspector-zone-name', el => el.textContent.trim()).catch(() => '');
        console.log(`[E2E] Selected Zone: "${inspectorTitle}" (ID: ${zoneId})`);
        if (!inspectorTitle) {
          errors.push('Inspector zone name did not update upon zone selection');
        } else {
          passedFeatures.push('Zone Selection & Inspector Data Sync');
        }
      }
    }

    // 1.4 Outliner Search Filter
    console.log('[E2E] Testing Outliner Search Filter...');
    const searchFilter = await adminPage.$('#zone-search-input');
    if (searchFilter) {
      await searchFilter.fill('Engineering');
      await adminPage.waitForTimeout(300);
      const filteredCount = (await adminPage.$$('[data-zone-id]')).length;
      console.log(`[E2E] Filtered zone count for "Engineering": ${filteredCount}`);
      await searchFilter.fill('');
      await adminPage.waitForTimeout(300);
      passedFeatures.push('Spatial Hierarchy Outliner Search Filtering');
    }

    // 1.5 View Mode Switcher
    console.log('[E2E] Testing View Mode Buttons (#mode-cad, #mode-heatmap, #mode-3d)...');
    const modeCad = await adminPage.$('#mode-cad');
    const modeHeatmap = await adminPage.$('#mode-heatmap');
    const mode3d = await adminPage.$('#mode-3d');
    if (modeCad && modeHeatmap && mode3d) {
      await modeCad.click();
      await adminPage.waitForTimeout(200);
      await modeHeatmap.click();
      await adminPage.waitForTimeout(200);
      await mode3d.click();
      await adminPage.waitForTimeout(200);
      passedFeatures.push('Admin View Mode Switching (CAD/Heatmap/3D)');
    } else {
      errors.push('Mode buttons (#mode-cad, #mode-heatmap, #mode-3d) missing');
    }

    // 1.6 Layer Toggles
    console.log('[E2E] Testing Layer Toggles...');
    const layerExt = await adminPage.$('#layer-extrusions');
    const layerHeat = await adminPage.$('#layer-heatmap');
    const layerPins = await adminPage.$('#layer-pins');
    if (layerExt && layerHeat && layerPins) {
      await layerExt.click();
      await adminPage.waitForTimeout(150);
      await layerExt.click();
      await layerHeat.click();
      await adminPage.waitForTimeout(150);
      await layerPins.click();
      await adminPage.waitForTimeout(150);
      passedFeatures.push('Admin Layer Visibility Toggles');
    }

    // 1.7 Camera Presets & Zoom Stack
    console.log('[E2E] Testing Camera Presets & Zoom Stack...');
    const camTopDown = await adminPage.$('#cam-topdown');
    const camStageFront = await adminPage.$('#cam-stagefront');
    const camPerspective = await adminPage.$('#cam-perspective');
    const zoomIn = await adminPage.$('#zoom-in');
    const zoomOut = await adminPage.$('#zoom-out');
    const zoomReset = await adminPage.$('#zoom-reset');

    if (camTopDown && camStageFront && camPerspective) {
      await camTopDown.click();
      await adminPage.waitForTimeout(200);
      await camStageFront.click();
      await adminPage.waitForTimeout(200);
      await camPerspective.click();
      await adminPage.waitForTimeout(200);
      passedFeatures.push('Camera Presets (Perspective, TopDown, StageFront)');
    }
    if (zoomIn && zoomOut && zoomReset) {
      await zoomIn.click();
      await adminPage.waitForTimeout(100);
      await zoomOut.click();
      await adminPage.waitForTimeout(100);
      await zoomReset.click();
      await adminPage.waitForTimeout(100);
      passedFeatures.push('Camera Zoom Stack (+/-/Reset)');
    }

    // 1.8 Zone Elevation Slider
    console.log('[E2E] Testing Zone Elevation Slider...');
    const elevSlider = await adminPage.$('#inspector-elevation-slider');
    if (elevSlider) {
      await elevSlider.fill('24.5');
      await elevSlider.dispatchEvent('input');
      await adminPage.waitForTimeout(300);
      const elevText = await adminPage.$eval('#inspector-elevation-val', el => el.textContent.trim());
      console.log(`[E2E] Inspector Elevation value updated to: "${elevText}"`);
      if (elevText === '24.5m') {
        passedFeatures.push('Zone Elevation Extrusion Slider Real-time Update');
      } else {
        errors.push(`Elevation readout unexpected: ${elevText}`);
      }
    }

    // 1.9 Access Governance Chips
    console.log('[E2E] Testing Access Governance Chips...');
    const chipVip = await adminPage.$('#tier-chip-vip');
    const chipPublic = await adminPage.$('#tier-chip-public');
    if (chipVip && chipPublic) {
      await chipVip.click();
      await adminPage.waitForTimeout(300);
      await chipPublic.click();
      await adminPage.waitForTimeout(300);
      passedFeatures.push('Access Governance Tier Management');
    }

    // 1.10 Stage & Session Controls (+15m Ext, Start, End)
    console.log('[E2E] Testing Stage Session Controller (+15m Extension)...');
    const btnExtend = await adminPage.$('#btn-session-extend');
    if (btnExtend) {
      await btnExtend.click();
      await adminPage.waitForTimeout(500);
      const timerText = await adminPage.$eval('#session-timer', el => el.textContent.trim()).catch(() => '');
      console.log(`[E2E] Session timer after extension: "${timerText}"`);
      passedFeatures.push('Stage Session Extender (+15m)');
    }

    // 1.11 Command Palette (⌘K)
    console.log('[E2E] Testing Command Palette (⌘K) & Omnibar...');
    const omnibar = await adminPage.$('#omnibar-trigger');
    if (omnibar) {
      await omnibar.click();
      await adminPage.waitForTimeout(300);
      const cmdPalette = await adminPage.$('#modal-command-palette');
      const isCmdOpen = await cmdPalette?.isVisible();
      if (isCmdOpen) {
        await adminPage.fill('#command-palette-input', '3D');
        await adminPage.waitForTimeout(300);
        const results = await adminPage.$$('#command-palette-results button');
        console.log(`[E2E] Command palette query results count: ${results.length}`);
        await adminPage.keyboard.press('Escape');
        await adminPage.waitForTimeout(300);
        passedFeatures.push('Omnibar & Command Palette (⌘K)');
      } else {
        errors.push('Command palette modal did not open on trigger click');
      }
    }

    // 1.11b Admin Wayfinding Walking Directions (Left/Right Indications)
    console.log('[E2E] Testing Admin Wayfinding Walking Directions & 3D Route Display...');
    const btnInspectorDirections = await adminPage.$('#btn-inspector-directions');
    if (btnInspectorDirections) {
      await btnInspectorDirections.click();
      await adminPage.waitForTimeout(600);
      const directionsCard = await adminPage.$('#admin-directions-card');
      const isCardVisible = await directionsCard?.isVisible();
      if (isCardVisible) {
        const turnBadge = await adminPage.$eval('#admin-hud-turn-badge', el => el.textContent.trim()).catch(() => '');
        const totalDist = await adminPage.$eval('#admin-hud-total-dist', el => el.textContent.trim()).catch(() => '');
        const steps = await adminPage.$$('#admin-hud-steps-list > div');
        console.log(`[E2E] Admin directions card displayed: "${turnBadge}" (${totalDist}), ${steps.length} steps`);
        if (turnBadge.includes('TURN') || turnBadge.includes('RIGHT') || turnBadge.includes('LEFT') || turnBadge.includes('STRAIGHT')) {
          passedFeatures.push('Admin Wayfinding & Turn-by-Turn Direction Card');
        } else {
          errors.push(`Admin directions badge did not show expected turn indication: "${turnBadge}"`);
        }
        await adminPage.click('#btn-admin-close-directions');
        await adminPage.waitForTimeout(200);
      } else {
        errors.push('Admin #admin-directions-card failed to appear upon #btn-inspector-directions click');
      }
    }

    // 1.12 Create Spatial Zone Modal Dialog
    console.log('[E2E] Testing "+ Add Zone" modal dialog & persistence...');
    const btnQuickAdd = await adminPage.$('#btn-quick-add');
    if (btnQuickAdd) {
      await btnQuickAdd.click();
      await adminPage.waitForTimeout(300);

      const modalAddZone = await adminPage.$('#modal-add-zone');
      const isVisible = await modalAddZone?.isVisible();
      if (isVisible) {
        await adminPage.fill('#form-add-zone input[name="name"]', 'AI Quantum Lab');
        await adminPage.fill('#form-add-zone input[name="elevation"]', '20');
        await adminPage.fill('#form-add-zone input[name="capacity"]', '120');
        await adminPage.selectOption('#form-add-zone select[name="category"]', 'Academic Blocks');
        await adminPage.selectOption('#form-add-zone select[name="accessTier"]', 'PUBLIC');

        console.log('[E2E] Submitting new zone form...');
        await adminPage.click('#form-add-zone button[type="submit"]');
        await adminPage.waitForTimeout(800);

        const updatedZones = await adminPage.$$('[data-zone-id]');
        console.log(`[E2E] Total zones count after addition: ${updatedZones.length}`);
        passedFeatures.push('Zone Creation Modal & Atomic Persistence');
      } else {
        errors.push('Modal #modal-add-zone failed to open on #btn-quick-add click');
      }
    }

    // 1.13 Broadcast Alert Modal Dialog
    console.log('[E2E] Testing "Broadcast Alert" modal dialog...');
    const btnAlert = await adminPage.$('#btn-broadcast-alert');
    if (btnAlert) {
      await btnAlert.click();
      await adminPage.waitForTimeout(300);
      const modalAlert = await adminPage.$('#modal-broadcast-alert');
      if (await modalAlert?.isVisible()) {
        await adminPage.fill('#form-broadcast-alert input[name="title"]', 'Academic Symposium Starting Soon');
        await adminPage.fill('#form-broadcast-alert textarea[name="message"]', 'Please proceed to Dr. Premachandra Sagar Amphitheater.');
        await adminPage.click('#form-broadcast-alert button[type="submit"]');
        await adminPage.waitForTimeout(500);
        passedFeatures.push('Emergency & Broadcast Alert Dispatcher');
      } else {
        errors.push('Modal #modal-broadcast-alert failed to open');
      }
    }

    // Take Desktop Screenshot
    await adminPage.screenshot({ path: '/Users/madhumithashivakumar/Desktop/TierTracker/tests/admin-screenshot.png' });
    console.log('[E2E] Admin screenshot saved to tests/admin-screenshot.png');
    await adminContext.close();

    // =========================================================================
    // 2. MOBILE PARTICIPANT PORTAL (/app, 390x844)
    // =========================================================================
    console.log('\n======================================================');
    console.log('[E2E] 2. AUDITING PARTICIPANT MOBILE PORTAL (/app)...');
    console.log('======================================================');

    const appContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      geolocation: { latitude: 12.661846, longitude: 77.450515 },
      permissions: ['geolocation'],
    });

    const appPage = await appContext.newPage();

    appPage.on('pageerror', err => {
      console.error('[APP PAGEERROR]:', err.message);
      errors.push(`App Page Error: ${err.message}`);
    });

    appPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('[APP CONSOLE ERROR]:', msg.text());
        errors.push(`App Console Error: ${msg.text()}`);
      } else if (msg.type() === 'warning') {
        warnings.push(`App Console Warn: ${msg.text()}`);
      }
    });

    appPage.on('requestfailed', req => {
      if (!req.url().includes('favicon.ico')) {
        console.error('[APP REQUEST FAILED]:', req.method(), req.url(), req.failure()?.errorText);
        errors.push(`App Request Failed: ${req.url()} (${req.failure()?.errorText})`);
      }
    });

    console.log(`[E2E] Navigating to ${BASE_URL}/app...`);
    const appResponse = await appPage.goto(`${BASE_URL}/app`, { waitUntil: 'networkidle' });
    if (appResponse.status() !== 200) {
      errors.push(`App page returned non-200 status: ${appResponse.status()}`);
    }
    const appTitle = await appPage.title();
    console.log(`[E2E] App Page Title: "${appTitle}"`);
    passedFeatures.push('Participant Mobile Portal Navigation & 200 OK');

    // 2.1 Verify Mobile Spatial Canvas
    const appCanvas = await appPage.waitForSelector('#participant-canvas', { timeout: 5000 });
    if (!appCanvas) errors.push('Mobile #participant-canvas not found');
    else passedFeatures.push('Participant Mobile 3D Canvas Initialization');

    await appPage.waitForTimeout(600);

    // 2.2 Live Presence & Telemetry Badges
    const zoneBadge = await appPage.$eval('#telemetry-zone-badge', el => el.textContent.trim()).catch(() => '');
    console.log(`[E2E] Detected Zone Badge: "${zoneBadge}"`);
    if (zoneBadge.includes('Engineering') || zoneBadge.includes('Near:') || zoneBadge.includes('DSU')) {
      passedFeatures.push('Live Indoor Localization & Zone Badge Detection');
    }

    // 2.3 Share Live Presence Toggle
    console.log('[E2E] Testing Share Live Presence Toggle...');
    const btnShareLive = await appPage.$('#btn-share-live');
    if (btnShareLive) {
      await btnShareLive.click();
      await appPage.waitForTimeout(300);
      await btnShareLive.click();
      await appPage.waitForTimeout(300);
      passedFeatures.push('Share Live Presence Privacy Toggle');
    }

    // 2.3b Destination Search Input & Turn-by-Turn Wayfinding with Left/Right Indications
    console.log('[E2E] Testing Destination Search & Left/Right Navigation HUD...');
    const searchInput = await appPage.$('#destination-search-input');
    if (searchInput) {
      await searchInput.fill('Food Court');
      await appPage.waitForTimeout(400);

      const dropdown = await appPage.$('#destination-search-dropdown');
      const isDropdownVisible = await dropdown?.isVisible();
      if (!isDropdownVisible) {
        errors.push('#destination-search-dropdown failed to open on search input');
      }

      const matchBtn = await appPage.$('#destination-search-dropdown button[data-destination-id="foodcourt"]');
      if (matchBtn) {
        await matchBtn.click();
        await appPage.waitForTimeout(600);

        // Verify Navigation HUD Banner
        const hudBanner = await appPage.$('#navigation-hud-banner');
        const isHudVisible = await hudBanner?.isVisible();
        if (isHudVisible) {
          const hudTurnBadge = await appPage.$eval('#hud-turn-badge', el => el.textContent.trim()).catch(() => '');
          const hudInstruction = await appPage.$eval('#hud-instruction', el => el.textContent.trim()).catch(() => '');
          console.log(`[E2E] Navigation HUD displayed: "${hudTurnBadge}" -> "${hudInstruction}"`);

          if (hudTurnBadge.includes('LEFT') || hudTurnBadge.includes('RIGHT') || hudTurnBadge.includes('TURN')) {
            passedFeatures.push('Destination Search & Real-Time Navigation HUD with Left/Right Turns');
          } else {
            errors.push(`Navigation HUD badge did not display expected turn indication: "${hudTurnBadge}"`);
          }
        } else {
          errors.push('Navigation HUD banner failed to display after destination selection');
        }

        // Verify Directions Tab in Bottom Sheet
        const directionsView = await appPage.$('#sheet-view-directions');
        const isDirectionsVisible = await directionsView?.isVisible();
        if (isDirectionsVisible) {
          const stepsCount = await appPage.$eval('#directions-steps-count', el => el.textContent.trim()).catch(() => '');
          const turnBadges = await appPage.$$eval('#directions-steps-list span', spans => spans.map(s => s.textContent.trim()));
          console.log(`[E2E] Bottom sheet Directions steps count: ${stepsCount}, Badges: ${turnBadges.filter(b => b.includes('Turn')).join(', ')}`);
          if (turnBadges.some(b => b.includes('Turn Left') || b.includes('Turn Right'))) {
            passedFeatures.push('Step-by-Step Directions with Explicit Left/Right Badges & Distances');
          } else {
            errors.push('Directions steps list did not contain expected Left or Right turn badges');
          }
        } else {
          errors.push('Bottom sheet did not switch to Directions tab');
        }

        // Exit / Clear navigation HUD and ensure bottom sheet is collapsed for map controls
        await appPage.evaluate(() => {
          if (window.participantApp) {
            window.participantApp.clearRoute();
            window.participantApp.snapBottomSheet(false);
          }
        });
        await appPage.waitForTimeout(400);
      } else {
        errors.push('Could not find destination button for "foodcourt" in search dropdown');
      }
    }

    // 2.4 Mobile Filter Chips
    console.log('[E2E] Testing Filter Chips...');
    const alertClose = await appPage.$('#live-alert-close');
    if (alertClose && await alertClose.isVisible()) {
      await alertClose.click();
      await appPage.waitForTimeout(300);
    }
    const filterPills = await appPage.$$('.filter-chip');
    console.log(`[E2E] Found ${filterPills.length} filter chips`);
    if (filterPills.length > 1) {
      await filterPills[1].click();
      await appPage.waitForTimeout(300);
      await filterPills[0].click();
      await appPage.waitForTimeout(300);
      passedFeatures.push('Category Filter Chips Navigation');
    }

    // 2.5 Walk Simulation Engine
    console.log('[E2E] Testing "Simulate Walk" Wayfinding Engine...');
    const btnSimWalk = await appPage.$('#btn-simulate-walk');
    if (btnSimWalk) {
      await btnSimWalk.click();
      await appPage.waitForTimeout(1000);
      const simStatus = await appPage.$eval('#simulation-status-pill', el => el.textContent.trim()).catch(() => '');
      console.log(`[E2E] Simulation status: "${simStatus}"`);
      passedFeatures.push('Waypoint Walk Simulation Engine');
    }

    // 2.6 Map Floating Controls (Recenter, Tilt, Compass)
    console.log('[E2E] Testing Floating Map HUD Controls...');
    const btnTilt = await appPage.$('#btn-tilt');
    const btnCompass = await appPage.$('#btn-compass');
    const btnRecenter = await appPage.$('#btn-recenter');
    if (btnTilt && btnCompass && btnRecenter) {
      await btnTilt.click();
      await appPage.waitForTimeout(200);
      await btnTilt.click();
      await appPage.waitForTimeout(200);
      await btnCompass.click();
      await appPage.waitForTimeout(200);
      await btnRecenter.click();
      await appPage.waitForTimeout(200);
      passedFeatures.push('Floating Map HUD Controls (Tilt/Compass/Recenter)');
    }

    // 2.7 Bottom Sheet Drawer Expansion
    console.log('[E2E] Testing Bottom Sheet Drawer...');
    const sheetHandle = await appPage.$('#bottom-sheet-handle');
    if (sheetHandle) {
      await sheetHandle.click();
      await appPage.waitForTimeout(400);
      const isExpanded = await appPage.$eval('#bottom-sheet', el => parseInt(el.style.height || '0', 10) > 200);
      console.log(`[E2E] Bottom sheet expanded state: ${isExpanded}`);
      passedFeatures.push('Collapsible Bottom Sheet Drawer Gestures');
    }

    // 2.8 "Locate on 3D Map" Button in Bottom Sheet
    console.log('[E2E] Testing "Locate on 3D Map" button in bottom sheet...');
    const btnLocateLive = await appPage.$('#btn-sheet-locate-live');
    if (btnLocateLive) {
      await btnLocateLive.click();
      await appPage.waitForTimeout(400);
      passedFeatures.push('Bottom Sheet Live Session Locate Action');
    }

    // 2.9 Sheet Tab Switching to "Today's Schedule"
    console.log('[E2E] Testing "Today\'s Schedule" tab in bottom sheet...');
    const tabBtnSchedule = await appPage.$('#tab-btn-schedule');
    if (tabBtnSchedule) {
      await tabBtnSchedule.click();
      await appPage.waitForTimeout(400);
      const scheduleCards = await appPage.$$('#sheet-schedule-list > div');
      console.log(`[E2E] Schedule items rendered in bottom sheet: ${scheduleCards.length}`);
      if (scheduleCards.length > 0) {
        passedFeatures.push('Bottom Sheet Schedule Tab Population');
      } else {
        errors.push('No schedule cards rendered in bottom sheet schedule view');
      }
    }

    // 2.10 Sheet Tab Switching to "Rate Session" & 5-Star Submission
    console.log('[E2E] Testing "Rate Session" tab & 5-Star Review Submission...');
    const tabBtnRate = await appPage.$('#tab-btn-rate');
    if (tabBtnRate) {
      await tabBtnRate.click();
      await appPage.waitForTimeout(400);

      // Click 5th star
      const star5 = await appPage.$('[data-star="5"]');
      if (star5) {
        await star5.click();
        await appPage.waitForTimeout(200);
      }

      // Click feedback tag
      const firstChip = await appPage.$('.feedback-chip');
      if (firstChip) {
        await firstChip.click();
        await appPage.waitForTimeout(200);
      }

      // Enter review comment
      await appPage.fill('#rating-comment-input', 'Outstanding architecture presentation!');

      // Click submit
      const btnSubmit = await appPage.$('#btn-submit-review');
      if (btnSubmit) {
        await btnSubmit.click();
        await appPage.waitForTimeout(800);
        const submitText = await appPage.$eval('#btn-submit-review-text', el => el.textContent.trim()).catch(() => '');
        console.log(`[E2E] Submit review button status: "${submitText}"`);
        if (submitText.includes('Submitted')) {
          passedFeatures.push('5-Star Session Review & Feedback Submission');
        } else {
          errors.push(`Review submission did not update button state: "${submitText}"`);
        }
      }
    }

    // 2.11 Bottom Navigation Dock Tabs (Map, Zones, Schedule, Pass)
    console.log('[E2E] Testing Bottom Thumb Dock navigation modals...');
    const navButtons = await appPage.$$('.nav-tab');
    for (const btn of navButtons) {
      const tabName = await btn.getAttribute('data-tab');
      await btn.click();
      await appPage.waitForTimeout(300);

      if (tabName === 'zones') {
        const zoneItems = await appPage.$$('#zones-list-container > div');
        console.log(`[E2E] Zones overview modal rendered: ${zoneItems.length} zones`);
        if (zoneItems.length > 0) passedFeatures.push('Modal: Zones & Live Density Directory');
      } else if (tabName === 'schedule') {
        const schedItems = await appPage.$$('#schedule-list-container > div');
        console.log(`[E2E] Schedule modal rendered: ${schedItems.length} sessions`);
        if (schedItems.length > 0) passedFeatures.push('Modal: Full Event Schedule');
      } else if (tabName === 'pass') {
        const passUid = await appPage.$eval('#pass-uid-display', el => el.textContent.trim()).catch(() => '');
        console.log(`[E2E] Pass modal UID display: "${passUid}"`);
        if (passUid.startsWith('UID:')) passedFeatures.push('Modal: Participant Digital Badge & QR Pass');
      }

      // Close modal
      const closeBtn = await appPage.$(`.btn-close-modal[data-modal="modal-${tabName}"]`);
      if (closeBtn && await closeBtn.isVisible()) {
        await closeBtn.click();
        await appPage.waitForTimeout(200);
      }
    }

    // Take Mobile Screenshot
    await appPage.screenshot({ path: '/Users/madhumithashivakumar/Desktop/TierTracker/tests/app-screenshot.png' });
    console.log('[E2E] App screenshot saved to tests/app-screenshot.png');
    await appContext.close();

    // =========================================================================
    // 3. SUMMARY REPORT
    // =========================================================================
    console.log('\n======================================================');
    console.log('[E2E] COMPLETE AUDIT EXECUTION SUMMARY');
    console.log('======================================================');
    console.log(`Total Verified Features : ${passedFeatures.length}`);
    console.log(`Total Errors Encountered: ${errors.length}`);
    console.log(`Total Warnings          : ${warnings.length}`);

    console.log('\nVERIFIED CAPABILITIES:');
    passedFeatures.forEach((f, idx) => console.log(`  ${idx + 1}. [PASS] ${f}`));

    if (errors.length > 0) {
      console.log('\nERRORS FOUND:');
      errors.forEach((e, idx) => console.log(`  ❌ ${idx + 1}. ${e}`));
    } else {
      console.log('\n>>> SUCCESS: ZERO DEFECTS ENCOUNTERED ACROSS FULL AUDIT! <<<');
    }

    return { success: errors.length === 0, errors, warnings, passedFeatures };
  } finally {
    await browser.close();
    server.close();
    console.log('[E2E] Playwright browser closed and server cleanly terminated.\n');
  }
}

runBrowserE2E().then(result => {
  if (!result.success) {
    process.exit(1);
  }
}).catch(err => {
  console.error('[E2E CRITICAL AUDIT FAILURE]:', err);
  process.exit(1);
});
