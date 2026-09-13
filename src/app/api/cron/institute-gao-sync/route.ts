/**
 * GET /api/cron/institute-gao-sync — the scheduled Mindy Institute GAO collector.
 *
 * Runs the pipeline proven in Potato 1 (PR #1466):
 *   GAO RSS -> Institute source record -> canonical agency -> evidence retained
 *           -> optional defensible pain point -> immutable change history
 *
 * ⚠️ SCHEDULING MUST NOT WEAKEN THE INTEGRITY SEMANTICS. Four clocks stay distinct,
 * and every failure mode reports as ITSELF rather than as a quiet upstream:
 *
 *   pollOk=false          a fetch/HTTP failure. NEVER reported as "0 new reports".
 *   feedMalformed=true    fetched but unparseable. NOT upstream_quiet.
 *   sourceWatermark       ONLY advances from documents we actually parsed. A failed
 *                         fetch leaves it untouched.
 *   lastInstituteIngest   ONLY stamped when a row was really inserted.
 *   lastIntelligenceChange ONLY stamped when a claim really changed.
 *   partial=true          the budget ran out mid-feed — explicitly NOT "complete".
 *
 * The house rule this route was built under: deploy the route, curl prod for a real
 * 200 + JSON, THEN insert the cron_jobs row. Never the same push.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchGaoReports, ingestInstituteDocument } from '@/lib/institute/sources';
import { deriveFromInstituteSource } from '@/lib/strategic-intel/derive';
import { encodeGaoClocks, classifyGaoFreshness, type GaoClocks } from '@/lib/institute/source-clocks';
import CODES from '@/data/agency-toptier-codes.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE_KEY = 'institute_gao';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const { searchParams } = new URL(request.url);
  const hasPassword = Boolean(process.env.ADMIN_PASSWORD)
    && searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !hasPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') === 'preview' ? 'preview' : 'execute';
  const budgetMs = Number.parseInt(searchParams.get('budgetMs') || '240000', 10);
  const started = Date.now();
  const pollAt = new Date().toISOString();
  const db = sb();
  const names = Object.keys(CODES as Record<string, unknown>);

  // ── 1. POLL ──────────────────────────────────────────────────────────────
  // A fetch failure is a FAILURE, never an empty feed.
  let docs: Awaited<ReturnType<typeof fetchGaoReports>> = [];
  try {
    docs = await fetchGaoReports();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      success: false, pollOk: false, status: 'ingest_broken',
      reason: 'source_fetch_failed', error: message,
      documentsSeen: null, evidenceInserted: 0, intelligenceChanges: 0,
      sourceWatermark: null,   // explicitly NOT advanced
      note: 'Source fetch failed. This is NOT "0 new reports" and NOT upstream_quiet.',
    }, { status: 502 });
  }

  // Fetched but unparseable -> malformed, NOT quiet.
  if (docs.length === 0) {
    return NextResponse.json({
      success: false, pollOk: true, feedMalformed: true, status: 'ingest_broken',
      reason: 'feed_parsed_zero_documents',
      documentsSeen: 0, evidenceInserted: 0, intelligenceChanges: 0,
      sourceWatermark: null,
      note: 'The feed responded but yielded no parseable documents. A real GAO feed always carries items, so this is a parse/shape failure — not a quiet upstream.',
    }, { status: 502 });
  }

  // Watermark comes ONLY from documents we actually parsed.
  const sourceWatermark = docs.map((d) => d.publicationDate).filter(Boolean).sort().at(-1) ?? null;

  if (mode === 'preview') {
    return NextResponse.json({
      success: true, mode, pollOk: true, documentsSeen: docs.length, sourceWatermark,
      note: 'preview — nothing written',
    });
  }

  // ── 2. INSTITUTE INGEST + 3. DERIVATION ─────────────────────────────────
  let evidenceInserted = 0, alreadyHeld = 0, resolved = 0, unresolved = 0;
  let painPointsCreated = 0, evidenceOnly = 0, blocked = 0, failed = 0;
  let processed = 0, partial = false;

  for (const doc of docs) {
    if (Date.now() - started > budgetMs) { partial = true; break; }
    processed++;
    const ing = await ingestInstituteDocument(db, doc, names);
    if (ing.error) { failed++; continue; }
    if (ing.inserted) evidenceInserted++; else alreadyHeld++;
    if (ing.resolution.resolved) resolved++; else unresolved++;

    const der = await deriveFromInstituteSource(db, {
      instituteSourceId: ing.instituteSourceId,
      documentNumber: doc.documentNumber,
      title: doc.title,
      url: doc.url,
      resolution: ing.resolution,
    });
    if (der.outcome === 'pain_point_created') painPointsCreated++;
    else if (der.outcome === 'blocked_history_unavailable') blocked++;
    else if (der.outcome.startsWith('evidence_only')) evidenceOnly++;
  }

  // ── 4. FOUR CLOCKS — each advances ONLY on its own real event ───────────
  const { data: srcRow } = await db.from('data_sources')
    // unranged-ok: single row by the unique key.
    .select('notes').eq('key', SOURCE_KEY).maybeSingle();

  const { data: newestIngest } = await db.from('institute_sources')
    .select('discovered_at').order('discovered_at', { ascending: false }).limit(1).maybeSingle();
  const { data: newestChange } = await db.from('intelligence_changes')
    .select('changed_at').order('changed_at', { ascending: false }).limit(1).maybeSingle();

  const clocks: GaoClocks = {
    lastPoll: pollAt,                                   // always advances — we polled
    lastSourceAdvance: sourceWatermark,                 // only from parsed documents
    lastIntelligenceChange: (newestChange?.changed_at as string) ?? null,
  };
  const lastInstituteIngest = (newestIngest?.discovered_at as string) ?? null;

  // A failed/partial run must not stamp a clean success.
  const stampable = !partial && failed === 0 && blocked === 0;
  if (stampable) {
    const notes = encodeGaoClocks((srcRow?.notes as string) ?? null, clocks);
    await db.from('data_sources')
      .update({ last_built: pollAt.slice(0, 10), notes })
      .eq('key', SOURCE_KEY);
  }

  const freshness = classifyGaoFreshness({ clocks, now: pollAt });
  // A healthy poll that found nothing NEW is the expected steady state.
  const status = failed > 0 || blocked > 0 ? 'degraded'
    : evidenceInserted === 0 ? (freshness.status === 'upstream_quiet' ? 'upstream_quiet' : 'no_new_evidence')
    : 'advanced';

  return NextResponse.json({
    success: failed === 0 && blocked === 0,
    mode, pollOk: true, status, partial,
    documentsSeen: docs.length, documentsProcessed: processed,
    evidenceInserted, alreadyHeld, resolved, unresolved,
    painPointsCreated, evidenceOnly, blockedNoHistory: blocked, failed,
    clocks: { ...clocks, lastInstituteIngest },
    freshness,
    clocksStamped: stampable,
    elapsedMs: Date.now() - started,
  });
}
