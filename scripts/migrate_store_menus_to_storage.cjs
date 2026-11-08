// scripts/migrate_store_menus_to_storage.cjs
/**
 * ============================================================================
 * STORE MENUS CLOUD STORAGE MIGRATION SCRIPT
 * ============================================================================
 * Converts high-bandwidth Base64 store menu images in the `store_menus` table
 * into lightweight public HTTPS URLs hosted on Supabase Storage (`store-menus` bucket).
 * 
 * Instructions:
 * 1. In Supabase Dashboard, create a public bucket named `store-menus`.
 * 2. In SQL Editor, run:
 *    create policy "Public Access" on storage.objects for all using (true) with check (true);
 * 3. Run: `node scripts/migrate_store_menus_to_storage.cjs`
 * ============================================================================
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://brdvugzjhkimcyabptcw.supabase.co";
const ANON_KEY = "sb_publishable_7wn7gV5RvuKWE2kGLRmaTQ_fgIC579K";

const sb = createClient(SUPABASE_URL, ANON_KEY);

function dataUrlToBuffer(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const buffer = Buffer.from(parts[1], 'base64');
    return { buffer, mime };
}

async function run() {
    console.log("=== CHECKING SUPABASE STORAGE BUCKET: 'store-menus' ===");
    const { data: bucket, error: bErr } = await sb.storage.getBucket('store-menus');

    if (bErr || !bucket) {
        console.warn("\n⚠️ Notice: Storage bucket 'store-menus' not yet created in Supabase Dashboard.");
        console.warn("To enable full cloud image hosting:");
        console.warn("1. Go to Supabase Dashboard -> Storage -> 'New bucket' -> Name: store-menus (Public: ON)");
        console.warn("2. In SQL Editor, run:");
        console.warn("   create policy \"Public Access\" on storage.objects for all using (true) with check (true);\n");
        return;
    }

    console.log("✅ Bucket 'store-menus' is active. Beginning migration of 37 store menus...\n");

    const { data: rows, error: rErr } = await sb.from('store_menus').select('id');
    if (rErr) {
        console.error("Error fetching store_menus rows:", rErr);
        return;
    }

    let totalMigratedPages = 0;
    let totalSavedBytes = 0;

    for (const r of rows) {
        if (r.id === 'smg__meta_index') continue;

        const { data: row } = await sb.from('store_menus').select('id, data').eq('id', r.id).single();
        if (!row || !row.data || !row.data.pages) continue;

        const storeKey = r.id.replace(/^smg__/, '');
        const pages = row.data.pages;
        let modified = false;

        const pageEntries = Array.isArray(pages) 
            ? pages.map((p, idx) => [`page_${idx+1}`, p]) 
            : Object.entries(pages);

        for (const [pageId, pageData] of pageEntries) {
            if (!pageData) continue;
            const img = pageData.imageUrl || pageData.image || '';

            if (typeof img === 'string' && img.startsWith('data:image')) {
                const parsed = dataUrlToBuffer(img);
                if (!parsed) continue;

                const fileName = `${storeKey}/${pageId}_${Date.now()}.jpg`;
                const { data: upData, error: upErr } = await sb.storage
                    .from('store-menus')
                    .upload(fileName, parsed.buffer, {
                        contentType: parsed.mime,
                        upsert: true,
                        cacheControl: '2592000'
                    });

                if (!upErr && upData) {
                    const { data: urlData } = sb.storage.from('store-menus').getPublicUrl(fileName);
                    const publicUrl = urlData.publicUrl;
                    totalSavedBytes += (img.length - publicUrl.length);
                    pageData.imageUrl = publicUrl;
                    if (pageData.image) delete pageData.image;
                    modified = true;
                    totalMigratedPages++;
                    console.log(`Uploaded [${storeKey}] ${pageId} -> ${publicUrl} (saved ${Math.round(img.length/1024)} KB)`);
                } else {
                    console.warn(`Upload failed for [${storeKey}] ${pageId}:`, upErr?.message || upErr);
                }
            }
        }

        if (modified) {
            await sb.from('store_menus').update({ data: row.data }).eq('id', r.id);
            console.log(`Updated database record for [${r.id}]`);
        }
    }

    console.log(`\n=== MIGRATION COMPLETE ===`);
    console.log(`Total Pages Migrated: ${totalMigratedPages}`);
    console.log(`Total Bandwidth Saved: ${Math.round(totalSavedBytes / 1024)} KB`);
}

run();
