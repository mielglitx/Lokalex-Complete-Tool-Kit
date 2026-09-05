// src/features/chat/riderStoreChat.js
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