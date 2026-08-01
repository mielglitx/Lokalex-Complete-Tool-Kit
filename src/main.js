// Append/Update at the bottom of src/features/maps.js

let findRidersMapObj = null;
let findRidersMarkers = [];

export function openFindRidersModal() {
    const modal = document.getElementById('find-riders-modal');
    if (!modal) {
        showToast("⚠️ find-riders-modal missing from index.html");
        return;
    }
    modal.classList.remove('hidden');
    renderFindRidersMap();
}

export function closeFindRidersModal() {
    const modal = document.getElementById('find-riders-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderFindRidersMap() {
    if (typeof google === 'undefined' || !google.maps) return;

    const container = document.getElementById('find-riders-google-map');
    if (!container) return;

    // Clear previous markers
    findRidersMarkers.forEach(m => m.setMap(null));
    findRidersMarkers = [];

    const roster = globalState.rosterMembers || [];
    const logins = globalState.globalLogins || [];

    // Filter ONLY active riders: Available, Catering, Break
    const activeRiders = roster.filter(m => ['Available', 'Catering', 'Break'].includes(m.status));

    let countAvail = 0, countCater = 0, countBreak = 0;
    const bounds = new google.maps.LatLngBounds();
    let hasValidCoords = false;

    activeRiders.forEach(r => {
        if (r.status === 'Available') countAvail++;
        else if (r.status === 'Catering') countCater++;
        else if (r.status === 'Break') countBreak++;

        let lat = parseFloat(r.lat);
        let lng = parseFloat(r.lng);

        // Fallback: parse location link from logins if coordinates aren't directly in roster
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
            const rName = (r.riderName || r.name || "").toLowerCase();
            const userLogin = logins.slice().reverse().find(l => {
                const lName = (l.riderName || "").toLowerCase();
                return (lName && lName === rName) && l.location;
            });

            if (userLogin && userLogin.location) {
                const match = userLogin.location.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
                if (match) {
                    lat = parseFloat(match[1]);
                    lng = parseFloat(match[2]);
                }
            }
        }

        if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
            hasValidCoords = true;
            const pos = { lat, lng };
            bounds.extend(pos);

            let iconUrl = "http://maps.google.com/mapfiles/ms/icons/green-dot.png";
            if (r.status === 'Catering') iconUrl = "http://maps.google.com/mapfiles/ms/icons/red-dot.png";
            else if (r.status === 'Break') iconUrl = "http://maps.google.com/mapfiles/ms/icons/yellow-dot.png";

            const rNameDisplay = r.riderName || r.name || "Rider";
            const custInfo = r.customerName ? ` (${r.customerName})` : "";

            const marker = new google.maps.Marker({
                position: pos,
                title: `${rNameDisplay} - ${r.status}${custInfo}`,
                icon: { url: iconUrl }
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `<div style="color:black; font-weight:bold; font-size:12px; padding:2px;">
                    <div>🛵 ${escapeHtml(rNameDisplay)}</div>
                    <div style="font-size:10px; color:#555;">Status: ${escapeHtml(r.status)}${escapeHtml(custInfo)}</div>
                </div>`
            });

            marker.addListener('click', () => {
                infoWindow.open(findRidersMapObj, marker);
            });

            findRidersMarkers.push(marker);
        }
    });

    const defaultCenter = HUB_LOCATION || { lat: 15.6881, lng: 120.4144 };

    if (!findRidersMapObj) {
        findRidersMapObj = new google.maps.Map(container, {
            center: defaultCenter,
            zoom: 14,
            disableDefaultUI: false,
            zoomControl: true
        });
    }

    findRidersMarkers.forEach(m => m.setMap(findRidersMapObj));

    if (hasValidCoords) {
        findRidersMapObj.fitBounds(bounds);
        if (findRidersMarkers.length === 1) {
            findRidersMapObj.setZoom(16);
        }
    } else {
        findRidersMapObj.setCenter(defaultCenter);
        findRidersMapObj.setZoom(14);
    }

    const summaryEl = document.getElementById('find-riders-status-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div><span class="text-green-400 font-bold">🟢 Available:</span> ${countAvail}</div>
            <div><span class="text-red-400 font-bold">🔴 Catering:</span> ${countCater}</div>
            <div><span class="text-yellow-400 font-bold">☕ Break:</span> ${countBreak}</div>
        `;
    }
}

// EXPLICIT WINDOW BINDINGS
window.openFindRidersModal = openFindRidersModal;
window.closeFindRidersModal = closeFindRidersModal;