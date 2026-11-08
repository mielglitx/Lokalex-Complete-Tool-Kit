// scripts/migrate_roster_avatars.cjs
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://brdvugzjhkimcyabptcw.supabase.co";
const ANON_KEY = "sb_publishable_7wn7gV5RvuKWE2kGLRmaTQ_fgIC579K";

const sb = createClient(SUPABASE_URL, ANON_KEY);

function getUiAvatarUrl(name) {
    const cleanName = (name || 'Rider').trim();
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=10b981&color=ffffff&bold=true&size=128`;
}

async function run() {
    console.log("=== STARTING ROSTER AVATARS CLEANUP & MIGRATION ===");
    const { data: roster, error: rErr } = await sb.from('roster').select('*');
    if (rErr) {
        console.error("Error fetching roster:", rErr);
        return;
    }

    let cleanedCount = 0;
    let savedBytes = 0;

    for (const row of roster) {
        const id = row.id;
        const d = row.data || row;
        const name = d.riderName || d.name || id;
        const photo = d.photoUrl || '';

        if (photo.startsWith('data:image')) {
            const originalLength = photo.length;
            const newUrl = getUiAvatarUrl(name);
            savedBytes += (originalLength - newUrl.length);

            // Update roster row
            const updatedData = { ...d, photoUrl: newUrl };
            const { error: upErr } = await sb.from('roster').update({ data: updatedData }).eq('id', id);
            if (upErr) {
                console.error(`Failed to update roster for ${name}:`, upErr.message);
            } else {
                console.log(`Cleaned roster avatar for ${name}: saved ${Math.round(originalLength/1024)} KB -> new URL`);
                cleanedCount++;
            }

            // Also update riders row if exists
            try {
                const { data: riderRow } = await sb.from('riders').select('data').eq('id', id).maybeSingle();
                if (riderRow && riderRow.data) {
                    const rData = { ...riderRow.data, photoUrl: newUrl };
                    await sb.from('riders').update({ data: rData }).eq('id', id);
                    console.log(`Also updated riders table row for ${name}`);
                }
            } catch (err) {
                console.warn(`Could not sync riders table for ${id}:`, err.message);
            }
        }
    }

    console.log(`=== FINISHED: Cleaned ${cleanedCount} avatars. Total bandwidth saved per sync: ${Math.round(savedBytes / 1024)} KB ===`);
}

run();
