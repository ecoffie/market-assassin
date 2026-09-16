/**
 * MCP tool: get_contractor_award_history — a named contractor's federal award
 * history: total obligations, award count, year-over-year trend, top agencies, top
 * NAICS, and recent awards. The "size up a competitor / teammate / incumbent" view.
 *
 * UEI path (authoritative when supplied): shared BigQuery/KV service
 * `getContractorHistoryByUei` — same aggregates as Map/in-app company detail.
 * Name-only path: legacy `getContractorSalesHistory` + CHAIN-2 existence check.
 *
 * credits: 10. `_meta` always ships; `_ai_hint` OFF by default.
 * Contact details are gated out here (publicView) — MCP is a data surface, not the
 * gated contacts product.
 */
import { getContractorSalesHistory, type ContractorSalesHistory } from '@/lib/contractor-sales-history';
import { slugifyContractorName } from '@/lib/contractor-sales-history';
import { establishAwardHistory, type AwardHistoryEvidence, type RecompeteHistoryRow } from '@/lib/contractor/award-history-existence';
import { getContractorHistoryByUei } from '@/lib/contractor/history-by-uei';
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
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    award_count: number;
    total_obligations: number;
    resolution?: string;
    source?: string | null;
    asOf?: string | null;
    aggregates_cover?: string | null;
    cache?: string;
    enrichment_status?: 'complete' | 'budget_limited';
    partial?: boolean;
    award_history_elsewhere?: boolean;
    award_history_sources?: string[];
    note?: string;
  };
}

function clipRecent(history: ContractorSalesHistory, limit?: number): ContractorSalesHistory {
  if (!limit || !Array.isArray(history.recentAwards) || history.recentAwards.length <= limit) {
    return history;
  }
  return { ...history, recentAwards: history.recentAwards.slice(0, limit) };
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

  return {
    queried: { uei: r.uei },
    history,
    _meta: {
      grounded,
      degraded,
      award_count: awardCount,
      total_obligations: history?.summary?.totalObligations ?? 0,
      resolution: r.resolution,
      source: r.source,
      asOf: r.asOf,
      aggregates_cover: r.aggregates_cover,
      cache: r.cache,
      ...(history?.enrichment_status
        ? { enrichment_status: history.enrichment_status, partial: history.partial === true }
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

function amountOf(row: RecompeteHistoryRow): number {
  const n = Number(row.total_obligation);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Shape recompete-mirror rows into the history payload. One source, labeled.
 * awardCount is the number of rows in THIS payload (the dollars cover those
 * rows). The mirror's exact total, when larger, stays in the message — never
 * as a dollar figure we didn't sum.
 */
export function historyFromRecompeteRows(
  company: string,
  rows: RecompeteHistoryRow[],
  exactCount: number | null,
  awardLimit?: number,
): ContractorSalesHistory {
  const shown = awardLimit && rows.length > awardLimit ? rows.slice(0, awardLimit) : rows;
  const dollars = shown.reduce((sum, row) => sum + amountOf(row), 0);
  const name = rows.find((r) => r.incumbent_name)?.incumbent_name || company;
  const agencies = new Map<string, { amount: number; count: number }>();
  for (const row of shown) {
    const agency = row.awarding_agency || 'Unknown';
    const prev = agencies.get(agency) || { amount: 0, count: 0 };
    agencies.set(agency, { amount: prev.amount + amountOf(row), count: prev.count + 1 });
  }
  const topAgencies = [...agencies.entries()]
    .map(([agency, v]) => ({ agency, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);
  const truncated = exactCount != null && exactCount > shown.length;
  return {
    success: true,
    source: 'recompete_mirror',
    coverage: truncated ? 'limited' : 'cached',
    lastUpdated: null,
    contractor: {
      company: name,
      slug: slugifyContractorName(name),
      naics: [...new Set(shown.map((r) => r.naics_code).filter((c): c is string => !!c))],
      agencies: topAgencies.map((a) => a.agency),
      totalContractValue: dollars,
      contractCount: shown.length,
      hasContact: false,
      hasEmail: false,
      hasPhone: false,
    },
    match: { method: 'recipient_name', confidence: 'high', name },
    summary: {
      totalObligations: dollars,
      awardCount: shown.length,
      latestFiscalYear: null,
      topAgency: topAgencies[0]?.agency ?? null,
      averageAwardSize: shown.length ? dollars / shown.length : 0,
    },
    series: [],
    topAgencies,
    topNaics: [],
    recentAwards: shown.map((row) => ({
      id: row.contract_id,
      title: row.description || name,
      agency: row.awarding_agency || 'Unknown',
      subAgency: row.awarding_sub_agency,
      naics: row.naics_code,
      naicsDescription: null,
      amount: amountOf(row),
      startDate: row.period_of_performance_start,
      endDate: row.period_of_performance_current_end,
      state: null,
      url: null,
    })),
    gated: { fullHistory: true, contacts: true, workflowActions: true, exports: true },
    message: truncated
      ? `Resolved from the recompete mirror: ${shown.length} of ${exactCount} matching contracts returned. Dollars are the sum of the returned rows, not an all-time warehouse total.`
      : 'Resolved from the recompete mirror (expiring-contract view). Dollars are this source, not an all-time warehouse total.',
  };
}

async function byCompany(
  company: string,
  actor: string | undefined,
  awardLimit?: number,
): Promise<ContractorAwardHistoryToolResult> {
  let history: ContractorSalesHistory | null = null;
  let degraded = false;
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

  // ── CHAIN-2 + BUG-02: existence is not enough — resolve the rows ────────────────
  // Flagging "history exists elsewhere" stopped the false "no past performance"
  // claim. It still returned history:null / award_count:0 for a name this tool
  // had itself emitted ("TANAQ SUPPORT SERVICES, LLC"). When the mirror (or the
  // UEI warehouse) has the rows, return them. One source, labeled. Do not merge
  // two dollar totals into a number neither source stated.
  let evidence: AwardHistoryEvidence | null = null;
  if (!grounded && company) {
    try {
      evidence = await establishAwardHistory(company, null);
      if (evidence.degraded && !evidence.hasFederalAwardHistory) degraded = true;

      const mirrorCount = evidence.sources.find((s) => s.source === 'recompete_mirror')?.awardCount ?? null;
      if (evidence.uei) {
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
      if ((!history || (history.summary?.awardCount ?? 0) === 0) && evidence.rows && evidence.rows.length > 0) {
        history = historyFromRecompeteRows(company, evidence.rows, mirrorCount, awardLimit);
        grounded = true;
      } else if (evidence.hasFederalAwardHistory) {
        grounded = true;
      }
    } catch (err) {
      degraded = true;
      console.error('[mcp:contractor-award-history] existence check failed:', err);
    }
  }

  const ownCount = history?.summary?.awardCount ?? 0;
  const resolved = ownCount > 0;

  const result: ContractorAwardHistoryToolResult = {
    queried: { company },
    history,
    _meta: {
      grounded,
      degraded,
      ...(evidence?.hasFederalAwardHistory && !resolved
        ? {
            award_history_elsewhere: true,
            award_history_sources: evidence.sources.filter((x) => x.found).map((x) => x.source),
            note: 'This tool\'s award cache returned nothing, but Mindy holds federal award history for this contractor from another source. Do NOT state the contractor has no federal past performance.',
          }
        : {}),
      award_count: ownCount,
      total_obligations: history?.summary?.totalObligations ?? 0,
    },
  };

  if (mcpFlags.aiHint) {
    const s = history?.summary;
    result._ai_hint = {
      summary: degraded
        ? 'Award-history lookup errored — retry; do not state the contractor has no awards.'
        : !history
        ? `No contractor named "${company}" matched. Check spelling or try the legal business name.`
        : grounded
        ? `${history.contractor.company}: $${((s!.totalObligations) / 1e6).toFixed(1)}M across ${s!.awardCount} awards; top agency ${s!.topAgency ?? 'n/a'}; latest FY ${s!.latestFiscalYear ?? 'n/a'} (match confidence: ${history.match.confidence}).`
        : `"${company}" matched an entity but has no cached award history (may be a new/inactive filer).`,
      how_to_use: grounded
        ? 'topAgencies = where they win (find gaps / their strongholds); series = trajectory (growing vs fading); topNaics = their lanes. Use match.confidence — a "low" match may be a name collision, not the same firm.'
        : 'No grounded history; say none was found rather than inventing awards.',
      key_caveats: [
        'Name matching is fuzzy — verify match.confidence and match.name before attributing awards.',
        'Award history is prime obligations from the warehouse / cache; subcontract revenue is not included.',
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
