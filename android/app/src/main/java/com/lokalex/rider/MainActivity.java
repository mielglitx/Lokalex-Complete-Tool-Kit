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
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 9922;
    public static final String MESSAGES_CHANNEL_ID = "lokalex_messages_channel";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Reserve space for native status bar so web content is not blocked by clock/icons
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
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
                public boolean saveImageToDevice(String base64Data, String filename) {
                    return saveImageToDevice(base64Data, filename, true);
                }

                @JavascriptInterface
                public boolean saveImageToDevice(String base64Data, String filename, boolean showToast) {
                    if (base64Data == null || base64Data.trim().isEmpty()) return false;
                    try {
                        String cleanBase64 = base64Data.trim();
                        String mimeType = "image/png";
                        if (cleanBase64.contains(",")) {
                            String header = cleanBase64.substring(0, cleanBase64.indexOf(","));
                            if (header.contains("jpeg") || header.contains("jpg")) mimeType = "image/jpeg";
                            else if (header.contains("webp")) mimeType = "image/webp";
                            cleanBase64 = cleanBase64.substring(cleanBase64.indexOf(",") + 1);
                        }
                        byte[] imageBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
                        String safeName = (filename != null && !filename.trim().isEmpty()) 
                                ? filename.trim() 
                                : ("Lokalex_" + System.currentTimeMillis() + (mimeType.contains("jpeg") ? ".jpg" : ".png"));
                        if (!safeName.contains(".")) {
                            safeName += mimeType.contains("jpeg") ? ".jpg" : ".png";
                        }

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            String targetPath = Environment.DIRECTORY_PICTURES + "/Lokalex";
                            // Auto-overwrite existing image by deleting any prior entry with matching name in Lokalex folder
                            try {
                                String selection = MediaStore.Images.Media.DISPLAY_NAME + "=?";
                                String[] selectionArgs = new String[]{ safeName };
                                getContentResolver().delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, selection, selectionArgs);
                            } catch (Exception ignored) {}

                            ContentValues values = new ContentValues();
                            values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName);
                            values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
                            values.put(MediaStore.Images.Media.RELATIVE_PATH, targetPath);
                            values.put(MediaStore.Images.Media.IS_PENDING, 1);

                            Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                            if (uri != null) {
                                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                                    if (out != null) {
                                        out.write(imageBytes);
                                        out.flush();
                                    }
                                }
                                values.clear();
                                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                                getContentResolver().update(uri, values, null, null);
                            }
                        } else {
                            File picturesDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Lokalex");
                            if (!picturesDir.exists()) picturesDir.mkdirs();
                            File imageFile = new File(picturesDir, safeName);
                            if (imageFile.exists()) {
                                imageFile.delete();
                            }
                            try (FileOutputStream fos = new FileOutputStream(imageFile, false)) {
                                fos.write(imageBytes);
                                fos.flush();
                            }
                            MediaScannerConnection.scanFile(MainActivity.this, new String[]{imageFile.getAbsolutePath()}, new String[]{mimeType}, null);
                        }

                        if (showToast) {
                            new Handler(Looper.getMainLooper()).post(() -> {
                                Toast.makeText(MainActivity.this, "💾 Litrato na-save sa Gallery / Pictures!", Toast.LENGTH_SHORT).show();
                            });
                        }
                        return true;
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
    public void onPause() {
        super.onPause();
        // Prevent Android WebView from freezing timers & network when minimized
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
        // Keep WebView timers and network running during background minimization
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
                getBridge().getWebView().resumeTimers();
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
        try {
            createMessagesNotificationChannel();

            Intent launchIntent = new Intent(this, MainActivity.class);
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
                    this,
                    reqCode,
                    launchIntent,
                    flags
            );

            String safeTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Lokalex Message";
            String safeMsg = (message != null) ? message.trim() : "";

            Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            Bitmap largeIcon = null;
            try {
                largeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher_round);
            } catch (Exception ignored) {}

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MESSAGES_CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(safeTitle)
                    .setContentText(safeMsg)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(safeMsg))
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setSound(defaultSoundUri)
                    .setVibrate(new long[]{0, 250, 150, 250});

            if (largeIcon != null) {
                builder.setLargeIcon(largeIcon);
            }

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                int notifId = (tag != null && !tag.isEmpty()) ? Math.abs(tag.hashCode()) : (int) (System.currentTimeMillis() % 100000);
                manager.notify(tag != null && !tag.isEmpty() ? tag : "lokalex_msg", notifId, builder.build());
            }
        } catch (Exception e) {
            e.printStackTrace();
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
}
