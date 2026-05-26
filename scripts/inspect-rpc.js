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
  // Direct SQL via /rest/v1/rpc to see real PG error
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/get_rag_chunks`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ q: 'past performance', doc_types_filter: null, limit_n: 3 }),
  });
  const txt = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', txt);
})();
