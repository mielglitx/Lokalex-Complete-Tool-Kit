// src/features/maps/mapRidersRadar.js

/**
 * ============================================================================
 * FIND RIDERS RADAR MODULE (LEAFLET + OPENSTREETMAP)
 * ============================================================================
 * 
 * Description:
 * Admin and Team Lead dispatch radar displaying all active on-duty riders:
 * - Free OpenStreetMap cartographic tile layer with Leaflet rendering.
 * - Color-coded status pins:
 *     • Emerald / Green: Available in queue
 *     • Red / Orange: Catering active order(s)
 *     • Amber / Yellow: On rest break or penalty cooldown
 * - Dynamic interactive popups with rider name, status, and active deliveries.
 * - Automatic bounding calculation to zoom and frame all riders in the viewport.
 * 
 * Update Note:
 * - Migrated from Google Maps to Leaflet.js with custom HTML/SVG marker badges.
 * - Eliminated Google Maps SDK runtime dependencies.
 * ============================================================================
 */

import { globalState } from '../../store/state.js';
import { HUB_LOCATION } from '../../config/constants.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { canManageRoster } from '../roster/rosterUtils.js';
import { mapState, ensureLeafletLoaded } from './mapState.js';

export function openFindRidersModal() {
    if (!canManageRoster()) return showToast("⚠️ Unauthorized access.");

    const modal = document.getElementById('find-riders-modal');
    if (modal) {
        modal.classList.remove('hidden');
        refreshFindRidersMap();
    }
}

export function closeFindRidersModal() {
    const modal = document.getElementById('find-riders-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Creates custom styled HTML pin icons for Leaflet based on rider status.
 */
function createRiderMarkerIcon(status) {
    let pinColor = '#10B981'; // Default: Emerald for Available
    let iconClass = 'fa-motorcycle';

    if (status === 'Catering') {
        pinColor = '#EF4444'; // Red for Catering
        iconClass = 'fa-box';
    } else if (status === 'Break' || status === 'Cooldown') {
        pinColor = '#F59E0B'; // Amber for Break
        iconClass = 'fa-mug-hot';
    }

    const html = `
        <div style="background-color: ${pinColor}; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); border: 2px solid white;">
            <i class="fa-solid ${iconClass}" style="font-size: 14px;"></i>
        </div>
    `;

    return window.L.divIcon({
        className: 'custom-leaflet-rider-pin',
        html: html,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
    });
}

export async function refreshFindRidersMap() {
    const mapContainer = document.getElementById('find-riders-google-map');
    const summaryEl = document.getElementById('find-riders-status-summary');
    const refreshIcon = document.getElementById('find-riders-refresh-icon');

    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    const roster = globalState.rosterMembers || [];
    const activeRiders = roster.filter(m => m.status && m.status !== 'End');

    let availCount = 0;
    let caterCount = 0;
    let breakCount = 0;

    activeRiders.forEach(r => {
        if (r.status === 'Available') availCount++;
        else if (r.status === 'Catering') caterCount++;
        else if (r.status === 'Break' || r.status === 'Cooldown') breakCount++;
    });

    if (summaryEl) {
        summaryEl.innerHTML = `
            <div><span class="text-green-400 font-bold">${availCount}</span> Available</div>
            <div><span class="text-red-400 font-bold">${caterCount}</span> Catering</div>
            <div><span class="text-yellow-400 font-bold">${breakCount}</span> On Break</div>
        `;
    }

    await ensureLeafletLoaded();
    if (!mapContainer || !window.L) {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
        return;
    }

    const hubCenter = [HUB_LOCATION.lat, HUB_LOCATION.lng];

    if (!mapState.findRidersMapObj) {
        mapState.findRidersMapObj = window.L.map(mapContainer, {
            center: hubCenter,
            zoom: 14,
            zoomControl: true,
            attributionControl: false
        });
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(mapState.findRidersMapObj);
    } else {
        setTimeout(() => {
            if (mapState.findRidersMapObj) {
                mapState.findRidersMapObj.invalidateSize();
            }
        }, 150);
    }

    // Clear existing rider markers from radar
    if (mapState.findRidersMarkers) {
        mapState.findRidersMarkers.forEach(m => mapState.findRidersMapObj.removeLayer(m));
    }
    mapState.findRidersMarkers = [];

    const latLngList = [];

    activeRiders.forEach(r => {
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lng);

        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
            const pos = [lat, lng];
            latLngList.push(pos);

            const icon = createRiderMarkerIcon(r.status);
            const marker = window.L.marker(pos, { icon: icon, title: r.riderName || 'Rider' })
                .addTo(mapState.findRidersMapObj);

            const popupContent = `
                <div style="font-family: inherit; font-size: 11px; padding: 2px;">
                    <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 2px;">${escapeHtml(r.riderName || 'Rider')}</div>
                    <div>Status: <span style="font-weight: 700; text-transform: uppercase;">${escapeHtml(r.status)}</span></div>
                    ${r.customerName ? `<div style="margin-top: 2px; color: #ea580c; font-weight: 600;">Catering: ${escapeHtml(r.customerName)}</div>` : ''}
                    ${r.lastUpdated ? `<div style="font-size: 9px; color: #64748b; margin-top: 3px;">Last seen: ${escapeHtml(r.lastUpdated)}</div>` : ''}
                </div>
            `;
            marker.bindPopup(popupContent);
            mapState.findRidersMarkers.push(marker);
        }
    });

    // Auto-fit bounds to display all riders or center on Hub
    if (latLngList.length > 0) {
        const bounds = window.L.latLngBounds(latLngList);
        mapState.findRidersMapObj.fitBounds(bounds, { padding: [40, 40] });
    } else {
        mapState.findRidersMapObj.setView(hubCenter, 14);
    }

    setTimeout(() => {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    }, 400);
}

// REMARKS: MAP_RIDERS_RADAR_LEAFLET_OSM_CUSTOM_ICONS_V1_COMPLETE