/**
 * Canonical Mindy Discovery — the query plan.
 *
 * LOCKED PIPELINE (Eric, 2026-09-22):
 *   raw input
 *   → 1 structured intent extraction   (intent.ts — agency · state · set-aside · NAICS · PSC · -exclusions)
 *   → 2 concept classification         (matcher.ts — distinctive | generic, semantic, never by length)
 *   → 3 eligibility                    (matcher.ts — who may be ADMITTED)
 *   → 4 horizon / source policy        (policy.ts — windows, fiscal years; may NARROW, never reinterpret)
 *   → 5 ranking                        (rank.ts — reorders admitted records; never admits)
 *
 * MCP find_opportunities is the governing oracle: interpretation reuses its resolvers
 * (resolveQueryIntent, interpretMarket, retrieval NAICS/PSC, term-of-art NAICS, resolveBuyerIdentity).
 * Horizon implementations consume this plan; none of them re-reads `raw`.
 *
 * A plan is DATA (serializable; golden fixtures lock it). apply.ts turns it into queries.
 * Phase A: NO production consumer calls this yet.
 */
import { resolveQueryIntent, setAsideOrExpr, pscToNaicsCodes, type SetAsideKey } from '@/lib/search/query-intent';
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { naicsMatchConds } from '@/lib/opportunities/map-filters';
import { interpretMarket, retrievalNaics, retrievalPsc, type MarketInterpretation } from '@/lib/opportunities/market-interpretation';
import { openRetrievalNaics, openRetrievalPsc, pscMatchConds } from '@/lib/opportunities/open-relevance';
import { resolveForecastAgencies } from '@/lib/forecasts/agency-identity';
import { extractStructuredIntent, type StructuredIntent } from './intent';
import { buildTextMatcher, textPredicate, exclusionPredicate, isCodeLike, type TextMatcher } from './matcher';
import { resolveBuyer, buyerPredicate, type ResolvedBuyer } from './buyer';
import type { SurfacePolicy } from './policy';

export const DISCOVERY_PLAN_VERSION = 2;
export const PIPELINE = ['structured_intent', 'concept_classification', 'eligibility', 'horizon_policy', 'ranking'] as const;

export const OPEN_TEXT_COLS = ['title', 'description', 'sow_text', 'department', 'solicitation_number'] as const;
export const OPEN_BUYER_COLS = ['department', 'sub_tier'] as const;
/**
 * Recompete text recall. BUY-SIDE columns first: `description` (96% filled) and `psc_description`
 * (99.7%) say what was bought. Measured 2026-09-22 on the 141,468 future rows: `naics_description`
 * is 0% filled, so before this change literal Coming-back recall ran ONLY on the holder's name and
 * the agency's name — "machining" recalled every TYONEK MACHINING AND FABRICATION order (NAICS 334515,
 * a diagnostic test station) and labelled them direct matches. `incumbent_name` stays for recall so
 * the holder lead is not lost, but a holder-name hit is labelled HOLDER_SIGNAL, never DIRECT_MATCH
 * (src/lib/opportunities/match-evidence.ts).
 */
export const RECOMPETE_TEXT_COLS = ['description', 'psc_description', 'naics_description', 'incumbent_name', 'awarding_agency', 'awarding_sub_agency'] as const;
export const RECOMPETE_BUYER_COLS = ['awarding_agency', 'awarding_sub_agency'] as const;
/** Columns for the capability's DIRECT terms (MCP related-market path). `description` is ~0% populated. */
export const RECOMPETE_TERM_COLS = ['incumbent_name', 'naics_description', 'description'] as const;
export const FORECAST_TEXT_COLS = ['title', 'naics_description', 'department', 'description'] as const;

export interface DiscoveryInput {
  query: string;
  /** Explicit buyer (MCP `agency`, Maps agency filter). */
  agency?: string | null;
  state?: string | null;
  setAside?: string | null;
  /** Advanced overrides (MCP advanced.naics / advanced.psc). */
  naics?: string | null;
  psc?: string | null;
  /**
   * The SURFACE already supplies a positive scope the plan cannot see (a saved search's NAICS or
   * strategy filters, a profile scope). Lets an exclusion-only query ("-computers") be valid there.
   */
  hasSurfaceScope?: boolean;
  /**
   * Company-anchored recall (MCP `uei`): the company's REGISTERED codes, exact. They are UNIONED
   * into the text/taxonomy recall of each horizon — they widen who can be a candidate, never narrow,
   * and never establish a DIRECT match (labels: company_registered_psc / company_registered_naics).
   * Only applied when the query carries a text concept; a structured-only plan already admits the
   * whole scope.
   */
  company?: { naics: string[]; psc: string[] } | null;
}

export type Op =
  | { op: 'or'; expr: string }
  | { op: 'eq'; col: string; val: string }
  | { op: 'is'; col: string; val: null }
  | { op: 'gte'; col: string; val: string }
  | { op: 'lte'; col: string; val: string }
  | { op: 'ilike'; col: string; val: string };

export type PlanStatus = 'ok' | 'needs_positive_scope' | 'needs_refinement';

export interface DiscoveryPlan {
  version: number;
  pipeline: readonly string[];
  raw: string;
  status: PlanStatus;
  /** Human-facing refinement ask when status ≠ ok. Never an empty result presented as market truth. */
  refinement: string | null;
  /** 1 · structured intent */
  intent: StructuredIntent & { residualKind: string };
  /** 2–3 · concepts + eligibility */
  matcher: TextMatcher;
  expansion: {
    capability_kind: MarketInterpretation['capability']['kind'];
    direct: { naics: string[]; psc: string[]; terms: string[] };
    related: { naics: string[]; psc: string[] } | null;
    term_of_art_naics: string[];
  };
  /** Present only when a company anchor widened recall (MCP `uei`). Absent keeps golden plans stable. */
  company?: { naics: string[]; psc: string[] };
  buyers: ResolvedBuyer[];
  states: string[];
  setAsides: string[];
  naics: string[];
  psc: string[];
  /** 4 · policy */
  policy: SurfacePolicy;
  horizons: {
    open: { via: string; mapFilters: Record<string, string>; ops: Op[] };
    recompete: { via: string; ops: Op[]; naics: string[] };
    forecast: { via: string; forecastFilters: { q: null; naics: string | null; agency: string | null; state: string | null }; ops: Op[]; coverage: 'ok' | 'unestablished' };
  };
  notes: string[];
}

export interface PlanContext { today: string; fiscalYear: number }

export function contextFor(now = new Date()): PlanContext {
  const fy = now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return { today: now.toISOString().slice(0, 10), fiscalYear: fy };
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
/**
 * Fail-closed: `<primary key> IS NULL` never matches and is valid for every key TYPE. (A text
 * sentinel like `id.eq.__NONE__` is a 400 on the uuid `agency_forecasts.id` — measured — which a
 * caller would see as an error or, worse, as "unknown", not as an honest empty.)
 */
const NEVER = (pk: string): Op => ({ op: 'is', col: pk, val: null });
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const split = (s: string | null | undefined) => String(s || '').split(',').map((c) => c.trim()).filter(Boolean);
const esc = (s: string) => s.replace(/[%,()]/g, ' ').trim();

export function buildDiscoveryPlan(input: DiscoveryInput, policy: SurfacePolicy, ctx: PlanContext = contextFor()): DiscoveryPlan {
  const raw = String(input.query || '').trim();
  const notes: string[] = [];

  // ── 1 · STRUCTURED INTENT ───────────────────────────────────────────────────────────────
  // A bare code/set-aside token ("541320", "R408", "8a") is owned by resolveQueryIntent, as today.
  // A fully "quoted" query is an explicit literal request — nothing inside it is reinterpreted.
  const bare = isCodeLike(raw) ? resolveQueryIntent(raw) : null;
  const quoted = /^["“].+["”]$/.test(raw);
  const empty: StructuredIntent = { agencies: [], states: [], setAsides: [], naics: [], psc: [], exclusions: [], horizonHint: null, stripped: [], residual: '' };
  const si: StructuredIntent = bare && bare.kind !== 'keyword' ? empty
    : quoted ? { ...empty, residual: raw }
    : extractStructuredIntent(raw);
  if (bare?.kind === 'naics') si.naics.push(...(bare.naics || []));
  if (bare?.kind === 'psc' && bare.psc) si.psc.push(bare.psc);
  if (bare?.kind === 'setAside' && bare.setAside) si.setAsides.push(bare.setAside);
  // A residual that is itself only a set-aside/code (rare after extraction) resolves the same way.
  const residualIntent = quoted ? { kind: 'keyword' as const } : si.residual ? resolveQueryIntent(si.residual) : { kind: 'empty' as const };
  if (residualIntent.kind === 'setAside' && residualIntent.setAside) si.setAsides.push(residualIntent.setAside);
  if (residualIntent.kind === 'naics') si.naics.push(...(residualIntent.naics || []));
  if (residualIntent.kind === 'psc' && residualIntent.psc) si.psc.push(residualIntent.psc);
  const keywordText = residualIntent.kind === 'keyword' ? si.residual : '';

  const buyers = uniq([...(input.agency ? [String(input.agency).trim()] : []), ...si.agencies.map((a) => a.resolveAs)]).map(resolveBuyer);
  const states = uniq([
    ...(input.state ? split(input.state).map((s) => normalizeStateCode(s) || s.toUpperCase()) : []),
    ...si.states,
  ]);
  const setAsides = uniq(si.setAsides) as SetAsideKey[];
  // Explicit NAICS/PSC (surface filter or MCP advanced.*) and codes the QUERY names are two separate
  // constraints — they AND, exactly as today's applyMapFilters(search) AND naics filter do.
  const inputNaics = uniq(split(input.naics));
  const queryNaics = uniq(si.naics);
  const naics = uniq([...inputNaics, ...queryNaics]);
  const psc = uniq([...split(input.psc), ...si.psc]);

  // ── 2–3 · CONCEPTS + ELIGIBILITY (MCP taxonomy + the one lexical matcher) ─────────────────
  const market = interpretMarket(keywordText, null);
  const cap = market.capability;
  const matcher = buildTextMatcher(keywordText, si.exclusions.map((e) => e.term));
  const toaNaics = keywordText ? termOfArtNaicsCodes(keywordText) || [] : [];
  const lexicalPositive = matcher.mode !== 'none';
  // Company codes are exact (a registered NAICS/PSC is a specific code, never a family prefix).
  const company = input.company && (input.company.naics.length || input.company.psc.length)
    ? { naics: uniq(input.company.naics.map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c))), psc: uniq(input.company.psc.map((c) => c.trim().toUpperCase()).filter(Boolean)) }
    : null;
  const companyConds = company && lexicalPositive
    ? [...company.naics.map((c) => `naics_code.eq.${c}`), ...company.psc.map((c) => `psc_code.eq.${c}`)]
    : [];
  if (company && !lexicalPositive) notes.push('company: registered codes not applied (no text concept — the structured scope already admits every row)');

  // Positive anchor: something must say WHAT market, not only what to leave out.
  const anchored = lexicalPositive || naics.length > 0 || psc.length > 0 || setAsides.length > 0 || buyers.length > 0
    || states.length > 0 || !!input.setAside || !!input.hasSurfaceScope;
  let status: PlanStatus = 'ok';
  let refinement: string | null = null;
  if (raw && !anchored) {
    if (matcher.excluded.length) {
      status = 'needs_positive_scope';
      refinement = `"${raw}" only says what to leave out. Add what you do sell (a capability, NAICS, agency or state) — excluding one word from the whole federal market is not a search.`;
    } else {
      status = 'needs_refinement';
      refinement = `Nothing in "${raw}" names a capability, agency, location or code. Try the work you do (e.g. "janitorial") or a buyer (e.g. "USDA").`;
    }
  }
  const blocked = status !== 'ok';
  if (matcher.alternatives.some((a) => a.shape === 'capability_list')) notes.push('capability_list: any distinctive concept admits; generic concepts rank only');
  if (si.stripped.length) notes.push(`stripped: ${si.stripped.join(', ')}`);
  if (si.horizonHint) notes.push(`horizon_hint: ${si.horizonHint} (surfaces decide; plans stay multi-horizon)`);

  const buyerOpen = buyerPredicate(buyers, OPEN_BUYER_COLS);
  const buyerRecompete = buyerPredicate(buyers, RECOMPETE_BUYER_COLS);

  // ── OPEN ─────────────────────────────────────────────────────────────────────────────────
  const mapFilters: Record<string, string> = { status: 'active' };
  if (states.length) mapFilters.state = states.join(',');
  if (inputNaics.length) mapFilters.naics = inputNaics.join(',');
  if (psc.length) mapFilters.psc = psc.join(',');
  if (input.setAside) mapFilters.setAside = String(input.setAside);
  if (policy.open.closingDays) mapFilters.closingDays = String(policy.open.closingDays);
  if (policy.open.postedDays) mapFilters.postedDays = String(policy.open.postedDays);
  if (policy.open.hideCommodity) mapFilters.hideCommodity = '1';
  const oOps: Op[] = [];
  let oVia = 'structured_only';
  if (queryNaics.length) oOps.push({ op: 'or', expr: naicsMatchConds(queryNaics).join(',') });
  if (lexicalPositive) {
    const tn = openRetrievalNaics(cap);
    const tp = openRetrievalPsc(cap);
    const parts = [textPredicate(matcher, OPEN_TEXT_COLS), ...naicsMatchConds(tn), ...pscMatchConds(tp), ...companyConds].filter(Boolean) as string[];
    oOps.push({ op: 'or', expr: parts.join(',') || 'notice_id.is.null' });
    oVia = tn.length || tp.length ? 'text_or_taxonomy' : 'text';
    if (companyConds.length) oVia += '_or_company_codes';
  }
  const oEx = exclusionPredicate(matcher, OPEN_TEXT_COLS);
  if (oEx) oOps.push({ op: 'or', expr: oEx });
  if (buyerOpen) oOps.push({ op: 'or', expr: buyerOpen });
  for (const k of setAsides) oOps.push({ op: 'or', expr: setAsideOrExpr(k, { codeCol: 'set_aside_code', textCols: ['set_aside_description'] }) || 'notice_id.is.null' });
  if (blocked) oOps.splice(0, oOps.length, NEVER('notice_id'));

  // ── RECOMPETE (MCP queryComingBack) ─────────────────────────────────────────────────────
  const rOps: Op[] = [
    { op: 'is', col: 'quality_flag', val: null },
    { op: 'gte', col: 'period_of_performance_current_end', val: ctx.today },
  ];
  if (policy.recompete.windowMonths != null) rOps.push({ op: 'lte', col: 'period_of_performance_current_end', val: addMonths(ctx.today, policy.recompete.windowMonths) });
  let rVia = 'structured_only';
  let rNaics = [...naics];
  if (inputNaics.length) rOps.push({ op: 'or', expr: naicsMatchConds(inputNaics).join(',') });
  if (queryNaics.length) rOps.push({ op: 'or', expr: naicsMatchConds(queryNaics).join(',') });
  const pscNaics: string[] = [];
  for (const p of psc) { const xw = pscToNaicsCodes(p); if (xw.length) pscNaics.push(...xw); else notes.push(`recompete: psc ${p} has no NAICS crosswalk (psc_code ~empty on recompete)`); }
  if (pscNaics.length) { rOps.push({ op: 'or', expr: naicsMatchConds(uniq(pscNaics)).join(',') }); rNaics.push(...pscNaics); }
  rNaics = uniq(rNaics);
  if (lexicalPositive) {
    const capOr: string[] = [];
    let capNaics: string[] = [];
    if (retrievalNaics(cap).length) {
      rVia = 'industry_preset';
      capNaics = retrievalNaics(cap);
      if (!psc.length) for (const p of retrievalPsc(cap)) capOr.push(`psc_code.eq.${p}`);
      if (cap.related_market) {
        for (const t of cap.direct.terms) {
          const e = textPredicate(buildTextMatcher(`"${t}"`), RECOMPETE_TERM_COLS);
          if (e) capOr.push(e);
        }
      }
    } else if (toaNaics.length) {
      rVia = 'term_of_art';
      capNaics = toaNaics;
    } else {
      rVia = 'text';
      capOr.push(textPredicate(matcher, RECOMPETE_TEXT_COLS) || '');
    }
    const expr = [...naicsMatchConds(capNaics), ...capOr.filter(Boolean), ...companyConds].join(',');
    rOps.push({ op: 'or', expr: expr || 'contract_id.is.null' });
    if (companyConds.length) rVia += '_or_company_codes';
    rNaics = uniq([...rNaics, ...capNaics]);
  }
  const rEx = exclusionPredicate(matcher, RECOMPETE_TEXT_COLS);
  if (rEx) rOps.push({ op: 'or', expr: rEx });
  if (buyerRecompete) rOps.push({ op: 'or', expr: buyerRecompete });
  for (const k of setAsides) rOps.push({ op: 'or', expr: setAsideOrExpr(k, { textCols: ['set_aside_type'] }) || 'contract_id.is.null' });
  if (input.setAside && !setAsides.length) rOps.push({ op: 'ilike', col: 'set_aside_type', val: `%${esc(String(input.setAside))}%` });
  if (states.length) rOps.push({ op: 'or', expr: states.map((s) => `place_of_performance_state.eq.${s}`).join(',') });
  if (blocked) rOps.splice(0, rOps.length, NEVER('contract_id'));

  // ── FORECAST (MCP queryComingSoon; text from the one matcher) ────────────────────────────
  const fOps: Op[] = [];
  let fVia = 'structured_only';
  let fNaics = inputNaics.length ? inputNaics.join(',') : null;
  if (queryNaics.length) fOps.push({ op: 'or', expr: naicsMatchConds(queryNaics).join(',') });
  if (!fNaics && psc.length) { const xw = uniq(psc.flatMap((p) => pscToNaicsCodes(p))); if (xw.length) fNaics = xw.join(','); }
  if (lexicalPositive) {
    fVia = 'text';
    // agency_forecasts carries naics_code but no psc_code — only registered NAICS widen Coming soon.
    const fCompany = company ? company.naics.map((c) => `naics_code.eq.${c}`) : [];
    fOps.push({ op: 'or', expr: [textPredicate(matcher, FORECAST_TEXT_COLS), ...fCompany].filter(Boolean).join(',') || 'id.is.null' });
    if (fCompany.length) fVia = 'text_or_company_naics';
  }
  const fEx = exclusionPredicate(matcher, FORECAST_TEXT_COLS);
  if (fEx) fOps.push({ op: 'or', expr: fEx });
  for (const k of setAsides) fOps.push({ op: 'or', expr: setAsideOrExpr(k, { textCols: ['set_aside_type'] }) || 'id.is.null' });
  if (input.setAside && !setAsides.length) fOps.push({ op: 'ilike', col: 'set_aside_type', val: `%${esc(String(input.setAside))}%` });
  if (!policy.forecast.includePastFiscalYears) {
    const future: string[] = [];
    for (let y = ctx.fiscalYear; y <= ctx.fiscalYear + 15; y++) future.push(`fiscal_year.ilike.%${y}%`);
    fOps.push({ op: 'or', expr: `fiscal_year.is.null,${future.join(',')}` });
  }
  const forecastAgency = buyers.length ? buyers.map((b) => b.requested).join('|') : null;
  let coverage: 'ok' | 'unestablished' = 'ok';
  for (const b of buyers) {
    const fr = resolveForecastAgencies(b.requested);
    if (!fr.empty && fr.identities.length > 0 && fr.identities.every((id) => id.coverage === 'none') && !fr.codes.length && !fr.children.length && !fr.unresolved.length) coverage = 'unestablished';
  }
  if (blocked) fOps.splice(0, fOps.length, NEVER('id'));

  return {
    version: DISCOVERY_PLAN_VERSION,
    pipeline: PIPELINE,
    raw,
    status,
    refinement,
    intent: { ...si, residualKind: residualIntent.kind },
    matcher,
    expansion: {
      capability_kind: cap.kind,
      direct: { naics: [...cap.direct.naics], psc: [...cap.direct.psc], terms: [...cap.direct.terms] },
      related: cap.related_market ? { naics: [...cap.related_market.naics], psc: [...cap.related_market.psc] } : null,
      term_of_art_naics: toaNaics,
    },
    ...(company && lexicalPositive ? { company } : {}),
    buyers,
    states,
    setAsides,
    naics,
    psc,
    policy,
    horizons: {
      open: { via: blocked ? status : oVia, mapFilters, ops: oOps },
      recompete: { via: blocked ? status : rVia, ops: rOps, naics: rNaics },
      forecast: { via: blocked ? status : fVia, forecastFilters: { q: null, naics: fNaics, agency: forecastAgency, state: states.length ? states.join(',') : null }, ops: fOps, coverage },
    },
    notes,
  };
}
