// src/features/chat/teamComms.js

/**
 * ============================================================================
 * TEAM COMMS FEATURE BARREL & COORDINATOR
 * ============================================================================
 * 
 * Central facade for internal rider and team communications. Manages the
 * floating draggable chat bubble, multi-tab communication channels (General
 * Lounge, 1-on-1 Direct Messages, and Squad Groups), and real-time message feeds.
 * 
 * Sub-Module Architecture & Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. teamComms/teamCommsState.js
 *    - Central reactive state store (`teamCommsState`) managing unread counts,
 *      window toggle states, pending reply targets, and docking positions.
 *    - Dynamic channel header updater (`setCommsHeader`).
 * 
 * 2. teamComms/teamCommsDraggable.js
 *    - Physics-based mouse and touch dragging for bubble and expanded window.
 *    - Clamps container within viewport boundaries and snaps bubble to screen edges.
 * 
 * 3. teamComms/teamCommsTabs.js
 *    - Channel tab switcher (General, DMs, Groups) and modal expand/collapse.
 *    - Tag mention engine detecting `@` characters to suggest roster riders.
 * 
 * 4. teamComms/teamCommsMessages.js
 *    - Real-time Firebase listeners for General and 1-on-1 Direct Messages.
 *    - Chat bubble rendering, reply quotation banners, and image uploads.
 *    - Lineup roster member directory for starting private direct messages.
 * 
 * 5. teamComms/teamCommsGroups.js
 *    - Squad group rooms manager: creation modal with member checklists.
 *    - Group settings management: adding members, removing riders, and room deletion.
 * ============================================================================
 */

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

/**
 * Attaches real-time Firebase listeners to team chat groups and boots up
 * default general lounge messages.
 */
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

// Initialize dragging physics once DOM is fully mounted
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', dragMod.initDraggableChat);
    } else {
        dragMod.initDraggableChat();
    }
}

// Global window registration for inline HTML attributes and template handlers
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