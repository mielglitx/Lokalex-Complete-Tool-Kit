// src/features/chat/teamComms.js
import { db } from '../../config/firebase.js';
import { globalState } from '../../store/state.js';

import * as stateMod from './teamComms/teamCommsState.js';
import * as dragMod from './teamComms/teamCommsDraggable.js';
import * as tabsMod from './teamComms/teamCommsTabs.js';
import * as messagesMod from './teamComms/teamCommsMessages.js';
import * as groupsMod from './teamComms/teamCommsGroups.js';

export * from './teamComms/teamCommsState.js';
export * from './teamComms/teamCommsDraggable.js';
export * from './teamComms/teamCommsTabs.js';
export * from './teamComms/teamCommsMessages.js';
export * from './teamComms/teamCommsGroups.js';

export function listenToFirebaseChat() {
    if (!db) return;

    db.ref('teamChat/groups').on('value', (snap) => {
        globalState.teamCommsGroups = {};
        const val = snap.val();
        if (val) {
            Object.entries(val).forEach(([gId, gData]) => {
                if (gData && gData.metadata) {
                    globalState.teamCommsGroups[gId] = gData.metadata;
                }
            });
        }
        if (stateMod.teamCommsState.isChatOpen && globalState.teamCommsActiveChannel?.type === 'group') {
            groupsMod.renderGroupRoomsList();
        }
    });

    messagesMod.openGeneralChat();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', dragMod.initDraggableChat);
    } else {
        dragMod.initDraggableChat();
    }
}

if (typeof window !== 'undefined') {
    const modules = [
        stateMod,
        dragMod,
        tabsMod,
        messagesMod,
        groupsMod
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

    window.teamCommsState = stateMod.teamCommsState;
    window.listenToFirebaseChat = listenToFirebaseChat;
}