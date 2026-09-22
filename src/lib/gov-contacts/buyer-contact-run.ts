/**
 * Decision Makers — the SAM buyer-contact RUNNER.
 *
 * Owns Supabase, the concurrency lease, the durable checkpoint and the control-plane clocks.
 * All the algebra it depends on lives in `buyer-contact-source.ts` and is unit-tested without
 * a database.
 *
 * TWO LANES, ON PURPOSE:
 *   REFRESH  — notices touched in the last `refreshWindowDays`. This is what the source used
 *              to do exclusively, and doing ONLY this is why 50.8% of held rows had not been
 *              revisited in 90+ days.
 *   BACKFILL — a keyset drain over (created_at, notice_id) that advances a durable cursor, so
 *              history is traversed once and then stays traversed.
 *
 * Running refresh FIRST is deliberate: if the run is cut short by the wall-clock budget, the
 * lane that protects currently-live notices is the one that already ran.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOpsAlert } from '@/lib/ops-alert';
import { shouldSendAlert, fingerprint } from '@/lib/ops-alert-dedup';
import {
  DM_SOURCE_KEY, DM_LOCK_TOKEN, DM_ALERT_KEY,
  type BackfillCursor, type ContactRow, type LaneName, type RunStats, type SourceNotice,
  advanceCursor, classifyWrites, coverageReport, cursorIsAhead, dataAdvanced, decodeCursor,
  emptyStats, encodeCursor, evaluateSourceHealth, extractContactRows, mergeStats, runVerified,
  type CoverageReport, type HealthResult,
} from './buyer-contact-source';

/** Columns the source reads from a notice. Kept in one place so the two lanes cannot drift. */
const NOTICE_COLUMNS =
  'notice_id, solicitation_number, department, office, sub_tier, posted_date, created_at, points_of_contact';

/** Columns read back from federal_contacts to classify a write. Must cover MEANINGFUL_FIELDS. */
const HELD_COLUMNS =
  'source_row_key, contact_fullname, contact_title, contact_email, contact_phone, '
  + 'department_ind_agency, office, sub_tier, role_category, contact_kind, solicitation_number, posted_date';

/** PostgREST builds a URL per request; 200 keys per `in.()` stays well inside the limit. */
const HELD_LOOKUP_CHUNK = 200;

/** Days of silence after which the PRODUCER is presumed broken (it is scheduled daily). */
export const DM_CHECK_STALE_DAYS = 3;

export interface RunOptions {
  /** ZERO persistent writes: no contacts, no checkpoint, no lease, no clocks, no alert state. */
  dry?: boolean;
  pageSize?: number;
  /** Pages of the recent window to re-read per run. */
  refreshPages?: number;
  /** Pages of history to drain per run. */
  backfillPages?: number;
  refreshWindowDays?: number;
  /** Soft wall-clock budget; a lane stops at a page boundary rather than being killed. */
  budgetMs?: number;
  now?: Date;
}

export interface LaneResult {
  lane: LaneName;
  stats: RunStats;
  cursorBefore: string | null;
  cursorAfter: string | null;
  pagesRead: number;
  /** The lane reached the end of its range within this run. */
  exhausted: boolean;
  /** The lane stopped because the wall-clock budget ran out, not because it finished. */
  budgetExhausted: boolean;
}

export interface DecisionMakersRun {
  dry: boolean;
  lockAcquired: boolean;
  lanes: LaneResult[];
  stats: RunStats;
  coverage: CoverageReport | null;
  health: HealthResult | null;
  heldPopulation: number | null;
  upstreamPopulation: number | null;
  clocksWritten: Record<string, unknown>;
  alert: { fired: boolean; reason: string; deliveryOk: boolean | null } | null;
  durationMs: number;
  errors: string[];
}

// ───────────────────────── lease ─────────────────────────

const LEASE_LANE: LaneName = 'backfill';
const LEASE_TTL_MS = 10 * 60_000;

/**
 * Atomic acquire: ONE conditional UPDATE. The `.or()` is evaluated inside the same statement
 * that writes the owner, so two concurrent runs cannot both match — the second sees the
 * first's unexpired lease and gets nothing back.
 *
 * The receipt is read with `.maybeSingle()`, NOT by counting the returned array. `lane` is the
 * primary key, so this statement touches exactly one row and the receipt is a row-or-nothing
 * answer to "did I win the lease" — never a write TOTAL. (Counting a RETURNING payload is
 * unsafe in general because PostgREST caps it at 1,000 rows; that failure mode cannot arise
 * on a single-PK update, and expressing it this way keeps the distinction obvious.)
 */
async function acquireLease(sb: SupabaseClient, owner: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  const { data, error } = await sb
    .from('decision_makers_sync_state')
    .update({ lease_owner: owner, lease_expires_at: new Date(now.getTime() + LEASE_TTL_MS).toISOString() })
    .eq('lane', LEASE_LANE)
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${nowIso}`)
    .select('lane')
    .maybeSingle();
  if (error) throw new Error(`lease acquire failed: ${error.message}`);
  return data != null;
}

/** Release only OUR lease — never stomp a lease a later run legitimately acquired. */
async function releaseLease(sb: SupabaseClient, owner: string): Promise<void> {
  try {
    await sb
      .from('decision_makers_sync_state')
      .update({ lease_owner: null, lease_expires_at: null })
      .eq('lane', LEASE_LANE)
      .eq('lease_owner', owner);
  } catch {
    /* the TTL is the backstop */
  }
}

// ───────────────────────── eligibility ─────────────────────────

/**
 * The eligible universe: notices carrying at least one POC.
 *
 * `points_of_contact` is JSONB, so "has an element" is expressed as not-null AND not the
 * empty array — PostgREST cannot call jsonb_array_length in a filter. Verified against SQL
 * on 2026-09-14: this predicate selects 207,067 of 207,986 notices, the same figure
 * `jsonb_array_length(points_of_contact) > 0` returns.
 */
function eligible<T>(q: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).not('points_of_contact', 'is', null).neq('points_of_contact', '[]');
}

async function countEligible(sb: SupabaseClient): Promise<number> {
  const { count, error } = await eligible(
    sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }),
  );
  if (error) throw new Error(`eligible count failed: ${error.message}`);
  // A null count is UNKNOWN, never zero (Bug Prevention Rule #11).
  if (count == null) throw new Error('eligible count returned NULL — unknown, not zero');
  return count;
}

/**
 * Notices at or before the cursor — i.e. actually traversed by this source.
 *
 * Derived from the CURSOR, never from federal_contacts recency: a notice whose POCs are all
 * rejected by the quality filter leaves no row behind, so counting rows under-reports
 * traversal, and row `updated_at` measures the writer rather than the reader.
 */
async function countVisited(sb: SupabaseClient, cursor: BackfillCursor | null): Promise<number> {
  if (!cursor) return 0;
  const { count, error } = await eligible(
    sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }),
  ).or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},notice_id.lte.${cursor.noticeId})`);
  if (error) throw new Error(`visited count failed: ${error.message}`);
  if (count == null) throw new Error('visited count returned NULL — unknown, not zero');
  return count;
}

async function oldestUnvisited(sb: SupabaseClient, cursor: BackfillCursor | null): Promise<string | null> {
  let q = eligible(sb.from('sam_opportunities').select('created_at'));
  if (cursor) {
    q = q.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},notice_id.gt.${cursor.noticeId})`);
  }
  const { data, error } = await q.order('created_at', { ascending: true }).order('notice_id', { ascending: true }).limit(1);
  if (error) throw new Error(`oldest-unvisited failed: ${error.message}`);
  return data?.[0]?.created_at ?? null;
}

/**
 * HELD POPULATION — exactly the rows this source governs.
 *
 * NOT all 247,173 federal_contacts rows. The table also holds 82,017 frozen `sam_entities_pocs`
 * rows, which are VENDOR registrant POCs keyed `<UEI>::<role>` and carry a company rather
 * than a federal department — a different source entirely. This source owns the
 * notice-keyed families (`AllSamContacts` = the live default bucket, and
 * `sam_opportunities_pointOfContact` = the frozen 2026-05-28 importer that used the SAME
 * `<notice_id>::<idx>` key space and is therefore inside this source's universe, merely
 * unvisited since May).
 *
 * The exclusion is by source_table rather than key shape because the vendor family is the
 * only one that is not notice-keyed, and it names itself.
 */
async function countHeld(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from('federal_contacts')
    .select('id', { count: 'exact', head: true })
    .neq('source_table', 'sam_entities_pocs');
  if (error) throw new Error(`held count failed: ${error.message}`);
  if (count == null) throw new Error('held count returned NULL — unknown, not zero');
  return count;
}

/**
 * UPSTREAM POPULATION — POC slots that are candidates for extraction.
 *
 * Counted as SLOTS, not notices, so it is the same unit as `held_population` (contact rows)
 * and the deficit between them means something. The SQL lives in
 * `decision_makers_upstream_slots()` because PostgREST cannot express
 * `LATERAL jsonb_array_elements`.
 *
 * Returns null — UNMEASURED — if the oracle cannot be read. Never 0: a zero here would read
 * as "the upstream is empty" and mark a healthy source as fully ingested.
 */
async function countUpstreamSlots(sb: SupabaseClient): Promise<number | null> {
  const { data, error } = await sb.rpc('decision_makers_upstream_slots');
  if (error) return null;
  const n = typeof data === 'string' ? Number(data) : (data as number | null);
  return Number.isFinite(n) && n !== null ? Number(n) : null;
}

// ───────────────────────── the write path ─────────────────────────

async function loadHeld(sb: SupabaseClient, keys: string[]): Promise<Map<string, Partial<ContactRow>>> {
  const held = new Map<string, Partial<ContactRow>>();
  for (let i = 0; i < keys.length; i += HELD_LOOKUP_CHUNK) {
    const chunk = keys.slice(i, i + HELD_LOOKUP_CHUNK);
    const { data, error } = await sb.from('federal_contacts').select(HELD_COLUMNS).in('source_row_key', chunk);
    if (error) throw new Error(`held lookup failed: ${error.message}`);
    for (const r of (data || []) as Partial<ContactRow>[]) {
      if (r.source_row_key) held.set(r.source_row_key, r);
    }
  }
  return held;
}

/**
 * Write one batch and report what actually changed.
 *
 * Unchanged rows are NOT re-upserted. That is the whole point: it keeps `updated_at` meaning
 * "this row's content was touched" instead of "a sweep passed over it", which is what makes
 * `last_data_advance` a truthful clock rather than a restatement of "the cron ran".
 */
async function writeBatch(
  sb: SupabaseClient,
  rows: ContactRow[],
  dry: boolean,
  nowIso: string,
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };

  const held = await loadHeld(sb, rows.map((r) => r.source_row_key));
  const plan = classifyWrites(rows, held);
  const toWrite = [...plan.inserts, ...plan.updates];

  if (!dry && toWrite.length > 0) {
    const { error } = await sb
      .from('federal_contacts')
      .upsert(toWrite.map((r) => ({ ...r, updated_at: nowIso })), { onConflict: 'source_row_key', ignoreDuplicates: false });
    if (error) throw new Error(`contacts upsert failed: ${error.message}`);
  }

  return { inserted: plan.inserts.length, updated: plan.updates.length, unchanged: plan.unchangedCount };
}

async function processNotices(
  sb: SupabaseClient,
  notices: SourceNotice[],
  dry: boolean,
  nowIso: string,
  stats: RunStats,
): Promise<void> {
  const rows: ContactRow[] = [];
  for (const n of notices) {
    stats.noticesScanned++;
    try {
      const out = extractContactRows(n);
      stats.pocSlots += out.slots;
      stats.rejectedName += out.rejectedName;
      stats.rejectedNoContact += out.rejectedNoContact;
      stats.contactsExtracted += out.rows.length;
      rows.push(...out.rows);
    } catch {
      // A malformed points_of_contact payload is a PARSE failure, counted — never swallowed
      // into "0 contacts", which would be indistinguishable from a notice with no POCs.
      stats.parseFailures++;
    }
  }
  const w = await writeBatch(sb, rows, dry, nowIso);
  stats.inserted += w.inserted;
  stats.updated += w.updated;
  stats.unchanged += w.unchanged;
}

// ───────────────────────── lanes ─────────────────────────

async function runRefreshLane(
  sb: SupabaseClient, opts: Required<Pick<RunOptions, 'pageSize' | 'refreshPages' | 'refreshWindowDays'>>,
  dry: boolean, nowIso: string, now: Date, deadline: number,
): Promise<LaneResult> {
  const stats = emptyStats();
  const since = new Date(now.getTime() - opts.refreshWindowDays * 86_400_000).toISOString();
  let pagesRead = 0;
  let exhausted = false;
  let budgetExhausted = false;

  for (let p = 0; p < opts.refreshPages; p++) {
    if (Date.now() > deadline) { budgetExhausted = true; break; }
    const from = p * opts.pageSize;
    const { data, error } = await eligible(sb.from('sam_opportunities').select(NOTICE_COLUMNS))
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .order('notice_id', { ascending: false })
      .range(from, from + opts.pageSize - 1);
    if (error) { stats.apiFailures++; break; }
    pagesRead++;
    const notices = (data || []) as SourceNotice[];
    if (notices.length === 0) { exhausted = true; break; }
    await processNotices(sb, notices, dry, nowIso, stats);
    if (notices.length < opts.pageSize) { exhausted = true; break; }
  }

  return { lane: 'refresh', stats, cursorBefore: null, cursorAfter: null, pagesRead, exhausted, budgetExhausted };
}

async function runBackfillLane(
  sb: SupabaseClient, start: BackfillCursor | null,
  opts: Required<Pick<RunOptions, 'pageSize' | 'backfillPages'>>,
  dry: boolean, nowIso: string, deadline: number,
): Promise<LaneResult> {
  const stats = emptyStats();
  let cursor = start;
  let pagesRead = 0;
  let exhausted = false;
  let budgetExhausted = false;

  for (let p = 0; p < opts.backfillPages; p++) {
    if (Date.now() > deadline) { budgetExhausted = true; break; }

    let q = eligible(sb.from('sam_opportunities').select(NOTICE_COLUMNS));
    if (cursor) {
      q = q.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},notice_id.gt.${cursor.noticeId})`);
    }
    const { data, error } = await q
      .order('created_at', { ascending: true })
      .order('notice_id', { ascending: true })
      .limit(opts.pageSize);

    // A FAILED page is not an empty page. Break WITHOUT advancing the cursor, so the next
    // run re-reads exactly this position instead of stepping over unread notices.
    if (error) { stats.apiFailures++; break; }
    pagesRead++;
    const notices = (data || []) as SourceNotice[];
    if (notices.length === 0) { exhausted = true; break; }

    // The cursor advances ONLY after the batch is durably written. A throw here leaves the
    // cursor where it was — the work is repeated (idempotent on source_row_key), never skipped.
    await processNotices(sb, notices, dry, nowIso, stats);
    cursor = advanceCursor(cursor, notices);

    if (notices.length < opts.pageSize) { exhausted = true; break; }
  }

  return {
    lane: 'backfill',
    stats,
    cursorBefore: start ? encodeCursor(start) : null,
    cursorAfter: cursor ? encodeCursor(cursor) : null,
    pagesRead,
    exhausted,
    budgetExhausted,
  };
}

// ───────────────────────── the run ─────────────────────────

export async function runDecisionMakersSync(sb: SupabaseClient, options: RunOptions = {}): Promise<DecisionMakersRun> {
  const started = Date.now();
  const dry = options.dry === true;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const pageSize = options.pageSize ?? 500;
  // The refresh lane must have capacity for its WHOLE window, or it silently covers only the
  // newest slice of what it claims to watch. Measured 2026-09-14 on the eligible corpus:
  // 1,599 notices updated in the last day, 4,806 in 3 days, 17,628 in 14 days. So a 3-day
  // window needs ~4,800 rows of capacity — 12 pages × 500 = 6,000 gives headroom, and 3 days
  // means the lane still catches up after a day or two of missed runs. A 14-day window with
  // 4 pages (the first cut of this design) would have covered 2,000 of 17,628 and quietly
  // degraded into the same head-only sweep this source is replacing.
  const refreshPages = options.refreshPages ?? 12;
  const backfillPages = options.backfillPages ?? 20;
  const refreshWindowDays = options.refreshWindowDays ?? 3;
  const deadline = started + (options.budgetMs ?? 210_000);
  const errors: string[] = [];
  const owner = `${DM_LOCK_TOKEN}:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}`;

  const out: DecisionMakersRun = {
    dry, lockAcquired: false, lanes: [], stats: emptyStats(),
    coverage: null, health: null, heldPopulation: null, upstreamPopulation: null,
    clocksWritten: {}, alert: null, durationMs: 0, errors,
  };

  // A dry run takes NO lease, because a lease is a persistent write. It is read-only, so
  // overlapping a real run is harmless — but it also cannot prove mutual exclusion, and the
  // report says so rather than implying it held the lock.
  if (!dry) {
    out.lockAcquired = await acquireLease(sb, owner, now);
    if (!out.lockAcquired) {
      out.durationMs = Date.now() - started;
      errors.push('another run holds the checkpoint lease — skipped');
      return out;
    }
  }

  try {
    const { data: stateRows, error: stateErr } = await sb
      .from('decision_makers_sync_state')
      .select('lane, cursor_created_at, cursor_notice_id, pass_completed_at, pass_number, notices_scanned, contacts_inserted, contacts_updated, contacts_unchanged');
    if (stateErr) throw new Error(`checkpoint read failed: ${stateErr.message}`);
    const backfillState = (stateRows || []).find((r) => r.lane === 'backfill');
    const startCursor = backfillState?.cursor_created_at && backfillState?.cursor_notice_id
      ? decodeCursor(`${backfillState.cursor_created_at}|${backfillState.cursor_notice_id}`)
      : null;

    // Refresh first: if the budget runs out, the lane protecting live notices already ran.
    const refresh = await runRefreshLane(sb, { pageSize, refreshPages, refreshWindowDays }, dry, nowIso, now, deadline);
    const backfill = await runBackfillLane(sb, startCursor, { pageSize, backfillPages }, dry, nowIso, deadline);
    out.lanes = [refresh, backfill];
    out.stats = mergeStats(refresh.stats, backfill.stats);

    const endCursor = decodeCursor(backfill.cursorAfter);
    const moved = cursorIsAhead(startCursor, endCursor);

    if (!dry) {
      const patch: Record<string, unknown> = {
        last_run_at: nowIso,
        updated_at: nowIso,
        notices_scanned: (backfillState?.notices_scanned ?? 0) + backfill.stats.noticesScanned,
        contacts_inserted: (backfillState?.contacts_inserted ?? 0) + backfill.stats.inserted,
        contacts_updated: (backfillState?.contacts_updated ?? 0) + backfill.stats.updated,
        contacts_unchanged: (backfillState?.contacts_unchanged ?? 0) + backfill.stats.unchanged,
        last_error: refresh.stats.apiFailures + backfill.stats.apiFailures > 0 ? 'page read failed' : null,
      };
      // Never move the cursor backwards, whatever a concurrent writer did.
      if (moved && endCursor) {
        patch.cursor_created_at = endCursor.createdAt;
        patch.cursor_notice_id = endCursor.noticeId;
      }
      // "Exhausted" is the END OF THE PASS, not "nothing to do" — recorded so a completed
      // drain is distinguishable from a lane that never started.
      if (backfill.exhausted) patch.pass_completed_at = nowIso;
      const { error } = await sb.from('decision_makers_sync_state').update(patch).eq('lane', 'backfill');
      if (error) errors.push(`checkpoint write failed: ${error.message}`);

      const { error: rErr } = await sb.from('decision_makers_sync_state').update({
        last_run_at: nowIso,
        updated_at: nowIso,
        notices_scanned: ((stateRows || []).find((r) => r.lane === 'refresh')?.notices_scanned ?? 0) + refresh.stats.noticesScanned,
        contacts_inserted: ((stateRows || []).find((r) => r.lane === 'refresh')?.contacts_inserted ?? 0) + refresh.stats.inserted,
        contacts_updated: ((stateRows || []).find((r) => r.lane === 'refresh')?.contacts_updated ?? 0) + refresh.stats.updated,
        contacts_unchanged: ((stateRows || []).find((r) => r.lane === 'refresh')?.contacts_unchanged ?? 0) + refresh.stats.unchanged,
      }).eq('lane', 'refresh');
      if (rErr) errors.push(`refresh checkpoint write failed: ${rErr.message}`);
    }

    // ── measurement ──
    // Coverage must describe what is PERSISTED, never what a run held in memory. A dry run
    // advances an in-memory cursor it deliberately does not save, so reporting from it would
    // overstate traversal by exactly the pages the rehearsal read — measured on production
    // 2026-09-15: a 1-page dry run reported 14.73% against a persisted 14.49%. Small, and
    // exactly the class of plausible-but-wrong number this source exists to eliminate.
    const cursorForCoverage = dry ? startCursor : (endCursor ?? startCursor);
    const eligibleNotices = await countEligible(sb);
    const visitedNotices = await countVisited(sb, cursorForCoverage);
    out.coverage = coverageReport({
      eligibleNotices,
      visitedNotices,
      oldestUnvisitedCreatedAt: await oldestUnvisited(sb, cursorForCoverage),
    });
    out.heldPopulation = await countHeld(sb);
    out.upstreamPopulation = await countUpstreamSlots(sb);

    // ── clocks ──
    const { data: inst, error: instErr } = await sb
      .from('data_source_instances')
      .select('last_successful_check, last_data_advance, last_verified_ingest')
      .eq('source_key', DM_SOURCE_KEY)
      .maybeSingle();
    if (instErr) errors.push(`instance read failed: ${instErr.message}`);

    const verified = runVerified(out.stats);
    const advanced = dataAdvanced(out.stats);

    // last_poll  — every real attempt.
    // last_successful_check / last_verified_ingest — only a run with zero swallowed failures;
    //   the ingest IS the check for this source (it reads and writes in one pass).
    // last_data_advance — ONLY when rows actually mutated. A completed run over an unchanged
    //   corpus must not fabricate advancement.
    // last_source_advance — NOT written here. This source is DERIVED from sam_opportunities;
    //   the upstream advance belongs to the SAM sync that feeds that table, and claiming it
    //   here would attribute another producer's freshness to this one.
    const clocks: Record<string, unknown> = { last_poll: nowIso };
    if (verified) { clocks.last_successful_check = nowIso; clocks.last_verified_ingest = nowIso; }
    if (advanced) clocks.last_data_advance = nowIso;
    clocks.held_population = out.heldPopulation;
    // UNMEASURED stays NULL rather than collapsing to 0.
    if (out.upstreamPopulation !== null) clocks.upstream_population = out.upstreamPopulation;

    const health = evaluateSourceHealth({
      lastSuccessfulCheck: verified ? nowIso : (inst?.last_successful_check ?? null),
      lastDataAdvance: advanced ? nowIso : (inst?.last_data_advance ?? null),
      now,
      checkStaleDays: DM_CHECK_STALE_DAYS,
      coverage: out.coverage,
    });
    out.health = health;
    clocks.source_state = health.state === 'ingest_stale' ? 'content_stale'
      : health.state === 'unmeasured' ? 'unmeasured'
      : 'current';

    if (!dry) {
      const { error } = await sb.from('data_source_instances').update(clocks).eq('source_key', DM_SOURCE_KEY);
      if (error) errors.push(`clock write failed: ${error.message}`);
      else out.clocksWritten = clocks;
    } else {
      out.clocksWritten = {};
    }

    // ── alerting ──
    //
    // SOURCE-SPECIFIC and on the OPS (Slack) path, not the generic email watchdog. The
    // generic one has been returning 502 since 2026-08-28 — in that route 502 means
    // "staleness detected AND the notification email failed", so the only monitor over this
    // corpus has been failing silently for weeks. Internal ops notifications moved off email
    // onto Slack in 2026-07; this one had not followed.
    //
    // shouldSendAlert dedupes on a fingerprint of the FINDING, so an unchanged stale
    // condition suppresses and a changed one re-fires. Alert DELIVERY is reported in the run
    // payload, so a failing alert path is itself visible rather than being the thing that
    // hides the failure.
    if (health.alert && !dry) {
      const print = fingerprint([health.state, health.checkAgeDays ?? 'never', out.coverage.remainingNotices]);
      const gate = await shouldSendAlert(sb, DM_ALERT_KEY, print);
      if (!gate.send) {
        out.alert = { fired: false, reason: `suppressed (${gate.reason})`, deliveryOk: null };
      } else {
        const res = await sendOpsAlert({
          subject: `Decision Makers source ${health.state}`,
          html: [
            `<p><b>${DM_SOURCE_KEY}</b> — ${health.reason}</p>`,
            `<ul>`,
            `<li>last verified check: ${health.checkAgeDays === null ? 'never' : `${health.checkAgeDays}d ago`}</li>`,
            `<li>last data advance: ${health.dataAgeDays === null ? 'never' : `${health.dataAgeDays}d ago`}</li>`,
            `<li>traversal: ${out.coverage.visitedNotices}/${out.coverage.eligibleNotices} notices (${out.coverage.percentVisited ?? 0}%)</li>`,
            `<li>held rows: ${out.heldPopulation} · upstream slots: ${out.upstreamPopulation ?? 'unmeasured'}</li>`,
            `</ul>`,
            `<p>Runbook: docs/runbooks/decision-makers-sam-contacts.md</p>`,
          ].join(''),
        });
        out.alert = { fired: true, reason: gate.reason, deliveryOk: res.ok };
        if (!res.ok) errors.push(`ops alert delivery failed: ${res.error ?? 'unknown'}`);
      }
    } else {
      out.alert = { fired: false, reason: health.alert ? 'dry run' : 'healthy', deliveryOk: null };
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    if (!dry && out.lockAcquired) await releaseLease(sb, owner);
    out.durationMs = Date.now() - started;
  }

  return out;
}
