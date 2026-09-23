/**
 * Opportunity share funnel — READ-ONLY report over src/lib/attribution/share-funnel.sql.
 *
 *   shares → unique share visitors → signups → activated within 7 days → paid → revenue
 *
 * No dashboard: this prints the one defensible model, segmented on request. Runs inside a
 * READ ONLY transaction, so it cannot write even by mistake.
 *
 *   npx tsx scripts/report-share-funnel.mts                         # totals
 *   npx tsx scripts/report-share-funnel.mts --by notice_id          # per opportunity
 *   npx tsx scripts/report-share-funnel.mts --by sharer --since 2026-10-01
 *   npx tsx scripts/report-share-funnel.mts --by method,shared_on --json
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
config({ path: '.env.local' });

const SEGMENTS = new Set(['notice_id', 'sharer', 'method', 'kind', 'shared_on']);
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
const by = (arg('--by') || '').split(',').map((s) => s.trim()).filter(Boolean);
for (const b of by) if (!SEGMENTS.has(b)) { console.error(`--by must be one of ${[...SEGMENTS].join(', ')}`); process.exit(2); }
const since = arg('--since');
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error('--since must be YYYY-MM-DD'); process.exit(2); }

const sql = readFileSync(join(process.cwd(), 'src/lib/attribution/share-funnel.sql'), 'utf8');
const cols = by.length ? by.join(', ') + ', ' : '';
// COALESCE here is arithmetic, not fabrication: every row counted is a real share, so the sum
// over zero shares is exactly 0 (the "unknown ≠ 0" rule is about MISSING sources, not empty sets).
const query = `SELECT ${cols}COUNT(*)::int AS shares, COALESCE(SUM(share_visitors),0)::int AS visitors, COALESCE(SUM(signups),0)::int AS signups,
  COALESCE(SUM(activated_7d),0)::int AS activated_7d, COALESCE(SUM(paid_customers),0)::int AS paid_customers, COALESCE(SUM(revenue_cents),0)::bigint AS revenue_cents
  FROM (${sql}) f ${since ? 'WHERE f.shared_on >= $1::date' : ''} ${by.length ? `GROUP BY ${by.join(', ')} ORDER BY ${by.join(', ')}` : ''}`;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query(query, since ? [since] : []);
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else console.table(rows);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
