// READ-ONLY. Query plan + latency for one long-paragraph Open predicate, text volume, indexes. Uses EXPLAIN (ANALYZE)
// on a SELECT inside a READ ONLY transaction with a 30 s local statement_timeout. Writes nothing.
import pg from 'pg';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MAPS_POLICY } from '@/lib/discovery/policy';
import { conceptRegexes } from '@/lib/discovery/matcher';
const q = process.argv[2] || 'We are a commercial cleaning company. We provide janitorial and custodial services for office buildings: daily cleaning, restroom sanitation, trash removal, floor care, carpet cleaning and window washing.';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('BEGIN READ ONLY'); await c.query("SET LOCAL statement_timeout = '30s'");
const sizes = await c.query(`select count(*) n, sum(octet_length(coalesce(title,''))) t, sum(octet_length(coalesce(description,''))) d, sum(octet_length(coalesce(sow_text,''))) s,
  percentile_disc(0.5) within group (order by octet_length(coalesce(sow_text,''))) s_med, max(octet_length(coalesce(sow_text,''))) s_max
  from sam_opportunities where active and response_deadline > now()`);
const allActive = await c.query(`select count(*) n, pg_size_pretty(pg_total_relation_size('sam_opportunities')) total, pg_size_pretty(pg_relation_size('sam_opportunities')) heap from sam_opportunities where active`);
const idx = await c.query(`select indexname, indexdef from pg_indexes where tablename='sam_opportunities' order by 1`);
const ext = await c.query(`select extname from pg_extension where extname in ('pg_trgm','unaccent')`);
const plan: any = buildDiscoveryPlan({ query: q } as any, MAPS_POLICY);
const cols = ['title', 'description', 'sow_text', 'department', 'solicitation_number'];
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const conceptSql = (k: any) => { const { ci, cs } = conceptRegexes(k); const p: string[] = []; for (const col of cols) { if (ci) p.push(`${col} ~* ${lit(ci)}`); if (cs) p.push(`${col} ~ ${lit(cs)}`); } return `(${p.join(' OR ')})`; };
const alts = plan.matcher.alternatives.map((a: any) => {
  if (a.eligibility === 'any' && a.partnerRequired?.length) { const need = new Set(a.partnerRequired); const solo = a.eligible.filter((k: any) => !need.has(k.label)).map(conceptSql); const pr = a.eligible.filter((k: any) => need.has(k.label)); const pairs: string[] = []; for (let i = 0; i < pr.length; i++) for (let j = i + 1; j < pr.length; j++) pairs.push(`(${conceptSql(pr[i])} AND ${conceptSql(pr[j])})`); return `(${[...solo, ...pairs].join(' OR ')})`; }
  if (a.eligibility === 'any' || a.eligible.length === 1) return `(${a.eligible.map(conceptSql).join(' OR ')})`;
  return `(${a.eligible.map(conceptSql).join(' AND ')})`;
});
const where = `active AND response_deadline > now() AND (${alts.join(' OR ')})`;
const clauses = (where.match(/ ~\*? /g) || []).length;
const t0 = Date.now();
const ex = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) select count(*) from sam_opportunities where ${where}`);
const ms = Date.now() - t0;
await c.query('ROLLBACK'); await c.end();
console.log(JSON.stringify({ open: sizes.rows[0], active: allActive.rows[0], extensions: ext.rows.map((r) => r.extname), indexes: idx.rows.map((r) => r.indexdef), clauses, wall_ms: ms }, null, 1));
console.log(ex.rows.map((r: any) => r['QUERY PLAN']).join('\n'));
