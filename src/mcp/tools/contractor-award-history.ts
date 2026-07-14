/**
 * MCP tool: get_contractor_award_history — a named contractor's federal award
 * history: total obligations, award count, year-over-year trend, top agencies, top
 * NAICS, and recent awards. The "size up a competitor / teammate / incumbent" view.
 *
 * Wraps src/lib/contractor-sales-history.ts (USASpending cache + contractor DB,
 * commodity, metered). credits: 2. `_meta` always ships; `_ai_hint` OFF by default.
 * Contact details are gated out here (publicView) — MCP is a data surface, not the
 * gated contacts product.
 */
import { getContractorSalesHistory, type ContractorSalesHistory } from '@/lib/contractor-sales-history';
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

  const grounded = !!history && (history.summary?.awardCount ?? 0) > 0;
  const result: ContractorAwardHistoryToolResult = {
    queried: { company },
    history,
    _meta: {
      grounded,
      degraded,
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
