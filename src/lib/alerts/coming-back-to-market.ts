/**
 * Daily Alert "Coming Back to Market" — a second section, never mixed with Open.
 *
 * Rank (locked 2026-09-17): stored NAICS/PSC market → distinctive-keyword
 * preference inside that market → actionable lead window → value.
 *
 * Windows: primary 6–18 months remaining, secondary 3–6, tertiary >18 if
 * needed to fill the cap. Under 3 months is excluded. Keyword-hit count,
 * capture-band, and soonest-PoP are not primary sorts. Generic singles
 * never expand the market. A distinctive miss keeps the NAICS/PSC set.
 *
 * $250M+ teaming (and nuclear M&O teaming) is the existing grounded size
 * treatment — not a new threshold. Query failure or unknown count omits.
 * Zero is not a success label.
 */
import { createClient } from '@supabase/supabase-js';
import { preferDistinctiveInOpenMarket } from '@/lib/alerts/open-contract-d';
import { parseNaicsPriorities, type NaicsPriorityRole } from '@/lib/alerts/naics-priorities';
import { DEFAULT_PROFILE_NAICS } from '@/lib/alerts/profile-setup';
import { getNaics } from '@/lib/codes/lookup';
import { knownNaicsForMatch } from '@/lib/codes/validate-market-codes';
import type { NaicsProvenance } from '@/lib/profile/company-setup-outcome';
import { parseNaicsCodes, naicsOrExpression, type ExpiringContract } from '@/lib/recompete/query';
import { overlayRecompeteTiming } from '@/lib/recompete/timing';

export const COMING_BACK_CAP = 5;
export const COMING_BACK_PANEL_PATH = '/app?panel=recompetes';
export const COMING_BACK_CONFIRM_PATH = '/app?panel=settings';
export const COMING_BACK_HEADING = 'Coming Back to Market';
export const COMING_BACK_STARTER_HEADING = 'Based on your starter market';
export const COMING_BACK_EXPLAIN =
  'These are existing contracts approaching expiration — not confirmed solicitations. Use them to prepare capture, not to bid today. Dollar figures are the current ceiling or amount obligated, not a promised recompete value.';
export const MEGA_TEAMING_USD = 250_000_000;
export const NUCLEAR_MO_TEAMING_USD = 50_000_000;
/** @deprecated diversification is not part of the locked rank; kept for callers that still import it */
export const MAX_PER_NAICS = 2;
const MARKET_PAGE = 1000;
const MARKET_ROW_CAP = 8000;
const TERTIARY_MONTHS = 36;

export type ComingBackOmitReason =
  | 'no_naics_market'
  | 'none_qualify'
  | 'query_failed'
  | 'unknown_count';

export type ComingBackWindow = 'lead_6_18' | 'lead_3_6' | 'lead_over_18';
export type ComingBackCodeState =
  | 'primary_confirmed'
  | 'secondary_confirmed'
  | 'evidence_supported'
  | 'inferred'
  | 'system_default';
export type ComingBackFit = 'prime' | 'teaming';
export type ComingBackValueKind = 'ceiling' | 'obligated';

export type ComingBackCodeClass = {
  state: ComingBackCodeState;
  provenance: string;
};

export type ComingBackProfile = {
  storedNaics: string[];
  storedPsc?: string[];
  naicsSource?: NaicsProvenance | null;
  keywords?: string[];
  businessType?: string | null;
  businessDescription?: string | null;
  awardNaics?: string[];
  naicsPriorities?: Record<string, NaicsPriorityRole>;
  codeClasses?: Record<string, ComingBackCodeClass>;
};

export type ComingBackRow = {
  contract_id: string;
  incumbent: string | null;
  agency: string | null;
  naics: string | null;
  psc: string | null;
  value: number | null;
  valueKind: ComingBackValueKind;
  obligated: number | null;
  popEnd: string | null;
  leadMonths: number | null;
  window: ComingBackWindow;
  codeState: ComingBackCodeState;
  codeProvenance: string;
  censusTitle: string | null;
  fit: ComingBackFit;
  nuclearMo: boolean;
  why: string;
};

export type ComingBackDecision =
  | { kind: 'omit'; reason: ComingBackOmitReason }
  | { kind: 'show'; rows: ComingBackRow[]; matchedNaics: string[]; starterMarket: boolean };

const NUCLEAR_MO_VEHICLE =
  /consolidated nuclear|savannah river nuclear|solutions of sandia|sandia, llc|\bsandia\b|mission support & test|mission support and test|national nuclear|\bnnsa\b|nuclear security|nuclear solutions|management and operat/;

const NUCLEAR_CAPABILITY =
  /nuclear|\bnnsa\b|national.?security.?site|national lab|management and operat|\bm&o\b/;

const SMALL_BUSINESS =
  /small business|sdvosb|wosb|edwosb|8\(a\)|hubzone|\bvosb\b|veteran/i;

/**
 * Phrase → one exact six-digit Census code. Adjacent titles are not listed.
 * Carpentry is 238350, not 238990. Architecture is 541310, not 541330.
 * Programming is 541511, not 541512.
 */
export const DIRECT_CAPABILITY_TO_NAICS: ReadonlyArray<{
  code: string;
  title: string;
  patterns: RegExp[];
}> = [
  { code: '541511', patterns: [/\bprogramming\b/, /software development/, /custom software/, /application development/] },
  { code: '541512', patterns: [/computer systems design/, /systems design services/] },
  { code: '541310', patterns: [/\barchitectur/] },
  { code: '541330', patterns: [/engineering services/, /civil engineering/, /\bengineering\b/] },
  { code: '541611', patterns: [/management consulting/, /administrative management/] },
  { code: '561210', patterns: [/facility support/, /facilities support/, /facility management/, /facilities management/] },
  { code: '561720', patterns: [/\bjanitorial\b/, /\bcustodial\b/] },
  { code: '561730', patterns: [/grounds maintenance/, /\bgrounds\b/, /\blandscap/] },
  { code: '561790', patterns: [/building maintenance/, /other services to buildings/] },
  { code: '238350', patterns: [/\bcarpentr/, /finish carpentr/, /\bmillwork\b/] },
  { code: '236220', patterns: [/\bremodel/, /\brenovat/, /new build/, /commercial and institutional building/] },
  { code: '492110', patterns: [/\bcourier/, /\bexpress\b/] },
].map((row) => ({
  ...row,
  title: getNaics(row.code)?.title || row.code,
}));

export function censusTitleFor(code: string | null | undefined): string | null {
  const title = getNaics(code)?.title;
  return title || null;
}

export function evidenceCodesForText(text: string): string[] {
  const hay = String(text || '').toLowerCase();
  const hits: string[] = [];
  for (const rule of DIRECT_CAPABILITY_TO_NAICS) {
    if (rule.patterns.some((re) => re.test(hay))) hits.push(rule.code);
  }
  return hits;
}

export type SuggestedCodeToReview = {
  code: string;
  title: string;
  phrase: string;
};

/**
 * Display-only gaps. A directed Census hit that is not stored.
 * Never writes the market. Coming Back still queries stored codes only.
 */
export function suggestedCodesToReview(input: {
  storedNaics: string[];
  keywords?: string[] | null;
  businessDescription?: string | null;
}): SuggestedCodeToReview[] {
  const stored = new Set((input.storedNaics || []).map((c) => String(c || '').trim()).filter(Boolean));
  const keywords = (input.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  const desc = String(input.businessDescription || '').trim();
  const hay = [...keywords, desc].join(' ').toLowerCase();
  const out: SuggestedCodeToReview[] = [];
  for (const rule of DIRECT_CAPABILITY_TO_NAICS) {
    if (stored.has(rule.code)) continue;
    const hit = rule.patterns.find((re) => re.test(hay));
    if (!hit) continue;
    const phrase =
      keywords.find((k) => hit.test(k.toLowerCase())) ||
      (desc && hit.test(desc.toLowerCase()) ? desc.slice(0, 72) : 'capability text');
    out.push({ code: rule.code, title: rule.title, phrase });
  }
  return out;
}

export function contractSize(c: Pick<ExpiringContract, 'potential_total_value' | 'total_obligation'>): {
  amount: number | null;
  kind: ComingBackValueKind;
  obligated: number | null;
} {
  const ceiling = c.potential_total_value;
  const obligated = c.total_obligation;
  const ceilOk = typeof ceiling === 'number' && Number.isFinite(ceiling);
  const oblOk = typeof obligated === 'number' && Number.isFinite(obligated);
  if (ceilOk) return { amount: ceiling, kind: 'ceiling', obligated: oblOk ? obligated : null };
  if (oblOk) return { amount: obligated, kind: 'obligated', obligated };
  return { amount: null, kind: 'ceiling', obligated: null };
}

/** @deprecated use contractSize — kept so older tests that imported contractValue still typecheck if any */
export function contractValue(c: Pick<ExpiringContract, 'potential_total_value' | 'total_obligation'>): number | null {
  return contractSize(c).amount;
}

export function comingBackWindow(leadMonths: number | null | undefined): ComingBackWindow | 'exclude' {
  if (leadMonths == null || !Number.isFinite(leadMonths)) return 'exclude';
  if (leadMonths < 3) return 'exclude';
  if (leadMonths < 6) return 'lead_3_6';
  if (leadMonths <= 18) return 'lead_6_18';
  return 'lead_over_18';
}

const WINDOW_RANK: Record<ComingBackWindow, number> = {
  lead_6_18: 3,
  lead_3_6: 2,
  lead_over_18: 1,
};

export function isDefaultNaicsSet(storedNaics: string[]): boolean {
  const set = new Set((storedNaics || []).map((c) => String(c).trim()).filter(Boolean));
  if (set.size === 0) return false;
  return [...set].every((c) => DEFAULT_PROFILE_NAICS.includes(c)) && set.size <= DEFAULT_PROFILE_NAICS.length;
}

function capabilityHaystack(profile: ComingBackProfile): string {
  return [...(profile.keywords || []), profile.businessDescription || ''].join(' ').toLowerCase();
}

function quoteMatch(profile: ComingBackProfile, re: RegExp): string {
  const hit = (profile.keywords || []).find((k) => re.test(String(k).toLowerCase()));
  if (hit) return `capability keyword “${String(hit).trim()}”`;
  const desc = String(profile.businessDescription || '').trim();
  if (desc && re.test(desc.toLowerCase())) {
    return `company description “${desc.slice(0, 72)}${desc.length > 72 ? '…' : ''}”`;
  }
  return 'company capability text';
}

function deriveOneCode(code: string, profile: ComingBackProfile, hay: string): ComingBackCodeClass {
  const override = profile.codeClasses?.[code];
  if (override) return override;

  const persisted = parseNaicsPriorities(profile.naicsPriorities)[code];
  if (persisted === 'primary') {
    return { state: 'primary_confirmed', provenance: 'persisted user primary' };
  }
  if (persisted === 'secondary') {
    return { state: 'secondary_confirmed', provenance: 'persisted user secondary' };
  }

  if ((profile.awardNaics || []).includes(code)) {
    return { state: 'evidence_supported', provenance: `award history lists ${code}` };
  }

  const rule = DIRECT_CAPABILITY_TO_NAICS.find((row) => row.code === code);
  if (rule) {
    const hit = rule.patterns.find((re) => re.test(hay));
    if (hit) {
      return {
        state: 'evidence_supported',
        provenance: `${quoteMatch(profile, hit)} → ${code} ${rule.title}`,
      };
    }
  }

  if (profile.naicsSource === 'system_default' || (isDefaultNaicsSet(profile.storedNaics) && !hay.trim())) {
    return { state: 'system_default', provenance: 'default inject' };
  }

  // user_confirmed is list-level (Screen-2 accepted the displayed set).
  // It never makes this code primary/secondary. Only naics_priorities do.
  return { state: 'inferred', provenance: 'stored without direct evidence' };
}

/**
 * Per-code state. Never promotes a six-digit code because its three-digit
 * family is the majority of the profile.
 */
export function classifyCodes(profile: ComingBackProfile): Record<string, ComingBackCodeClass> {
  const stored = (profile.storedNaics || []).map((c) => String(c || '').trim()).filter(Boolean);
  const hay = capabilityHaystack(profile);
  const out: Record<string, ComingBackCodeClass> = {};
  for (const code of stored) {
    out[code] = deriveOneCode(code, profile, hay);
  }
  return out;
}

export function isStarterMarket(classes: Record<string, ComingBackCodeClass>): boolean {
  const states = Object.values(classes);
  return states.length > 0 && states.every((c) => c.state === 'system_default');
}

export function isNuclearMoVehicle(c: Pick<ExpiringContract, 'incumbent_name' | 'awarding_agency' | 'awarding_sub_agency' | 'description' | 'naics_description'>): boolean {
  const text = [
    c.incumbent_name,
    c.awarding_agency,
    c.awarding_sub_agency,
    c.description,
    c.naics_description,
  ]
    .map((s) => String(s || '').toLowerCase())
    .join(' | ');
  return NUCLEAR_MO_VEHICLE.test(text);
}

export function profileHasNuclearCapability(profile: Pick<ComingBackProfile, 'keywords' | 'businessDescription' | 'storedNaics'>): boolean {
  const hay = [...(profile.keywords || []), profile.businessDescription || ''].join(' ').toLowerCase();
  if (NUCLEAR_CAPABILITY.test(hay)) return true;
  const nuclearNaics = (profile.storedNaics || []).some((c) => /^(56221|541715|336992)/.test(c));
  return nuclearNaics;
}

export function isSmallBusinessProfile(businessType: string | null | undefined): boolean {
  if (!businessType) return false;
  return SMALL_BUSINESS.test(businessType);
}

export function sizeFitFor(
  c: ExpiringContract,
  profile: ComingBackProfile,
): ComingBackFit {
  const size = contractSize(c).amount ?? 0;
  const nuclear = isNuclearMoVehicle(c);
  const capable = profileHasNuclearCapability(profile);
  if (nuclear && !capable && size >= NUCLEAR_MO_TEAMING_USD) return 'teaming';
  if (isSmallBusinessProfile(profile.businessType) && size >= MEGA_TEAMING_USD) return 'teaming';
  if (!profile.businessType && size >= MEGA_TEAMING_USD) return 'teaming';
  return 'prime';
}

function classOf(code: string | null, classes: Record<string, ComingBackCodeClass>): ComingBackCodeClass {
  if (code && classes[code]) return classes[code];
  return { state: 'inferred', provenance: 'unmatched contract NAICS' };
}

function stateLabel(state: ComingBackCodeState): string {
  if (state === 'primary_confirmed') return 'user-primary';
  if (state === 'secondary_confirmed') return 'user-secondary';
  if (state === 'evidence_supported') return 'evidence-supported';
  if (state === 'system_default') return 'system-default';
  return 'inferred';
}

function whyLine(row: {
  naics: string | null;
  codeState: ComingBackCodeState;
  codeProvenance: string;
  fit: ComingBackFit;
  nuclear: boolean;
}): string {
  const bits: string[] = [];
  bits.push(`${stateLabel(row.codeState)} NAICS ${row.naics || 'market'}`);
  bits.push(row.codeProvenance);
  if (row.nuclear && row.fit === 'teaming') bits.push('DOE/NNSA M&O — teaming, not prime');
  else if (row.fit === 'teaming') bits.push('size-fit teaming');
  else bits.push('size-fit prime');
  return bits.join(' · ');
}

function toRow(
  c: ExpiringContract,
  window: ComingBackWindow,
  profile: ComingBackProfile,
  classes: Record<string, ComingBackCodeClass>,
): ComingBackRow {
  const sized = contractSize(c);
  const classified = classOf(c.naics_code, classes);
  const fit = sizeFitFor(c, profile);
  const nuclear = isNuclearMoVehicle(c);
  return {
    contract_id: c.contract_id,
    incumbent: c.incumbent_name ?? null,
    agency: c.awarding_sub_agency || c.awarding_agency || null,
    naics: c.naics_code ?? null,
    psc: c.psc_code ?? null,
    value: sized.amount,
    valueKind: sized.kind,
    obligated: sized.obligated,
    popEnd: c.period_of_performance_current_end ?? null,
    leadMonths: c.lead_time_months ?? null,
    window,
    codeState: classified.state,
    codeProvenance: classified.provenance,
    censusTitle: censusTitleFor(c.naics_code),
    fit,
    nuclearMo: nuclear,
    why: whyLine({
      naics: c.naics_code ?? null,
      codeState: classified.state,
      codeProvenance: classified.provenance,
      fit,
      nuclear,
    }),
  };
}

function compareRanked(a: ComingBackRow, b: ComingBackRow): number {
  const win = WINDOW_RANK[b.window] - WINDOW_RANK[a.window];
  if (win !== 0) return win;
  const fitA = a.fit === 'prime' ? 1 : 0;
  const fitB = b.fit === 'prime' ? 1 : 0;
  if (fitA !== fitB) return fitB - fitA;
  const vb = b.value ?? -1;
  const va = a.value ?? -1;
  if (vb !== va) return vb - va;
  return 0;
}

function storedPscCodes(codes: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of codes || []) {
    const p = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^[A-Z0-9]{4}$/.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

export function inStoredComingBackMarket(
  c: Pick<ExpiringContract, 'naics_code' | 'psc_code'>,
  naics: string[],
  pscs: string[],
): boolean {
  const code = String(c.naics_code || '').trim();
  for (const n of naics) {
    if (!n) continue;
    if (n.length === 6) {
      if (code === n) return true;
      continue;
    }
    if (code.startsWith(n)) return true;
  }
  const p = String(c.psc_code || '').trim().toUpperCase();
  return p.length > 0 && pscs.includes(p);
}

function distinctiveHaystack(c: Pick<ExpiringContract, 'description' | 'psc_code'>): string {
  return [c.description, c.psc_code].filter(Boolean).join(' ');
}

/**
 * Pure rank + omit. Distinctive keywords prefer description/PSC hits inside
 * the stored NAICS/PSC market. They never match agency names (Interior collision)
 * and never expand the candidate set. Hit count is not a sort key.
 */
export function selectComingBackRows(input: {
  contracts: ExpiringContract[];
  count: number | null;
  degraded?: boolean;
  naicsCodes: string[];
  pscCodes?: string[];
  keywords?: string[];
  profile?: ComingBackProfile;
}): ComingBackDecision {
  if (input.degraded) return { kind: 'omit', reason: 'query_failed' };
  if (input.count == null) return { kind: 'omit', reason: 'unknown_count' };
  const stored = knownNaicsForMatch(
    input.profile?.storedNaics?.length ? input.profile.storedNaics : input.naicsCodes,
  );
  const storedPsc = storedPscCodes(input.profile?.storedPsc?.length ? input.profile.storedPsc : input.pscCodes);
  if (stored.length === 0 && storedPsc.length === 0) return { kind: 'omit', reason: 'no_naics_market' };

  const profile: ComingBackProfile = {
    storedNaics: stored,
    storedPsc,
    naicsSource: input.profile?.naicsSource ?? (isDefaultNaicsSet(stored) ? 'system_default' : input.profile?.naicsSource),
    keywords: input.profile?.keywords ?? input.keywords,
    businessType: input.profile?.businessType ?? null,
    businessDescription: input.profile?.businessDescription ?? null,
    awardNaics: input.profile?.awardNaics,
    naicsPriorities: input.profile?.naicsPriorities,
    codeClasses: input.profile?.codeClasses,
  };
  const classes = classifyCodes(profile);

  const market = input.contracts.filter((c) => inStoredComingBackMarket(c, stored, storedPsc));
  const preferred = preferDistinctiveInOpenMarket(market, profile.keywords || [], distinctiveHaystack);

  const scored: ComingBackRow[] = [];
  for (const c of preferred.rows) {
    const w = comingBackWindow(c.lead_time_months);
    if (w === 'exclude') continue;
    scored.push(toRow(c, w, profile, classes));
  }
  scored.sort(compareRanked);
  const picked = scored.slice(0, COMING_BACK_CAP);
  if (picked.length === 0) return { kind: 'omit', reason: 'none_qualify' };

  return {
    kind: 'show',
    matchedNaics: stored,
    rows: picked,
    starterMarket: isStarterMarket(classes),
  };
}

const COMING_BACK_COLUMNS =
  'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,naics_code,naics_description,psc_code,description,total_obligation,potential_total_value,period_of_performance_start,period_of_performance_current_end,place_of_performance_state,place_of_performance_city,set_aside_type,set_aside_enriched,competition_type,number_of_offers,estimated_recompete_date,lead_time_months,recompete_likelihood';

function marketOrExpression(naics: string[], pscs: string[]): string | null {
  const parts: string[] = [];
  const parsed = parseNaicsCodes(naics);
  if (parsed.length) parts.push(naicsOrExpression(parsed));
  for (const p of pscs) parts.push(`psc_code.eq.${p}`);
  return parts.length ? parts.join(',') : null;
}

async function pageComingBackMarket(naics: string[], pscs: string[]): Promise<
  | { ok: true; contracts: ExpiringContract[]; count: number }
  | { ok: false; reason: 'query_failed' | 'unknown_count' }
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, reason: 'query_failed' };
  const orExpr = marketOrExpression(naics, pscs);
  if (!orExpr) return { ok: false, reason: 'query_failed' };

  const sb = createClient(url, key);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const max = new Date(today);
  max.setMonth(max.getMonth() + TERTIARY_MONTHS);
  const maxStr = max.toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];

  try {
    for (let from = 0; ; from += MARKET_PAGE) {
      const { data, error } = await sb
        .from('recompete_opportunities')
        .select(COMING_BACK_COLUMNS)
        .is('quality_flag', null)
        .gt('period_of_performance_current_end', todayStr)
        .lte('period_of_performance_current_end', maxStr)
        .or(orExpr)
        .order('contract_id', { ascending: true })
        .range(from, from + MARKET_PAGE - 1);
      if (error) return { ok: false, reason: 'query_failed' };
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < MARKET_PAGE) break;
      if (rows.length >= MARKET_ROW_CAP) break;
    }
  } catch {
    return { ok: false, reason: 'query_failed' };
  }

  const now = new Date();
  const contracts = (rows as unknown as ExpiringContract[]).map((c) => {
    const timing = overlayRecompeteTiming(c.period_of_performance_current_end, now);
    const naics_description = c.naics_description ?? (c.naics_code ? getNaics(c.naics_code)?.title ?? null : null);
    if (!timing) return { ...c, naics_description };
    return {
      ...c,
      naics_description,
      lead_time_months: timing.lead_time_months,
      estimated_recompete_date: timing.estimated_recompete_date,
    };
  });
  return { ok: true, contracts, count: contracts.length };
}

export async function loadComingBackSection(profile: ComingBackProfile | string[]): Promise<ComingBackDecision> {
  const resolved: ComingBackProfile = Array.isArray(profile)
    ? { storedNaics: profile }
    : profile;
  const stored = knownNaicsForMatch(resolved.storedNaics);
  const storedPsc = storedPscCodes(resolved.storedPsc);
  if (stored.length === 0 && storedPsc.length === 0) return { kind: 'omit', reason: 'no_naics_market' };

  const paged = await pageComingBackMarket(stored, storedPsc);
  if (!paged.ok) return { kind: 'omit', reason: paged.reason };
  return selectComingBackRows({
    contracts: paged.contracts,
    count: paged.count,
    degraded: false,
    naicsCodes: stored,
    pscCodes: storedPsc,
    keywords: resolved.keywords,
    profile: { ...resolved, storedNaics: stored, storedPsc },
  });
}

export function formatComingBackValue(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function formatComingBackValueLabel(value: number | null, kind: ComingBackValueKind): string | null {
  const formatted = formatComingBackValue(value);
  if (!formatted) return null;
  return kind === 'ceiling' ? `Potential value (ceiling) ${formatted}` : `Obligated ${formatted}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPopEnd(iso: string | null): string {
  if (!iso) return 'date unknown';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function confirmUrlFromPanel(panelUrl: string): string {
  try {
    return new URL(COMING_BACK_CONFIRM_PATH, panelUrl).toString();
  } catch {
    return `https://getmindy.ai${COMING_BACK_CONFIRM_PATH}`;
  }
}

export function renderComingBackSection(
  decision: ComingBackDecision,
  opts: {
    panelUrl: string;
    trackedUrl?: (url: string, label: string, content?: string) => string;
  },
): string {
  if (decision.kind === 'omit') return '';

  const wrap = (url: string, label: string) =>
    opts.trackedUrl ? opts.trackedUrl(url, label, label) : url;
  const panelHref = wrap(opts.panelUrl, 'view_recompetes_panel');
  const confirmHref = wrap(confirmUrlFromPanel(opts.panelUrl), 'confirm_market');
  const heading = decision.starterMarket ? COMING_BACK_STARTER_HEADING : COMING_BACK_HEADING;

  const rows = decision.rows
    .map((row) => {
      const value = formatComingBackValueLabel(row.value, row.valueKind);
      const meta = [
        row.naics ? `NAICS ${esc(row.naics)}${row.censusTitle ? ` ${esc(row.censusTitle)}` : ''}` : '',
        row.psc ? `PSC ${esc(row.psc)}` : '',
        value ? esc(value) : '',
        row.fit === 'teaming' ? 'Teaming opportunity' : '',
      ]
        .filter(Boolean)
        .join(' &middot; ');
      const expires = formatPopEnd(row.popEnd);
      const provenance = [
        esc(row.why),
        `Expires ${esc(expires)}`,
      ]
        .filter(Boolean)
        .join(' &middot; ');
      const name = esc((row.incumbent || 'Incumbent not listed').slice(0, 90));
      const agency = esc((row.agency || 'Federal').slice(0, 42));
      return `
      <tr>
        <td style="padding:18px 0;border-bottom:1px solid #eceff3;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">
                ${agency}
              </td>
              <td align="right" style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:0.6px;white-space:nowrap;">
                EXPIRES ${esc(expires).toUpperCase()}
              </td>
            </tr>
          </table>
          <p style="margin:7px 0 0 0;color:#0f172a;font-size:16px;font-weight:700;line-height:1.35;">${name}</p>
          <p style="color:#64748b;font-size:12px;line-height:1.5;margin:6px 0 0 0;">${meta}</p>
          <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:3px 0 0 0;">${provenance}</p>
        </td>
      </tr>`;
    })
    .join('');

  const confirmLine = decision.starterMarket
    ? `<p style="margin:10px 0 0 0;"><a href="${confirmHref}" style="color:#4f46e5;font-size:13px;font-weight:700;text-decoration:none;">Confirm your market &rarr;</a></p>`
    : '';

  return `
  <p style="color:#0f172a;font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;margin:34px 0 0 0;">${heading}</p>
  <div style="height:1px;background:#e5e7eb;margin:10px 0 0 0;"></div>
  <p style="color:#475569;font-size:13px;line-height:1.6;margin:14px 0 0 0;">${COMING_BACK_EXPLAIN}</p>
  ${confirmLine}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
    ${rows}
  </table>
  <p style="margin:18px 0 0 0;">
    <a href="${panelHref}" style="color:#4f46e5;font-size:14px;font-weight:700;text-decoration:none;">View the full market &rarr;</a>
  </p>`;
}
