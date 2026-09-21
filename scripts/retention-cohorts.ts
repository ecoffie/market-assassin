#!/usr/bin/env npx tsx
/**
 * RETENTION COHORT REPORT — "do savers return more often?"
 *
 *   npm run retention:cohorts                 # 90-day event window, text report
 *   npm run retention:cohorts -- --days 30
 *   npm run retention:cohorts -- --json       # machine-readable
 *
 * READ-ONLY. Every statement is a SELECT; this script never writes.
 *
 * ── WHY A SCRIPT AND NOT A DASHBOARD ──
 * The question is "did the batch work?", asked a handful of times over a few weeks — not a number
 * anyone watches hourly. A dashboard for it would be a new always-on surface to maintain, and the
 * "Current priority order" in CLAUDE.md says to default to NO on new internal dashboards. The
 * arithmetic that actually needs defending lives in src/lib/analytics/retention-cohorts.ts behind
 * unit tests; this file is only the reader. The one dashboard change made alongside it is additive:
 * teaching /api/admin/map-funnel the two new save tokens it was blind to.
 *
 * ── THE READ ──
 * 1. TRUE all-history first-seen per user, from the WHOLE table (never the window). A window-derived
 *    first-seen pins every older user's day 0 to the window edge and silently reclassifies them.
 * 2. Events inside the window, for day-0 behaviour and return days.
 * 3. A token-drift check that FAILS the run if a save-like action exists in live data that the
 *    vocabulary does not map — because "no savers yet" and "the token got renamed" otherwise look
 *    identical, and one of them is a bug.
 */

import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildProfiles,
  classifyDay0,
  retentionAt,
  compositionDrift,
  activityShape,
  minimumDetectableCohort,
  findUnmappedBehaviourTokens,
  dayKey,
  COHORT_PAIRS,
  MIN_REPORTABLE_COHORT,
  SAVE_ACTIONS,
  WATCH_ACTIONS,
  type RetentionEvent,
  type FirstSeenMap,
  type UserProfile,
  type CohortKey,
  type RetentionCell,
  type AcquisitionSurface,
} from '../src/lib/analytics/retention-cohorts';

const HORIZONS = [1, 3, 7, 30];

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const days = (() => {
  const i = argv.indexOf('--days');
  const n = i >= 0 ? parseInt(argv[i + 1], 10) : 90;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 90;
})();

/** DATABASE_URL from .env.local. Never hardcoded — a plaintext prod password was committed once. */
function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const envPath = path.resolve(process.cwd(), '.env.local');
  const m = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)["']?$/m);
  if (!m) throw new Error('DATABASE_URL not found in environment or .env.local');
  return m[1];
}

function pct(n: number | null): string {
  return n == null ? '  —  ' : `${n.toFixed(1)}%`.padStart(6);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - days * 86_400_000).toISOString();

  // ── 1. Token drift check. Runs FIRST: if the vocabulary is stale every number below is wrong,
  //      and a wrong number that looks plausible is the failure mode this repo keeps paying for.
  const { rows: actionRows } = await client.query<{ action: string }>(
    `SELECT DISTINCT metadata->>'action' AS action
       FROM user_engagement
      WHERE created_at >= $1 AND metadata->>'action' IS NOT NULL`,
    [sinceIso],
  );
  const unmapped = findUnmappedBehaviourTokens(actionRows.map((r) => r.action));

  // ── 2. TRUE all-history first-seen. Excludes passive email_open so a subscriber's first-seen is
  //      the first time they DID something, not the first pixel their mail client fetched.
  const { rows: fsRows } = await client.query<{ user_email: string; first_seen: Date }>(
    `SELECT user_email, MIN(created_at) AS first_seen
       FROM user_engagement
      WHERE user_email IS NOT NULL AND user_email <> ''
        AND event_type IS DISTINCT FROM 'email_open'
      GROUP BY user_email`,
  );
  const firstSeen: FirstSeenMap = {};
  for (const r of fsRows) firstSeen[r.user_email] = r.first_seen.getTime();

  // ── 3. Events in the window.
  const { rows: evRows } = await client.query<{
    user_email: string; created_at: Date; event_source: string | null; event_type: string | null; action: string | null; listing_id: string | null;
  }>(
    `SELECT user_email, created_at, event_source, event_type,
            metadata->>'action' AS action, metadata->>'notice_id' AS listing_id
       FROM user_engagement
      WHERE created_at >= $1 AND user_email IS NOT NULL AND user_email <> ''
      ORDER BY created_at ASC`,
    [sinceIso],
  );
  const events: RetentionEvent[] = evRows.map((r) => ({
    user: r.user_email, ts: r.created_at.getTime(), source: r.event_source, type: r.event_type,
    action: r.action, listingId: r.listing_id,
  }));

  // ── 4. Ground truth for the saver population, straight from the TABLES.
  //      The event stream is best-effort (ad-blockers, closed tabs) so it is a FLOOR; the rows are
  //      the truth. When these disagree, the gap is the telemetry loss rate, not a retention fact.
  const { rows: [shortlistRow] } = await client.query<{ rows: string; owners: string }>(
    `SELECT count(*) AS rows, count(DISTINCT owner_anon_id) AS owners FROM anonymous_shortlist`,
  );
  const { rows: [watchRow] } = await client.query<{ rows: string; owners: string }>(
    `SELECT count(*) AS rows, count(DISTINCT user_email) AS owners
       FROM saved_searches WHERE user_email LIKE 'anon:%'`,
  );
  const { rows: [saveEvRow] } = await client.query<{ users: string; events: string }>(
    `SELECT count(DISTINCT user_email) AS users, count(*) AS events
       FROM user_engagement WHERE metadata->>'action' = ANY($1)`,
    [[...SAVE_ACTIONS]],
  );
  const { rows: [watchEvRow] } = await client.query<{ users: string; events: string }>(
    `SELECT count(DISTINCT user_email) AS users, count(*) AS events
       FROM user_engagement WHERE metadata->>'action' = ANY($1)`,
    [[...WATCH_ACTIONS]],
  );

  await client.end();

  // ── 5. Arithmetic (pure, unit-tested).
  const { profiles, leftCensored } = buildProfiles(events, firstSeen);
  const all = [...profiles.values()];
  const byCohort = new Map<CohortKey, UserProfile[]>();
  for (const p of all) {
    for (const k of classifyDay0(p)) {
      const list = byCohort.get(k); if (list) list.push(p); else byCohort.set(k, [p]);
    }
  }

  const overallCells = HORIZONS.map((n) => retentionAt(all, n, nowMs));
  const drift = compositionDrift(overallCells);
  const shape = activityShape(all, nowMs);

  // ── THE D30 FIX, not just the D30 WARNING ──
  // Flagging the blended D30 as non-comparable stops the wrong reading; it does not produce the
  // right one. Retention WITHIN one acquisition surface is comparable across horizons, because the
  // population no longer changes shape as N grows. So the curve people should actually read is the
  // per-segment one — and each segment carries its own denominators.
  const SEGMENTS: AcquisitionSurface[] = ['map', 'email', 'app'];
  const bySegment = SEGMENTS.map((seg) => {
    const users = all.filter((p) => p.acquisitionSurface === seg);
    return {
      segment: seg,
      users: users.length,
      horizons: HORIZONS.map((n) => retentionAt(users, n, nowMs)),
      activity: activityShape(users, nowMs),
    };
  });

  // Returning DAU for the most recent COMPLETE UTC day. Yesterday, not today: today is still being
  // written, so "today's DAU" always reads low and falling.
  const yesterday = dayKey(nowMs - 86_400_000);
  const activeYesterday = all.filter((p) => p.activeDays.has(yesterday));
  const returningYesterday = activeYesterday.filter((p) => p.day0 < yesterday).length;

  const cohortTable = COHORT_PAIRS.map((pair) => ({
    id: pair.id,
    label: pair.label,
    arms: pair.arms.map((arm) => {
      const users = byCohort.get(arm) ?? [];
      return {
        cohort: arm,
        day0Users: users.length,
        horizons: HORIZONS.map((n) => retentionAt(users, n, nowMs)),
        activity: activityShape(users, nowMs),
      };
    }),
  }));

  const saverArm = cohortTable.find((c) => c.id === 'save')!.arms[0];
  const saversMeasured = saverArm.day0Users;
  const needFor2x = minimumDetectableCohort(0.15, 0.30);
  const needFor1_5x = minimumDetectableCohort(0.15, 0.225);

  const payload = {
    generatedAt: new Date(nowMs).toISOString(),
    windowDays: days,
    eventsLoaded: events.length,
    usersProfiled: all.length,
    leftCensoredUsers: leftCensored.length,
    tokenDrift: { unmapped, ok: unmapped.length === 0 },
    groundTruth: {
      anonymousShortlistRows: Number(shortlistRow.rows),
      anonymousShortlistOwners: Number(shortlistRow.owners),
      anonymousWatchRows: Number(watchRow.rows),
      anonymousWatchOwners: Number(watchRow.owners),
      saveEventUsersAllTime: Number(saveEvRow.users),
      watchEventUsersAllTime: Number(watchEvRow.users),
    },
    overall: { horizons: overallCells, drift: [...drift.entries()].map(([n, d]) => ({ n, ...d })) },
    bySegment,
    activity: shape,
    dau: { day: yesterday, active: activeYesterday.length, returning: returningYesterday, new: activeYesterday.length - returningYesterday },
    cohorts: cohortTable,
    saverReadiness: {
      saversOnDay0: saversMeasured,
      minReportableCohort: MIN_REPORTABLE_COHORT,
      neededPerArmFor2xLift: needFor2x,
      neededPerArmFor1_5xLift: needFor1_5x,
      answerable: saversMeasured >= needFor2x,
    },
  };

  if (asJson) { console.log(JSON.stringify(payload, null, 2)); }
  else { renderText(payload, cohortTable, overallCells, drift, bySegment); }

  // A stale vocabulary is a hard failure, not a footnote: it makes "0 savers" unreadable.
  if (unmapped.length > 0) {
    console.error(`\n❌ TOKEN DRIFT — save/watch-like actions present in live data but not mapped: ${unmapped.join(', ')}`);
    console.error('   Add them to SAVE_ACTIONS / WATCH_ACTIONS in src/lib/analytics/retention-cohorts.ts.');
    process.exit(1);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderText(p: any, cohortTable: any[], overall: RetentionCell[], drift: Map<number, { driftPp: number | null; comparableToD1: boolean }>, bySegment: any[]) {
  const L = console.log;
  L('');
  L('════════════════════════════════════════════════════════════════════════');
  L('  RETENTION COHORT TRUTH — do savers return more often?');
  L(`  ${p.generatedAt}   window=${p.windowDays}d   events=${p.eventsLoaded.toLocaleString()}   users profiled=${p.usersProfiled.toLocaleString()}`);
  L('════════════════════════════════════════════════════════════════════════');

  L('\n── SAVER POPULATION (ground truth = the TABLES; events are a floor) ──');
  const g = p.groundTruth;
  L(`  anonymous_shortlist : ${g.anonymousShortlistRows} rows / ${g.anonymousShortlistOwners} distinct savers`);
  L(`  anon saved_searches : ${g.anonymousWatchRows} rows / ${g.anonymousWatchOwners} distinct watchers`);
  L(`  save events (all t) : ${g.saveEventUsersAllTime} distinct users`);
  L(`  watch events (all t): ${g.watchEventUsersAllTime} distinct users`);

  L('\n── OVERALL RETENTION (cumulative: returned at least once by day N) ──');
  L('  Each DN has its OWN denominator — only users old enough to have had the full N days.');
  L('');
  L('   N   denominator   returned     rate    not-yet-eligible   mix(map/email/app)   vs D1');
  for (const c of overall) {
    const d = drift.get(c.n)!;
    const cmp = c.n === 1 ? 'baseline' : d.driftPp == null ? 'unmeasurable' : d.comparableToD1 ? `ok (${d.driftPp}pp)` : `⚠ NOT COMPARABLE (${d.driftPp}pp)`;
    L(`  D${String(c.n).padEnd(2)}  ${String(c.denominator).padStart(9)}   ${String(c.returned).padStart(8)}   ${pct(c.rate)}   ${String(c.notYetEligible).padStart(16)}   ${`${c.mix.map}/${c.mix.email}/${c.mix.app}`.padStart(18)}   ${cmp}`);
  }

  L('\n── RETENTION BY ACQUISITION SURFACE (the COMPARABLE curve) ──');
  L('  Within one surface the population does not change shape as N grows, so these DN values');
  L('  CAN be read as a curve. The blended numbers above cannot.');
  L('');
  L('   segment   day-0 users      D1      D3      D7     D30     (returned/denominator)');
  for (const s of bySegment) {
    const rates = s.horizons.map((h: RetentionCell) => pct(h.rate)).join('  ');
    L(`   ${String(s.segment).padEnd(9)} ${String(s.users).padStart(11)}   ${rates}`);
    L(`   ${' '.repeat(9)} ${' '.repeat(11)}   ${s.horizons.map((h: RetentionCell) => `${h.returned}/${h.denominator}`).join('   ')}`);
  }

  L('\n── ACTIVITY SHAPE ──');
  const a = p.activity;
  L(`  users=${a.users}   median active days=${a.medianActiveDays ?? 'unmeasured'}`);
  L(`  multi-day (>=2 days) : ${a.multiDayUsers} of ${a.users} = ${pct(a.multiDayRate)}`);
  L(`  near-daily (>=50%)   : ${a.nearDailyUsers} of ${a.users} = ${pct(a.nearDailyRate)}`);
  L(`  one-day-only         : ${a.oneDayOnlyUsers} of ${a.users}`);
  L(`  DAU ${p.dau.day} (last complete UTC day): ${p.dau.active} active = ${p.dau.returning} returning + ${p.dau.new} new`);

  L('\n── COHORTS (assigned from DAY-0 BEHAVIOUR ONLY — never lifetime) ──');
  for (const pair of cohortTable) {
    L(`\n  ${pair.label}`);
    L('    cohort              day-0 users     D1      D3      D7     D30');
    for (const arm of pair.arms) {
      const r = arm.horizons.map((h: RetentionCell) => pct(h.rate)).join('  ');
      L(`    ${arm.cohort.padEnd(18)} ${String(arm.day0Users).padStart(11)}   ${r}`);
      const dn = arm.horizons.map((h: RetentionCell) => `${h.returned}/${h.denominator}`).join('   ');
      L(`    ${' '.repeat(18)} ${' '.repeat(11)}   ${dn}   <- returned/denominator`);
    }
  }

  L('\n── CAN THE SAVER QUESTION BE ANSWERED YET? ──');
  const s = p.saverReadiness;
  if (s.saversOnDay0 === 0) {
    L('  ❌ UNMEASURED — ZERO users saved on day 0 in this window.');
    L('     This is NOT "savers do not return". It is "no saver has existed long enough to observe".');
    L('     Do not report a saver retention number, in any direction, until the cohort exists.');
  } else if (!s.answerable) {
    L(`  ⚠️  UNDERPOWERED — ${s.saversOnDay0} day-0 savers.`);
    L(`     Need >= ${s.neededPerArmFor2xLift} per arm to detect a 2x D7 lift (15% -> 30%).`);
  } else {
    L(`  ✅ ${s.saversOnDay0} day-0 savers — powered for a 2x D7 lift.`);
  }
  L(`     floor for printing any rate at all : ${s.minReportableCohort} users`);
  L(`     to detect 2x   (D7 15% -> 30%)     : ${s.neededPerArmFor2xLift} per arm`);
  L(`     to detect 1.5x (D7 15% -> 22.5%)   : ${s.neededPerArmFor1_5xLift} per arm`);

  L('\n── STANDING CAVEATS (ceilings on meaning, not bugs) ──');
  L('  • anon:<uuid> is localStorage — not stable across devices/browsers/private windows.');
  L('  • Safari evicts script-writable storage after ~7 days, so anonymous D7/D30 is a FLOOR.');
  L('  • user_engagement is NEVER reconciled anon -> email: a visitor who signs up appears as TWO');
  L('    users, reading as churn for the first and acquisition for the second.');
  L('  • Save/watch events are browser-emitted best-effort; table rows > event counts is expected.');
  if (p.leftCensoredUsers > 0) L(`  • ${p.leftCensoredUsers} users excluded: no all-history first-seen (unknown, not assumed).`);
  L('');
}

main().catch((e) => { console.error('retention-cohorts failed:', e); process.exit(1); });
