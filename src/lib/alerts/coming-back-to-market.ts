/**
 * Daily Alert "Coming Back to Market" — a second section, never mixed with Open.
 *
 * Market = NAICS via queryExpiringContracts. Keywords are not a filter, not a
 * prefer, and not an agency-name search. Empty description does not drop a row.
 * Query failure or unknown count omits the section. Zero is not a success label.
 */
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';

export const COMING_BACK_CAP = 5;
export const COMING_BACK_PANEL_PATH = '/app?panel=recompetes';
export const COMING_BACK_HEADING = 'Coming Back to Market';
export const COMING_BACK_EXPLAIN =
  'These are existing contracts approaching expiration — not confirmed solicitations. Use them to prepare capture, not to bid today.';

export type ComingBackOmitReason =
  | 'no_naics_market'
  | 'none_qualify'
  | 'query_failed'
  | 'unknown_count';

export type ComingBackWindow = 'lead_6_18' | 'inside_6';

export type ComingBackRow = {
  contract_id: string;
  incumbent: string | null;
  agency: string | null;
  naics: string | null;
  psc: string | null;
  value: number | null;
  popEnd: string | null;
  leadMonths: number | null;
  window: ComingBackWindow;
};

export type ComingBackDecision =
  | { kind: 'omit'; reason: ComingBackOmitReason }
  | { kind: 'show'; rows: ComingBackRow[]; matchedNaics: string[] };

export function contractValue(c: Pick<ExpiringContract, 'potential_total_value' | 'total_obligation'>): number | null {
  const raw = c.potential_total_value ?? c.total_obligation;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function comingBackWindow(leadMonths: number | null | undefined): ComingBackWindow | 'outside' {
  if (leadMonths == null || !Number.isFinite(leadMonths)) return 'outside';
  if (leadMonths >= 6 && leadMonths <= 18) return 'lead_6_18';
  if (leadMonths >= 0 && leadMonths < 6) return 'inside_6';
  return 'outside';
}

function activityTs(c: Pick<ExpiringContract, 'period_of_performance_start'>): number {
  const start = c.period_of_performance_start;
  if (!start) return 0;
  const t = new Date(start).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function compareByValueThenActivity(a: ExpiringContract, b: ExpiringContract): number {
  const vb = contractValue(b) ?? -1;
  const va = contractValue(a) ?? -1;
  if (vb !== va) return vb - va;
  return activityTs(b) - activityTs(a);
}

function toRow(c: ExpiringContract, window: ComingBackWindow): ComingBackRow {
  return {
    contract_id: c.contract_id,
    incumbent: c.incumbent_name ?? null,
    agency: c.awarding_sub_agency || c.awarding_agency || null,
    naics: c.naics_code ?? null,
    psc: c.psc_code ?? null,
    value: contractValue(c),
    popEnd: c.period_of_performance_current_end ?? null,
    leadMonths: c.lead_time_months ?? null,
    window,
  };
}

/**
 * Pure rank + omit. `keywords` is accepted only so a caller cannot accidentally
 * believe this section reads them — they are ignored.
 */
export function selectComingBackRows(input: {
  contracts: ExpiringContract[];
  count: number | null;
  degraded?: boolean;
  naicsCodes: string[];
  keywords?: string[];
}): ComingBackDecision {
  void input.keywords;
  if (input.degraded) return { kind: 'omit', reason: 'query_failed' };
  if (input.count == null) return { kind: 'omit', reason: 'unknown_count' };
  const matchedNaics = (input.naicsCodes || []).map((c) => String(c || '').trim()).filter(Boolean);
  if (matchedNaics.length === 0) return { kind: 'omit', reason: 'no_naics_market' };

  const lead: ExpiringContract[] = [];
  const soon: ExpiringContract[] = [];
  for (const c of input.contracts) {
    const w = comingBackWindow(c.lead_time_months);
    if (w === 'lead_6_18') lead.push(c);
    else if (w === 'inside_6') soon.push(c);
  }
  lead.sort(compareByValueThenActivity);
  soon.sort(compareByValueThenActivity);
  const picked = [...lead, ...soon].slice(0, COMING_BACK_CAP);
  if (picked.length === 0) return { kind: 'omit', reason: 'none_qualify' };

  return {
    kind: 'show',
    matchedNaics,
    rows: picked.map((c) => toRow(c, comingBackWindow(c.lead_time_months) as ComingBackWindow)),
  };
}

export async function loadComingBackSection(naicsCodes: string[]): Promise<ComingBackDecision> {
  const codes = (naicsCodes || []).map((c) => String(c || '').trim()).filter(Boolean);
  if (codes.length === 0) return { kind: 'omit', reason: 'no_naics_market' };
  try {
    const [lead, soon] = await Promise.all([
      queryExpiringContracts({
        naicsCodes: codes,
        minMonthsWindow: 6,
        monthsWindow: 18,
        orderBy: 'value',
        limit: 200,
      }),
      queryExpiringContracts({
        naicsCodes: codes,
        monthsWindow: 6,
        orderBy: 'value',
        limit: 200,
      }),
    ]);
    if (lead.degraded || soon.degraded) return { kind: 'omit', reason: 'query_failed' };
    if (lead.count == null || soon.count == null) return { kind: 'omit', reason: 'unknown_count' };
    const seen = new Set<string>();
    const contracts: ExpiringContract[] = [];
    for (const c of [...lead.contracts, ...soon.contracts]) {
      if (seen.has(c.contract_id)) continue;
      seen.add(c.contract_id);
      contracts.push(c);
    }
    return selectComingBackRows({
      contracts,
      count: lead.count + soon.count,
      degraded: false,
      naicsCodes: codes,
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
  const codes = decision.matchedNaics.slice(0, 5).join(', ');

  const rows = decision.rows
    .map((row) => {
      const value = formatComingBackValue(row.value);
      const meta = [
        row.naics ? `NAICS ${esc(row.naics)}` : '',
        row.psc ? `PSC ${esc(row.psc)}` : '',
        value ? esc(value) : '',
      ]
        .filter(Boolean)
        .join(' &middot; ');
      const expires = formatPopEnd(row.popEnd);
      const provenance = [
        row.naics ? `Matched on NAICS ${esc(row.naics)}` : codes ? `Matched on NAICS ${esc(codes)}` : '',
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
