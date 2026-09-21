const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const env = {};
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...r] = line.split('='); if (!k || !r.length) return;
  let v = r.join('=').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k.trim()] = v;
});
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  // Sample one chunk so we can see actual return shape
  const { data, error } = await supa.from('mindy_rag_chunks').select('*').limit(1).single();
  if (error) { console.error(error); return; }
  console.log('Sample row keys + types:');
  Object.entries(data).forEach(([k, v]) => {
    const t = v === null ? 'null' : typeof v;
    const sample = String(v).slice(0, 40);
    console.log(`  ${k.padEnd(25)} ${t.padEnd(8)} ${sample}`);
  });
})();
