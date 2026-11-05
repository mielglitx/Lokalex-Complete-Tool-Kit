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

export function createSnapshot(val, key = null) {
  return {
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

  // 3. Ephemeral Presence & Typing (mapped to live_sessions with prefix)
  if (rootNode === 'chatPresence' || rootNode === 'chatTyping') {
    const custId = segments[1] || 'all';
    const riderId = segments[2] || null;
    const prefix = rootNode === 'chatPresence' ? 'presence_' : 'typing_';
    return {
      isRoot: false,
      rootNode,
      table: 'live_sessions',
      id: prefix + custId,
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

  // 7. Standard Key-Value table (id, data)
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

  if (client && sub.channel) {
    try {
      client.removeChannel(sub.channel).catch(() => {});
    } catch (_) {}
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

// Centralized Global Broadcast Channel & Listener Registry
let globalBroadcastChannel = null;
const globalBroadcastSubscribers = new Set();

function getGlobalBroadcastChannel(client) {
  if (!globalBroadcastChannel && client) {
    try {
      globalBroadcastChannel = client.channel('lokalex_broadcast');
      globalBroadcastChannel.on('broadcast', { event: 'db_change' }, (eventPayload) => {
        for (const handler of globalBroadcastSubscribers) {
          try {
            handler(eventPayload);
          } catch (e) {
            console.warn('[Broadcast Handler Error]:', e);
          }
        }
      });
      globalBroadcastChannel.subscribe();
    } catch (err) {
      console.warn('[Supabase Global Broadcast Init Error]:', err);
    }
  }
  return globalBroadcastChannel;
}

function broadcastMutation(client, table, path, value) {
  if (!client) return;
  try {
    const ch = getGlobalBroadcastChannel(client);
    if (ch) {
      ch.send({
        type: 'broadcast',
        event: 'db_change',
        payload: { path, value, time: Date.now() }
      }).catch(() => {});
    }
  } catch (e) {}
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

      try {
        if (pathInfo.isRoot) {
          result = null;
        } else if (pathInfo.rootNode === 'shiftHistory' || pathInfo.table === 'shift_history') {
          // shiftHistory is maintained in Firebase RTDB
          if (typeof window !== 'undefined' && window.firebaseDb && typeof window.firebaseDb.ref === 'function') {
            try {
              const fbSnap = await window.firebaseDb.ref(rawPath).once('value');
              result = fbSnap ? fbSnap.val() : null;
            } catch (_) {
              result = {};
            }
          } else {
            result = {};
          }
        } else if (rawPath === 'directory/storeMenuGalleries' || rawPath.startsWith('directory/storeMenuGalleries/')) {
          // storeMenuGalleries is photo menu data maintained in Firebase RTDB to prevent statement timeouts
          const fbDb = (typeof window !== 'undefined' && (window.primaryDb || window.firebaseDb)) ? (window.primaryDb || window.firebaseDb) : null;
          if (fbDb && typeof fbDb.ref === 'function') {
            try {
              const fbSnap = await fbDb.ref(rawPath).once('value');
              result = fbSnap ? fbSnap.val() : null;
            } catch (_) {
              result = {};
            }
          } else {
            result = {};
          }
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
            console.warn(`[Supabase once error on ${rawPath}]:`, error.message);
          }

          let nodeData = data ? (data.data !== undefined ? data.data : data) : null;
          if (nodeData && pathInfo.subPath.length > 0) {
            for (const seg of pathInfo.subPath) {
              nodeData = (nodeData && typeof nodeData === 'object') ? nodeData[seg] : null;
            }
          }
          result = nodeData;
        } else {
          // Standard table full list read
          let query = client.from(pathInfo.table).select('id, data');

          if (ref._query.limit && ref._query.limitType === 'last') {
            if (pathInfo.table === 'advanced_orders' || pathInfo.table === 'receipts') {
              query = query.order('created_at', { ascending: false }).limit(ref._query.limit);
            } else if (pathInfo.table === 'catered_history') {
              query = query.order('completed_at', { ascending: false }).limit(ref._query.limit);
            } else {
              query = query.order('id', { ascending: false }).limit(ref._query.limit);
            }
          } else if (ref._query.limit && ref._query.limitType === 'first') {
            if (pathInfo.table === 'advanced_orders' || pathInfo.table === 'receipts') {
              query = query.order('created_at', { ascending: true }).limit(ref._query.limit);
            } else if (pathInfo.table === 'catered_history') {
              query = query.order('completed_at', { ascending: true }).limit(ref._query.limit);
            } else {
              query = query.order('id', { ascending: true }).limit(ref._query.limit);
            }
          }

          const { data, error } = await query;
          if (error && !error.message?.includes('schema cache')) {
            console.warn(`[Supabase once error on table ${pathInfo.table}]:`, error.message);
          }

          if (data && Array.isArray(data)) {
            result = {};
            data.forEach(row => {
              let val = row.data !== undefined ? row.data : row;
              result[row.id] = val;
            });

            // Filter if equalTo query specified
            if (ref._query.equalTo !== undefined && ref._query.orderBy) {
              const field = ref._query.orderBy;
              const eqVal = ref._query.equalTo;
              const filtered = {};
              for (const [k, v] of Object.entries(result)) {
                if (v && v[field] === eqVal) {
                  filtered[k] = v;
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
        console.warn(`[Supabase once exception on ${rawPath}]:`, err.message || err);
      }

      const snap = createSnapshot(result, ref.key);
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

      if (pathInfo.rootNode === 'shiftHistory' || pathInfo.table === 'shift_history') {
        if (typeof window !== 'undefined' && window.firebaseDb && typeof window.firebaseDb.ref === 'function') {
          return window.firebaseDb.ref(rawPath).on(eventType, callback);
        }
        callback(createSnapshot({}, ref.key));
        return callback;
      }

      if (rawPath === 'directory/storeMenuGalleries' || rawPath.startsWith('directory/storeMenuGalleries/')) {
        const fbDb = (typeof window !== 'undefined' && (window.primaryDb || window.firebaseDb)) ? (window.primaryDb || window.firebaseDb) : null;
        if (fbDb && typeof fbDb.ref === 'function') {
          return fbDb.ref(rawPath).on(eventType, callback);
        }
        callback(createSnapshot({}, ref.key));
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
        eventType,
        callback,
        channel: null,
        tableCache: null,
        debounceTimer: null,
        isClosed: false
      };

      // 1. Initial read
      if (eventType === 'value') {
        ref.once(eventType, (snap) => {
          if (subRecord.isClosed) return;
          if (isTableValueListener) {
            const val = snap.val();
            subRecord.tableCache = new Map(val && typeof val === 'object' ? Object.entries(val) : []);
          }
          callback(snap);
        });
      } else if (eventType === 'child_added') {
        ref.once('value', (snap) => {
          if (subRecord.isClosed) return;
          snap.forEach((childSnap) => {
            if (subRecord.isClosed) return;
            callback(childSnap);
          });
        });
      }

      // 2. Realtime Subscription Channel (Dedicated channel instance per subscription)
      const targetTable = pathInfo.table || 'settings';
      const subId = Math.random().toString(36).slice(2, 9);
      const channelId = `ch_${targetTable}_${(pathInfo.custId || pathInfo.roomId || pathInfo.id || 'all').toString().replace(/[^a-zA-Z0-9_]/g, '_')}_${subId}`;
      
      const channel = client.channel(channelId);
      subRecord.channel = channel;

      // Listen to broadcast events on both channel and global broadcast channel
      const handleBroadcastEvent = async (eventPayload) => {
        if (subRecord.isClosed) return;
        const payloadPath = eventPayload?.payload?.path;
        if (payloadPath && (payloadPath === rawPath || payloadPath.startsWith(rawPath) || rawPath.startsWith(payloadPath))) {
          if (eventType === 'value') {
            if (subRecord.tableCache && eventPayload?.payload?.newChild) {
              subRecord.tableCache.set(eventPayload.payload.newChild.key, eventPayload.payload.newChild.data);
              clearTimeout(subRecord.debounceTimer);
              subRecord.debounceTimer = setTimeout(() => {
                if (subRecord.isClosed) return;
                callback(createSnapshot(Object.fromEntries(subRecord.tableCache), ref.key));
              }, 40);
            } else {
              const snap = await ref.once(eventType);
              if (!subRecord.isClosed) callback(snap);
            }
          } else if (eventType === 'child_added' && eventPayload?.payload?.newChild) {
            callback(createSnapshot(eventPayload.payload.newChild.data, eventPayload.payload.newChild.key));
          } else if (eventType === 'child_changed' && eventPayload?.payload?.updatedChild) {
            callback(createSnapshot(eventPayload.payload.updatedChild.data, eventPayload.payload.updatedChild.key));
          } else if (eventType === 'child_removed' && eventPayload?.payload?.removedKey) {
            callback(createSnapshot(null, eventPayload.payload.removedKey));
          }
        }
      };

      subRecord._broadcastHandler = handleBroadcastEvent;
      globalBroadcastSubscribers.add(handleBroadcastEvent);
      getGlobalBroadcastChannel(client);

      channel.on('broadcast', { event: 'db_change' }, handleBroadcastEvent);

      // Listen to PostgreSQL CDC changes
      const changeFilter = {
        event: '*',
        schema: 'public',
        table: targetTable
      };

      if (pathInfo.isCustomerChats && pathInfo.subType === 'metadata') {
        changeFilter.table = 'customer_chat_meta';
        if (pathInfo.custId) {
          changeFilter.filter = `id=eq.${pathInfo.custId}`;
        }
      } else if (pathInfo.isCustomerChats && pathInfo.custId) {
        changeFilter.table = 'customer_chats';
        changeFilter.filter = `room_id=eq.${pathInfo.custId}`;
      } else if (pathInfo.isStoreRiderChats && pathInfo.roomId) {
        changeFilter.filter = `room_id=eq.${pathInfo.roomId}`;
      } else if (pathInfo.id) {
        changeFilter.filter = `id=eq.${pathInfo.id}`;
      }

      channel.on('postgres_changes', changeFilter, (payload) => {
        if (subRecord.isClosed) return;

        if (eventType === 'value') {
          if (subRecord.tableCache) {
            const row = payload.new || payload.old;
            const childKey = extractChildKey(row?.id, pathInfo);
            if (childKey) {
              if (payload.eventType === 'DELETE') {
                subRecord.tableCache.delete(childKey);
              } else if (payload.new) {
                const val = payload.new.data !== undefined ? payload.new.data : payload.new;
                subRecord.tableCache.set(childKey, val);
              }
            }

            clearTimeout(subRecord.debounceTimer);
            subRecord.debounceTimer = setTimeout(() => {
              if (subRecord.isClosed) return;
              callback(createSnapshot(Object.fromEntries(subRecord.tableCache), ref.key));
            }, 50);
          } else {
            // Single document listener
            clearTimeout(subRecord.debounceTimer);
            subRecord.debounceTimer = setTimeout(async () => {
              if (subRecord.isClosed) return;
              if (payload.eventType === 'DELETE') {
                callback(createSnapshot(null, ref.key));
              } else if (payload.new) {
                let val = payload.new.data !== undefined ? payload.new.data : payload.new;
                if (val && pathInfo.subPath && pathInfo.subPath.length > 0) {
                  for (const seg of pathInfo.subPath) {
                    val = (val && typeof val === 'object') ? val[seg] : null;
                  }
                }
                callback(createSnapshot(val, ref.key));
              } else {
                const snap = await ref.once('value');
                if (!subRecord.isClosed) callback(snap);
              }
            }, 40);
          }
        } else if (eventType === 'child_added' && payload.eventType === 'INSERT') {
          const row = payload.new;
          if (row) {
            const childKey = extractChildKey(row.id, pathInfo);
            const val = row.data !== undefined ? row.data : row;
            callback(createSnapshot(val, childKey));
          }
        } else if (eventType === 'child_changed' && payload.eventType === 'UPDATE') {
          const row = payload.new;
          if (row) {
            const childKey = extractChildKey(row.id, pathInfo);
            const val = row.data !== undefined ? row.data : row;
            callback(createSnapshot(val, childKey));
          }
        } else if (eventType === 'child_removed' && payload.eventType === 'DELETE') {
          const row = payload.old;
          if (row) {
            const childKey = extractChildKey(row.id, pathInfo);
            callback(createSnapshot(null, childKey));
          }
        }
      }).subscribe();

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
        if (rawPath === 'directory/storeMenuGalleries' || rawPath.startsWith('directory/storeMenuGalleries/')) {
          const fbDb = (typeof window !== 'undefined' && (window.primaryDb || window.firebaseDb)) ? (window.primaryDb || window.firebaseDb) : null;
          if (fbDb && typeof fbDb.ref === 'function') {
            await fbDb.ref(rawPath).set(value);
          }
          if (typeof onComplete === 'function') onComplete(null);
          return;
        }

        if (pathInfo.isCustomerChats) {
          await handleCustomerChatsSet(client, pathInfo, value);
        } else if (pathInfo.isStoreRiderChats) {
          await handleStoreRiderChatsSet(client, pathInfo, value);
        } else if (pathInfo.id) {
          // Standard table row write
          if (pathInfo.subPath.length === 0) {
            const { error } = await client.from(pathInfo.table).upsert({
              id: pathInfo.id,
              data: value
            }, { onConflict: 'id' });
            if (error) throw error;
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

            const { error } = await client.from(pathInfo.table).upsert({
              id: pathInfo.id,
              data: current
            }, { onConflict: 'id' });
            if (error) throw error;
          }
        } else if (value && typeof value === 'object') {
          // Full table batch upsert
          const rows = Object.entries(value).map(([k, v]) => ({
            id: k,
            data: v
          }));
          const { error } = await client.from(pathInfo.table).upsert(rows, { onConflict: 'id' });
          if (error) throw error;
        }

        // Broadcast change event
        broadcastMutation(client, pathInfo.table, rawPath, value);

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

        // Single-path object merge
        if (pathInfo.isCustomerChats) {
          await handleCustomerChatsUpdate(client, pathInfo, values);
        } else if (pathInfo.isStoreRiderChats) {
          await handleStoreRiderChatsUpdate(client, pathInfo, values);
        } else if (pathInfo.id) {
          const { data: existing } = await client
            .from(pathInfo.table)
            .select('data')
            .eq('id', pathInfo.id)
            .maybeSingle();

          const current = (existing && existing.data && typeof existing.data === 'object') ? { ...existing.data } : {};
          const merged = { ...current, ...values };

          const { error } = await client.from(pathInfo.table).upsert({
            id: pathInfo.id,
            data: merged
          }, { onConflict: 'id' });
          if (error) throw error;
        }

        // Broadcast change event
        broadcastMutation(client, pathInfo.table, rawPath, values);

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
        if (rawPath === 'directory/storeMenuGalleries' || rawPath.startsWith('directory/storeMenuGalleries/')) {
          const fbDb = (typeof window !== 'undefined' && (window.primaryDb || window.firebaseDb)) ? (window.primaryDb || window.firebaseDb) : null;
          if (fbDb && typeof fbDb.ref === 'function') {
            await fbDb.ref(rawPath).set(value);
          }
          if (typeof onComplete === 'function') onComplete(null);
          return;
        }

        if (pathInfo.isCustomerChats) {
          await handleCustomerChatsRemove(client, pathInfo);
        } else if (pathInfo.isStoreRiderChats) {
          await handleStoreRiderChatsRemove(client, pathInfo);
        } else if (pathInfo.id) {
          if (pathInfo.subPath.length === 0) {
            await client.from(pathInfo.table).delete().eq('id', pathInfo.id);
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
              }
            }
          }
        }

        broadcastMutation(client, pathInfo.table, rawPath, null);
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

    if (pInfo.isCustomerChats) {
      if (pInfo.subType === 'metadata') {
        const docKey = `cust_meta:${pInfo.custId}`;
        if (!docGroups.has(docKey)) docGroups.set(docKey, { type: 'cust_meta', custId: pInfo.custId, fields: [] });
        docGroups.get(docKey).fields.push({ targetId: pInfo.targetId, subPath: pInfo.subPath, value: subVal });
      } else if (pInfo.subType === 'messages' && pInfo.targetId) {
        const rowId = pInfo.targetId.startsWith(`${pInfo.custId}_`) ? pInfo.targetId : `${pInfo.custId}_${pInfo.targetId}`;
        const docKey = `cust_msg:${rowId}`;
        if (!docGroups.has(docKey)) docGroups.set(docKey, { type: 'cust_msg', custId: pInfo.custId, rowId, fields: [] });
        docGroups.get(docKey).fields.push({ subPath: pInfo.subPath, value: subVal });
      } else {
        const docKey = `direct:${fullPath}`;
        docGroups.set(docKey, { type: 'ref', ref: createSupabaseRef(fullPath), value: subVal });
      }
    } else if (pInfo.id) {
      const docKey = `std:${pInfo.table}:${pInfo.id}`;
      if (!docGroups.has(docKey)) docGroups.set(docKey, { type: 'std', table: pInfo.table, id: pInfo.id, fields: [] });
      docGroups.get(docKey).fields.push({ subPath: pInfo.subPath, value: subVal });
    } else {
      const docKey = `direct:${fullPath}`;
      docGroups.set(docKey, { type: 'ref', ref: createSupabaseRef(fullPath), value: subVal });
    }
  }

  const tasks = [];
  for (const group of docGroups.values()) {
    if (group.type === 'std') {
      tasks.push((async () => {
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
      })());
    } else if (group.type === 'cust_meta') {
      tasks.push((async () => {
        const { data: existing } = await client.from('customer_chat_meta').select('data').eq('id', group.custId).maybeSingle();
        const current = (existing && existing.data && typeof existing.data === 'object') ? { ...existing.data } : {};
        for (const f of group.fields) {
          if (!f.targetId) {
            if (typeof f.value === 'object') Object.assign(current, f.value);
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
        await Promise.all([
          client.from('customer_chat_meta').upsert({ id: group.custId, data: current, updated_at: new Date().toISOString() }, { onConflict: 'id' }),
          client.from('customer_chats').upsert({ id: `${group.custId}_metadata`, room_id: group.custId, data: current }, { onConflict: 'id' })
        ]);
      })());
    } else if (group.type === 'cust_msg') {
      tasks.push((async () => {
        const { data: existing } = await client.from('customer_chats').select('data').eq('id', group.rowId).maybeSingle();
        const current = (existing && existing.data && typeof existing.data === 'object') ? { ...existing.data } : {};
        for (const f of group.fields) {
          if (f.subPath.length === 0) {
            if (typeof f.value === 'object') Object.assign(current, f.value);
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
        await client.from('customer_chats').upsert({
          id: group.rowId,
          room_id: group.custId,
          sender_id: current.sender || current.senderName || null,
          message: current.text || current.message || null,
          timestamp: current.timestamp ? new Date(current.timestamp).toISOString() : new Date().toISOString(),
          data: current
        }, { onConflict: 'id' });
      })());
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
      // All messages in room
      const cleanCust = String(custId || '').replace(/^fb_/, '');
      const altCust = String(custId || '').startsWith('fb_') ? cleanCust : `fb_${cleanCust}`;
      let q = client
        .from('customer_chats')
        .select('id, data, timestamp')
        .or(`room_id.eq.${custId},room_id.eq.${altCust}`)
        .not('id', 'like', '%_metadata')
        .not('id', 'like', '%_threadSeenBy')
        .not('id', 'like', '%_midIndex')
        .not('id', 'like', '%_messages');

      if (query.limit && query.limitType === 'last') {
        q = q.order('timestamp', { ascending: false }).limit(query.limit * 2);
      } else {
        q = q.order('timestamp', { ascending: true });
      }

      const { data } = await q;
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
      if (subPath.length === 0) {
        const { error } = await client.from('customer_chats').upsert({
          id: rowId,
          room_id: custId,
          sender_id: value?.sender || value?.senderName || null,
          message: value?.text || value?.message || null,
          timestamp: value?.timestamp ? new Date(value.timestamp).toISOString() : new Date().toISOString(),
          data: value
        }, { onConflict: 'id' });
        if (error) throw error;
      } else {
        const { data: existing } = await client.from('customer_chats').select('data').eq('id', rowId).maybeSingle();
        const current = (existing && existing.data && typeof existing.data === 'object') ? { ...existing.data } : {};
        let cursor = current;
        for (let i = 0; i < subPath.length - 1; i++) {
          const seg = subPath[i];
          if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
          cursor = cursor[seg];
        }
        cursor[subPath[subPath.length - 1]] = value;

        const { error } = await client.from('customer_chats').upsert({
          id: rowId,
          room_id: custId,
          data: current
        }, { onConflict: 'id' });
        if (error) throw error;
      }
    } else if (value && typeof value === 'object') {
      const rows = Object.entries(value).map(([mKey, mVal]) => {
        const rowId = mKey.startsWith(`${custId}_`) ? mKey : `${custId}_${mKey}`;
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
    }
  } else if (subType === 'metadata') {
    if (targetId) {
      const { data: existing } = await client.from('customer_chat_meta').select('data').eq('id', custId).maybeSingle();
      const current = (existing && existing.data) ? { ...existing.data } : {};
      current[targetId] = value;

      await Promise.all([
        client.from('customer_chat_meta').upsert({ id: custId, data: current, updated_at: new Date().toISOString() }, { onConflict: 'id' }),
        client.from('customer_chats').upsert({ id: `${custId}_metadata`, room_id: custId, data: current }, { onConflict: 'id' })
      ]);
    } else {
      await Promise.all([
        client.from('customer_chat_meta').upsert({ id: custId, data: value, updated_at: new Date().toISOString() }, { onConflict: 'id' }),
        client.from('customer_chats').upsert({ id: `${custId}_metadata`, room_id: custId, data: value }, { onConflict: 'id' })
      ]);
    }
  } else if (subType === 'threadSeenBy' || subType === 'midIndex') {
    const rowId = `${custId}_${subType}`;
    if (targetId) {
      const { data: existing } = await client.from('customer_chats').select('data').eq('id', rowId).maybeSingle();
      const current = (existing && existing.data) ? { ...existing.data } : {};
      current[targetId] = value;
      await client.from('customer_chats').upsert({ id: rowId, room_id: custId, data: current }, { onConflict: 'id' });
    } else {
      await client.from('customer_chats').upsert({ id: rowId, room_id: custId, data: value }, { onConflict: 'id' });
    }
  }
}

async function handleCustomerChatsUpdate(client, pathInfo, values) {
  const { custId, subType, targetId } = pathInfo;

  if (subType === 'messages' && targetId) {
    const rowId = targetId.startsWith(`${custId}_`) ? targetId : `${custId}_${targetId}`;
    const { data: existing } = await client.from('customer_chats').select('data').eq('id', rowId).maybeSingle();
    const current = (existing && existing.data) ? { ...existing.data } : {};
    const merged = { ...current, ...values };

    const { error } = await client.from('customer_chats').upsert({
      id: rowId,
      room_id: custId,
      sender_id: merged?.sender || merged?.senderName || null,
      message: merged?.text || merged?.message || null,
      timestamp: merged?.timestamp ? new Date(merged.timestamp).toISOString() : new Date().toISOString(),
      data: merged
    }, { onConflict: 'id' });
    if (error) throw error;
  } else {
    // Metadata update (default for customerChats/<custId>/metadata or customerChats/<custId>)
    const { data: existing } = await client.from('customer_chat_meta').select('data').eq('id', custId).maybeSingle();
    const current = (existing && existing.data) ? { ...existing.data } : {};
    const merged = { ...current, ...values };

    await Promise.all([
      client.from('customer_chat_meta').upsert({ id: custId, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'id' }),
      client.from('customer_chats').upsert({ id: `${custId}_metadata`, room_id: custId, data: merged }, { onConflict: 'id' })
    ]);
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
    const { error } = await client.from('store_rider_chats').upsert({
      id: rowId,
      room_id: roomId,
      sender_id: value?.sender || value?.senderName || null,
      message: value?.text || value?.message || null,
      timestamp: value?.timestamp ? new Date(value.timestamp).toISOString() : new Date().toISOString(),
      data: value
    }, { onConflict: 'id' });
    if (error) throw error;
  } else {
    // Room metadata update
    await Promise.all([
      client.from('store_rider_chat_meta').upsert({ id: roomId, data: value }, { onConflict: 'id' }),
      client.from('store_rider_chats').upsert({ id: `${roomId}_metadata`, room_id: roomId, data: value }, { onConflict: 'id' })
    ]);
  }
}

async function handleStoreRiderChatsUpdate(client, pathInfo, values) {
  const { roomId, subType, targetId } = pathInfo;

  if (subType === 'messages' && targetId) {
    const rowId = targetId.startsWith(`${roomId}_`) ? targetId : `${roomId}_${targetId}`;
    const { data: existing } = await client.from('store_rider_chats').select('data').eq('id', rowId).maybeSingle();
    const current = (existing && existing.data) ? { ...existing.data } : {};
    const merged = { ...current, ...values };

    const { error } = await client.from('store_rider_chats').upsert({
      id: rowId,
      room_id: roomId,
      data: merged
    }, { onConflict: 'id' });
    if (error) throw error;
  } else {
    const { data: existing } = await client.from('store_rider_chat_meta').select('data').eq('id', roomId).maybeSingle();
    const current = (existing && existing.data) ? { ...existing.data } : {};
    const merged = { ...current, ...values };

    await Promise.all([
      client.from('store_rider_chat_meta').upsert({ id: roomId, data: merged }, { onConflict: 'id' }),
      client.from('store_rider_chats').upsert({ id: `${roomId}_metadata`, room_id: roomId, data: merged }, { onConflict: 'id' })
    ]);
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

export const supabaseDb = {
  ref(path = '') {
    return createSupabaseRef(path);
  },
  goOnline() {
    try {
      const client = getSupabase();
      if (client && client.realtime) {
        if (typeof client.realtime.isConnected === 'function' && !client.realtime.isConnected()) {
          console.log('[Supabase Adapter] Realtime disconnected; reconnecting...');
          client.realtime.connect();
        }
      }
    } catch (_) {}
  },
  goOffline() {
    console.log('[Supabase Adapter] Offline state simulated.');
  }
};

export default supabaseDb;
