// src/features/chat/customerChat.js

/**
 * ============================================================================
 * CUSTOMER CHAT SYSTEM FACADE & LIFECYCLE BARREL
 * ============================================================================
 * 
 * Central entry point for the customer-facing chat interface with delivery
 * riders and merchant stores. Aggregates state models, gesture animations,
 * message rendering, real-time Firebase listeners, and action popovers.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. customerChat/custChatState.js
 *    - In-memory state tracking (`custChatState`): batch limits, pagination flags,
 *      message maps, active reply targets, and touch gesture coordinates.
 *    - Firebase payload sanitizer stripping undefined attributes.
 * 
 * 2. customerChat/custChatAnimations.js
 *    - Touch gesture engine: 450ms long-press detection with device vibration.
 *    - Rapid-tap particle bursts and playful CSS keyframe bubble animations.
 * 
 * 3. customerChat/custChatUI.js
 *    - Message bubble formatting across roles (Customer, Rider, Merchant Store).
 *    - Sent, delivered, and seen status indicator checkmarks with timestamps.
 *    - Static Google Maps previews, historical spinners, and jump-to-latest toasts.
 * 
 * 4. customerChat/custChatFeed.js
 *    - Real-time Firebase listeners (`customerChats/${custFbId}/messages`).
 *    - Historical message pagination (`limitToLast` chunks).
 *    - Customer message dispatch, quote-reply attachments, and reaction toggles.
 * 
 * 5. customerChat/custChatActions.js
 *    - Contextual action popover overlay (emoji reaction bar, reply, copy text).
 *    - Context-aware action routing across customer, rider, and store scopes.
 * ============================================================================
 */

import * as custChatStateMod from './customerChat/custChatState.js';
import * as custChatAnimationsMod from './customerChat/custChatAnimations.js';
import * as custChatUIMod from './customerChat/custChatUI.js';
import * as custChatFeedMod from './customerChat/custChatFeed.js';
import * as custChatActionsMod from './customerChat/custChatActions.js';

export * from './customerChat/custChatState.js';
export * from './customerChat/custChatAnimations.js';
export * from './customerChat/custChatUI.js';
export * from './customerChat/custChatFeed.js';
export * from './customerChat/custChatActions.js';

// Global window attachments for inline HTML event attributes and system callers
if (typeof window !== 'undefined') {
    const modules = [
        custChatStateMod,
        custChatAnimationsMod,
        custChatUIMod,
        custChatFeedMod,
        custChatActionsMod
    ];

    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    window[fn] = mod[fn];
                }
            });
        }
    });

    window.custChatState = custChatStateMod.custChatState;
}