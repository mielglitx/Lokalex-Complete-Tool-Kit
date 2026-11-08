// src/config/supabaseDb.js

/**
 * ============================================================================
 * SUPABASE REALTIME COMPATIBILITY ADAPTER FOR LOKALEX
 * ============================================================================
 * Drop-in replacement for the Firebase Realtime Database API backed by
 * Supabase PostgreSQL tables and Realtime channels.
 *
 * Covers all 33 Firebase RTDB top-level nodes:
 * - 31 Standard Key-Value tables (id, data)
 * - 2 Streamed Unpacked tables (customer_chats, store_rider_chats)
 * ============================================================================
 */

import { getSupabase } from './supabaseClient.js';

// Table mapping for all 33 Firebase RTDB top-level nodes
export const TABLE_MAP = {
  adminSettings: 'admin_settings',
  advancedOrders: 'advanced_orders',
  catered: 'catered',
  cateredHistory: 'catered_history',
  commissionPenalties: 'commission_penalties',
  customerChatMeta: 'customer_chat_meta',
  customerChats: 'customer_chats',
  customers: 'customers',
  dailyTotals: 'daily_totals',
  directory: 'directory',
  emails: 'emails',
  facebookChannels: 'facebook_channels',
  gcash: 'gcash',
  liveSessions: 'live_sessions',
  liveTracking: 'live_tracking',
  logins: 'logins',
  mapCalculations: 'map_calculations',
  orders: 'orders',
  phones: 'phones',
  receipts: 'receipts',
  riderDayoffs: 'rider_dayoffs',
  riders: 'riders',
  roster: 'roster',
  settings: 'settings',
  sharedQuickReplies: 'shared_quick_replies',
  shiftHistory: 'shift_history',
  storeAccounts: 'store_accounts',
  storeMenus: 'store_menus',
  storeOrders: 'store_orders',
  storeRiderChatMeta: 'store_rider_chat_meta',
  storeRiderChats: 'store_rider_chats',
  stores: 'stores',
  swapRequests: 'swap_requests',
  teamChat: 'team_chat',
  chat: 'team_chat',
  riderLiveLocations: 'live_tracking',
  directoryCreditTransfers: 'directory'
};

function generatePushId() {
  const chars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let now = Date.now();
  const timeStampChars = new Array(8);
  for (let i = 7; i >= 0; i--) {
    timeStampChars[i] = chars.charAt(now % 64);
    now = Math.floor(now / 64);
  }
  let id = timeStampChars.join('');
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * 64));
  }
  return id;
}

export function createSnapshot(val, key = null, hasError = false) {
  return {
    _error: Boolean(hasError),
    val: () => (val === undefined ? null : val),
    exists: () => val !== null && val !== undefined,
    key: key,
    numChildren: () => {
      if (val && typeof val === 'object') {
        return Object.keys(val).length;
      }
      return 0;
    },
    hasChild: (childPath) => {
      if (!val || typeof val !== 'object') return false;
      const parts = childPath.split('/').filter(Boolean);
      let cur = val;
      for (const p of parts) {
        if (!cur || typeof cur !== 'object' || !(p in cur)) return false;
        cur = cur[p];
      }
      return cur !== undefined && cur !== null;
    },
    child: (childPath) => {
      if (!val || typeof val !== 'object') return createSnapshot(null, childPath);
      const parts = childPath.split('/').filter(Boolean);
      let cur = val;
      for (const p of parts) {
        if (!cur || typeof cur !== 'object') {
          cur = null;
          break;
        }
        cur = cur[p];
      }
      const lastKey = parts.length > 0 ? parts[parts.length - 1] : null;
      return createSnapshot(cur, lastKey);
    },
    forEach: (callback) => {
      if (val && typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          if (callback(createSnapshot(v, k)) === true) break;
        }
      }
    }
  };
}

const ephemeralStore = {
  chatPresence: {},
  chatTyping: {}
};

function readEphemeralNode(pathInfo) {
  const rootMap = ephemeralStore[pathInfo.rootNode] || {};
  if (!pathInfo.custId) return { ...rootMap };
  const custMap = rootMap[pathInfo.custId];
  if (!custMap || typeof custMap !== 'object') return null;
  if (!pathInfo.subPath || pathInfo.subPath.length === 0) return { ...custMap };
  let cursor = custMap;
  for (const seg of pathInfo.subPath) {
    cursor = (cursor && typeof cursor === 'object') ? cursor[seg] : null;
  }
  return cursor !== undefined ? cursor : null;
}

function writeEphemeralNode(pathInfo, value, mode = 'set') {
  if (!ephemeralStore[pathInfo.rootNode]) ephemeralStore[pathInfo.rootNode] = {};
  const rootMap = ephemeralStore[pathInfo.rootNode];
  if (!pathInfo.custId) {
    if (mode === 'remove' || value === null || value === undefined) {
      ephemeralStore[pathInfo.rootNode] = {};
    } else if (typeof value === 'object') {
      ephemeralStore[pathInfo.rootNode] = mode === 'update' ? { ...rootMap, ...value } : { ...value };
    }
    return ephemeralStore[pathInfo.rootNode];
  }
  if (!rootMap[pathInfo.custId] || typeof rootMap[pathInfo.custId] !== 'object') {
    if (mode === 'remove' || value === null || value === undefined) return null;
    rootMap[pathInfo.custId] = {};
  }
  const custMap = rootMap[pathInfo.custId];
  if (!pathInfo.subPath || pathInfo.subPath.length === 0) {
    if (mode === 'remove' || value === null || value === undefined) {
      delete rootMap[pathInfo.custId];
      return null;
    }
    rootMap[pathInfo.custId] = (mode === 'update' && typeof value === 'object')
      ? { ...custMap, ...value }
      : value;
    return rootMap[pathInfo.custId];
  }
  let cursor = custMap;
  for (let i = 0; i < pathInfo.subPath.length - 1; i++) {
    const seg = pathInfo.subPath[i];
    if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
    cursor = cursor[seg];
  }
  const lastSeg = pathInfo.subPath[pathInfo.subPath.length - 1];
  if (mode === 'remove' || value === null || value === undefined) {
    delete cursor[lastSeg];
    if (Object.keys(custMap).length === 0) delete rootMap[pathInfo.custId];
  } else if (mode === 'update' && cursor[lastSeg] && typeof cursor[lastSeg] === 'object' && typeof value === 'object') {
    cursor[lastSeg] = { ...cursor[lastSeg], ...value };
  } else {
    cursor[lastSeg] = value;
  }
  return rootMap[pathInfo.custId] || null;
}

export function parsePath(rawPath) {
  const clean = (rawPath || '').replace(/^\/+|\/+$/g, '');
  if (!clean) {
    return {
      isRoot: true,
      rootNode: '',
      table: null,
      id: null,
      subPath: []
    };
  }

  // Handle special Firebase connection check
  if (clean === '.info/connected') {
    return {
      isInfoConnected: true,
      rootNode: '.info',
      table: null,
      id: 'connected',
      subPath: []
    };
  }

  const segments = clean.split('/').filter(Boolean);
  const rootNode = segments[0];
  const table = TABLE_MAP[rootNode] || rootNode.toLowerCase();

  // 1. customerChats (Streamed Unpacked: id, room_id, sender_id, message, timestamp, data)
  if (rootNode === 'customerChats') {
    const custId = segments[1] || null;
    const subType = segments[2] || null; // 'messages', 'metadata', 'threadSeenBy', 'midIndex'
    const targetId = segments[3] || null; // e.g. messageKey or safeMid
    const subPath = segments.slice(4);

    const isMeta = subType === 'metadata';

    return {
      isRoot: false,
      rootNode,
      table: isMeta ? 'customer_chat_meta' : 'customer_chats',
      isCustomerChats: true,
      custId,
      subType,
      targetId,
      id: isMeta ? custId : (subType === 'messages' && targetId ? targetId : null),
      subPath
    };
  }

  // 2. storeRiderChats (Streamed Unpacked: id, room_id, sender_id, message, timestamp, data)
  if (rootNode === 'storeRiderChats') {
    const roomId = segments[1] || null; // orderId_storeId
    const subType = segments[2] || null; // 'messages' or null
    const targetId = segments[3] || null; // messageKey
    const subPath = segments.slice(4);

    return {
      isRoot: false,
      rootNode,
      table: 'store_rider_chats',
      isStoreRiderChats: true,
      roomId,
      subType,
      targetId,
      subPath
    };
  }

  // 3. Ephemeral Presence & Typing (in-memory + broadcast-only, zero DB queries)
  if (rootNode === 'chatPresence' || rootNode === 'chatTyping') {
    const custId = segments[1] || null;
    const riderId = segments[2] || null;
    const prefix = rootNode === 'chatPresence' ? 'presence_' : 'typing_';
    return {
      isRoot: false,
      rootNode,
      isEphemeral: true,
      table: 'live_sessions',
      id: custId ? (prefix + custId) : null,
      custId,
      riderId,
      subPath: riderId ? [riderId, ...segments.slice(3)] : segments.slice(3)
    };
  }

  // 4. Blocked Users (stored in settings table under id='blockedUsers')
  if (rootNode === 'blockedUsers') {
    return {
      isRoot: false,
      rootNode,
      table: 'settings',
      id: 'blockedUsers',
      subPath: segments.slice(1)
    };
  }

  // 5. Commission Settlements (stored in settings table under id='commissionSettlements')
  if (rootNode === 'commissionSettlements') {
    return {
      isRoot: false,
      rootNode,
      table: 'settings',
      id: 'commissionSettlements',
      subPath: segments.slice(1)
    };
  }

  // 6. Commission Settings (alias to settings/commission)
  if (rootNode === 'commissionSettings') {
    return {
      isRoot: false,
      rootNode,
      table: 'settings',
      id: 'commission',
      subPath: ['riderRates', ...segments.slice(1)]
    };
  }

  // 7. Shift History (stored in settings table under id='shiftHistory')
  if (rootNode === 'shiftHistory') {
    return {
      isRoot: false,
      rootNode,
      table: 'settings',
      id: 'shiftHistory',
      subPath: segments.slice(1)
    };
  }

  // 8. Store Menu Galleries (partitioned per-store in store_menus table as id='smg__<storeKey>')
  if (rootNode === 'directory' && segments[1] === 'storeMenuGalleries') {
    const storeKey = segments[2] || null;
    return {
      isRoot: false,
      rootNode: 'storeMenuGalleries',
      isStoreMenuGalleries: true,
      table: 'store_menus',
      storeKey,
      id: storeKey ? `smg__${storeKey}` : null,
      subPath: segments.slice(3)
    };
  }

  // 9. Standard Key-Value table (id, data)
  const id = segments[1] || null;
  const subPath = segments.slice(2);

  return {
    isRoot: false,
    rootNode,
    table,
    id,
    subPath
  };
}

// Active subscriptions registry
// Map(path -> Set of SubRecord)
const subscriptionsByPath = new Map();
// Map(callback -> Set of SubRecord)
const subscriptionsByCallback = new Map();

function registerSubscription(sub) {
  if (!subscriptionsByPath.has(sub.path)) {
    subscriptionsByPath.set(sub.path, new Set());
  }
  subscriptionsByPath.get(sub.path).add(sub);

  if (typeof sub.callback === 'function') {
    if (!subscriptionsByCallback.has(sub.callback)) {
      subscriptionsByCallback.set(sub.callback, new Set());
    }
    subscriptionsByCallback.get(sub.callback).add(sub);
  }
}

function removeSingleSubscription(client, sub) {
  if (!sub || sub.isClosed) return;
  sub.isClosed = true;

  if (sub.debounceTimer) {
    clearTimeout(sub.debounceTimer);
    sub.debounceTimer = null;
  }

  if (sub._broadcastHandler) {
    globalBroadcastSubscribers.delete(sub._broadcastHandler);
    sub._broadcastHandler = null;
  }

  if (typeof sub._unsubscribeCdc === 'function') {
    try {
      sub._unsubscribeCdc();
    } catch (_) {}
    sub._unsubscribeCdc = null;
  }

  if (client && sub.channel) {
    try {
      client.removeChannel(sub.channel).catch(() => {});
    } catch (_) {}
    sub.channel = null;
  }

  if (subscriptionsByPath.has(sub.path)) {
    const set = subscriptionsByPath.get(sub.path);
    set.delete(sub);
    if (set.size === 0) subscriptionsByPath.delete(sub.path);
  }

  if (typeof sub.callback === 'function' && subscriptionsByCallback.has(sub.callback)) {
    const set = subscriptionsByCallback.get(sub.callback);
    set.delete(sub);
    if (set.size === 0) subscriptionsByCallback.delete(sub.callback);
  }
}

// Centralized Global Broadcast Channel, Shared Table CDC Multiplexer & Health Tracker
let globalBroadcastChannel = null;
let hasBroadcastConnectedOnce = false;
let wasBroadcastDisconnected = false;
let lastRealtimeActivityTime = Date.now();
const globalBroadcastSubscribers = new Set();
const sharedTableChannels = new Map(); // channelKey -> { channel, handlers: Set<Function> }
const globalCustomerMetaCache = new Map(); // custId -> data object
const globalCustomerChatsMsgCache = new Map(); // rowId -> data object

function cacheCustomerChatMsg(rowId, data) {
  if (!rowId || !data || typeof data !== 'object') return;
  if (globalCustomerChatsMsgCache.size > 400 && !globalCustomerChatsMsgCache.has(rowId)) {
    const firstKey = globalCustomerChatsMsgCache.keys().next().value;
    if (firstKey) globalCustomerChatsMsgCache.delete(firstKey);
  }
  globalCustomerChatsMsgCache.set(rowId, data);
}

export function getLastRealtimeActivityTime() {
  return lastRealtimeActivityTime;
}

export function isRealtimeConnected() {
  return isBroadcastChannelSubscribed;
}

function computeFastSignature(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val !== 'object') return `${typeof val}:${String(val)}`;
  try {
    return JSON.stringify(val, (k, v) => {
      if (typeof v === 'string' && v.length > 180) {
        return `${v.slice(0, 32)}..[${v.length}]..${v.slice(-16)}`;
      }
      return v;
    });
  } catch (_) {
    return String(Date.now());
  }
}

function subscribeTableCdc(client, targetTable, handler, filter = null) {
  if (!client || !targetTable) return () => {};
  const channelKey = filter ? `${targetTable}:${filter}` : targetTable;
  let entry = sharedTableChannels.get(channelKey);
  if (!entry) {
    const safeChannelName = `cdc_table_${channelKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const channel = client.channel(safeChannelName);
    const handlers = new Set();
    const pgConfig = { event: '*', schema: 'public', table: targetTable };
    if (filter) pgConfig.filter = filter;
    channel.on('postgres_changes', pgConfig, (payload) => {
      lastRealtimeActivityTime = Date.now();
      for (const fn of handlers) {
        try {
          fn(payload);
        } catch (err) {
          console.warn(`[CDC Handler Error on ${channelKey}]:`, err);
        }
      }
    }).subscribe();
    entry = { channel, handlers };
    sharedTableChannels.set(channelKey, entry);
  }
  entry.handlers.add(handler);
  return () => {
    entry.handlers.delete(handler);
    if (entry.handlers.size === 0) {
      sharedTableChannels.delete(channelKey);
      try {
        client.removeChannel(entry.channel).catch(() => {});
      } catch (_) {}
    }
  };
}

let isBroadcastChannelSubscribed = false;

function getGlobalBroadcastChannel(client) {
  if (!globalBroadcastChannel && client) {
    try {
      globalBroadcastChannel = client.channel('lokalex_broadcast');
      globalBroadcastChannel.on('broadcast', { event: 'db_change' }, (eventPayload) => {
        lastRealtimeActivityTime = Date.now();
        for (const handler of globalBroadcastSubscribers) {
          try {
            handler(eventPayload);
          } catch (e) {
            console.warn('[Broadcast Handler Error]:', e);
          }
        }
      });
      globalBroadcastChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          isBroadcastChannelSubscribed = true;
          lastRealtimeActivityTime = Date.now();
          if (hasBroadcastConnectedOnce && wasBroadcastDisconnected) {
            wasBroadcastDisconnected = false;
            try { resyncActiveSubscriptions(); } catch (_) {}
          }
          hasBroadcastConnectedOnce = true;
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          isBroadcastChannelSubscribed = false;
          wasBroadcastDisconnected = true;
          setTimeout(() => {
            if (globalBroadcastChannel) {
              try { globalBroadcastChannel.subscribe(); } catch (_) {}
            }
          }, 3000);
        }
      });
    } catch (err) {
      console.warn('[Supabase Global Broadcast Init Error]:', err);
    }
  }
  return globalBroadcastChannel;
}

function broadcastMutation(client, table, path, value, action = 'update') {
  if (!client) return;
  try {
    lastRealtimeActivityTime = Date.now();
    const ch = getGlobalBroadcastChannel(client);
    if (ch) {
      const pInfo = parsePath(path);
      const segments = (path || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      let childKey = null;
      if (pInfo.isCustomerChats) {
        childKey = (pInfo.subType === 'messages' && pInfo.targetId) ? pInfo.targetId : pInfo.custId;
      } else if (pInfo.isStoreRiderChats) {
        childKey = (pInfo.subType === 'messages' && pInfo.targetId) ? pInfo.targetId : pInfo.roomId;
      } else {
        childKey = pInfo.id || (segments.length > 1 ? segments[1] : null);
      }
      const msgPayload = {
        path,
        table,
        value,
        action,
        childKey,
        newChild: (action === 'insert' || action === 'update') && childKey ? { key: childKey, data: value } : null,
        updatedChild: action === 'update' && childKey ? { key: childKey, data: value } : null,
        removedKey: action === 'remove' ? (childKey || segments[0]) : null,
        time: Date.now()
      };

      // Notify local in-tab subscribers immediately (deduplicated by signature)
      for (const handler of globalBroadcastSubscribers) {
        try {
          handler({ payload: msgPayload });
        } catch (_) {}
      }

      const canPushWs = typeof ch.canPush === 'function'
        ? ch.canPush()
        : (isBroadcastChannelSubscribed && ch.state === 'joined');

      if (canPushWs) {
        ch.send({
          type: 'broadcast',
          event: 'db_change',
          payload: msgPayload
        }).catch(() => {});
      } else if (typeof ch.httpSend === 'function') {
        ch.httpSend('db_change', msgPayload).catch(() => {});
      }
    }
  } catch (e) {}
}

let storeMenuGalleriesCache = null;
let storeMenuGalleriesFetchPromise = null;

async function fetchAllStoreMenuGalleries(client, onPartialProgress = null) {
  if (storeMenuGalleriesCache && Object.keys(storeMenuGalleriesCache).length > 0) {
    return storeMenuGalleriesCache;
  }
  if (storeMenuGalleriesFetchPromise) {
    return await storeMenuGalleriesFetchPromise;
  }
  storeMenuGalleriesFetchPromise = (async () => {
    const result = {};
    try {
      // 1. Fast initial metadata index read (smg__meta_index)
      const { data: metaRow } = await client
        .from('store_menus')
        .select('data')
        .eq('id', 'smg__meta_index')
        .maybeSingle();
      if (metaRow && metaRow.data && typeof metaRow.data === 'object') {
        for (const [k, m] of Object.entries(metaRow.data)) {
          if (m && typeof m === 'object') {
            const dummyPages = {};
            const count = Number(m.pageCount) || 0;
            for (let i = 1; i <= count; i++) {
              dummyPages[`page_${i}`] = { id: `page_${i}`, pageNumber: i, updatedAt: m.updatedAt || 0 };
            }
            result[k] = {
              storeName: m.storeName || k,
              updatedAt: m.updatedAt || 0,
              pages: dummyPages
            };
          }
        }
        if (typeof onPartialProgress === 'function' && Object.keys(result).length > 0) {
          try { onPartialProgress({ ...result }); } catch (_) {}
        }
      }

      // Memory cache: Individual store galleries are lazy-loaded on-demand when a user views that store
      if (Object.keys(result).length > 0) {
        storeMenuGalleriesCache = result;
      }
    } catch (err) {
      console.warn('[Supabase storeMenuGalleries fetch warning]:', err.message || err);
    } finally {
      storeMenuGalleriesFetchPromise = null;
    }
    return result;
  })();
  return await storeMenuGalleriesFetchPromise;
}

const mutationQueues = new Map();
function runExclusive(key, task) {
  if (!key) return task();
  const prev = mutationQueues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  mutationQueues.set(key, next);
  next.finally(() => {
    if (mutationQueues.get(key) === next) {
      mutationQueues.delete(key);
    }
  });
  return next;
}

export function createSupabaseRef(rawPath, queryState = {}) {
  const pathInfo = parsePath(rawPath);
  const client = getSupabase();

  const ref = {
    _query: { ...queryState },

    get key() {
      if (pathInfo.isRoot) return null;
      const segments = (rawPath || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : null;
    },

    get parent() {
      if (pathInfo.isRoot) return null;
      const segments = (rawPath || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (segments.length <= 1) return createSupabaseRef('');
      segments.pop();
      return createSupabaseRef(segments.join('/'));
    },

    child(childPath) {
      const joined = [rawPath, childPath].filter(Boolean).join('/').replace(/\/+/g, '/');
      return createSupabaseRef(joined);
    },

    onDisconnect() {
      return {
        set(val, onComplete) {
          if (typeof onComplete === 'function') onComplete(null);
          return Promise.resolve();
        },
        update(val, onComplete) {
          if (typeof onComplete === 'function') onComplete(null);
          return Promise.resolve();
        },
        remove(onComplete) {
          if (typeof onComplete === 'function') onComplete(null);
          return Promise.resolve();
        },
        cancel(onComplete) {
          if (typeof onComplete === 'function') onComplete(null);
          return Promise.resolve();
        }
      };
    },
    get ondisconnect() {
      return this.onDisconnect;
    },

    async once(eventType, successCallback) {
      if (pathInfo.isInfoConnected) {
        const isOnline = (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') ? navigator.onLine : true;
        const snap = createSnapshot(isOnline, 'connected');
        if (typeof successCallback === 'function') successCallback(snap);
        return snap;
      }

      if (!client) {
        const snap = createSnapshot(null, ref.key);
        if (typeof successCallback === 'function') successCallback(snap);
        return snap;
      }

      let result = null;
      let hadError = false;

      try {
        if (pathInfo.isRoot) {
          result = null;
        } else if (pathInfo.isStoreMenuGalleries && !pathInfo.id) {
          result = await fetchAllStoreMenuGalleries(client);
        } else if (pathInfo.isEphemeral) {
          result = readEphemeralNode(pathInfo);
        } else if (pathInfo.isCustomerChats) {
          result = await handleCustomerChatsOnce(client, pathInfo, ref._query);
        } else if (pathInfo.isStoreRiderChats) {
          result = await handleStoreRiderChatsOnce(client, pathInfo, ref._query);
        } else if (pathInfo.id) {
          // Standard table single document read
          const { data, error } = await client
            .from(pathInfo.table)
            .select('data')
            .eq('id', pathInfo.id)
            .maybeSingle();

          if (error) {
            hadError = true;
            console.warn(`[Supabase once error on ${rawPath}]:`, error.message);
          }

          let nodeData = data ? (data.data !== undefined ? data.data : data) : null;
          if (pathInfo.isStoreMenuGalleries && pathInfo.storeKey && nodeData && pathInfo.subPath.length === 0) {
            if (!storeMenuGalleriesCache) storeMenuGalleriesCache = {};
            storeMenuGalleriesCache[pathInfo.storeKey] = nodeData;
          }
          if (nodeData && pathInfo.subPath.length > 0) {
            for (const seg of pathInfo.subPath) {
              nodeData = (nodeData && typeof nodeData === 'object') ? nodeData[seg] : null;
            }
          }
          result = nodeData;
        } else {
          // Standard table full list read
          let query = client.from(pathInfo.table).select('id, data');
          if (pathInfo.table === 'directory') {
            query = query.neq('id', 'storeMenuGalleries');
          }
          if (pathInfo.table === 'store_menus') {
            query = query.not('id', 'like', 'smg__%');
          }

          // 1. Push equalTo filter down to PostgREST so queries never hit the default 1000-row truncate
          if (ref._query.equalTo !== undefined && ref._query.orderBy) {
            const field = ref._query.orderBy;
            const eqVal = String(ref._query.equalTo);
            if (pathInfo.table === 'receipts' && (field === 'date' || field === 'completedDate')) {
              query = query.or(`data->>date.eq.${eqVal},data->>completedDate.eq.${eqVal}`);
            } else if (pathInfo.table === 'catered_history' && (field === 'completedDate' || field === 'date')) {
              query = query.or(`data->>completedDate.eq.${eqVal},data->>date.eq.${eqVal}`);
            } else if (field === 'transactionId') {
              query = query.or(`id.eq.${eqVal},data->>transactionId.eq.${eqVal}`);
            } else if (field === 'phoneNumber') {
              query = query.or(`id.eq.${eqVal},data->>phoneNumber.eq.${eqVal}`);
            } else if (field === 'username') {
              query = query.or(`id.eq.${eqVal},data->>username.eq.${eqVal}`);
            } else {
              query = query.eq(`data->>${field}`, eqVal);
            }
          }

          // 2. Push startAt/endAt range queries down to PostgREST
          if (ref._query.orderBy && (ref._query.startAt !== undefined || ref._query.endAt !== undefined)) {
            const field = ref._query.orderBy;
            if (ref._query.startAt !== undefined) {
              query = query.gte(`data->>${field}`, String(ref._query.startAt));
            }
            if (ref._query.endAt !== undefined) {
              query = query.lte(`data->>${field}`, String(ref._query.endAt));
            }
          }

          // 3. Ordering and Limits
          if (ref._query.limit && ref._query.limitType === 'last') {
            if (pathInfo.table === 'advanced_orders' || pathInfo.table === 'receipts') {
              query = query.order('created_at', { ascending: false }).limit(ref._query.limit);
            } else if (pathInfo.table === 'catered_history') {
              query = query.order('completed_at', { ascending: false, nullsFirst: false }).limit(ref._query.limit);
            } else if (pathInfo.table === 'customer_chat_meta') {
              query = query.order('updated_at', { ascending: false }).limit(ref._query.limit);
            } else if (pathInfo.table === 'logins') {
              query = query.order('logged_at', { ascending: false }).limit(ref._query.limit);
            } else {
              query = query.order('id', { ascending: false }).limit(ref._query.limit);
            }
          } else if (ref._query.limit && ref._query.limitType === 'first') {
            if (pathInfo.table === 'advanced_orders' || pathInfo.table === 'receipts') {
              query = query.order('created_at', { ascending: true }).limit(ref._query.limit);
            } else if (pathInfo.table === 'catered_history') {
              query = query.order('completed_at', { ascending: true, nullsFirst: false }).limit(ref._query.limit);
            } else if (pathInfo.table === 'customer_chat_meta') {
              query = query.order('updated_at', { ascending: true }).limit(ref._query.limit);
            } else if (pathInfo.table === 'logins') {
              query = query.order('logged_at', { ascending: true }).limit(ref._query.limit);
            } else {
              query = query.order('id', { ascending: true }).limit(ref._query.limit);
            }
          } else if (pathInfo.table === 'customer_chat_meta') {
            // Data optimization: window query on customer_chat_meta
            query = query.order('updated_at', { ascending: false }).limit(120);
          } else if (!ref._query.equalTo) {
            // When querying entire table without limit or equalTo, order descending by newest first
            if (pathInfo.table === 'advanced_orders' || pathInfo.table === 'receipts') {
              query = query.order('created_at', { ascending: false });
            } else if (pathInfo.table === 'catered_history') {
              query = query.order('completed_at', { ascending: false, nullsFirst: false });
            } else if (pathInfo.table === 'logins') {
              query = query.order('logged_at', { ascending: false });
            }
          }

          const { data, error } = await query;
          if (error) {
            hadError = true;
            if (!error.message?.includes('schema cache')) {
              console.warn(`[Supabase once error on table ${pathInfo.table}]:`, error.message);
            }
          }

          if (data && Array.isArray(data)) {
            result = {};
            data.forEach(row => {
              let val = row.data !== undefined ? row.data : row;
              result[row.id] = val;
              if (pathInfo.table === 'customer_chat_meta' && row.id && val && typeof val === 'object') {
                globalCustomerMetaCache.set(row.id, val);
              }
            });

            // Filter if equalTo query specified (ensure secondary safety match in memory)
            if (ref._query.equalTo !== undefined && ref._query.orderBy) {
              const field = ref._query.orderBy;
              const eqVal = String(ref._query.equalTo);
              const filtered = {};
              for (const [k, v] of Object.entries(result)) {
                if (v) {
                  const itemVal = v[field] !== undefined ? String(v[field]) : (v.data && v.data[field] !== undefined ? String(v.data[field]) : null);
                  const altVal = (field === 'date' && v.completedDate) ? String(v.completedDate) : ((field === 'completedDate' && v.date) ? String(v.date) : null);
                  if (itemVal === eqVal || altVal === eqVal) {
                    filtered[k] = v;
                  }
                }
              }
              result = filtered;
            }

            // Filter if startAt/endAt range query specified
            if ((ref._query.startAt !== undefined || ref._query.endAt !== undefined) && ref._query.orderBy) {
              const field = ref._query.orderBy;
              const sVal = ref._query.startAt;
              const eVal = ref._query.endAt;
              const filtered = {};
              for (const [k, v] of Object.entries(result)) {
                if (v && v[field] !== undefined) {
                  const val = v[field];
                  if (sVal !== undefined && val < sVal) continue;
                  if (eVal !== undefined && val > eVal) continue;
                  filtered[k] = v;
                }
              }
              result = filtered;
            }
          }
        }
      } catch (err) {
        hadError = true;
        console.warn(`[Supabase once exception on ${rawPath}]:`, err.message || err);
      }

      const snap = createSnapshot(result, ref.key, hadError);
      if (typeof successCallback === 'function') {
        successCallback(snap);
      }
      return snap;
    },

    on(eventType, callback) {
      const cleanPath = (rawPath || '').replace(/^\/+|\/+$/g, '');

      if (pathInfo.isInfoConnected) {
        const isOnline = (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') ? navigator.onLine : true;
        callback(createSnapshot(isOnline, 'connected'));
        if (typeof window !== 'undefined') {
          const onlineHandler = () => callback(createSnapshot(true, 'connected'));
          const offlineHandler = () => callback(createSnapshot(false, 'connected'));
          window.addEventListener('online', onlineHandler);
          window.addEventListener('offline', offlineHandler);
        }
        return callback;
      }

      if (pathInfo.isStoreMenuGalleries && !pathInfo.id) {
        fetchAllStoreMenuGalleries(client, (partial) => {
          callback(createSnapshot(partial, ref.key));
        }).then((full) => {
          callback(createSnapshot(full, ref.key));
        }).catch(() => {});
        return callback;
      }

      if (!client) {
        callback(createSnapshot(null, ref.key));
        return callback;
      }

      const isTableLevel = !pathInfo.id && (!pathInfo.isCustomerChats || !pathInfo.custId) && (!pathInfo.isStoreRiderChats || !pathInfo.roomId);
      const isTableValueListener = eventType === 'value' && isTableLevel;

      const subRecord = {
        path: cleanPath,
        query: { ...ref._query },
        eventType,
        callback,
        channel: null,
        _unsubscribeCdc: null,
        tableCache: null,
        docCache: undefined,
        lastSignature: null,
        childSignatures: new Map(),
        debounceTimer: null,
        isClosed: false
      };

      const matchesQueryFilter = (item) => {
        if (!item || typeof item !== 'object') return true;
        const q = subRecord.query;
        if (!q || !q.orderBy) return true;
        const field = q.orderBy;
        if (q.equalTo !== undefined) {
          const eqVal = String(q.equalTo);
          const itemVal = item[field] !== undefined ? String(item[field]) : (item.data && item.data[field] !== undefined ? String(item.data[field]) : null);
          const altVal = (field === 'date' && item.completedDate) ? String(item.completedDate) : ((field === 'completedDate' && item.date) ? String(item.date) : null);
          if (itemVal !== eqVal && altVal !== eqVal) return false;
        }
        if (q.startAt !== undefined || q.endAt !== undefined) {
          const val = item[field];
          if (val !== undefined) {
            if (q.startAt !== undefined && val < q.startAt) return false;
            if (q.endAt !== undefined && val > q.endAt) return false;
          }
        }
        return true;
      };

      const emitValueSnapshot = (val, key = ref.key) => {
        if (subRecord.isClosed) return;
        const sig = computeFastSignature(val);
        if (subRecord.lastSignature === sig) return;
        subRecord.lastSignature = sig;
        callback(createSnapshot(val, key));
      };

      const emitChildAdded = (val, cKey) => {
        if (subRecord.isClosed || !cKey || val === null || val === undefined) return;
        if (!matchesQueryFilter(val)) return;
        const sig = computeFastSignature(val);
        if (subRecord.childSignatures.has(cKey)) return;
        subRecord.childSignatures.set(cKey, sig);
        callback(createSnapshot(val, cKey));
      };

      const emitChildChanged = (val, cKey) => {
        if (subRecord.isClosed || !cKey || val === null || val === undefined) return;
        if (!matchesQueryFilter(val)) return;
        const sig = computeFastSignature(val);
        if (subRecord.childSignatures.get(cKey) === sig) return;
        subRecord.childSignatures.set(cKey, sig);
        callback(createSnapshot(val, cKey));
      };

      const emitChildRemoved = (cKey) => {
        if (subRecord.isClosed || !cKey) return;
        subRecord.childSignatures.delete(cKey);
        callback(createSnapshot(null, cKey));
      };

      // 1. Initial read
      if (eventType === 'value') {
        ref.once(eventType, (snap) => {
          if (subRecord.isClosed) return;
          if (snap && snap._error) {
            // Do not emit false-null snapshot on transient network/reload abort error
            return;
          }
          const val = snap.val();
          if (isTableValueListener) {
            subRecord.tableCache = new Map(val && typeof val === 'object' ? Object.entries(val) : []);
          } else {
            subRecord.docCache = val;
          }
          subRecord.lastSignature = computeFastSignature(val);
          callback(snap);
        });
      } else if (eventType === 'child_added') {
        if (!ref._skipInitialFetch && !ref._query?._skipInitialFetch) {
          ref.once('value', (snap) => {
            if (subRecord.isClosed) return;
            snap.forEach((childSnap) => {
              if (subRecord.isClosed) return;
              emitChildAdded(childSnap.val(), childSnap.key);
            });
          });
        }
      }

      // 2. Shared Realtime Multiplexed Subscription (Broadcast + Shared Table CDC)
      const targetTable = (pathInfo.isCustomerChats && pathInfo.subType === 'metadata')
        ? 'customer_chat_meta'
        : (pathInfo.table || 'settings');

      const handleBroadcastEvent = async (eventPayload) => {
        if (subRecord.isClosed) return;
        const payloadPath = eventPayload?.payload?.path;
        const payloadTable = eventPayload?.payload?.table;
        const action = eventPayload?.payload?.action || 'update';
        const val = eventPayload?.payload?.value;
        const pInfo = parsePath(payloadPath || '');
        if (pInfo.isEphemeral) {
          const mode = action === 'remove' ? 'remove' : (action === 'update' ? 'update' : 'set');
          writeEphemeralNode(pInfo, val, mode);
        }
        const segments = (payloadPath || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

        let rowKey = eventPayload?.payload?.childKey || null;
        if (pInfo.isCustomerChats) {
          rowKey = (pInfo.subType === 'messages' && pInfo.targetId) ? pInfo.targetId : pInfo.custId;
        } else if (pInfo.isStoreRiderChats) {
          rowKey = (pInfo.subType === 'messages' && pInfo.targetId) ? pInfo.targetId : pInfo.roomId;
        } else if (pInfo.id) {
          rowKey = pInfo.id;
        } else if (!rowKey && segments.length > 1) {
          rowKey = segments[1];
        }

        const rowSubPath = (pInfo.isCustomerChats && pInfo.subType === 'metadata')
          ? (pInfo.targetId ? [pInfo.targetId, ...pInfo.subPath] : [])
          : (pInfo.subPath || []);

        const isPathMatch = payloadPath && (
          payloadPath === rawPath ||
          payloadPath.startsWith(rawPath + '/') ||
          rawPath.startsWith(payloadPath + '/')
        );
        const isTableMatch = payloadTable && targetTable && payloadTable === targetTable;

        let shouldProcess = false;
        if (isPathMatch) {
          shouldProcess = true;
        } else if (isTableMatch && isTableValueListener) {
          shouldProcess = true;
        } else if (isTableMatch) {
          if (pathInfo.isCustomerChats) {
            if (pathInfo.subType === 'metadata' && pInfo.custId === pathInfo.custId && (pInfo.subType === 'metadata' || pInfo.rootNode === 'customerChatMeta')) {
              shouldProcess = true;
            } else if (pathInfo.subType === 'messages' && pInfo.custId === pathInfo.custId && pInfo.subType === 'messages') {
              shouldProcess = !pathInfo.targetId || pInfo.targetId === pathInfo.targetId;
            } else if (pathInfo.subType === pInfo.subType && pInfo.custId === pathInfo.custId) {
              shouldProcess = true;
            }
          } else if (pathInfo.isStoreRiderChats) {
            if (pInfo.roomId === pathInfo.roomId) shouldProcess = true;
          } else if (pathInfo.id && rowKey === pathInfo.id) {
            shouldProcess = true;
          }
        }
        if (!shouldProcess) return;

        if (eventType === 'value') {
          if (subRecord.tableCache && rowKey) {
            if (rowSubPath.length === 0) {
              if (action === 'remove' || val === null || val === undefined) {
                subRecord.tableCache.delete(rowKey);
              } else {
                const existingRow = subRecord.tableCache.get(rowKey);
                const nextRow = (action === 'update' && existingRow && typeof existingRow === 'object' && val && typeof val === 'object' && !Array.isArray(val))
                  ? { ...existingRow, ...val }
                  : val;
                if (matchesQueryFilter(nextRow)) {
                  subRecord.tableCache.set(rowKey, nextRow);
                } else {
                  subRecord.tableCache.delete(rowKey);
                }
              }
            } else {
              const existingRow = subRecord.tableCache.get(rowKey);
              const baseObj = (existingRow && typeof existingRow === 'object') ? { ...existingRow } : {};
              let cursor = baseObj;
              for (let i = 0; i < rowSubPath.length - 1; i++) {
                const seg = rowSubPath[i];
                cursor[seg] = (cursor[seg] && typeof cursor[seg] === 'object') ? { ...cursor[seg] } : {};
                cursor = cursor[seg];
              }
              const lastKey = rowSubPath[rowSubPath.length - 1];
              if (action === 'remove' || val === null || val === undefined) {
                delete cursor[lastKey];
              } else if (action === 'update' && cursor[lastKey] && typeof cursor[lastKey] === 'object' && val && typeof val === 'object' && !Array.isArray(val)) {
                cursor[lastKey] = { ...cursor[lastKey], ...val };
              } else {
                cursor[lastKey] = val;
              }
              if (matchesQueryFilter(baseObj)) {
                subRecord.tableCache.set(rowKey, baseObj);
              }
            }

            clearTimeout(subRecord.debounceTimer);
            subRecord.debounceTimer = setTimeout(() => {
              if (subRecord.isClosed) return;
              emitValueSnapshot(Object.fromEntries(subRecord.tableCache), ref.key);
            }, 25);
          } else if (val !== undefined && (payloadPath === cleanPath || (pInfo.isCustomerChats && pathInfo.isCustomerChats && pathInfo.subType === 'metadata' && pInfo.custId === pathInfo.custId && !pathInfo.targetId && rowSubPath.length === 0))) {
            if (action === 'remove' || val === null) {
              subRecord.docCache = null;
            } else if (action === 'update' && subRecord.docCache && typeof subRecord.docCache === 'object' && typeof val === 'object' && !Array.isArray(val)) {
              subRecord.docCache = { ...subRecord.docCache, ...val };
            } else {
              subRecord.docCache = val;
            }
            clearTimeout(subRecord.debounceTimer);
            subRecord.debounceTimer = setTimeout(() => {
              if (subRecord.isClosed) return;
              emitValueSnapshot(subRecord.docCache, ref.key);
            }, 25);
          } else if (val !== undefined && payloadPath && payloadPath.startsWith(cleanPath + '/') && subRecord.docCache && typeof subRecord.docCache === 'object') {
            const relSegs = payloadPath.slice(cleanPath.length + 1).split('/').filter(Boolean);
            if (relSegs.length > 0) {
              const nextDoc = { ...subRecord.docCache };
              let cur = nextDoc;
              for (let i = 0; i < relSegs.length - 1; i++) {
                const s = relSegs[i];
                cur[s] = (cur[s] && typeof cur[s] === 'object') ? { ...cur[s] } : {};
                cur = cur[s];
              }
              const lastS = relSegs[relSegs.length - 1];
              if (action === 'remove' || val === null) {
                delete cur[lastS];
              } else if (action === 'update' && cur[lastS] && typeof cur[lastS] === 'object' && typeof val === 'object') {
                cur[lastS] = { ...cur[lastS], ...val };
              } else {
                cur[lastS] = val;
              }
              subRecord.docCache = nextDoc;
              clearTimeout(subRecord.debounceTimer);
              subRecord.debounceTimer = setTimeout(() => {
                if (subRecord.isClosed) return;
                emitValueSnapshot(subRecord.docCache, ref.key);
              }, 25);
            }
          } else {
            clearTimeout(subRecord.debounceTimer);
            subRecord.debounceTimer = setTimeout(async () => {
              if (subRecord.isClosed) return;
              const snap = await ref.once(eventType);
              if (!subRecord.isClosed) {
                subRecord.docCache = snap.val();
                emitValueSnapshot(subRecord.docCache, snap.key);
              }
            }, 25);
          }
        } else if (eventType === 'child_added') {
          if (action !== 'remove') {
            if (rowKey && val !== null && val !== undefined && rowSubPath.length === 0) {
              emitChildAdded(val, rowKey);
            } else if (eventPayload?.payload?.newChild) {
              emitChildAdded(eventPayload.payload.newChild.data, eventPayload.payload.newChild.key);
            }
          }
        } else if (eventType === 'child_changed') {
          if (action === 'update' || (action === 'insert' && rowKey && subRecord.childSignatures.has(rowKey))) {
            if (rowKey && val !== null && val !== undefined && rowSubPath.length === 0) {
              emitChildChanged(val, rowKey);
            } else if (eventPayload?.payload?.updatedChild) {
              emitChildChanged(eventPayload.payload.updatedChild.data, eventPayload.payload.updatedChild.key);
            }
          }
        } else if (eventType === 'child_removed') {
          if (action === 'remove' || val === null) {
            const removedKey = rowKey || eventPayload.payload?.removedKey;
            if (removedKey) {
              emitChildRemoved(removedKey);
            }
          }
        }
      };

      subRecord._broadcastHandler = handleBroadcastEvent;
      globalBroadcastSubscribers.add(handleBroadcastEvent);
      getGlobalBroadcastChannel(client);

      const handleCdcEvent = (payload) => {
        if (subRecord.isClosed) return;
        const row = payload.new || payload.old;
        if (!row) return;

        // Filter row in memory for shared table CDC channel
        if (pathInfo.isCustomerChats && pathInfo.subType === 'metadata') {
          if (pathInfo.custId && row.id !== pathInfo.custId) return;
        } else if (pathInfo.isCustomerChats && pathInfo.custId) {
          if (row.room_id && row.room_id !== pathInfo.custId) return;
          if (!row.room_id && !String(row.id || '').startsWith(pathInfo.custId + '_')) return;
          if (pathInfo.subType === 'messages') {
            const rid = String(row.id || '');
            if (rid.endsWith('_metadata') || rid.endsWith('_threadSeenBy') || rid.endsWith('_midIndex')) return;
            if (pathInfo.targetId && extractChildKey(rid, pathInfo) !== pathInfo.targetId) return;
          } else if (pathInfo.subType === 'threadSeenBy' || pathInfo.subType === 'midIndex') {
            if (row.id !== `${pathInfo.custId}_${pathInfo.subType}`) return;
          }
        } else if (pathInfo.isStoreRiderChats && pathInfo.roomId) {
          if (row.room_id && row.room_id !== pathInfo.roomId) return;
          if (!row.room_id && !String(row.id || '').startsWith(pathInfo.roomId + '_')) return;
        } else if (pathInfo.id && !isTableLevel) {
          if (row.id !== pathInfo.id) return;
        }

        if (eventType === 'value') {
          if (subRecord.tableCache) {
            const childKey = extractChildKey(row.id, pathInfo);
            if (childKey) {
              if (payload.eventType === 'DELETE') {
                subRecord.tableCache.delete(childKey);
              } else if (payload.new) {
                const val = payload.new.data !== undefined ? payload.new.data : payload.new;
                if (matchesQueryFilter(val)) {
                  subRecord.tableCache.set(childKey, val);
                } else {
                  subRecord.tableCache.delete(childKey);
                }
              }
            }

            clearTimeout(subRecord.debounceTimer);
            subRecord.debounceTimer = setTimeout(() => {
              if (subRecord.isClosed) return;
              emitValueSnapshot(Object.fromEntries(subRecord.tableCache), ref.key);
            }, 40);
          } else {
            clearTimeout(subRecord.debounceTimer);
            subRecord.debounceTimer = setTimeout(async () => {
              if (subRecord.isClosed) return;
              if (payload.eventType === 'DELETE') {
                subRecord.docCache = null;
                emitValueSnapshot(null, ref.key);
              } else if (payload.new) {
                let val = payload.new.data !== undefined ? payload.new.data : payload.new;
                const effectiveSub = (pathInfo.isCustomerChats && (pathInfo.subType === 'metadata' || pathInfo.subType === 'threadSeenBy' || pathInfo.subType === 'midIndex') && pathInfo.targetId)
                  ? [pathInfo.targetId, ...pathInfo.subPath]
                  : (pathInfo.subPath || []);
                if (val && effectiveSub.length > 0) {
                  for (const seg of effectiveSub) {
                    val = (val && typeof val === 'object') ? val[seg] : null;
                  }
                }
                subRecord.docCache = val;
                emitValueSnapshot(val, ref.key);
              } else {
                const snap = await ref.once('value');
                if (!subRecord.isClosed) {
                  subRecord.docCache = snap.val();
                  emitValueSnapshot(subRecord.docCache, snap.key);
                }
              }
            }, 35);
          }
        } else if (eventType === 'child_added' && payload.eventType === 'INSERT') {
          if (payload.new) {
            const childKey = extractChildKey(payload.new.id, pathInfo);
            const val = payload.new.data !== undefined ? payload.new.data : payload.new;
            if (targetTable === 'customer_chats' && payload.new.id) {
              cacheCustomerChatMsg(payload.new.id, val);
            }
            emitChildAdded(val, childKey);
          }
        } else if (eventType === 'child_changed' && payload.eventType === 'UPDATE') {
          if (payload.new) {
            const childKey = extractChildKey(payload.new.id, pathInfo);
            const val = payload.new.data !== undefined ? payload.new.data : payload.new;
            if (targetTable === 'customer_chats' && payload.new.id) {
              cacheCustomerChatMsg(payload.new.id, val);
            }
            emitChildChanged(val, childKey);
          }
        } else if (eventType === 'child_removed' && payload.eventType === 'DELETE') {
          if (payload.old) {
            const childKey = extractChildKey(payload.old.id, pathInfo);
            emitChildRemoved(childKey);
          }
        }
      };

      if (!pathInfo.isEphemeral) {
        const cdcFilter = (targetTable === 'customer_chats' && pathInfo.custId)
          ? `room_id=eq.${pathInfo.custId}`
          : null;
        subRecord._unsubscribeCdc = subscribeTableCdc(client, targetTable, handleCdcEvent, cdcFilter);
      }

      // Register subscription for clean, leak-free removal
      registerSubscription(subRecord);
      return callback;
    },

    off(eventType, callback) {
      const cleanPath = (rawPath || '').replace(/^\/+|\/+$/g, '');
      const existingSubs = subscriptionsByPath.get(cleanPath);

      if (!existingSubs || existingSubs.size === 0) {
        // Also check if callback was passed directly as first arg: ref.off(myCallback)
        if (typeof eventType === 'function') {
          const byCb = subscriptionsByCallback.get(eventType);
          if (byCb) {
            Array.from(byCb).forEach(sub => {
              if (sub.path === cleanPath) removeSingleSubscription(client, sub);
            });
          }
        }
        return;
      }

      const toRemove = [];
      const isCbFunction = typeof callback === 'function';
      const isEvtFunction = typeof eventType === 'function';

      existingSubs.forEach(sub => {
        if (!eventType && !callback) {
          // ref.off() -> detach all listeners on this path
          toRemove.push(sub);
        } else if (isEvtFunction) {
          // ref.off(callback)
          if (sub.callback === eventType) toRemove.push(sub);
        } else if (eventType && !isCbFunction) {
          // ref.off('value') -> detach all value listeners on this path
          if (sub.eventType === eventType) toRemove.push(sub);
        } else if (eventType && isCbFunction) {
          // ref.off('value', callback) -> exact match
          if (sub.eventType === eventType && sub.callback === callback) toRemove.push(sub);
        }
      });

      toRemove.forEach(sub => removeSingleSubscription(client, sub));
    },

    async set(value, onComplete) {
      if (!client) {
        if (onComplete) onComplete(null);
        return;
      }

      try {
        let bPath = rawPath;
        let bVal = value;
        let bAction = 'insert';

        if (pathInfo.isEphemeral) {
          writeEphemeralNode(pathInfo, value, 'set');
        } else if (pathInfo.isCustomerChats) {
          const res = await handleCustomerChatsSet(client, pathInfo, value);
          if (res && res.broadcastPath) {
            bPath = res.broadcastPath;
            bVal = res.broadcastValue;
            bAction = res.broadcastAction || 'insert';
          }
        } else if (pathInfo.isStoreRiderChats) {
          await handleStoreRiderChatsSet(client, pathInfo, value);
        } else if (pathInfo.id) {
          // Standard table row write
          await runExclusive(`${pathInfo.table}:${pathInfo.id}`, async () => {
            if (pathInfo.subPath.length === 0) {
              const rowData = {
                id: pathInfo.id,
                data: value
              };
              if (pathInfo.table === 'catered_history') {
                const ts = value?.timestamp || (value?.completedDate && value?.completedTime ? new Date(`${value.completedDate} ${value.completedTime}`).getTime() : Date.now());
                rowData.completed_at = new Date(ts).toISOString();
              }
              const { error } = await client.from(pathInfo.table).upsert(rowData, { onConflict: 'id' });
              if (error) throw error;
              if (pathInfo.isStoreMenuGalleries && pathInfo.storeKey && storeMenuGalleriesCache) {
                storeMenuGalleriesCache[pathInfo.storeKey] = value;
              }
            } else {
              // Nested property write
              const { data: existing } = await client
                .from(pathInfo.table)
                .select('data')
                .eq('id', pathInfo.id)
                .maybeSingle();

              const current = (existing && existing.data && typeof existing.data === 'object') ? { ...existing.data } : {};
              let cursor = current;
              for (let i = 0; i < pathInfo.subPath.length - 1; i++) {
                const seg = pathInfo.subPath[i];
                if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
                cursor = cursor[seg];
              }
              cursor[pathInfo.subPath[pathInfo.subPath.length - 1]] = value;

              const rowData = {
                id: pathInfo.id,
                data: current
              };
              if (pathInfo.table === 'catered_history') {
                const ts = current?.timestamp || (current?.completedDate && current?.completedTime ? new Date(`${current.completedDate} ${current.completedTime}`).getTime() : Date.now());
                rowData.completed_at = new Date(ts).toISOString();
              }
              const { error } = await client.from(pathInfo.table).upsert(rowData, { onConflict: 'id' });
              if (error) throw error;
              if (pathInfo.isStoreMenuGalleries && pathInfo.storeKey && storeMenuGalleriesCache) {
                storeMenuGalleriesCache[pathInfo.storeKey] = current;
              }
              bPath = `${pathInfo.rootNode}/${pathInfo.id}`;
              bVal = current;
              bAction = 'update';
            }
          });
        } else if (value && typeof value === 'object') {
          // Full table batch upsert
          const rows = Object.entries(value).map(([k, v]) => {
            const row = { id: k, data: v };
            if (pathInfo.table === 'catered_history') {
              const ts = v?.timestamp || (v?.completedDate && v?.completedTime ? new Date(`${v.completedDate} ${v.completedTime}`).getTime() : Date.now());
              row.completed_at = new Date(ts).toISOString();
            }
            return row;
          });
          const { error } = await client.from(pathInfo.table).upsert(rows, { onConflict: 'id' });
          if (error) throw error;
        }

        // Broadcast change event
        broadcastMutation(client, pathInfo.table, bPath, bVal, bAction);

        if (typeof onComplete === 'function') onComplete(null);
      } catch (err) {
        console.error(`[Supabase set error on ${rawPath}]:`, err.message || err);
        if (typeof onComplete === 'function') onComplete(err);
        throw err;
      }
    },

    async update(values, onComplete) {
      if (!client || !values || typeof values !== 'object') {
        if (onComplete) onComplete(null);
        return;
      }

      try {
        const entries = Object.entries(values);
        const hasPathKeys = entries.some(([k]) => k.includes('/'));

        // Handle multi-path atomic updates (e.g. db.ref().update({ 'roster/123/status': 'Available' }))
        if (pathInfo.isRoot || hasPathKeys) {
          await handleMultiPathUpdate(client, rawPath, values);
          if (typeof onComplete === 'function') onComplete(null);
          return;
        }

        let bPath = rawPath;
        let bVal = values;
        let skipBroadcast = false;

        // Single-path object merge
        if (pathInfo.isEphemeral) {
          writeEphemeralNode(pathInfo, values, 'update');
        } else if (pathInfo.isCustomerChats || (pathInfo.table === 'customer_chat_meta' && pathInfo.id && pathInfo.subPath.length === 0)) {
          const metaPathInfo = pathInfo.isCustomerChats
            ? pathInfo
            : { custId: pathInfo.id, subType: 'metadata', targetId: null, subPath: [] };
          const res = await handleCustomerChatsUpdate(client, metaPathInfo, values);
          if (res && res.broadcastPath) {
            bPath = res.broadcastPath;
            bVal = res.broadcastValue;
          }
          if (res && res.skippedDuplicate) {
            skipBroadcast = true;
          }
        } else if (pathInfo.isStoreRiderChats) {
          await handleStoreRiderChatsUpdate(client, pathInfo, values);
        } else if (pathInfo.id) {
          await runExclusive(`${pathInfo.table}:${pathInfo.id}`, async () => {
            const { data: existing } = await client
              .from(pathInfo.table)
              .select('data')
              .eq('id', pathInfo.id)
              .maybeSingle();

            const current = (existing && existing.data && typeof existing.data === 'object') ? { ...existing.data } : {};
            let merged;
            if (pathInfo.subPath.length === 0) {
              merged = { ...current, ...values };
            } else {
              merged = { ...current };
              let cursor = merged;
              for (let i = 0; i < pathInfo.subPath.length - 1; i++) {
                const seg = pathInfo.subPath[i];
                cursor[seg] = (cursor[seg] && typeof cursor[seg] === 'object') ? { ...cursor[seg] } : {};
                cursor = cursor[seg];
              }
              const lastSeg = pathInfo.subPath[pathInfo.subPath.length - 1];
              const existingSub = (cursor[lastSeg] && typeof cursor[lastSeg] === 'object') ? { ...cursor[lastSeg] } : {};
              cursor[lastSeg] = { ...existingSub, ...values };
            }

            const rowData = {
              id: pathInfo.id,
              data: merged
            };
            if (pathInfo.table === 'catered_history') {
              const ts = merged?.timestamp || (merged?.completedDate && merged?.completedTime ? new Date(`${merged.completedDate} ${merged.completedTime}`).getTime() : Date.now());
              rowData.completed_at = new Date(ts).toISOString();
            }
            const { error } = await client.from(pathInfo.table).upsert(rowData, { onConflict: 'id' });
            if (error) throw error;
            bPath = `${pathInfo.rootNode}/${pathInfo.id}`;
            bVal = merged;
          });
        }

        // Broadcast change event with full merged state
        if (!skipBroadcast) {
          broadcastMutation(client, pathInfo.table, bPath, bVal, 'update');
        }

        if (typeof onComplete === 'function') onComplete(null);
      } catch (err) {
        console.error(`[Supabase update error on ${rawPath}]:`, err.message || err);
        if (typeof onComplete === 'function') onComplete(err);
        throw err;
      }
    },

    async remove(onComplete) {
      if (!client) {
        if (onComplete) onComplete(null);
        return;
      }

      try {
        if (pathInfo.isEphemeral) {
          writeEphemeralNode(pathInfo, null, 'remove');
        } else if (pathInfo.isCustomerChats) {
          await handleCustomerChatsRemove(client, pathInfo);
        } else if (pathInfo.isStoreRiderChats) {
          await handleStoreRiderChatsRemove(client, pathInfo);
        } else if (pathInfo.id) {
          await runExclusive(`${pathInfo.table}:${pathInfo.id}`, async () => {
            if (pathInfo.subPath.length === 0) {
              await client.from(pathInfo.table).delete().eq('id', pathInfo.id);
              if (pathInfo.isStoreMenuGalleries && pathInfo.storeKey && storeMenuGalleriesCache) {
                delete storeMenuGalleriesCache[pathInfo.storeKey];
              }
            } else {
              const { data: existing } = await client
                .from(pathInfo.table)
                .select('data')
                .eq('id', pathInfo.id)
                .maybeSingle();

              if (existing && existing.data) {
                const current = { ...existing.data };
                let cursor = current;
                for (let i = 0; i < pathInfo.subPath.length - 1; i++) {
                  cursor = cursor ? cursor[pathInfo.subPath[i]] : null;
                }
                if (cursor && typeof cursor === 'object') {
                  delete cursor[pathInfo.subPath[pathInfo.subPath.length - 1]];
                  await client.from(pathInfo.table).upsert({
                    id: pathInfo.id,
                    data: current
                  }, { onConflict: 'id' });
                  if (pathInfo.isStoreMenuGalleries && pathInfo.storeKey && storeMenuGalleriesCache) {
                    storeMenuGalleriesCache[pathInfo.storeKey] = current;
                  }
                }
              }
            }
          });
        }

        broadcastMutation(client, pathInfo.table, rawPath, null, 'remove');
        if (typeof onComplete === 'function') onComplete(null);
      } catch (err) {
        console.error(`[Supabase remove error on ${rawPath}]:`, err.message || err);
        if (typeof onComplete === 'function') onComplete(err);
        throw err;
      }
    },

    push(value, onComplete) {
      const newKey = generatePushId();
      const childRef = ref.child(newKey);
      let setPromise = null;
      if (value !== undefined) {
        setPromise = childRef.set(value, onComplete);
      }

      // ThenableReference compatibility (returns ref that is also awaitable)
      childRef.then = (onFulfilled, onRejected) => {
        const p = setPromise || Promise.resolve(childRef);
        return p.then(() => onFulfilled ? onFulfilled(childRef) : childRef, onRejected);
      };
      childRef.catch = (onRejected) => {
        const p = setPromise || Promise.resolve(childRef);
        return p.catch(onRejected);
      };

      return childRef;
    },

    async transaction(transactionUpdate, onComplete) {
      try {
        const snap = await ref.once('value');
        const current = snap.val();
        const newVal = transactionUpdate(current);
        if (newVal !== undefined) {
          await ref.set(newVal);
          const newSnap = createSnapshot(newVal, ref.key);
          if (typeof onComplete === 'function') onComplete(null, true, newSnap);
          return { committed: true, snapshot: newSnap };
        }
        if (typeof onComplete === 'function') onComplete(null, false, snap);
        return { committed: false, snapshot: snap };
      } catch (err) {
        if (typeof onComplete === 'function') onComplete(err, false, null);
        throw err;
      }
    },

    // Query builder methods
    orderByChild(field) {
      return createSupabaseRef(rawPath, { ...ref._query, orderBy: field });
    },
    orderByKey() {
      return createSupabaseRef(rawPath, { ...ref._query, orderBy: 'key' });
    },
    orderByValue() {
      return ref;
    },
    limitToLast(limit) {
      return createSupabaseRef(rawPath, { ...ref._query, limit, limitType: 'last' });
    },
    limitToFirst(limit) {
      return createSupabaseRef(rawPath, { ...ref._query, limit, limitType: 'first' });
    },
    equalTo(val) {
      return createSupabaseRef(rawPath, { ...ref._query, equalTo: val });
    },
    startAt(val) {
      return createSupabaseRef(rawPath, { ...ref._query, startAt: val });
    },
    endAt(val) {
      return createSupabaseRef(rawPath, { ...ref._query, endAt: val });
    }
  };

  return ref;
}

// ----------------------------------------------------------------------------
// MULTI-PATH ATOMIC UPDATE HANDLER (Grouped by Document)
// ----------------------------------------------------------------------------

async function handleMultiPathUpdate(client, rawPath, values) {
  const entries = Object.entries(values);
  const docGroups = new Map();

  for (const [subKey, subVal] of entries) {
    const fullPath = [rawPath, subKey].filter(Boolean).join('/').replace(/\/+/g, '/');
    const pInfo = parsePath(fullPath);

    if (pInfo.table === 'customer_chat_meta' || (pInfo.isCustomerChats && pInfo.subType === 'metadata')) {
      const custId = pInfo.custId || pInfo.id;
      if (custId) {
        const docKey = `cust_meta:${custId}`;
        if (!docGroups.has(docKey)) docGroups.set(docKey, { type: 'cust_meta', custId, fields: [] });
        const targetId = pInfo.isCustomerChats ? pInfo.targetId : (pInfo.subPath[0] || null);
        const subPath = pInfo.isCustomerChats ? pInfo.subPath : pInfo.subPath.slice(1);
        docGroups.get(docKey).fields.push({ targetId, subPath, value: subVal });
      }
    } else if (pInfo.isCustomerChats) {
      if (pInfo.subType === 'messages' && pInfo.targetId) {
        const rowId = pInfo.targetId.startsWith(`${pInfo.custId}_`) ? pInfo.targetId : `${pInfo.custId}_${pInfo.targetId}`;
        const docKey = `cust_msg:${rowId}`;
        if (!docGroups.has(docKey)) docGroups.set(docKey, { type: 'cust_msg', custId: pInfo.custId, targetId: pInfo.targetId, rowId, fields: [] });
        docGroups.get(docKey).fields.push({ subPath: pInfo.subPath, value: subVal });
      } else {
        const docKey = `direct:${fullPath}`;
        docGroups.set(docKey, { type: 'ref', ref: createSupabaseRef(fullPath), value: subVal });
      }
    } else if (pInfo.id) {
      const docKey = `std:${pInfo.table}:${pInfo.id}`;
      if (!docGroups.has(docKey)) docGroups.set(docKey, { type: 'std', rootNode: pInfo.rootNode, table: pInfo.table, id: pInfo.id, fields: [] });
      docGroups.get(docKey).fields.push({ subPath: pInfo.subPath, value: subVal });
    } else {
      const docKey = `direct:${fullPath}`;
      docGroups.set(docKey, { type: 'ref', ref: createSupabaseRef(fullPath), value: subVal });
    }
  }

  const tasks = [];
  for (const group of docGroups.values()) {
    if (group.type === 'std') {
      tasks.push(runExclusive(`${group.table}:${group.id}`, async () => {
        const { data: existing } = await client.from(group.table).select('data').eq('id', group.id).maybeSingle();
        const current = (existing && existing.data && typeof existing.data === 'object') ? { ...existing.data } : {};
        for (const f of group.fields) {
          if (f.subPath.length === 0) {
            if (f.value !== null && f.value !== undefined && typeof f.value === 'object') {
              Object.assign(current, f.value);
            }
          } else {
            let cursor = current;
            for (let i = 0; i < f.subPath.length - 1; i++) {
              const seg = f.subPath[i];
              if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
              cursor = cursor[seg];
            }
            const last = f.subPath[f.subPath.length - 1];
            if (f.value === null || f.value === undefined) {
              delete cursor[last];
            } else {
              cursor[last] = f.value;
            }
          }
        }
        await client.from(group.table).upsert({ id: group.id, data: current }, { onConflict: 'id' });
        broadcastMutation(client, group.table, `${group.rootNode || group.table}/${group.id}`, current, 'update');
      }));
    } else if (group.type === 'cust_meta') {
      tasks.push(runExclusive(`customer_chat_meta:${group.custId}`, async () => {
        let existingData = globalCustomerMetaCache.get(group.custId);
        if (!existingData) {
          const { data: existing } = await client.from('customer_chat_meta').select('data').eq('id', group.custId).maybeSingle();
          existingData = existing ? existing.data : null;
        }
        const current = (existingData && typeof existingData === 'object') ? { ...existingData } : {};
        for (const f of group.fields) {
          if (!f.targetId) {
            if (f.value && typeof f.value === 'object') Object.assign(current, f.value);
          } else {
            let cursor = current;
            const fullSub = [f.targetId, ...f.subPath];
            for (let i = 0; i < fullSub.length - 1; i++) {
              const seg = fullSub[i];
              if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
              cursor = cursor[seg];
            }
            const last = fullSub[fullSub.length - 1];
            if (f.value === null || f.value === undefined) {
              delete cursor[last];
            } else {
              cursor[last] = f.value;
            }
          }
        }
        globalCustomerMetaCache.set(group.custId, current);
        await client.from('customer_chat_meta').upsert({ id: group.custId, data: current, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        broadcastMutation(client, 'customer_chat_meta', `customerChatMeta/${group.custId}`, current, 'update');
      }));
    } else if (group.type === 'cust_msg') {
      tasks.push(runExclusive(`customer_chats:${group.rowId}`, async () => {
        let existingData = globalCustomerChatsMsgCache.get(group.rowId);
        if (!existingData) {
          const { data: existing } = await client.from('customer_chats').select('data').eq('id', group.rowId).maybeSingle();
          existingData = existing ? existing.data : null;
        }
        const current = (existingData && typeof existingData === 'object') ? { ...existingData } : {};
        for (const f of group.fields) {
          if (f.subPath.length === 0) {
            if (f.value && typeof f.value === 'object') Object.assign(current, f.value);
          } else {
            let cursor = current;
            for (let i = 0; i < f.subPath.length - 1; i++) {
              const seg = f.subPath[i];
              if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
              cursor = cursor[seg];
            }
            const last = f.subPath[f.subPath.length - 1];
            if (f.value === null || f.value === undefined) {
              delete cursor[last];
            } else {
              cursor[last] = f.value;
            }
          }
        }
        cacheCustomerChatMsg(group.rowId, current);
        await client.from('customer_chats').upsert({
          id: group.rowId,
          room_id: group.custId,
          sender_id: current.sender || current.senderName || null,
          message: current.text || current.message || null,
          timestamp: current.timestamp ? new Date(current.timestamp).toISOString() : new Date().toISOString(),
          data: current
        }, { onConflict: 'id' });
        broadcastMutation(client, 'customer_chats', `customerChats/${group.custId}/messages/${group.targetId || group.rowId}`, current, 'update');
      }));
    } else if (group.type === 'ref') {
      if (group.value === null || group.value === undefined) {
        tasks.push(group.ref.remove());
      } else {
        tasks.push(group.ref.set(group.value));
      }
    }
  }

  await Promise.all(tasks);
}

// ----------------------------------------------------------------------------
// CUSTOMER CHATS HANDLERS (Unpacked Streamed Schema)
// ----------------------------------------------------------------------------

function extractChildKey(rowId, pathInfo) {
  if (!rowId) return null;
  const prefix = pathInfo.custId ? `${pathInfo.custId}_` : (pathInfo.roomId ? `${pathInfo.roomId}_` : '');
  if (prefix && rowId.startsWith(prefix)) {
    return rowId.slice(prefix.length);
  }
  return rowId;
}

async function handleCustomerChatsOnce(client, pathInfo, query) {
  const { custId, subType, targetId, subPath } = pathInfo;

  // Case 1: All customer chats or metadata summary
  if (!custId) {
    const { data } = await client.from('customer_chat_meta').select('id, data');
    const result = {};
    if (data) {
      data.forEach(r => {
        result[r.id] = { metadata: r.data };
      });
    }
    return result;
  }

  // Case 2: customerChats/<custId>/messages
  if (subType === 'messages') {
    if (targetId) {
      // Single message: customerChats/<custId>/messages/<msgKey>
      const rowId = targetId.startsWith(`${custId}_`) ? targetId : `${custId}_${targetId}`;
      const { data } = await client
        .from('customer_chats')
        .select('data')
        .eq('id', rowId)
        .maybeSingle();

      let msgData = data ? data.data : null;
      if (msgData && subPath.length > 0) {
        for (const seg of subPath) {
          msgData = (msgData && typeof msgData === 'object') ? msgData[seg] : null;
        }
      }
      return msgData;
    } else {
      // All messages in room (use fast room_id index scan first, avoid over-fetching 50 rows)
      const cleanCust = String(custId || '').replace(/^fb_/, '');
      const altCust = String(custId || '').startsWith('fb_') ? cleanCust : `fb_${cleanCust}`;
      const roomIds = custId === altCust ? [custId] : [custId, altCust];

      let q = client
        .from('customer_chats')
        .select('id, data, timestamp')
        .in('room_id', roomIds)
        .not('id', 'like', '%_metadata')
        .not('id', 'like', '%_threadSeenBy')
        .not('id', 'like', '%_midIndex')
        .not('id', 'like', '%_messages');

      if (query.startAt) {
        const startTs = typeof query.startAt === 'number' ? new Date(query.startAt).toISOString() : query.startAt;
        q = q.gte('timestamp', startTs);
      }
      if (query.endAt) {
        const endTs = typeof query.endAt === 'number' ? new Date(query.endAt).toISOString() : query.endAt;
        q = q.lte('timestamp', endTs);
      }

      if (query.limit && query.limitType === 'last') {
        const fetchLimit = Math.min(Math.max((Number(query.limit) || 10) + 2, 1), 20);
        q = q.order('timestamp', { ascending: false, nullsFirst: false }).limit(fetchLimit);
      } else if (query.limit && query.limitType === 'first') {
        q = q.order('timestamp', { ascending: true, nullsFirst: false }).limit(Math.min(Number(query.limit) || 10, 20));
      } else {
        q = q.order('timestamp', { ascending: false, nullsFirst: false }).limit(20);
      }

      let { data, error } = await q;
      if (error || ((!data || data.length === 0) && !query.startAt)) {
        if (error) {
          console.warn(`[Supabase handleCustomerChatsOnce error on ${custId}]:`, error.message);
        }
        try {
          const fbLimit = Math.min(Math.max((Number(query.limit) || 10) + 2, 1), 15);
          const fallback = await client
            .from('customer_chats')
            .select('id, data, timestamp')
            .or(`room_id.eq.${custId},room_id.eq.${altCust},id.like.${custId}_*`)
            .not('id', 'like', '%_metadata')
            .not('id', 'like', '%_threadSeenBy')
            .not('id', 'like', '%_midIndex')
            .order('timestamp', { ascending: false, nullsFirst: false })
            .limit(fbLimit);
          if (fallback.data && fallback.data.length > 0) data = fallback.data;
        } catch (_) {}
      }
      const messages = {};
      if (data && Array.isArray(data)) {
        // Sort chronologically by internal message timestamp or row timestamp
        const rows = data.slice().sort((a, b) => {
          const tA = (a.data && a.data.timestamp) ? Number(a.data.timestamp) : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
          const tB = (b.data && b.data.timestamp) ? Number(b.data.timestamp) : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
          return tA - tB;
        });

        // If limitToLast, take the slice of last N
        const finalRows = (query.limit && query.limitType === 'last') ? rows.slice(-query.limit) : rows;

        finalRows.forEach(r => {
          if (!r.data || typeof r.data !== 'object' || r.id.endsWith('_messages')) return;
          cacheCustomerChatMsg(r.id, r.data);
          const key = r.id.startsWith(`${custId}_`) ? r.id.slice(custId.length + 1) : r.id;
          messages[key] = r.data;
        });
      }
      return messages;
    }
  }

  // Case 3: customerChats/<custId>/metadata
  if (subType === 'metadata') {
    let { data: metaData } = await client
      .from('customer_chat_meta')
      .select('data')
      .eq('id', custId)
      .maybeSingle();

    if (!metaData && !custId.startsWith('fb_')) {
      const fbRes = await client
        .from('customer_chat_meta')
        .select('data')
        .eq('id', `fb_${custId}`)
        .maybeSingle();
      if (fbRes.data) metaData = fbRes.data;
    }

    let result = metaData ? metaData.data : null;
    if (!result) {
      const { data: fallback } = await client
        .from('customer_chats')
        .select('data')
        .eq('id', `${custId}_metadata`)
        .maybeSingle();
      result = fallback ? fallback.data : null;
    }

    if (targetId && result && typeof result === 'object') {
      result = result[targetId];
      if (subPath.length > 0) {
        for (const seg of subPath) {
          result = (result && typeof result === 'object') ? result[seg] : null;
        }
      }
    }
    return result;
  }

  // Case 4: customerChats/<custId>/threadSeenBy or midIndex
  if (subType === 'threadSeenBy' || subType === 'midIndex') {
    const { data } = await client
      .from('customer_chats')
      .select('data')
      .eq('id', `${custId}_${subType}`)
      .maybeSingle();

    let result = data ? data.data : null;
    if (targetId && result && typeof result === 'object') {
      result = result[targetId];
      if (subPath.length > 0) {
        for (const seg of subPath) {
          result = (result && typeof result === 'object') ? result[seg] : null;
        }
      }
    }
    return result;
  }

  // Case 5: customerChats/<custId> root
  const [metaRes, msgsRes] = await Promise.all([
    client.from('customer_chat_meta').select('data').eq('id', custId).maybeSingle(),
    client.from('customer_chats').select('id, data').eq('room_id', custId).not('id', 'like', '%_metadata')
  ]);

  const messages = {};
  if (msgsRes.data) {
    msgsRes.data.forEach(r => {
      const key = r.id.startsWith(`${custId}_`) ? r.id.slice(custId.length + 1) : r.id;
      messages[key] = r.data;
    });
  }

  return {
    metadata: metaRes.data ? metaRes.data.data : {},
    messages: messages
  };
}

async function handleCustomerChatsSet(client, pathInfo, value) {
  const { custId, subType, targetId, subPath } = pathInfo;

  if (subType === 'messages') {
    if (targetId) {
      const rowId = targetId.startsWith(`${custId}_`) ? targetId : `${custId}_${targetId}`;
      return await runExclusive(`customer_chats:${rowId}`, async () => {
        if (subPath.length === 0) {
          cacheCustomerChatMsg(rowId, value);
          const { error } = await client.from('customer_chats').upsert({
            id: rowId,
            room_id: custId,
            sender_id: value?.sender || value?.senderName || null,
            message: value?.text || value?.message || null,
            timestamp: value?.timestamp ? new Date(value.timestamp).toISOString() : new Date().toISOString(),
            data: value
          }, { onConflict: 'id' });
          if (error) throw error;
          return {
            broadcastPath: `customerChats/${custId}/messages/${targetId}`,
            broadcastValue: value,
            broadcastAction: 'insert'
          };
        } else {
          let existingData = globalCustomerChatsMsgCache.get(rowId);
          if (!existingData) {
            const { data: existing } = await client.from('customer_chats').select('data').eq('id', rowId).maybeSingle();
            existingData = existing ? existing.data : null;
          }
          const current = (existingData && typeof existingData === 'object') ? { ...existingData } : {};
          let cursor = current;
          for (let i = 0; i < subPath.length - 1; i++) {
            const seg = subPath[i];
            if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
            cursor = cursor[seg];
          }
          cursor[subPath[subPath.length - 1]] = value;
          cacheCustomerChatMsg(rowId, current);

          const { error } = await client.from('customer_chats').upsert({
            id: rowId,
            room_id: custId,
            data: current
          }, { onConflict: 'id' });
          if (error) throw error;
          return {
            broadcastPath: `customerChats/${custId}/messages/${targetId}`,
            broadcastValue: current,
            broadcastAction: 'update'
          };
        }
      });
    } else if (value && typeof value === 'object') {
      const rows = Object.entries(value).map(([mKey, mVal]) => {
        const rowId = mKey.startsWith(`${custId}_`) ? mKey : `${custId}_${mKey}`;
        cacheCustomerChatMsg(rowId, mVal);
        const msgTimestamp = mVal?.timestamp ? new Date(mVal.timestamp).toISOString() : new Date().toISOString();
        return {
          id: rowId,
          room_id: custId,
          sender_id: mVal?.sender || mVal?.senderName || null,
          message: mVal?.text || mVal?.message || null,
          timestamp: msgTimestamp,
          data: mVal
        };
      });
      if (rows.length > 0) {
        const { error } = await client.from('customer_chats').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      return {
        broadcastPath: `customerChats/${custId}/messages`,
        broadcastValue: value,
        broadcastAction: 'insert'
      };
    }
  } else if (subType === 'metadata') {
    return await runExclusive(`customer_chat_meta:${custId}`, async () => {
      if (targetId) {
        let existingData = globalCustomerMetaCache.get(custId);
        if (!existingData) {
          const { data: existing } = await client.from('customer_chat_meta').select('data').eq('id', custId).maybeSingle();
          existingData = existing ? existing.data : null;
        }
        const current = (existingData && typeof existingData === 'object') ? { ...existingData } : {};
        if (subPath && subPath.length > 0) {
          if (!current[targetId] || typeof current[targetId] !== 'object') current[targetId] = {};
          let cursor = current[targetId];
          for (let i = 0; i < subPath.length - 1; i++) {
            const seg = subPath[i];
            if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
            cursor = cursor[seg];
          }
          cursor[subPath[subPath.length - 1]] = value;
        } else {
          current[targetId] = value;
        }
        globalCustomerMetaCache.set(custId, current);
        await client.from('customer_chat_meta').upsert({ id: custId, data: current, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        return {
          broadcastPath: `customerChatMeta/${custId}`,
          broadcastValue: current,
          broadcastAction: 'update'
        };
      } else {
        if (value && typeof value === 'object') globalCustomerMetaCache.set(custId, value);
        await client.from('customer_chat_meta').upsert({ id: custId, data: value, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        return {
          broadcastPath: `customerChatMeta/${custId}`,
          broadcastValue: value,
          broadcastAction: 'insert'
        };
      }
    });
  } else if (subType === 'threadSeenBy' || subType === 'midIndex') {
    const rowId = `${custId}_${subType}`;
    return await runExclusive(`customer_chats:${rowId}`, async () => {
      if (targetId) {
        let existingData = globalCustomerChatsMsgCache.get(rowId);
        if (!existingData) {
          const { data: existing } = await client.from('customer_chats').select('data').eq('id', rowId).maybeSingle();
          existingData = existing ? existing.data : null;
        }
        const current = (existingData && typeof existingData === 'object') ? { ...existingData } : {};
        current[targetId] = value;
        cacheCustomerChatMsg(rowId, current);
        await client.from('customer_chats').upsert({ id: rowId, room_id: custId, data: current }, { onConflict: 'id' });
        return {
          broadcastPath: `customerChats/${custId}/${subType}`,
          broadcastValue: current,
          broadcastAction: 'update'
        };
      } else {
        if (value && typeof value === 'object') cacheCustomerChatMsg(rowId, value);
        await client.from('customer_chats').upsert({ id: rowId, room_id: custId, data: value }, { onConflict: 'id' });
        return {
          broadcastPath: `customerChats/${custId}/${subType}`,
          broadcastValue: value,
          broadcastAction: 'update'
        };
      }
    });
  }
}

const recentCustomerMetaCache = new Map();

async function handleCustomerChatsUpdate(client, pathInfo, values) {
  const { custId, subType, targetId } = pathInfo;

  if (subType === 'messages' && targetId) {
    const rowId = targetId.startsWith(`${custId}_`) ? targetId : `${custId}_${targetId}`;
    return await runExclusive(`customer_chats:${rowId}`, async () => {
      let existingData = globalCustomerChatsMsgCache.get(rowId);
      if (!existingData) {
        const { data: existing } = await client.from('customer_chats').select('data').eq('id', rowId).maybeSingle();
        existingData = existing ? existing.data : null;
      }
      const current = (existingData && typeof existingData === 'object') ? { ...existingData } : {};
      const merged = { ...current, ...values };
      cacheCustomerChatMsg(rowId, merged);

      const { error } = await client.from('customer_chats').upsert({
        id: rowId,
        room_id: custId,
        sender_id: merged?.sender || merged?.senderName || null,
        message: merged?.text || merged?.message || null,
        timestamp: merged?.timestamp ? new Date(merged.timestamp).toISOString() : new Date().toISOString(),
        data: merged
      }, { onConflict: 'id' });
      if (error) throw error;
      return {
        broadcastPath: `customerChats/${custId}/messages/${targetId}`,
        broadcastValue: merged,
        broadcastAction: 'update'
      };
    });
  } else {
    // Metadata update (default for customerChats/<custId>/metadata, customerChats/<custId>, or customerChatMeta/<custId>)
    return await runExclusive(`customer_chat_meta:${custId}`, async () => {
      const recent = recentCustomerMetaCache.get(custId);
      if (recent && (Date.now() - recent.time) < 1500 && recent.data && typeof values === 'object') {
        const isIdentical = Object.entries(values).every(([k, v]) => {
          return JSON.stringify(recent.data[k]) === JSON.stringify(v);
        });
        if (isIdentical) {
          return {
            skippedDuplicate: true,
            broadcastPath: `customerChatMeta/${custId}`,
            broadcastValue: recent.data,
            broadcastAction: 'update'
          };
        }
      }

      let existingData = globalCustomerMetaCache.get(custId) || (recent ? recent.data : null);
      if (!existingData) {
        const { data: existing } = await client.from('customer_chat_meta').select('data').eq('id', custId).maybeSingle();
        existingData = existing ? existing.data : null;
      }
      const current = (existingData && typeof existingData === 'object') ? { ...existingData } : {};
      const merged = { ...current, ...values };

      globalCustomerMetaCache.set(custId, merged);
      await client.from('customer_chat_meta').upsert({ id: custId, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      recentCustomerMetaCache.set(custId, { data: merged, time: Date.now() });
      return {
        broadcastPath: `customerChatMeta/${custId}`,
        broadcastValue: merged,
        broadcastAction: 'update'
      };
    });
  }
}

async function handleCustomerChatsRemove(client, pathInfo) {
  const { custId, subType, targetId } = pathInfo;

  if (subType === 'messages' && targetId) {
    const rowId = targetId.startsWith(`${custId}_`) ? targetId : `${custId}_${targetId}`;
    await client.from('customer_chats').delete().eq('id', rowId);
  } else if (subType === 'metadata') {
    await Promise.all([
      client.from('customer_chat_meta').delete().eq('id', custId),
      client.from('customer_chats').delete().eq('id', `${custId}_metadata`)
    ]);
  }
}

// ----------------------------------------------------------------------------
// STORE RIDER CHATS HANDLERS (Unpacked Streamed Schema)
// ----------------------------------------------------------------------------

async function handleStoreRiderChatsOnce(client, pathInfo, query) {
  const { roomId, subType, targetId, subPath } = pathInfo;

  if (!roomId) {
    const { data } = await client.from('store_rider_chat_meta').select('id, data');
    const result = {};
    if (data) {
      data.forEach(r => {
        result[r.id] = r.data;
      });
    }
    return result;
  }

  if (subType === 'messages') {
    if (targetId) {
      const rowId = targetId.startsWith(`${roomId}_`) ? targetId : `${roomId}_${targetId}`;
      const { data } = await client
        .from('store_rider_chats')
        .select('data')
        .eq('id', rowId)
        .maybeSingle();

      let msgData = data ? data.data : null;
      if (msgData && subPath.length > 0) {
        for (const seg of subPath) {
          msgData = (msgData && typeof msgData === 'object') ? msgData[seg] : null;
        }
      }
      return msgData;
    } else {
      let q = client
        .from('store_rider_chats')
        .select('id, data, timestamp')
        .eq('room_id', roomId)
        .not('id', 'like', '%_metadata');

      if (query.limit && query.limitType === 'last') {
        q = q.order('timestamp', { ascending: false }).limit(query.limit);
      } else {
        q = q.order('timestamp', { ascending: true });
      }

      const { data } = await q;
      const messages = {};
      if (data && Array.isArray(data)) {
        const rows = (query.limit && query.limitType === 'last') ? data.reverse() : data;
        rows.forEach(r => {
          const key = r.id.startsWith(`${roomId}_`) ? r.id.slice(roomId.length + 1) : r.id;
          messages[key] = r.data;
        });
      }
      return messages;
    }
  }

  // Room metadata read
  const { data: meta } = await client
    .from('store_rider_chat_meta')
    .select('data')
    .eq('id', roomId)
    .maybeSingle();

  return meta ? meta.data : null;
}

async function handleStoreRiderChatsSet(client, pathInfo, value) {
  const { roomId, subType, targetId } = pathInfo;

  if (subType === 'messages' && targetId) {
    const rowId = targetId.startsWith(`${roomId}_`) ? targetId : `${roomId}_${targetId}`;
    return await runExclusive(`store_rider_chats:${rowId}`, async () => {
      const { error } = await client.from('store_rider_chats').upsert({
        id: rowId,
        room_id: roomId,
        sender_id: value?.sender || value?.senderName || null,
        message: value?.text || value?.message || null,
        timestamp: value?.timestamp ? new Date(value.timestamp).toISOString() : new Date().toISOString(),
        data: value
      }, { onConflict: 'id' });
      if (error) throw error;
      return {
        broadcastPath: `storeRiderChats/${roomId}/messages/${targetId}`,
        broadcastValue: value,
        broadcastAction: 'insert'
      };
    });
  } else {
    // Room metadata update
    return await runExclusive(`store_rider_chat_meta:${roomId}`, async () => {
      await Promise.all([
        client.from('store_rider_chat_meta').upsert({ id: roomId, data: value }, { onConflict: 'id' }),
        client.from('store_rider_chats').upsert({ id: `${roomId}_metadata`, room_id: roomId, data: value }, { onConflict: 'id' })
      ]);
      return {
        broadcastPath: `storeRiderChats/${roomId}`,
        broadcastValue: value,
        broadcastAction: 'insert'
      };
    });
  }
}

async function handleStoreRiderChatsUpdate(client, pathInfo, values) {
  const { roomId, subType, targetId } = pathInfo;

  if (subType === 'messages' && targetId) {
    const rowId = targetId.startsWith(`${roomId}_`) ? targetId : `${roomId}_${targetId}`;
    return await runExclusive(`store_rider_chats:${rowId}`, async () => {
      const { data: existing } = await client.from('store_rider_chats').select('data').eq('id', rowId).maybeSingle();
      const current = (existing && existing.data) ? { ...existing.data } : {};
      const merged = { ...current, ...values };

      const { error } = await client.from('store_rider_chats').upsert({
        id: rowId,
        room_id: roomId,
        data: merged
      }, { onConflict: 'id' });
      if (error) throw error;
      return {
        broadcastPath: `storeRiderChats/${roomId}/messages/${targetId}`,
        broadcastValue: merged,
        broadcastAction: 'update'
      };
    });
  } else {
    return await runExclusive(`store_rider_chat_meta:${roomId}`, async () => {
      const { data: existing } = await client.from('store_rider_chat_meta').select('data').eq('id', roomId).maybeSingle();
      const current = (existing && existing.data) ? { ...existing.data } : {};
      const merged = { ...current, ...values };

      await Promise.all([
        client.from('store_rider_chat_meta').upsert({ id: roomId, data: merged }, { onConflict: 'id' }),
        client.from('store_rider_chats').upsert({ id: `${roomId}_metadata`, room_id: roomId, data: merged }, { onConflict: 'id' })
      ]);
      return {
        broadcastPath: `storeRiderChats/${roomId}`,
        broadcastValue: merged,
        broadcastAction: 'update'
      };
    });
  }
}

async function handleStoreRiderChatsRemove(client, pathInfo) {
  const { roomId, subType, targetId } = pathInfo;

  if (subType === 'messages' && targetId) {
    const rowId = targetId.startsWith(`${roomId}_`) ? targetId : `${roomId}_${targetId}`;
    await client.from('store_rider_chats').delete().eq('id', rowId);
  } else {
    await Promise.all([
      client.from('store_rider_chat_meta').delete().eq('id', roomId),
      client.from('store_rider_chats').delete().eq('id', `${roomId}_metadata`)
    ]);
  }
}

// ----------------------------------------------------------------------------
// DB COMPATIBILITY INTERFACE
// ----------------------------------------------------------------------------

let lastGlobalResyncTime = 0;
const LIVE_RESYNC_ROOTS = new Set(['roster', 'customerChatMeta', 'liveSessions', 'swapRequests', 'orders', 'storeOrders']);

export async function resyncActiveSubscriptions(forceAll = false) {
  const client = getSupabase();
  if (!client) return;

  const now = Date.now();
  if (!forceAll && (now - lastGlobalResyncTime) < 180000) {
    return; // Throttle automatic reconnect resyncs to once per 3 minutes
  }
  lastGlobalResyncTime = now;

  const entries = Array.from(subscriptionsByPath.entries());
  for (const [subPath, subs] of entries) {
    const rootSeg = String(subPath || '').split('/')[0];
    if (!forceAll && !LIVE_RESYNC_ROOTS.has(rootSeg)) continue;

    for (const sub of subs) {
      if (!sub || sub.isClosed) continue;
      if (sub.eventType === 'value') {
        try {
          const ref = createSupabaseRef(sub.path, sub.query || {});
          const snap = await ref.once('value');
          if (sub.isClosed) continue;
          const val = snap.val();
          if (sub.tableCache) {
            sub.tableCache = new Map(val && typeof val === 'object' ? Object.entries(val) : []);
          } else {
            sub.docCache = val;
          }
          const sig = computeFastSignature(val);
          if (sub.lastSignature !== sig) {
            sub.lastSignature = sig;
            if (typeof sub.callback === 'function') {
              sub.callback(snap);
            }
          }
        } catch (err) {
          console.warn(`[Supabase Adapter] Resync failed for ${sub.path}:`, err);
        }
      }
    }
  }
}

export const supabaseDb = {
  ref(path = '') {
    return createSupabaseRef(path);
  },
  resyncSubscriptions() {
    return resyncActiveSubscriptions();
  },
  goOnline(forceReconnect = false) {
    try {
      const client = getSupabase();
      if (client && client.realtime) {
        const state = typeof client.realtime.connectionState === 'function'
          ? client.realtime.connectionState()
          : (typeof client.realtime.isConnected === 'function' && client.realtime.isConnected() ? 'open' : 'closed');
        if (forceReconnect || state === 'closed' || state === 'error') {
          try { client.realtime.disconnect(); } catch (_) {}
          try { client.realtime.connect(); } catch (_) {}
        } else if (state !== 'open') {
          try { client.realtime.connect(); } catch (_) {}
        }
      }
    } catch (_) {}
  },
  goOffline() {
    console.log('[Supabase Adapter] Offline state simulated.');
  }
};

export default supabaseDb;
