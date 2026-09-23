/**
 * POTETO — NDAA Legislative Intelligence Live. Read-only health invariant.
 *
 *   DISCOVER → CLASSIFY → INGEST → PROVENANCE → CORRECT → FRESHNESS → SCHEDULE
 *
 * The invariant is stronger than "the cron returned 200":
 *   Congress has NDAA documents Mindy should know about  ⇒  Mindy holds every one of them,
 *   with provenance and the correct legal status, on a legislation-specific clock.
 *
 * Congress truth is read DIRECTLY from api.congress.gov here (text versions + committee
 * reports per measure) — not through the collector's document builder — so a collector
 * defect cannot grade itself.
 *
 *   npx tsx --env-file=.env.local scripts/acceptance/poteto-ndaa-legislative-live.mts          # pre-activation checks
 *   npx tsx --env-file=.env.local scripts/acceptance/poteto-ndaa-legislative-live.mts --post   # + per-version legal status (after the first execute run on the new code)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSince } from '../../src/lib/institute/legislation-discovery';
import { versionCode, measureRole, fiscalYearFromTitle } from '../../src/lib/institute/legislation';
import { decodeLegislationClocks, classifyLegislationFreshness } from '../../src/lib/institute/legislation-clocks';

let pass = true;
const chk = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) pass = false; };
const POST = process.argv.includes('--post');
const KEY = process.env.CONGRESS_API_KEY || process.env.GOVINFO_API_KEY;
if (!KEY) throw new Error('no api.data.gov key');
const api = async (p: string) => {
  const r = await fetch(`https://api.congress.gov/v3/${p}${p.includes('?') ? '&' : '?'}format=json&api_key=${KEY}`);
  if (!r.ok) throw new Error(`congress ${r.status} ${p}`);
  return r.json() as Promise<Record<string, any>>;
};
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CONGRESS = 119;

// ── DISCOVER: the current and previous authorization vehicles, found dynamically ─
const disc = await discoverSince({ congress: CONGRESS, since: null, maxPages: 100, budgetMs: 200_000 });
chk('DISCOVER full-Congress scan is complete (coverage measured against the API total)', disc.pollOk && disc.coverage === 'complete',
  `${disc.scanned}/${disc.reportedTotal}`);
const vehicles = [...new Map(disc.matched.filter((m) => measureRole(m.title) === 'authorization_vehicle')
  .map((m) => [`${m.billType}${m.number}`, m])).values()];
const years = [...new Set(vehicles.map((v) => fiscalYearFromTitle(v.title)).filter((y): y is number => y != null))].sort();
const current = years.at(-1)!;
chk('DISCOVER finds authorization vehicles for at least two fiscal years (current + prior)', years.length >= 2, `FY ${years.join(', ')}`);

// ── CONGRESS TRUTH (direct API) ────────────────────────────────────────────────
type Expected = { id: string; kind: 'text' | 'report'; measure: string; date: string | null; becameLaw: boolean; code: string };
const expected: Expected[] = [];
const lawByMeasure = new Map<string, boolean>();
for (const v of vehicles) {
  const t = v.billType.toLowerCase();
  const bill = (await api(`bill/${CONGRESS}/${t}/${v.number}`)).bill;
  const law = Array.isArray(bill.laws) && bill.laws.length > 0;
  lawByMeasure.set(`${v.billType}${v.number}`, law);
  for (const tv of (await api(`bill/${CONGRESS}/${t}/${v.number}/text`)).textVersions ?? []) {
    const code = versionCode(String(tv.type ?? ''));
    expected.push({ id: `${CONGRESS}-${v.billType}${v.number}-${code}`, kind: 'text', measure: `${v.billType}${v.number}`, date: tv.date ? String(tv.date).slice(0, 10) : null, becameLaw: law, code });
  }
  // Reports are listed on the bill detail itself; the id comes from Congress's own URL.
  for (const cr of bill.committeeReports ?? []) {
    const m = String(cr.url ?? '').match(/committee-report\/(\d+)\/([A-Z]+)\/(\d+)/i);
    if (m) expected.push({ id: `${m[1]}-${m[2].toUpperCase()}-${m[3]}`, kind: 'report', measure: `${v.billType}${v.number}`, date: null, becameLaw: law, code: 'RPT' });
  }
}
console.log(`  Congress truth: ${vehicles.length} vehicles, ${expected.filter((e) => e.kind === 'text').length} text versions, ${expected.filter((e) => e.kind === 'report').length} committee reports`);

// ── HELD ────────────────────────────────────────────────────────────────────────
const { data: held, error } = await db.from('institute_sources')
  .select('source_type, document_number, source_url, publication_date, raw')
  .in('source_type', ['introduced_bill', 'enacted_law', 'committee_report']);
if (error) throw error;
const byId = new Map(held!.map((r: any) => [r.document_number, r]));

// ── INGEST: every Congress document is held ────────────────────────────────────
const missing = expected.filter((e) => !byId.has(e.id));
chk('INGEST every Congress text version + committee report of every vehicle is held', missing.length === 0,
  missing.length ? missing.map((m) => m.id).join(', ') : `${expected.length}/${expected.length}`);
const currentIds = expected.filter((e) => vehicles.some((v) => `${v.billType}${v.number}` === e.measure && fiscalYearFromTitle(v.title) === current));
chk(`INGEST the current FY${current} NDAA family is complete`, currentIds.every((e) => byId.has(e.id)), `${currentIds.filter((e) => byId.has(e.id)).length}/${currentIds.length}`);
chk('INGEST committee reports are held (the source_type CHECK admits them)', expected.filter((e) => e.kind === 'report').every((e) => byId.get(e.id)?.source_type === 'committee_report'));
const texts = held!.filter((r: any) => r.source_type !== 'committee_report');
chk('INGEST versions never collapse (one row per identity)', new Set(held!.map((r: any) => r.document_number)).size === held!.length);

// ── PROVENANCE ─────────────────────────────────────────────────────────────────
const lacking = texts.filter((r: any) => !(r.raw?.congress && r.raw?.billType && r.raw?.billNumber && r.raw?.chamber && r.raw?.versionCode && r.raw?.legislativeVersion && r.source_url && 'becameLaw' in (r.raw ?? {})));
chk('PROVENANCE every bill version carries congress, bill, chamber, version code/name, URL and law status', lacking.length === 0, lacking.map((r: any) => r.document_number).join(','));
const enactedRows = held!.filter((r: any) => r.source_type === 'enacted_law');
chk('PROVENANCE enacted_law rows exist only for measures Congress records as law, with a public-law number',
  enactedRows.every((r: any) => lawByMeasure.get(`${r.raw?.billType}${r.raw?.billNumber}`) !== false && r.raw?.lawNumber),
  enactedRows.map((r: any) => `${r.document_number}:${r.raw?.lawNumber}`).join(', '));

if (POST) {
  const wrong = texts.filter((r: any) => {
    const law = r.raw?.becameLaw === true;
    const s = r.raw?.lawStatusAtIngestion;
    if (!s) return true;
    if (!law) return s !== 'not_enacted';
    return ['PUBLIC-LAW', 'ENR'].includes(r.raw?.versionCode) ? s !== 'enacted' : s !== 'superseded_by_enactment';
  });
  chk('STATUS every version states its OWN legal weight (introduced text of an enacted bill is not law)', wrong.length === 0, wrong.map((r: any) => r.document_number).join(','));
  const amending = texts.filter((r: any) => r.raw?.measureRole === 'amends_prior_act');
  chk('STATUS amending bills never carry a fiscal year of their own', amending.every((r: any) => r.raw?.fiscalYear == null && r.raw?.amendsFiscalYear),
    `${amending.length} amending-bill versions`);
}
const s2296 = texts.filter((r: any) => /-S2296-/.test(r.document_number));
chk('STATUS S. 2296 is never represented as enacted law', s2296.length > 0 && s2296.every((r: any) => r.source_type !== 'enacted_law' && r.raw?.becameLaw === false));

// ── CORRECT: the historical FY2026 claims ──────────────────────────────────────
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corr = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ndaa-fy26-claim-corrections.json'), 'utf8'));
const pp = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/agency-pain-points.json'), 'utf8'));
const live = Object.values(pp.agencies as Record<string, { painPoints: string[] }>).flatMap((a) => a.painPoints).filter((p) => p.includes('FY2026 NDAA'));
chk('CORRECT all 45 historical claims preserved with classification + reason', corr.claims.length === 45 && corr.claims.every((c: any) => c.reason && c.original_claim));
chk('CORRECT every surviving FY2026 NDAA claim cites PL 119-60', live.length === 38 && live.every((p) => /\(enacted, PL 119-60 /.test(p)), `${live.length} live`);

// ── FRESHNESS: legislation's own clock, never GAO's ───────────────────────────
const { data: src } = await db.from('data_sources').select('notes').eq('key', 'institute_legislation').maybeSingle();
const clocks = decodeLegislationClocks((src?.notes as string) ?? null);
const fresh = classifyLegislationFreshness({ clocks });
chk('FRESHNESS legislation clocks exist and the weekly poll is not stale (≤15d)', !!clocks && fresh.status !== 'ingest_broken' && fresh.status !== 'unmeasured', JSON.stringify(fresh));
const newestHeld = texts.map((r: any) => r.publication_date).filter(Boolean).sort().at(-1);
const { data: gao } = await db.from('institute_sources').select('publication_date').eq('source_type', 'gao_report').order('publication_date', { ascending: false }).limit(1);
chk('FRESHNESS lastSourceAdvance is the newest LEGISLATIVE publication, not GAO\'s',
  !!clocks && clocks.lastSourceAdvance?.slice(0, 10) === newestHeld && clocks.lastSourceAdvance?.slice(0, 10) !== gao?.[0]?.publication_date,
  `legislation=${clocks?.lastSourceAdvance} newestHeld=${newestHeld} newestGAO=${gao?.[0]?.publication_date}`);
const newestCongress = expected.map((e) => e.date).filter(Boolean).sort().at(-1)!;
const lagDays = newestHeld ? Math.floor((Date.parse(newestCongress) - Date.parse(newestHeld)) / 86_400_000) : Infinity;
chk('FRESHNESS Mindy is not silently behind Congress (newest held ≥ newest published − 8d)', lagDays <= 8, `congress=${newestCongress} held=${newestHeld} lag=${lagDays}d`);

// ── SCHEDULE ───────────────────────────────────────────────────────────────────
const { data: job } = await db.from('cron_jobs').select('job_name, route, cron_expr, enabled').eq('job_name', 'institute-legislation-sync').maybeSingle();
chk('SCHEDULE weekly legislation job is enabled on the legislation route', !!job && String(job.enabled) === 'true' && /institute-legislation-sync/.test(job.route) && /^\d+ \d+ \* \* \d$/.test(job.cron_expr),
  job ? `${job.cron_expr} ${job.route}` : 'missing');

console.log(pass ? '\n✅ POTETO — NDAA Legislative Intelligence Live VERIFIED' : '\n❌ FAILED');
process.exit(pass ? 0 : 1);
