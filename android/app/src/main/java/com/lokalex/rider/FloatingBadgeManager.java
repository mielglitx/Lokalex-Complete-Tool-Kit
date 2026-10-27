package com.lokalex.rider;

import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * High-performance native Floating Badge / Overlay Window Manager.
 * Replaces Picture-in-Picture (PiP) with an edge-docked floating head (similar to Messenger/Grab).
 * Displays distinct color-coded notification badges when messages arrive:
 * - Green for Inbox
 * - Orange for Catering
 * - Red for Followup
 * - Purple for Applicant
 * - White for Stores
 */
public class FloatingBadgeManager {
    private static final String TAG = "FloatingBadgeManager";
    private static final String PREFS_NAME = "lokalex_floating_badge_prefs";
    private static final String KEY_BADGE_X = "badge_x";
    private static final String KEY_BADGE_Y = "badge_y";
    private static final String KEY_AUTO_FLOAT = "auto_float_on_background";

    private static volatile FloatingBadgeManager instance = null;

    private final Context appContext;
    private final WindowManager windowManager;
    private View badgeRootView = null;
    private WindowManager.LayoutParams layoutParams = null;
    private FrameLayout cardView = null;
    private GradientDrawable cardBgShape = null;
    private View pulseDotView = null;
    private GradientDrawable pulseDotShape = null;
    private TextView unreadBadgeTextView = null;
    private boolean isShowing = false;

    private String currentBadgeFolder = null;
    private int currentUnreadCount = 0;

    public static FloatingBadgeManager getInstance(Context context) {
        if (instance == null) {
            synchronized (FloatingBadgeManager.class) {
                if (instance == null) {
                    instance = new FloatingBadgeManager(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    private FloatingBadgeManager(Context context) {
        this.appContext = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    public static int getFolderColor(String folder) {
        if (folder == null) return Color.parseColor("#10B981"); // Default green
        switch (folder.toLowerCase().trim()) {
            case "inbox":
                return Color.parseColor("#10B981"); // Green
            case "catering":
                return Color.parseColor("#F97316"); // Orange
            case "followup":
            case "follow_up":
            case "follow-up":
                return Color.parseColor("#EF4444"); // Red
            case "applicant":
                return Color.parseColor("#A855F7"); // Purple
            case "stores":
            case "store":
                return Color.parseColor("#FFFFFF"); // White
            default:
                return Color.parseColor("#10B981"); // Default Green
        }
    }

    public boolean canDrawOverlays() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(appContext);
        }
        return true;
    }

    public void requestOverlayPermission(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + appContext.getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to open overlay settings: " + e.getMessage());
            }
        }
    }

    public boolean isAutoFloatEnabled() {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_AUTO_FLOAT, true);
    }

    public void setAutoFloatEnabled(boolean enabled) {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_AUTO_FLOAT, enabled).apply();
    }

    public boolean isShowing() {
        return isShowing && badgeRootView != null;
    }

    @SuppressLint("ClickableViewAccessibility")
    public void showBadge() {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (!canDrawOverlays()) {
                Log.w(TAG, "Cannot show floating badge: SYSTEM_ALERT_WINDOW permission not granted");
                return;
            }

            if (isShowing && badgeRootView != null) {
                return;
            }

            try {
                DisplayMetrics metrics = appContext.getResources().getDisplayMetrics();
                int screenWidth = metrics.widthPixels;
                int screenHeight = metrics.heightPixels;

                int badgeSizePx = dpToPx(66);

                int layoutType;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    layoutType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
                } else {
                    layoutType = WindowManager.LayoutParams.TYPE_PHONE;
                }

                layoutParams = new WindowManager.LayoutParams(
                        badgeSizePx,
                        badgeSizePx,
                        layoutType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                );
                layoutParams.gravity = Gravity.TOP | Gravity.START;

                SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                int savedX = prefs.getInt(KEY_BADGE_X, screenWidth - badgeSizePx - dpToPx(8));
                int savedY = prefs.getInt(KEY_BADGE_Y, screenHeight / 3);

                layoutParams.x = Math.max(0, Math.min(savedX, screenWidth - badgeSizePx));
                layoutParams.y = Math.max(dpToPx(60), Math.min(savedY, screenHeight - badgeSizePx - dpToPx(80)));

                badgeRootView = createBadgeView(badgeSizePx);
                setupTouchListener(badgeRootView, layoutParams, screenWidth, screenHeight, badgeSizePx);

                windowManager.addView(badgeRootView, layoutParams);
                isShowing = true;
                Log.i(TAG, "Floating badge displayed successfully at (" + layoutParams.x + ", " + layoutParams.y + ")");
            } catch (Exception e) {
                Log.e(TAG, "Failed to show floating badge: " + e.getMessage(), e);
                badgeRootView = null;
                isShowing = false;
            }
        });
    }

    public void hideBadge() {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (badgeRootView != null && isShowing) {
                try {
                    windowManager.removeView(badgeRootView);
                    Log.i(TAG, "Floating badge removed");
                } catch (Exception e) {
                    Log.w(TAG, "Error removing floating badge view: " + e.getMessage());
                }
                badgeRootView = null;
                cardView = null;
                cardBgShape = null;
                pulseDotView = null;
                pulseDotShape = null;
                unreadBadgeTextView = null;
                isShowing = false;
            }
        });
    }

    /**
     * Called when a new incoming chat message arrives.
     * Color-codes the floating badge and pulses to catch the rider's attention.
     */
    public void onIncomingChatMessage(String folder, int unreadCount, String senderName, String messagePreview) {
        new Handler(Looper.getMainLooper()).post(() -> {
            currentBadgeFolder = folder;
            currentUnreadCount = unreadCount > 0 ? unreadCount : 1;

            if (!isShowing) {
                showBadge();
            } else {
                applyFolderBadgeTheme(currentBadgeFolder, currentUnreadCount);
            }

            // Smooth bounce animation on card to alert the rider
            if (cardView != null) {
                cardView.animate()
                        .scaleX(1.18f)
                        .scaleY(1.18f)
                        .setDuration(160)
                        .withEndAction(() -> {
                            if (cardView != null) {
                                cardView.animate().scaleX(1.0f).scaleY(1.0f).setDuration(160).start();
                            }
                        })
                        .start();
            }
        });
    }

    public void updateCategoryBadge(String folder, int count) {
        new Handler(Looper.getMainLooper()).post(() -> {
            currentBadgeFolder = folder;
            currentUnreadCount = count;
            applyFolderBadgeTheme(folder, count);
        });
    }

    public void clearCategoryBadge() {
        new Handler(Looper.getMainLooper()).post(() -> {
            currentBadgeFolder = null;
            currentUnreadCount = 0;
            applyFolderBadgeTheme(null, 0);
        });
    }

    public void updateUnreadCount(int unreadCount) {
        updateCategoryBadge(currentBadgeFolder, unreadCount);
    }

    private void applyFolderBadgeTheme(String folder, int count) {
        int folderColor = getFolderColor(folder);
        boolean hasUnread = count > 0 && folder != null;

        // 1. Update Card Border Stroke
        if (cardBgShape != null) {
            int strokeColor = hasUnread ? folderColor : Color.parseColor("#10B981");
            cardBgShape.setStroke(dpToPx(hasUnread ? 3f : 2.5f), strokeColor);
        }

        // 2. Update Pulse Dot
        if (pulseDotShape != null) {
            int dotColor = hasUnread ? folderColor : Color.parseColor("#10B981");
            pulseDotShape.setColor(dotColor);
        }

        // 3. Update Unread Counter Pill Badge
        if (unreadBadgeTextView != null) {
            if (hasUnread) {
                unreadBadgeTextView.setVisibility(View.VISIBLE);
                unreadBadgeTextView.setText(count > 99 ? "99+" : String.valueOf(count));

                GradientDrawable countShape = new GradientDrawable();
                countShape.setShape(GradientDrawable.RECTANGLE);
                countShape.setCornerRadius(dpToPx(9));
                countShape.setColor(folderColor);
                countShape.setStroke(dpToPx(1.5f), Color.parseColor("#0C1814"));
                unreadBadgeTextView.setBackground(countShape);

                // White badge (stores) uses dark text for contrast
                if (folderColor == Color.WHITE || (folder != null && "stores".equalsIgnoreCase(folder))) {
                    unreadBadgeTextView.setTextColor(Color.parseColor("#0F172A"));
                } else {
                    unreadBadgeTextView.setTextColor(Color.WHITE);
                }
            } else {
                unreadBadgeTextView.setVisibility(View.GONE);
            }
        }
    }

    private View createBadgeView(int sizePx) {
        FrameLayout container = new FrameLayout(appContext);
        container.setLayoutParams(new FrameLayout.LayoutParams(sizePx, sizePx));

        // 1. Circular Outer Badge Container with Dynamic Category Border & Dark Base
        cardView = new FrameLayout(appContext);
        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
                sizePx - dpToPx(10),
                sizePx - dpToPx(10)
        );
        cardParams.gravity = Gravity.CENTER;
        cardView.setLayoutParams(cardParams);

        cardBgShape = new GradientDrawable();
        cardBgShape.setShape(GradientDrawable.OVAL);
        cardBgShape.setColor(Color.parseColor("#0C1814"));
        cardBgShape.setStroke(dpToPx(2.5f), Color.parseColor("#10B981"));
        cardView.setBackground(cardBgShape);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cardView.setElevation(dpToPx(8));
        }

        // 2. Logo Icon Inside
        ImageView logoView = new ImageView(appContext);
        FrameLayout.LayoutParams logoParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        int padding = dpToPx(7);
        logoParams.setMargins(padding, padding, padding, padding);
        logoView.setLayoutParams(logoParams);
        logoView.setImageResource(R.mipmap.ic_launcher_round);
        logoView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        cardView.addView(logoView);

        container.addView(cardView);

        // 3. Pulsing Active Indicator (Top Right Dot)
        pulseDotView = new View(appContext);
        FrameLayout.LayoutParams dotParams = new FrameLayout.LayoutParams(dpToPx(13), dpToPx(13));
        dotParams.gravity = Gravity.TOP | Gravity.START;
        dotParams.setMargins(dpToPx(2), dpToPx(2), 0, 0);
        pulseDotView.setLayoutParams(dotParams);

        pulseDotShape = new GradientDrawable();
        pulseDotShape.setShape(GradientDrawable.OVAL);
        pulseDotShape.setColor(Color.parseColor("#10B981"));
        pulseDotShape.setStroke(dpToPx(1.5f), Color.parseColor("#0C1814"));
        pulseDotView.setBackground(pulseDotShape);
        container.addView(pulseDotView);

        // 4. Color-Coded Category / Unread Notification Counter Badge (Bottom Right Pill)
        unreadBadgeTextView = new TextView(appContext);
        FrameLayout.LayoutParams countParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                dpToPx(18)
        );
        countParams.gravity = Gravity.BOTTOM | Gravity.END;
        countParams.setMargins(0, 0, dpToPx(1), dpToPx(1));
        unreadBadgeTextView.setLayoutParams(countParams);
        unreadBadgeTextView.setMinimumWidth(dpToPx(18));
        unreadBadgeTextView.setPadding(dpToPx(5), 0, dpToPx(5), 0);
        unreadBadgeTextView.setTextSize(9.5f);
        unreadBadgeTextView.setTypeface(Typeface.DEFAULT_BOLD);
        unreadBadgeTextView.setTextColor(Color.WHITE);
        unreadBadgeTextView.setGravity(Gravity.CENTER);

        GradientDrawable countShape = new GradientDrawable();
        countShape.setShape(GradientDrawable.RECTANGLE);
        countShape.setCornerRadius(dpToPx(9));
        countShape.setColor(Color.parseColor("#10B981"));
        countShape.setStroke(dpToPx(1.5f), Color.parseColor("#0C1814"));
        unreadBadgeTextView.setBackground(countShape);
        unreadBadgeTextView.setVisibility(View.GONE);
        container.addView(unreadBadgeTextView);

        // Apply any pending folder badge state
        applyFolderBadgeTheme(currentBadgeFolder, currentUnreadCount);

        return container;
    }

    @SuppressLint("ClickableViewAccessibility")
    private void setupTouchListener(
            final View view,
            final WindowManager.LayoutParams params,
            final int screenWidth,
            final int screenHeight,
            final int badgeSizePx
    ) {
        view.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private long touchStartTime;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        touchStartTime = System.currentTimeMillis();
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        if (badgeRootView != null) {
                            try {
                                windowManager.updateViewLayout(badgeRootView, params);
                            } catch (Exception ignored) {}
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);

                        if (duration < 250 && diffX < dpToPx(10) && diffY < dpToPx(10)) {
                            // Tap event: Bring Lokalex Rider back to foreground
                            openApp();
                        } else {
                            // Drag event: Snap to nearest edge
                            snapToNearestEdge(params, screenWidth, badgeSizePx);
                        }
                        return true;
                }
                return false;
            }
        });
    }

    private void snapToNearestEdge(final WindowManager.LayoutParams params, int screenWidth, int badgeSizePx) {
        int targetX = (params.x + badgeSizePx / 2 < screenWidth / 2) ? dpToPx(6) : (screenWidth - badgeSizePx - dpToPx(6));
        int startX = params.x;

        ValueAnimator animator = ValueAnimator.ofInt(startX, targetX);
        animator.setDuration(220);
        animator.setInterpolator(new DecelerateInterpolator());
        animator.addUpdateListener(animation -> {
            params.x = (int) animation.getAnimatedValue();
            if (badgeRootView != null) {
                try {
                    windowManager.updateViewLayout(badgeRootView, params);
                } catch (Exception ignored) {}
            }
        });
        animator.start();

        // Save position
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(KEY_BADGE_X, targetX).putInt(KEY_BADGE_Y, params.y).apply();
    }

    private void openApp() {
        try {
            Intent launchIntent = new Intent(appContext, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            appContext.startActivity(launchIntent);
        } catch (Exception e) {
            Log.e(TAG, "Error bringing app to front: " + e.getMessage());
        }
    }

    private int dpToPx(float dp) {
        return Math.round(dp * appContext.getResources().getDisplayMetrics().density);
    }
}
