/**
 * Daily Alert "Coming Back to Market" — a second section, never mixed with Open.
 *
 * Market = stored NAICS via queryExpiringContracts. Keywords do not filter or
 * prefer contracts. They are read only to detect nuclear / M&O capability.
 * Empty description does not drop a row. Query failure or unknown count omits
 * the section. Zero is not a success label.
 *
 * Rank: customer relevance first, 6–18 timing second, size-fit third, value last.
 * A lone 561210 must not let DOE nuclear M&O occupy all five slots.
 */
import { DEFAULT_PROFILE_NAICS } from '@/lib/alerts/profile-setup';
import type { NaicsProvenance } from '@/lib/profile/company-setup-outcome';
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';

export const COMING_BACK_CAP = 5;
export const COMING_BACK_PANEL_PATH = '/app?panel=recompetes';
export const COMING_BACK_HEADING = 'Coming Back to Market';
export const COMING_BACK_EXPLAIN =
  'These are existing contracts approaching expiration — not confirmed solicitations. Use them to prepare capture, not to bid today. Dollar figures are the current ceiling or amount obligated, not a promised recompete value.';
export const MEGA_TEAMING_USD = 250_000_000;
export const NUCLEAR_MO_TEAMING_USD = 50_000_000;
export const MAX_PER_NAICS = 2;

export type ComingBackOmitReason =
  | 'no_naics_market'
  | 'none_qualify'
  | 'query_failed'
  | 'unknown_count';

export type ComingBackWindow = 'lead_6_18' | 'inside_6';
export type ComingBackNaicsRole = 'core' | 'secondary';
export type ComingBackFit = 'prime' | 'teaming';
export type ComingBackValueKind = 'ceiling' | 'obligated';

export type ComingBackProfile = {
  storedNaics: string[];
  naicsSource?: NaicsProvenance | null;
  keywords?: string[];
  businessType?: string | null;
  businessDescription?: string | null;
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
  naicsRole: ComingBackNaicsRole;
  fit: ComingBackFit;
  nuclearMo: boolean;
  why: string;
};

export type ComingBackDecision =
  | { kind: 'omit'; reason: ComingBackOmitReason }
  | { kind: 'show'; rows: ComingBackRow[]; matchedNaics: string[] };

const NUCLEAR_MO_VEHICLE =
  /consolidated nuclear|savannah river nuclear|solutions of sandia|sandia, llc|\bsandia\b|mission support & test|mission support and test|national nuclear|\bnnsa\b|nuclear security|nuclear solutions|management and operat/;

const NUCLEAR_CAPABILITY =
  /nuclear|\bnnsa\b|national.?security.?site|national lab|management and operat|\bm&o\b/;

const SMALL_BUSINESS =
  /small business|sdvosb|wosb|edwosb|8\(a\)|hubzone|\bvosb\b|veteran/i;

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

export function comingBackWindow(leadMonths: number | null | undefined): ComingBackWindow | 'outside' {
  if (leadMonths == null || !Number.isFinite(leadMonths)) return 'outside';
  if (leadMonths >= 6 && leadMonths <= 18) return 'lead_6_18';
  if (leadMonths >= 0 && leadMonths < 6) return 'inside_6';
  return 'outside';
}

export function classifyNaicsRoles(storedNaics: string[]): { core: string[]; secondary: string[] } {
  const codes = (storedNaics || []).map((c) => String(c || '').trim()).filter((c) => /^\d{2,6}$/.test(c));
  if (codes.length === 0) return { core: [], secondary: [] };
  const byFam = new Map<string, string[]>();
  for (const c of codes) {
    const fam = c.slice(0, 3);
    const list = byFam.get(fam) || [];
    list.push(c);
    byFam.set(fam, list);
  }
  let max = 0;
  for (const list of byFam.values()) max = Math.max(max, list.length);
  const core: string[] = [];
  const secondary: string[] = [];
  for (const list of byFam.values()) {
    if (list.length === max) core.push(...list);
    else secondary.push(...list);
  }
  return { core, secondary };
}

export function isDefaultNaicsSet(storedNaics: string[]): boolean {
  const set = new Set((storedNaics || []).map((c) => String(c).trim()).filter(Boolean));
  if (set.size === 0) return false;
  return [...set].every((c) => DEFAULT_PROFILE_NAICS.includes(c)) && set.size <= DEFAULT_PROFILE_NAICS.length;
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

function naicsRoleOf(code: string | null, roles: { core: string[]; secondary: string[] }): ComingBackNaicsRole {
  if (!code) return 'secondary';
  if (roles.core.includes(code)) return 'core';
  if (roles.secondary.includes(code)) return 'secondary';
  const fam = code.slice(0, 3);
  if (roles.core.some((c) => c.slice(0, 3) === fam)) return 'core';
  return 'secondary';
}

function relevanceRank(role: ComingBackNaicsRole, source: NaicsProvenance | null | undefined): number {
  const roleScore = role === 'core' ? 20 : 8;
  if (source === 'system_default') return roleScore - 4;
  if (source === 'derived_suggestion') return roleScore - 2;
  return roleScore;
}

function whyLine(input: {
  naics: string | null;
  role: ComingBackNaicsRole;
  fit: ComingBackFit;
  nuclear: boolean;
  source: NaicsProvenance | null | undefined;
}): string {
  const bits: string[] = [];
  if (input.role === 'core') bits.push(`Core NAICS ${input.naics || 'market'}`);
  else bits.push(`Secondary NAICS ${input.naics || 'market'}`);
  if (input.source === 'system_default') bits.push('default profile code');
  if (input.nuclear && input.fit === 'teaming') bits.push('DOE/NNSA M&O — teaming, not prime');
  else if (input.fit === 'teaming') bits.push('size-fit teaming');
  else bits.push('size-fit prime');
  return bits.join(' · ');
}

function toRow(
  c: ExpiringContract,
  window: ComingBackWindow,
  profile: ComingBackProfile,
  roles: { core: string[]; secondary: string[] },
): ComingBackRow {
  const sized = contractSize(c);
  const role = naicsRoleOf(c.naics_code, roles);
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
    naicsRole: role,
    fit,
    nuclearMo: nuclear,
    why: whyLine({
      naics: c.naics_code ?? null,
      role,
      fit,
      nuclear,
      source: profile.naicsSource,
    }),
  };
}

function rankRole(row: ComingBackRow): ComingBackNaicsRole {
  if (row.nuclearMo && row.fit === 'teaming') return 'secondary';
  return row.naicsRole;
}

function compareRanked(a: ComingBackRow, b: ComingBackRow, source: NaicsProvenance | null | undefined): number {
  const rel = relevanceRank(rankRole(b), source) - relevanceRank(rankRole(a), source);
  if (rel !== 0) return rel;
  const winA = a.window === 'lead_6_18' ? 1 : 0;
  const winB = b.window === 'lead_6_18' ? 1 : 0;
  if (winA !== winB) return winB - winA;
  const fitA = a.fit === 'prime' ? 1 : 0;
  const fitB = b.fit === 'prime' ? 1 : 0;
  if (fitA !== fitB) return fitB - fitA;
  const vb = b.value ?? -1;
  const va = a.value ?? -1;
  if (vb !== va) return vb - va;
  return 0;
}

function pickDiversified(ranked: ComingBackRow[]): ComingBackRow[] {
  const picked: ComingBackRow[] = [];
  const perNaics = new Map<string, number>();
  const take = (row: ComingBackRow, enforceCap: boolean) => {
    const key = row.naics || row.contract_id;
    const used = perNaics.get(key) || 0;
    if (enforceCap && used >= MAX_PER_NAICS) return;
    picked.push(row);
    perNaics.set(key, used + 1);
  };
  for (const row of ranked) {
    if (picked.length >= COMING_BACK_CAP) break;
    take(row, true);
  }
  if (picked.length < COMING_BACK_CAP) {
    const have = new Set(picked.map((r) => r.contract_id));
    for (const row of ranked) {
      if (picked.length >= COMING_BACK_CAP) break;
      if (have.has(row.contract_id)) continue;
      take(row, false);
    }
  }
  return picked;
}

/**
 * Pure rank + omit. `keywords` never filter the contract list. They only feed
 * nuclear-capability detection on the profile.
 */
export function selectComingBackRows(input: {
  contracts: ExpiringContract[];
  count: number | null;
  degraded?: boolean;
  naicsCodes: string[];
  keywords?: string[];
  profile?: ComingBackProfile;
}): ComingBackDecision {
  void input.keywords;
  if (input.degraded) return { kind: 'omit', reason: 'query_failed' };
  if (input.count == null) return { kind: 'omit', reason: 'unknown_count' };
  const stored = (input.profile?.storedNaics?.length ? input.profile.storedNaics : input.naicsCodes)
    .map((c) => String(c || '').trim())
    .filter(Boolean);
  if (stored.length === 0) return { kind: 'omit', reason: 'no_naics_market' };

  const profile: ComingBackProfile = {
    storedNaics: stored,
    naicsSource: input.profile?.naicsSource ?? (isDefaultNaicsSet(stored) ? 'system_default' : input.profile?.naicsSource),
    keywords: input.profile?.keywords ?? input.keywords,
    businessType: input.profile?.businessType ?? null,
    businessDescription: input.profile?.businessDescription ?? null,
  };
  const roles = classifyNaicsRoles(stored);

  const scored: ComingBackRow[] = [];
  for (const c of input.contracts) {
    const w = comingBackWindow(c.lead_time_months);
    if (w === 'outside') continue;
    scored.push(toRow(c, w, profile, roles));
  }
  scored.sort((a, b) => compareRanked(a, b, profile.naicsSource));
  const picked = pickDiversified(scored);
  if (picked.length === 0) return { kind: 'omit', reason: 'none_qualify' };

  return {
    kind: 'show',
    matchedNaics: stored,
    rows: picked,
  };
}

async function safeQuery(
  input: Parameters<typeof queryExpiringContracts>[0],
): Promise<{ ok: true; result: Awaited<ReturnType<typeof queryExpiringContracts>> } | { ok: false; reason: 'query_failed' | 'unknown_count' }> {
  try {
    const result = await queryExpiringContracts(input);
    if (result.degraded) return { ok: false, reason: 'query_failed' };
    if (result.count == null) return { ok: false, reason: 'unknown_count' };
    return { ok: true, result };
  } catch {
    return { ok: false, reason: 'query_failed' };
  }
}

export async function loadComingBackSection(profile: ComingBackProfile | string[]): Promise<ComingBackDecision> {
  const resolved: ComingBackProfile = Array.isArray(profile)
    ? { storedNaics: profile }
    : profile;
  const stored = (resolved.storedNaics || []).map((c) => String(c || '').trim()).filter(Boolean);
  if (stored.length === 0) return { kind: 'omit', reason: 'no_naics_market' };

  const roles = classifyNaicsRoles(stored);
  const fetchCodes = [...roles.core.slice(0, 5), ...roles.secondary.slice(0, 2)];
  const unique = [...new Set(fetchCodes)];

  try {
    const jobs = unique.flatMap((code) => [
      safeQuery({
        naicsCodes: [code],
        minMonthsWindow: 6,
        monthsWindow: 18,
        orderBy: 'expiry',
        limit: 40,
      }),
      safeQuery({
        naicsCodes: [code],
        monthsWindow: 6,
        orderBy: 'expiry',
        limit: 15,
      }),
    ]);
    const settled = await Promise.all(jobs);
    const ok = settled.filter((s): s is { ok: true; result: Awaited<ReturnType<typeof queryExpiringContracts>> } => s.ok);
    if (ok.length === 0) {
      const failed = settled.find((s) => !s.ok && s.reason === 'query_failed');
      return { kind: 'omit', reason: failed ? 'query_failed' : 'unknown_count' };
    }
    const seen = new Set<string>();
    const contracts: ExpiringContract[] = [];
    let count = 0;
    for (const item of ok) {
      count += item.result.count ?? 0;
      for (const c of item.result.contracts) {
        if (seen.has(c.contract_id)) continue;
        seen.add(c.contract_id);
        contracts.push(c);
      }
    }
    return selectComingBackRows({
      contracts,
      count,
      degraded: false,
      naicsCodes: stored,
      keywords: resolved.keywords,
      profile: { ...resolved, storedNaics: stored },
    });
  } catch {
    return { kind: 'omit', reason: 'query_failed' };
  }
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

  const rows = decision.rows
    .map((row) => {
      const value = formatComingBackValueLabel(row.value, row.valueKind);
      const meta = [
        row.naics ? `NAICS ${esc(row.naics)}` : '',
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

  return `
  <p style="color:#0f172a;font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;margin:34px 0 0 0;">${COMING_BACK_HEADING}</p>
  <div style="height:1px;background:#e5e7eb;margin:10px 0 0 0;"></div>
  <p style="color:#475569;font-size:13px;line-height:1.6;margin:14px 0 0 0;">${COMING_BACK_EXPLAIN}</p>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
    ${rows}
  </table>
  <p style="margin:18px 0 0 0;">
    <a href="${panelHref}" style="color:#4f46e5;font-size:14px;font-weight:700;text-decoration:none;">View the full market &rarr;</a>
  </p>`;
}
