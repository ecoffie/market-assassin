/**
 * Shared Cyrus three-tool acceptance checker.
 * Used by local baseline and public MCP runners — one contract, fail-hard.
 *
 * Subject: Cyrus Management Solutions LLC · UEI N1N9JPDYHVC7
 */
export const CYRUS_UEI = 'N1N9JPDYHVC7';
export const CYRUS_COMPANY = 'Cyrus Management Solutions';

export type CyrusAssertion = {
  id: string;
  ok: boolean;
  detail: string;
};

export type CyrusAcceptanceResult = {
  ok: boolean;
  expected_uei: string;
  assertions: CyrusAssertion[];
  failures: CyrusAssertion[];
  /** Machine-readable flags for packets (true only when assertion ok). */
  flags: Record<string, boolean>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Normalize MCP/tool wrappers so history payload is the inner history object when present. */
export function normalizeHistoryPayload(historyToolResult: unknown): Record<string, unknown> {
  const root = asRecord(historyToolResult) ?? {};
  const inner = asRecord(root.history);
  return inner ?? root;
}

export function extractSamUei(sam: unknown): string | null {
  const root = asRecord(sam);
  if (!root) return null;
  const entity = asRecord(root.entity);
  const raw =
    (entity?.ueiSAM as string | undefined) ||
    (entity?.uei as string | undefined) ||
    (root.uei as string | undefined) ||
    null;
  return raw ? String(raw).trim().toUpperCase() : null;
}

export function extractSamHas8a(sam: unknown): boolean | null {
  const root = asRecord(sam);
  if (!root) return null;
  const entity = asRecord(root.entity);
  if (typeof entity?.has8a === 'boolean') return entity.has8a;
  if (typeof root.has8a === 'boolean') return root.has8a;
  return null;
}

function assert(id: string, ok: boolean, detail: string): CyrusAssertion {
  return { id, ok, detail };
}

/**
 * Assert identity, restored awards, counting grains, scope, and uncertainty semantics
 * across get_contractor_profile, lookup_sam_entity, and get_contractor_award_history.
 */
export function checkCyrusThreeToolAcceptance(input: {
  profile: unknown;
  sam: unknown;
  history: unknown;
  expectedUei?: string;
  /** When true, require profile recent_awards length > 0 if award_count > 0. Default true. */
  requireRestoredAwards?: boolean;
}): CyrusAcceptanceResult {
  const expectedUei = (input.expectedUei || CYRUS_UEI).toUpperCase();
  const requireRestored = input.requireRestoredAwards !== false;
  const profile = asRecord(input.profile) ?? {};
  const history = normalizeHistoryPayload(input.history);
  const company = asRecord(profile.company) ?? {};
  const summary = asRecord(history.summary) ?? {};
  const contractor = asRecord(history.contractor) ?? {};
  const match = asRecord(history.match) ?? {};
  const profileSa = asRecord(profile.historical_set_asides) ?? {};
  const historySa = asRecord(history.historical_set_asides) ?? {};
  const profileCoverage = asRecord(profile.coverage) ?? {};
  const historyCoverage = asRecord(history.coverage_timestamp) ?? {};
  const profileIngest = asRecord(profileCoverage.ingest) ?? {};
  const historyIngest = asRecord(historyCoverage.ingest) ?? {};
  const profileBases = asRecord(profile.counting_bases) ?? {};
  const historyBases = asRecord(history.counting_bases) ?? {};
  const profileScope = asRecord(profileSa.scope);
  const historyScope = asRecord(historySa.scope);

  const profileUei = String(company.uei || '').trim().toUpperCase() || null;
  const samUei = extractSamUei(input.sam);
  const samHas8a = extractSamHas8a(input.sam);
  const samEntity = asRecord(asRecord(input.sam)?.entity);
  const profileAwardCount = Number(company.award_count ?? 0);
  const historyAwardCount = Number(summary.awardCount ?? 0);
  const recentProfile = Array.isArray(profile.recent_awards) ? profile.recent_awards : [];
  const recentHistory = Array.isArray(history.recentAwards) ? history.recentAwards : [];
  const topAgencies = Array.isArray(profile.top_agencies)
    ? profile.top_agencies
    : Array.isArray(profile.topAgencies)
      ? profile.topAgencies
      : [];

  const zeroCells: Array<{ unused_vehicle?: boolean; classification?: string }> = [];
  const series = Array.isArray(history.series) ? history.series : [];
  for (const y of series) {
    const yr = asRecord(y);
    const breakdown = Array.isArray(yr?.agencyBreakdown) ? yr!.agencyBreakdown : [];
    for (const cell of breakdown) {
      const c = asRecord(cell);
      if (!c) continue;
      if (Number(c.amount) === 0 && Number(c.count) > 0) {
        zeroCells.push({
          unused_vehicle: c.unused_vehicle as boolean | undefined,
          classification: c.classification as string | undefined,
        });
      }
    }
  }

  const contributing = asRecord(profileSa.contributing_ueis_by_label) ?? {};
  const hasContributing = Object.values(contributing).some(
    (v) => Array.isArray(v) && v.length > 0,
  );
  const supporting = asRecord(profileSa.supporting_actions_by_label) ?? {};
  const hasSupporting = Object.values(supporting).some(
    (v) => Array.isArray(v) && v.length > 0,
  );

  const note = String(profileSa.note || '');
  const nullFirstNote = String(profileSa.null_first_positive_note || '');
  const freshnessNote = String(
    profileCoverage.freshness_note || historyCoverage.freshness_note || '',
  );

  const assertions: CyrusAssertion[] = [
    // —— Tool / payload presence ——
    assert(
      'profile_found',
      profile.found === true || profile.ok === true || Boolean(company.uei),
      `profile found/ok or company.uei present (found=${String(profile.found)} ok=${String(profile.ok)})`,
    ),
    assert(
      'sam_entity_present',
      Boolean(samEntity),
      samEntity ? 'SAM entity present' : 'SAM entity missing — tool error or miss',
    ),
    assert(
      'history_present',
      Boolean(historyAwardCount > 0 || recentHistory.length > 0 || history.success === true),
      `history payload present (awardCount=${historyAwardCount}, recent=${recentHistory.length})`,
    ),

    // —— Identity across three tools ——
    assert(
      'identity_profile_uei',
      profileUei === expectedUei,
      `profile UEI ${profileUei} === ${expectedUei}`,
    ),
    assert(
      'identity_sam_uei',
      samUei === expectedUei,
      `SAM UEI ${samUei} === ${expectedUei}`,
    ),
    assert(
      'identity_history_match',
      match.match_status === 'unique' || match.method === 'recipient_uei',
      `history match_status=${String(match.match_status)} method=${String(match.method)}`,
    ),
    assert(
      'identity_names_align',
      Boolean(company.name) &&
        Boolean(contractor.company) &&
        String(company.name).toUpperCase().includes('CYRUS') &&
        String(contractor.company).toUpperCase().includes('CYRUS'),
      `profile="${String(company.name)}" history="${String(contractor.company)}"`,
    ),

    // —— Restored awards (#1589 N1) ——
    assert(
      'restored_profile_awards',
      !requireRestored || profileAwardCount <= 0 || recentProfile.length > 0,
      `award_count=${profileAwardCount} recent_awards=${recentProfile.length} enrichment=${String(profile.enrichment_status)}`,
    ),
    assert(
      'restored_history_awards',
      !requireRestored || historyAwardCount <= 0 || recentHistory.length > 0,
      `history awardCount=${historyAwardCount} recentAwards=${recentHistory.length}`,
    ),
    assert(
      'award_counts_agree',
      profileAwardCount === historyAwardCount,
      `profile ${profileAwardCount} vs history ${historyAwardCount}`,
    ),

    // —— Counting grains ——
    assert(
      'counting_unique_awards',
      typeof profileBases.unique_awards === 'number' &&
        profileBases.unique_awards === profileAwardCount &&
        typeof historyBases.unique_awards === 'number' &&
        historyBases.unique_awards === historyAwardCount,
      `unique_awards profile=${String(profileBases.unique_awards)} history=${String(historyBases.unique_awards)}`,
    ),
    assert(
      'counting_fy_sum_grain',
      typeof profileBases.fiscal_year_award_count_sum === 'number' &&
        typeof historyBases.fiscal_year_award_count_sum === 'number' &&
        Number(profileBases.fiscal_year_award_count_sum) >= Number(profileBases.unique_awards),
      `FY-sum profile=${String(profileBases.fiscal_year_award_count_sum)} (>= unique)`,
    ),
    assert(
      'counting_recent_grain',
      profileBases.recent_grain === 'obligation_actions' &&
        historyBases.recent_grain === 'obligation_actions',
      `recent_grain profile=${String(profileBases.recent_grain)} history=${String(historyBases.recent_grain)}`,
    ),

    // —— Scope ——
    assert(
      'scope_profile_rollup',
      profileScope?.kind === 'profile_rollup' && typeof profileScope.uei_count === 'number',
      `profile set-aside scope=${JSON.stringify(profileScope)}`,
    ),
    assert(
      'scope_history_single_uei',
      historyScope?.kind === 'history_single_uei' && historyScope.uei_count === 1,
      `history set-aside scope=${JSON.stringify(historyScope)}`,
    ),

    // —— Freshness / uncertainty ——
    assert(
      'freshness_warehouse_max',
      Boolean(historyCoverage.warehouse_max_action_date) &&
        Boolean(profileCoverage.warehouse_max_action_date || profileCoverage.as_of),
      `warehouse_max history=${String(historyCoverage.warehouse_max_action_date)} profile=${String(profileCoverage.warehouse_max_action_date)}`,
    ),
    assert(
      'freshness_ingest_status',
      historyIngest.freshness_status != null &&
        historyIngest.freshness_status !== 'unknown' &&
        profileIngest.freshness_status != null &&
        profileIngest.freshness_status !== 'unknown',
      `ingest history=${String(historyIngest.freshness_status)} profile=${String(profileIngest.freshness_status)}`,
    ),
    assert(
      'freshness_note_three_clocks',
      /Three clocks|warehouse|ingest/i.test(freshnessNote) &&
        /does not establish complete|Missing evidence stays unknown|recent recipient action alone/i.test(
          freshnessNote,
        ),
      'freshness_note distinguishes clocks and refuses recipient-action-as-complete-coverage',
    ),
    assert(
      'coverage_complete_established_not_overclaim',
      // Flag may be true when clocks attached — note must still refuse over-read.
      freshnessNote.length > 0 &&
        !/this contractor.?s award history is exhaustive|corpus is complete for this recipient/i.test(
          freshnessNote,
        ),
      'coverage_complete_established must not claim recipient-exhaustive corpus',
    ),

    // —— Set-aside uncertainty ——
    assert(
      'set_aside_no_award_origin',
      !Object.prototype.hasOwnProperty.call(profileSa, 'award_origin_fy_by_label') &&
        !Object.prototype.hasOwnProperty.call(historySa, 'award_origin_fy_by_label'),
      'award_origin_fy_by_label absent',
    ),
    assert(
      'set_aside_denies_cert_graduation',
      /not.*certification|does not establish graduation|None of these fields is current SAM/i.test(
        note,
      ),
      'set-aside note denies certification/graduation',
    ),
    assert(
      'set_aside_null_first_positive_note',
      /does not prove every action was a deobligation/i.test(nullFirstNote),
      'null_first_positive_note present',
    ),
    assert(
      'set_aside_provenance',
      hasContributing && hasSupporting,
      `contributing=${hasContributing} supporting=${hasSupporting}`,
    ),
    assert(
      'set_aside_last_fy_deprecated',
      dig(profileSa, 'deprecated.last_fy_by_label.status') === 'deprecated',
      `deprecated marker=${String(dig(profileSa, 'deprecated.last_fy_by_label.status'))}`,
    ),

    // —— Agency / zero-dollar uncertainty ——
    assert(
      'agency_count_unavailable',
      topAgencies.length === 0 ||
        topAgencies.every((a) => {
          const row = asRecord(a);
          return row?.count === null && row?.count_unavailable === true;
        }),
      `top_agencies=${topAgencies.length} all count null+unavailable`,
    ),
    assert(
      'zero_dollar_not_unused_vehicle',
      zeroCells.every((c) => c.unused_vehicle === false),
      `zero cells=${zeroCells.length} all unused_vehicle=false`,
    ),

    // —— SAM current vs historical (explained dual source) ——
    assert(
      'sam_has8a_current_boolean',
      typeof samHas8a === 'boolean',
      `sam has8a=${String(samHas8a)} (current registration; historical set-asides are separate)`,
    ),
  ];

  const failures = assertions.filter((a) => !a.ok);
  const flags: Record<string, boolean> = {};
  for (const a of assertions) flags[a.id] = a.ok;

  return {
    ok: failures.length === 0,
    expected_uei: expectedUei,
    assertions,
    failures,
    flags,
  };
}

/** Throw with a concise multi-line message — runners should exit non-zero. */
export function assertCyrusAcceptanceOrThrow(
  result: CyrusAcceptanceResult,
  context = 'cyrus three-tool acceptance',
): void {
  if (result.ok) return;
  const lines = result.failures.map((f) => `  FAIL ${f.id}: ${f.detail}`);
  throw new Error(`${context} FAILED (${result.failures.length}):\n${lines.join('\n')}`);
}
