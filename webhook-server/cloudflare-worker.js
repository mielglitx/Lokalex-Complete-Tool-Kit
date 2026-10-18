/**
 * ============================================================================
 * LOKALEX DISPATCH - FACEBOOK MESSENGER TO FIREBASE CLOUDFLARE WORKER
 * ============================================================================
 * 
 * Instructions:
 * 1. Log in to https://dash.cloudflare.com/ (100% Free)
 * 2. Go to "Workers & Pages" -> Click "Create application" -> "Create Worker"
 * 3. Name your worker (e.g. "lokalex-messenger-webhook") and click "Deploy"
 * 4. Click "Edit code", paste this entire script, and click "Save and Deploy"
 * 5. Copy your worker URL (e.g. https://lokalex-messenger-webhook.yourname.workers.dev)
 * 6. In Meta for Developers (Messenger -> Webhooks):
 *    - Callback URL: https://lokalex-messenger-webhook.yourname.workers.dev/webhook
 *    - Verify Token: Test1234
 *    - Click "Verify and Save", then subscribe to "messages"
 * ============================================================================
 */

const CONFIG = {
  // Your Firebase Realtime Database URL
  FIREBASE_DB_URL: "https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app",
  
  // The Verify Token you entered in Lokalex Admin Settings & Meta Dashboard
  VERIFY_TOKEN: "Test1234",
  
  // The Channel ID & Name configured in Lokalex
  DEFAULT_API_ID: "fb_api_1791648211091",
  DEFAULT_API_NAME: "Camiling FB",

  // (Optional) Facebook Page Access Token to fetch customer names and send replies back to Messenger
  // You can set this here or in Cloudflare Worker "Settings" -> "Variables" -> PAGE_ACCESS_TOKEN
  PAGE_ACCESS_TOKEN: "" 
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Use environment variables if set in Cloudflare dashboard, otherwise use default CONFIG
    const verifyToken = env?.VERIFY_TOKEN || CONFIG.VERIFY_TOKEN;
    const dbUrl = env?.FIREBASE_DB_URL || CONFIG.FIREBASE_DB_URL;
    const pageAccessToken = env?.PAGE_ACCESS_TOKEN || CONFIG.PAGE_ACCESS_TOKEN;
    const defaultApiId = env?.DEFAULT_API_ID || CONFIG.DEFAULT_API_ID;
    const defaultApiName = env?.DEFAULT_API_NAME || CONFIG.DEFAULT_API_NAME;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // 1. Meta Webhook Verification (GET /webhook or GET /)
    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === verifyToken) {
        console.log("✅ Meta Webhook verified successfully!");
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response(
        JSON.stringify({
          status: "online",
          version: "2.3.0",
          service: "Lokalex Messenger Webhook Bridge",
          database: dbUrl,
          channel: defaultApiName,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 2. Incoming Messages from Facebook (POST /webhook or POST /)
    if (request.method === "POST" && (pathname === "/webhook" || pathname === "/")) {
      try {
        const body = await request.json();

        if (body.object === "page") {
          // Process events asynchronously
          ctx.waitUntil(
            processMetaEntries(body.entry, {
              dbUrl,
              pageAccessToken,
              defaultApiId,
              defaultApiName,
            })
          );

          // Meta requires immediate 200 OK
          return new Response("EVENT_RECEIVED", { status: 200 });
        }

        return new Response("Not a page event", { status: 404 });
      } catch (err) {
        console.error("Error processing POST webhook:", err);
        return new Response("Bad Request", { status: 400 });
      }
    }

    // 3. Outbound Message Endpoint: Send reply from Lokalex Rider to Messenger Customer
    if (request.method === "POST" && pathname === "/api/send-reply") {
      try {
        const payload = await request.json();
        const { recipientId, text, imageUrl, locationCoords, tokenOverride, apiId } = payload;
        
        let token = tokenOverride || pageAccessToken;
        if (!token) {
          try {
            const tokenResp = await fetch(`${dbUrl}/adminSettings/facebookApis/${apiId || defaultApiId}/pageAccessToken.json`);
            if (tokenResp.ok) {
              const val = await tokenResp.json();
              if (typeof val === 'string' && val.trim()) {
                token = val.trim();
              }
            }
          } catch(e) {
            console.warn("Failed to fetch token from Firebase:", e);
          }
        }

        if (!token) {
          return new Response(
            JSON.stringify({ error: "PAGE_ACCESS_TOKEN not configured in Firebase or worker" }),
            { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }

        // Clean recipient PSID if passed with prefix like 'fb_12345'
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
              const binaryStr = atob(base64Data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: mimeType });

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
        } else if (payload.attachmentId) {
          const sendBody = {
            messaging_type: "RESPONSE",
            recipient: { id: cleanPsid },
            message: {
              attachment: {
                type: "image",
                payload: { attachment_id: payload.attachmentId }
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
          if (payload.replyToMid) {
            sendBody.reply_to = { mid: payload.replyToMid };
          }
          fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sendBody),
          });
          const rawText = await fbResp.text();
          try { fbData = JSON.parse(rawText); } catch (_) { fbData = { error: { message: rawText.slice(0, 120) } }; }
        } else {
          return new Response(
            JSON.stringify({ error: "Empty message payload: neither text nor valid image was provided" }),
            { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }

        // If Meta rejects the reply_to parameter, retry without reply_to
        if (fbResp && !fbResp.ok && payload.replyToMid && (fbData?.error?.message?.toLowerCase().includes('reply_to') || fbData?.error?.code === 100) && typeof text === "string" && text.trim().length > 0) {
          console.warn("⚠️ Worker: reply_to rejected by Meta, retrying without reply_to:", fbData?.error?.message);
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
          if (payload.replyToMid) {
            sendBody.reply_to = { mid: payload.replyToMid };
          }
          fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sendBody),
          });
          fbData = await fbResp.json();
        }

        // Link message key to Meta mid in Firebase
        if (payload.msgKey && fbData?.message_id) {
          const rawMid = String(fbData.message_id);
          const safeMid = rawMid.replace(/[.#$\[\]\/]/g, '_');
          const custTarget = cleanPsid.startsWith('fb_') ? cleanPsid : `fb_${cleanPsid}`;
          ctx.waitUntil(
            Promise.all([
              fetch(`${dbUrl}/customerChats/${custTarget}/messages/${payload.msgKey}/mid.json`, {
                method: "PUT",
                body: JSON.stringify(safeMid)
              }),
              fetch(`${dbUrl}/customerChats/${custTarget}/messages/${payload.msgKey}/metaMid.json`, {
                method: "PUT",
                body: JSON.stringify(rawMid)
              }),
              fetch(`${dbUrl}/customerChats/${custTarget}/midIndex/${safeMid}.json`, {
                method: "PUT",
                body: JSON.stringify(payload.msgKey)
              }),
              fetch(`${dbUrl}/customerChats/${custTarget}/midIndex/${rawMid}.json`, {
                method: "PUT",
                body: JSON.stringify(payload.msgKey)
              })
            ]).catch(() => {})
          );
        }

        return new Response(JSON.stringify(fbData), {
          status: fbResp.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // 4. Outbound Reaction Endpoint: Send reaction/unreact from Lokalex Rider to Messenger Customer
    if (request.method === "POST" && pathname === "/api/send-reaction") {
      try {
        const payload = await request.json();
        const { recipientId, mid, emoji, action = "react", tokenOverride, apiId } = payload;

        let token = tokenOverride || pageAccessToken;
        if (!token) {
          try {
            const tokenResp = await fetch(`${dbUrl}/adminSettings/facebookApis/${apiId || defaultApiId}/pageAccessToken.json`);
            if (tokenResp.ok) {
              const val = await tokenResp.json();
              if (typeof val === 'string' && val.trim()) {
                token = val.trim();
              }
            }
          } catch(e) {
            console.warn("Failed to fetch token from Firebase:", e);
          }
        }

        if (!token) {
          return new Response(
            JSON.stringify({ error: "PAGE_ACCESS_TOKEN not configured in Firebase or worker" }),
            { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
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

        return new Response(JSON.stringify(fbData), {
          status: fbResp.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

/**
 * Resolves a Meta message ID (mid) to the actual Firebase message object and key.
 * Handles: direct key matching, midIndex mapping, reverse recent message scanning,
 * and chronological fallback to the last rider message.
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
        // Check the last 15 keys chronologically
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

/**
 * Handles incoming Meta Messenger entries and writes them to Firebase RTDB
 */
async function processMetaEntries(entries, cfg) {
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
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
          let token = cfg.pageAccessToken;
          if (!token) {
            try {
              const apiResp = await fetch(`${cfg.dbUrl}/adminSettings/facebookApis/${cfg.defaultApiId}.json`);
              if (apiResp.ok) {
                const apiData = await apiResp.json();
                if (apiData?.pageAccessToken) token = apiData.pageAccessToken.trim();
              }
            } catch(e) {}
          }
          let targetKey = String(rawMid).replace(/[.#$\[\]\/]/g, "_");
          try {
            const resolved = await resolveMessageByMid(cfg.dbUrl, custId, rawMid, item.timestamp || Date.now(), token);
            if (resolved && resolved.key) {
              targetKey = resolved.key;
            }
          } catch(e) {
            console.warn("Failed to resolve reaction targetKey:", e);
          }

          if (action === "unreact") {
            if (emoji) {
              await fetch(`${cfg.dbUrl}/customerChats/${custId}/messages/${targetKey}/reactions/${encodeURIComponent(emoji)}/${senderId}.json`, { method: "DELETE" }).catch(() => {});
            }
            // Meta often omits emoji on unreact. Remove senderId from all reaction entries on this message
            try {
              const allReactionsResp = await fetch(`${cfg.dbUrl}/customerChats/${custId}/messages/${targetKey}/reactions.json`);
              if (allReactionsResp.ok) {
                const allReactions = await allReactionsResp.json();
                if (allReactions && typeof allReactions === "object") {
                  for (const [rxEmoji, rxUsers] of Object.entries(allReactions)) {
                    if (rxUsers && typeof rxUsers === "object" && rxUsers[senderId]) {
                      await fetch(`${cfg.dbUrl}/customerChats/${custId}/messages/${targetKey}/reactions/${encodeURIComponent(rxEmoji)}/${senderId}.json`, { method: "DELETE" }).catch(() => {});
                    }
                  }
                }
              }
            } catch(e) {}
          } else {
            const reactionEmoji = emoji || "👍";
            const reactionUrl = `${cfg.dbUrl}/customerChats/${custId}/messages/${targetKey}/reactions/${encodeURIComponent(reactionEmoji)}/${senderId}.json`;
            await fetch(reactionUrl, { method: "PUT", body: "true" }).catch(() => {});
          }

          // Trigger realtime thread updates so Lokalex Hub re-renders reaction counts instantly
          await Promise.all([
            fetch(`${cfg.dbUrl}/customerChatMeta/${custId}/lastUpdated.json`, {
              method: "PUT",
              body: JSON.stringify(Date.now())
            }),
            fetch(`${cfg.dbUrl}/customerChats/${custId}/metadata/lastUpdated.json`, {
              method: "PUT",
              body: JSON.stringify(Date.now())
            })
          ]).catch(() => {});
        }
        continue;
      }

      // Ignore echoes (messages sent by our own page) and delivery receipts
      if (!item.message || item.message.is_echo) continue;

      const senderId = item.sender?.id;
      if (!senderId) continue;

      const custId = `fb_${senderId}`;
      const timestamp = item.timestamp || Date.now();
      const rawMetaMid = item.message.mid ? String(item.message.mid) : null;
      const mid = rawMetaMid ? rawMetaMid.replace(/[.#$\[\]\/]/g, "_") : `msg_${timestamp}`;

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

      // Detect Facebook Messenger thumbs-up like stickers
      const stickerId = item.message.sticker_id || (Array.isArray(item.message.attachments) && item.message.attachments[0]?.payload?.sticker_id);
      const isLikeSticker = Boolean(stickerId) || (imageUrl && (imageUrl.includes('369239') || imageUrl.includes('sticker') || imageUrl.includes('like')));

      const pageId = item.recipient?.id || entry.id || "1098954353295816";

      // 1. Check if thread in Firebase already has a valid customer name and existing catering/folder state
      let existingCustomerName = null;
      let existingAvatarUrl = null;
      let existingFolder = null;
      let existingCateredRider = null;
      let existingCateredRiderId = null;
      let existingStatus = null;
      try {
        const metaResp = await fetch(`${cfg.dbUrl}/customerChatMeta/${custId}.json`);
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
      let token = cfg.pageAccessToken;
      let resolvedPageId = pageId;
      if (!token) {
        try {
          const apiResp = await fetch(`${cfg.dbUrl}/adminSettings/facebookApis/${cfg.defaultApiId}.json`);
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
            `https://graph.facebook.com/v19.0/${resolvedPageId || 'me'}/conversations?user_id=${senderId}&fields=participants,senders&access_token=${token}`
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

        // Method B: Direct PSID Node API (Fallback / retrieves high-res profile picture when available)
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

      // Resolve quoted reply_to message if present
      let replyTo = null;
      if (item.message.reply_to?.mid) {
        const refMid = item.message.reply_to.mid;
        try {
          const resolved = await resolveMessageByMid(cfg.dbUrl, custId, refMid, timestamp, token);
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

      // 1. Thread Metadata Payload (Lokalex Live Chat Feed)
      const isCurrentlyCatered = (existingCateredRider || existingCateredRiderId || existingFolder === 'catering') && existingStatus !== 'completed' && existingStatus !== 'done' && existingStatus !== 'cancelled';
      const resolvedFolder = isCurrentlyCatered 
        ? 'catering' 
        : (existingFolder === 'followup' ? 'followup' : 'inbox');

      const threadMeta = {
        customerName: customerName,
        avatarUrl: avatarUrl,
        lastMessage: isLikeSticker ? "👍 Liked" : (imageUrl && (!item.message.text || !item.message.text.trim()) ? "📷 Photo" : messageText),
        lastUpdated: timestamp,
        folder: resolvedFolder,
        status: 'active',
        channel: "messenger",
        apiId: cfg.defaultApiId,
        apiName: cfg.defaultApiName,
        unreadForRider: true,
      };
      if (existingCateredRider) threadMeta.cateredByRiderName = existingCateredRider;
      if (existingCateredRiderId) threadMeta.cateredByRiderId = existingCateredRiderId;

      // 2. Chat Message Payload
      const chatMessage = {
        sender: customerName,
        senderType: "customer",
        text: messageText,
        timestamp: timestamp,
        isRider: false,
        status: "delivered",
        channel: "messenger",
        apiId: cfg.defaultApiId,
        mid: mid,
      };
      if (rawMetaMid) {
        chatMessage.metaMid = rawMetaMid;
      }
      if (replyTo) {
        chatMessage.replyTo = replyTo;
      }

      if (isLikeSticker) {
        chatMessage.isSticker = true;
        chatMessage.stickerId = stickerId || 369239263222822;
        chatMessage.stickerType = 'like';
        if (!chatMessage.text) chatMessage.text = "👍";
      }

      if (imageUrl) {
        chatMessage.imageUrl = imageUrl;
        chatMessage.type = isLikeSticker ? "sticker" : "image";
      }

      try {
        // Write concurrently to Firebase Realtime Database
        await Promise.all([
          // Update feed metadata index
          fetch(`${cfg.dbUrl}/customerChatMeta/${custId}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(threadMeta),
          }),
          // Update conversation metadata
          fetch(`${cfg.dbUrl}/customerChats/${custId}/metadata.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(threadMeta),
          }),
          // Append new message
          fetch(`${cfg.dbUrl}/customerChats/${custId}/messages/${mid}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(chatMessage),
          }),
          // Index mid for future reply_to/reaction lookups
          fetch(`${cfg.dbUrl}/customerChats/${custId}/midIndex/${mid}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mid),
          }),
          ...(rawMetaMid && rawMetaMid !== mid ? [
            fetch(`${cfg.dbUrl}/customerChats/${custId}/midIndex/${rawMetaMid}.json`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(mid),
            })
          ] : [])
        ]);

        console.log(`✅ Message from ${customerName} saved to Firebase RTDB!`);

        // FULL BOOKING AUTO-REPLY HOOK:
        try {
          const fbSettingsResp = await fetch(`${cfg.dbUrl}/settings/fullBooking.json`);
          if (fbSettingsResp.ok) {
            const fbSettings = await fbSettingsResp.json();
            if (fbSettings && fbSettings.enabled && resolvedFolder === 'inbox' && !existingCateredRider && !existingCateredRiderId) {
              // Availability gate: If there is at least ONE available rider on roster, DO NOT auto-reply!
              let hasAvailableRider = false;
              try {
                const rosterResp = await fetch(`${cfg.dbUrl}/roster.json`);
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
                  const metaCheck = await fetch(`${cfg.dbUrl}/customerChatMeta/${custId}/fullBookingRepliedAt.json`);
                  if (metaCheck.ok) lastReplied = Number(await metaCheck.json()) || 0;
                } catch (_) {}

                const now = Date.now();
                const alreadyRepliedInSession = lastReplied && (
                  (now - lastReplied < twelveHours) ||
                  (sessionStartTime && lastReplied >= sessionStartTime)
                );

                if (!alreadyRepliedInSession) {
                  // Pre-claim timestamp in Firebase to atomically lock against concurrent client dispatches
                  await fetch(`${cfg.dbUrl}/customerChatMeta/${custId}/fullBookingRepliedAt.json`, {
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
                  apiId: cfg.defaultApiId,
                  isAutoReply: true
                };

                const updatePayload = {
                  lastMessage: `You: ${autoReplyText}`,
                  lastUpdated: now,
                  unreadForRider: false,
                  fullBookingRepliedAt: now
                };

                await Promise.all([
                  fetch(`${cfg.dbUrl}/customerChats/${custId}/messages/${autoReplyMid}.json`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(autoReplyMsg)
                  }),
                  fetch(`${cfg.dbUrl}/customerChatMeta/${custId}.json`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updatePayload)
                  }),
                  fetch(`${cfg.dbUrl}/customerChats/${custId}/metadata.json`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updatePayload)
                  })
                ]);
                console.log(`🛑 Sent Full Booking auto-reply to ${customerName} on Messenger!`);
              }
            }
          }
        } catch (autoErr) {
          console.warn("Full booking auto-reply check in worker error:", autoErr);
        }
      } catch (err) {
        console.error("Error saving FB message to Firebase:", err);
      }
    }
  }
}

