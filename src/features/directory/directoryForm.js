// src/features/directory/directoryForm.js

/**
 * ============================================================================
 * DIRECTORY FORM & COMPOSITE ROUTING RATE CONTROLLER
 * ============================================================================
 * 
 * Description:
 * Coordinates record mutations, location hierarchy cascading, and reward awards:
 * - Multi-Branch Origin Isolation: Enforces `originMunicipality` on all delivery
 *   rate records (defaulting to Camiling for legacy data), preventing price collisions
 *   across regional hubs.
 * - Composite Database Keying: Generates keys using `origin_destination_barangay`
 *   to ensure distinct pricing matrices when multiple branches serve the same areas.
 * - Autonomous User Location Detection: Inspects device timezone, GPS coordinates,
 *   and browser locale to select the user's home country by default.
 * - Global Sovereign Nations Catalog: Generates all 240+ world countries using
 *   the standard `Intl.DisplayNames` engine and REST Countries API.
 * - PSGC API Cascading: Dynamically retrieves Philippine regions, municipalities,
 *   and barangays without hardcoded lists, utilizing a 24-hour cache.
 * - Dynamic Registration Incentive: Awards configured directory credits for new entries.
 * ============================================================================
 */

import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { API_URL, BARANGAY_DATA } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { switchView, goBack } from '../../ui/router.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { calibrateGPS } from '../auth/index.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { checkAdminAccess } from './directoryPermissions.js';
import { saveDirectoryCache } from './directoryStorage.js';
import { renderDirectoryList, openDirectory, updateRosterCreditsDisplay } from './directoryUi.js';

let editingRecord = null;

// IN-MEMORY MAPS FOR PSGC CODES TO SUPPORT RAPID CASCADING
let psgcRegionCodeMap = new Map();
let psgcCityMunCodeMap = new Map();

const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

// COMPLETE ISO-3166-1 ALPHA-2 COUNTRY CODES FOR INSTANT NATIVE RESOLUTION
const ISO_COUNTRY_CODES = [
    "AF","AL","DZ","AS","AD","AO","AI","AQ","AG","AR","AM","AW","AU","AT","AZ",
    "BS","BH","BD","BB","BY","BE","BZ","BJ","BM","BT","BO","BA","BW","BR","IO",
    "BN","BG","BF","BI","CV","KH","CM","CA","KY","CF","TD","CL","CN","CX","CC",
    "CO","KM","CG","CD","CK","CR","CI","HR","CU","CW","CY","CZ","DK","DJ","DM",
    "DO","EC","EG","SV","GQ","ER","EE","SZ","ET","FK","FO","FJ","FI","FR","GF",
    "PF","TF","GA","GM","GE","DE","GH","GI","GR","GL","GD","GP","GU","GT","GG",
    "GN","GW","GY","HT","VA","HN","HK","HU","IS","IN","ID","IR","IQ","IE","IM",
    "IL","IT","JM","JP","JE","JO","KZ","KE","KI","KP","KR","KW","KG","LA","LV",
    "LB","LS","LR","LY","LI","LT","LU","MO","MG","MW","MY","MV","ML","MT","MH",
    "MQ","MR","MU","YT","MX","FM","MD","MC","MN","ME","MS","MA","MZ","MM","NA",
    "NR","NP","NL","NC","NZ","NI","NE","NG","NU","NF","MK","MP","NO","OM","PK",
    "PW","PS","PA","PG","PY","PE","PH","PN","PL","PT","PR","QA","RE","RO","RU",
    "RW","BL","SH","KN","LC","MF","PM","VC","WS","SM","ST","SA","SN","RS","SC",
    "SL","SG","SX","SK","SI","SB","SO","ZA","GS","SS","ES","LK","SD","SR","SJ",
    "SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TK","TO","TT","TN","TR","TM",
    "TC","TV","UG","UA","AE","GB","US","UM","UY","UZ","VU","VE","VN","VG","VI",
    "WF","EH","YE","ZM","ZW"
];

/**
 * Loads cached API data or fetches fresh data from network.
 */
async function fetchWithCache(url, cacheKey) {
    try {
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed.timestamp && (Date.now() - parsed.timestamp < GEO_CACHE_TTL_MS) && parsed.data) {
                return parsed.data;
            }
        }
    } catch(e) {}

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();

    try {
        localStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: data
        }));
    } catch(e) {}

    return data;
}

/**
 * Detects the user's home country using device timezone, GPS coordinates,
 * browser locale, and fast IP geolocation.
 */
export async function detectUserCountry() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (tz.startsWith("Asia/Manila")) return "Philippines";

        const timezoneMap = {
            "Asia/Manila": "Philippines",
            "Asia/Tokyo": "Japan",
            "Asia/Seoul": "South Korea",
            "Asia/Singapore": "Singapore",
            "Asia/Hong_Kong": "Hong Kong",
            "Asia/Bangkok": "Thailand",
            "Asia/Jakarta": "Indonesia",
            "Asia/Kuala_Lumpur": "Malaysia",
            "Asia/Taipei": "Taiwan",
            "Asia/Dubai": "United Arab Emirates",
            "Asia/Riyadh": "Saudi Arabia",
            "America/New_York": "United States",
            "America/Chicago": "United States",
            "America/Denver": "United States",
            "America/Los_Angeles": "United States",
            "America/Phoenix": "United States",
            "America/Anchorage": "United States",
            "Pacific/Honolulu": "United States",
            "America/Toronto": "Canada",
            "America/Vancouver": "Canada",
            "America/Edmonton": "Canada",
            "America/Montreal": "Canada",
            "Europe/London": "United Kingdom",
            "Europe/Paris": "France",
            "Europe/Berlin": "Germany",
            "Europe/Rome": "Italy",
            "Europe/Madrid": "Spain",
            "Australia/Sydney": "Australia",
            "Australia/Melbourne": "Australia",
            "Australia/Brisbane": "Australia",
            "Australia/Perth": "Australia",
            "Pacific/Auckland": "New Zealand"
        };

        if (timezoneMap[tz]) return timezoneMap[tz];
    } catch(e) {}

    if (appState.lat && appState.lon) {
        const lat = appState.lat;
        const lon = appState.lon;
        if (lat >= 4.5 && lat <= 21.5 && lon >= 116.5 && lon <= 127.0) {
            return "Philippines";
        }
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        const ipRes = await fetch("https://api.country.is/", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (ipRes.ok) {
            const ipData = await ipRes.json();
            if (ipData && ipData.country) {
                const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
                const resolvedName = regionNames.of(ipData.country);
                if (resolvedName) return resolvedName;
            }
        }
    } catch(e) {}

    try {
        const lang = navigator.language || (navigator.languages && navigator.languages[0]) || "";
        if (lang.includes("-")) {
            const code = lang.split("-")[1].toUpperCase();
            const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
            const resolvedName = regionNames.of(code);
            if (resolvedName) return resolvedName;
        }
    } catch(e) {}

    return "Philippines";
}

/**
 * Loads all sovereign nations using native internationalization and REST Countries API,
 * defaulting to the user's detected location.
 */
export async function loadNationsList(targetSelectedCountry = "") {
    const select = document.getElementById('form-rate-nationality');
    const spinner = document.getElementById('rate-geo-loading-nations');
    if (!select) return;

    if (spinner) spinner.classList.remove('hidden');

    let defaultCountry = targetSelectedCountry;
    if (!defaultCountry) {
        defaultCountry = await detectUserCountry();
    }

    let allCountries = [];

    try {
        const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
        const nameSet = new Set();
        ISO_COUNTRY_CODES.forEach(code => {
            const name = displayNames.of(code);
            if (name) nameSet.add(name);
        });
        allCountries = Array.from(nameSet).sort((a, b) => a.localeCompare(b));
    } catch(e) {
        allCountries = ["Philippines", "United States", "Canada", "United Kingdom", "Australia", "Japan", "Singapore"];
    }

    try {
        const rawCountries = await fetchWithCache(
            "https://restcountries.com/v3.1/all?fields=name,cca2",
            "lokalex_geo_cache_nations"
        );

        if (Array.isArray(rawCountries) && rawCountries.length > 50) {
            const apiNames = rawCountries
                .map(c => c?.name?.common)
                .filter(Boolean);
            const combinedSet = new Set([...allCountries, ...apiNames]);
            allCountries = Array.from(combinedSet).sort((a, b) => a.localeCompare(b));
        }
    } catch(err) {
        console.warn("Notice: REST Countries API unavailable, utilizing native catalog:", err.message);
    }

    const withoutPrioritized = allCountries.filter(n => n !== defaultCountry && n !== "Philippines");
    let sortedList = [];

    if (defaultCountry === "Philippines") {
        sortedList = ["Philippines", ...withoutPrioritized];
    } else {
        sortedList = [defaultCountry, "Philippines", ...withoutPrioritized];
    }

    select.innerHTML = sortedList.map(n => 
        `<option value="${n}" ${n.toLowerCase() === defaultCountry.toLowerCase() ? 'selected' : ''}>${n}</option>`
    ).join('');

    if (spinner) spinner.classList.add('hidden');
    return defaultCountry;
}

/**
 * Loads official Philippine regions dynamically from the PSGC API.
 * Populates suggestive datalist and preselects target region.
 */
export async function loadPsgcRegions(targetRegionName = "", targetMunName = "") {
    const regInput = document.getElementById('form-rate-region');
    const datalist = document.getElementById('form-rate-region-list');
    const spinner = document.getElementById('rate-geo-loading-regions');
    if (!datalist && !regInput) return;

    if (spinner) spinner.classList.remove('hidden');

    try {
        const regions = await fetchWithCache(
            "https://psgc.gitlab.io/api/regions.json",
            "lokalex_geo_cache_regions"
        );

        psgcRegionCodeMap.clear();
        if (datalist) datalist.innerHTML = "";

        let matchedCode = "";
        let defaultCode = "";
        let matchedDisplayName = "";
        let defaultDisplayName = "Region III (Central Luzon)";

        regions.forEach(r => {
            const displayName = r.regionName ? `${r.regionName} (${r.name})` : r.name;
            psgcRegionCodeMap.set(displayName.toLowerCase(), r.code);
            psgcRegionCodeMap.set(displayName, r.code);
            psgcRegionCodeMap.set(r.name.toLowerCase(), r.code);
            psgcRegionCodeMap.set(r.name, r.code);
            if (r.regionName) {
                psgcRegionCodeMap.set(r.regionName.toLowerCase(), r.code);
                psgcRegionCodeMap.set(r.regionName, r.code);
            }

            const isMatch = targetRegionName && (
                targetRegionName.toLowerCase() === displayName.toLowerCase() ||
                targetRegionName.toLowerCase().includes(r.name.toLowerCase()) || 
                (r.regionName && targetRegionName.toLowerCase().includes(r.regionName.toLowerCase()))
            );

            if (isMatch) {
                matchedCode = r.code;
                matchedDisplayName = displayName;
            }
            if (r.code === "030000000" || r.name.toLowerCase().includes("central luzon")) {
                defaultCode = r.code;
                defaultDisplayName = displayName;
            }

            if (datalist) {
                const opt = document.createElement('option');
                opt.value = displayName;
                datalist.appendChild(opt);
            }
        });

        const activeCode = matchedCode || defaultCode;
        const activeName = targetRegionName || matchedDisplayName || defaultDisplayName;

        if (regInput && !regInput.value) {
            regInput.value = activeName;
        } else if (regInput && targetRegionName) {
            regInput.value = targetRegionName;
        }

        if (activeCode) {
            await loadPsgcCitiesMunicipalities(activeCode, targetMunName);
        }
    } catch(err) {
        console.warn("Could not load dynamic PSGC regions:", err);
        if (datalist) {
            datalist.innerHTML = `
                <option value="Region III (Central Luzon)"></option>
                <option value="Region I (Ilocos Region)"></option>
                <option value="NCR (National Capital Region)"></option>
                <option value="Region IV-A (CALABARZON)"></option>
                <option value="Region II (Cagayan Valley)"></option>
            `;
        }
        if (regInput && !regInput.value) {
            regInput.value = targetRegionName || "Region III (Central Luzon)";
        }
        await loadPsgcCitiesMunicipalities("030000000", targetMunName);
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
}

/**
 * Loads cities and municipalities under the chosen region code from the PSGC API.
 * Populates suggestive datalist and preselects target municipality.
 */
export async function loadPsgcCitiesMunicipalities(regionCode, targetMunName = "", targetBrgyName = "") {
    const munInput = document.getElementById('form-rate-municipality');
    const datalist = document.getElementById('form-rate-municipality-list');
    const spinner = document.getElementById('rate-geo-loading-mun');
    if (!regionCode) return;

    if (spinner) spinner.classList.remove('hidden');

    try {
        const list = await fetchWithCache(
            `https://psgc.gitlab.io/api/regions/${regionCode}/cities-municipalities.json`,
            `lokalex_geo_cache_mun_${regionCode}`
        );

        psgcCityMunCodeMap.clear();
        if (datalist) datalist.innerHTML = "";

        list.sort((a, b) => a.name.localeCompare(b.name));

        let matchedCode = "";
        let defaultCode = "";
        let matchedName = "";

        list.forEach(item => {
            psgcCityMunCodeMap.set(item.name.toLowerCase(), item.code);
            psgcCityMunCodeMap.set(item.name, item.code);

            const isMatch = targetMunName && targetMunName.toLowerCase() === item.name.toLowerCase();
            if (isMatch) {
                matchedCode = item.code;
                matchedName = item.name;
            }
            if (item.name.toLowerCase() === "camiling") defaultCode = item.code;

            if (datalist) {
                const opt = document.createElement('option');
                opt.value = item.name;
                datalist.appendChild(opt);
            }
        });

        // Also ensure known serviced municipalities are in map
        if (targetMunName && !matchedCode) {
            matchedCode = psgcCityMunCodeMap.get(targetMunName.toLowerCase()) || "";
        }

        const activeCode = matchedCode || defaultCode || (list[0] ? list[0].code : "");
        const activeName = targetMunName || matchedName || (defaultCode ? "Camiling" : (list[0] ? list[0].name : ""));

        if (munInput && !munInput.value) {
            munInput.value = activeName;
        } else if (munInput && targetMunName) {
            munInput.value = targetMunName;
        }

        if (activeCode) {
            await loadPsgcBarangays(activeCode, targetBrgyName);
        }
    } catch(err) {
        console.warn("Could not load dynamic PSGC cities/municipalities:", err);
        if (datalist) {
            datalist.innerHTML = `
                <option value="Camiling"></option>
                <option value="San Clemente"></option>
                <option value="Santa Ignacia"></option>
                <option value="Paniqui"></option>
                <option value="Mayantoc"></option>
                <option value="Moncada"></option>
                <option value="Gerona"></option>
                <option value="Bayambang"></option>
                <option value="Mangatarem"></option>
                <option value="San Manuel"></option>
            `;
        }
        if (munInput && !munInput.value) {
            munInput.value = targetMunName || "Camiling";
        }
        await loadPsgcBarangays("036905000", targetBrgyName);
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
}

/**
 * Loads all barangays under the chosen city or municipality code from the PSGC API.
 */
export async function loadPsgcBarangays(cityMunCode, targetBrgyName = "") {
    const datalist = document.getElementById('form-rate-barangay-list');
    const brgyInput = document.getElementById('form-rate-barangay');
    const spinner = document.getElementById('rate-geo-loading-brgy');
    if (!datalist || !cityMunCode) return;

    if (spinner) spinner.classList.remove('hidden');

    try {
        const barangays = await fetchWithCache(
            `https://psgc.gitlab.io/api/cities-municipalities/${cityMunCode}/barangays.json`,
            `lokalex_geo_cache_brgy_${cityMunCode}`
        );

        datalist.innerHTML = "";
        barangays.sort((a, b) => a.name.localeCompare(b.name));

        barangays.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.name;
            datalist.appendChild(opt);
        });

        if (targetBrgyName && brgyInput) {
            brgyInput.value = targetBrgyName;
        }
    } catch(err) {
        console.warn("Could not load dynamic PSGC barangays, falling back to local constants:", err);
        datalist.innerHTML = "";
        if (Array.isArray(BARANGAY_DATA)) {
            BARANGAY_DATA.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.name;
                datalist.appendChild(opt);
            });
        }
        if (targetBrgyName && brgyInput) {
            brgyInput.value = targetBrgyName;
        }
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
}

export async function handleRateNationalityChange(nationality) {
    const regInput = document.getElementById('form-rate-region');
    const munInput = document.getElementById('form-rate-municipality');
    const brgyInput = document.getElementById('form-rate-barangay');
    const regList = document.getElementById('form-rate-region-list');
    const munList = document.getElementById('form-rate-municipality-list');
    const brgyList = document.getElementById('form-rate-barangay-list');
    const brgyHint = document.getElementById('form-rate-barangay-hint');

    const isPH = (nationality || "").trim().toLowerCase() === "philippines";

    if (isPH) {
        if (regInput) regInput.placeholder = "Select or type Region name";
        if (munInput) munInput.placeholder = "Select or type Municipality / City name";
        if (brgyInput) brgyInput.placeholder = "Select or type Barangay / District name";
        if (brgyHint) brgyHint.innerText = "Choose from the official list from the PSA PSGC API or type a custom location.";
        await loadPsgcRegions(regInput?.value || "", munInput?.value || "");
    } else {
        if (regInput) regInput.placeholder = `Enter State / Province (${nationality})`;
        if (munInput) munInput.placeholder = `Enter City / Municipality (${nationality})`;
        if (brgyInput) brgyInput.placeholder = "Enter District, Street, or Suburb";
        if (regList) regList.innerHTML = "";
        if (munList) munList.innerHTML = "";
        if (brgyList) brgyList.innerHTML = "";
        if (brgyHint) brgyHint.innerText = "Enter specific delivery district or sub-locality name.";
    }
}

export async function handleRateRegionChange(regionDisplayName) {
    const cleanName = (regionDisplayName || "").trim();
    if (!cleanName) return;

    let code = psgcRegionCodeMap.get(cleanName) || psgcRegionCodeMap.get(cleanName.toLowerCase());

    if (!code) {
        for (const [k, v] of psgcRegionCodeMap.entries()) {
            if (k.toLowerCase().includes(cleanName.toLowerCase()) || cleanName.toLowerCase().includes(k.toLowerCase())) {
                code = v;
                break;
            }
        }
    }

    if (!code) code = "030000000";
    const currentMun = document.getElementById('form-rate-municipality')?.value || "";
    await loadPsgcCitiesMunicipalities(code, currentMun);
}

export async function handleRateMunicipalityChange(municipalityName) {
    const cleanMun = (municipalityName || "").trim();
    if (!cleanMun) return;

    let code = psgcCityMunCodeMap.get(cleanMun.toLowerCase()) || psgcCityMunCodeMap.get(cleanMun);

    if (!code) {
        // Fallback checks for common municipalities
        const commonCodes = {
            "camiling": "036905000",
            "san clemente": "036912000",
            "santa ignacia": "036913000",
            "paniqui": "036910000",
            "mayantoc": "036908000",
            "moncada": "036909000",
            "gerona": "036906000",
            "san manuel": "036914000",
            "bayambang": "015511000",
            "mangatarem": "015529000",
            "tarlac city": "036916000"
        };
        code = commonCodes[cleanMun.toLowerCase()];
    }

    if (code) {
        await loadPsgcBarangays(code);
    }
}

export async function openForm(record = null) {
    const isNewCustomerPrefill = Boolean(record && (record.isNew || (!record.compositeKey && (!globalState.records || !globalState.records.some(r => r.name === record.name && r.type === (record.type || 'customers'))))));
    if (isNewCustomerPrefill) {
        editingRecord = null;
    } else {
        editingRecord = record;
    }
    switchView('view-form');

    const warningEl = document.getElementById('edit-warning');
    const warningText = document.getElementById('warning-text');
    const submitBtn = document.getElementById('form-submit-btn');

    const standardFieldsBox = document.getElementById('standard-form-fields');
    const rateFieldsBox = document.getElementById('rate-form-fields');

    const isRates = (globalState.currentType || 'customers') === 'barangays';

    if (isRates) {
        if (standardFieldsBox) standardFieldsBox.classList.add('hidden');
        if (rateFieldsBox) rateFieldsBox.classList.remove('hidden');
    } else {
        if (rateFieldsBox) rateFieldsBox.classList.add('hidden');
        if (standardFieldsBox) standardFieldsBox.classList.remove('hidden');
    }

    if (record) {
        if (isNewCustomerPrefill) {
            if (warningEl) warningEl.classList.add('hidden');
            if (submitBtn) submitBtn.innerText = "SAVE RECORD";
        } else {
            if (warningEl) warningEl.classList.remove('hidden');
            if (warningText) warningText.innerText = `Editing record: ${record.name}`;
            if (submitBtn) submitBtn.innerText = "UPDATE RECORD";
        }

        if (isRates) {
            const originSelect = document.getElementById('form-rate-origin');
            const amountInput = document.getElementById('form-rate-amount');
            const regInput = document.getElementById('form-rate-region');
            const munInput = document.getElementById('form-rate-municipality');
            const brgyInput = document.getElementById('form-rate-barangay');

            // Hydrate Origin Hub
            const resolvedOrigin = record.originMunicipality || globalState.selectedOriginHub || "Camiling";
            if (originSelect) {
                originSelect.value = resolvedOrigin;
            }

            const detectedHomeCountry = await detectUserCountry();
            const resolvedNationality = record.nationality || detectedHomeCountry || "Philippines";
            const resolvedRegion = record.region || "Region III (Central Luzon)";
            const resolvedMunicipality = record.municipality || "Camiling";
            const resolvedBarangay = record.barangay || record.name || "";

            let rateNum = parseFloat((record.rate || record.address || "").replace(/[^0-9.]/g, ''));
            if (amountInput) amountInput.value = !isNaN(rateNum) ? rateNum : "";
            if (regInput) regInput.value = resolvedRegion;
            if (munInput) munInput.value = resolvedMunicipality;
            if (brgyInput) brgyInput.value = resolvedBarangay;

            await loadNationsList(resolvedNationality);
            await handleRateNationalityChange(resolvedNationality);

            if (resolvedNationality.toLowerCase() === "philippines") {
                await loadPsgcRegions(resolvedRegion, resolvedMunicipality);
            }
        } else {
            const nameInput = document.getElementById('form-name');
            const contactInput = document.getElementById('form-contact');
            const addressInput = document.getElementById('form-address');
            const latlonInput = document.getElementById('form-latlon');

            if (nameInput) nameInput.value = record.name || "";
            if (contactInput) contactInput.value = record.contact || "";
            if (addressInput) addressInput.value = record.address || record.rate || "";
            if (latlonInput) latlonInput.value = record.lat_lon_link || "";

            const extraContainer = document.getElementById('form-extra-locations-container');
            if (extraContainer) extraContainer.innerHTML = '';

            if (Array.isArray(record.locations) && record.locations.length > 1) {
                record.locations.slice(1).forEach(loc => {
                    addDirectoryExtraLocationField(loc.label || '', loc.address || '', loc.lat_lon_link || loc.mapPinLink || '');
                });
            }
        }
    } else {
        if (warningEl) warningEl.classList.add('hidden');
        if (submitBtn) submitBtn.innerText = "SAVE RECORD";

        if (isRates) {
            const originSelect = document.getElementById('form-rate-origin');
            const amountInput = document.getElementById('form-rate-amount');
            const regInput = document.getElementById('form-rate-region');
            const munInput = document.getElementById('form-rate-municipality');
            const brgyInput = document.getElementById('form-rate-barangay');

            if (originSelect) {
                const activeHub = (globalState.selectedOriginHub && globalState.selectedOriginHub !== 'ALL') 
                    ? globalState.selectedOriginHub 
                    : "Camiling";
                originSelect.value = activeHub;
            }

            if (amountInput) amountInput.value = "";
            if (brgyInput) brgyInput.value = "";

            // AUTO-FILL DESTINATION REGION AND MUNICIPALITY BY WHAT DESTINATION IS PRIMARILY SELECTED
            let primaryDest = "";
            if (globalState.selectedDestinationMun && globalState.selectedDestinationMun !== "ALL") {
                primaryDest = globalState.selectedDestinationMun.trim();
            } else if (globalState.selectedOriginHub && globalState.selectedOriginHub !== "ALL") {
                primaryDest = globalState.selectedOriginHub.trim();
            } else {
                primaryDest = "Camiling";
            }

            let primaryRegion = "Region III (Central Luzon)";
            const matchingRecord = (globalState.records || []).find(r => 
                (r.type || 'customers') === 'barangays' && 
                (r.municipality || '').trim().toLowerCase() === primaryDest.toLowerCase() &&
                r.region
            );
            if (matchingRecord && matchingRecord.region) {
                primaryRegion = matchingRecord.region;
            }

            if (regInput) regInput.value = primaryRegion;
            if (munInput) munInput.value = primaryDest;

            const detectedCountry = await detectUserCountry();
            await loadNationsList(detectedCountry);
            await handleRateNationalityChange(detectedCountry);
            await loadPsgcRegions(primaryRegion, primaryDest);
        } else {
            const nameInput = document.getElementById('form-name');
            const contactInput = document.getElementById('form-contact');
            const addressInput = document.getElementById('form-address');
            const latlonInput = document.getElementById('form-latlon');

            if (nameInput) nameInput.value = "";
            if (contactInput) contactInput.value = "";
            if (addressInput) addressInput.value = "";
            if (latlonInput) latlonInput.value = "";

            const extraContainer = document.getElementById('form-extra-locations-container');
            if (extraContainer) extraContainer.innerHTML = '';
        }
    }
}

export function editDirectoryRecord(name, compositeKey = "") {
    let record = null;
    if (compositeKey) {
        record = globalState.records?.find(r => r.compositeKey === compositeKey);
    }
    if (!record) {
        record = globalState.records?.find(r => r.name === name);
    }
    if (record) openForm(record);
}

export function promptDeleteDirectoryRecord(name, compositeKey = "") {
    if (!checkAdminAccess()) {
        return showToast("⚠️ Admin access required to delete directory records.");
    }

    openSlideDeleteModal(
        `Delete Directory Record?`,
        `Are you sure you want to delete the record [${name}]?`,
        () => executeDeleteDirectoryRecord(name, compositeKey)
    );
}

export function executeDeleteDirectoryRecord(name, compositeKey = "") {
    const type = globalState.currentType || 'customers';
    
    if (globalState.records) {
        globalState.records = globalState.records.filter(r => {
            if (compositeKey && r.compositeKey) {
                return r.compositeKey !== compositeKey;
            }
            return !(r.name === name && r.type === type);
        });
    }

    saveDirectoryCache();
    renderDirectoryList();
    showToast(`🗑️ Deleted record: ${name}`);

    if (db) {
        const targetDbKey = compositeKey || name.toLowerCase().replace(/[^a-z0-9]/g, '');
        db.ref(`directory/${type}/${targetDbKey}`).remove().catch(() => {});
    }

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: type,
                action: 'delete',
                data: { name: name, compositeKey: compositeKey }
            })
        }).catch(() => {});
    } catch (e) {}
}

export async function submitForm() {
    const type = globalState.currentType || 'customers';
    const isRates = type === 'barangays';
    const isEdit = !!editingRecord;
    const currentDate = getLocalTodayStr();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();

    let recordData = null;
    let persistenceKey = "";

    if (isRates) {
        const originSelect = document.getElementById('form-rate-origin');
        const natSelect = document.getElementById('form-rate-nationality');
        const regInput = document.getElementById('form-rate-region');
        const munInput = document.getElementById('form-rate-municipality');
        const brgyInput = document.getElementById('form-rate-barangay');
        const amountInput = document.getElementById('form-rate-amount');

        const originMunicipality = originSelect ? originSelect.value.trim() : "Camiling";
        const nationality = natSelect ? natSelect.value.trim() : "Philippines";
        const region = (regInput && regInput.value.trim()) ? regInput.value.trim() : "Region III (Central Luzon)";
        const municipality = (munInput && munInput.value.trim()) ? munInput.value.trim() : "Camiling";

        const barangay = brgyInput ? brgyInput.value.trim() : "";
        const amountVal = amountInput ? parseFloat(amountInput.value) : NaN;

        if (!barangay) return showToast("⚠️ Barangay / District name is required!");
        if (isNaN(amountVal) || amountVal < 0) return showToast("⚠️ Valid delivery amount (₱) is required!");

        const displayFee = `₱${amountVal.toFixed(2)}`;

        // COMPOSITE KEY GENERATION: origin_destination_barangay
        const originSlug = originMunicipality.toLowerCase().replace(/[^a-z0-9]/g, '');
        const munSlug = municipality.toLowerCase().replace(/[^a-z0-9]/g, '');
        const brgySlug = barangay.toLowerCase().replace(/[^a-z0-9]/g, '');
        persistenceKey = `${originSlug}_${munSlug}_${brgySlug}`;

        recordData = {
            name: barangay,
            barangay: barangay,
            originMunicipality: originMunicipality,
            nationality: nationality,
            region: region,
            municipality: municipality,
            compositeKey: persistenceKey,
            rate: displayFee,
            address: displayFee,
            contact: "",
            lat_lon_link: "",
            type: 'barangays',
            recorded_by: editingRecord ? (editingRecord.recorded_by || appState.riderName || "Amiel") : (appState.riderName || "Amiel"),
            recorded_at: editingRecord ? (editingRecord.recorded_at || currentDate) : currentDate,
            originalName: editingRecord ? editingRecord.name : barangay
        };
    } else {
        const nameInput = document.getElementById('form-name');
        const contactInput = document.getElementById('form-contact');
        const addressInput = document.getElementById('form-address');
        const latlonInput = document.getElementById('form-latlon');

        const name = nameInput ? nameInput.value.trim() : "";
        const contact = contactInput ? contactInput.value.trim() : "";
        const address = addressInput ? addressInput.value.trim() : "";
        const lat_lon_link = latlonInput ? latlonInput.value.trim() : "";

        if (!name) return showToast("⚠️ Name / Store Name is required!");

        showToast("📡 Calibrating GPS location...");
        const coords = await calibrateGPS((acc) => {
            showToast(`📡 Checking GPS signal: ±${Math.round(acc)}m`);
        });

        if (!coords || (coords.lat === 0 && coords.lon === 0) || coords.accuracy > 50) {
            const gpsModal = document.getElementById('gps-alert-modal');
            if (gpsModal) gpsModal.classList.remove('hidden');
            showToast(`⚠️ Cannot save record: Bad GPS signal (±${Math.round(coords ? coords.accuracy : 999)}m)! Move to an open area.`);
            return;
        }

        persistenceKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');

        const extraLocElements = document.querySelectorAll('.form-extra-location-row');
        const locations = [];
        if (address || lat_lon_link) {
            locations.push({
                label: 'Main Address',
                address: address,
                lat_lon_link: lat_lon_link,
                isPrimary: true
            });
        }
        extraLocElements.forEach((row, idx) => {
            const lLabel = row.querySelector('.form-extra-loc-label')?.value?.trim() || `Location ${idx + 2}`;
            const lAddr = row.querySelector('.form-extra-loc-address')?.value?.trim() || '';
            const lMap = row.querySelector('.form-extra-loc-map')?.value?.trim() || '';
            if (lAddr || lMap) {
                locations.push({
                    label: lLabel,
                    address: lAddr,
                    lat_lon_link: lMap,
                    isPrimary: false
                });
            }
        });

        recordData = {
            name, contact, address, rate: address, lat_lon_link,
            ...(locations.length > 0 ? { locations } : {}),
            type: type,
            recorded_by: editingRecord ? (editingRecord.recorded_by || appState.riderName || "Amiel") : (appState.riderName || "Amiel"),
            recorded_at: editingRecord ? (editingRecord.recorded_at || currentDate) : currentDate,
            originalName: editingRecord ? editingRecord.name : name
        };
    }

    if (editingRecord) {
        // Clean up legacy flat keys or older composite keys in Firebase if key shifted
        const oldKey = editingRecord.compositeKey || editingRecord.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (oldKey !== persistenceKey && db) {
            db.ref(`directory/${type}/${oldKey}`).remove().catch(() => {});
        }

        const idx = globalState.records.findIndex(r => {
            if (isRates && editingRecord.compositeKey && r.compositeKey) {
                return r.compositeKey === editingRecord.compositeKey;
            }
            return r.name === editingRecord.name && r.type === type;
        });

        if (idx !== -1) {
            globalState.records[idx] = recordData;
        } else {
            globalState.records.push(recordData);
        }
    } else {
        if (!globalState.records) globalState.records = [];
        globalState.records.push(recordData);
    }

    saveDirectoryCache();
    const savedName = recordData.name;
    editingRecord = null;

    // Automatically link newly created customer profile back to the originating chat thread
    if (window._pendingLinkCustIdFromChat && recordData && (type === 'customers')) {
        const targetChatCustId = window._pendingLinkCustIdFromChat;
        window._pendingLinkCustIdFromChat = null;
        if (typeof window.linkChatToDirectoryRecord === 'function') {
            window.linkChatToDirectoryRecord(targetChatCustId, recordData).catch(() => {});
        }
    }

    // DIRECTORY REGISTRATION REWARD ENGINE (HONORS ADMIN SETTINGS)
    const creditConfig = globalState.directoryCreditsConfig || {
        enabled: true,
        rewardCustomerRegistration: 5,
        rewardStoreRegistration: 10
    };

    if (!isEdit && myId && creditConfig.enabled !== false && !isRates) {
        let earnedCredits = 0;
        if (type === 'stores') {
            earnedCredits = creditConfig.rewardStoreRegistration !== undefined ? creditConfig.rewardStoreRegistration : 10;
        } else if (type === 'customers') {
            earnedCredits = creditConfig.rewardCustomerRegistration !== undefined ? creditConfig.rewardCustomerRegistration : 5;
        }

        if (earnedCredits > 0) {
            const cur = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
            const updated = cur + earnedCredits;
            localStorage.setItem('lokalex_rider_credits', updated.toString());
            appState.directoryCredits = updated;
            updateRosterCreditsDisplay(updated);

            if (db) {
                db.ref(`riders/${myId}/directoryCredits`).transaction(c => (c || 0) + earnedCredits);
                db.ref(`roster/${myId}/directoryCredits`).transaction(c => (c || 0) + earnedCredits).catch(() => {});
            }

            showSideNotification("CREDITS REWARD", `+${earnedCredits} Credits for registering ${savedName}`, "fa-coins", "text-amber-400", "border-amber-500");
            showToast(`🎉 +${earnedCredits} Directory Credits earned! Total: ${updated}`);
        }
    }

    showToast(`✅ Record ${isEdit ? 'updated' : 'saved'} successfully!`);

    if (window.history.state && window.history.state.view === 'view-form') {
        goBack();
    } else {
        openDirectory(type);
    }

    if (db && persistenceKey) {
        db.ref(`directory/${type}/${persistenceKey}`).set(recordData).catch(() => {});
    }

    showSideNotification("SAVING RECORD", `Syncing ${savedName} to ${type}...`, "fa-floppy-disk", "text-emerald-400", "border-emerald-500");

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: type,
                action: isEdit ? 'edit' : 'add',
                data: recordData
            })
        }).catch(() => {});
    } catch (e) {}
}

export function addDirectoryExtraLocationField(label = '', address = '', mapLink = '') {
    const container = document.getElementById('form-extra-locations-container');
    if (!container) return;

    const rowId = 'extra-loc-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const div = document.createElement('div');
    div.id = rowId;
    div.className = 'form-extra-location-row bg-black/40 p-3 rounded-2xl border border-gray-700/80 flex flex-col gap-2 relative shadow-xs';
    div.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                <i class="fa-solid fa-location-dot"></i> Additional Location
            </span>
            <button type="button" onclick="window.removeDirectoryExtraLocationField('${rowId}')" class="text-xs text-rose-400 hover:text-rose-300 transition p-1 cursor-pointer" title="Remove Location">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
        <div class="flex gap-2">
            <input type="text" placeholder="Label (e.g. Work, Farm)" value="${escapeHtml(label || '')}" class="form-extra-loc-label w-1/3 bg-inputBg text-xs rounded-xl p-2.5 outline-none border border-gray-700 text-white font-medium focus:border-emerald-500">
            <input type="text" placeholder="Address / Landmarks" value="${escapeHtml(address || '')}" class="form-extra-loc-address flex-1 bg-inputBg text-xs rounded-xl p-2.5 outline-none border border-gray-700 text-white font-medium focus:border-emerald-500">
        </div>
        <div class="flex gap-2">
            <input type="text" placeholder="Map link (Google Maps link or coords)" value="${escapeHtml(mapLink || '')}" class="form-extra-loc-map flex-1 bg-inputBg text-xs font-mono rounded-xl p-2.5 outline-none border border-gray-700 text-white focus:border-emerald-500">
        </div>
    `;
    container.appendChild(div);
}

export function removeDirectoryExtraLocationField(rowId) {
    if (typeof rowId === 'string') {
        const el = document.getElementById(rowId);
        if (el) el.remove();
    } else if (rowId && rowId.closest) {
        const el = rowId.closest('.form-extra-location-row');
        if (el) el.remove();
    }
}

if (typeof window !== 'undefined') {
    window.openForm = openForm;
    window.editDirectoryRecord = editDirectoryRecord;
    window.promptDeleteDirectoryRecord = promptDeleteDirectoryRecord;
    window.executeDeleteDirectoryRecord = executeDeleteDirectoryRecord;
    window.submitForm = submitForm;
    window.detectUserCountry = detectUserCountry;
    window.loadNationsList = loadNationsList;
    window.handleRateNationalityChange = handleRateNationalityChange;
    window.handleRateRegionChange = handleRateRegionChange;
    window.handleRateMunicipalityChange = handleRateMunicipalityChange;
    window.addDirectoryExtraLocationField = addDirectoryExtraLocationField;
    window.removeDirectoryExtraLocationField = removeDirectoryExtraLocationField;
}
// REMARKS: DIRECTORY_FORM_COMPOSITE_ORIGIN_KEYING_V5_COMPLETE