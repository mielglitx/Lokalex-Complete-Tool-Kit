// src/features/directory.js
/**
 * ============================================================================
 * DIRECTORY MODULE (FACADE / BARREL)
 * ============================================================================
 * This file serves as the unified entry point and facade for the Directory
 * feature. It connects the following modular sub-components:
 *
 * 1. directoryPermissions.js:
 *    - Role & Access Control: Evaluates whether a rider/user possesses admin rights.
 *    - Key Exports: checkAdminAccess()
 *
 * 2. directoryStorage.js:
 *    - Persistence & Hydration: Manages LocalStorage and IndexedDB offline cache,
 *      and populates fallback barangay rates.
 *    - Key Exports: saveDirectoryCache(), loadDirectoryCache(), CACHE_KEY, IDB_KEY
 *
 * 3. directorySync.js:
 *    - Data Synchronization: Handles background silent syncing from Firebase
 *      and explicit manual two-way synchronization via Google Apps Script and Firebase.
 *    - Key Exports: silentSyncDirectory(), syncData()
 *
 * 4. directoryUi.js:
 *    - View Rendering & Interactive Scrubber: Handles DOM list construction, 
 *      sorting, copy actions, search queries, scroll-aware search badge minimization,
 *      floating search overlay synchronization, and elastic alphabet scrubber distortion.
 *    - Key Exports: openDirectory(), renderDirectoryList(), setupAlphabetScrubber(),
 *      filterDirectoryRecords(), clearDirectorySearch(), copyBarangayRate(), getSectionLetter(),
 *      minimizeDirectorySearch(), restoreDirectorySearch(), expandDirectorySearch(),
 *      syncAndFilterFloatingSearch(), initDirectoryScrollListener()
 *
 * 5. directoryForm.js:
 *    - Record Mutations & GPS Validation: Coordinates add/edit forms, 
 *      GPS accuracy calibration before saving, and record removal.
 *    - Key Exports: openForm(), editDirectoryRecord(), submitForm(),
 *      promptDeleteDirectoryRecord(), executeDeleteDirectoryRecord()
 *
 * 6. directoryMap.js:
 *    - Spatial Pinning: Initializes the Google Maps hybrid viewport and captures
 *      dragged pin coordinates.
 *    - Key Exports: openMapPicker(), initGoogleMap(), confirmGoogleMapPin()
 * ============================================================================
 */

// 1. Permissions
export { checkAdminAccess } from './directory/directoryPermissions.js';

// 2. Storage & Cache
export {
    CACHE_KEY,
    IDB_KEY,
    saveDirectoryCache,
    loadDirectoryCache
} from './directory/directoryStorage.js';

// 3. Synchronization
export {
    silentSyncDirectory,
    syncData
} from './directory/directorySync.js';

// 4. UI & Interactive Scrubber & Scroll-Aware Search
export {
    getSectionLetter,
    openDirectory,
    filterDirectoryRecords,
    clearDirectorySearch,
    copyBarangayRate,
    renderDirectoryList,
    setupAlphabetScrubber,
    minimizeDirectorySearch,
    restoreDirectorySearch,
    expandDirectorySearch,
    syncAndFilterFloatingSearch,
    initDirectoryScrollListener
} from './directory/directoryUi.js';

// 5. Form & Mutators
export {
    openForm,
    editDirectoryRecord,
    promptDeleteDirectoryRecord,
    executeDeleteDirectoryRecord,
    submitForm
} from './directory/directoryForm.js';

// 6. Map Picker
export {
    openMapPicker,
    initGoogleMap,
    confirmGoogleMapPin
} from './directory/directoryMap.js';

// Internal module imports for bootstrapping and global registration
import { checkAdminAccess } from './directory/directoryPermissions.js';
import { saveDirectoryCache, loadDirectoryCache } from './directory/directoryStorage.js';
import { silentSyncDirectory, syncData } from './directory/directorySync.js';
import {
    openDirectory,
    filterDirectoryRecords,
    clearDirectorySearch,
    copyBarangayRate,
    renderDirectoryList,
    minimizeDirectorySearch,
    restoreDirectorySearch,
    expandDirectorySearch,
    syncAndFilterFloatingSearch,
    initDirectoryScrollListener
} from './directory/directoryUi.js';
import {
    openForm,
    editDirectoryRecord,
    promptDeleteDirectoryRecord,
    executeDeleteDirectoryRecord,
    submitForm
} from './directory/directoryForm.js';
import {
    openMapPicker,
    confirmGoogleMapPin
} from './directory/directoryMap.js';

// Initialize cache hydration immediately upon evaluation
loadDirectoryCache();

// Listen for view navigation changes to manage DOM rendering, scroll listeners, and search cleanup
window.addEventListener('viewChanged', (e) => {
    if (e.detail === 'view-directory') {
        renderDirectoryList();
        initDirectoryScrollListener();
    } else {
        // Teardown: clear search inputs, reset clear buttons, and restore search overlay state
        const searchInput = document.getElementById('search-input');
        const floatingInput = document.getElementById('floating-search-input');
        const clearBtn = document.getElementById('clear-search-btn');
        const floatingClearBtn = document.getElementById('floating-clear-search-btn');

        if (searchInput) searchInput.value = '';
        if (floatingInput) floatingInput.value = '';

        if (clearBtn) clearBtn.classList.add('hidden');
        if (floatingClearBtn) floatingClearBtn.classList.add('hidden');

        restoreDirectorySearch();
    }
});

// Attach APIs to the window object to preserve inline onclick HTML attributes
if (typeof window !== 'undefined') {
    window.openDirectory = openDirectory;
    window.syncData = syncData;
    window.silentSyncDirectory = silentSyncDirectory;
    window.filterDirectoryRecords = filterDirectoryRecords;
    window.clearDirectorySearch = clearDirectorySearch;
    window.minimizeDirectorySearch = minimizeDirectorySearch;
    window.restoreDirectorySearch = restoreDirectorySearch;
    window.expandDirectorySearch = expandDirectorySearch;
    window.syncAndFilterFloatingSearch = syncAndFilterFloatingSearch;
    window.initDirectoryScrollListener = initDirectoryScrollListener;
    window.openForm = openForm;
    window.editDirectoryRecord = editDirectoryRecord;
    window.promptDeleteDirectoryRecord = promptDeleteDirectoryRecord;
    window.executeDeleteDirectoryRecord = executeDeleteDirectoryRecord;
    window.submitForm = submitForm;
    window.openMapPicker = openMapPicker;
    window.confirmGoogleMapPin = confirmGoogleMapPin;
    window.copyBarangayRate = copyBarangayRate;
    window.loadDirectoryCache = loadDirectoryCache;
    window.saveDirectoryCache = saveDirectoryCache;
    window.checkAdminAccess = checkAdminAccess;
    window.renderDirectoryList = renderDirectoryList;
}