// Read-only R0 reconciliation after #1801 (see tasks/auth-r0-production-proof-2026-09-27.md).
// Usage: node scripts/r0-briefings-migration-reconcile.mjs 2026-10-03T21:47:37Z
import { config } from 'dotenv'; config({ path: '.env.local' });
import pg from 'pg';
const since = process.argv[2];
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const mask = (e) => e ? e.replace(/^(.{3}).*(@.*)$/, '$1…$2') : e;
// Daily rows cannot be split at the deploy instant; last_seen > deploy shows activity after it.
const after = await c.query(`select route, method, sum(count)::int n, max(last_seen) last from auth_observation_daily
  where route in ('/api/briefings/latest','/api/alerts/preferences','/api/app/me') and last_seen >= $1 group by 1,2 order by 1,2`, [since]);
console.log('Rows with activity after deploy (daily totals):'); console.table(after.rows);
const succ = await c.query(`select route, email, count::int, last_seen from auth_observation_emails
  where method='cookie' and route='/api/briefings/latest' and last_seen >= $1`, [since]);
console.log('Successful cookie-authenticated briefing reads after deploy:', succ.rows.length);
const cohort = (await c.query(`select distinct email from auth_observation_emails where method='cookie' and email is not null`)).rows.map(r => r.email);
console.log('Cookie-era cohort size:', cohort.length);
for (const e of cohort) {
  const sends = (await c.query(`select count(*)::int n, max(created_at) last from email_provider_sends where user_email=$1 and email_type='access_link' and created_at >= $2`, [e, since])).rows[0];
  const views = (await c.query(`select count(*)::int n, max(created_at) last from user_engagement where user_email=$1 and event_source='market_intelligence' and created_at >= $2`, [e, since])).rows[0];
  const lastCookie = (await c.query(`select max(last_seen) l from auth_observation_emails where email=$1 and method='cookie'`, [e])).rows[0].l;
  console.log(`${mask(e)} · last cookie ${lastCookie?.toISOString?.() ?? lastCookie} · secure-link sends ${sends.n} · verified /briefings events ${views.n}`);
}
await c.end();
