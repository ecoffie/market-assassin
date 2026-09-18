/**
 * P3 live probe — not a billed host FIND fan-out. One findOpportunities per market.
 * Prints precision/recall vs named SOCOM IT PIIDs + blind markets.
 */
import { findOpportunities } from '../src/lib/opportunities/find-opportunities.ts';

const NAMED = ['H9241524F0002', 'H9223922F0028', 'H9241524F0028', 'H9241522F0062'];

function stripPiid(p: string) {
  return p.replace(/-/g, '').toUpperCase();
}

async function run(label: string, query: string, agency: string) {
  const t0 = Date.now();
  const r = await findOpportunities({ query, agency, limit_per_horizon: 25 });
  const ms = Date.now() - t0;
  const back = r.horizons.coming_back;
  const piids = back.items.map((i) => stripPiid(String(i.piid || '')));
  const namedHit = NAMED.filter((p) => piids.includes(stripPiid(p)));
  const classes = {
    DIRECT: back.items.filter((i) => i.evidence_class === 'DIRECT_MATCH').length,
    RELATED: back.items.filter((i) => i.evidence_class === 'RELATED_MARKET_CANDIDATE').length,
  };
  const sample = back.items.slice(0, 5).map((i) => ({
    piid: i.piid,
    title: i.title,
    naics: i.naics_code,
    class: i.evidence_class,
    buyer: i.buyer,
  }));
  return {
    label,
    ms,
    open: { status: r.horizons.open_now.status, n: r.horizons.open_now.matched_count },
    back: {
      status: back.status,
      n: back.matched_count,
      returned: back.returned_count,
      evidence_counts: back.evidence_counts,
      classes,
      namedHit,
      sample,
    },
    soon: {
      status: r.horizons.coming_soon.status,
      n: r.horizons.coming_soon.matched_count,
      err: r.horizons.coming_soon.error?.class,
      msg: r.horizons.coming_soon.error?.message?.slice(0, 160),
    },
    presentation_note: r.presentation_note,
    related_applied: r.market_interpretation.retrieval_plan.related_market_applied,
    buyer_canonical: r.market_interpretation.buyer.canonical,
    parent_dod: r.market_interpretation.buyer.parent_department_applied,
    headline: r.summary.headline,
    grounded: r._meta.grounded,
  };
}

const markets = [
  ['A cybersecurity+SOCOM', 'cybersecurity', 'SOCOM'],
  ['B construction+Army', 'construction', 'Army'],
  ['C IT services+VA', 'IT services', 'VA'],
  ['D janitorial+DLA', 'janitorial', 'DLA'],
  ['E machine learning+Air Force', 'machine learning', 'Air Force'],
  ['NEG physical security+SOCOM', 'physical security', 'SOCOM'],
  ['NEG security+SOCOM', 'security', 'SOCOM'],
] as const;

const out = [];
for (const [label, q, a] of markets) {
  out.push(await run(label, q, a));
}
console.log(JSON.stringify(out, null, 2));
