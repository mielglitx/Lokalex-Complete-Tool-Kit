// src/features/directory/directoryStorage.js

/**
 * ============================================================================
 * DIRECTORY STORAGE & OFFLINE PERSISTENCE ENGINE
 * ============================================================================
 * 
 * Description:
 * Manages synchronous LocalStorage and asynchronous IndexedDB caching for all
 * directory entities (customers, stores, and multi-municipality delivery rates):
 * - Guarantees default barangays are seeded with complete origin and destination
 *   routing metadata (`originMunicipality: "Camiling"`, `municipality: "Camiling"`,
 *   and unique composite keys), preventing fallback overwrites.
 * - Restores offline records across application view navigations and reloads.
 * ============================================================================
 */

import { globalState } from '../../store/state.js';
import { BARANGAY_DATA } from '../../config/constants.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { idbGet, idbSet } from '../../utils/storageEngine.js';

export const CACHE_KEY = 'lokalex_directory_cache_v2';
export const IDB_KEY = 'all_directory_records';

/**
 * Persists active global directory records into LocalStorage and IndexedDB.
 */
export function saveDirectoryCache() {
    try {
        if (globalState.records && globalState.records.length > 0) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(globalState.records));
            idbSet('directory', IDB_KEY, globalState.records).catch(() => {});
        }
    } catch (e) {}
}

/**
 * Hydrates state synchronously from LocalStorage, fills fallback barangays with
 * complete routing keys, and asynchronously hydrates deeper records from IndexedDB.
 */
export function loadDirectoryCache(onHydrated) {
    try {
        const saved = localStorage.getItem(CACHE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                globalState.records = parsed;
            }
        }

        idbGet('directory', IDB_KEY).then(idbRecords => {
            if (Array.isArray(idbRecords) && idbRecords.length > 0) {
                if (!globalState.records || idbRecords.length > globalState.records.length) {
                    globalState.records = idbRecords;
                    if (typeof onHydrated === 'function') {
                        onHydrated();
                    } else if (typeof window.renderDirectoryList === 'function') {
                        const currentViewEl = document.querySelector('main > section:not(.hidden)');
                        if (currentViewEl && currentViewEl.id === 'view-directory') {
                            window.renderDirectoryList();
                        }
                    }
                }
            }
        }).catch(() => {});

        const hasBarangays = (globalState.records || []).some(r => r.type === 'barangays');
        if (!hasBarangays) {
            const defaultBarangays = BARANGAY_DATA.map(b => {
                const cleanKey = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                return {
                    name: b.name,
                    barangay: b.name,
                    originMunicipality: "Camiling",
                    municipality: "Camiling",
                    compositeKey: `camiling_camiling_${cleanKey}`,
                    nationality: "Philippines",
                    region: "Region III (Central Luzon)",
                    contact: "",
                    address: `₱${b.fee.toFixed(2)}`,
                    rate: `₱${b.fee.toFixed(2)}`,
                    lat_lon_link: "",
                    type: 'barangays',
                    recorded_by: "System",
                    recorded_at: getLocalTodayStr()
                };
            });
            globalState.records = [...(globalState.records || []), ...defaultBarangays];
            saveDirectoryCache();
        }
    } catch (e) {
        if (!globalState.records) globalState.records = [];
    }
}

// REMARKS: DIRECTORY_STORAGE_COMPOSITE_METADATA_CACHING_V2_COMPLETE