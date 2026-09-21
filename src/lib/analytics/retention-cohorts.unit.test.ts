/**
 * Guards for the retention-cohort arithmetic.
 *
 * These are BEHAVIOURAL tests: each one asserts a NUMBER that a specific bug would change. The bugs
 * they guard against all produce plausible output — a circular cohort still returns a tidy
 * percentage, a polluted denominator still renders — which is why "it compiles" and "the endpoint
 * returned 200" cannot catch any of them.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProfiles,
  classifyDay0,
  retentionAt,
  compositionDrift,
  activityShape,
  minimumDetectableCohort,
  findUnmappedBehaviourTokens,
  dayKey,
  MIN_REPORTABLE_COHORT,
  PRODUCT_REGIME_BOUNDARY,
  SAVE_LAUNCH_DATE,
  REGIME_LABELS,
  regimeBand,
  saveBandStarted,
  COMPOSITION_DRIFT_LIMIT,
  SAVE_ACTIONS,
  WATCH_ACTIONS,
  CLAIM_ACTIONS,
  type RetentionEvent,
  type FirstSeenMap,
  type UserProfile,
} from './retention-cohorts';

const DAY = 86_400_000;
/** A fixed "now" so no test depends on the wall clock. */
const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const daysAgo = (n: number) => NOW - n * DAY;

function ev(user: string, ts: number, action: string | null, source = 'opportunity_map', type = 'tool_use'): RetentionEvent {
  return { user, ts, action, source, type };
}

describe('dayKey', () => {
  it('buckets by UTC calendar day', () => {
    expect(dayKey(Date.parse('2026-09-21T23:59:59Z'))).toBe('2026-09-21');
    expect(dayKey(Date.parse('2026-09-22T00:00:01Z'))).toBe('2026-09-22');
  });
});

describe('TRAP 1 — reverse causality: cohorts come from DAY 0 ONLY', () => {
  // The headline claim of the whole batch is "savers return more". If a save made on day 40 counts
  // toward the day-0 cohort, the claim is circular: returning is what GAVE them the chance to save.
  it('a save made AFTER day 0 does not make the user a day-0 saver', () => {
    const u = 'anon:aaaaaaaa-0000-4000-8000-000000000001';
    const first = daysAgo(10);
    const firstSeen: FirstSeenMap = { [u]: first };
    const events = [
      ev(u, first, 'listing_open'),
      ev(u, first + 5 * DAY, 'shortlist_saved'), // day 5 — must NOT count
    ];
    const { profiles } = buildProfiles(events, firstSeen);
    const p = profiles.get(u)!;
    expect(p.day0Saves).toBe(0);
    expect(p.day0ListingOpens).toBe(1);
    expect([...classifyDay0(p)]).toContain('opened_no_save');
    expect([...classifyDay0(p)]).not.toContain('saver');
  });

  it('cohort assignment is IDENTICAL with and without the later events present', () => {
    // The formal statement of the firewall: future behaviour cannot reach back and reclassify.
    const u = 'anon:aaaaaaaa-0000-4000-8000-000000000002';
    const first = daysAgo(10);
    const firstSeen: FirstSeenMap = { [u]: first };
    const day0Only = [ev(u, first, 'listing_open'), ev(u, first + 60_000, 'listing_open'), ev(u, first + 120_000, 'listing_open')];
    const withFuture = [...day0Only, ev(u, first + 3 * DAY, 'shortlist_saved'), ev(u, first + 4 * DAY, 'listing_open')];

    const a = classifyDay0(buildProfiles(day0Only, firstSeen).profiles.get(u)!);
    const b = classifyDay0(buildProfiles(withFuture, firstSeen).profiles.get(u)!);
    expect([...a].sort()).toEqual([...b].sort());
    expect([...a]).toContain('heavy_browser');
  });

  it('counts 3 day-0 opens as heavy and 2 as light', () => {
    const mk = (id: string, opens: number) => {
      const first = daysAgo(10);
      // Every user arrives with a map_view; the opens are what varies. A user with NO events at
      // all is not profiled at all (nothing to classify), so the baseline event matters.
      const events = [
        ev(id, first, 'map_view', 'opportunity_map', 'page_view'),
        ...Array.from({ length: opens }, (_, i) => ev(id, first + (i + 1) * 1000, 'listing_open')),
      ];
      return buildProfiles(events, { [id]: first }).profiles.get(id)!;
    };
    expect([...classifyDay0(mk('a', 3))]).toContain('heavy_browser');
    expect([...classifyDay0(mk('b', 2))]).toContain('light_browser');
    expect([...classifyDay0(mk('c', 0))]).toContain('no_browse');
  });

  it('browsing depth counts DISTINCT listings — re-opening one listing is not a heavy browser', () => {
    // ~32% of live listing_open events are re-opens of something already seen, so counting raw
    // events promotes a user who read one listing three times into the "heavy browser" arm.
    const u = 'anon:aaaaaaaa-0000-4000-8000-00000000000c';
    const first = daysAgo(10);
    const same = [0, 1, 2].map((i) => ({ ...ev(u, first + i * 1000, 'listing_open'), listingId: 'notice-A' }));
    const p = buildProfiles(same, { [u]: first }).profiles.get(u)!;
    expect(p.day0ListingOpenEvents).toBe(3);
    expect(p.day0ListingOpens).toBe(1);
    expect([...classifyDay0(p)]).toContain('light_browser');
    expect([...classifyDay0(p)]).not.toContain('heavy_browser');
  });

  it('three different listings IS a heavy browser', () => {
    const u = 'anon:aaaaaaaa-0000-4000-8000-00000000000d';
    const first = daysAgo(10);
    const three = ['A', 'B', 'C'].map((id, i) => ({ ...ev(u, first + i * 1000, 'listing_open'), listingId: `notice-${id}` }));
    expect([...classifyDay0(buildProfiles(three, { [u]: first }).profiles.get(u)!)]).toContain('heavy_browser');
  });

  it('an open with no notice_id still counts as exactly one listing', () => {
    // Never 0 (that would erase a real open) and never merged (that would collapse real listings).
    const u = 'anon:aaaaaaaa-0000-4000-8000-00000000000e';
    const first = daysAgo(10);
    const untagged = [0, 1, 2].map((i) => ev(u, first + i * 1000, 'open_details'));
    const p = buildProfiles(untagged, { [u]: first }).profiles.get(u)!;
    expect(p.day0ListingOpens).toBe(3);
  });

  it('listing_view is not an open — it is the page_view trailing one', () => {
    const u = 'anon:aaaaaaaa-0000-4000-8000-00000000000f';
    const first = daysAgo(10);
    const p = buildProfiles([
      { ...ev(u, first, 'listing_open'), listingId: 'notice-A' },
      { ...ev(u, first + 10, 'listing_view', 'opportunity_map', 'page_view'), listingId: 'notice-A' },
      { ...ev(u, first + 20, 'listing_view', 'opportunity_map', 'page_view'), listingId: 'notice-B' },
    ], { [u]: first }).profiles.get(u)!;
    expect(p.day0ListingOpens).toBe(1); // not 2, and not 3
  });

  it('the control arm requires a day-0 listing open — a never-browsed user is not "opened_no_save"', () => {
    // Otherwise "saver vs control" compares people who reached the save button against people who
    // never saw it, and the save gets credited with the entire difference in intent.
    const u = 'anon:aaaaaaaa-0000-4000-8000-000000000003';
    const first = daysAgo(10);
    const p = buildProfiles([ev(u, first, 'map_view', 'opportunity_map', 'page_view')], { [u]: first }).profiles.get(u)!;
    const c = classifyDay0(p);
    expect([...c]).not.toContain('opened_no_save');
    expect([...c]).not.toContain('saver');
    expect([...c]).toContain('no_browse');
  });
});

describe('TRAP 2 — no opportunity to return is not churn', () => {
  function cohortOf(firstSeenDaysAgo: number[], returners: Set<number>): UserProfile[] {
    const events: RetentionEvent[] = [];
    const firstSeen: FirstSeenMap = {};
    firstSeenDaysAgo.forEach((d, i) => {
      const u = `u${i}`;
      const first = daysAgo(d);
      firstSeen[u] = first;
      events.push(ev(u, first, 'listing_open'));
      if (returners.has(i)) events.push(ev(u, first + DAY, 'listing_open'));
    });
    return [...buildProfiles(events, firstSeen).profiles.values()];
  }

  it('excludes too-young users from the denominator and reports them separately', () => {
    // 40 users old enough for D7, 10 who first appeared 2 days ago. Half the eligible returned.
    const ages = [...Array(40).fill(20), ...Array(10).fill(2)];
    const returners = new Set(Array.from({ length: 20 }, (_, i) => i));
    const cell = retentionAt(cohortOf(ages, returners), 7, NOW);
    expect(cell.denominator).toBe(40);      // NOT 50
    expect(cell.notYetEligible).toBe(10);
    expect(cell.returned).toBe(20);
    expect(cell.rate).toBe(50);             // 20/40, not 20/50 = 40%
  });

  it('rate is NULL, never 0, when nobody is eligible yet', () => {
    const cell = retentionAt(cohortOf(Array(50).fill(1), new Set()), 7, NOW);
    expect(cell.denominator).toBe(0);
    expect(cell.notYetEligible).toBe(50);
    expect(cell.rate).toBeNull();           // a fabricated 0% here would read as "nobody comes back"
  });

  it('rate is NULL below MIN_REPORTABLE_COHORT while the raw counts stay real', () => {
    const n = MIN_REPORTABLE_COHORT - 1;
    const cell = retentionAt(cohortOf(Array(n).fill(20), new Set([0, 1])), 7, NOW);
    expect(cell.denominator).toBe(n);
    expect(cell.returned).toBe(2);
    expect(cell.reportable).toBe(false);
    expect(cell.rate).toBeNull();           // "2 of 29 = 6.9%" is noise dressed as a measurement
  });

  it('DN is cumulative and bounded: a return on day 5 counts for D7 but not for D3', () => {
    const u = 'u';
    const first = daysAgo(20);
    const profiles = [...buildProfiles(
      [ev(u, first, 'listing_open'), ev(u, first + 5 * DAY, 'listing_open')],
      { [u]: first },
    ).profiles.values()];
    expect(retentionAt(profiles, 7, NOW).returned).toBe(1);
    expect(retentionAt(profiles, 3, NOW).returned).toBe(0);
  });

  it('activity on day 0 alone is not a return', () => {
    const u = 'u';
    const first = daysAgo(20);
    const profiles = [...buildProfiles(
      [ev(u, first, 'listing_open'), ev(u, first + 3600_000, 'listing_open')],
      { [u]: first },
    ).profiles.values()];
    expect(retentionAt(profiles, 7, NOW).returned).toBe(0);
  });
});

describe('TRAP 3 — composition drift makes the fake D30 visible', () => {
  function mixedCohort(mapUsers: number, emailUsers: number, ageDays: number, startIdx: number): { events: RetentionEvent[]; firstSeen: FirstSeenMap } {
    const events: RetentionEvent[] = [];
    const firstSeen: FirstSeenMap = {};
    let i = startIdx;
    for (let k = 0; k < mapUsers; k++, i++) {
      const u = `u${i}`; const f = daysAgo(ageDays); firstSeen[u] = f;
      events.push(ev(u, f, 'listing_open', 'opportunity_map', 'tool_use'));
    }
    for (let k = 0; k < emailUsers; k++, i++) {
      const u = `u${i}`; const f = daysAgo(ageDays); firstSeen[u] = f;
      events.push(ev(u, f, null, 'daily_alert', 'link_click'));
    }
    return { events, firstSeen };
  }

  it('flags a DN whose denominator is a different population from D1s', () => {
    // Exactly the live shape: the D1 denominator is almost all Map, the D30 denominator almost all
    // email, because only long-tenured email subscribers are old enough to be in it.
    const young = mixedCohort(100, 0, 3, 0);   // in D1's denominator, not D30's
    const old = mixedCohort(0, 100, 40, 1000); // in both
    const events = [...young.events, ...old.events];
    const firstSeen = { ...young.firstSeen, ...old.firstSeen };
    const profiles = [...buildProfiles(events, firstSeen).profiles.values()];

    const d1 = retentionAt(profiles, 1, NOW);
    const d30 = retentionAt(profiles, 30, NOW);
    expect(d1.denominator).toBe(200);
    expect(d30.denominator).toBe(100);        // only the old email cohort
    expect(d1.mix.map).toBe(50);
    expect(d30.mix.map).toBe(0);
    expect(d30.mix.email).toBe(100);

    const drift = compositionDrift([d1, d30]);
    expect(drift.get(1)!.comparableToD1).toBe(true);
    expect(drift.get(30)!.driftPp).toBeGreaterThan(COMPOSITION_DRIFT_LIMIT);
    expect(drift.get(30)!.comparableToD1).toBe(false); // the whole point: do not draw a curve here
  });

  it('a stable population stays comparable across horizons', () => {
    const a = mixedCohort(60, 40, 40, 0);
    const profiles = [...buildProfiles(a.events, a.firstSeen).profiles.values()];
    const drift = compositionDrift([retentionAt(profiles, 1, NOW), retentionAt(profiles, 30, NOW)]);
    expect(drift.get(30)!.driftPp).toBe(0);
    expect(drift.get(30)!.comparableToD1).toBe(true);
  });

  it('an unmeasurable horizon is not comparable rather than silently 0 drift', () => {
    const a = mixedCohort(10, 0, 2, 0);
    const profiles = [...buildProfiles(a.events, a.firstSeen).profiles.values()];
    const drift = compositionDrift([retentionAt(profiles, 1, NOW), retentionAt(profiles, 30, NOW)]);
    expect(drift.get(30)!.driftPp).toBeNull();
    expect(drift.get(30)!.comparableToD1).toBe(false);
  });
});

describe('left-censoring: an unknown first-seen is excluded, never guessed', () => {
  it('reports users with no all-history first-seen instead of profiling them', () => {
    const known = 'anon:aaaaaaaa-0000-4000-8000-00000000000a';
    const unknown = 'anon:aaaaaaaa-0000-4000-8000-00000000000b';
    const { profiles, leftCensored } = buildProfiles(
      [ev(known, daysAgo(5), 'listing_open'), ev(unknown, daysAgo(5), 'listing_open')],
      { [known]: daysAgo(5) },
    );
    expect(profiles.has(known)).toBe(true);
    expect(profiles.has(unknown)).toBe(false);
    expect(leftCensored).toEqual([unknown]);
  });

  it('honours a first-seen that predates the loaded event window', () => {
    // The window-truncation bug: load 30 days, treat the earliest in-window row as day 0, and a
    // five-month-old user is reclassified by whatever they happened to do the day the window opened.
    const u = 'u';
    const trueFirst = daysAgo(150);
    const { profiles } = buildProfiles([ev(u, daysAgo(10), 'shortlist_saved')], { [u]: trueFirst });
    const p = profiles.get(u)!;
    expect(p.day0).toBe(dayKey(trueFirst));
    expect(p.day0Saves).toBe(0);            // the day-10 save is NOT a day-0 save
    expect(p.returnDays).toEqual([dayKey(daysAgo(10))]);
  });
});

describe('passive email opens are not returns', () => {
  it('ignores email_open but counts link_click as a real return', () => {
    const u1 = 'p1', u2 = 'p2';
    const f = daysAgo(20);
    const { profiles } = buildProfiles([
      ev(u1, f, null, 'daily_alert', 'link_click'),
      ev(u1, f + 2 * DAY, null, 'daily_alert', 'email_open'),   // pixel — not a visit
      ev(u2, f, null, 'daily_alert', 'link_click'),
      ev(u2, f + 2 * DAY, null, 'daily_alert', 'link_click'),   // a real return
    ], { [u1]: f, [u2]: f });
    expect(profiles.get(u1)!.returnDays).toEqual([]);
    expect(profiles.get(u2)!.returnDays).toHaveLength(1);
  });
});

describe('PRODUCT REGIME — 2026-08-23 (Maps + MCP + new homepage)', () => {
  it('puts a pre-launch cohort in its own band, never in the current one', () => {
    expect(regimeBand('2026-08-22')).toBe('pre_launch');
    expect(regimeBand('2026-08-23')).toBe('current'); // the boundary day IS the new product
    expect(regimeBand('2026-09-20')).toBe('current');
  });

  it('labels the pre-launch band as PRE-LAUNCH wherever it is printed', () => {
    // The rule: never quote a pre-2026-08-23 cohort as the current product's baseline unlabelled.
    expect(REGIME_LABELS.pre_launch).toContain('PRE-LAUNCH');
    expect(REGIME_LABELS.current).toContain('current product');
  });

  it('reports the save band as NOT YET STARTED while no save date is set', () => {
    // Anonymous saving is unreachable on main today. "Nobody saved" and "nobody COULD save" are
    // different facts; only one of them is about users, so the band must not render as 0.
    expect(SAVE_LAUNCH_DATE).toBeNull();
    expect(saveBandStarted()).toBe(false);
  });

  it('pins the boundary to the verified date', () => {
    // Anonymous telemetry's first event ever is 2026-08-22 — one day before launch. Moving this
    // constant silently re-bases every current-product number, so it is asserted, not assumed.
    expect(PRODUCT_REGIME_BOUNDARY).toBe('2026-08-23');
  });
});

describe('STRUCTURAL IMPOSSIBILITY — a window older than the apparatus', () => {
  function popOfAge(count: number, ageDays: number): UserProfile[] {
    const events: RetentionEvent[] = [];
    const firstSeen: FirstSeenMap = {};
    for (let i = 0; i < count; i++) {
      const u = `s${i}`; const f = daysAgo(ageDays); firstSeen[u] = f;
      events.push(ev(u, f, 'listing_open'));
    }
    return [...buildProfiles(events, firstSeen).profiles.values()];
  }

  it('refuses a D30 when the population has only 30 days of telemetry', () => {
    // The live case: anonymous telemetry began 2026-08-22, so a mature D30 cohort contains ZERO
    // anonymous users. Measured on production: 0. That is the apparatus being younger than the
    // question, not users failing to return.
    const cell = retentionAt(popOfAge(500, 30), 30, NOW);
    expect(cell.denominator).toBe(0);
    expect(cell.rate).toBeNull();
    expect(cell.unmeasurableReason).toBe('structural_history_too_short');
    expect(cell.daysOfHistory).toBe(30);
    expect(cell.daysRequired).toBe(31);
  });

  it('distinguishes structural impossibility from an ordinary not-yet-eligible cohort', () => {
    // 200 days of history, but this particular DN still has nobody old enough → a DIFFERENT reason.
    const cell = retentionAt(popOfAge(500, 200), 30, NOW);
    expect(cell.denominator).toBe(500);
    expect(cell.unmeasurableReason).toBe('none');
  });

  it('reports below_min_cohort separately from both', () => {
    const cell = retentionAt(popOfAge(5, 200), 7, NOW);
    expect(cell.denominator).toBe(5);
    expect(cell.rate).toBeNull();
    expect(cell.unmeasurableReason).toBe('below_min_cohort');
  });

  it('a measurable horizon over the SAME short-history population is still reported', () => {
    // 30 days of history cannot answer D30, but it answers D7 fine — the guard must be per-horizon,
    // not a blanket "this population is too young for anything".
    const cell = retentionAt(popOfAge(500, 30), 7, NOW);
    expect(cell.denominator).toBe(500);
    expect(cell.unmeasurableReason).toBe('none');
  });
});

describe('activityShape', () => {
  it('reports median active days, multi-day and one-day-only with explicit user counts', () => {
    const events: RetentionEvent[] = [];
    const firstSeen: FirstSeenMap = {};
    // 3 users: 1 active day, 3 active days, 5 active days — all first seen 10 days ago.
    [1, 3, 5].forEach((days, i) => {
      const u = `u${i}`; const f = daysAgo(10); firstSeen[u] = f;
      for (let d = 0; d < days; d++) events.push(ev(u, f + d * DAY, 'listing_open'));
    });
    const shape = activityShape([...buildProfiles(events, firstSeen).profiles.values()], NOW);
    expect(shape.users).toBe(3);
    expect(shape.medianActiveDays).toBe(3);
    expect(shape.multiDayUsers).toBe(2);
    expect(shape.oneDayOnlyUsers).toBe(1);
    // tenure = 11 days; 5/11 < 0.5 and 3/11 < 0.5 → nobody is near-daily
    expect(shape.nearDailyUsers).toBe(0);
  });

  it('never divides by a zero tenure for a same-day user', () => {
    const u = 'u'; const f = NOW - 3600_000;
    const shape = activityShape([...buildProfiles([ev(u, f, 'listing_open')], { [u]: f }).profiles.values()], NOW);
    expect(Number.isFinite(shape.nearDailyRate!)).toBe(true);
    expect(shape.nearDailyUsers).toBe(1); // 1 active day of 1 day of opportunity
  });

  it('returns nulls, not zeros, for an empty user set', () => {
    const shape = activityShape([], NOW);
    expect(shape.users).toBe(0);
    expect(shape.medianActiveDays).toBeNull();
    expect(shape.multiDayRate).toBeNull();
  });
});

describe('minimumDetectableCohort', () => {
  it('sizes the saver cohort needed to call a 2x D7 lift', () => {
    // Live D7 for day-0 browsers is ~15%. Detecting 15% -> 30% needs ~121 per arm.
    expect(minimumDetectableCohort(0.15, 0.30)).toBe(121);
  });
  it('a subtler 1.5x lift needs several hundred per arm', () => {
    expect(minimumDetectableCohort(0.15, 0.225)).toBeGreaterThan(400);
  });
  it('an identical rate is never detectable', () => {
    expect(minimumDetectableCohort(0.15, 0.15)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('token drift guard', () => {
  it('shouts about a save-like action that is not in the vocabulary', () => {
    expect(findUnmappedBehaviourTokens(['listing_open', 'save_listing_v2', 'map_view']))
      .toEqual(['save_listing_v2']);
  });
  it('stays quiet for every token we already map, claims included', () => {
    const known = [...SAVE_ACTIONS, ...WATCH_ACTIONS, ...CLAIM_ACTIONS];
    expect(findUnmappedBehaviourTokens(known)).toEqual([]);
  });
  it('claim tokens are not saves', () => {
    for (const t of CLAIM_ACTIONS) expect(SAVE_ACTIONS.has(t)).toBe(false);
    expect(SAVE_ACTIONS.has('shortlist_saved')).toBe(true);
    expect(WATCH_ACTIONS.has('watch_created')).toBe(true);
  });
});
