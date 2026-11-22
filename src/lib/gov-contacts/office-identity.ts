/**
 * Office-code identity by majority vote — never ANY_VALUE.
 *
 * An awarding office code (DoDAAC / civilian office code) is not unique for agency in the award
 * warehouse: miskeyed transactions and assisted acquisitions put a code under another agency.
 * The old lookups took ANY_VALUE(awarding_agency) and ANY_VALUE(awarding_sub_agency) INDEPENDENTLY,
 * so one stray row could label CBP's 70B01C "Federal Trade Commission" — and the agency and
 * sub-agency could even come from different rows (reported 2026-11-22: 70B01C shown under both
 * DHS / U.S. Border Patrol and the FTC).
 *
 * Rule: count rows per (agency, sub_agency) pair for the code. The leading pair is the office's
 * identity only when it holds at least OFFICE_IDENTITY_MIN_SHARE of the code's rows; otherwise the
 * agency is UNKNOWN (identity_basis 'conflicting') — never the minority value, never a guess.
 * The office name is the most frequent name within the winning pair.
 */
export const OFFICE_IDENTITY_MIN_SHARE = 0.8;

export interface OfficeIdentityCandidate {
  code: string | null;
  name: string | null;
  agency: string | null;
  sub_agency: string | null;
  /** Rows (transactions) carrying this exact (code, name, agency, sub_agency). */
  n: number | string;
}

export type OfficeIdentityBasis = 'majority' | 'conflicting';

export interface OfficeIdentity {
  code: string;
  name: string | null;
  agency: string | null;
  sub_agency: string | null;
  identity_basis: OfficeIdentityBasis;
  /** Share of the code's rows held by the leading (agency, sub_agency) pair, 0–1. */
  agency_share: number;
  /** The leading pair even when it falls short of the threshold (evidence only — never displayed as the agency). */
  leader: { agency: string | null; sub_agency: string | null };
  /** The second (agency, sub_agency) pair and its share — the evidence a later correction needs. */
  runner_up: { agency: string | null; sub_agency: string | null; share: number } | null;
  rows: number;
}

const norm = (s: string | null | undefined) => (s ?? '').trim();

export function voteOfficeIdentity(candidates: OfficeIdentityCandidate[]): Map<string, OfficeIdentity> {
  const byCode = new Map<string, OfficeIdentityCandidate[]>();
  for (const c of candidates) {
    const code = norm(c.code);
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(c);
    byCode.set(code, list);
  }
  const out = new Map<string, OfficeIdentity>();
  for (const [code, list] of byCode) {
    const pairs = new Map<string, { agency: string | null; sub: string | null; n: number; names: Map<string, number> }>();
    let total = 0;
    for (const c of list) {
      const n = Number(c.n) || 0;
      if (n <= 0) continue;
      total += n;
      const key = `${norm(c.agency).toUpperCase()}\u0000${norm(c.sub_agency).toUpperCase()}`;
      const p = pairs.get(key) ?? { agency: norm(c.agency) || null, sub: norm(c.sub_agency) || null, n: 0, names: new Map() };
      p.n += n;
      const name = norm(c.name);
      if (name) p.names.set(name, (p.names.get(name) ?? 0) + n);
      pairs.set(key, p);
    }
    if (total === 0) continue;
    // Deterministic: most rows, then alphabetical, so equal splits never flip between runs.
    const ranked = [...pairs.values()].sort((a, b) => b.n - a.n || `${a.agency}|${a.sub}`.localeCompare(`${b.agency}|${b.sub}`));
    const top = ranked[0];
    const share = top.n / total;
    const majority = share >= OFFICE_IDENTITY_MIN_SHARE;
    const topName = [...top.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    out.set(code, {
      code,
      // The name is only trustworthy with the identity it belongs to.
      name: majority ? topName : null,
      agency: majority ? top.agency : null,
      sub_agency: majority ? top.sub : null,
      identity_basis: majority ? 'majority' : 'conflicting',
      agency_share: Math.round(share * 1000) / 1000,
      leader: { agency: top.agency, sub_agency: top.sub },
      runner_up: ranked[1] ? { agency: ranked[1].agency, sub_agency: ranked[1].sub, share: Math.round((ranked[1].n / total) * 1000) / 1000 } : null,
      rows: total,
    });
  }
  return out;
}

export const CONFLICT_EVIDENCE_SAMPLE = 25;

/**
 * Bounded vote evidence for conflicting codes (largest first): office codes and agency names only — no
 * customer data. Lands in the refresh's response body and one log line (runtime-log retention), never in a
 * table; at most CONFLICT_EVIDENCE_SAMPLE entries.
 */
export function conflictEvidenceSample(ids: Map<string, OfficeIdentity>) {
  return [...ids.values()]
    .filter((i) => i.identity_basis === 'conflicting')
    .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code))
    .slice(0, CONFLICT_EVIDENCE_SAMPLE)
    .map((i) => ({ code: i.code, leader: i.leader, leader_share: i.agency_share, runner_up: i.runner_up, rows: i.rows }));
}
