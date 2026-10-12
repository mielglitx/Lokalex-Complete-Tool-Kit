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
    version: "2.1.0",
    service: "Lokalex Messenger Webhook Server",
    database: FIREBASE_DB_URL,
    channel: DEFAULT_API_NAME
  });
});

// Outbound Message Endpoint: Send reply from Lokalex Rider to Messenger Customer
app.post('/api/send-reply', async (req, res) => {
  try {
    const { recipientId, text, imageUrl, locationCoords, tokenOverride, apiId } = req.body;

    let token = tokenOverride || PAGE_ACCESS_TOKEN;
    if (!token) {
      try {
        const tokenResp = await fetch(`${FIREBASE_DB_URL}/adminSettings/facebookApis/${apiId || DEFAULT_API_ID}/pageAccessToken.json`);
        if (tokenResp.ok) {
          const val = await tokenResp.json();
          if (typeof val === 'string' && val.trim()) {
            token = val.trim();
          }
        }
      } catch (e) {
        console.warn("Failed to fetch token from Firebase:", e);
      }
    }

    if (!token) {
      return res.status(400).json({ error: "PAGE_ACCESS_TOKEN not configured in Firebase or environment" });
    }

    const cleanPsid = String(recipientId || "").replace(/^fb_/, "");

    let msgPayload = { text: text || "Hello!" };
    if (imageUrl) {
      msgPayload = {
        attachment: {
          type: "image",
          payload: { url: imageUrl, is_reusable: true }
        }
      };
    } else if (locationCoords && locationCoords.lat && locationCoords.lng) {
      msgPayload = {
        text: `📍 Rider shared location: https://maps.google.com/?q=${locationCoords.lat},${locationCoords.lng}`
      };
    }

    let sendBody = {
      messaging_type: "RESPONSE",
      recipient: { id: cleanPsid },
      message: msgPayload,
    };

    let fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendBody),
    });

    let fbData = await fbResp.json();

    // If outside 24-hour window (Meta error code 10), retry with MESSAGE_TAG CONFIRMED_EVENT_UPDATE
    if (!fbResp.ok && fbData?.error?.code === 10) {
      console.log("ℹ️ Outside 24h window, retrying with MESSAGE_TAG CONFIRMED_EVENT_UPDATE...");
      sendBody = {
        messaging_type: "MESSAGE_TAG",
        tag: "CONFIRMED_EVENT_UPDATE",
        recipient: { id: cleanPsid },
        message: msgPayload,
      };
      fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      fbData = await fbResp.json();
    }

    return res.status(fbResp.status).json(fbData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
        let messageText = item.message.text || "";
        let hasAttachment = false;
        let imageUrl = null;
        let attachmentType = null;

        // Check attachments in webhook payload
        if (Array.isArray(item.message.attachments) && item.message.attachments.length > 0) {
          hasAttachment = true;
          for (const att of item.message.attachments) {
            if (att.type === "image" && att.payload?.url) {
              imageUrl = att.payload.url;
              attachmentType = "image";
              break;
            } else if (att.payload?.url && !imageUrl) {
              imageUrl = att.payload.url;
              attachmentType = att.type || "attachment";
            }
          }
        }

        const pageId = item.recipient?.id || entry.id || "1098954353295816";

        // 1. Check if thread in Firebase already has a valid customer name and existing catering/folder state
        let existingCustomerName = null;
        let existingAvatarUrl = null;
        let existingFolder = null;
        let existingCateredRider = null;
        let existingCateredRiderId = null;
        let existingStatus = null;
        try {
          const metaResp = await fetch(`${FIREBASE_DB_URL}/customerChatMeta/${custId}.json`);
          if (metaResp.ok) {
            const ex = await metaResp.json();
            if (ex) {
              if (ex.customerName && !ex.customerName.startsWith("FB Customer (")) {
                existingCustomerName = ex.customerName.trim();
                existingAvatarUrl = ex.avatarUrl;
              }
              if (ex.folder) existingFolder = ex.folder;
              if (ex.cateredByRiderName || ex.cateredBy) existingCateredRider = ex.cateredByRiderName || ex.cateredBy;
              if (ex.cateredByRiderId) existingCateredRiderId = ex.cateredByRiderId;
              if (ex.status) existingStatus = ex.status;
            }
          }
        } catch(e) {}

        // 2. Fetch Facebook Page Access Token & Page ID from Firebase if not in environment
        let token = PAGE_ACCESS_TOKEN;
        let resolvedPageId = pageId;
        if (!token) {
          try {
            const apiResp = await fetch(`${FIREBASE_DB_URL}/adminSettings/facebookApis/${DEFAULT_API_ID}.json`);
            if (apiResp.ok) {
              const apiData = await apiResp.json();
              if (apiData?.pageAccessToken) token = apiData.pageAccessToken.trim();
              if (apiData?.pageId) resolvedPageId = apiData.pageId.trim();
            }
          } catch(e) {}
        }

        // Fallback: If message has attachments but url wasn't in webhook payload, query Meta Graph API
        if (hasAttachment && !imageUrl && token && item.message.mid) {
          try {
            const midResp = await fetch(`https://graph.facebook.com/v19.0/${item.message.mid}?fields=attachments&access_token=${token}`);
            if (midResp.ok) {
              const midData = await midResp.json();
              const graphAtt = midData?.attachments?.data?.[0];
              const graphUrl = graphAtt?.image_data?.url || graphAtt?.payload?.url;
              if (graphUrl) {
                imageUrl = graphUrl;
                attachmentType = "image";
              }
            }
          } catch(e) {
            console.warn("Failed to fetch attachment via Graph API:", e);
          }
        }

        if (!messageText) {
          if (imageUrl) {
            messageText = "📷 Photo";
          } else if (hasAttachment) {
            messageText = `📷 [Facebook ${attachmentType || "attachment"}]`;
          } else {
            messageText = "Facebook Message";
          }
        }

        let customerName = existingCustomerName || `FB Customer (${senderId.slice(-4)})`;
        let avatarUrl = existingAvatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=0084FF&color=fff`;

        // 3. Resolve customer name via Facebook Graph API
        if (token && (!existingCustomerName || existingCustomerName.startsWith("FB Customer ("))) {
          // Method A: Page Conversations API (Works for ALL public customers without requiring User Profile Advanced Access)
          try {
            const convResp = await fetch(
              `https://graph.facebook.com/v19.0/${resolvedPageId}/conversations?user_id=${senderId}&fields=participants,senders&access_token=${token}`
            );
            if (convResp.ok) {
              const convData = await convResp.json();
              if (Array.isArray(convData.data) && convData.data.length > 0) {
                const participants = [
                  ...(convData.data[0].participants?.data || []),
                  ...(convData.data[0].senders?.data || [])
                ];
                const matched = participants.find(p => String(p.id) === String(senderId));
                if (matched && matched.name) {
                  customerName = matched.name.trim();
                  avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=0084FF&color=fff`;
                }
              }
            }
          } catch (e) {
            console.warn("Conversations API name lookup failed:", e);
          }

          // Method B: Direct PSID Node API (Fallback / retrieves profile picture when available)
          try {
            const profileResp = await fetch(
              `https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name,name,profile_pic&access_token=${token}`
            );
            if (profileResp.ok) {
              const profile = await profileResp.json();
              const fullName = profile.name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
              if (fullName) customerName = fullName;
              if (profile.profile_pic) avatarUrl = profile.profile_pic;
            }
          } catch (e) {
            console.warn("Direct PSID profile lookup failed:", e);
          }
        }

        const isCurrentlyCatered = (existingCateredRider || existingCateredRiderId || existingFolder === 'catering') && existingStatus !== 'completed' && existingStatus !== 'done' && existingStatus !== 'cancelled';
        const resolvedFolder = isCurrentlyCatered 
          ? 'catering' 
          : (existingFolder === 'followup' ? 'followup' : 'inbox');

        const threadMeta = {
          customerName,
          avatarUrl,
          lastMessage: imageUrl && (!item.message.text || !item.message.text.trim()) ? "📷 Photo" : messageText,
          lastUpdated: timestamp,
          folder: resolvedFolder,
          channel: "messenger",
          apiId: DEFAULT_API_ID,
          apiName: DEFAULT_API_NAME,
          unreadForRider: true
        };
        if (existingCateredRider) threadMeta.cateredByRiderName = existingCateredRider;
        if (existingCateredRiderId) threadMeta.cateredByRiderId = existingCateredRiderId;

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

        if (imageUrl) {
          chatMsg.imageUrl = imageUrl;
          chatMsg.type = "image";
        }

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

