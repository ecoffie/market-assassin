// READ-ONLY latency of alternative query SHAPES for the 4 long paragraphs (no schema change). READ ONLY txn.
//  A current: 5 columns, one clause per concept x column
//  B 3 columns (title, description, sow_text)
//  C single read: MATERIALIZED CTE builds one lower-cased blob per open row, one clause per concept
//  J in-memory: matchesText over the open corpus already in JS (corpus.json)
import fs from 'fs';
import pg from 'pg';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MAPS_POLICY } from '@/lib/discovery/policy';
import { conceptRegexes, matchesText } from '@/lib/discovery/matcher';
const Q = [
  'We are a commercial cleaning company. We provide janitorial and custodial services for office buildings: daily cleaning, restroom sanitation, trash removal, floor care, carpet cleaning and window washing.',
  'We are a healthcare staffing firm. We place registered nurses, licensed practical nurses, nursing assistants and other clinical staff in hospitals, clinics and medical facilities.',
  'We are a mechanical contractor. We maintain, repair and replace HVAC systems: heating, ventilation and air conditioning equipment, chillers, boilers, air handlers, rooftop units and building controls.',
  'We are a construction contractor. We erect pre-engineered steel buildings and install and replace metal roofing systems, including standing seam roofs, wall panels and structural steel framing.',
];
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
function whereFor(plan: any, cols: string[], blob = false) {
  const cSql = (k: any) => { const { ci, cs } = conceptRegexes(k); const p: string[] = []; for (const col of blob ? ['blob'] : cols) { if (ci) p.push(`${col} ~* ${lit(ci)}`); if (cs) p.push(`${blob ? 'blob_cs' : col} ~ ${lit(cs)}`); } return `(${p.join(' OR ')})`; };
  return plan.matcher.alternatives.map((a: any) => {
    if (a.eligibility === 'any' && a.partnerRequired?.length) { const need = new Set(a.partnerRequired); const solo = a.eligible.filter((k: any) => !need.has(k.label)).map(cSql); const pr = a.eligible.filter((k: any) => need.has(k.label)); const pairs: string[] = []; for (let i = 0; i < pr.length; i++) for (let j = i + 1; j < pr.length; j++) pairs.push(`(${cSql(pr[i])} AND ${cSql(pr[j])})`); return `(${[...solo, ...pairs].join(' OR ')})`; }
    if (a.eligibility === 'any' || a.eligible.length === 1) return `(${a.eligible.map(cSql).join(' OR ')})`;
    return `(${a.eligible.map(cSql).join(' AND ')})`;
  }).join(' OR ');
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect(); await c.query('BEGIN READ ONLY'); await c.query("SET LOCAL statement_timeout = '30s'");
const corpus = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).rows;
const five = ['title', 'description', 'sow_text', 'department', 'solicitation_number'];
for (const q of Q) {
  const plan: any = buildDiscoveryPlan({ query: q } as any, MAPS_POLICY);
  const out: string[] = [];
  for (const [name, sql] of [
    ['A', `select count(*) from sam_opportunities where active and response_deadline > now() and (${whereFor(plan, five)})`],
    ['B', `select count(*) from sam_opportunities where active and response_deadline > now() and (${whereFor(plan, ['title', 'description', 'sow_text'])})`],
    ['C', `with o as materialized (select coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(sow_text,'')||' '||coalesce(department,'')||' '||coalesce(solicitation_number,'') as blob_cs from sam_opportunities where active and response_deadline > now()), b as materialized (select blob_cs, blob_cs as blob from o) select count(*) from b where ${whereFor(plan, five, true)}`],
  ] as const) {
    const t = Date.now(); const r = await c.query(sql); out.push(`${name} ${Date.now() - t}ms n=${r.rows[0].count}`);
  }
  const t = Date.now(); const n = corpus.filter((r: any) => matchesText(plan.matcher, five.map((k) => r[k]))).length; out.push(`J ${Date.now() - t}ms n=${n}`);
  console.log(q.slice(0, 34).padEnd(36), out.join(' | '));
}
await c.query('ROLLBACK'); await c.end();
