// src/config/firebase.js
const firebaseConfig = {
    apiKey: "AIzaSyD2ZbvO60h-udB_iNZ6zVbmXjMwYfbS_2w",
    authDomain: "lokalex-hub.firebaseapp.com",
    databaseURL: "https://lokalex-hub-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "lokalex-hub",
    storageBucket: "lokalex-hub.appspot.com",
    messagingSenderId: "102938475610",
    appId: "1:102938475610:web:abcdef1234567890"
};

const fb = window.firebase || (typeof firebase !== 'undefined' ? firebase : null);

if (fb && !fb.apps.length) {
    fb.initializeApp(firebaseConfig);
}

export const db = fb ? fb.database() : null;
export const auth = fb ? fb.auth() : null;
export const messaging = (fb && typeof fb.messaging === 'function' && fb.messaging.isSupported()) ? fb.messaging() : null;
export default fb;