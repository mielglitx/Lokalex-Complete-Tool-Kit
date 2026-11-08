const { createClient } = require('@supabase/supabase-js');

const DEFAULT_SUPABASE_URL = "https://brdvugzjhkimcyabptcw.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_7wn7gV5RvuKWE2kGLRmaTQ_fgIC579K";
const sb = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY);

async function investigate() {
  console.log('=== INVESTIGATING SUPABASE TABLES & SIZES ===');

  const tables = [
    'store_menus',
    'stores',
    'customers',
    'receipts',
    'catered_history',
    'shift_history',
    'logins',
    'roster',
    'riders',
    'customer_chat_meta',
    'directory'
  ];

  for (const t of tables) {
    try {
      const { data, count, error } = await sb.from(t).select('id, data', { count: 'exact' });
      if (error) {
        console.log(`Table ${t.padEnd(20)}: Error -> ${error.message}`);
        continue;
      }
      const rawLen = JSON.stringify(data || []).length;
      console.log(`Table ${t.padEnd(20)}: ${String(data.length).padStart(5)} rows | Total: ${(rawLen / 1024).toFixed(1)} KB (avg ${(rawLen / (data.length || 1) / 1024).toFixed(1)} KB/row)`);
    } catch (e) {
      console.log(`Table ${t.padEnd(20)}: Exception -> ${e.message}`);
    }
  }

  // Check how many non-smg rows in store_menus
  const { data: smNonSmg } = await sb.from('store_menus').select('id, data').not('id', 'like', 'smg__%');
  const nonSmgLen = JSON.stringify(smNonSmg || []).length;
  console.log(`\nstore_menus (non-smg only): ${smNonSmg ? smNonSmg.length : 0} rows | ${(nonSmgLen / 1024).toFixed(1)} KB`);

  // Check how many smg rows in store_menus
  const { data: smSmg } = await sb.from('store_menus').select('id').like('id', 'smg__%');
  console.log(`store_menus (smg__ galleries): ${smSmg ? smSmg.length : 0} rows`);
}

investigate().catch(console.error);
