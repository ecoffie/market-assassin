/**
 * MCP tool: get_contractor_award_history — a named contractor's federal award
 * history: total obligations, award count, year-over-year trend, top agencies, top
 * NAICS, and recent awards. The "size up a competitor / teammate / incumbent" view.
 *
 * Wraps src/lib/contractor-sales-history.ts (USASpending cache + contractor DB,
 * commodity, metered). credits: 10. `_meta` always ships; `_ai_hint` OFF by default.
 * Contact details are gated out here (publicView) — MCP is a data surface, not the
 * gated contacts product.
 */
import { getContractorSalesHistory, type ContractorSalesHistory } from '@/lib/contractor-sales-history';
import { establishAwardHistory } from '@/lib/contractor/award-history-existence';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ContractorAwardHistoryToolInput {
  company: string;
  award_limit?: number;
}

export interface ContractorAwardHistoryToolResult {
  queried: { company: string };
  history: ContractorSalesHistory | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; award_count: number; total_obligations: number };
}

export async function contractorAwardHistory(
  input: ContractorAwardHistoryToolInput,
): Promise<ContractorAwardHistoryToolResult> {
  const company = (input.company || '').trim();
  let history: ContractorSalesHistory | null = null;
  let degraded = false;
  try {
    history = company
      ? await getContractorSalesHistory({
          company,
          publicView: true, // MCP: never leak gated contact fields
          awardLimit: input.award_limit,
        })
      : null;
  } catch (err) {
    console.error('[mcp:contractor-award-history] failed:', err);
    degraded = true;
  }

  // A found contractor with a `success:false` / `unavailable` source means the
  // cache/source errored — surface that as degraded, not a clean "no match".
  if (history && history.source === 'unavailable') degraded = true;

  let grounded = !!history && (history.summary?.awardCount ?? 0) > 0;

  // ── CHAIN-2 (2026-08-25): NEVER contradict another tool on EXISTENCE ────────────────────
  // THE INVARIANT: once identity resolves, two tools may differ on SCOPE or TIME WINDOW,
  // but they may never disagree on "this contractor has federal award history."
  //
  // MEASURED: this tool reported grounded=false / 0 awards / $0 for FLUIDYNE CORPORATION
  // at the same moment get_recipient_annual_obligations reported $20.2M FY23-25. Neither
  // signalled degradation, so an agent would tell a real contractor they have no federal
  // past performance.
  //
  // CAUSE: this path reads Supabase `usaspending_awards`, which holds ~880 rows across 373
  // distinct recipients — a stale SAMPLE, not a corpus. Of the 789 distinct incumbents we
  // hold award data for in `recompete_opportunities`, only ~45 appear there: **~94% of
  // contractors we demonstrably have award data on would be told they have none.**
  //
  // So a miss here is checked against every source we hold before it may become a claim.
  // We deliberately do NOT merge dollar totals — the sources measure different windows and
  // a merged figure would be a number no source supports. Existence is the shared claim.
  let evidence: Awaited<ReturnType<typeof establishAwardHistory>> | null = null;
  if (!grounded && company) {
    try {
      // ContractorSalesHistory carries no UEI, so existence resolves by NAME here.
      // establishAwardHistory prefers an exact UEI when a caller has one.
      evidence = await establishAwardHistory(company, null);
      if (evidence.hasFederalAwardHistory) {
        // Another source HAS history. This tool's own view stays empty (its window/source
        // genuinely found nothing), but it must not assert absence.
        grounded = true;
      } else if (evidence.degraded) {
        degraded = true;   // could not establish — unknown, never "no history"
      }
    } catch (err) {
      degraded = true;
      console.error('[mcp:contractor-award-history] existence check failed:', err);
    }
  }
  const result: ContractorAwardHistoryToolResult = {
    queried: { company },
    history,
    _meta: {
      grounded,
      degraded,
      // When this tool's own source found nothing but another source has history, say so
      // explicitly rather than letting a caller read `award_count: 0` as "no history".
      ...(evidence?.hasFederalAwardHistory && (history?.summary?.awardCount ?? 0) === 0
        ? {
            award_history_elsewhere: true,
            award_history_sources: evidence.sources.filter((x) => x.found).map((x) => x.source),
            note: 'This tool\'s award cache returned nothing, but Mindy holds federal award history for this contractor from another source. Do NOT state the contractor has no federal past performance.',
          }
        : {}),
      award_count: history?.summary?.awardCount ?? 0,
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
        'Award history is prime obligations from USASpending cache; subcontract revenue is not included.',
      ],
    };
  }
  return result;
}
