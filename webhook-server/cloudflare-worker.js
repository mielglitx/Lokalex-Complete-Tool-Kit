/**
 * ============================================================================
 * LOKALEX DISPATCH - DEDICATED SUPABASE CLOUDFLARE WORKER
 * ============================================================================
 * 
 * Worker Name Suggestion: lokalex-supabase-webhook
 * Worker Subdomain: dry-firefly-ee76.lokaledeliver.workers.dev
 * Full Live Worker URL: https://dry-firefly-ee76.lokaledeliver.workers.dev/
 * 
 * Version: 3.0.0 (Pure Supabase Architecture)
 * 
 * Setup Instructions:
 * 1. Log in to https://dash.cloudflare.com/
 * 2. Go to "Workers & Pages" -> Click "Create application" -> "Create Worker"
 * 3. Name your worker: "lokalex-supabase-webhook" and click "Deploy"
 * 4. Click "Edit code", paste this entire script, and click "Save and Deploy"
 * 5. Your worker URL will be:
 *    https://lokalex-supabase-webhook.lokaledeliver.workers.dev
 * ============================================================================
 */

const CONFIG = {
  // Supabase Project REST URL & Service Role / Secret Key (or Anon Key)
  SUPABASE_URL: "https://brdvugzjhkimcyabptcw.supabase.co",
  SUPABASE_KEY: "", // Set via Cloudflare Worker Dashboard -> Settings -> Variables -> SUPABASE_KEY

  // The Verify Token you entered in Lokalex Admin Settings & Meta Dashboard
  VERIFY_TOKEN: "Test1234",
  
  // The Channel ID & Name configured in Lokalex
  DEFAULT_API_ID: "fb_api_1791648211091",
  DEFAULT_API_NAME: "Camiling FB",

  // (Optional) Facebook Page Access Token
  // Can be left empty; worker automatically loads it directly from Supabase admin_settings table!
  PAGE_ACCESS_TOKEN: "",

  // (Optional) Forward raw incoming webhooks to the existing Firebase worker so existing riders never miss a message:
  FIREBASE_FORWARD_URL: ""
};

// Global in-memory caches across worker requests within warm isolates (0ms lookup)
const MEM_TOKEN_CACHE = {
  token: null,
  pageId: null,
  fetchedAt: 0
};
const MEM_CUSTOMER_CACHE = new Map();

// Helper: PostgREST Headers
function getSupabaseHeaders(key) {
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

// Helper: Supabase PostgREST Upsert (single row or array of rows)
async function supabaseUpsert(url, key, table, payload) {
  if (!url || !key) return null;
  try {
    const resp = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        ...getSupabaseHeaders(key),
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    });
    return resp;
  } catch (err) {
    console.warn(`Supabase upsert into ${table} failed:`, err);
    return null;
  }
}

// Helper: Supabase PostgREST Get Row by ID
async function supabaseGetById(url, key, table, id) {
  if (!url || !key || !id) return null;
  try {
    const resp = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      headers: getSupabaseHeaders(key)
    });
    if (resp.ok) {
      const rows = await resp.json();
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    }
  } catch (err) {
    console.warn(`Supabase get from ${table} (${id}) failed:`, err);
  }
  return null;
}

// Helper: Resolve Facebook Page Access Token from Cache or Supabase admin_settings
async function resolveApiCredentials(cfg, apiId) {
  const targetId = apiId || cfg.defaultApiId;
  let token = cfg.pageAccessToken || MEM_TOKEN_CACHE.token;
  let pageId = MEM_TOKEN_CACHE.pageId;

  if (token && (Date.now() - MEM_TOKEN_CACHE.fetchedAt < 300000)) {
    return { token, pageId };
  }

  if (cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      const row = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "admin_settings", "facebookApis");
      if (row && row.data && typeof row.data === "object") {
        const apiConfig = row.data[targetId] || Object.values(row.data)[0];
        if (apiConfig?.pageAccessToken) {
          token = apiConfig.pageAccessToken.trim();
          MEM_TOKEN_CACHE.token = token;
          MEM_TOKEN_CACHE.fetchedAt = Date.now();
        }
        if (apiConfig?.pageId) {
          pageId = apiConfig.pageId.trim();
          MEM_TOKEN_CACHE.pageId = pageId;
        }
      }
    } catch (e) {
      console.warn("Error resolving credentials from Supabase:", e);
    }
  }

  return { token, pageId };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Use environment variables if set in Cloudflare dashboard, otherwise use CONFIG
    const verifyToken = env?.VERIFY_TOKEN || CONFIG.VERIFY_TOKEN;
    const supabaseUrl = env?.SUPABASE_URL || CONFIG.SUPABASE_URL;
    const supabaseKey = env?.SUPABASE_KEY || env?.SUPABASE_SERVICE_ROLE_KEY || CONFIG.SUPABASE_KEY;
    const pageAccessToken = env?.PAGE_ACCESS_TOKEN || CONFIG.PAGE_ACCESS_TOKEN;
    const defaultApiId = env?.DEFAULT_API_ID || CONFIG.DEFAULT_API_ID;
    const defaultApiName = env?.DEFAULT_API_NAME || CONFIG.DEFAULT_API_NAME;
    const firebaseForwardUrl = env?.FIREBASE_FORWARD_URL || CONFIG.FIREBASE_FORWARD_URL;

    const cfg = {
      supabaseUrl,
      supabaseKey,
      pageAccessToken,
      defaultApiId,
      defaultApiName
    };

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
        console.log("✅ Meta Webhook verified successfully on Supabase Worker!");
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response(
        JSON.stringify({
          status: "online",
          version: "3.0.0",
          service: "Lokalex Messenger Webhook Bridge (Dedicated Supabase)",
          database: "Supabase PostgREST",
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
          // Process events asynchronously via waitUntil in Supabase
          ctx.waitUntil(processMetaEntries(body.entry, cfg, ctx));

          // Optional: Forward to existing Firebase worker in parallel so existing riders never miss a message
          if (firebaseForwardUrl) {
            ctx.waitUntil(
              fetch(firebaseForwardUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
              }).catch(() => {})
            );
          }

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
          const creds = await resolveApiCredentials(cfg, apiId);
          token = creds.token;
        }

        if (!token) {
          return new Response(
            JSON.stringify({ error: "PAGE_ACCESS_TOKEN not configured in Supabase or worker" }),
            { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
          );
        }

        const cleanPsid = String(recipientId || "").replace(/^fb_/, "");
        let fbResp = null;
        let fbData = null;

        if (imageUrl && typeof imageUrl === "string" && imageUrl.trim()) {
          const trimmedImg = imageUrl.trim();
          if (trimmedImg.startsWith("data:")) {
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

        // Retry without reply_to if rejected
        if (fbResp && !fbResp.ok && payload.replyToMid && (fbData?.error?.message?.toLowerCase().includes('reply_to') || fbData?.error?.code === 100) && typeof text === "string" && text.trim().length > 0) {
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

        // If outside 24-hour window, retry with MESSAGE_TAG CONFIRMED_EVENT_UPDATE
        if (fbResp && !fbResp.ok && fbData?.error?.code === 10 && typeof text === "string" && text.trim().length > 0) {
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

        // Link message key to Meta mid in Supabase & invalidate warm memory cache
        if (fbData?.message_id && supabaseUrl && supabaseKey) {
          const rawMid = String(fbData.message_id);
          const safeMid = rawMid.replace(/[.#$\[\]\/]/g, '_');
          const custTarget = cleanPsid.startsWith('fb_') ? cleanPsid : `fb_${cleanPsid}`;
          
          MEM_CUSTOMER_CACHE.delete(custTarget);
          
          ctx.waitUntil(
            (async () => {
              try {
                if (payload.msgKey) {
                  const chatRowId = `${custTarget}_${payload.msgKey}`;
                  const existingRow = await supabaseGetById(supabaseUrl, supabaseKey, "customer_chats", chatRowId);
                  if (existingRow && existingRow.data) {
                    existingRow.data.mid = safeMid;
                    existingRow.data.metaMid = rawMid;
                    await supabaseUpsert(supabaseUrl, supabaseKey, "customer_chats", existingRow);
                  }
                }
                await supabaseUpsert(supabaseUrl, supabaseKey, "customer_chats", [
                  { id: `${custTarget}_midIndex_${safeMid}`, room_id: custTarget, data: { msgKey: payload.msgKey || null, mid: safeMid, rawMid } },
                  { id: `${custTarget}_midIndex_${rawMid}`, room_id: custTarget, data: { msgKey: payload.msgKey || null, mid: safeMid, rawMid } }
                ]);
              } catch (e) {
                console.warn("Supabase send-reply linking note:", e);
              }
            })()
          );
        }

        return new Response(JSON.stringify(fbData), {
          status: fbResp ? fbResp.status : 200,
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
          const creds = await resolveApiCredentials(cfg, apiId);
          token = creds.token;
        }

        if (!token) {
          return new Response(
            JSON.stringify({ error: "PAGE_ACCESS_TOKEN not configured in Supabase or worker" }),
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
 * Resolves a Meta message ID (mid) to the actual message object and key in Supabase.
 */
async function resolveMessageByMid(cfg, custId, targetMid, timestamp = null, token = null) {
  if (!targetMid) return null;
  const rawMid = String(targetMid);
  const safeMid = rawMid.replace(/[.#$\[\]\/]/g, "_");

  if (cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      // 1. Direct row ID match: ${custId}_${safeMid}
      const directRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", `${custId}_${safeMid}`);
      if (directRow && directRow.data && (directRow.data.text || directRow.data.imageUrl || directRow.data.type)) {
        return { key: safeMid, message: directRow.data };
      }

      // 2. Check midIndex row
      const idxRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", `${custId}_midIndex`);
      if (idxRow && idxRow.data) {
        const mappedKey = idxRow.data[safeMid] || idxRow.data[rawMid];
        if (mappedKey) {
          const mappedRowId = mappedKey.startsWith(`${custId}_`) ? mappedKey : `${custId}_${mappedKey}`;
          const mappedRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", mappedRowId);
          if (mappedRow && mappedRow.data) {
            const cleanKey = mappedRow.id.startsWith(`${custId}_`) ? mappedRow.id.slice(custId.length + 1) : mappedRow.id;
            return { key: cleanKey, message: mappedRow.data };
          }
        }
      }

      // 2.1 Direct PostgREST JSON search by metaMid or mid
      for (const filterParam of [`data->>metaMid=eq.${encodeURIComponent(rawMid)}`, `data->>mid=eq.${encodeURIComponent(safeMid)}`]) {
        try {
          const filterResp = await fetch(
            `${cfg.supabaseUrl}/rest/v1/customer_chats?room_id=eq.${encodeURIComponent(custId)}&${filterParam}&limit=1`,
            { headers: getSupabaseHeaders(cfg.supabaseKey) }
          );
          if (filterResp.ok) {
            const matchRows = await filterResp.json();
            if (Array.isArray(matchRows) && matchRows.length > 0 && matchRows[0].data) {
              const r = matchRows[0];
              const cleanKey = r.id.startsWith(`${custId}_`) ? r.id.slice(custId.length + 1) : r.id;
              return { key: cleanKey, message: r.data };
            }
          }
        } catch (_) {}
      }

      // 3. Scan recent messages in room
      const recentResp = await fetch(
        `${cfg.supabaseUrl}/rest/v1/customer_chats?room_id=eq.${encodeURIComponent(custId)}&id=not.like.*_metadata&order=timestamp.desc&limit=20`,
        { headers: getSupabaseHeaders(cfg.supabaseKey) }
      );
      if (recentResp.ok) {
        const msgs = await recentResp.json();
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (!m.data || m.id.includes('_midIndex') || m.id.endsWith('_metadata')) continue;
            const mData = m.data;
            if (mData.mid === safeMid || mData.mid === rawMid || mData.metaMid === rawMid || mData.metaMid === safeMid) {
              const msgKey = m.id.startsWith(`${custId}_`) ? m.id.slice(custId.length + 1) : m.id;
              return { key: msgKey, message: mData };
            }
          }
        }
      }
    } catch (e) {
      console.warn("Supabase resolveMessageByMid error:", e);
    }
  }

  // 4. Direct Meta Single Message Node check (Graph API)
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
  if (cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      const recentResp = await fetch(
        `${cfg.supabaseUrl}/rest/v1/customer_chats?room_id=eq.${encodeURIComponent(custId)}&id=not.like.*_metadata&order=timestamp.desc&limit=10`,
        { headers: getSupabaseHeaders(cfg.supabaseKey) }
      );
      if (recentResp.ok) {
        const rows = await recentResp.json();
        if (Array.isArray(rows)) {
          for (const r of rows) {
            const m = r.data;
            if (m && m.isRider && (!timestamp || Number(m.timestamp || 0) <= Number(timestamp || Date.now()))) {
              const msgKey = r.id.startsWith(`${custId}_`) ? r.id.slice(custId.length + 1) : r.id;
              return { key: msgKey, message: m };
            }
          }
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Handles incoming Meta Messenger entries and writes them directly to Supabase.
 */
async function processMetaEntries(entries, cfg, ctx) {
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (!Array.isArray(entry.messaging)) continue;

    for (const item of entry.messaging) {
      // ----------------------------------------------------------------------
      // 0. Handle customer reactions (likes, hearts, emojis on messages)
      // ----------------------------------------------------------------------
      if (item.reaction) {
        const senderId = item.sender?.id;
        if (!senderId) continue;
        const custId = `fb_${senderId}`;
        const rawMid = item.reaction.mid;
        const emoji = item.reaction.emoji || "";
        const action = item.reaction.action || "react";

        if (rawMid) {
          const { token } = await resolveApiCredentials(cfg);
          let targetKey = String(rawMid).replace(/[.#$\[\]\/]/g, "_");
          try {
            const resolved = await resolveMessageByMid(cfg, custId, rawMid, item.timestamp || Date.now(), token);
            if (resolved && resolved.key) {
              targetKey = resolved.key;
            }
          } catch(e) {
            console.warn("Failed to resolve reaction targetKey:", e);
          }

          const targetRowId = targetKey.startsWith(custId + '_') ? targetKey : `${custId}_${targetKey}`;
          const REACTION_NAME_TO_EMOJI = {
            love: "❤️",
            like: "👍",
            heart: "❤️",
            wow: "😮",
            haha: "😆",
            laugh: "😆",
            sad: "😢",
            cry: "😢",
            angry: "😡",
            care: "🥰",
            smile: "😊",
            yay: "🎉"
          };
          const rawReactionName = (item.reaction.reaction || "").toLowerCase();
          const reactionEmoji = emoji || REACTION_NAME_TO_EMOJI[rawReactionName] || "❤️";
          const nowIso = new Date().toISOString();

          if (cfg.supabaseUrl && cfg.supabaseKey) {
            try {
              let row = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", targetRowId);
              if (!row || !row.data) {
                const searchResp = await fetch(
                  `${cfg.supabaseUrl}/rest/v1/customer_chats?room_id=eq.${encodeURIComponent(custId)}&or=(data->>metaMid.eq.${encodeURIComponent(rawMid)},data->>mid.eq.${encodeURIComponent(targetKey)})&limit=1`,
                  { headers: getSupabaseHeaders(cfg.supabaseKey) }
                );
                if (searchResp.ok) {
                  const foundRows = await searchResp.json();
                  if (Array.isArray(foundRows) && foundRows.length > 0) {
                    row = foundRows[0];
                  }
                }
              }

              if (row && row.data) {
                row.data.reactions = row.data.reactions || {};
                if (action === "unreact") {
                  if (emoji) {
                    if (row.data.reactions[emoji]) delete row.data.reactions[emoji][senderId];
                    if (row.data.reactions[emoji] && Object.keys(row.data.reactions[emoji]).length === 0) {
                      delete row.data.reactions[emoji];
                    }
                  } else {
                    for (const rxEmoji of Object.keys(row.data.reactions)) {
                      if (row.data.reactions[rxEmoji]?.[senderId]) {
                        delete row.data.reactions[rxEmoji][senderId];
                        if (Object.keys(row.data.reactions[rxEmoji]).length === 0) delete row.data.reactions[rxEmoji];
                      }
                    }
                  }
                } else {
                  if (!row.data.reactions[reactionEmoji] || typeof row.data.reactions[reactionEmoji] !== 'object') {
                    row.data.reactions[reactionEmoji] = {};
                  }
                  row.data.reactions[reactionEmoji][senderId] = true;
                }

                await supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                  id: row.id,
                  room_id: custId,
                  sender_id: row.sender_id,
                  message: row.message,
                  timestamp: row.timestamp || nowIso,
                  data: row.data
                });

                // Update meta lastUpdated
                const metaRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", custId);
                const mData = (metaRow && metaRow.data) ? { ...metaRow.data, lastUpdated: Date.now() } : { lastUpdated: Date.now() };
                await Promise.allSettled([
                  supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", {
                    id: custId,
                    data: mData,
                    updated_at: nowIso
                  }),
                  supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                    id: `${custId}_metadata`,
                    room_id: custId,
                    data: mData,
                    timestamp: nowIso
                  })
                ]);
              }
            } catch (rxErr) {
              console.warn("Supabase reaction update error:", rxErr);
            }
          }
        }
        continue;
      }

      // ----------------------------------------------------------------------
      // 0.05 Handle customer message edits (Meta Messenger message_edit)
      // ----------------------------------------------------------------------
      if (item.message_edit) {
        const senderId = item.sender?.id;
        if (!senderId) continue;
        const custId = `fb_${senderId}`;
        const rawMid = item.message_edit.mid;
        const newText = item.message_edit.text || "";
        const numEdit = item.message_edit.num_edit || 1;
        const editTimestamp = item.timestamp || Date.now();
        const nowIso = new Date(editTimestamp).toISOString();

        if (rawMid) {
          const { token } = await resolveApiCredentials(cfg);
          let targetKey = String(rawMid).replace(/[.#$\[\]\/]/g, "_");
          try {
            const resolved = await resolveMessageByMid(cfg, custId, rawMid, editTimestamp, token);
            if (resolved && resolved.key) {
              targetKey = resolved.key;
            }
          } catch(e) {
            console.warn("Failed to resolve message_edit targetKey:", e);
          }

          const targetRowId = targetKey.startsWith(custId + '_') ? targetKey : `${custId}_${targetKey}`;

          if (cfg.supabaseUrl && cfg.supabaseKey) {
            try {
              let row = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", targetRowId);
              if (!row || !row.data) {
                const searchResp = await fetch(
                  `${cfg.supabaseUrl}/rest/v1/customer_chats?room_id=eq.${encodeURIComponent(custId)}&or=(data->>metaMid.eq.${encodeURIComponent(rawMid)},data->>mid.eq.${encodeURIComponent(targetKey)})&limit=1`,
                  { headers: getSupabaseHeaders(cfg.supabaseKey) }
                );
                if (searchResp.ok) {
                  const foundRows = await searchResp.json();
                  if (Array.isArray(foundRows) && foundRows.length > 0) {
                    row = foundRows[0];
                  }
                }
              }

              if (row && row.data) {
                const origText = row.data.originalText || row.data.text || row.data.message || "";
                row.data.previousText = row.data.text || origText;
                row.data.originalText = origText;
                row.data.text = newText;
                row.data.message = newText;
                row.data.isEdited = true;
                row.data.editedAt = editTimestamp;
                row.data.numEdit = numEdit;

                row.data.editHistory = row.data.editHistory || [];
                row.data.editHistory.push({
                  text: row.data.previousText,
                  editedAt: editTimestamp
                });

                await supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                  id: row.id,
                  room_id: custId,
                  sender_id: row.sender_id,
                  message: newText,
                  timestamp: row.timestamp || nowIso,
                  data: row.data
                });

                // Update meta if this message was the latest
                const metaRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", custId);
                if (metaRow && metaRow.data) {
                  const mData = {
                    ...metaRow.data,
                    lastMessage: newText,
                    lastUpdated: editTimestamp
                  };
                  await Promise.allSettled([
                    supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", {
                      id: custId,
                      data: mData,
                      updated_at: nowIso
                    }),
                    supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                      id: `${custId}_metadata`,
                      room_id: custId,
                      data: mData,
                      timestamp: nowIso
                    })
                  ]);
                }
              }
            } catch (editErr) {
              console.warn("Supabase message_edit error:", editErr);
            }
          }
          if (cfg.firebaseDbUrl || cfg.dbUrl) {
            try {
              const dbEndpoint = cfg.firebaseDbUrl || cfg.dbUrl;
              const editPatch = {
                [`customerChats/${custId}/messages/${targetKey}/text`]: newText,
                [`customerChats/${custId}/messages/${targetKey}/message`]: newText,
                [`customerChats/${custId}/messages/${targetKey}/originalText`]: origText,
                [`customerChats/${custId}/messages/${targetKey}/previousText`]: row?.data?.previousText || origText,
                [`customerChats/${custId}/messages/${targetKey}/isEdited`]: true,
                [`customerChats/${custId}/messages/${targetKey}/editedAt`]: editTimestamp,
                [`customerChats/${custId}/messages/${targetKey}/numEdit`]: numEdit,
                [`customerChatMeta/${custId}/lastUpdated`]: editTimestamp,
                [`customerChatMeta/${custId}/lastMessage`]: newText,
                [`customerChats/${custId}/metadata/lastUpdated`]: editTimestamp,
                [`customerChats/${custId}/metadata/lastMessage`]: newText
              };
              fetch(`${dbEndpoint}/.json`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editPatch)
              }).catch(() => {});
            } catch (_) {}
          }
        }
        continue;
      }

      // ----------------------------------------------------------------------
      // 0.1 Handle customer read receipts (Meta Messenger message_reads)
      // ----------------------------------------------------------------------
      if (item.read) {
        const senderId = item.sender?.id;
        if (!senderId) continue;
        const custId = `fb_${senderId}`;
        const watermark = item.read.watermark || item.timestamp || Date.now();
        const nowIso = new Date().toISOString();

        if (cfg.supabaseUrl && cfg.supabaseKey) {
          try {
            const metaRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", custId);
            if (metaRow && metaRow.data) {
              const updatedMeta = { ...metaRow.data, customerLastSeenTimestamp: watermark };
              await Promise.allSettled([
                supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", {
                  id: custId,
                  data: updatedMeta,
                  updated_at: nowIso
                }),
                supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                  id: `${custId}_metadata`,
                  room_id: custId,
                  data: updatedMeta,
                  timestamp: nowIso
                })
              ]);
            }

            const msgsResp = await fetch(
              `${cfg.supabaseUrl}/rest/v1/customer_chats?room_id=eq.${encodeURIComponent(custId)}&id=not.like.*_metadata&order=timestamp.desc&limit=10`,
              { headers: getSupabaseHeaders(cfg.supabaseKey) }
            );
            if (msgsResp.ok) {
              const msgs = await msgsResp.json();
              if (Array.isArray(msgs)) {
                const toUpdate = [];
                for (const m of msgs) {
                  if (m.data && (m.data.isRider || m.data.senderType === 'rider') && m.data.status !== 'seen') {
                    // Safety check: Never mark an unsent or failed message as seen by the customer
                    if (!m.data.mid && !m.data.metaMid) continue;
                    if (m.data.status === 'failed' || m.data.failed) continue;

                    const msgTime = Number(m.data.timestamp || 0);
                    if (!msgTime || msgTime <= watermark) {
                      m.data.status = 'seen';
                      m.data.seenAt = watermark;
                      toUpdate.push({
                        id: m.id,
                        room_id: m.room_id || custId,
                        sender_id: m.sender_id,
                        message: m.message,
                        timestamp: m.timestamp || nowIso,
                        data: m.data
                      });
                    }
                  }
                }
                if (toUpdate.length > 0) {
                  await supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", toUpdate);
                }
              }
            }
          } catch (readErr) {
            console.warn("Supabase mark seen error:", readErr);
          }
        }
        continue;
      }

      // ----------------------------------------------------------------------
      // 0.15 Handle customer delivery receipts (Meta Messenger message_deliveries)
      // ----------------------------------------------------------------------
      if (item.delivery) {
        const custId = `fb_${item.recipient?.id || item.sender?.id}`;
        const watermark = item.delivery.watermark || item.timestamp || Date.now();
        const mids = item.delivery.mids || [];
        const nowIso = new Date().toISOString();

        if (cfg.supabaseUrl && cfg.supabaseKey && Array.isArray(mids) && mids.length > 0) {
          try {
            for (const rawMid of mids) {
              const safeMid = String(rawMid).replace(/[.#$\[\]\/]/g, "_");
              const rowId = `${custId}_${safeMid}`;
              const row = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", rowId);
              if (row && row.data && row.data.status !== 'seen' && row.data.status !== 'delivered') {
                row.data.status = 'delivered';
                row.data.deliveredAt = watermark;
                await supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                  id: row.id,
                  room_id: custId,
                  sender_id: row.sender_id,
                  message: row.message,
                  timestamp: row.timestamp || nowIso,
                  data: row.data
                });
              }
            }
          } catch (delErr) {
            console.warn("Supabase mark delivered error:", delErr);
          }
        }
        continue;
      }

      // ----------------------------------------------------------------------
      // 0.2 Handle button clicks / menu selections (Meta Messenger messaging_postbacks)
      // ----------------------------------------------------------------------
      if (item.postback) {
        item.message = {
          mid: `postback_${item.timestamp || Date.now()}`,
          text: item.postback.title || item.postback.payload || "Clicked button"
        };
      }

      // ----------------------------------------------------------------------
      // 1. Incoming Message Payload
      // ----------------------------------------------------------------------
      if (!item.message) continue;
      const isEcho = Boolean(item.message.is_echo);

      const senderId = isEcho ? item.recipient?.id : item.sender?.id;
      if (!senderId) continue;

      const custId = `fb_${senderId}`;
      const timestamp = item.timestamp || Date.now();
      const rawMetaMid = item.message.mid ? String(item.message.mid) : null;
      const mid = rawMetaMid ? rawMetaMid.replace(/[.#$\[\]\/]/g, "_") : `msg_${timestamp}`;

      // Fast-path echo deduplication:
      // If this message was dispatched by the Lokalex app via /api/send-reply or local send,
      // it is already saved or indexed in Supabase. Skip re-processing to prevent race conditions.
      if (isEcho && cfg.supabaseUrl && cfg.supabaseKey) {
        try {
          const [exDirect, exMidIndex, exRawMidIndex] = await Promise.all([
            supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", `${custId}_${mid}`),
            supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", `${custId}_midIndex_${mid}`),
            rawMetaMid && rawMetaMid !== mid
              ? supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", `${custId}_midIndex_${rawMetaMid}`)
              : Promise.resolve(null)
          ]);
          if ((exDirect && exDirect.data) || (exMidIndex && exMidIndex.data) || (exRawMidIndex && exRawMidIndex.data)) {
            console.log(`ℹ️ Skipping echo for ${custId} (${mid}) - outbound message already handled by Lokalex app.`);
            continue;
          }
        } catch (_) {}
      }

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

      // 1. Fast in-memory customer check (0ms)
      let existingCustomer = MEM_CUSTOMER_CACHE.get(custId);
      const isCacheFresh = existingCustomer && (Date.now() - (existingCustomer.cachedAt || 0) < 15000);
      let existingCustomerName = existingCustomer?.customerName || null;
      let existingAvatarUrl = existingCustomer?.avatarUrl || null;
      let existingFolder = existingCustomer?.folder || null;
      let existingCateredRider = existingCustomer?.cateredBy || null;
      let existingCateredRiderId = existingCustomer?.cateredById || null;
      let existingStatus = existingCustomer?.status || null;
      let existingCustomerMeta = null;

      // 1b. If echo, or cache stale/missing: check Supabase customer_chat_meta
      if ((isEcho || !isCacheFresh || !existingCustomer) && cfg.supabaseUrl && cfg.supabaseKey) {
        try {
          const metaRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", custId);
          if (metaRow && metaRow.data) {
            existingCustomerMeta = metaRow.data;
            const ex = metaRow.data;
            if (ex.customerName && !ex.customerName.startsWith("FB Customer (")) {
              existingCustomerName = ex.customerName.trim();
              existingAvatarUrl = ex.avatarUrl;
            }
            existingFolder = ex.folder || null;
            existingCateredRider = ex.cateredByRiderName || ex.cateredBy || null;
            existingCateredRiderId = ex.cateredByRiderId || null;
            existingStatus = ex.status || null;

            MEM_CUSTOMER_CACHE.set(custId, {
              customerName: existingCustomerName,
              avatarUrl: existingAvatarUrl,
              folder: existingFolder,
              cateredBy: existingCateredRider,
              cateredById: existingCateredRiderId,
              status: existingStatus,
              cachedAt: Date.now()
            });
          }
        } catch (_) {}
      }

      // 2. Resolve Page Access Token & Page ID from Supabase
      const creds = await resolveApiCredentials(cfg);
      const token = creds.token;
      const resolvedPageId = creds.pageId || pageId;

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
        } else if (isEcho) {
          // Ignore empty outbound Meta system/page echoes with no text and no media
          continue;
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
                if (matched.name && needsNameResolution) customerName = matched.name.trim();
                if (matched.picture?.data?.url && !matched.picture.data.is_silhouette) {
                  avatarUrl = matched.picture.data.url;
                }
              }
            }
          }
        } catch (e) {
          console.warn("Conversations API lookup note:", e);
        }

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
          const resolved = await resolveMessageByMid(cfg, custId, refMid, timestamp, token);
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

      // 4. Thread Metadata Payload
      const isExistingDone = (existingFolder === 'done') || existingStatus === 'completed' || existingStatus === 'done';
      
      // An echo MUST NEVER initiate or force a catering session
      const isCurrentlyCatered = !isEcho && !isExistingDone && (existingFolder === 'catering' || Boolean(existingCateredRider || existingCateredRiderId)) && existingStatus !== 'cancelled';

      let targetFolder = 'inbox';
      let targetStatus = 'active';

      if (isEcho) {
        if (isExistingDone) {
          targetFolder = 'done';
          targetStatus = 'completed';
        } else if (existingFolder === 'catering') {
          targetFolder = 'catering';
          targetStatus = 'active';
        } else if (existingFolder === 'stores' || existingFolder === 'applicant' || existingFolder === 'followup') {
          targetFolder = existingFolder;
          targetStatus = existingStatus || 'active';
        } else {
          targetFolder = 'inbox';
          targetStatus = 'active';
        }
      } else {
        // Customer inbound message
        if (isCurrentlyCatered) {
          targetFolder = 'catering';
          targetStatus = 'active';
        } else if (isExistingDone) {
          // If customer messages back on a completed thread, reopen in inbox for new inquiry
          targetFolder = 'inbox';
          targetStatus = 'active';
        } else if (existingFolder === 'stores' || existingFolder === 'applicant' || existingFolder === 'followup') {
          targetFolder = existingFolder;
          targetStatus = 'active';
        } else {
          targetFolder = 'inbox';
          targetStatus = 'active';
        }
      }

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
        ...(existingCustomerMeta || {}),
        customerName: customerName,
        avatarUrl: avatarUrl,
        lastMessage: isEcho ? `You: ${lastSummary}` : lastSummary,
        lastUpdated: timestamp,
        folder: targetFolder,
        status: targetStatus,
        channel: "messenger",
        apiId: cfg.defaultApiId,
        apiName: cfg.defaultApiName,
        unreadForRider: !isEcho,
      };

      if (targetFolder === 'done' || targetStatus === 'completed') {
        threadMeta.folder = 'done';
        threadMeta.status = 'completed';
        threadMeta.cateredBy = null;
        threadMeta.cateredByRiderName = null;
        threadMeta.cateredByRiderId = null;
        if (existingCustomerMeta?.completedAt) threadMeta.completedAt = existingCustomerMeta.completedAt;
        if (existingCustomerMeta?.completedBy) threadMeta.completedBy = existingCustomerMeta.completedBy;
        if (existingCustomerMeta?.completedByRiderId) threadMeta.completedByRiderId = existingCustomerMeta.completedByRiderId;
        if (existingCustomerMeta?.completedByRiderName) threadMeta.completedByRiderName = existingCustomerMeta.completedByRiderName;
      } else if (targetFolder === 'catering' && (existingCateredRider || existingCateredRiderId)) {
        threadMeta.folder = 'catering';
        threadMeta.status = 'active';
        threadMeta.cateredBy = existingCateredRider || null;
        threadMeta.cateredByRiderName = existingCateredRider || null;
        threadMeta.cateredByRiderId = existingCateredRiderId || null;
      } else {
        threadMeta.folder = targetFolder;
        threadMeta.cateredBy = null;
        threadMeta.cateredByRiderName = null;
        threadMeta.cateredByRiderId = null;
        if (!isEcho) {
          threadMeta.completedAt = null;
          threadMeta.completedByRiderId = null;
          threadMeta.completedByRiderName = null;
          threadMeta.completedBy = null;
        }
      }

      // 5. Chat Message Payload
      const chatMessage = {
        sender: isEcho ? "Page Admin" : customerName,
        senderType: isEcho ? "admin" : "customer",
        avatarUrl: isEcho ? "https://ui-avatars.com/api/?name=Page+Admin&background=0284c7&color=fff" : avatarUrl,
        text: messageText,
        timestamp: timestamp,
        isRider: Boolean(isEcho),
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
        chatMessage.type = 'sticker';
        chatMessage.imageUrl = primaryImageUrl || 'https://static.xx.fbcdn.net/images/emoji.php/v9/t80/1/16/1f44d.png';
      } else if (images.length > 0) {
        chatMessage.images = images;
        chatMessage.imageUrl = primaryImageUrl;
        chatMessage.type = 'image';
      }

      if (videoUrl) {
        chatMessage.videoUrl = videoUrl;
        if (!chatMessage.type || chatMessage.type === 'text') chatMessage.type = 'video';
      }
      if (audioUrl) {
        chatMessage.audioUrl = audioUrl;
        if (!chatMessage.type || chatMessage.type === 'text') chatMessage.type = 'audio';
      }
      if (docUrl) {
        chatMessage.fileUrl = docUrl;
        chatMessage.fileName = docName;
        if (!chatMessage.type || chatMessage.type === 'text') chatMessage.type = 'file';
      }

      // 6. Write Directly to Supabase PostgREST
      const isoTimestamp = new Date(timestamp).toISOString();

      if (cfg.supabaseUrl && cfg.supabaseKey) {
        try {
          if (isEcho) {
            const exCheck = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", `${custId}_${mid}`);
            if (exCheck && exCheck.data) {
              continue; // Message was already saved by Lokalex app outbound send
            }
          }
          await supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
            id: `${custId}_${mid}`,
            room_id: custId,
            sender_id: customerName,
            message: messageText,
            timestamp: isoTimestamp,
            data: chatMessage
          });

          await Promise.allSettled([
            supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", {
              id: custId,
              data: threadMeta,
              updated_at: isoTimestamp
            }),
            supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
              id: `${custId}_metadata`,
              room_id: custId,
              sender_id: customerName,
              message: threadMeta.lastMessage,
              timestamp: isoTimestamp,
              data: threadMeta
            })
          ]);

          if (rawMetaMid && rawMetaMid !== mid) {
            await supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
              id: `${custId}_midIndex_${rawMetaMid}`,
              room_id: custId,
              timestamp: isoTimestamp,
              data: { mid: mid, rawMid: rawMetaMid }
            });
          }

          console.log(`⚡ Saved message from ${customerName} to Supabase!`);
        } catch (supErr) {
          console.warn("Supabase message save error:", supErr);
        }
      }

      // Update in-memory customer cache with authoritative state
      MEM_CUSTOMER_CACHE.set(custId, {
        customerName: customerName,
        avatarUrl: avatarUrl,
        folder: threadMeta.folder,
        cateredBy: threadMeta.cateredBy,
        cateredById: threadMeta.cateredByRiderId,
        status: threadMeta.status,
        cachedAt: Date.now()
      });

      // 7. FULL BOOKING AUTO-REPLY HOOK (Supabase based)
      try {
        let fbSettings = null;
        if (cfg.supabaseUrl && cfg.supabaseKey) {
          const sRow = await supabaseGetById(cfg.supabaseUrl, cfg.supabaseKey, "settings", "fullBooking");
          if (sRow && sRow.data) fbSettings = sRow.data;
        }

        if (fbSettings && fbSettings.enabled && resolvedFolder === 'inbox') {
          let hasAvailableRider = false;
          if (cfg.supabaseUrl && cfg.supabaseKey) {
            try {
              const rResp = await fetch(`${cfg.supabaseUrl}/rest/v1/roster?limit=100`, {
                headers: getSupabaseHeaders(cfg.supabaseKey)
              });
              if (rResp.ok) {
                const rosterList = await rResp.json();
                if (Array.isArray(rosterList)) {
                  hasAvailableRider = rosterList.some(r => {
                    const m = r.data || r;
                    if (!m) return false;
                    const st = (m.status || '').trim().toLowerCase();
                    const isBreak = Boolean(m.isBreak || st === 'break');
                    return st === 'available' && !isBreak;
                  });
                }
              }
            } catch (_) {}
          }

          if (!hasAvailableRider) {
            const twelveHours = 12 * 60 * 60 * 1000;
            const sessionStartTime = Number(fbSettings.updatedAt) || 0;
            const lastReplied = Number(existingCustomerMeta?.fullBookingRepliedAt) || 0;
            const now = Date.now();
            const alreadyRepliedInSession = lastReplied && (
              (now - lastReplied < twelveHours) ||
              (sessionStartTime && lastReplied >= sessionStartTime)
            );

            if (!alreadyRepliedInSession) {
              const autoReplyText = String(fbSettings.message || "Paumanhin po, Full Booking na po kami sa ngayon. Mag-a-update po kami kapag available na ulit ang aming delivery service. Maraming salamat po sa pag-unawa! 🛵🙏").trim();

              if (token) {
                await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    messaging_type: "RESPONSE",
                    recipient: { id: senderId },
                    message: { text: autoReplyText }
                  })
                }).catch(() => {});
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

              if (cfg.supabaseUrl && cfg.supabaseKey) {
                await Promise.allSettled([
                  supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                    id: `${custId}_${autoReplyMid}`,
                    room_id: custId,
                    sender_id: "Lokalex Auto-Reply",
                    message: autoReplyText,
                    timestamp: new Date(now).toISOString(),
                    data: autoReplyMsg
                  }),
                  supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chat_meta", {
                    id: custId,
                    data: { ...(existingCustomerMeta || {}), ...updatePayload },
                    updated_at: new Date(now).toISOString()
                  }),
                  supabaseUpsert(cfg.supabaseUrl, cfg.supabaseKey, "customer_chats", {
                    id: `${custId}_metadata`,
                    room_id: custId,
                    message: updatePayload.lastMessage,
                    timestamp: new Date(now).toISOString(),
                    data: { ...(existingCustomerMeta || {}), ...updatePayload }
                  })
                ]);
              }
              console.log(`🛑 Sent Full Booking auto-reply to ${customerName} on Messenger!`);
            }
          }
        }
      } catch (autoErr) {
        console.warn("Full booking auto-reply check in worker error:", autoErr);
      }
    }
  }
}

