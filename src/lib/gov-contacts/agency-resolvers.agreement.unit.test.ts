/**
 * THE AGREEMENT GATE — three resolvers, one question, they must not drift.
 *
 * "What agency does this term mean?" is answered in THREE independent places:
 *
 *   1. resolveAgency()        src/lib/gov-contacts/contact-roster.ts
 *                             → the MCP search_federal_contacts tool + chat
 *   2. subAgencyToParent()    src/app/api/app/federal-contacts/route.ts
 *                             → the in-app `agency` DROPDOWN filter
 *   3. agencySearchKeywords() src/lib/gov-contacts/agency-search.ts
 *                             → the in-app SEARCH BOX
 *
 * Each has its own data (a 56-alias hand map, a 10-regex map, and a 450-entry
 * JSON). They drift, silently, and the drift is invisible until a customer sees it:
 *
 *   2026-07-17 — I fixed DLA/GSA/NASA in #1 and #2, verified, and shipped. Eric
 *   typed them into the live SEARCH BOX (#3, which I never touched):
 *       "nasa" -> 1 person      (the alias is literally "NASA"; ILIKE %NASA%
 *                                matches 0 rows — the column says
 *                                "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION")
 *       "dla"  -> 56,537 people (the alias is "Department of Defense" -> "Defense"
 *                                -> the ENTIRE DoD: Air Force, Navy, Army rows
 *                                for a DLA search. The real DLA people: 7,890.)
 *
 * A screenshot caught what a green test suite did not. So this asserts every
 * resolver lands on the SAME target for a canonical term list. Add an alias to one
 * and not the others → this fails BEFORE it reaches a customer.
 *
 * It is a pure unit test (no DB, no network) and vitest is already step 4/7 of the
 * pre-push gate — so it blocks a push without a new gate step.
 *
 * ⚠️ This asserts AGREEMENT, not correctness. Three resolvers can agree and all be
 * wrong. The expectations below are therefore pinned to MEASURED reality (counts
 * from federal_contacts, 170,586 rows, 2026-07-17) rather than to whatever the code
 * happens to return.
 */
import { describe, it, expect } from 'vitest';
import { resolveAgency } from './contact-roster';
import { agencySearchKeywords, agencySearchTargets } from './agency-search';
import { subAgencyToParent, agencyToExpectedSubAgency } from '@/app/api/app/federal-contacts/route';

/**
 * Where each term's contacts ACTUALLY live. Verified against federal_contacts.
 * `column` + a keyword that must appear (case-insensitive) in what each resolver
 * targets — deliberately loose on exact wording (the three use different
 * conventions: "General" vs "GENERAL SERVICES"), strict on WHICH BUREAU.
 */
const CANONICAL: Array<{
  term: string;
  /** Substring every resolver's target must contain. The bureau, not its parent. */
  must: string;
  note: string;
}> = [
  {
    term: 'DLA',
    must: 'logistic',
    note: 'sub_tier "DEFENSE LOGISTICS AGENCY" = 7,890. Resolving to "Defense" alone returns all 56,521 DoD contacts.',
  },
  { term: 'NASA', must: 'aeronautic', note: 'dept "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION" = 977. ILIKE %NASA% = 0.' },
  { term: 'GSA', must: 'general', note: 'dept "GENERAL SERVICES ADMINISTRATION" = 1,076.' },
  { term: 'USDA', must: 'agricultur', note: 'dept "AGRICULTURE, DEPARTMENT OF" = 2,987.' },
  { term: 'USFS', must: 'forest', note: 'sub_tier "FOREST SERVICE" = 800 (or its Agriculture parent).' },
];

/**
 * The EFFECTIVE target of each resolver — what the caller actually queries with,
 * not every candidate it carries.
 *
 * This distinction bit the first version of this test: resolveAgency returns
 * `{ deptKeyword: 'Defense', subTier: 'defense logistics' }` for DLA, and the test
 * flagged the bare "defense" as a firehose. But the caller does
 * `r.subTier || r.deptKeyword` — the dept is context, never the query. Modelling
 * the resolver instead of the CALL SITE produced a false failure against code that
 * was already correct.
 */
function targetsOf(term: string): { resolver: string; targets: string[] }[] {
  const r1 = resolveAgency(term);
  // The app dropdown is a TWO-STEP pipeline: resolve to the parent department,
  // THEN narrow to the branch label. Testing subAgencyToParent alone said DLA
  // collapsed to "defense" — a FALSE alarm against code that narrows correctly one
  // line later. Two of this test's first three failures were this mistake.
  const r2 = agencyToExpectedSubAgency(term) || subAgencyToParent(term);
  // agencySearchTargets — NOT agencySearchKeywords. #338 introduced the former and
  // moved both call sites to it; the latter survives only for back-compat. Testing
  // the deprecated one meant testing a function nothing calls, and it reported DLA
  // as broken AFTER #338 had fixed it. Third time this test modelled the wrong thing.
  const r3t = agencySearchTargets(term);
  const r3 = [...r3t.subTier, ...r3t.dept];
  const lc = (s: string) => s.toLowerCase();
  return [
    // caller: `const safe = (r.subTier || r.deptKeyword)`
    { resolver: 'resolveAgency (MCP tool)', targets: [lc(String(r1.subTier || r1.deptKeyword))] },
    // caller: agencyToExpectedSubAgency(agency) narrows, else parentKeyword
    { resolver: 'subAgencyToParent (app dropdown)', targets: (r2 ? [r2] : []).map(lc) },
    // caller: pushes dept -> department_ind_agency ILIKE, subTier -> sub_tier ILIKE
    { resolver: 'agencySearchKeywords (search box)', targets: r3.map(lc) },
  ];
}

describe('agency resolvers — all three must land on the same bureau', () => {
  for (const c of CANONICAL) {
    it(`${c.term} → every resolver targets "${c.must}" (${c.note})`, () => {
      for (const { resolver, targets } of targetsOf(c.term)) {
        // A resolver that declines to resolve (returns nothing) is not drift —
        // the caller falls back to a raw name/agency ILIKE. Only a resolver that
        // makes a CLAIM has to make the right one.
        if (targets.length === 0) continue;
        const hit = targets.some((t) => t.includes(c.must));
        expect(
          hit,
          `${resolver} resolved "${c.term}" to [${targets.join(', ')}] — expected something containing "${c.must}". ${c.note}`,
        ).toBe(true);
      }
    });
  }

  it('DLA must NOT collapse to the bare parent "defense" (the 56,521-row firehose)', () => {
    for (const { resolver, targets } of targetsOf('DLA')) {
      if (targets.length === 0) continue;
      const collapsed = targets.some((t) => /^\s*defense\s*$/.test(t));
      expect(
        collapsed,
        `${resolver} resolved "DLA" to the bare parent "defense" — that matches ALL 56,521 DoD contacts ` +
          `(Air Force/Navy/Army rows for a DLA search). It must narrow to the "DEFENSE LOGISTICS AGENCY" sub_tier (7,890).`,
      ).toBe(false);
    }
  });

  it('ordinary words still resolve to nothing (a person named Forest is not an agency)', () => {
    // The search box takes FREE TEXT, so over-eager resolution is its own bug —
    // this is the constraint a naive "converge the three" would break.
    expect(agencySearchKeywords('smith')).toEqual([]);
    expect(agencySearchKeywords('forest')).toEqual([]);
  });
});
