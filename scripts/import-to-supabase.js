#!/usr/bin/env node

/**
 * ============================================================================
 * LOKALEX SUPABASE BULK IMPORT SCRIPT
 * ============================================================================
 * Streams and batch-imports all 33 Firebase RTDB JSON node backups into Supabase.
 *
 * Usage:
 *   node scripts/import-to-supabase.js
 *
 * Requirements:
 *   Set environment variables:
 *     SUPABASE_URL=https://xyz.supabase.co
 *     SUPABASE_SERVICE_ROLE_KEY=ey...
 *   Or pass them as flags:
 *     node scripts/import-to-supabase.js --url=... --key=...
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Resolve Credentials
function getArg(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

const SUPABASE_URL = process.env.SUPABASE_URL || getArg('url');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || getArg('key');
const BACKUP_DIR = process.env.BACKUP_DIR || getArg('backupDir') || 'C:\\Users\\Amiel\\Desktop\\rtdb_backups';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('\n❌ Error: Missing Supabase credentials!');
  console.error('Please provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  console.error('\nExamples:');
  console.error('  $env:SUPABASE_URL="https://your-project.supabase.co"');
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."');
  console.error('  node scripts/import-to-supabase.js');
  console.error('\nOr via CLI arguments:');
  console.error('  node scripts/import-to-supabase.js --url=https://... --key=eyJ...');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const BATCH_SIZE = 500;

async function upsertBatch(tableName, rows) {
  if (!rows || rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.warn(`⚠️ Warning: Error upserting chunk to ${tableName}:`, error.message);
    }
  }
}

// 2. Import Standard Node ({ key: value, ... })
async function importStandardNode(nodeName, tableName, transformRow) {
  const filePath = path.join(BACKUP_DIR, `${nodeName}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`⏩ Skipping ${nodeName} (file not found)`);
    return 0;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ JSON parse error in ${nodeName}.json:`, err.message);
    return 0;
  }

  if (!data || typeof data !== 'object') return 0;

  const rows = [];
  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) continue;
    if (typeof transformRow === 'function') {
      rows.push(transformRow(key, val));
    } else {
      rows.push({
        id: String(key),
        data: typeof val === 'object' ? val : { value: val },
        updated_at: new Date().toISOString()
      });
    }
  }

  await upsertBatch(tableName, rows);
  console.log(`✅ [${tableName}] Imported ${rows.length} records from ${nodeName}.json`);
  return rows.length;
}

// 3. Stream & Import Directory (Handles customers, storeMenuGalleries, and directory)
async function importDirectoryStream() {
  const filePath = path.join(BACKUP_DIR, 'directory.json');
  if (!fs.existsSync(filePath)) return 0;

  console.log('\n📂 Streaming and importing directory.json (55 MB)...');
  const rs = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

  let dirBatch = [];
  let custBatch = [];
  let count = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.startsWith('"') && trimmed.includes('": {')) {
      const colonIdx = trimmed.indexOf('":');
      const key = trimmed.slice(1, colonIdx);
      const objStr = trimmed.slice(colonIdx + 2).replace(/,$/, '');

      try {
        const val = JSON.parse(objStr);

        if (key === 'storeMenuGalleries') {
          // Special large galleries node
          const galleryRows = [];
          for (const [storeId, storeData] of Object.entries(val)) {
            galleryRows.push({
              store_id: storeId,
              pages: storeData.pages || storeData,
              updated_at: new Date().toISOString()
            });
          }
          await supabase.from('store_menu_galleries').upsert(galleryRows, { onConflict: 'store_id' });
          console.log(`   -> Imported ${galleryRows.length} store galleries`);
          continue;
        }

        if (key === 'customers') {
          for (const [cId, cVal] of Object.entries(val)) {
            custBatch.push({
              id: cId,
              name: cVal?.name || cVal?.customerName || null,
              phone: cVal?.phone || cVal?.phoneNumber || null,
              address: cVal?.address || null,
              data: cVal,
              updated_at: new Date().toISOString()
            });
            if (custBatch.length >= BATCH_SIZE) {
              await upsertBatch('customers', custBatch);
              custBatch = [];
            }
          }
          continue;
        }

        dirBatch.push({
          id: key,
          name: val.name || val.customerName || null,
          phone: val.phone || val.phoneNumber || null,
          address: val.address || null,
          category: val.category || null,
          data: val,
          updated_at: new Date().toISOString()
        });
        count++;

        if (dirBatch.length >= BATCH_SIZE) {
          await upsertBatch('directory', dirBatch);
          dirBatch = [];
          process.stdout.write(`   -> Imported ${count} directory records...\r`);
        }
      } catch (e) {
        // Line parsing fallback
      }
    }
  }

  if (dirBatch.length > 0) await upsertBatch('directory', dirBatch);
  if (custBatch.length > 0) await upsertBatch('customers', custBatch);

  console.log(`\n✅ [directory] Successfully imported ${count} directory records & menus.`);
  return count;
}

// 4. Stream & Import Customer Chats (1.11 GB, 27k+ messages)
async function importCustomerChatsStream() {
  const filePath = path.join(BACKUP_DIR, 'customerChats.json');
  if (!fs.existsSync(filePath)) return 0;

  console.log('\n💬 Streaming and importing customerChats.json (1.11 GB)...');
  const rs = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

  let metaBatch = [];
  let msgBatch = [];
  let custCount = 0;
  let msgCount = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.startsWith('"') && trimmed.includes('": {')) {
      const colonIdx = trimmed.indexOf('":');
      const custId = trimmed.slice(1, colonIdx);
      const objStr = trimmed.slice(colonIdx + 2).replace(/,$/, '');

      try {
        const parsed = JSON.parse(objStr);
        custCount++;

        // Metadata
        if (parsed.metadata) {
          metaBatch.push({
            id: custId,
            customer_name: parsed.metadata.customerName || null,
            folder: parsed.metadata.folder || 'inbox',
            status: parsed.metadata.status || null,
            catered_by_rider_id: parsed.metadata.completedByRiderId || parsed.metadata.cateredByRiderId || null,
            catered_by_rider_name: parsed.metadata.completedByRiderName || parsed.metadata.cateredByRiderName || null,
            last_updated: parsed.metadata.lastUpdated || Date.now(),
            unread_for_rider: !!parsed.metadata.unreadForRider,
            data: parsed.metadata,
            updated_at: new Date().toISOString()
          });
          if (metaBatch.length >= BATCH_SIZE) {
            await upsertBatch('customer_chat_meta', metaBatch);
            metaBatch = [];
          }
        }

        // Messages
        if (parsed.messages && typeof parsed.messages === 'object') {
          for (const [mKey, msg] of Object.entries(parsed.messages)) {
            if (!msg) continue;
            msgBatch.push({
              id: mKey,
              customer_id: custId,
              sender: msg.sender || null,
              sender_type: msg.senderType || null,
              is_rider: !!msg.isRider,
              text: msg.text || null,
              image_url: msg.imageUrl || null,
              timestamp: msg.timestamp || Date.now(),
              status: msg.status || 'delivered',
              data: msg,
              created_at: new Date(msg.timestamp || Date.now()).toISOString()
            });
            msgCount++;

            if (msgBatch.length >= BATCH_SIZE) {
              await upsertBatch('chat_messages', msgBatch);
              msgBatch = [];
              process.stdout.write(`   -> Processed ${custCount} chats, imported ${msgCount} messages...\r`);
            }
          }
        }
      } catch (err) {
        // Line parsing fallback
      }
    }
  }

  if (metaBatch.length > 0) await upsertBatch('customer_chat_meta', metaBatch);
  if (msgBatch.length > 0) await upsertBatch('chat_messages', msgBatch);

  console.log(`\n✅ [customerChats] Successfully imported ${custCount} customer chats and ${msgCount} messages.`);
  return msgCount;
}

// 5. Main Execution Pipeline
async function main() {
  console.log('====================================================');
  console.log('🚀 LOKALEX SUPABASE MIGRATION: 33 NODES BULK IMPORT');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Backup Folder: ${BACKUP_DIR}`);
  console.log('====================================================\n');

  const startTime = Date.now();
  let totalRecords = 0;

  // Operational
  totalRecords += await importStandardNode('riders', 'riders', (id, val) => ({
    id: String(id),
    name: val?.name || null,
    pin: val?.pin ? String(val.pin) : null,
    phone: val?.phone || null,
    status: val?.status || null,
    data: val,
    updated_at: new Date().toISOString()
  }));

  totalRecords += await importStandardNode('roster', 'roster', (id, val) => ({
    id: String(id),
    name: val?.name || null,
    status: val?.status || 'available',
    customer_name: val?.customerName || null,
    queue_time: val?.queueTime || null,
    break_start: val?.breakStart || null,
    break_duration: val?.breakDuration || 0,
    data: val,
    updated_at: new Date().toISOString()
  }));

  totalRecords += await importStandardNode('logins', 'logins', (id, val) => ({
    id: String(id),
    rider_id: val?.riderId ? String(val.riderId) : String(id),
    rider_name: val?.riderName || null,
    date: val?.date || null,
    data: val,
    updated_at: new Date().toISOString()
  }));

  totalRecords += await importStandardNode('riderDayoffs', 'rider_dayoffs');
  totalRecords += await importStandardNode('swapRequests', 'swap_requests');

  // Customers & Chat
  totalRecords += await importStandardNode('customers', 'customers', (id, val) => ({
    id: String(id),
    name: val?.name || val?.customerName || null,
    phone: val?.phone || val?.phoneNumber || null,
    address: val?.address || null,
    data: val,
    updated_at: new Date().toISOString()
  }));

  totalRecords += await importStandardNode('customerChatMeta', 'customer_chat_meta', (id, val) => ({
    id: String(id),
    customer_name: val?.customerName || null,
    folder: val?.folder || 'inbox',
    status: val?.status || null,
    catered_by_rider_id: val?.completedByRiderId || val?.cateredByRiderId || null,
    catered_by_rider_name: val?.completedByRiderName || val?.cateredByRiderName || null,
    last_updated: val?.lastUpdated || Date.now(),
    unread_for_rider: !!val?.unreadForRider,
    data: val,
    updated_at: new Date().toISOString()
  }));

  // Receipts & Finance
  totalRecords += await importStandardNode('receipts', 'receipts', (id, val) => ({
    id: String(id),
    tx_id: val?.txId || val?.id || String(id),
    rider_id: val?.riderId ? String(val.riderId) : null,
    rider_name: val?.riderName || null,
    customer_name: val?.customerName || null,
    date: val?.date || null,
    total_fees: val?.fees?.total || val?.total || 0,
    timestamp: val?.timestamp || null,
    data: val,
    created_at: new Date().toISOString()
  }));

  totalRecords += await importStandardNode('cateredHistory', 'catered_history');
  totalRecords += await importStandardNode('catered', 'catered');
  totalRecords += await importStandardNode('gcash', 'gcash');
  totalRecords += await importStandardNode('dailyTotals', 'daily_totals');
  totalRecords += await importStandardNode('commissionPenalties', 'commission_penalties');

  // Maps & Live Tracking
  totalRecords += await importStandardNode('liveSessions', 'live_sessions', (id, val) => ({
    id: String(id),
    rider_id: val?.riderId ? String(val.riderId) : null,
    data: val,
    updated_at: new Date().toISOString()
  }));
  totalRecords += await importStandardNode('liveTracking', 'live_tracking');
  totalRecords += await importStandardNode('mapCalculations', 'map_calculations');

  // Stores & Orders
  totalRecords += await importStandardNode('stores', 'stores', (id, val) => ({
    id: String(id),
    name: val?.name || null,
    data: val,
    updated_at: new Date().toISOString()
  }));
  totalRecords += await importStandardNode('storeAccounts', 'store_accounts');
  totalRecords += await importStandardNode('storeMenus', 'store_menus');
  totalRecords += await importStandardNode('storeOrders', 'store_orders');
  totalRecords += await importStandardNode('storeRiderChats', 'store_rider_chats');
  totalRecords += await importStandardNode('storeRiderChatMeta', 'store_rider_chat_meta');
  totalRecords += await importStandardNode('orders', 'orders');
  totalRecords += await importStandardNode('advancedOrders', 'advanced_orders');

  // Channels, System & Settings
  totalRecords += await importStandardNode('teamChat', 'team_chat');
  totalRecords += await importStandardNode('sharedQuickReplies', 'shared_quick_replies');
  totalRecords += await importStandardNode('facebookChannels', 'facebook_channels');
  totalRecords += await importStandardNode('phones', 'phones');
  totalRecords += await importStandardNode('emails', 'emails');
  totalRecords += await importStandardNode('settings', 'settings');
  totalRecords += await importStandardNode('adminSettings', 'admin_settings');

  // Large Streamed Nodes
  totalRecords += await importDirectoryStream();
  totalRecords += await importCustomerChatsStream();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n====================================================');
  console.log(`🎉 IMPORT COMPLETE! Imported ${totalRecords} total records in ${elapsed}s.`);
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('\n❌ Fatal Migration Error:', err);
  process.exit(1);
});

