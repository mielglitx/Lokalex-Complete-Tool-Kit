package com.lokalex.rider;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class LokalexForegroundService extends Service {
    private static final String TAG = "LokalexForegroundService";
    private static final String CHANNEL_ID = "lokalex_keepalive_channel";
    private static final int NOTIFICATION_ID = 8831;

    // Properly URL-encoded Firebase query to avoid OkHttp URI syntax errors
    private static final String FIREBASE_META_QUERY_URL =
            "https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/customerChatMeta.json?orderBy=%22lastUpdated%22&limitToLast=35";

    private static volatile boolean isRunning = false;
    private static Bitmap cachedLargeIcon = null;

    private PowerManager.WakeLock wakeLock = null;
    private ScheduledExecutorService scheduler = null;

    private boolean isInitialCheck = true;
    private long lastKnownMsgTimestamp = 0;
    private final Set<String> processedMsgSignatures = new HashSet<>();

    public static boolean isRunning() {
        return isRunning;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        isRunning = true;
        isInitialCheck = true;
        lastKnownMsgTimestamp = System.currentTimeMillis();
        Log.i(TAG, "LokalexForegroundService onCreate: Initializing background service");
        createNotificationChannel();
        acquireWakeLock();
        startForegroundSafely();
    }

    private void startForegroundSafely() {
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
                }
                startForeground(NOTIFICATION_ID, notification, serviceType);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {}
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        acquireWakeLock();

        if (lastKnownMsgTimestamp == 0) {
            lastKnownMsgTimestamp = System.currentTimeMillis();
        }

        if (scheduler == null || scheduler.isShutdown()) {
            scheduler = Executors.newSingleThreadScheduledExecutor();
            scheduler.scheduleWithFixedDelay(this::performBackgroundCheck, 1, 5, TimeUnit.SECONDS);
            Log.i(TAG, "LokalexForegroundService scheduler started (5s interval)");
        }

        return START_STICKY;
    }

    private void performBackgroundCheck() {
        try {
            // Keep CPU alive during network processing
            acquireWakeLock();

            // 1. Wake up WebView event loop and JS timers if MainActivity is alive
            MainActivity activity = MainActivity.getInstance();
            if (activity != null) {
                activity.pulseWebViewKeepAlive();
            }

            // 2. Query Firebase directly in Java to monitor incoming messages even when screen is off
            URL url = new URL(FIREBASE_META_QUERY_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(4500);
            conn.setRequestProperty("User-Agent", "LokalexBackgroundMonitor/1.0");

            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = in.readLine()) != null) {
                    sb.append(line);
                }
                in.close();

                processIncomingMetaJson(sb.toString());
            } else {
                Log.w(TAG, "Firebase meta query response code: " + responseCode);
            }
            conn.disconnect();
        } catch (Exception e) {
            Log.e(TAG, "Background check cycle exception: " + e.getMessage());
        }
    }

    private void processIncomingMetaJson(String jsonStr) {
        if (jsonStr == null || jsonStr.trim().isEmpty() || jsonStr.equals("null")) return;
        try {
            JSONObject root = new JSONObject(jsonStr);
            Iterator<String> keys = root.keys();

            SharedPreferences prefs = getSharedPreferences("lokalex_prefs", Context.MODE_PRIVATE);
            String myRiderId = prefs.getString("rider_id", "").trim();
            String myRiderName = prefs.getString("rider_name", "").trim().toLowerCase();

            // Handle Initial Startup Snapshot: prime signatures so historical chats do not spam
            if (isInitialCheck) {
                int primedCount = 0;
                while (keys.hasNext()) {
                    String custId = keys.next();
                    JSONObject meta = root.optJSONObject(custId);
                    if (meta == null) continue;
                    long lastUpdated = meta.optLong("lastUpdated", 0);
                    processedMsgSignatures.add(custId + "_" + lastUpdated);
                    if (lastUpdated > lastKnownMsgTimestamp) {
                        lastKnownMsgTimestamp = lastUpdated;
                    }
                    primedCount++;
                }
                isInitialCheck = false;
                Log.i(TAG, "Initial meta snapshot primed with " + primedCount + " chats. Monitoring for new arrivals...");
                return;
            }

            while (keys.hasNext()) {
                String custId = keys.next();
                JSONObject meta = root.optJSONObject(custId);
                if (meta == null) continue;

                long lastUpdated = meta.optLong("lastUpdated", 0);
                boolean unreadForRider = meta.optBoolean("unreadForRider", false);
                String lastMessage = meta.optString("lastMessage", "").trim();
                String folder = meta.optString("folder", "inbox").toLowerCase();
                String status = meta.optString("status", "active").toLowerCase();
                String customerName = meta.optString("customerName", "Customer").trim();
                String apiName = meta.optString("apiName", "Camiling FB");

                // Strictly filter for active incoming messages for riders
                if (!unreadForRider) continue;
                if (lastMessage.isEmpty() || lastMessage.equalsIgnoreCase("No messages yet")) continue;
                if (lastMessage.startsWith("You:")) continue;
                if (folder.equals("spam") || folder.equals("other") || status.equals("spam")) continue;
                if (status.equals("completed") || status.equals("cancelled") || status.equals("done")) continue;

                // If thread is in catering, only notify if catered by this rider (or unassigned/open)
                if (folder.equals("catering")) {
                    String cateredByRiderId = meta.optString("cateredByRiderId", "").trim();
                    String cateredByRiderName = meta.optString("cateredByRiderName", "").trim().toLowerCase();
                    if (!myRiderId.isEmpty() && !cateredByRiderId.isEmpty() && !cateredByRiderId.equals(myRiderId)) {
                        continue;
                    }
                    if (!myRiderName.isEmpty() && !cateredByRiderName.isEmpty() && !cateredByRiderName.equals(myRiderName)) {
                        continue;
                    }
                }

                String signature = custId + "_" + lastUpdated;
                if (processedMsgSignatures.contains(signature)) continue;

                processedMsgSignatures.add(signature);
                if (processedMsgSignatures.size() > 300) {
                    processedMsgSignatures.clear();
                    processedMsgSignatures.add(signature);
                }

                if (lastUpdated > lastKnownMsgTimestamp) {
                    lastKnownMsgTimestamp = lastUpdated;
                }

                String title = customerName + (apiName.isEmpty() ? "" : " • " + apiName);
                String body = lastMessage;
                if (body.contains("[Facebook image]") || body.contains("[Facebook attachment]")) {
                    body = "📷 Sent a photo";
                } else if (body.contains("📍") || body.contains("[Location]")) {
                    body = "📍 Sent a location pin";
                }

                Log.i(TAG, "🔔 New incoming chat detected from " + customerName + ": " + body);

                // Dispatch native Android notification with high priority, sound & vibration
                MainActivity.dispatchNativeNotification(this, title, body, "chat_" + custId, custId);

                // Wake up screen briefly so rider sees incoming alert even if phone is on table with screen off
                wakeScreenBriefly();
            }
        } catch (Exception e) {
            Log.e(TAG, "processIncomingMetaJson error: " + e.getMessage(), e);
        }
    }

    private void wakeScreenBriefly() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                PowerManager.WakeLock screenLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                        "Lokalex:IncomingChatScreenWake"
                );
                screenLock.acquire(4000);
            }
        } catch (Exception ignored) {}
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Lokalex:KeepAliveWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null) {
                // Acquire with 15-minute safety timeout, continuously refreshed by performBackgroundCheck
                wakeLock.acquire(15 * 60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
            }
        } catch (Exception ignored) {}
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Lokalex Hub Background Monitor",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Monitors live customer chats and orders in real time");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        if (cachedLargeIcon == null) {
            try {
                cachedLargeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher_round);
            } catch (Exception ignored) {}
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Lokalex Hub Active")
                .setContentText("Receiving live orders & messages in real time")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE);

        if (cachedLargeIcon != null) {
            builder.setLargeIcon(cachedLargeIcon);
        }

        return builder.build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "onTimeout triggered for startId " + startId + " fgsType " + fgsType);
        try {
            stopSelf(startId);
            // Seamlessly restart foreground service to reset Android 15/16 timeout quota
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    Intent restartIntent = new Intent(getApplicationContext(), LokalexForegroundService.class);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        getApplicationContext().startForegroundService(restartIntent);
                    } else {
                        getApplicationContext().startService(restartIntent);
                    }
                    Log.i(TAG, "LokalexForegroundService restarted successfully after timeout");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to restart service after timeout: " + e.getMessage());
                }
            }, 1500);
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdownNow();
            scheduler = null;
        }
        releaseWakeLock();
        Log.i(TAG, "LokalexForegroundService onDestroy executed");
        super.onDestroy();
    }
}
