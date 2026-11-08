const { createClient } = require('@supabase/supabase-js');
const sb = createClient('https://brdvugzjhkimcyabptcw.supabase.co', 'sb_publishable_7wn7gV5RvuKWE2kGLRmaTQ_fgIC579K');

async function check() {
  const { data, error } = await sb.from('customer_chats').select('id, data').limit(20);
  if (error) {
    console.error(error);
    return;
  }
  for (const r of data) {
    const d = r.data || {};
    const b64Fields = [];
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'string' && (v.startsWith('data:image') || v.includes(';base64,'))) {
        b64Fields.push(`${k} (${(v.length / 1024).toFixed(1)} KB)`);
      }
    }
    if (b64Fields.length > 0) {
      console.log(`Row: ${r.id} -> ${b64Fields.join(', ')}`);
    } else {
      console.log(`Row: ${r.id} -> No base64 (Size: ${(JSON.stringify(d).length / 1024).toFixed(2)} KB)`);
    }
  }
}
check().catch(console.error);
