# 🚀 Lokalex Facebook Messenger Integration Setup Guide

## How It Works Under The Hood

```
[ Facebook Messenger Customer ]
              │ (Sends "Hello!")
              ▼
    [ Meta Webhook POST ]
              │
              ▼
  [ Cloudflare Worker Webhook ]
(https://lokalex-webhook.workers.dev)
              │
              ▼ (Writes to Firebase RTDB)
[ Firebase Realtime Database ]
(customerChatMeta & customerChats)
              │
              ▼ (Realtime sync)
  [ Lokalex Live Chats Feed ]
  (Riders see "Camiling FB" feed)
```

---

## ⚡ Fastest Setup: Cloudflare Worker (Free, 2 Minutes)

Cloudflare Workers provides a free HTTPS endpoint that is active 24/7 with zero server management.

### Step 1: Deploy Worker in Cloudflare
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) and sign in.
2. In the left menu, click **Workers & Pages** ➔ **Create application** ➔ **Create Worker**.
3. Name it: `lokalex-messenger-webhook` and click **Deploy**.
4. Click **Edit code** on the top right.
5. Delete the starter code, copy and paste the entire code from [`webhook-server/cloudflare-worker.js`](./cloudflare-worker.js), and click **Save and Deploy**.
6. Copy your Worker URL:
   `https://lokalex-messenger-webhook.<your-subdomain>.workers.dev`

---

### Step 2: Configure Meta Developer App
1. Go to [developers.facebook.com](https://developers.facebook.com/apps/) and select your App.
2. Go to **Messenger** ➔ **Settings** (or **Webhooks**).
3. Under **Webhooks**, click **Edit Callback URL** (or **Configure Webhooks**):
   - **Callback URL**: `https://lokalex-messenger-webhook.<your-subdomain>.workers.dev/webhook`
   - **Verify Token**: `Test1234`
4. Click **Verify and Save** (Meta will test the endpoint and show a green checkmark ✅).
5. Next to your Page (`1098954353295816`), click **Add Subscriptions** and check:
   - `messages`
   - `messaging_postbacks`
6. Click **Save**.

---

### Step 3: Update Lokalex Admin Settings
1. Open the Lokalex app as Admin (`amiel`).
2. Click **Admin Controls** ➔ **Facebook Messenger APIs** (or the Settings gear next to the sources chips).
3. Edit your **Camiling FB** API:
   - Update **API Link / Webhook URL** to your Cloudflare Worker URL:
     `https://lokalex-messenger-webhook.<your-subdomain>.workers.dev/webhook`
4. Click **Update Facebook API**.

---

### Step 4: Test in Messenger
1. Open Facebook Messenger and send a message to your Facebook Page.
2. Open the Lokalex app:
   - Look at the **Live Chats** feed.
   - The message will appear instantly with the **Camiling FB** badge!

