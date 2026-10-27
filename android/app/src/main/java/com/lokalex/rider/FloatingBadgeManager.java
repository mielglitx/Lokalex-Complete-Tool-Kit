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
import android.graphics.Point;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.OrientationEventListener;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.WindowMetrics;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
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

    // Dismiss / Close target at the bottom of the screen
    private View dismissTargetView = null;
    private WindowManager.LayoutParams dismissLayoutParams = null;
    private FrameLayout dismissCircleView = null;
    private GradientDrawable dismissCircleShape = null;
    private TextView dismissTextView = null;
    private TextView dismissLabelView = null;
    private boolean isDismissTargetShowing = false;
    private boolean isHoveringDismiss = false;

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

    /**
     * Accurately determines the real physical screen dimensions in the current display orientation.
     * Prevents ApplicationContext from returning stale portrait dimensions in landscape mode.
     */
    public Point getRealScreenSize() {
        Point size = new Point();

        // 1. Android 11+ (API 30+) WindowMetrics
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                WindowMetrics windowMetrics = windowManager.getCurrentWindowMetrics();
                Rect bounds = windowMetrics.getBounds();
                size.x = bounds.width();
                size.y = bounds.height();
                if (size.x > 0 && size.y > 0) {
                    return size;
                }
            } catch (Exception ignored) {}
        }

        // 2. Android Display.getRealMetrics()
        try {
            Display display = windowManager.getDefaultDisplay();
            DisplayMetrics realMetrics = new DisplayMetrics();
            display.getRealMetrics(realMetrics);
            size.x = realMetrics.widthPixels;
            size.y = realMetrics.heightPixels;
            if (size.x > 0 && size.y > 0) {
                return size;
            }
        } catch (Exception ignored) {}

        // 3. Robust fallback using configuration orientation
        DisplayMetrics dm = appContext.getResources().getDisplayMetrics();
        int w = dm.widthPixels;
        int h = dm.heightPixels;
        int orientation = appContext.getResources().getConfiguration().orientation;
        if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
            size.x = Math.max(w, h);
            size.y = Math.min(w, h);
        } else {
            size.x = Math.min(w, h);
            size.y = Math.max(w, h);
        }
        return size;
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
                if (cardView != null) {
                    cardView.setScaleX(1.0f);
                    cardView.setScaleY(1.0f);
                    cardView.setAlpha(1.0f);
                }
                repositionToActiveEdge(false);
                return;
            }

            try {
                Point screen = getRealScreenSize();
                int screenWidth = screen.x;
                int screenHeight = screen.y;
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
            if (isDismissTargetShowing && dismissTargetView != null) {
                try {
                    windowManager.removeView(dismissTargetView);
                } catch (Exception ignored) {}
                dismissTargetView = null;
                isDismissTargetShowing = false;
                isHoveringDismiss = false;
            }

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
            if (isDismissTargetShowing) {
                hideDismissTarget();
            }
            repositionToActiveEdge(true);
        }, 150);
    }

    private void repositionToActiveEdge(boolean animate) {
        if (badgeRootView == null || !isShowing || layoutParams == null) return;
        try {
            Point screen = getRealScreenSize();
            int screenWidth = screen.x;
            int screenHeight = screen.y;
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
        final int touchSlop = ViewConfiguration.get(appContext).getScaledTouchSlop();

        view.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private long touchStartTime;
            private boolean isDragging = false;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        touchStartTime = System.currentTimeMillis();
                        isDragging = false;
                        isHoveringDismiss = false;
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        float deltaX = event.getRawX() - initialTouchX;
                        float deltaY = event.getRawY() - initialTouchY;

                        if (!isDragging && Math.hypot(deltaX, deltaY) > touchSlop) {
                            isDragging = true;
                            showDismissTarget();
                        }

                        if (isDragging) {
                            Point screen = getRealScreenSize();
                            int newX = initialX + (int) deltaX;
                            int newY = initialY + (int) deltaY;
                            // Allow dragging across the full physical screen width and height
                            params.x = Math.max(0, Math.min(newX, screen.x - badgeSizePx));
                            params.y = Math.max(dpToPx(20), Math.min(newY, screen.y - badgeSizePx - dpToPx(10)));

                            checkDismissHover(params, badgeSizePx, screen, event);

                            if (badgeRootView != null) {
                                try {
                                    windowManager.updateViewLayout(badgeRootView, params);
                                } catch (Exception ignored) {}
                            }
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        if (isDragging) {
                            boolean shouldClose = isHoveringDismiss;
                            hideDismissTarget();

                            if (shouldClose) {
                                triggerDismissHaptic();
                                animateDismissBadgeAndHide();
                            } else {
                                snapToNearestEdge(params, badgeSizePx);
                            }
                        } else {
                            long duration = System.currentTimeMillis() - touchStartTime;
                            float diffX = Math.abs(event.getRawX() - initialTouchX);
                            float diffY = Math.abs(event.getRawY() - initialTouchY);

                            if (duration < 300 && diffX < dpToPx(10) && diffY < dpToPx(10)) {
                                // Tap: Bring Lokalex Rider to foreground
                                openApp();
                            }
                        }
                        return true;
                }
                return false;
            }
        });
    }

    private void showDismissTarget() {
        if (isDismissTargetShowing || badgeRootView == null) return;
        try {
            Point screen = getRealScreenSize();
            int targetWidth = dpToPx(140);
            int targetHeight = dpToPx(96);

            int layoutType;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                layoutType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
            } else {
                layoutType = WindowManager.LayoutParams.TYPE_PHONE;
            }

            dismissLayoutParams = new WindowManager.LayoutParams(
                    targetWidth,
                    targetHeight,
                    layoutType,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT
            );
            dismissLayoutParams.gravity = Gravity.TOP | Gravity.START;
            dismissLayoutParams.x = (screen.x - targetWidth) / 2;
            dismissLayoutParams.y = screen.y - targetHeight - dpToPx(24);

            if (dismissTargetView == null) {
                dismissTargetView = createDismissTargetView(targetWidth, targetHeight);
            }

            dismissTargetView.setAlpha(0f);
            dismissTargetView.setScaleX(0.7f);
            dismissTargetView.setScaleY(0.7f);
            setDismissTargetHovered(false);

            windowManager.addView(dismissTargetView, dismissLayoutParams);
            isDismissTargetShowing = true;

            dismissTargetView.animate()
                    .alpha(1f)
                    .scaleX(1f)
                    .scaleY(1f)
                    .setDuration(180)
                    .start();
        } catch (Exception e) {
            isDismissTargetShowing = false;
        }
    }

    private void hideDismissTarget() {
        if (!isDismissTargetShowing || dismissTargetView == null) return;
        final View viewToRemove = dismissTargetView;
        isDismissTargetShowing = false;
        isHoveringDismiss = false;

        // Restore badge scale if it was shrunk during hover
        if (cardView != null) {
            cardView.animate().scaleX(1.0f).scaleY(1.0f).alpha(1.0f).setDuration(120).start();
        }

        viewToRemove.animate()
                .alpha(0f)
                .scaleX(0.7f)
                .scaleY(0.7f)
                .setDuration(140)
                .withEndAction(() -> {
                    try {
                        windowManager.removeView(viewToRemove);
                    } catch (Exception ignored) {}
                })
                .start();
    }

    private View createDismissTargetView(int widthPx, int heightPx) {
        LinearLayout container = new LinearLayout(appContext);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setGravity(Gravity.CENTER_HORIZONTAL);
        container.setLayoutParams(new ViewGroup.LayoutParams(widthPx, heightPx));

        // 1. Circular target (56dp x 56dp)
        int circleSize = dpToPx(56);
        dismissCircleView = new FrameLayout(appContext);
        LinearLayout.LayoutParams circleParams = new LinearLayout.LayoutParams(circleSize, circleSize);
        circleParams.gravity = Gravity.CENTER_HORIZONTAL;
        dismissCircleView.setLayoutParams(circleParams);

        dismissCircleShape = new GradientDrawable();
        dismissCircleShape.setShape(GradientDrawable.OVAL);
        dismissCircleShape.setColor(Color.parseColor("#CC0F172A"));
        dismissCircleShape.setStroke(dpToPx(2f), Color.parseColor("#475569"));
        dismissCircleView.setBackground(dismissCircleShape);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            dismissCircleView.setElevation(dpToPx(8));
        }

        // 2. Cross "✕" Icon inside circle
        dismissTextView = new TextView(appContext);
        FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        dismissTextView.setLayoutParams(iconParams);
        dismissTextView.setText("✕");
        dismissTextView.setTextSize(20);
        dismissTextView.setTypeface(Typeface.DEFAULT_BOLD);
        dismissTextView.setTextColor(Color.WHITE);
        dismissTextView.setGravity(Gravity.CENTER);
        dismissCircleView.addView(dismissTextView);

        container.addView(dismissCircleView);

        // 3. Label "Drag here to close"
        dismissLabelView = new TextView(appContext);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        labelParams.topMargin = dpToPx(4);
        labelParams.gravity = Gravity.CENTER_HORIZONTAL;
        dismissLabelView.setLayoutParams(labelParams);
        dismissLabelView.setText("Drag here to close");
        dismissLabelView.setTextSize(10);
        dismissLabelView.setTypeface(Typeface.DEFAULT_BOLD);
        dismissLabelView.setTextColor(Color.parseColor("#94A3B8"));
        dismissLabelView.setShadowLayer(dpToPx(2), 0, dpToPx(1), Color.BLACK);
        container.addView(dismissLabelView);

        return container;
    }

    private void checkDismissHover(
            WindowManager.LayoutParams params,
            int badgeSizePx,
            Point screen,
            MotionEvent event
    ) {
        if (!isDismissTargetShowing || dismissTargetView == null) return;

        int dismissCenterX = screen.x / 2;
        int targetHeight = dpToPx(96);
        int dismissCenterY = screen.y - targetHeight - dpToPx(24) + dpToPx(28);

        int badgeCenterX = params.x + badgeSizePx / 2;
        int badgeCenterY = params.y + badgeSizePx / 2;

        double distToCircle = Math.hypot(badgeCenterX - dismissCenterX, badgeCenterY - dismissCenterY);

        // Consider hovered if badge is near the circle OR finger/badge is in the lower-screen close zone
        boolean inBottomZone = (event.getRawY() > screen.y - dpToPx(135) || badgeCenterY > screen.y - dpToPx(135))
                && (Math.abs(badgeCenterX - dismissCenterX) < dpToPx(85));

        boolean hovering = (distToCircle < dpToPx(85)) || inBottomZone;

        if (hovering != isHoveringDismiss) {
            isHoveringDismiss = hovering;
            setDismissTargetHovered(isHoveringDismiss);
            if (isHoveringDismiss) {
                triggerDismissHaptic();
            }
        }
    }

    private void setDismissTargetHovered(boolean hovered) {
        if (dismissCircleView == null || dismissCircleShape == null || dismissLabelView == null) return;

        if (hovered) {
            dismissCircleShape.setColor(Color.parseColor("#E11D48")); // Rose-600
            dismissCircleShape.setStroke(dpToPx(2.5f), Color.parseColor("#FECDD3")); // Rose-200
            dismissLabelView.setText("Release to close");
            dismissLabelView.setTextColor(Color.parseColor("#FFE4E6"));

            dismissCircleView.animate()
                    .scaleX(1.22f)
                    .scaleY(1.22f)
                    .setDuration(120)
                    .start();

            if (cardView != null) {
                cardView.animate()
                        .scaleX(0.80f)
                        .scaleY(0.80f)
                        .alpha(0.85f)
                        .setDuration(120)
                        .start();
            }
        } else {
            dismissCircleShape.setColor(Color.parseColor("#CC0F172A")); // Slate-900 / dark
            dismissCircleShape.setStroke(dpToPx(2f), Color.parseColor("#475569")); // Slate-600
            dismissLabelView.setText("Drag here to close");
            dismissLabelView.setTextColor(Color.parseColor("#94A3B8"));

            dismissCircleView.animate()
                    .scaleX(1.0f)
                    .scaleY(1.0f)
                    .setDuration(120)
                    .start();

            if (cardView != null) {
                cardView.animate()
                        .scaleX(1.0f)
                        .scaleY(1.0f)
                        .alpha(1.0f)
                        .setDuration(120)
                        .start();
            }
        }
    }

    private void triggerDismissHaptic() {
        try {
            if (badgeRootView != null) {
                badgeRootView.performHapticFeedback(
                        HapticFeedbackConstants.VIRTUAL_KEY,
                        HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING
                );
            }
        } catch (Exception ignored) {}
        try {
            Vibrator vibrator = (Vibrator) appContext.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(35);
                }
            }
        } catch (Exception ignored) {}
    }

    private void animateDismissBadgeAndHide() {
        if (cardView != null) {
            cardView.animate()
                    .scaleX(0f)
                    .scaleY(0f)
                    .alpha(0f)
                    .setDuration(160)
                    .withEndAction(this::hideBadge)
                    .start();
        } else {
            hideBadge();
        }
    }

    private void snapToNearestEdge(final WindowManager.LayoutParams params, int badgeSizePx) {
        Point screen = getRealScreenSize();
        int screenWidth = screen.x;
        int screenHeight = screen.y;

        // Determine nearest side across the true screen width
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
