/**
 * MCP tool: assess_market_depth — the Rule-of-Two determination for a NAICS (+
 * optional set-aside / state): how many CAPABLE small businesses exist, so a CO can
 * decide whether a requirement can be set aside. Returns market depth, whether the
 * Rule of Two is met (≥2 capable), a scored/tiered vendor list, and memo-ready caveats.
 *
 * This is the clean, decision-grade core of a "market scan" — the who-can-do-this
 * question. (Complementary catalog tools answer who's buying: get_agency_intel;
 * what's available: search_sam_opportunities; who holds it now: search_contractors.)
 *
 * Wraps src/lib/gov-buyer/market-research.ts (Supabase sam_entities + BQ recipients
 * activity enrichment, metered). credits: 10. `_meta` always ships; `_ai_hint` OFF by
 * default.
 */
import { runMarketResearch, type ScoredEntity } from '@/lib/gov-buyer/market-research';
import { mcpFlags } from '@/lib/mcp/flags';

export interface MarketDepthToolInput {
  naics: string;
  state?: string;
  /** Normalized label: '8(a)','HUBZone','SDVOSB','WOSB','EDWOSB','Small Business'. */
  set_aside?: string;
  include_emerging?: boolean;
  limit?: number;
}

export interface MarketDepthToolResult {
  queried: { naics: string; state?: string; set_aside?: string };
  market_depth: number;
  /** active_performer + capable ONLY — the honest Rule-of-Two basis (FM-03). Emerging registrants
   *  (registered but unproven) do NOT count here, so "Rule of Two met" can never sit on 0 performers. */
  capable_depth: number;
  /** null = could not assess (award-history lookup degraded). Never coerce to false. */
  rule_of_two_met: boolean | null;
  counts: Record<string, number>;
  registered_only_count: number;
  businesses: ScoredEntity[];
  data_as_of: string;
  caveats: string[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; market_depth: number; capable_depth: number; rule_of_two_met: boolean | null };
}

export async function assessMarketDepth(input: MarketDepthToolInput): Promise<MarketDepthToolResult> {
  const naics = (input.naics || '').trim();
  let res;
  let degraded = false;
  try {
    res = naics
      ? await runMarketResearch({
          naics,
          state: input.state,
          setAside: input.set_aside,
          includeEmerging: input.include_emerging,
          limit: input.limit,
        })
      : null;
  } catch (err) {
    console.error('[mcp:market-depth] failed:', err);
    degraded = true;
  }

  // A THROW is not the only degradation. runMarketResearch also degrades SILENTLY when its
  // BigQuery award-history lookup fails and no stale cache covers it — it returns real-looking
  // counts with every firm scored registered_only. That path never throws, so `degraded`
  // stayed false and the agent was told "capable: 0" as a finding.
  if (res?.dataDegraded) degraded = true;

  const grounded = !!res && res.marketDepth > 0;
  const queried: MarketDepthToolResult['queried'] = { naics };
  if (input.state) queried.state = input.state;
  if (input.set_aside) queried.set_aside = input.set_aside;

  const capableDepth = res?.capableDepth ?? 0;
  const emergingCount = (res?.counts?.emerging ?? 0);
  const result: MarketDepthToolResult = {
    queried,
    market_depth: res?.marketDepth ?? 0,
    capable_depth: capableDepth,
    // null = could not assess (BQ degraded). NEVER coerce to false: an agent reads
    // false as a finding and repeats it as fact.
    rule_of_two_met: res?.ruleOfTwoMet ?? null,
    counts: res?.counts ?? {},
    registered_only_count: res?.registeredOnlyCount ?? 0,
    businesses: res?.businesses ?? [],
    data_as_of: res?.dataAsOf ?? '',
    caveats: res?.caveats ?? [],
    _meta: {
      grounded,
      degraded,
      market_depth: res?.marketDepth ?? 0,
      capable_depth: capableDepth,
      // null = could not assess (BQ degraded). NEVER coerce to false: an agent reads
    // false as a finding and repeats it as fact.
    rule_of_two_met: res?.ruleOfTwoMet ?? null,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? 'Market-depth lookup errored — retry; do not state a determination.'
        : grounded
        // Headline is CAPABLE depth, not raw market_depth (FM-03) — so a "wide but shallow" market
        // (many emerging, 0 capable) reads honestly as NOT met, with the emerging count as context.
        ? `${capableDepth} CAPABLE small business(es) for NAICS ${naics}${input.set_aside ? ` (${input.set_aside})` : ''}${input.state ? ` in ${input.state}` : ''} → Rule of Two ${res!.ruleOfTwoMet === null ? 'COULD NOT BE ASSESSED (award-history lookup unavailable — do NOT report this as "not met")' : res!.ruleOfTwoMet ? 'MET (set-aside supportable)' : 'NOT met'}.${emergingCount ? ` ${emergingCount} emerging (registered, unproven) — the field is ${capableDepth < 2 && emergingCount >= 2 ? 'WIDE but SHALLOW' : 'developing'}.` : ''} Data as of ${res!.dataAsOf || 'n/a'}.`
        : `No capable small businesses found for NAICS ${naics}${input.set_aside ? ` (${input.set_aside})` : ''}. Rule of Two not met on this data.`,
      how_to_use: grounded
        ? 'Rule of Two = ≥2 CAPABLE small businesses (active_performer + capable) at a fair price → the requirement SHOULD be set aside. It is gated on capable_depth, NOT market_depth — EMERGING firms (registered but no proven performance) never satisfy the Rule of Two, though they show the field is developing. registered_only_count is shown separately and never counts. Use the tiered businesses list (active_performer > capable > emerging) for the memo.'
        : 'No grounded depth; report the Rule of Two as unmet rather than inventing vendors.',
      key_caveats: [
        'A determination is only as current as data_as_of (latest SAM entities sync); verify active registration before relying on it.',
        'Set-aside eligibility uses SAM certifications: 8(a)/HUBZone are SBA-vetted; WOSB/SDVOSB/VOSB are self-certified — weight accordingly.',
      ],
    };
  }
  return result;
}
