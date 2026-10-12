package com.lokalex.rider;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 9922;

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
            }, "NativePermissionsBridge");
        } catch (Exception e) {
            // Log fallback
        }

        // Proactively ask for all permissions on launch with a small delay for UI rendering
        new Handler(Looper.getMainLooper()).postDelayed(this::checkAndRequestPermissions, 700);
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
        }
    }
}
