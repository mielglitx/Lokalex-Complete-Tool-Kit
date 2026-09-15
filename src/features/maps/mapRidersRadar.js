// src/features/maps/mapRidersRadar.js
import { globalState } from '../../store/state.js';
import { HUB_LOCATION } from '../../config/constants.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { canManageRoster } from '../roster/rosterUtils.js';
import { mapState } from './mapState.js';

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

export function refreshFindRidersMap() {
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
        else if (r.status === 'Break') breakCount++;
    });

    if (summaryEl) {
        summaryEl.innerHTML = `
            <div><span class="text-green-400 font-bold">${availCount}</span> Available</div>
            <div><span class="text-red-400 font-bold">${caterCount}</span> Catering</div>
            <div><span class="text-yellow-400 font-bold">${breakCount}</span> On Break</div>
        `;
    }

    if (typeof google === 'undefined' || !google.maps || !mapContainer) {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
        return;
    }

    const hubCenter = { lat: HUB_LOCATION.lat, lng: HUB_LOCATION.lng };

    if (!mapState.findRidersMapObj) {
        mapState.findRidersMapObj = new google.maps.Map(mapContainer, {
            center: hubCenter,
            zoom: 14,
            disableDefaultUI: false,
            zoomControl: true
        });
    }

    mapState.findRidersMarkers.forEach(m => m.setMap(null));
    mapState.findRidersMarkers = [];

    const bounds = new google.maps.LatLngBounds();
    let markerCount = 0;

    activeRiders.forEach(r => {
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lng);

        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
            const pos = { lat, lng };
            bounds.extend(pos);
            markerCount++;

            let iconUrl = "http://maps.google.com/mapfiles/ms/icons/green-dot.png";
            if (r.status === 'Catering') iconUrl = "http://maps.google.com/mapfiles/ms/icons/red-dot.png";
            else if (r.status === 'Break' || r.status === 'Cooldown') iconUrl = "http://maps.google.com/mapfiles/ms/icons/yellow-dot.png";

            const marker = new google.maps.Marker({
                position: pos,
                map: mapState.findRidersMapObj,
                title: `${r.riderName || 'Rider'} (${r.status})`,
                icon: iconUrl
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `<div class="p-1 text-xs text-black font-bold">
                    <strong>${escapeHtml(r.riderName || 'Rider')}</strong><br>
                    Status: <span class="uppercase">${escapeHtml(r.status)}</span><br>
                    ${r.customerName ? `Catering: ${escapeHtml(r.customerName)}` : ''}
                </div>`
            });

            marker.addListener('click', () => {
                infoWindow.open(mapState.findRidersMapObj, marker);
            });

            mapState.findRidersMarkers.push(marker);
        }
    });

    if (markerCount > 0) {
        mapState.findRidersMapObj.fitBounds(bounds);
    } else {
        mapState.findRidersMapObj.setCenter(hubCenter);
    }

    setTimeout(() => {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    }, 500);
}