package com.lokalex.rider;

import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
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
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.OrientationEventListener;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * Native Floating Badge / Overlay Window Manager.
 * Replaces Picture-in-Picture (PiP) with an edge-docked floating head.
 * Stays permanently pinned / stuck to the side of the screen in both portrait and landscape orientations.
 * Color-codes badges on incoming chat messages (Green=Inbox, Orange=Catering, Red=Followup, Purple=Applicant, White=Stores).
 */
public class FloatingBadgeManager {
    private static final String PREFS_NAME = "lokalex_floating_badge_prefs";
    private static final String KEY_IS_DOCKED_ON_RIGHT = "is_docked_on_right";
    private static final String KEY_RELATIVE_Y_RATIO = "relative_y_ratio";
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

    private boolean isDockedOnRight = true;
    private float relativeYRatio = 0.35f;

    private String currentBadgeFolder = null;
    private int currentUnreadCount = 0;

    private OrientationEventListener orientationListener = null;
    private ComponentCallbacks2 componentCallbacks = null;

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

        // Hydrate persisted docking edge and relative Y position
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.isDockedOnRight = prefs.getBoolean(KEY_IS_DOCKED_ON_RIGHT, true);
        this.relativeYRatio = prefs.getFloat(KEY_RELATIVE_Y_RATIO, 0.35f);

        initOrientationWatchers();
    }

    private void initOrientationWatchers() {
        // 1. ComponentCallbacks to watch for configuration / orientation / screen size changes
        try {
            componentCallbacks = new ComponentCallbacks2() {
                @Override
                public void onConfigurationChanged(Configuration newConfig) {
                    onOrientationOrScreenSizeChanged();
                }

                @Override
                public void onLowMemory() {}

                @Override
                public void onTrimMemory(int level) {}
            };
            appContext.registerComponentCallbacks(componentCallbacks);
        } catch (Exception ignored) {}

        // 2. Hardware OrientationEventListener for instant rotation detection
        try {
            orientationListener = new OrientationEventListener(appContext) {
                private int lastConfigOrientation = -1;

                @Override
                public void onOrientationChanged(int orientation) {
                    if (orientation == ORIENTATION_UNKNOWN) return;
                    int currentConfigOrientation = appContext.getResources().getConfiguration().orientation;
                    if (currentConfigOrientation != lastConfigOrientation) {
                        lastConfigOrientation = currentConfigOrientation;
                        onOrientationOrScreenSizeChanged();
                    }
                }
            };
            if (orientationListener.canDetectOrientation()) {
                orientationListener.enable();
            }
        } catch (Exception ignored) {}
    }

    public static int getFolderColor(String folder) {
        if (folder == null) return Color.parseColor("#10B981");
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
            } catch (Exception ignored) {}
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
            if (!canDrawOverlays()) return;

            if (isShowing && badgeRootView != null) {
                // Ensure properly docked to edge if already showing
                repositionToActiveEdge(false);
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

                // Always stick firmly to the saved side (left or right)
                layoutParams.x = isDockedOnRight ? (screenWidth - badgeSizePx - dpToPx(6)) : dpToPx(6);
                layoutParams.y = Math.max(dpToPx(50), Math.min((int) (screenHeight * relativeYRatio), screenHeight - badgeSizePx - dpToPx(60)));

                badgeRootView = createBadgeView(badgeSizePx);
                setupTouchListener(badgeRootView, layoutParams, badgeSizePx);

                windowManager.addView(badgeRootView, layoutParams);
                isShowing = true;
            } catch (Exception e) {
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
                } catch (Exception ignored) {}
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
     * Called whenever screen orientation or resolution changes (Portrait <-> Landscape).
     * Smoothly re-docks the floating badge against the side of the screen.
     */
    public void onOrientationOrScreenSizeChanged() {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            repositionToActiveEdge(true);
        }, 120);
    }

    private void repositionToActiveEdge(boolean animate) {
        if (badgeRootView == null || !isShowing || layoutParams == null) return;
        try {
            DisplayMetrics metrics = appContext.getResources().getDisplayMetrics();
            int screenWidth = metrics.widthPixels;
            int screenHeight = metrics.heightPixels;
            int badgeSizePx = dpToPx(66);

            int targetX = isDockedOnRight ? (screenWidth - badgeSizePx - dpToPx(6)) : dpToPx(6);
            int targetY = Math.max(dpToPx(50), Math.min((int) (screenHeight * relativeYRatio), screenHeight - badgeSizePx - dpToPx(60)));

            if (animate) {
                animateToPosition(layoutParams.x, layoutParams.y, targetX, targetY);
            } else {
                layoutParams.x = targetX;
                layoutParams.y = targetY;
                windowManager.updateViewLayout(badgeRootView, layoutParams);
            }
        } catch (Exception ignored) {}
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

            // Smooth attention bounce
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

        // 1. Circular Outer Badge Container
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

        // 3. Status Dot (Top Left)
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

        // 4. Color-Coded Category / Unread Counter Badge (Bottom Right Pill)
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

        applyFolderBadgeTheme(currentBadgeFolder, currentUnreadCount);

        return container;
    }

    @SuppressLint("ClickableViewAccessibility")
    private void setupTouchListener(
            final View view,
            final WindowManager.LayoutParams params,
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
                            // Tap: Bring Lokalex Rider to foreground
                            openApp();
                        } else {
                            // Drag: Snap and stick firmly to nearest side (left or right)
                            snapToNearestEdge(params, badgeSizePx);
                        }
                        return true;
                }
                return false;
            }
        });
    }

    private void snapToNearestEdge(final WindowManager.LayoutParams params, int badgeSizePx) {
        DisplayMetrics metrics = appContext.getResources().getDisplayMetrics();
        int screenWidth = metrics.widthPixels;
        int screenHeight = metrics.heightPixels;

        // Determine nearest side
        boolean snapToRight = (params.x + badgeSizePx / 2) >= (screenWidth / 2);
        int targetX = snapToRight ? (screenWidth - badgeSizePx - dpToPx(6)) : dpToPx(6);
        int clampedY = Math.max(dpToPx(50), Math.min(params.y, screenHeight - badgeSizePx - dpToPx(60)));

        isDockedOnRight = snapToRight;
        relativeYRatio = Math.max(0.05f, Math.min(0.90f, (float) clampedY / (float) screenHeight));

        // Persist preferences
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putBoolean(KEY_IS_DOCKED_ON_RIGHT, isDockedOnRight)
                .putFloat(KEY_RELATIVE_Y_RATIO, relativeYRatio)
                .apply();

        animateToPosition(params.x, params.y, targetX, clampedY);
    }

    private void animateToPosition(int startX, int startY, int targetX, int targetY) {
        if (badgeRootView == null || layoutParams == null) return;

        ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(220);
        animator.setInterpolator(new DecelerateInterpolator());
        animator.addUpdateListener(animation -> {
            float fraction = (float) animation.getAnimatedValue();
            layoutParams.x = (int) (startX + (targetX - startX) * fraction);
            layoutParams.y = (int) (startY + (targetY - startY) * fraction);
            if (badgeRootView != null) {
                try {
                    windowManager.updateViewLayout(badgeRootView, layoutParams);
                } catch (Exception ignored) {}
            }
        });
        animator.start();
    }

    private void openApp() {
        try {
            Intent launchIntent = new Intent(appContext, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            appContext.startActivity(launchIntent);
        } catch (Exception ignored) {}
    }

    private int dpToPx(float dp) {
        return Math.round(dp * appContext.getResources().getDisplayMetrics().density);
    }
}
