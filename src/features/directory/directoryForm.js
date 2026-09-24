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
 */
export async function loadPsgcRegions(targetRegionName = "") {
    const select = document.getElementById('form-rate-region');
    const spinner = document.getElementById('rate-geo-loading-regions');
    if (!select) return;

    if (spinner) spinner.classList.remove('hidden');

    try {
        const regions = await fetchWithCache(
            "https://psgc.gitlab.io/api/regions.json",
            "lokalex_geo_cache_regions"
        );

        psgcRegionCodeMap.clear();
        select.innerHTML = `<option value="" disabled selected>Select Region</option>`;

        let matchedCode = "";
        let defaultCode = "";

        regions.forEach(r => {
            const displayName = r.regionName ? `${r.regionName} (${r.name})` : r.name;
            psgcRegionCodeMap.set(displayName, r.code);
            psgcRegionCodeMap.set(r.name, r.code);
            if (r.regionName) psgcRegionCodeMap.set(r.regionName, r.code);

            const isMatch = targetRegionName && (
                targetRegionName.toLowerCase().includes(r.name.toLowerCase()) || 
                (r.regionName && targetRegionName.toLowerCase().includes(r.regionName.toLowerCase()))
            );

            if (isMatch) matchedCode = r.code;
            if (r.code === "030000000" || r.name.toLowerCase().includes("central luzon")) {
                defaultCode = r.code;
            }

            const opt = document.createElement('option');
            opt.value = displayName;
            opt.dataset.code = r.code;
            opt.innerText = displayName;
            select.appendChild(opt);
        });

        const activeCode = matchedCode || defaultCode;
        if (activeCode) {
            const targetOpt = Array.from(select.options).find(o => o.dataset.code === activeCode);
            if (targetOpt) {
                select.value = targetOpt.value;
                await loadPsgcCitiesMunicipalities(activeCode);
            }
        }
    } catch(err) {
        console.warn("Could not load dynamic PSGC regions:", err);
        select.innerHTML = `
            <option value="Region III (Central Luzon)" data-code="030000000" selected>Region III (Central Luzon)</option>
            <option value="Region I (Ilocos Region)" data-code="010000000">Region I (Ilocos Region)</option>
            <option value="NCR (National Capital Region)" data-code="130000000">NCR (National Capital Region)</option>
        `;
        await loadPsgcCitiesMunicipalities("030000000");
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
}

/**
 * Loads cities and municipalities under the chosen region code from the PSGC API.
 */
export async function loadPsgcCitiesMunicipalities(regionCode, targetMunName = "") {
    const select = document.getElementById('form-rate-municipality');
    const spinner = document.getElementById('rate-geo-loading-mun');
    if (!select || !regionCode) return;

    if (spinner) spinner.classList.remove('hidden');

    try {
        const list = await fetchWithCache(
            `https://psgc.gitlab.io/api/regions/${regionCode}/cities-municipalities.json`,
            `lokalex_geo_cache_mun_${regionCode}`
        );

        psgcCityMunCodeMap.clear();
        select.innerHTML = `<option value="" disabled selected>Select Municipality/City</option>`;

        list.sort((a, b) => a.name.localeCompare(b.name));

        let matchedCode = "";
        let defaultCode = "";

        list.forEach(item => {
            psgcCityMunCodeMap.set(item.name.toLowerCase(), item.code);
            psgcCityMunCodeMap.set(item.name, item.code);

            const isMatch = targetMunName && targetMunName.toLowerCase() === item.name.toLowerCase();
            if (isMatch) matchedCode = item.code;
            if (item.name.toLowerCase() === "camiling") defaultCode = item.code;

            const opt = document.createElement('option');
            opt.value = item.name;
            opt.dataset.code = item.code;
            opt.innerText = item.name;
            select.appendChild(opt);
        });

        const activeCode = matchedCode || defaultCode || (list[0] ? list[0].code : "");
        if (activeCode) {
            const targetOpt = Array.from(select.options).find(o => o.dataset.code === activeCode);
            if (targetOpt) {
                select.value = targetOpt.value;
                await loadPsgcBarangays(activeCode);
            }
        }
    } catch(err) {
        console.warn("Could not load dynamic PSGC cities/municipalities:", err);
        select.innerHTML = `
            <option value="Camiling" data-code="036905000" selected>Camiling</option>
            <option value="San Clemente" data-code="036912000">San Clemente</option>
            <option value="Paniqui" data-code="036910000">Paniqui</option>
        `;
        await loadPsgcBarangays("036905000");
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
    const regSelect = document.getElementById('form-rate-region');
    const regCustom = document.getElementById('form-rate-region-custom');
    const munSelect = document.getElementById('form-rate-municipality');
    const munCustom = document.getElementById('form-rate-municipality-custom');
    const brgyInput = document.getElementById('form-rate-barangay');
    const brgyList = document.getElementById('form-rate-barangay-list');
    const brgyHint = document.getElementById('form-rate-barangay-hint');

    const isPH = (nationality || "").trim().toLowerCase() === "philippines";

    if (isPH) {
        if (regSelect) regSelect.classList.remove('hidden');
        if (regCustom) regCustom.classList.add('hidden');
        if (munSelect) munSelect.classList.remove('hidden');
        if (munCustom) munCustom.classList.add('hidden');
        if (brgyInput) brgyInput.placeholder = "Select or type Barangay name";
        if (brgyHint) brgyHint.innerText = "Pumili sa opisyal na listahan mula sa PSA PSGC API o mag-type ng sariling lugar.";
        await loadPsgcRegions();
    } else {
        if (regSelect) regSelect.classList.add('hidden');
        if (regCustom) {
            regCustom.classList.remove('hidden');
            regCustom.placeholder = `Enter State / Province (${nationality})`;
        }
        if (munSelect) munSelect.classList.add('hidden');
        if (munCustom) {
            munCustom.classList.remove('hidden');
            munCustom.placeholder = `Enter City / Municipality (${nationality})`;
        }
        if (brgyInput) brgyInput.placeholder = "Enter District, Street, or Suburb";
        if (brgyList) brgyList.innerHTML = "";
        if (brgyHint) brgyHint.innerText = "Enter specific delivery district or sub-locality name.";
    }
}

export async function handleRateRegionChange(regionDisplayName) {
    const select = document.getElementById('form-rate-region');
    const selectedOpt = select ? select.options[select.selectedIndex] : null;
    let code = selectedOpt ? selectedOpt.dataset.code : psgcRegionCodeMap.get(regionDisplayName);

    if (!code) code = "030000000";
    await loadPsgcCitiesMunicipalities(code);
}

export async function handleRateMunicipalityChange(municipalityName) {
    const select = document.getElementById('form-rate-municipality');
    const selectedOpt = select ? select.options[select.selectedIndex] : null;
    let code = selectedOpt ? selectedOpt.dataset.code : psgcCityMunCodeMap.get(municipalityName.toLowerCase());

    if (!code && municipalityName.toLowerCase() === "camiling") {
        code = "036905000";
    }

    if (code) {
        await loadPsgcBarangays(code);
    }
}

export async function openForm(record = null) {
    editingRecord = record;
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
        if (warningEl) warningEl.classList.remove('hidden');
        if (warningText) warningText.innerText = `Editing record: ${record.name}`;
        if (submitBtn) submitBtn.innerText = "UPDATE RECORD";

        if (isRates) {
            const originSelect = document.getElementById('form-rate-origin');
            const amountInput = document.getElementById('form-rate-amount');

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

            await loadNationsList(resolvedNationality);
            await handleRateNationalityChange(resolvedNationality);

            if (resolvedNationality.toLowerCase() === "philippines") {
                await loadPsgcRegions(resolvedRegion);
                const munSelect = document.getElementById('form-rate-municipality');
                if (munSelect) {
                    const targetMunOpt = Array.from(munSelect.options).find(o => o.value.toLowerCase() === resolvedMunicipality.toLowerCase());
                    if (targetMunOpt) {
                        munSelect.value = targetMunOpt.value;
                        const munCode = targetMunOpt.dataset.code || psgcCityMunCodeMap.get(resolvedMunicipality.toLowerCase());
                        if (munCode) await loadPsgcBarangays(munCode, resolvedBarangay);
                    }
                }
            } else {
                const regCustom = document.getElementById('form-rate-region-custom');
                const munCustom = document.getElementById('form-rate-municipality-custom');
                const brgyInput = document.getElementById('form-rate-barangay');
                if (regCustom) regCustom.value = record.region || "";
                if (munCustom) munCustom.value = record.municipality || "";
                if (brgyInput) brgyInput.value = resolvedBarangay;
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
        }
    } else {
        if (warningEl) warningEl.classList.add('hidden');
        if (submitBtn) submitBtn.innerText = "SAVE RECORD";

        if (isRates) {
            const originSelect = document.getElementById('form-rate-origin');
            const amountInput = document.getElementById('form-rate-amount');
            const brgyInput = document.getElementById('form-rate-barangay');

            if (originSelect) {
                const activeHub = (globalState.selectedOriginHub && globalState.selectedOriginHub !== 'ALL') 
                    ? globalState.selectedOriginHub 
                    : "Camiling";
                originSelect.value = activeHub;
            }

            if (amountInput) amountInput.value = "";
            if (brgyInput) brgyInput.value = "";

            const detectedCountry = await detectUserCountry();
            await loadNationsList(detectedCountry);
            await handleRateNationalityChange(detectedCountry);
        } else {
            const nameInput = document.getElementById('form-name');
            const contactInput = document.getElementById('form-contact');
            const addressInput = document.getElementById('form-address');
            const latlonInput = document.getElementById('form-latlon');

            if (nameInput) nameInput.value = "";
            if (contactInput) contactInput.value = "";
            if (addressInput) addressInput.value = "";
            if (latlonInput) latlonInput.value = "";
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
        `Sigurado ka bang nais mong burahin ang record na [${name}]?`,
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
        const regSelect = document.getElementById('form-rate-region');
        const regCustom = document.getElementById('form-rate-region-custom');
        const munSelect = document.getElementById('form-rate-municipality');
        const munCustom = document.getElementById('form-rate-municipality-custom');
        const brgyInput = document.getElementById('form-rate-barangay');
        const amountInput = document.getElementById('form-rate-amount');

        const originMunicipality = originSelect ? originSelect.value.trim() : "Camiling";
        const nationality = natSelect ? natSelect.value.trim() : "Philippines";
        const isPH = nationality.toLowerCase() === "philippines";

        const region = isPH 
            ? (regSelect ? regSelect.value.trim() : "Region III (Central Luzon)")
            : (regCustom ? regCustom.value.trim() : "International");

        const municipality = isPH
            ? (munSelect ? munSelect.value.trim() : "Camiling")
            : (munCustom ? munCustom.value.trim() : "International");

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

        recordData = {
            name, contact, address, rate: address, lat_lon_link,
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
}
// REMARKS: DIRECTORY_FORM_COMPOSITE_ORIGIN_KEYING_V5_COMPLETE