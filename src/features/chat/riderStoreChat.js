// src/features/chat/riderStoreChat.js

/**
 * ============================================================================
 * RIDER-STORE & MERCHANT PORTAL CHAT BARREL MODULE
 * ============================================================================
 * 
 * Central facade for merchant store communications. Aggregates the rider-facing
 * store chat interface, merchant store directory feeds, interactive bubble 
 * animations, and the dual-channel Merchant Web Portal (Rider & Customer comms).
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. storeChat/storeChatState.js
 *    - In-memory state tracking (`storeChatState`) for active order/store chat sessions.
 *    - Database path/key sanitization (`cleanFirebasePathKey`, `sanitizeForFirebase`).
 *    - LocalStorage cache hydration for registered stores.
 * 
 * 2. storeChat/storeChatAnimations.js
 *    - Message bubble gesture physics: long-press popovers with haptic vibration.
 *    - Rapid-tap particle bursts and squish/tilt/shake keyframe animations.
 * 
 * 3. storeChat/storeChatFeed.js
 *    - Real-time listener for global merchant hubs and active order chats.
 *    - Dashboard store directory rendering with live open/closed indicators and search.
 *    - Order completion handlers (`markStoreChatDone`), reaction pills, and reply quotes.
 * 
 * 4. storeChat/riderToStoreModal.js
 *    - Rider-to-store chat window for live pickup coordination.
 *    - Multi-store picker for split orders and collapsible store info/directions drawer.
 *    - Quick preset dispatchers and standalone portal share link generator.
 * 
 * 5. storeChat/storeToRiderModal.js
 *    - Web-accessible Merchant Portal with dual-channel tabs (Rider Chat & Customer Chat).
 *    - URL parameter auto-initialization (`?merchant=...&order=...`).
 *    - Kitchen prep presets and simultaneous multi-party order coordination.
 * ============================================================================
 */

import * as storeChatStateMod from './storeChat/storeChatState.js';
import * as storeChatAnimationsMod from './storeChat/storeChatAnimations.js';
import * as storeChatFeedMod from './storeChat/storeChatFeed.js';
import * as riderToStoreModalMod from './storeChat/riderToStoreModal.js';
import * as storeToRiderModalMod from './storeChat/storeToRiderModal.js';

export * from './storeChat/storeChatState.js';
export * from './storeChat/storeChatAnimations.js';
export * from './storeChat/storeChatFeed.js';
export * from './storeChat/riderToStoreModal.js';
export * from './storeChat/storeToRiderModal.js';

// Global window bindings for HTML inline attributes and template event handlers
if (typeof window !== 'undefined') {
    const modules = [
        storeChatStateMod,
        storeChatAnimationsMod,
        storeChatFeedMod,
        riderToStoreModalMod,
        storeToRiderModalMod
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

    window.storeChatState = storeChatStateMod.storeChatState;
}