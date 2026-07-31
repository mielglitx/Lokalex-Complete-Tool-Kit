// src/config/firebase.js
const firebaseConfig = {
    apiKey: "AIzaSyD2ZbvO60h-udB_iNZ6zVbmXjMwYfbS_2w",
    authDomain: "lokalex-hub.firebaseapp.com",
    databaseURL: "https://lokalex-hub-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "lokalex-hub",
    storageBucket: "lokalex-hub.firebasestorage.app",
    messagingSenderId: "56934926994",
    appId: "1:56934926994:web:e2e0eb51e0a230bf53b44b",
    measurementId: "G-Q148X0NJ7K"
};
firebase.initializeApp(firebaseConfig);
export const db = firebase.database();