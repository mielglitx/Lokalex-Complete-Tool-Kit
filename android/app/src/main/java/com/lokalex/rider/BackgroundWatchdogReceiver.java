package com.lokalex.rider;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

/**
 * High-reliability hardware alarm watchdog receiver.
 * Wakes the CPU from deep sleep (screen off / Doze mode) to ensure
 * real-time Firebase orders and chat messages are checked without interruption.
 */
public class BackgroundWatchdogReceiver extends BroadcastReceiver {
    private static final String TAG = "BackgroundWatchdog";

    @Override
    public void onReceive(Context context, Intent intent) {
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = null;
        if (pm != null) {
            try {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Lokalex:WatchdogAlarmWake");
                wakeLock.acquire(10000L); // 10s CPU wake guarantee
            } catch (Exception ignored) {}
        }

        try {
            LokalexForegroundService.handleWatchdogPing(context);
        } catch (Exception e) {
            Log.e(TAG, "Watchdog ping error: " + e.getMessage());
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) {
                try {
                    wakeLock.release();
                } catch (Exception ignored) {}
            }
        }
    }
}

