/**
 * MCP tool: get_contractor_award_history — a named contractor's federal award
 * history: total obligations, award count, year-over-year trend, top agencies, top
 * NAICS, and recent awards. The "size up a competitor / teammate / incumbent" view.
 *
 * UEI path (authoritative when supplied): shared BigQuery/KV service
 * `getContractorHistoryByUei` — same aggregates as Map/in-app company detail.
 * Name path: the same award-warehouse name index as search_contractors. A unique
 * match is loaded by that UEI. Several matches are returned as candidates and
 * are not picked. A miss still runs the existence check (stem-normalized, so a
 * comma does not drop the safety net). A `recipient_name` label inside a UEI
 * history payload is how that payload was keyed after the UEI was known — it
 * is not evidence of how the company string was matched.
 *
 * credits: 10. `_meta` always ships; `_ai_hint` OFF by default.
 * Contact details are gated out here (publicView) — MCP is a data surface, not the
 * gated contacts product.
 */
import { getContractorSalesHistory, type ContractorSalesHistory } from '@/lib/contractor-sales-history';
import { establishAwardHistory, type AwardHistoryEvidence } from '@/lib/contractor/award-history-existence';
import { getContractorHistoryByUei } from '@/lib/contractor/history-by-uei';
import { resolveAwardCorpusByName, type AwardNameCandidate } from '@/lib/contractor/name-resolution';
import { buildCountingBases } from '@/lib/contractor/award-history-shape';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ContractorAwardHistoryToolInput {
  company?: string;
  /** When present (and well-formed), UEI is authoritative over company name. */
  uei?: string;
  award_limit?: number;
  /** MCP caller identity for the shared cold-BQ budget (`chat-bq:{actor}`). */
  actor?: string;
}

export interface ContractorAwardHistoryToolResult {
  queried: { company?: string; uei?: string };
  history: ContractorSalesHistory | null;
  candidates?: AwardNameCandidate[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    award_count: number;
    total_obligations: number;
    resolution?: string;
    /** Shared vocabulary with profile.resolution and SAM lookup_status. */
    match_status?: string;
    name_resolution?: string;
    match_count?: number;
    coverage?: {
      dataset: string;
      measure: string;
      scope: string;
      as_of: string | null;
      not_equivalent_to?: string;
    };
    source?: string | null;
    asOf?: string | null;
    as_of_meaning?: string;
    aggregates_cover?: string | null;
    cache?: string;
    enrichment_status?: 'complete' | 'budget_limited';
    partial?: boolean;
    counting_bases?: unknown;
    activity_status?: string;
    last_positive_obligation_fy?: number | null;
    award_history_elsewhere?: boolean;
    award_history_sources?: string[];
    note?: string;
  };
}

function clipRecent(history: ContractorSalesHistory, limit?: number): ContractorSalesHistory {
  if (!limit || !Array.isArray(history.recentAwards) || history.recentAwards.length <= limit) {
    return history;
  }
  const recentAwards = history.recentAwards.slice(0, limit);
  const next: ContractorSalesHistory & { counting_bases?: ReturnType<typeof buildCountingBases> } = {
    ...history,
    recentAwards,
  };
  if (next.counting_bases || (history as { counting_bases?: unknown }).counting_bases) {
    next.counting_bases = buildCountingBases({
      uniqueAwards: history.summary?.awardCount ?? 0,
      series: (history.series || []).map((y) => ({
        fiscalYear: y.fiscalYear,
        totalObligations: y.totalObligations,
        positiveObligations: y.positiveObligations,
        deobligations: y.deobligations,
        awardCount: y.awardCount,
      })),
      recentActions: recentAwards.map((r) => ({ awardId: r.id })),
    });
  }
  return next;
}

async function byUei(
  ueiRaw: string,
  actor: string | undefined,
  awardLimit?: number,
): Promise<ContractorAwardHistoryToolResult> {
  const uei = ueiRaw.trim().toUpperCase();
  if (!isWellFormedUei(uei)) {
    return {
      queried: { uei },
      history: null,
      _meta: {
        grounded: false,
        degraded: false,
        award_count: 0,
        total_obligations: 0,
        resolution: 'malformed',
        note: 'UEI must be exactly 12 alphanumeric characters',
      },
    };
  }

  const r = await getContractorHistoryByUei({
    uei,
    actor,
    coldPolicy: 'budgeted',
  });

  const history = r.history ? clipRecent(r.history, awardLimit) : null;
  const degraded = r.degraded || r.resolution === 'unavailable';
  const awardCount = history?.summary?.awardCount ?? 0;
  // found = grounded with awards; registered_zero = grounded identity, zero warehouse awards
  const grounded =
    r.resolution === 'found' ||
    (r.resolution === 'registered_zero' && !!history);

  // enrichment_status lives on history — keep a single copy in _meta for MCP
  // consumers that only read _meta (compat). Do not also echo partial twice
  // without the history object carrying the same truth.
  const enrichment = history?.enrichment_status;
  const matchStatus =
    r.resolution === 'found' || r.resolution === 'registered_zero'
      ? 'unique'
      : r.resolution;

  return {
    queried: { uei: r.uei },
    history,
    _meta: {
      grounded,
      degraded,
      award_count: awardCount,
      total_obligations: history?.summary?.totalObligations ?? 0,
      resolution: r.resolution,
      match_status: matchStatus,
      source: r.source,
      asOf: r.asOf,
      as_of_meaning:
        'Recipient last action_date in the warehouse profile — not the ingest run date.',
      aggregates_cover: r.aggregates_cover,
      cache: r.cache,
      ...(history && 'counting_bases' in history
        ? { counting_bases: (history as { counting_bases?: unknown }).counting_bases }
        : {}),
      ...(history?.summary?.activity_status
        ? {
            activity_status: history.summary.activity_status,
            last_positive_obligation_fy: history.summary.last_positive_obligation_fy ?? null,
          }
        : {}),
      ...(enrichment
        ? { enrichment_status: enrichment, partial: history?.partial === true }
        : {}),
      ...(r.resolution === 'registered_zero'
        ? {
            note:
              'Registered entity with no awards in the BigQuery warehouse ingest. Do NOT claim the company does not exist. Do NOT invent awards.',
          }
        : {}),
      ...(r.resolution === 'unavailable'
        ? {
            note:
              r.detail ||
              'Warehouse history temporarily unavailable. Do NOT state the contractor has no awards.',
          }
        : {}),
    },
  };
}

function withNameResolution(
  company: string,
  uei: string,
  via: ContractorAwardHistoryToolResult,
): ContractorAwardHistoryToolResult {
  return {
    ...via,
    queried: { company, uei },
    _meta: {
      ...via._meta,
      name_resolution: 'award_corpus_name_to_uei',
      coverage: {
        dataset: 'recipients',
        measure: 'total_obligated',
        scope: 'single_uei',
        as_of: via._meta.asOf ?? null,
        not_equivalent_to: 'recipients_rollup.total_obligated',
      },
      note: via._meta.note
        ?? 'Name matched one award-warehouse recipient; history was loaded by that UEI. total_obligations is recipients.total_obligated for this UEI. A profile card reads recipients_rollup.total_obligated, a different snapshot — do not treat the two dollar figures as the same total. match.method recipient_name, when present, is the warehouse label after the UEI was known, not how the company parameter was matched.',
    },
  };
}

async function byCompany(
  company: string,
  actor: string | undefined,
  awardLimit?: number,
): Promise<ContractorAwardHistoryToolResult> {
  const named = await resolveAwardCorpusByName(company);

  if (named.status === 'ambiguous') {
    return {
      queried: { company },
      history: null,
      candidates: named.candidates,
      _meta: {
        grounded: false,
        degraded: false,
        award_count: 0,
        total_obligations: 0,
        resolution: 'ambiguous',
        match_count: named.match_count,
        source: 'recipients',
        note: named.note,
      },
    };
  }

  if (named.status === 'unique') {
    const via = await byUei(named.uei, actor, awardLimit);
    const usable =
      via._meta.resolution === 'found' ||
      via._meta.resolution === 'registered_zero' ||
      (via.history?.summary?.awardCount ?? 0) > 0;
    if (usable) return withNameResolution(company, named.uei, via);
  }

  let history: ContractorSalesHistory | null = null;
  let degraded = named.status === 'degraded' || (named.status === 'unique');
  try {
    history = company
      ? await getContractorSalesHistory({
          company,
          publicView: true, // MCP: never leak gated contact fields
          awardLimit,
        })
      : null;
  } catch (err) {
    console.error('[mcp:contractor-award-history] failed:', err);
    degraded = true;
  }

  if (history && history.source === 'unavailable') degraded = true;

  let grounded = !!history && (history.summary?.awardCount ?? 0) > 0;

  // Existence net on every name miss, including a punctuation variant the
  // warehouse index missed. The check stems the name itself, so ", LLC" and
  // "LLC" are the same query. Do not substitute the mirror's dollar slice for
  // the warehouse total — flag the miss, keep the two coverages distinct.
  let evidence: AwardHistoryEvidence | null = null;
  const knownUei = named.status === 'unique' ? named.uei : null;
  if (!grounded && company) {
    try {
      evidence = await establishAwardHistory(company, knownUei);
      if (evidence.degraded && !evidence.hasFederalAwardHistory) degraded = true;
      if (evidence.uei && evidence.uei !== knownUei) {
        const viaUei = await getContractorHistoryByUei({
          uei: evidence.uei,
          actor,
          coldPolicy: actor ? 'budgeted' : 'never',
        });
        const ueiCount = viaUei.history?.summary?.awardCount ?? 0;
        if (viaUei.history && ueiCount > 0) {
          history = awardLimit ? clipRecent(viaUei.history, awardLimit) : viaUei.history;
          grounded = true;
        }
      }
      if (evidence.hasFederalAwardHistory && !grounded) grounded = true;
    } catch (err) {
      degraded = true;
      console.error('[mcp:contractor-award-history] existence check failed:', err);
    }
  }

  const ownCount = history?.summary?.awardCount ?? 0;
  const resolved = ownCount > 0;
  const elsewhere = !!evidence?.hasFederalAwardHistory && !resolved;

  const result: ContractorAwardHistoryToolResult = {
    queried: { company },
    history,
    _meta: {
      grounded,
      degraded,
      resolution: degraded && !grounded
        ? 'lookup_failed'
        : elsewhere
        ? 'none_in_award_corpus'
        : resolved
        ? 'static_cache'
        : 'none_in_award_corpus',
      ...(elsewhere
        ? {
            award_history_elsewhere: true,
            award_history_sources: evidence!.sources.filter((x) => x.found).map((x) => x.source),
            note: 'This tool\'s award cache returned nothing, but Mindy holds federal award history for this contractor from another source. Do NOT state the contractor has no federal past performance.',
          }
        : !resolved && !degraded
        ? {
            note:
              `No award-holding recipient in the warehouse name index matched "${company}", and the existence check found none in the datasets it queried. ` +
              'That is not proof the firm has no federal awards, and it says nothing about SAM registration or certifications.',
          }
        : degraded && !resolved
        ? {
            note: 'Award-history lookup failed. Do not treat this as a miss and do not state the contractor has no awards.',
          }
        : {}),
      award_count: ownCount,
      total_obligations: history?.summary?.totalObligations ?? 0,
    },
  };

  if (mcpFlags.aiHint) {
    const s = history?.summary;
    result._ai_hint = {
      summary: result._meta.resolution === 'ambiguous'
        ? result._meta.note || 'Several contractors matched. Do not pick one.'
        : degraded
        ? 'Award-history lookup errored — retry; do not state the contractor has no awards.'
        : !history
        ? (result._meta.note || `No award-holding recipient in this dataset matched "${company}".`)
        : grounded
        ? `${history.contractor.company}: $${((s!.totalObligations) / 1e6).toFixed(1)}M across ${s!.awardCount} awards; top agency ${s!.topAgency ?? 'n/a'}; latest FY ${s!.latestFiscalYear ?? 'n/a'}.`
        : `"${company}" matched an entity but has no cached award history in this dataset.`,
      how_to_use: result._meta.resolution === 'ambiguous'
        ? 'Use candidates, or search_contractors, then call this tool with a UEI. Do not attribute the largest match.'
        : grounded
        ? 'topAgencies = where they win; series = trajectory; topNaics = their lanes. The dollar total is this source only.'
        : 'Do not invent awards. Absence from this dataset is not absence from every federal source.',
      key_caveats: [
        'A unique name is loaded by UEI. Several matches are not auto-selected. match.method on a UEI payload is not how the company string was resolved.',
        'Profile rollup dollars and this UEI total are different snapshots. Subcontract revenue is not included.',
      ],
    };
  }
  return result;
}

export async function contractorAwardHistory(
  input: ContractorAwardHistoryToolInput,
): Promise<ContractorAwardHistoryToolResult> {
  const uei = typeof input.uei === 'string' ? input.uei.trim() : '';
  const company = typeof input.company === 'string' ? input.company.trim() : '';

  // UEI is authoritative when both are supplied.
  if (uei) {
    return byUei(uei, input.actor, input.award_limit);
  }
  if (!company) {
    return {
      queried: {},
      history: null,
      _meta: {
        grounded: false,
        degraded: false,
        award_count: 0,
        total_obligations: 0,
        resolution: 'malformed',
        note: 'Either company or uei is required',
      },
    };
  }
    return byCompany(company, input.actor, input.award_limit);
}
