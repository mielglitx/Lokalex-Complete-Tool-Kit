const https = require('https');

https.get('https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/customerChats/fb_27047951888197850/messages.json', res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
        const msgs = JSON.parse(d);
        console.log("Count:", Object.keys(msgs).length);
        for (let [k, m] of Object.entries(msgs)) {
            console.log(k, JSON.stringify(m));
        }
    });
});

