const https = require('https');

const dbUrl = "https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app";

function get(path) {
    return new Promise((resolve, reject) => {
        https.get(`${dbUrl}/${path}.json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    const custs = ['fb_27075815198701907', 'fb_36528907070089604', 'fb_28108633445388184'];
    for (const c of custs) {
        const res = await get(`customerChats/${c}/messages`);
        console.log(`Cust ${c}: status ${res.status}, count ${res.body ? Object.keys(res.body).length : 0}`);
        if (res.body) {
            for (const [k, v] of Object.entries(res.body)) {
                if (v.text && (v.text.includes("'") || v.text.includes('"') || v.text.includes("`"))) {
                    console.log(`  Found quote in msg ${k}: ${v.text.replace(/\n/g, ' ')}`);
                }
            }
        }
    }
}

run();
