// src/config/constants.js
export const API_URL = "https://script.google.com/macros/s/AKfycbyIz6OEd7dZh2gx1T5oT3G6xo7i4D3Lq8jPre4ke26tcqqq3v0pollbGtRcTr8JATnvtQ/exec"; 
export const CSV_AUTH_URL = "https://docs.google.com/spreadsheets/d/1lc-1os3xTnAuE0dsm6UmEle7vxuRyewBnuBlSrfPSWk/export?format=csv&gid=0";
export const HUB_LOCATION = { lat: 15.6881, lng: 120.4144, mapUrl: "https://maps.app.goo.gl/sCBrMSjP9FEjB43C7" };
export const ADMIN_IDS = ["4547425", "5548562"];

// 🔹 FACEBOOK APP & PAGE CONFIGURATION
// Replace with your valid Meta Developer App ID from https://developers.facebook.com/
// src/config/constants.js
export const FB_APP_ID = "3509728395866188";
export const FB_PAGE_USERNAME = "lokaledeliverygroup"; 
export const FB_PAGE_URL = `https://m.me/${FB_PAGE_USERNAME}`;

export const BARANGAY_DATA = [
    { name: "Anoling 1st", km: "5.5", fee: 95 }, { name: "Anoling 2nd", km: "6.7", fee: 110 },
    { name: "Anoling 3rd", km: "7.6", fee: 125 }, { name: "Bacabac", km: "5.4", fee: 95 },
    { name: "Bacsay", km: "10.9", fee: 170 }, { name: "Bancay 1st", km: "5.3", fee: 95 },
    { name: "Bilad", km: "7.1", fee: 125 }, { name: "Birbira", km: "7.6", fee: 125 },
    { name: "Bobon 1st", km: "3.7", fee: 65 }, { name: "Bobon 2nd", km: "4.5", fee: 80 },
    { name: "Bobon Caarosipan", km: "4.8", fee: 80 }, { name: "Cabanabaan", km: "5.5", fee: 95 },
    { name: "Cacamilingan Norte", km: "1", fee: 50 }, { name: "Cacamilingan Sur", km: "1", fee: 50 },
    { name: "Caniag", km: "7.7", fee: 125 }, { name: "Carael", km: "9.5", fee: 155 },
    { name: "Cayaoan", km: "1", fee: 50 }, { name: "Cayasan", km: "8.6", fee: 140 },
    { name: "Florida", km: "9", fee: 140 }, { name: "Lasong", km: "7.6", fee: 125 },
    { name: "Libueg", km: "2.6", fee: 50 }, { name: "Malacampa", km: "6", fee: 95 },
    { name: "Manaquem", km: "7.1", fee: 125 }, { name: "Manupeg", km: "8", fee: 125 },
    { name: "Marawi", km: "5.7", fee: 95 }, { name: "Matubog", km: "3.6", fee: 65 },
    { name: "Nagrambacan", km: "6", fee: 95 }, { name: "Nagserialan", km: "4.4", fee: 80 },
    { name: "Palimbo Proper", km: "3.9", fee: 65 }, { name: "Palimbo-Caarosipan", km: "2.6", fee: 50 },
    { name: "Pao 1st", km: "1.8", fee: 50 }, { name: "Pao 2nd", km: "2.2", fee: 50 },
    { name: "Pao 3rd", km: "3.9", fee: 65 }, { name: "Papaac", km: "11.9", fee: 185 },
    { name: "Pindangan 1st", km: "7.8", fee: 125 }, { name: "Pindangan 2nd", km: "10.1", fee: 170 },
    { name: "Poblacion A", km: "1", fee: 50 }, { name: "Poblacion B", km: "1", fee: 50 },
    { name: "Poblacion C", km: "1", fee: 50 }, { name: "Poblacion D", km: "1", fee: 50 },
    { name: "Poblacion E", km: "1", fee: 50 }, { name: "Poblacion F", km: "1", fee: 50 },
    { name: "Poblacion G", km: "1", fee: 50 }, { name: "Poblacion H", km: "1", fee: 50 },
    { name: "Poblacion I", km: "1", fee: 50 }, { name: "Poblacion J", km: "1", fee: 50 },
    { name: "San Isidro", km: "6.7", fee: 110 }, { name: "Santa Maria", km: "8.4", fee: 140 },
    { name: "Sawat", km: "4.1", fee: 80 }, { name: "Sinilian 1st", km: "6.6", fee: 110 },
    { name: "Sinilian 2nd", km: "8", fee: 125 }, { name: "Sinilian 3rd", km: "8.5", fee: 140 },
    { name: "Sinilian Cacalibosoan", km: "7", fee: 110 }, { name: "Sinulatan 1st", km: "4.8", fee: 80 },
    { name: "Sinulatan 2nd", km: "5.1", fee: 95 }, { name: "Surgui 1st", km: "1.8", fee: 50 },
    { name: "Surgui 2nd", km: "2", fee: 50 }, { name: "Surgui 3rd", km: "2.5", fee: 50 },
    { name: "Tambugan", km: "2.8", fee: 50 }, { name: "Telbang", km: "4.7", fee: 80 },
    { name: "Tuec", km: "3.3", fee: 65 }
];