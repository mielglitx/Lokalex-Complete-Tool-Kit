package com.lokalex.rider;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.PictureInPictureUiState;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.util.Rational;
import android.view.WindowManager;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "LokalexNative";
    private static final int PERMISSION_REQ_CODE = 9922;
    public static final String MESSAGES_CHANNEL_ID = "lokalex_messages_channel_v3";
    private static MainActivity instance = null;
    private Ringtone activeSystemRingtone = null;
    private boolean isPipStashed = false;

    public static MainActivity getInstance() {
        return instance;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        // Reserve space for native status bar so web content is not blocked by clock/icons
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception e) {}

        // Hardware & Rendering Performance Optimization for smooth 60fps operation
        try {
            WebView.setWebContentsDebuggingEnabled(true);
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                
                // Hardware layer acceleration on the view surface
                webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
                webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
                webView.setVerticalScrollBarEnabled(false);
                webView.setHorizontalScrollBarEnabled(false);
                
                WebSettings settings = webView.getSettings();
                settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
                settings.setEnableSmoothTransition(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    settings.setOffscreenPreRaster(true);
                }
                settings.setCacheMode(WebSettings.LOAD_DEFAULT);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                
                CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            }
        } catch (Exception e) {}

        // Expose NativePermissionsBridge to JavaScript web layer
        try {
            getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void requestAllPermissions() {
                    new Handler(Looper.getMainLooper()).post(MainActivity.this::checkAndRequestPermissions);
                }

                @JavascriptInterface
                public boolean areAllPermissionsGranted() {
                    return MainActivity.this.isAllGranted();
                }

                @JavascriptInterface
                public void openAppSettings() {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", getPackageName(), null));
                    startActivity(intent);
                }

                @JavascriptInterface
                public boolean saveImageToDevice(String imageSource, String filename) {
                    return saveImageToDevice(imageSource, filename, true);
                }

                @JavascriptInterface
                public boolean saveImageToDevice(String imageSource, String filename, boolean showToast) {
                    if (imageSource == null || imageSource.trim().isEmpty()) return false;
                    try {
                        String cleanSource = imageSource.trim();
                        byte[] imageBytes = null;
                        String mimeType = "image/jpeg";

                        if (cleanSource.startsWith("http://") || cleanSource.startsWith("https://")) {
                            // Direct native download via Java HTTP URL connection (No browser CORS restrictions!)
                            java.net.URL url = new java.net.URL(cleanSource);
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                            conn.setInstanceFollowRedirects(true);
                            conn.setConnectTimeout(20000);
                            conn.setReadTimeout(20000);
                            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + "; " + Build.MODEL + ")");
                            conn.connect();

                            int code = conn.getResponseCode();
                            if (code >= 300 && code < 400) {
                                String redirectUrl = conn.getHeaderField("Location");
                                if (redirectUrl != null && !redirectUrl.isEmpty()) {
                                    conn.disconnect();
                                    url = new java.net.URL(redirectUrl);
                                    conn = (java.net.HttpURLConnection) url.openConnection();
                                    conn.setConnectTimeout(20000);
                                    conn.setReadTimeout(20000);
                                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + "; " + Build.MODEL + ")");
                                    conn.connect();
                                    code = conn.getResponseCode();
                                }
                            }

                            if (code >= 400) {
                                throw new Exception("HTTP server returned error code " + code);
                            }

                            String cType = conn.getContentType();
                            if (cType != null) {
                                if (cType.contains("png")) mimeType = "image/png";
                                else if (cType.contains("webp")) mimeType = "image/webp";
                                else if (cType.contains("gif")) mimeType = "image/gif";
                                else mimeType = "image/jpeg";
                            }

                            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                            try (java.io.InputStream in = conn.getInputStream()) {
                                byte[] data = new byte[8192];
                                int nRead;
                                while ((nRead = in.read(data, 0, data.length)) != -1) {
                                    buffer.write(data, 0, nRead);
                                }
                                buffer.flush();
                            }
                            imageBytes = buffer.toByteArray();
                            conn.disconnect();
                        } else {
                            // Base64 Data URL or raw base64 (Canvas receipts, inline attachments)
                            String cleanBase64 = cleanSource;
                            if (cleanBase64.contains(",")) {
                                String header = cleanBase64.substring(0, cleanBase64.indexOf(","));
                                if (header.contains("png")) mimeType = "image/png";
                                else if (header.contains("webp")) mimeType = "image/webp";
                                else mimeType = "image/jpeg";
                                cleanBase64 = cleanBase64.substring(cleanBase64.indexOf(",") + 1);
                            }
                            imageBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
                        }

                        if (imageBytes == null || imageBytes.length == 0) {
                            throw new Exception("No image bytes could be decoded");
                        }

                        String extension = mimeType.contains("png") ? ".png" : (mimeType.contains("webp") ? ".webp" : ".jpg");
                        String safeName = (filename != null && !filename.trim().isEmpty()) 
                                ? filename.trim() 
                                : ("Lokalex_" + System.currentTimeMillis());
                        if (!safeName.contains(".")) {
                            safeName += extension;
                        }

                        boolean saved = false;
                        Uri savedUri = null;

                        // Modern Android (API 29+ / Android 10, 11, 12, 13, 14, 15, 16): MediaStore without buggy IS_PENDING
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            ContentValues values = new ContentValues();
                            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Lokalex");

                            try {
                                savedUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                                if (savedUri != null) {
                                    try (OutputStream out = getContentResolver().openOutputStream(savedUri, "w")) {
                                        if (out != null) {
                                            out.write(imageBytes);
                                            out.flush();
                                            saved = true;
                                        }
                                    }
                                }
                            } catch (Exception insertEx) {
                                insertEx.printStackTrace();
                            }
                        }

                        // Fallback: Direct public Pictures directory
                        if (!saved) {
                            File picturesDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Lokalex");
                            if (!picturesDir.exists()) picturesDir.mkdirs();
                            File imageFile = new File(picturesDir, safeName);
                            try (FileOutputStream fos = new FileOutputStream(imageFile, false)) {
                                fos.write(imageBytes);
                                fos.flush();
                                saved = true;
                                MediaScannerConnection.scanFile(MainActivity.this, new String[]{imageFile.getAbsolutePath()}, new String[]{mimeType}, null);
                            }
                        } else if (savedUri != null) {
                            try {
                                sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, savedUri));
                            } catch (Exception ignored) {}
                        }

                        if (saved) {
                            if (showToast) {
                                new Handler(Looper.getMainLooper()).post(() -> {
                                    Toast.makeText(MainActivity.this, "💾 Litrato na-save sa Gallery / Pictures!", Toast.LENGTH_SHORT).show();
                                });
                            }
                            return true;
                        } else {
                            throw new Exception("Storage write failed");
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        if (showToast) {
                            new Handler(Looper.getMainLooper()).post(() -> {
                                Toast.makeText(MainActivity.this, "⚠️ Failed to save image: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                            });
                        }
                        return false;
                    }
                }

                @JavascriptInterface
                public void showNotification(String title, String message, String tag) {
                    showNotificationWithCustId(title, message, tag, null);
                }

                @JavascriptInterface
                public void showNotificationWithCustId(String title, String message, String tag, String custId) {
                    new Handler(Looper.getMainLooper()).post(() -> {
                        MainActivity.this.dispatchNativeNotification(title, message, tag, custId);
                    });
                }

                @JavascriptInterface
                public void syncRiderSession(String riderId, String riderName) {
                    if (riderId != null) {
                        getSharedPreferences("lokalex_prefs", Context.MODE_PRIVATE)
                                .edit()
                                .putString("rider_id", riderId.trim())
                                .putString("rider_name", riderName != null ? riderName.trim() : "")
                                .apply();
                        android.util.Log.i(TAG, "syncRiderSession persisted rider_id=" + riderId + ", rider_name=" + riderName);
                    }
                }

                @JavascriptInterface
                public String getSystemNotificationSounds() {
                    org.json.JSONArray soundList = new org.json.JSONArray();
                    java.util.HashSet<String> seenUris = new java.util.HashSet<>();
                    java.util.HashSet<String> seenTitles = new java.util.HashSet<>();
                    try {
                        // 1. Device Default Notification Tone
                        Uri defNotifUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                        if (defNotifUri != null) {
                            org.json.JSONObject defaultNotif = new org.json.JSONObject();
                            defaultNotif.put("id", "system_default");
                            defaultNotif.put("name", "Default Notification Tone");
                            defaultNotif.put("uri", defNotifUri.toString());
                            soundList.put(defaultNotif);
                            seenUris.add(defNotifUri.toString());
                            seenTitles.add("default notification tone");
                        }

                        // 2. Device Default Phone Ringtone
                        Uri defRingtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                        if (defRingtoneUri != null && !seenUris.contains(defRingtoneUri.toString())) {
                            org.json.JSONObject defaultRingtone = new org.json.JSONObject();
                            defaultRingtone.put("id", "system_phone_ringtone");
                            defaultRingtone.put("name", "Default Phone Ringtone");
                            defaultRingtone.put("uri", defRingtoneUri.toString());
                            soundList.put(defaultRingtone);
                            seenUris.add(defRingtoneUri.toString());
                            seenTitles.add("default phone ringtone");
                        }

                        // 3. Query All Phone System Ringtones, Notifications, and Alarms
                        int[] soundTypes = new int[]{ 
                            RingtoneManager.TYPE_RINGTONE, 
                            RingtoneManager.TYPE_NOTIFICATION, 
                            RingtoneManager.TYPE_ALARM 
                        };

                        for (int t : soundTypes) {
                            try {
                                RingtoneManager rm = new RingtoneManager(MainActivity.this);
                                rm.setType(t);
                                android.database.Cursor cursor = rm.getCursor();
                                while (cursor != null && cursor.moveToNext() && soundList.length() < 250) {
                                    String title = cursor.getString(RingtoneManager.TITLE_COLUMN_INDEX);
                                    String uriBase = cursor.getString(RingtoneManager.URI_COLUMN_INDEX);
                                    String id = cursor.getString(RingtoneManager.ID_COLUMN_INDEX);
                                    if (title != null && !title.trim().isEmpty() && uriBase != null && id != null) {
                                        String uriStr = uriBase + "/" + id;
                                        String normTitle = title.trim();
                                        if (!seenUris.contains(uriStr) && !seenTitles.contains(normTitle.toLowerCase())) {
                                            seenUris.add(uriStr);
                                            seenTitles.add(normTitle.toLowerCase());
                                            org.json.JSONObject item = new org.json.JSONObject();
                                            item.put("id", "system_" + Math.abs(uriStr.hashCode()));
                                            item.put("name", normTitle);
                                            item.put("uri", uriStr);
                                            soundList.put(item);
                                        }
                                    }
                                }
                            } catch (Exception e) {}
                        }
                    } catch (Exception ignored) {}
                    return soundList.toString();
                }

                @JavascriptInterface
                public void playSystemSound(String uriString) {
                    try {
                        if (activeSystemRingtone != null && activeSystemRingtone.isPlaying()) {
                            activeSystemRingtone.stop();
                        }
                        Uri soundUri;
                        if (uriString == null || uriString.isEmpty() || "system_default".equals(uriString)) {
                            soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                        } else if ("system_phone_ringtone".equals(uriString)) {
                            soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                        } else {
                            soundUri = Uri.parse(uriString);
                        }
                        activeSystemRingtone = RingtoneManager.getRingtone(MainActivity.this.getApplicationContext(), soundUri);
                        if (activeSystemRingtone != null) {
                            activeSystemRingtone.play();
                        }
                    } catch (Exception ignored) {}
                }

                @JavascriptInterface
                public void clearNotification(String tag) {
                    MainActivity.this.clearNativeNotification(tag);
                }

                @JavascriptInterface
                public void startKeepAlive() {
                    MainActivity.this.startKeepAliveService();
                }

                @JavascriptInterface
                public void stopKeepAlive() {
                    MainActivity.this.stopKeepAliveService();
                }

                @JavascriptInterface
                public boolean isIgnoringBatteryOptimizations() {
                    return MainActivity.this.isIgnoringBatteryOptimizations();
                }

                @JavascriptInterface
                public void requestIgnoreBatteryOptimizations() {
                    new Handler(Looper.getMainLooper()).post(MainActivity.this::requestIgnoreBatteryOptimizations);
                }

                @JavascriptInterface
                public boolean enterFloatingWindowMode() {
                    return MainActivity.this.enterPipMode();
                }

                @JavascriptInterface
                public boolean isFloatingWindowSupported() {
                    return MainActivity.this.isPipSupported();
                }

                @JavascriptInterface
                public boolean isInFloatingWindowMode() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        return MainActivity.this.isInPictureInPictureMode();
                    }
                    return false;
                }

                @JavascriptInterface
                public boolean isFloatingWindowStashed() {
                    return isPipStashed;
                }
            }, "NativePermissionsBridge");
        } catch (Exception e) {
            // Log fallback
        }

        // Initialize high-priority notification channel for chat messages & orders
        createMessagesNotificationChannel();

        // Process any launch intent from tapped notifications
        handleNotificationIntent(getIntent());

        // Keep background processing alive so Realtime Database listeners and orders never sleep
        startKeepAliveService();

        // Proactively ask for all permissions on launch with a small delay for UI rendering
        new Handler(Looper.getMainLooper()).postDelayed(this::checkAndRequestPermissions, 700);
    }

    public void startKeepAliveService() {
        if (LokalexForegroundService.isRunning()) {
            return;
        }
        try {
            Intent serviceIntent = new Intent(this, LokalexForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public void stopKeepAliveService() {
        try {
            Intent serviceIntent = new Intent(this, LokalexForegroundService.class);
            stopService(serviceIntent);
        } catch (Exception ignored) {}
    }

    @Override
    public void onResume() {
        super.onResume();
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
                getBridge().getWebView().resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        // Unpause WebView engine so background WebSockets and JS listeners stay connected!
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
                getBridge().getWebView().resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onStop() {
        super.onStop();
        // Keep WebView engine running so Firebase listeners don't sleep when screen is off
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
                getBridge().getWebView().resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    public boolean isPipSupported() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        }
        return false;
    }

    public boolean enterPipMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!isPipSupported()) {
                new Handler(Looper.getMainLooper()).post(() -> {
                    Toast.makeText(this, "⚠️ Floating window mode is not supported on this device.", Toast.LENGTH_SHORT).show();
                });
                return false;
            }
            try {
                // 9:16 aspect ratio (standard smartphone portrait mini-window)
                Rational aspectRatio = new Rational(9, 16);
                PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
                builder.setAspectRatio(aspectRatio);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    builder.setAutoEnterEnabled(true);
                    builder.setSeamlessResizeEnabled(true);
                }
                setPictureInPictureParams(builder.build());
                return enterPictureInPictureMode(builder.build());
            } catch (Exception e) {
                Log.e(TAG, "enterPipMode error: " + e.getMessage());
                try {
                    enterPictureInPictureMode();
                    return true;
                } catch (Exception ex) {
                    return false;
                }
            }
        } else {
            new Handler(Looper.getMainLooper()).post(() -> {
                Toast.makeText(this, "⚠️ Floating window requires Android 8.0 or newer.", Toast.LENGTH_SHORT).show();
            });
            return false;
        }
    }

    @Override
    public void onPictureInPictureUiStateChanged(PictureInPictureUiState pipState) {
        super.onPictureInPictureUiStateChanged(pipState);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                isPipStashed = pipState.isStashed();
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                            "if (typeof window.onFloatingWindowStashChanged === 'function') { window.onFloatingWindowStashChanged(" + isPipStashed + "); }",
                            null
                    );
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        try {
            if (!isInPictureInPictureMode) {
                isPipStashed = false;
            }
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                        "if (typeof window.onFloatingWindowModeChanged === 'function') { window.onFloatingWindowModeChanged(" + isInPictureInPictureMode + "); }" +
                        (!isInPictureInPictureMode ? "if (typeof window.onFloatingWindowStashChanged === 'function') { window.onFloatingWindowStashChanged(false); }" : ""),
                        null
                );
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        try {
            SharedPreferences prefs = getSharedPreferences("lokalex_prefs", Context.MODE_PRIVATE);
            boolean autoPip = prefs.getBoolean("auto_pip_on_leave", false);
            if (autoPip && isPipSupported() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !isInPictureInPictureMode()) {
                enterPipMode();
            }
        } catch (Exception ignored) {}
    }

    public boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                return pm.isIgnoringBatteryOptimizations(getPackageName());
            }
        }
        return true;
    }

    public void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    startActivity(intent);
                } catch (Exception ignored) {}
            }
        }
    }

    private boolean isAllGranted() {
        return getMissingPermissions().isEmpty();
    }

    private List<String> getMissingPermissions() {
        List<String> needed = new ArrayList<>();

        // 1. Notification Permission (Android 13+ / API 33+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        // 2. GPS / Location (Fine & Coarse)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }

        // 3. Camera Permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.CAMERA);
        }

        // 4. File Storage / Media Permissions
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_IMAGES);
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                }
            }
        }

        return needed;
    }

    private void checkAndRequestPermissions() {
        List<String> missing = getMissingPermissions();
        if (!missing.isEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), PERMISSION_REQ_CODE);
        } else {
            requestIgnoreBatteryOptimizations();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_CODE) {
            new Handler(Looper.getMainLooper()).postDelayed(this::requestIgnoreBatteryOptimizations, 600);
        }
    }

    private void createMessagesNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = manager.getNotificationChannel(MESSAGES_CHANNEL_ID);
                if (channel == null) {
                    channel = new NotificationChannel(
                            MESSAGES_CHANNEL_ID,
                            "Lokalex Messages & Orders",
                            NotificationManager.IMPORTANCE_HIGH
                    );
                    channel.setDescription("Incoming chat messages from selected sources and orders");
                    channel.enableVibration(true);
                    channel.setVibrationPattern(new long[]{0, 250, 150, 250});
                    channel.setShowBadge(true);
                    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                    Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                            .build();
                    channel.setSound(defaultSoundUri, audioAttributes);

                    manager.createNotificationChannel(channel);
                }
            }
        }
    }

    public void dispatchNativeNotification(String title, String message, String tag, String custId) {
        dispatchNativeNotification(this, title, message, tag, custId);
    }

    public static void dispatchNativeNotification(Context context, String title, String message, String tag, String custId) {
        if (context == null) return;
        try {
            ensureMessagesChannel(context);

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setAction(Intent.ACTION_MAIN);
            launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (custId != null && !custId.trim().isEmpty()) {
                launchIntent.putExtra("notification_cust_id", custId.trim());
            } else if (tag != null && !tag.trim().isEmpty()) {
                launchIntent.putExtra("notification_tag", tag.trim());
            }

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            int reqCode = (tag != null && !tag.isEmpty()) ? Math.abs(tag.hashCode()) : (int) (System.currentTimeMillis() % 100000);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context,
                    reqCode,
                    launchIntent,
                    flags
            );

            String safeTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Lokalex Message";
            String safeMsg = (message != null) ? message.trim() : "";

            Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            Bitmap largeIcon = null;
            try {
                largeIcon = BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher_round);
            } catch (Exception ignored) {}

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, MESSAGES_CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(safeTitle)
                    .setContentText(safeMsg)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(safeMsg))
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setDefaults(Notification.DEFAULT_ALL)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setSound(defaultSoundUri)
                    .setVibrate(new long[]{0, 250, 150, 250});

            if (largeIcon != null) {
                builder.setLargeIcon(largeIcon);
            }

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                int notifId = (tag != null && !tag.isEmpty()) ? Math.abs(tag.hashCode()) : (int) (System.currentTimeMillis() % 100000);
                manager.notify(tag != null && !tag.isEmpty() ? tag : "lokalex_msg", notifId, builder.build());
            }

            // Wake up device screen briefly so rider sees incoming notification even if screen is locked/off
            try {
                PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    PowerManager.WakeLock screenLock = pm.newWakeLock(
                            PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                            "Lokalex:NotificationScreenWake"
                    );
                    screenLock.acquire(4000);
                }
            } catch (Exception ignored) {}
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void ensureMessagesChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && context != null) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = manager.getNotificationChannel(MESSAGES_CHANNEL_ID);
                if (channel == null) {
                    channel = new NotificationChannel(
                            MESSAGES_CHANNEL_ID,
                            "Lokalex Messages & Orders",
                            NotificationManager.IMPORTANCE_HIGH
                    );
                    channel.setDescription("Incoming chat messages from selected sources and orders");
                    channel.enableVibration(true);
                    channel.setVibrationPattern(new long[]{0, 250, 150, 250});
                    channel.setShowBadge(true);
                    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                    Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                            .build();
                    channel.setSound(defaultSoundUri, audioAttributes);

                    manager.createNotificationChannel(channel);
                }
            }
        }
    }

    public void clearNativeNotification(String tag) {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                if (tag != null && !tag.trim().isEmpty()) {
                    int notifId = Math.abs(tag.trim().hashCode());
                    manager.cancel(tag.trim(), notifId);
                } else {
                    manager.cancelAll();
                }
            }
        } catch (Exception ignored) {}
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        String targetId = null;
        if (intent.hasExtra("notification_cust_id")) {
            targetId = intent.getStringExtra("notification_cust_id");
        } else if (intent.hasExtra("notification_tag")) {
            String tag = intent.getStringExtra("notification_tag");
            if (tag != null) {
                if (tag.startsWith("chat_")) {
                    targetId = tag.substring(5);
                } else {
                    targetId = tag;
                }
            }
        }

        if (targetId != null && !targetId.trim().isEmpty()) {
            final String finalTargetId = targetId.trim();
            for (int delay : new int[]{300, 1500, 3000}) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().evaluateJavascript(
                                    "if (window.handleNativeNotificationClick) { window.handleNativeNotificationClick('" + finalTargetId + "'); }",
                                    null
                            );
                        }
                    } catch (Exception ignored) {}
                }, delay);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    public void pulseWebViewKeepAlive() {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().resumeTimers();
                    getBridge().getWebView().evaluateJavascript(
                            "if (typeof window.keepAlivePulse === 'function') { window.keepAlivePulse(); }",
                            null
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }
}
