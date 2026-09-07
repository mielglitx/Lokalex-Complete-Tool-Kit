// src/features/maps/mapState.js

export const mapState = {
    googleMapObj: null,
    custGoogleMapObj: null,
    custMarkerObj: null,
    mapDirectionsService: null,
    mapDirectionsRenderer: null,
    activeNavTargetCoords: null,

    findRidersMapObj: null,
    findRidersMarkers: [],

    mapSearchAutocomplete: null,
    mapPickerContext: 'form', // 'form', 'chat', 'rider-chat', 'registration'
    selectedMapLat: 0,
    selectedMapLng: 0,

    trackingHistory: JSON.parse(localStorage.getItem('lokalex_tracking_history') || '{}')
};

export function saveTrackingHistory() {
    try {
        localStorage.setItem('lokalex_tracking_history', JSON.stringify(mapState.trackingHistory));
    } catch (e) {}
}