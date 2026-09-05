// src/features/chat/customerChat.js
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