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

        const fbResp = await fetch("https://graph.facebook.com/v19.0/me/messages?access_token=" + token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: cleanPsid },
            message: msgPayload,
          }),
        });

        const fbData = await fbResp.json();
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
 * Handles incoming Meta Messenger entries and writes them to Firebase RTDB
 */
async function processMetaEntries(entries, cfg) {
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (!Array.isArray(entry.messaging)) continue;

    for (const item of entry.messaging) {
      // Ignore echoes (messages sent by our own page) and delivery receipts
      if (!item.message || item.message.is_echo) continue;

      const senderId = item.sender?.id;
      if (!senderId) continue;

      const custId = `fb_${senderId}`;
      const timestamp = item.timestamp || Date.now();
      const mid = item.message.mid ? String(item.message.mid).replace(/[.#$\[\]\/]/g, "_") : `msg_${timestamp}`;

      let messageText = item.message.text || "";
      let hasAttachment = false;

      if (!messageText && Array.isArray(item.message.attachments) && item.message.attachments.length > 0) {
        const attType = item.message.attachments[0].type || "attachment";
        messageText = `📷 [Facebook ${attType}]`;
        hasAttachment = true;
      }

      if (!messageText) {
        messageText = "Facebook Message";
      }

      // Fetch customer profile name if Page Access Token is available (or stored in Firebase)
      let customerName = `FB Customer (${senderId.slice(-4)})`;
      let avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=0084FF&color=fff`;

      let token = cfg.pageAccessToken;
      if (!token) {
        try {
          const tokenResp = await fetch(`${cfg.dbUrl}/adminSettings/facebookApis/${cfg.defaultApiId}/pageAccessToken.json`);
          if (tokenResp.ok) {
            const val = await tokenResp.json();
            if (typeof val === 'string' && val.trim()) {
              token = val.trim();
            }
          }
        } catch(e) {}
      }

      if (token) {
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
          console.warn("Failed to fetch FB profile:", e);
        }
      }

      // 1. Thread Metadata Payload (Lokalex Live Chat Feed)
      const threadMeta = {
        customerName: customerName,
        avatarUrl: avatarUrl,
        lastMessage: messageText,
        lastUpdated: timestamp,
        folder: "inbox",
        channel: "messenger",
        apiId: cfg.defaultApiId,
        apiName: cfg.defaultApiName,
        unreadForRider: true,
      };

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
        ]);

        console.log(`✅ Message from ${customerName} saved to Firebase RTDB!`);
      } catch (err) {
        console.error("Error saving FB message to Firebase:", err);
      }
    }
  }
}

