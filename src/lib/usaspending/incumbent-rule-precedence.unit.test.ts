/**
 * THE PRECEDENCE BETWEEN THE INCUMBENT GUARDRAILS — made explicit and tested,
 * because the rules as written appear to contradict each other.
 *
 * The apparent contradiction: guardrail 1 says a PSC match is enough taxonomy
 * agreement to keep a candidate alive when NAICS disagrees ("a NAICS mismatch with
 * real PSC evidence still grounds"), while guardrail 2 rejects ANY differing
 * 2-digit NAICS sector. Both cannot be unconditionally true.
 *
 * ── THE DECISION ────────────────────────────────────────────────────────────
 *   SECTOR CONFLICT WINS. A differing 2-digit sector rejects the candidate even
 *   when the PSC matches. Only INDEPENDENTLY VERIFIED identity — a predecessor
 *   named on the notice, or a shared PIID/UEI — can override it, never taxonomy
 *   or token overlap.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *   NAICS and PSC answer different questions: NAICS is WHO the seller is, PSC is
 *   WHAT was bought. A shared PSC across different sectors is real but weak — PSC
 *   is matched on a 4-character prefix here, so broad classes (Z2xx "repair or
 *   alteration", R4xx "support services") are shared by genuinely different
 *   industries. Sector disagreement is the stronger signal because it says the two
 *   requirements are a different KIND of work. Between weak agreement and strong
 *   disagreement, the honest answer is to refuse.
 *
 * ── THE COST, STATED ────────────────────────────────────────────────────────
 *   This is not free. A building-repair notice (NAICS 236220, sector 23) whose
 *   true predecessor was awarded to an A&E firm (NAICS 541330, sector 54) under
 *   the SAME PSC is rejected, and the real incumbent is withheld. We accept a
 *   missed incumbent over a fabricated one: a withheld incumbent is visibly
 *   absent in `prior_awards`, while a wrong incumbent is invisible and gets acted
 *   on — it reached SEC enrichment, bid/no-bid and the M-Estimate anchor.
 *
 * So the guardrail-1 promise is TRUE ONLY WITHIN A SECTOR. That qualification is
 * asserted below so the packet cannot claim more than the code does.
 */
import { describe, it, expect } from 'vitest';
import { groundIncumbent } from './incumbent-evidence';

const base = {
  distinctiveHits: 3,
  workHits: 3,
  locationHits: 0,
  matchConfidence: 'high' as const,
};

describe('guardrail precedence: sector conflict outranks PSC agreement', () => {
  it('QUALIFIED PROMISE — a NAICS mismatch WITHIN one sector, with a PSC match, still grounds', () => {
    // 236220 -> 236118: different 6-digit code, SAME sector 23.
    const r = groundIncumbent({
      ...base, pscMatch: true, naicsMatch: false,
      noticeSector: '23', awardSector: '23',
    });
    expect(r.grounded).toBe(true);
    expect(r.certainty).toBe('supported');
  });

  it('ACROSS sectors, the SAME PSC evidence is REJECTED — sector wins', () => {
    // 236220 (23 construction) -> 541330 (54 engineering), same PSC prefix.
    const r = groundIncumbent({
      ...base, pscMatch: true, naicsMatch: false,
      noticeSector: '23', awardSector: '54',
    });
    expect(r.grounded).toBe(false);
    expect(r.certainty).toBe('none');
    expect(r.reason).toMatch(/different kind of work/i);
  });

  it('only VERIFIED IDENTITY may override a sector conflict — token/PSC overlap may not', () => {
    const withoutProof = groundIncumbent({
      ...base, pscMatch: true, naicsMatch: false,
      noticeSector: '23', awardSector: '54', verifiedIdentity: false,
    });
    const withProof = groundIncumbent({
      ...base, pscMatch: true, naicsMatch: false,
      noticeSector: '23', awardSector: '54', verifiedIdentity: true,
    });
    expect(withoutProof.grounded).toBe(false);
    expect(withProof.grounded).toBe(true);
  });

  it('an UNKNOWN sector on either side is not a conflict — absence is not evidence', () => {
    for (const [n, a] of [[null, '51'], ['23', null], [null, null]] as const) {
      const r = groundIncumbent({
        ...base, pscMatch: true, naicsMatch: false, noticeSector: n, awardSector: a,
      });
      expect(r.grounded).toBe(true);
    }
  });

  it('RULE D still applies inside an agreeing sector — location alone never grounds', () => {
    // Same sector, NAICS agrees, but every matched token was a place.
    const r = groundIncumbent({
      distinctiveHits: 3, workHits: 0, locationHits: 3,
      pscMatch: false, naicsMatch: true, matchConfidence: 'high',
      noticeSector: '23', awardSector: '23',
    });
    expect(r.grounded).toBe(false);
    expect(r.reason).toMatch(/PLACE/i);
  });

  it('the full ordering, on one candidate set', () => {
    const ordered = [
      // 1. no taxonomy agreement at all -> uncertain
      { ev: { ...base, pscMatch: false, naicsMatch: false }, grounded: false },
      // 2. sector conflict -> none (strongest rejection)
      { ev: { ...base, pscMatch: true, naicsMatch: false, noticeSector: '23', awardSector: '51' }, grounded: false },
      // 3. location-only work evidence -> uncertain
      { ev: { ...base, workHits: 0, locationHits: 3, pscMatch: false, naicsMatch: true }, grounded: false },
      // 4. everything agrees -> supported
      { ev: { ...base, pscMatch: true, naicsMatch: true, noticeSector: '23', awardSector: '23' }, grounded: true },
    ];
    for (const { ev, grounded } of ordered) {
      expect(groundIncumbent(ev).grounded).toBe(grounded);
    }
  });
});
