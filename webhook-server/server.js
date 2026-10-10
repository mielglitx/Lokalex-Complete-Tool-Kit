/**
 * ============================================================================
 * LOKALEX DISPATCH - FACEBOOK MESSENGER TO FIREBASE (NODE.JS / EXPRESS SERVER)
 * ============================================================================
 * 
 * Run with:
 *   npm install express
 *   node server.js
 * 
 * Or deploy directly to Railway, Render, or VPS.
 * ============================================================================
 */

import express from 'express';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "Test1234";
const DEFAULT_API_ID = process.env.DEFAULT_API_ID || "fb_api_1791648211091";
const DEFAULT_API_NAME = process.env.DEFAULT_API_NAME || "Camiling FB";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health check & status
app.get('/', (req, res) => {
  res.json({
    status: "online",
    service: "Lokalex Messenger Webhook Server",
    database: FIREBASE_DB_URL,
    channel: DEFAULT_API_NAME
  });
});

// 1. Meta Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log("✅ Meta Webhook verification successful!");
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden: Token mismatch');
});

// 2. Incoming Messages from Meta
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    // Acknowledge immediately
    res.status(200).send('EVENT_RECEIVED');

    if (!Array.isArray(body.entry)) return;

    for (const entry of body.entry) {
      if (!Array.isArray(entry.messaging)) continue;

      for (const item of entry.messaging) {
        if (!item.message || item.message.is_echo) continue;

        const senderId = item.sender?.id;
        if (!senderId) continue;

        const custId = `fb_${senderId}`;
        const timestamp = item.timestamp || Date.now();
        const mid = item.message.mid ? String(item.message.mid).replace(/[.#$\[\]\/]/g, '_') : `msg_${timestamp}`;
        let messageText = item.message.text || (item.message.attachments ? "📷 [Attachment]" : "Facebook Message");

        let customerName = `FB Customer (${senderId.slice(-4)})`;
        let avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=0084FF&color=fff`;

        if (PAGE_ACCESS_TOKEN) {
          try {
            const profileResp = await fetch(`https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name,profile_pic&access_token=${PAGE_ACCESS_TOKEN}`);
            if (profileResp.ok) {
              const p = await profileResp.json();
              const full = `${p.first_name || ''} ${p.last_name || ''}`.trim();
              if (full) customerName = full;
              if (p.profile_pic) avatarUrl = p.profile_pic;
            }
          } catch(e) {}
        }

        const threadMeta = {
          customerName,
          avatarUrl,
          lastMessage: messageText,
          lastUpdated: timestamp,
          folder: "inbox",
          channel: "messenger",
          apiId: DEFAULT_API_ID,
          apiName: DEFAULT_API_NAME,
          unreadForRider: true
        };

        const chatMsg = {
          sender: customerName,
          senderType: "customer",
          text: messageText,
          timestamp,
          isRider: false,
          status: "delivered",
          channel: "messenger",
          apiId: DEFAULT_API_ID,
          mid
        };

        try {
          await Promise.all([
            fetch(`${FIREBASE_DB_URL}/customerChatMeta/${custId}.json`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(threadMeta)
            }),
            fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/metadata.json`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(threadMeta)
            }),
            fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/messages/${mid}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(chatMsg)
            })
          ]);
          console.log(`✅ Message from ${customerName} saved to Firebase!`);
        } catch (err) {
          console.error("Firebase write error:", err);
        }
      }
    }
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Lokalex Messenger Webhook Server listening on port ${PORT}`);
});

