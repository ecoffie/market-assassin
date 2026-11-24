/**
 * Intelligence gate, multi-state questions ("VA, MD and DC"): the report tool measures one state at a time,
 * so the gate gathers each state separately and merges them here. Merging only combines what each state
 * returned (dedupe, sum, re-rank). It never adds a figure.
 */
import type { MarketReportResult } from '@/mcp/tools/market-report';

type Row = Record<string, unknown>;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function sumBy(rows: Row[], key: (r: Row) => string, amountField: string, keep: number): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const prev = m.get(k);
    m.set(k, prev ? { ...prev, [amountField]: num(prev[amountField]) + num(r[amountField]) } : { ...r });
  }
  return [...m.values()].sort((a, b) => num(b[amountField]) - num(a[amountField])).slice(0, keep);
}

function dedupe(rows: Row[], key: (r: Row) => string): Row[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = key(r);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function mergeStateEvidence(results: MarketReportResult[], states: string[]): MarketReportResult {
  if (results.length === 1) return results[0];
  const ok = results.filter((r) => r._meta.publication_state !== 'measurement_failure');
  if (!ok.length) return results[0];
  const base = ok[0];
  const all = <T,>(f: (r: MarketReportResult) => T[] | undefined) => ok.flatMap((r) => f(r) || []);
  const s = (r: MarketReportResult) => r.sections as unknown as Record<string, { [k: string]: unknown } | unknown[] | null>;

  const recompetes = dedupe(all((r) => (r.sections.recompetes?.contracts as Row[]) || []), (r) => String(r.contract_id || ''));
  const forecasts = dedupe(all((r) => (r.sections.forecasts?.forecasts as Row[]) || []), (r) => String(r.forecast_id || r.id || r.title || ''));
  const topAgencies = sumBy(all((r) => r.sections.top_agencies as unknown as Row[]), (r) => String(r.name || ''), 'amount', 10);
  const contractors = sumBy(
    all((r) => ((s(r).competition as { contractors?: Row[] } | null)?.contractors) || []),
    (r) => String(r.recipient_uei || r.recipient_name || ''),
    'total_obligated',
    15,
  );
  const contactSets = ok.map((r) => s(r).contacts as { people?: Row[]; office_codes?: string[] } | null).filter(Boolean) as Array<{ people?: Row[]; office_codes?: string[] }>;
  const people = dedupe(contactSets.flatMap((c) => c.people || []), (p) => `${p.office_code}|${p.name}|${p.email}`);
  const contacts = contactSets.length
    ? { ...contactSets[0], people, office_codes: [...new Set(contactSets.flatMap((c) => c.office_codes || []))], total: people.length }
    : null;

  const basis = base.summary.total_market_basis as Record<string, unknown> | undefined;
  return {
    ...base,
    summary: {
      ...base.summary,
      recompetes: recompetes.length,
      forecasts: forecasts.length,
      buying_agencies: topAgencies.length,
      top_contractors: contractors.length,
      contacts: people.length,
      ...(basis ? { total_market_basis: { ...basis, requested_state: states.join(', ') } } : {}),
    } as MarketReportResult['summary'],
    sections: {
      ...base.sections,
      top_agencies: topAgencies as unknown as MarketReportResult['sections']['top_agencies'],
      top_agencies_total: topAgencies.length,
      competition: { contractors, count: contractors.length },
      recompetes: { ...base.sections.recompetes, contracts: recompetes, count: recompetes.length },
      forecasts: { forecasts, count: forecasts.length },
      contacts: contacts as unknown as MarketReportResult['sections']['contacts'],
    },
  };
}
