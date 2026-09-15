// src/features/maps.js

/**
 * ============================================================================
 * MAPS & GEOSPATIAL FEATURES (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * MODULE ARCHITECTURE & RESPONSIBILITIES:
 * 
 * 1. maps/mapState.js
 *    - Centralized state container for shared Google Map instances, markers,
 *      directions services, active navigation target coordinates, and
 *      tracking history.
 * 
 * 2. maps/mapRidersRadar.js
 *    - Admin and Team Lead exclusive live radar.
 *    - `openFindRidersModal` & `closeFindRidersModal`: Controls the radar modal.
 *    - `refreshFindRidersMap`: Plots active riders on the map with color-coded
 *      status markers (Green: Available, Red: Catering, Yellow: Break/Cooldown).
 * 
 * 3. maps/mapPicker.js
 *    - Universal interactive coordinate picker and location selector.
 *    - `initMapSearchAutocomplete`: Google Places search input integration.
 *    - `openMapPicker`: Calibrates device GPS or profile coordinates and opens
 *      the interactive map with a center pin for forms, chats, or registration.
 *    - `confirmGoogleMapPin`: Dispatches the chosen coordinates back to the
 *      active caller context (form input, customer chat, rider chat, or registration).
 * 
 * 4. maps/mapTracking.js
 *    - End-to-end customer delivery tracking system via URL param (?track=KEY).
 *    - `copyCustomerTrackingLink` & `refreshCustomerTrackingLink`: Generates
 *      personalized customer tracking links and clipboard share messages.
 *    - `checkAndInitTrackPortal` & `startCustomerLocationSharing`: Customer-facing
 *      portal to broadcast real-time GPS coordinates to Firebase.
 *    - `openLiveCustomerMap`: Rider-facing map plotting turn-by-turn driving
 *      directions from rider location to customer location.
 *    - `openExternalGoogleNav`: Deep-links coordinates to native Google Maps navigation.
 * 
 * 5. maps/mapCalculation.js
 *    - Delivery fee and distance measurement system via URL param (?mapcalc=KEY).
 *    - `openMapCalcBoardModal` & `closeMapCalcBoardModal`: Board dialog controls.
 *    - `confirmGenerateMapCalcLink` & `copyMapCalcCustomerMessage`: Link creation.
 *    - `checkAndInitMapCalcPortal` & `startMapCalcLocationSharing`: Portal sharing.
 *    - `openMapCalcRoute` & `viewMapCalcRoute`: Plots route from Hub to customer.
 *    - `renderMapCalcBoardList` & `deleteMapCalcRecord`: Record management.
 * ============================================================================
 */

import * as mapStateModule from './maps/mapState.js';
import * as mapRidersRadar from './maps/mapRidersRadar.js';
import * as mapPicker from './maps/mapPicker.js';
import * as mapTracking from './maps/mapTracking.js';
import * as mapCalculation from './maps/mapCalculation.js';

export * from './maps/mapState.js';
export * from './maps/mapRidersRadar.js';
export * from './maps/mapPicker.js';
export * from './maps/mapTracking.js';
export * from './maps/mapCalculation.js';

// Global window attachments for backward compatibility with HTML template onclicks
if (typeof window !== 'undefined') {
    const modules = [
        mapStateModule,
        mapRidersRadar,
        mapPicker,
        mapTracking,
        mapCalculation
    ];

    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    window[fn] = mod[fn];
                }
            });
        }
    });

    // Explicit backward compatibility aliases
    window.startMapCalcForCustomer = mapCalculation.confirmGenerateMapCalcLink;
    window.fetchAndRenderMapCalculations = mapCalculation.renderMapCalcBoardList;
    window.viewMapCalcRoute = mapCalculation.openMapCalcRoute;
    window.deleteMapCalculation = mapCalculation.deleteMapCalcRecord;
}