/**
 * CHAIN-3 — the decision layer. Consumes structured upstream evidence; never re-derives.
 *
 * ── THE TWO FAILURES THIS CLOSES (measured, 2026-08-25) ────────────────────────────────
 *
 * FLUIDYNE — evidence RETRIEVED, then IGNORED. `capability_market_match` returned six
 * tables and no recommendation, and it re-derived the market from FREE-TEXT KEYWORDS
 * instead of the company's own award history. Result: lead_keyword "manufactures", top
 * NAICS ammunition / guided-missile / navigation (none of Fluidyne's six real award
 * codes), and "competitors" Boeing ($10.8B) and Raytheon ($6.4B) for a $20M fluid-power
 * manufacturer.
 *
 * NORTH STAR — evidence NEVER RETRIEVED, and where retrieved, MIS-ATTRIBUTED. Its own
 * SABER task order ranked ~568 of 6,864 and was cut (NS-2), and FA4610 read as "Air Force"
 * because the customer lives in `office_address.city`, not `sub_tier` (NS-3).
 *
 * Together: **fixing the decision layer without fixing the evidence produces a layer that
 * is grounded and still wrong.** So this module CANNOT fetch. It takes an evidence object
 * assembled by NS-1/NS-2/NS-3 and refuses to answer when the evidence is absent.
 *
 * ── THE RULE THAT SHAPES THE OUTPUT ───────────────────────────────────────────────────
 * Separate what a company HAS DEMONSTRATED from what it COULD pursue. A demonstrated
 * relationship (awards won at a named customer) is evidence; an adjacent market is a
 * hypothesis. Presenting them in one undifferentiated list is how "you could sell to
 * Boeing's market" ends up next to "you already work for Space Launch Delta 30".
 */

/** One award the company actually won. */
export interface DemonstratedAward {
  piid: string;
  naicsCode: string | null;
  value: number | null;
  endsOn: string | null;
  /** Operational customer resolved by NS-3, when the evidence supported one. */
  customer?: {
    component: string | null;
    unit: string | null;
    installation: string | null;
    divergesFromAdministrative: boolean;
  } | null;
}

/** A recompete reachable on a vehicle the company already holds (NS-2 anchored). */
export interface ReachableOpportunity {
  piid: string;
  incumbentName: string | null;
  incumbentUei: string | null;
  naicsCode: string | null;
  value: number | null;
  endsOn: string | null;
  /** True when the company itself is the incumbent — a renewal, not a capture. */
  isOwnIncumbency: boolean;
}

export interface PursuitEvidence {
  company: { name: string; uei: string | null };
  /** NS-1: identity facts, tri-state preserved. `undefined` means unknown, never false. */
  identity: {
    registrationStatus: string | null;
    naicsCodes: string[];
    has8a?: boolean;
    hasHUBZone?: boolean;
    hasWOSB?: boolean;
    hasSDVOSB?: boolean;
  };
  demonstrated: DemonstratedAward[];
  reachable: ReachableOpportunity[];
  /** Any upstream hop that could not be established. Blocks confident recommendation. */
  evidenceGaps: string[];
}

export interface Recommendation {
  /** What to pursue, in priority order. Empty when the evidence cannot support one. */
  pursuits: Array<{
    what: string;
    why: string;
    basis: 'demonstrated' | 'adjacent';
    /** The specific evidence rows behind it — never a summary. */
    evidence: string[];
    value: number | null;
    endsOn: string | null;
  }>;
  /** What the company has PROVEN, separate from what it might do. */
  demonstratedProfile: {
    customers: Array<{ label: string; awards: number; value: number }>;
    naicsCodes: string[];
    totalValue: number;
  };
  /** Honest refusal when evidence is missing. Never a hedge on a confident answer. */
  cannotAnswer: string | null;
  /** Every gap that limited the answer, so a reader knows what was NOT considered. */
  caveats: string[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Produce a pursuit recommendation from evidence. PURE — no fetching, no LLM, no keyword
 * re-derivation. If the evidence does not support an answer, it says so.
 */
export function recommendPursuits(ev: PursuitEvidence): Recommendation {
  const caveats: string[] = [...ev.evidenceGaps];

  // ── REFUSE rather than invent. Fluidyne's failure was answering confidently from
  // free-text keywords when the award history was right there; the mirror-image failure
  // is answering confidently when there is no history at all.
  if (!ev.demonstrated.length) {
    return {
      pursuits: [],
      demonstratedProfile: { customers: [], naicsCodes: [], totalValue: 0 },
      cannotAnswer:
        `No award history was established for ${ev.company.name}, so there is no demonstrated `
        + `basis for a pursuit recommendation. Recommending markets from a description alone would `
        + `be a guess presented as analysis.`,
      caveats,
    };
  }

  // ── DEMONSTRATED PROFILE — what the company has actually proven, grouped by the
  // OPERATIONAL customer (NS-3), not the administrative hierarchy.
  const byCustomer = new Map<string, { awards: number; value: number; diverges: boolean }>();
  for (const a of ev.demonstrated) {
    const label = a.customer?.unit || a.customer?.component || a.customer?.installation || 'Unattributed';
    const cur = byCustomer.get(label) || { awards: 0, value: 0, diverges: false };
    cur.awards += 1;
    cur.value += a.value || 0;
    cur.diverges = cur.diverges || !!a.customer?.divergesFromAdministrative;
    byCustomer.set(label, cur);
  }
  const customers = [...byCustomer.entries()]
    .map(([label, v]) => ({ label, awards: v.awards, value: v.value, diverges: v.diverges }))
    .sort((a, b) => b.value - a.value);

  const totalValue = ev.demonstrated.reduce((s, a) => s + (a.value || 0), 0);
  const demoNaics = [...new Set(ev.demonstrated.map((a) => a.naicsCode).filter(Boolean) as string[])];

  const pursuits: Recommendation['pursuits'] = [];

  // ── 1. RENEWALS: the company's own expiring work. Highest confidence — it is already
  // performing, and losing it is the largest single downside in the evidence set.
  const renewals = ev.reachable.filter((r) => r.isOwnIncumbency).sort(byEnd);
  for (const r of renewals.slice(0, 3)) {
    const cust = ev.demonstrated.find((d) => d.piid === r.piid)?.customer;
    pursuits.push({
      what: `Defend ${r.piid}${cust?.unit ? ` (${cust.unit})` : ''}`,
      why: `You are the incumbent and it expires ${r.endsOn}. This is work you already perform`
        + `${cust?.unit ? ` for ${cust.unit}` : ''} — protecting it precedes winning anything new.`,
      basis: 'demonstrated',
      evidence: [`${r.piid} · incumbent · ends ${r.endsOn}${r.value ? ` · ${money(r.value)}` : ''}`],
      value: r.value,
      endsOn: r.endsOn,
    });
  }

  // ── 2. SAME CUSTOMER, DIFFERENT INCUMBENT: recompetes on a vehicle the company already
  // holds, currently performed by someone else. Demonstrated access, contestable work.
  const sameCustomer = ev.reachable.filter((r) => !r.isOwnIncumbency).sort(byEnd);
  const topCustomer = customers[0];
  for (const r of sameCustomer.slice(0, 3)) {
    pursuits.push({
      what: `Compete ${r.piid} — incumbent ${r.incumbentName || 'unknown'}`,
      why: `Same contracting office as work you already hold${topCustomer ? ` for ${topCustomer.label}` : ''}. `
        + `You have demonstrated past performance with this customer; ${r.incumbentName || 'the incumbent'} holds this one until ${r.endsOn}.`,
      basis: 'demonstrated',
      evidence: [
        `${r.piid} · incumbent ${r.incumbentName || '?'} · ends ${r.endsOn}`,
        ...(topCustomer ? [`your ${topCustomer.awards} award(s) with ${topCustomer.label} · ${money(topCustomer.value)}`] : []),
      ],
      value: r.value,
      endsOn: r.endsOn,
    });
  }

  // ── 3. SET-ASIDE LEVERAGE — only where the identity evidence AFFIRMS it. A tri-state
  // `undefined` is unknown, and an unknown certification must never become a claim.
  const certs = [
    ev.identity.has8a === true ? '8(a)' : null,
    ev.identity.hasHUBZone === true ? 'HUBZone' : null,
    ev.identity.hasWOSB === true ? 'WOSB' : null,
    ev.identity.hasSDVOSB === true ? 'SDVOSB' : null,
  ].filter(Boolean) as string[];
  if (certs.length && topCustomer) {
    pursuits.push({
      what: `Use ${certs.join(' + ')} standing with ${topCustomer.label}`,
      why: `You hold ${certs.join(', ')} and have ${topCustomer.awards} award(s) worth ${money(topCustomer.value)} `
        + `with ${topCustomer.label}. Set-aside eligibility plus demonstrated performance at the same customer is the `
        + `strongest combination available in this evidence.`,
      basis: 'demonstrated',
      evidence: [
        `certifications: ${certs.join(', ')} (SAM registration)`,
        `${topCustomer.awards} award(s) · ${money(topCustomer.value)} · ${topCustomer.label}`,
      ],
      value: topCustomer.value,
      endsOn: null,
    });
  }

  // ── Caveats: name what was NOT considered, so a reader can tell the boundary of the
  // answer from the boundary of the market.
  const unknownCerts = (['has8a', 'hasHUBZone', 'hasWOSB', 'hasSDVOSB'] as const)
    .filter((k) => ev.identity[k] === undefined);
  if (unknownCerts.length) {
    caveats.push(`Certification status unknown for ${unknownCerts.length} program(s) — not treated as either held or not held.`);
  }
  const diverging = customers.filter((c) => c.diverges);
  for (const c of diverging) {
    caveats.push(`${c.label} contracts through a different administrative hierarchy than its operational identity — both are true, and targeting should use the operational customer.`);
  }
  if (!ev.reachable.length) {
    caveats.push('No recompetes were reachable on the vehicles this company already holds, so recommendations rest on award history alone.');
  }

  return {
    pursuits,
    demonstratedProfile: {
      customers: customers.map(({ label, awards, value }) => ({ label, awards, value })),
      naicsCodes: demoNaics,
      totalValue,
    },
    cannotAnswer: pursuits.length ? null : 'The evidence establishes award history but nothing actionable to pursue from it.',
    caveats,
  };
}

function byEnd(a: { endsOn: string | null }, b: { endsOn: string | null }) {
  return String(a.endsOn || '9999').localeCompare(String(b.endsOn || '9999'));
}
