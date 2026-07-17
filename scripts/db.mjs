/**
 * Ask Supabase a question without writing a throwaway script.
 *
 * Replaces the write→run→delete cycle that produced 256 temp probes and 111 inline
 * `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` one-liners in the last
 * month. Same service-role client, dotenv already loaded, no file to clean up.
 *
 * Run:
 *   npm run db -- market_reports --limit 3
 *   npm run db -- market_reports --select id,owner_email,subject --eq owner_email=sue@example.com
 *   npm run db -- sam_opportunities --count
 *   npm run db -- cron_jobs --select job_name,cron_expr,enabled --eq enabled=true
 *   npm run db:check -- market_reports payload        # did the migration land?
 *
 * Flags:
 *   --select <cols>   default *
 *   --eq k=v          filter (repeatable)
 *   --like k=v        ILIKE filter (repeatable, use % yourself)
 *   --order <col>     order by, descending
 *   --limit <n>       default 5
 *   --count           just the row count (head request, no rows pulled)
 *   --json            raw JSON out
 *
 * Exit 0 = query ran. 1 = error (missing table/column → the migration didn't land).
 *
 * ⚠️ Reads .env.local, which points at PRODUCTION Supabase. This is a read tool by
 * design — it has no insert/update/delete path. Keep it that way.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// quiet: dotenv v17+ prints an "injected env" banner to STDOUT, which corrupts --json
// for anything piping us into jq/python. Machine-readable has to mean machine-readable.
dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const all = (n) => args.reduce((acc, a, i) => (a === `--${n}` ? [...acc, args[i + 1]] : acc), []);
const has = (n) => args.includes(`--${n}`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n  Run: vercel env pull .env.local');
  process.exit(1);
}

// --check <table> <column>: the migration-landed probe. "Success. No rows returned"
// in the SQL editor proves nothing — this asks the actual schema cache.
if (has('check')) {
  const [table, column] = args.filter((a) => !a.startsWith('--'));
  if (!table) { console.error('usage: npm run db:check -- <table> [column]'); process.exit(2); }
  const sb = createClient(url, key);
  const { error } = await sb.from(table).select(column || '*').limit(1);
  if (error) {
    console.error(`\x1b[31m✗ NOT applied\x1b[0m — ${table}${column ? `.${column}` : ''}: ${error.message}`);
    process.exit(1);
  }
  console.log(`\x1b[32m✓ exists\x1b[0m — ${table}${column ? `.${column}` : ''}`);
  process.exit(0);
}

const positional = (() => {
  const consumed = new Set();
  for (const n of ['select', 'eq', 'like', 'is', 'order', 'limit']) {
    args.forEach((a, i) => { if (a === `--${n}`) { consumed.add(i); consumed.add(i + 1); } });
  }
  return args.filter((a, i) => !consumed.has(i) && !a.startsWith('--'));
})();
const tbl = positional[0];

if (!tbl) {
  console.error('usage: npm run db -- <table> [--select cols] [--eq k=v] [--like k=v] [--order col] [--limit n] [--count]');
  process.exit(2);
}

const sb = createClient(url, key);

// Filters MUST be applied to the count too. They weren't once, and `--count --eq
// quality_flag=x` cheerfully reported the WHOLE table — a confidently wrong number,
// which is worse than an error. Build the filters once, use them for both paths.
const applyFilters = (q) => {
  for (const f of all('eq')) { const [k, ...v] = f.split('='); q = q.eq(k, v.join('=')); }
  for (const f of all('like')) { const [k, ...v] = f.split('='); q = q.ilike(k, v.join('=')); }
  // `--is k=null|true|false`. NULL is not reachable via --eq (PostgREST needs IS), and
  // "quality_flag IS NULL" is the real-vs-synthetic filter query.ts itself uses — without
  // this you can only get the NULL count by subtracting, which assumes you know every
  // other value. Ask directly instead.
  for (const f of all('is')) {
    const [k, ...v] = f.split('=');
    const raw = v.join('=').toLowerCase();
    const val = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : undefined;
    if (val === undefined) { console.error(`✗ --is ${f}: value must be null|true|false`); process.exit(2); }
    q = q.is(k, val);
  }
  return q;
};
const filtered = all('eq').length + all('like').length + all('is').length > 0;

if (has('count')) {
  const { count, error } = await applyFilters(sb.from(tbl).select('*', { count: 'exact', head: true }));
  if (error) { console.error(`\x1b[31m✗\x1b[0m ${tbl}: ${error.message}`); process.exit(1); }
  const where = filtered
    ? ` matching ${[...all('eq'), ...all('like'), ...all('is').map((f) => f.replace('=', ' IS '))].join(' & ')}`
    : '';
  console.log(`${tbl}: \x1b[1m${(count ?? 0).toLocaleString()}\x1b[0m rows${where}`);
  process.exit(0);
}

let q = applyFilters(sb.from(tbl).select(flag('select', '*')));
if (flag('order')) q = q.order(flag('order'), { ascending: false });
q = q.limit(Number(flag('limit', '5')));

const { data, error } = await q;
if (error) {
  console.error(`\x1b[31m✗\x1b[0m ${tbl}: ${error.message}`);
  process.exit(1);
}
if (has('json')) { console.log(JSON.stringify(data, null, 2)); process.exit(0); }
if (!data?.length) { console.log(`${tbl}: \x1b[33m0 rows\x1b[0m (query ran — the table is empty for this filter)`); process.exit(0); }

console.log(`${tbl}: ${data.length} row(s)\n`);
console.table(
  data.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => {
        const s = v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return [k, s.length > 48 ? `${s.slice(0, 45)}…` : s];
      }),
    ),
  ),
);
