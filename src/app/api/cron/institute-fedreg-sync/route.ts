/**
 * GET /api/cron/institute-fedreg-sync — the Federal Register Institute collector.
 *
 * The SECOND document source on the contract GAO proved. Same Institute store, same
 * resolver, same history, same four clocks. The one addition is the ADMISSION GATE,
 * because the FR publishes ~90 documents/day where GAO publishes a handful.
 *
 * ⚠️ FORWARD-ONLY. The FR exposes 10,000 historical documents; we never sweep them.
 * The window starts at the stored watermark (or ACTIVATION_FLOOR on first run) and
 * re-reads the watermark DAY rather than the instant after it — the FR publishes
 * many documents per day, so an exclusive cursor would silently drop anything that
 * landed after our last poll on that same date. Re-reading a day is free because
 * ingestion is idempotent on document_number.
 *
 * ⚠️ FAILURE SEMANTICS. A source failure must NEVER read as "0 relevant documents":
 *   fetch/HTTP failure  -> 502 pollOk:false  status:ingest_broken, watermark untouched
 *   malformed response  -> 502 feedMalformed status:ingest_broken (NOT quiet)
 *   unevaluable document-> counted as `unresolved`, never as `not_relevant`
 *   any unresolved      -> the zero is NOT reported as a clean zero
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ingestInstituteDocument } from '@/lib/institute/sources';
import {
  fetchFederalRegisterSince, decideAdmission, toInstituteDocument,
  type FederalRegisterApiItem,
} from '@/lib/institute/federal-register-source';
import { deriveFromInstituteSource } from '@/lib/strategic-intel/derive';
import { encodeGaoClocks, classifyGaoFreshness, type GaoClocks } from '@/lib/institute/source-clocks';
import CODES from '@/data/agency-toptier-codes.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE_KEY = 'institute_federal_register';
/** Activation boundary. Potato 3 begins prospectively; history is a separate decision. */
const ACTIVATION_FLOOR = '2026-09-11';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasSecret = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const { searchParams } = new URL(request.url);
  const hasPassword = Boolean(process.env.ADMIN_PASSWORD) && searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !hasPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') === 'preview' ? 'preview' : 'execute';
  const budgetMs = Number.parseInt(searchParams.get('budgetMs') || '240000', 10);
  const started = Date.now();
  const pollAt = new Date().toISOString();
  const db = sb();
  const names = Object.keys(CODES as Record<string, unknown>);

  // Window start: stored watermark, else the activation floor. Forward only.
  // Bind `error`: an unreadable registry row must not silently look like "no prior
  // watermark", which would restart the window at the activation floor every run.
  const { data: srcRow, error: srcErr } = await db.from('data_sources')
    // unranged-ok: single row by the unique key.
    .select('notes, last_built').eq('key', SOURCE_KEY).maybeSingle();
  if (srcErr) {
    return NextResponse.json({
      success: false, pollOk: false, status: 'unmeasured',
      reason: 'watermark_unreadable', error: srcErr.message,
      note: 'Could not read the stored watermark. Refusing to poll rather than silently restarting the window.',
    }, { status: 503 });
  }
  const priorWatermark = (() => {
    const m = (srcRow?.notes as string | undefined)?.match(/"lastSourceAdvance":"(\d{4}-\d{2}-\d{2})"/);
    return m?.[1] ?? null;
  })();
  const since = priorWatermark ?? ACTIVATION_FLOOR;

  // ── POLL ────────────────────────────────────────────────────────────────
  let items: FederalRegisterApiItem[] = [];
  try {
    items = await fetchFederalRegisterSince(since);
  } catch (e) {
    return NextResponse.json({
      success: false, pollOk: false, status: 'ingest_broken',
      reason: 'source_fetch_failed', error: e instanceof Error ? e.message : String(e),
      documentsSeen: null, admitted: 0, notRelevant: 0, unresolved: 0,
      sourceWatermark: null,
      note: 'Source fetch failed. This is NOT "0 relevant documents" and NOT a quiet upstream.',
    }, { status: 502 });
  }

  if (items.length === 0) {
    // The FR publishes every business day; an empty window since `since` means the
    // response shape changed or the query is wrong — not that nothing was published.
    return NextResponse.json({
      success: false, pollOk: true, feedMalformed: true, status: 'ingest_broken',
      reason: 'zero_documents_since_watermark', since,
      documentsSeen: 0, admitted: 0, notRelevant: 0, unresolved: 0, sourceWatermark: null,
      note: 'The Federal Register publishes on every business day, so an empty window is a query/shape failure, not a quiet upstream.',
    }, { status: 502 });
  }

  const sourceWatermark = items.map((i) => i.publication_date).filter(Boolean).sort().at(-1) as string ?? null;

  if (mode === 'preview') {
    const t = { admitted: 0, not_relevant: 0, unresolved: 0 };
    for (const i of items) t[decideAdmission(i).outcome] += 1;
    return NextResponse.json({ success: true, mode, pollOk: true, since, documentsSeen: items.length, sourceWatermark, ...t, note: 'preview — nothing written' });
  }

  // ── ADMISSION + INGEST + DERIVATION ─────────────────────────────────────
  let admitted = 0, notRelevant = 0, unresolved = 0;
  let inserted = 0, alreadyHeld = 0, resolvedAgency = 0, unresolvedAgency = 0;
  let painPointsCreated = 0, evidenceOnly = 0, blocked = 0, failed = 0;
  let processed = 0, partial = false;
  const categories: Record<string, number> = {};

  for (const item of items) {
    if (Date.now() - started > budgetMs) { partial = true; break; }
    processed++;
    const decision = decideAdmission(item);
    categories[decision.category] = (categories[decision.category] ?? 0) + 1;

    if (decision.outcome === 'unresolved') { unresolved++; continue; }
    if (decision.outcome === 'not_relevant') { notRelevant++; continue; }

    admitted++;
    const doc = toInstituteDocument(item, sourceWatermark);
    const ing = await ingestInstituteDocument(db, doc, names);
    if (ing.error) { failed++; continue; }
    if (ing.inserted) inserted++; else alreadyHeld++;
    if (ing.resolution.resolved) resolvedAgency++; else unresolvedAgency++;

    const der = await deriveFromInstituteSource(db, {
      instituteSourceId: ing.instituteSourceId,
      documentNumber: doc.documentNumber, title: doc.title, url: doc.url,
      resolution: ing.resolution,
    });
    if (der.outcome === 'pain_point_created') painPointsCreated++;
    else if (der.outcome === 'blocked_history_unavailable') blocked++;
    else if (der.outcome.startsWith('evidence_only')) evidenceOnly++;
  }

  // ── FOUR CLOCKS ─────────────────────────────────────────────────────────
  const { data: newestIngest } = await db.from('institute_sources')
    .select('discovered_at').eq('source_type', 'federal_register')
    .order('discovered_at', { ascending: false }).limit(1).maybeSingle();
  const { data: newestChange } = await db.from('intelligence_changes')
    .select('changed_at').order('changed_at', { ascending: false }).limit(1).maybeSingle();

  const clocks: GaoClocks = {
    lastPoll: pollAt,
    lastSourceAdvance: sourceWatermark,
    lastIntelligenceChange: (newestChange?.changed_at as string) ?? null,
  };
  const lastInstituteIngest = (newestIngest?.discovered_at as string) ?? null;

  // A partial/failed/unresolved-bearing run must not stamp a clean success.
  const stampable = !partial && failed === 0 && blocked === 0 && unresolved === 0;
  if (stampable) {
    await db.from('data_sources').upsert({
      key: SOURCE_KEY,
      name: 'Mindy Institute — Federal Register',
      category: 'built_curated',
      built_from: 'federalregister.gov API v1',
      refresh_cadence: 'daily',
      last_built: pollAt.slice(0, 10),
      is_active: true,
      notes: encodeGaoClocks((srcRow?.notes as string) ?? 'Mindy Institute — Federal Register corpus. Forward-only from the activation boundary; the 10,000-document history is a separate decision. Admission gate required: the FR publishes ~90 docs/day.', clocks),
    }, { onConflict: 'key' });
  }

  const freshness = classifyGaoFreshness({ clocks, now: pollAt });
  const status = failed > 0 || blocked > 0 ? 'degraded'
    : unresolved > 0 ? 'partially_unmeasured'
    : inserted === 0 ? 'no_new_evidence'
    : 'advanced';

  return NextResponse.json({
    success: failed === 0 && blocked === 0,
    mode, pollOk: true, status, partial, since,
    documentsSeen: items.length, documentsProcessed: processed,
    admitted, notRelevant, unresolved, categories,
    evidenceInserted: inserted, alreadyHeld,
    resolvedAgency, unresolvedAgency,
    painPointsCreated, evidenceOnly, blockedNoHistory: blocked, failed,
    clocks: { ...clocks, lastInstituteIngest },
    freshness, clocksStamped: stampable,
    elapsedMs: Date.now() - started,
  });
}
