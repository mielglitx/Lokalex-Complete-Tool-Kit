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

// Persistent In-Memory Caches across requests (0ms lookup)
const MEM_TOKEN_CACHE = {
  token: null,
  pageId: null,
  fetchedAt: 0
};
const MEM_CUSTOMER_CACHE = new Map();

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

    let fbResp = null;
    let fbData = null;

    // Check if sending an image attachment
    if (imageUrl && typeof imageUrl === "string" && imageUrl.trim()) {
      const trimmedImg = imageUrl.trim();
      if (trimmedImg.startsWith("data:")) {
        // Base64 data URL: upload as multipart/form-data with filedata to Meta Graph API
        try {
          const commaIdx = trimmedImg.indexOf(",");
          const header = trimmedImg.slice(0, commaIdx);
          const base64Data = trimmedImg.slice(commaIdx + 1);
          const mimeMatch = header.match(/:(.*?);/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
          const buffer = Buffer.from(base64Data, 'base64');
          const blob = new Blob([buffer], { type: mimeType });

          const formData = new FormData();
          formData.append("recipient", JSON.stringify({ id: cleanPsid }));
          formData.append("message", JSON.stringify({ attachment: { type: "image", payload: { is_reusable: true } } }));
          formData.append("filedata", blob, "image.jpg");

          fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
            method: "POST",
            body: formData,
          });
          const rawText = await fbResp.text();
          try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }
        } catch (convErr) {
          console.warn("Base64 upload to Meta failed:", convErr);
        }
      } else {
        // HTTPS image URL
        const sendBody = {
          messaging_type: "RESPONSE",
          recipient: { id: cleanPsid },
          message: {
            attachment: {
              type: "image",
              payload: { url: trimmedImg, is_reusable: true }
            }
          }
        };
        fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sendBody),
        });
        const rawText = await fbResp.text();
        try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }
      }
    } else if (req.body.attachmentId) {
      const sendBody = {
        messaging_type: "RESPONSE",
        recipient: { id: cleanPsid },
        message: {
          attachment: {
            type: "image",
            payload: { attachment_id: req.body.attachmentId }
          }
        }
      };
      fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      const rawText = await fbResp.text();
      try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }
    } else if (locationCoords && locationCoords.lat && locationCoords.lng) {
      const sendBody = {
        messaging_type: "RESPONSE",
        recipient: { id: cleanPsid },
        message: {
          text: `📍 Rider shared location: https://maps.google.com/?q=${locationCoords.lat},${locationCoords.lng}`
        }
      };
      fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      const rawText = await fbResp.text();
      try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }
    } else if (typeof text === "string" && text.trim().length > 0) {
      const sendText = text.trim();
      const sendBody = {
        messaging_type: "RESPONSE",
        recipient: { id: cleanPsid },
        message: { text: sendText },
      };
      if (req.body.replyToMid) {
        sendBody.reply_to = { mid: req.body.replyToMid };
      }
      fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      const rawText = await fbResp.text();
      try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }
    } else {
      return res.status(400).json({ error: "Empty message payload: neither text nor valid image was provided" });
    }

    // If Meta rejects the reply_to parameter, retry without reply_to
    if (fbResp && !fbResp.ok && req.body.replyToMid && (fbData?.error?.message?.toLowerCase().includes('reply_to') || fbData?.error?.code === 100) && typeof text === "string" && text.trim().length > 0) {
      console.warn("⚠️ Server: reply_to rejected by Meta, retrying without reply_to:", fbData?.error?.message);
      const sendBody = {
        messaging_type: "RESPONSE",
        recipient: { id: cleanPsid },
        message: { text: text.trim() },
      };
      fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      const rawText = await fbResp.text();
      try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }
    }

    // If outside 24-hour window (Meta error code 10), retry with MESSAGE_TAG CONFIRMED_EVENT_UPDATE
    if (fbResp && !fbResp.ok && fbData?.error?.code === 10 && typeof text === "string" && text.trim().length > 0) {
      console.log("ℹ️ Outside 24h window, retrying with MESSAGE_TAG CONFIRMED_EVENT_UPDATE...");
      const sendBody = {
        messaging_type: "MESSAGE_TAG",
        tag: "CONFIRMED_EVENT_UPDATE",
        recipient: { id: cleanPsid },
        message: { text: text.trim() },
      };
      if (req.body.replyToMid) {
        sendBody.reply_to = { mid: req.body.replyToMid };
      }
      fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      fbData = await fbResp.json();
    }

    // Link message key to Meta mid in Firebase
    if (req.body.msgKey && fbData?.message_id) {
      const rawMid = String(fbData.message_id);
      const safeMid = rawMid.replace(/[.#$\[\]\/]/g, '_');
      const custTarget = cleanPsid.startsWith('fb_') ? cleanPsid : `fb_${cleanPsid}`;
      Promise.all([
        fetch(`${FIREBASE_DB_URL}/customerChats/${custTarget}/messages/${req.body.msgKey}/mid.json`, {
          method: "PUT",
          body: JSON.stringify(safeMid)
        }),
        fetch(`${FIREBASE_DB_URL}/customerChats/${custTarget}/messages/${req.body.msgKey}/metaMid.json`, {
          method: "PUT",
          body: JSON.stringify(rawMid)
        }),
        fetch(`${FIREBASE_DB_URL}/customerChats/${custTarget}/midIndex/${safeMid}.json`, {
          method: "PUT",
          body: JSON.stringify(req.body.msgKey)
        }),
        fetch(`${FIREBASE_DB_URL}/customerChats/${custTarget}/midIndex/${rawMid}.json`, {
          method: "PUT",
          body: JSON.stringify(req.body.msgKey)
        })
      ]).catch(() => {});
    }

    return res.status(fbResp.status).json(fbData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Outbound Reaction Endpoint: Send reaction/unreact from Lokalex Rider to Messenger Customer
app.post('/api/send-reaction', async (req, res) => {
  try {
    const { recipientId, mid, emoji, action = "react", tokenOverride, apiId } = req.body;

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
    let cleanMid = String(mid || "");
    if (cleanMid.startsWith("mid__")) {
      cleanMid = cleanMid.replace(/^mid__/, "mid.$");
    }

    const sendBody = {
      recipient: { id: cleanPsid },
      sender_action: action === "unreact" ? "unreact" : "react",
      payload: {
        message_id: cleanMid
      }
    };
    if (action !== "unreact" && emoji) {
      sendBody.payload.reaction = emoji;
    }

    const fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendBody),
    });

    const rawText = await fbResp.text();
    let fbData = null;
    try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }

    return res.status(fbResp.status).json(fbData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Resolves a Meta message ID (mid) to the actual Firebase message object and key.
 */
async function resolveMessageByMid(dbUrl, custId, targetMid, timestamp = null, token = null) {
  if (!targetMid) return null;
  const rawMid = String(targetMid);
  const safeMid = rawMid.replace(/[.#$\[\]\/]/g, "_");

  // 1. Direct check: Is there a message with key safeMid? (Used for incoming customer messages)
  try {
    const directResp = await fetch(`${dbUrl}/customerChats/${custId}/messages/${safeMid}.json`);
    if (directResp.ok) {
      const msg = await directResp.json();
      if (msg && (msg.text || msg.imageUrl || msg.type)) {
        return { key: safeMid, message: msg };
      }
    }
  } catch (_) {}

  // 2. Index check: Did midIndex map this Meta mid to a Firebase push key?
  try {
    for (const keyToTry of [safeMid, rawMid]) {
      const indexResp = await fetch(`${dbUrl}/customerChats/${custId}/midIndex/${encodeURIComponent(keyToTry)}.json`);
      if (indexResp.ok) {
        const mappedKey = await indexResp.json();
        if (mappedKey && typeof mappedKey === "string") {
          const mappedResp = await fetch(`${dbUrl}/customerChats/${custId}/messages/${mappedKey}.json`);
          if (mappedResp.ok) {
            const msg = await mappedResp.json();
            if (msg) return { key: mappedKey, message: msg };
          }
        }
      }
    }
  } catch (_) {}

  // 3. Shallow scan: Check existing Firebase message keys first (so rider push keys like -P... are found!)
  try {
    const shallowResp = await fetch(`${dbUrl}/customerChats/${custId}/messages.json?shallow=true`);
    if (shallowResp.ok) {
      const keysObj = await shallowResp.json();
      if (keysObj && typeof keysObj === "object" && !keysObj.error) {
        if (keysObj[safeMid]) {
          const mResp = await fetch(`${dbUrl}/customerChats/${custId}/messages/${safeMid}.json`);
          if (mResp.ok) {
            const m = await mResp.json();
            if (m) return { key: safeMid, message: m };
          }
        }
        const sortedKeys = Object.keys(keysObj).sort().slice(-15).reverse();
        for (const k of sortedKeys) {
          const mResp = await fetch(`${dbUrl}/customerChats/${custId}/messages/${k}.json`);
          if (mResp.ok) {
            const m = await mResp.json();
            if (m && (m.mid === safeMid || m.mid === rawMid || m.metaMid === rawMid || m.metaMid === safeMid)) {
              return { key: k, message: m };
            }
          }
        }
      }
    }
  } catch (_) {}

  // 4. Direct Meta Single Message Node check (Fallback if message not found in Firebase RTDB)
  if (token) {
    try {
      const metaResp = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(rawMid)}?fields=id,message,from,attachments&access_token=${token}`);
      if (metaResp.ok) {
        const metaData = await metaResp.json();
        if (metaData && (metaData.message !== undefined || metaData.attachments)) {
          const fromName = metaData.from?.name || (metaData.from?.id ? "Rider" : "User");
          let refText = metaData.message || (metaData.attachments?.data?.[0]?.type ? `📷 ${metaData.attachments.data[0].type}` : "Message");
          refText = refText.replace(/^💬 In reply to [^\n]+\n\n/, '');
          return {
            key: safeMid,
            message: {
              text: refText,
              sender: fromName,
              mid: safeMid,
              metaMid: rawMid
            }
          };
        }
      }
    } catch (_) {}

    // 4b. Query conversation messages for this user (Conversations API)
    try {
      const senderId = custId.replace(/^fb_/, '');
      const convUrl = `https://graph.facebook.com/v19.0/me/conversations?user_id=${senderId}&fields=messages.limit(20){id,message,from,created_time,attachments}&access_token=${token}`;
      const convResp = await fetch(convUrl);
      if (convResp.ok) {
        const convData = await convResp.json();
        const msgList = convData?.data?.[0]?.messages?.data || [];
        const found = msgList.find(m => m.id === rawMid || m.id === safeMid);
        if (found) {
          const fromName = found.from?.name || (found.from?.id ? "Customer" : "User");
          let refText = found.message || (found.attachments?.data?.[0]?.type ? `📷 ${found.attachments.data[0].type}` : "Message");
          refText = refText.replace(/^💬 In reply to [^\n]+\n\n/, '');
          return {
            key: safeMid,
            message: {
              text: refText,
              sender: fromName,
              mid: safeMid,
              metaMid: rawMid
            }
          };
        }
      }
    } catch (_) {}
  }

  // 5. Chronological Fallback: Find the most recent rider message before this event
  try {
    const shallowResp = await fetch(`${dbUrl}/customerChats/${custId}/messages.json?shallow=true`);
    if (shallowResp.ok) {
      const keysObj = await shallowResp.json();
      if (keysObj && typeof keysObj === "object" && !keysObj.error) {
        const sortedKeys = Object.keys(keysObj).sort().slice(-10).reverse();
        for (const k of sortedKeys) {
          const mResp = await fetch(`${dbUrl}/customerChats/${custId}/messages/${k}.json`);
          if (mResp.ok) {
            const m = await mResp.json();
            if (m && m.isRider && (!timestamp || Number(m.timestamp || 0) <= Number(timestamp || Date.now()))) {
              return { key: k, message: m };
            }
          }
        }
      }
    }
  } catch (_) {}

  return null;
}

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
        // 0. Handle customer reactions (likes, hearts, emojis on messages)
        if (item.reaction) {
          const senderId = item.sender?.id;
          if (!senderId) continue;
          const custId = `fb_${senderId}`;
          const rawMid = item.reaction.mid;
          const emoji = item.reaction.emoji || "";
          const action = item.reaction.action || "react";

          if (rawMid) {
            let token = PAGE_ACCESS_TOKEN;
            if (!token) {
              try {
                const apiResp = await fetch(`${FIREBASE_DB_URL}/adminSettings/facebookApis/${DEFAULT_API_ID}.json`);
                if (apiResp.ok) {
                  const apiData = await apiResp.json();
                  if (apiData?.pageAccessToken) token = apiData.pageAccessToken.trim();
                }
              } catch(e) {}
            }
            let targetKey = String(rawMid).replace(/[.#$\[\]\/]/g, "_");
            try {
              const resolved = await resolveMessageByMid(FIREBASE_DB_URL, custId, rawMid, item.timestamp || Date.now(), token);
              if (resolved && resolved.key) {
                targetKey = resolved.key;
              }
            } catch (e) {
              console.warn("Failed to resolve reaction targetKey:", e);
            }

            if (action === "unreact") {
              if (emoji) {
                await fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/messages/${targetKey}/reactions/${encodeURIComponent(emoji)}/${senderId}.json`, { method: "DELETE" }).catch(() => {});
              }
              // Meta often omits emoji on unreact. Remove senderId from all reaction entries on this message
              try {
                const allReactionsResp = await fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/messages/${targetKey}/reactions.json`);
                if (allReactionsResp.ok) {
                  const allReactions = await allReactionsResp.json();
                  if (allReactions && typeof allReactions === "object") {
                    for (const [rxEmoji, rxUsers] of Object.entries(allReactions)) {
                      if (rxUsers && typeof rxUsers === "object" && rxUsers[senderId]) {
                        await fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/messages/${targetKey}/reactions/${encodeURIComponent(rxEmoji)}/${senderId}.json`, { method: "DELETE" }).catch(() => {});
                      }
                    }
                  }
                }
              } catch(e) {}
            } else {
              const reactionEmoji = emoji || "👍";
              const reactionUrl = `${FIREBASE_DB_URL}/customerChats/${custId}/messages/${targetKey}/reactions/${encodeURIComponent(reactionEmoji)}/${senderId}.json`;
              await fetch(reactionUrl, { method: "PUT", body: "true" }).catch(() => {});
            }

            // Trigger realtime updates
            await Promise.all([
              fetch(`${FIREBASE_DB_URL}/customerChatMeta/${custId}/lastUpdated.json`, {
                method: "PUT",
                body: JSON.stringify(Date.now())
              }),
              fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/metadata/lastUpdated.json`, {
                method: "PUT",
                body: JSON.stringify(Date.now())
              })
            ]).catch(() => {});
          }
          continue;
        }

// 0.05 Handle customer message edits (Meta Messenger message_edits)
        if (item.message_edit) {
          const senderId = item.sender?.id;
          if (!senderId) continue;
          const custId = `fb_${senderId}`;
          const rawMid = item.message_edit.mid;
          const newText = (item.message_edit.text || "").trim();
          const numEdit = item.message_edit.num_edit || 1;
          const editTimestamp = item.timestamp || Date.now();

          if (rawMid && newText) {
            let token = PAGE_ACCESS_TOKEN;
            let targetKey = String(rawMid).replace(/[.#$\[\]\/]/g, "_");
            let existingMsg = null;
            try {
              const resolved = await resolveMessageByMid(FIREBASE_DB_URL, custId, rawMid, editTimestamp, token);
              if (resolved && resolved.key) {
                targetKey = resolved.key;
                existingMsg = resolved.message;
              }
            } catch(e) {
              console.warn("Failed to resolve message_edit targetKey:", e);
            }

            const origText = existingMsg?.originalText || existingMsg?.text || existingMsg?.message || "";
            const msgEditPatch = {
              [`/customerChats/${custId}/messages/${targetKey}/text`]: newText,
              [`/customerChats/${custId}/messages/${targetKey}/message`]: newText,
              [`/customerChats/${custId}/messages/${targetKey}/isEdited`]: true,
              [`/customerChats/${custId}/messages/${targetKey}/editedAt`]: editTimestamp,
              [`/customerChats/${custId}/messages/${targetKey}/numEdit`]: numEdit,
              [`/customerChatMeta/${custId}/lastUpdated`]: editTimestamp,
              [`/customerChatMeta/${custId}/lastMessage`]: newText,
              [`/customerChats/${custId}/metadata/lastUpdated`]: editTimestamp,
              [`/customerChats/${custId}/metadata/lastMessage`]: newText
            };
            if (origText && origText !== newText) {
              msgEditPatch[`/customerChats/${custId}/messages/${targetKey}/originalText`] = origText;
              msgEditPatch[`/customerChats/${custId}/messages/${targetKey}/previousText`] = existingMsg?.previousText || origText;
            }

            await fetch(`${FIREBASE_DB_URL}/.json`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(msgEditPatch)
            }).catch((err) => console.warn("Failed to patch message_edit to Firebase RTDB:", err));
          }
          continue;
        }

                // 0.1 Handle customer read receipts (Meta Messenger message_reads)
        if (item.read) {
          const senderId = item.sender?.id;
          if (!senderId) continue;
          const custId = `fb_${senderId}`;
          const watermark = item.read.watermark || item.timestamp || Date.now();

          await Promise.all([
            fetch(`${FIREBASE_DB_URL}/customerChatMeta/${custId}/customerLastSeenTimestamp.json`, {
              method: "PUT",
              body: JSON.stringify(watermark)
            }),
            fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/metadata/customerLastSeenTimestamp.json`, {
              method: "PUT",
              body: JSON.stringify(watermark)
            })
          ]).catch(() => {});

          try {
            const msgsResp = await fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/messages.json?orderBy="timestamp"&endAt=${watermark}&limitToLast=10`);
            if (msgsResp.ok) {
              const msgs = await msgsResp.json();
              if (msgs && typeof msgs === "object") {
                const updates = {};
                for (const [mKey, mVal] of Object.entries(msgs)) {
                  if (mVal && (mVal.isRider || mVal.senderType === 'rider') && mVal.status !== 'seen') {
                    if (!mVal.mid && !mVal.metaMid) continue;
                    if (mVal.status === 'failed' || mVal.failed) continue;
                    updates[`/customerChats/${custId}/messages/${mKey}/status`] = "seen";
                    updates[`/customerChats/${custId}/messages/${mKey}/seenAt`] = watermark;
                  }
                }
                if (Object.keys(updates).length > 0) {
                  await fetch(`${FIREBASE_DB_URL}/.json`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updates)
                  }).catch(() => {});
                }
              }
            }
          } catch(e) {
            console.warn("Failed to mark messages seen in Firebase:", e);
          }
          continue;
        }

        if (!item.message || item.message.is_echo) continue;

        const senderId = item.sender?.id;
        if (!senderId) continue;

        const custId = `fb_${senderId}`;
        const timestamp = item.timestamp || Date.now();
        const rawMetaMid = item.message.mid ? String(item.message.mid) : null;
        const mid = rawMetaMid ? rawMetaMid.replace(/[.#$\[\]\/]/g, '_') : `msg_${timestamp}`;
        let messageText = item.message.text || "";
        let hasAttachment = false;
        const images = [];
        let videoUrl = null;
        let audioUrl = null;
        let docUrl = null;
        let docName = "Document";
        let stickerId = item.message.sticker_id || null;
        let isLikeSticker = Boolean(stickerId);

        // Check attachments in webhook payload
        if (Array.isArray(item.message.attachments) && item.message.attachments.length > 0) {
          hasAttachment = true;
          for (const att of item.message.attachments) {
            const attType = (att.type || "").toLowerCase();
            const payload = att.payload || {};
            const u = payload.url || att.url || null;
            if (payload.sticker_id) {
              stickerId = payload.sticker_id;
              isLikeSticker = true;
            }

            if (attType === "image") {
              if (u) {
                if (u.includes('369239') || u.includes('sticker') || u.includes('like') || Boolean(stickerId)) {
                  isLikeSticker = true;
                }
                if (!images.includes(u)) images.push(u);
              }
            } else if (attType === "video") {
              if (u && !videoUrl) videoUrl = u;
            } else if (attType === "audio" || attType === "voice") {
              if (u && !audioUrl) audioUrl = u;
            } else if (attType === "file") {
              if (u && !docUrl) {
                docUrl = u;
                if (payload.title) docName = payload.title;
              }
            } else if (u) {
              // Fallback categorization based on URL extension
              const cleanU = u.split('?')[0].split('#')[0].toLowerCase();
              if (/\.(mp4|mov|webm|3gp|mkv)$/i.test(cleanU) || cleanU.includes('video.xx.fbcdn.net')) {
                if (!videoUrl) videoUrl = u;
              } else if (/\.(aac|mp3|m4a|wav|ogg|opus)$/i.test(cleanU) || cleanU.includes('audioclip')) {
                if (!audioUrl) audioUrl = u;
              } else if (/\.(pdf|docx?|xlsx?|csv|pptx?|txt|zip|rar|7z|apk)$/i.test(cleanU)) {
                if (!docUrl) {
                  docUrl = u;
                  const parts = cleanU.split('/');
                  docName = decodeURIComponent(parts[parts.length - 1] || 'Document');
                }
              } else {
                if (!images.includes(u)) images.push(u);
              }
            }
          }
        }

        const pageId = item.recipient?.id || entry.id || "1098954353295816";

        // 1. Fast in-memory customer check (0ms) before hitting Firebase
        let existingCustomer = MEM_CUSTOMER_CACHE.get(custId);
        let existingCustomerName = existingCustomer?.customerName || null;
        let existingAvatarUrl = existingCustomer?.avatarUrl || null;
        let existingFolder = existingCustomer?.folder || null;
        let existingCateredRider = existingCustomer?.cateredBy || null;
        let existingCateredRiderId = existingCustomer?.cateredById || null;
        let existingStatus = existingCustomer?.status || null;

        if (!existingCustomer) {
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

                MEM_CUSTOMER_CACHE.set(custId, {
                  customerName: existingCustomerName,
                  avatarUrl: existingAvatarUrl,
                  folder: existingFolder,
                  cateredBy: existingCateredRider,
                  cateredById: existingCateredRiderId,
                  status: existingStatus
                });
              }
            }
          } catch(e) {}
        }

        // 2. Fast Page Access Token & Page ID retrieval using memory cache (0ms)
        let token = PAGE_ACCESS_TOKEN || MEM_TOKEN_CACHE.token;
        let resolvedPageId = pageId || MEM_TOKEN_CACHE.pageId;
        if (!token || (Date.now() - MEM_TOKEN_CACHE.fetchedAt > 300000)) {
          try {
            const apiResp = await fetch(`${FIREBASE_DB_URL}/adminSettings/facebookApis/${DEFAULT_API_ID}.json`);
            if (apiResp.ok) {
              const apiData = await apiResp.json();
              if (apiData?.pageAccessToken) {
                token = apiData.pageAccessToken.trim();
                MEM_TOKEN_CACHE.token = token;
                MEM_TOKEN_CACHE.fetchedAt = Date.now();
              }
              if (apiData?.pageId) {
                resolvedPageId = apiData.pageId.trim();
                MEM_TOKEN_CACHE.pageId = resolvedPageId;
              }
            }
          } catch(e) {}
        }

        // Fallback: If message has attachments but media wasn't in webhook payload, query Meta Graph API
        if (hasAttachment && images.length === 0 && !videoUrl && !audioUrl && !docUrl && token && item.message.mid) {
          try {
            const midResp = await fetch(`https://graph.facebook.com/v19.0/${item.message.mid}?fields=attachments&access_token=${token}`);
            if (midResp.ok) {
              const midData = await midResp.json();
              const attachments = midData?.attachments?.data || [];
              for (const att of attachments) {
                const attType = (att?.type || "").toLowerCase();
                const mime = (att?.mime_type || "").toLowerCase();
                const u = att?.image_data?.url || 
                          att?.video_data?.url || 
                          att?.audio_data?.url || 
                          att?.payload?.url || 
                          att?.media?.image?.src || 
                          att?.file_url;

                if (attType === 'audio' || attType === 'voice' || mime.includes('audio') || (u && (/\.(aac|mp3|m4a|wav|ogg|opus)/i.test(u) || u.includes('audioclip')))) {
                  if (u && !audioUrl) audioUrl = u;
                } else if (attType === 'video' || mime.includes('video') || (u && (/\.(mp4|mov|webm|3gp|mkv)/i.test(u) || u.includes('video.xx.fbcdn.net')))) {
                  if (u && !videoUrl) videoUrl = u;
                } else if (attType === 'file' || (u && /\.(pdf|docx?|xlsx?|csv|zip|rar|txt)/i.test(u))) {
                  if (u && !docUrl) docUrl = u;
                } else {
                  if (Array.isArray(att?.subattachments?.data)) {
                    for (const sub of att.subattachments.data) {
                      const subUrl = sub?.image_data?.url || sub?.video_data?.url || sub?.audio_data?.url || sub?.media?.image?.src || sub?.payload?.url || sub?.file_url;
                      if (subUrl && !images.includes(subUrl)) images.push(subUrl);
                    }
                  }
                  if (u && !images.includes(u)) {
                    images.push(u);
                  }
                }
              }
            }
          } catch(e) {
            console.warn("Failed to fetch attachment via Graph API:", e);
          }
        }

        const primaryImageUrl = images.length > 0 ? images[0] : null;

        if (!messageText) {
          if (isLikeSticker) {
            messageText = "👍";
          } else if (images.length > 1) {
            messageText = `📷 ${images.length} Photos`;
          } else if (images.length === 1) {
            messageText = "📷 Photo";
          } else if (videoUrl) {
            messageText = "🎥 Video";
          } else if (audioUrl) {
            messageText = "🎤 Voice message";
          } else if (docUrl) {
            messageText = `📄 ${docName}`;
          } else if (hasAttachment) {
            messageText = "[Facebook attachment]";
          } else {
            messageText = "Facebook Message";
          }
        }

        let customerName = existingCustomerName || `FB Customer (${senderId.slice(-4)})`;
        let avatarUrl = existingAvatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=0084FF&color=fff`;

        const needsNameResolution = !existingCustomerName || existingCustomerName.startsWith("FB Customer (");
        const needsAvatarResolution = !existingAvatarUrl || existingAvatarUrl.includes("ui-avatars.com");

        // 3. Resolve customer name and real Facebook profile picture via Facebook Graph API
        if (token && (needsNameResolution || needsAvatarResolution)) {
          // Method A: Page Conversations API (Retrieves participant name & picture from conversation)
          try {
            const convResp = await fetch(
              `https://graph.facebook.com/v19.0/${resolvedPageId || 'me'}/conversations?user_id=${senderId}&fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&access_token=${token}`
            );
            if (convResp.ok) {
              const convData = await convResp.json();
              if (Array.isArray(convData.data) && convData.data.length > 0) {
                const participants = [
                  ...(convData.data[0].participants?.data || []),
                  ...(convData.data[0].senders?.data || [])
                ];
                const matched = participants.find(p => String(p.id) === String(senderId));
                if (matched) {
                  if (matched.name && needsNameResolution) {
                    customerName = matched.name.trim();
                  }
                  if (matched.picture?.data?.url && !matched.picture.data.is_silhouette) {
                    avatarUrl = matched.picture.data.url;
                  }
                }
              }
            }
          } catch (e) {
            console.warn("Conversations API lookup note:", e);
          }

          // Method B: Direct PSID Node API (Retrieves real profile picture when Advanced Access / Live mode is active)
          try {
            const profileResp = await fetch(
              `https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name,name,profile_pic,picture.type(large)&access_token=${token}`
            );
            if (profileResp.ok) {
              const profile = await profileResp.json();
              const fullName = profile.name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
              if (fullName && needsNameResolution) customerName = fullName;
              if (profile.picture?.data?.url && !profile.picture.data.is_silhouette) {
                avatarUrl = profile.picture.data.url;
              } else if (profile.profile_pic) {
                avatarUrl = profile.profile_pic;
              }
            }
          } catch (e) {
            console.warn("Direct PSID profile lookup note:", e);
          }
        }

        // Resolve quoted reply_to message if present
        let replyTo = null;
        if (item.message.reply_to?.mid) {
          const refMid = item.message.reply_to.mid;
          try {
            const resolved = await resolveMessageByMid(FIREBASE_DB_URL, custId, refMid, timestamp, token);
            if (resolved && resolved.message) {
              const refMsg = resolved.message;
              let previewText = String(refMsg.text || refMsg.message || (refMsg.imageUrl ? "📷 Photo" : (refMsg.locationCoords ? "📍 Location" : "Message"))).substring(0, 140);
              previewText = previewText.replace(/^💬 In reply to [^\n]+\n\n/, '');
              replyTo = {
                id: resolved.key,
                mid: refMid,
                text: previewText,
                sender: refMsg.sender || refMsg.from?.name || (refMsg.isRider ? "Rider" : customerName),
                imageUrl: refMsg.imageUrl || null,
                timestamp: refMsg.timestamp || refMsg.created_time || null
              };
            }
          } catch (e) {
            console.warn("Failed to resolve reply_to message:", e);
          }
        }

        const isCurrentlyCatered = (existingFolder === 'catering') && Boolean(existingCateredRider || existingCateredRiderId) && existingStatus !== 'completed' && existingStatus !== 'done' && existingStatus !== 'cancelled';
        const resolvedFolder = isCurrentlyCatered 
          ? 'catering' 
          : (existingFolder === 'followup' ? 'followup' : 'inbox');

        let lastSummary = messageText;
        if (isLikeSticker) {
          lastSummary = "👍 Liked";
        } else if (images.length > 1) {
          lastSummary = `📷 ${images.length} Photos`;
        } else if (images.length === 1 && (!item.message.text || !item.message.text.trim())) {
          lastSummary = "📷 Photo";
        } else if (videoUrl && (!item.message.text || !item.message.text.trim())) {
          lastSummary = "🎥 Video";
        } else if (audioUrl && (!item.message.text || !item.message.text.trim())) {
          lastSummary = "🎤 Voice message";
        } else if (docUrl && (!item.message.text || !item.message.text.trim())) {
          lastSummary = `📄 ${docName}`;
        }

        const threadMeta = {
          customerName,
          avatarUrl,
          lastMessage: lastSummary,
          lastUpdated: timestamp,
          folder: resolvedFolder,
          status: 'active',
          channel: "messenger",
          apiId: DEFAULT_API_ID,
          apiName: DEFAULT_API_NAME,
          unreadForRider: true
        };
        if (isCurrentlyCatered) {
          if (existingCateredRider) threadMeta.cateredByRiderName = existingCateredRider;
          if (existingCateredRiderId) threadMeta.cateredByRiderId = existingCateredRiderId;
          threadMeta.cateredBy = existingCateredRider || null;
        } else {
          threadMeta.cateredByRiderName = null;
          threadMeta.cateredByRiderId = null;
          threadMeta.cateredBy = null;
        }

        const chatMsg = {
          sender: customerName,
          senderType: "customer",
          avatarUrl,
          text: messageText,
          timestamp,
          isRider: false,
          status: "delivered",
          channel: "messenger",
          apiId: DEFAULT_API_ID,
          mid
        };
        if (rawMetaMid) {
          chatMsg.metaMid = rawMetaMid;
        }
        if (replyTo) {
          chatMsg.replyTo = replyTo;
        }

        if (isLikeSticker) {
          chatMsg.isSticker = true;
          chatMsg.stickerId = stickerId || 369239263222822;
          chatMsg.stickerType = 'like';
          chatMsg.type = 'sticker';
          chatMsg.imageUrl = primaryImageUrl || 'https://static.xx.fbcdn.net/images/emoji.php/v9/t80/1/16/1f44d.png';
        } else if (images.length > 0) {
          chatMsg.images = images;
          chatMsg.imageUrl = primaryImageUrl;
          chatMsg.type = 'image';
        }

        if (videoUrl) {
          chatMsg.videoUrl = videoUrl;
          if (!chatMsg.type || chatMsg.type === 'text') chatMsg.type = 'video';
        }
        if (audioUrl) {
          chatMsg.audioUrl = audioUrl;
          if (!chatMsg.type || chatMsg.type === 'text') chatMsg.type = 'audio';
        }
        if (docUrl) {
          chatMsg.fileUrl = docUrl;
          chatMsg.fileName = docName;
          if (!chatMsg.type || chatMsg.type === 'text') chatMsg.type = 'file';
        }

        try {
          // Multi-Path Atomic Single PATCH to Firebase Realtime Database (<60ms)
          const multiPathPayload = {
            [`/customerChatMeta/${custId}`]: threadMeta,
            [`/customerChats/${custId}/metadata`]: threadMeta,
            [`/customerChats/${custId}/messages/${mid}`]: chatMsg,
            [`/customerChats/${custId}/midIndex/${mid}`]: mid,
          };
          if (rawMetaMid && rawMetaMid !== mid) {
            multiPathPayload[`/customerChats/${custId}/midIndex/${rawMetaMid}`] = mid;
          }

          await fetch(`${FIREBASE_DB_URL}/.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(multiPathPayload)
          });

          // Update in-memory customer cache for subsequent messages
          MEM_CUSTOMER_CACHE.set(custId, {
            customerName: customerName,
            avatarUrl: avatarUrl,
            folder: resolvedFolder,
            cateredBy: isCurrentlyCatered ? existingCateredRider : null,
            cateredById: isCurrentlyCatered ? existingCateredRiderId : null,
            status: 'active'
          });

          console.log(`⚡ Fast-path message from ${customerName} saved atomically to Firebase!`);

          // FULL BOOKING AUTO-REPLY HOOK:
          try {
            const fbSettingsResp = await fetch(`${FIREBASE_DB_URL}/settings/fullBooking.json`);
            if (fbSettingsResp.ok) {
              const fbSettings = await fbSettingsResp.json();
              if (fbSettings && fbSettings.enabled && resolvedFolder === 'inbox') {
                // Availability gate: If there is at least ONE available rider on roster, DO NOT auto-reply!
                let hasAvailableRider = false;
                try {
                  const rosterResp = await fetch(`${FIREBASE_DB_URL}/roster.json`);
                  if (rosterResp.ok) {
                    const rosterData = await rosterResp.json();
                    if (rosterData && typeof rosterData === 'object') {
                      hasAvailableRider = Object.values(rosterData).some(m => {
                        if (!m) return false;
                        const st = (m.status || '').trim().toLowerCase();
                        const isBreak = Boolean(m.isBreak || st === 'break');
                        return st === 'available' && !isBreak;
                      });
                    }
                  }
                } catch (_) {}

                if (!hasAvailableRider) {
                  const twelveHours = 12 * 60 * 60 * 1000;
                  const sessionStartTime = Number(fbSettings.updatedAt) || 0;
                  let lastReplied = 0;
                  try {
                    const metaCheck = await fetch(`${FIREBASE_DB_URL}/customerChatMeta/${custId}/fullBookingRepliedAt.json`);
                    if (metaCheck.ok) lastReplied = Number(await metaCheck.json()) || 0;
                  } catch (_) {}

                  const now = Date.now();
                  const alreadyRepliedInSession = lastReplied && (
                    (now - lastReplied < twelveHours) ||
                    (sessionStartTime && lastReplied >= sessionStartTime)
                  );

                  if (!alreadyRepliedInSession) {
                    // Pre-claim timestamp in Firebase to atomically lock against concurrent client dispatches
                    await fetch(`${FIREBASE_DB_URL}/customerChatMeta/${custId}/fullBookingRepliedAt.json`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(now)
                    }).catch(() => {});

                  const autoReplyText = String(fbSettings.message || "Paumanhin po, Full Booking na po kami sa ngayon. Mag-a-update po kami kapag available na ulit ang aming delivery service. Maraming salamat po sa pag-unawa! 🛵🙏").trim();

                  // Send to Meta Graph API
                  if (token) {
                    await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        messaging_type: "RESPONSE",
                        recipient: { id: senderId },
                        message: { text: autoReplyText }
                      })
                    });
                  }

                  const autoReplyMid = `auto_${now}`;
                  const autoReplyMsg = {
                    sender: "Lokalex Auto-Reply",
                    senderType: "system",
                    text: autoReplyText,
                    timestamp: now,
                    isRider: true,
                    status: "sent",
                    channel: "messenger",
                    apiId: DEFAULT_API_ID,
                    isAutoReply: true
                  };

                  const updatePayload = {
                    lastMessage: `You: ${autoReplyText}`,
                    lastUpdated: now,
                    unreadForRider: false,
                    fullBookingRepliedAt: now
                  };

                  await Promise.all([
                    fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/messages/${autoReplyMid}.json`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(autoReplyMsg)
                    }),
                    fetch(`${FIREBASE_DB_URL}/customerChatMeta/${custId}.json`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(updatePayload)
                    }),
                    fetch(`${FIREBASE_DB_URL}/customerChats/${custId}/metadata.json`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(updatePayload)
                    })
                  ]);
                  console.log(`🛑 Sent Full Booking auto-reply to ${customerName} on Messenger!`);
                }
              }
            }
          }
        } catch (autoErr) {
            console.warn("Full booking auto-reply check in server error:", autoErr);
          }
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

