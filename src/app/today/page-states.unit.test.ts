/**
 * GUARD — /today is STATEFUL, and it must never end in an empty state.
 *
 * The behavioral model (Eric, 2026-08-15 — `docs/today-page-states.md`):
 *   anonymous → Discovery · authenticated → Momentum · expired → Recovery
 *   "The page should always help the user move forward, never explain why it has nothing
 *    to show."
 *
 * These are the three failure modes that would silently break that contract, each of which
 * a green build and a 200 response would happily ship:
 *
 *  1. AN APOLOGY REACHES THE PAGE. "Nothing tracked yet" describes our system's state, not
 *     the user's goal. It is also actively misleading — the database holds 34,827 active
 *     opportunities while the page claims to have nothing.
 *
 *  2. THE STATE GETS GATED ON THE DECODED EMAIL instead of the token. `_uemail()` decodes the
 *     wrong JWT segment and returns '' for genuinely signed-in users, so an email-gated split
 *     shows a logged-in person the anonymous half — a bug this repo already shipped once
 *     (`opportunity-map/route.ts:5399`; Eric: "this says sign in but we are already logged
 *     in"). Authentication state and profile completeness are DIFFERENT QUESTIONS.
 *
 *  3. AN EXPIRED SESSION GETS TREATED AS A FIRST VISIT. A user with a year of pursuits being
 *     shown "most contractors begin with one of these markets" is being told they are new.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = join(process.cwd(), 'src', 'app', 'today', 'route.ts');
const API = join(process.cwd(), 'src', 'app', 'api', 'today', 'your-market', 'route.ts');

/** Comments legitimately QUOTE the banned phrases while explaining them — strip before asserting. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

describe('/today never ends in an empty state', () => {
  const emitted = stripComments(readFileSync(ROUTE, 'utf8'));

  /**
   * The exact sentences that describe OUR state rather than the user's goal. Each would render
   * a dead end where the fallback hierarchy promises something useful.
   */
  const APOLOGIES = [
    'Nothing tracked yet',
    'No activity yet',
    'You have no',
    'Nothing to show',
    'Nothing here yet',
    "You haven't saved",
  ];

  for (const phrase of APOLOGIES) {
    it(`never emits "${phrase}"`, () => {
      expect(emitted.toLowerCase()).not.toContain(phrase.toLowerCase());
    });
  }

  it('server-renders the discovery tiles, so the region is useful before any JS runs', () => {
    // The tiles must be in the SERVER output, not injected by the hydration script — an
    // anonymous visitor (and anyone whose JS fails) still gets a populated section.
    expect(emitted).toMatch(/tiles\.map/);
    expect(emitted).toContain('class="mkt"');
  });

  it('hydration only ever replaces the region, never blanks it', () => {
    // Every write to the personalized body must set real content. An `innerHTML=""` here
    // would empty a region the server had correctly filled.
    expect(emitted).not.toMatch(/body\.innerHTML\s*=\s*["']["']/);
  });

  it('falls through to discovery when an authenticated user has NO history', () => {
    // The signed-in-but-empty case is the one that would otherwise print a heading over
    // nothing. It must return early and leave the server-rendered tiles standing.
    expect(emitted).toMatch(/if\(!v\.length && !p\.length && !rc\.length\) return;/);
  });
});

describe('the state is derived from the TOKEN, not a decoded email', () => {
  const api = stripComments(readFileSync(API, 'utf8'));
  const emitted = stripComments(readFileSync(ROUTE, 'utf8'));

  it('the client branches on the presence of a token', () => {
    expect(emitted).toMatch(/localStorage\.getItem\("mi_beta_auth_token"\)/);
    expect(emitted).toMatch(/if\(!tk\) return;/);
  });

  it('the client NEVER decodes the email to decide what to show', () => {
    // _uemail()-style local JWT decoding is exactly what produced the shipped bug.
    expect(emitted).not.toContain('_uemail');
    expect(emitted).not.toMatch(/atob\(/);
  });

  it('the server resolves identity from the signed token, never a client-supplied email', () => {
    expect(api).toMatch(/verifyTwoFactorSessionToken/);
    // A ?email= parameter would let anyone read anyone else's pursuits.
    expect(api).not.toMatch(/searchParams\.get\(['"]email['"]\)/);
  });
});

describe('an expired session is NOT a first visit', () => {
  const api = stripComments(readFileSync(API, 'utf8'));
  const emitted = stripComments(readFileSync(ROUTE, 'utf8'));

  it('the API distinguishes expired from anonymous', () => {
    expect(api).toContain("'Two-factor session expired'");
    expect(api).toMatch(/expired \? 'expired' : 'anonymous'/);
  });

  it('the page gives an expired session recovery copy, not the first-visit pitch', () => {
    expect(emitted).toMatch(/d\.state==="expired"/);
    expect(emitted).toMatch(/Welcome back/);
    // And it must still offer the way back in.
    expect(emitted).toMatch(/Sign in/);
  });

  it('recovery keeps the discovery tiles underneath rather than clearing them', () => {
    // The expired branch must RETURN before touching the body — the tiles stay, so the
    // visitor gets "welcome back" AND today's markets.
    const branch = emitted.slice(emitted.indexOf('d.state==="expired"'));
    const bodyWrite = branch.indexOf('body.innerHTML');
    const ret = branch.indexOf('return;');
    expect(ret).toBeGreaterThan(-1);
    expect(ret).toBeLessThan(bodyWrite === -1 ? Number.MAX_SAFE_INTEGER : bodyWrite);
  });
});

describe('dollar values render as money, never as bare integers', () => {
  const emitted = stripComments(readFileSync(ROUTE, 'utf8'));

  /**
   * SHIPPED 2026-08-15 and caught by Eric in a screenshot: the hero number on every featured
   * card rendered as a raw integer — "195479" where "$195K" belonged, "8041670" for "$8M".
   *
   * Nothing could have caught this except looking. `estMedian` is correctly typed `number`,
   * `esc()` did its job, tsc passed, the route returned 200, and the value was ACCURATE — it
   * was just unreadable, in the largest type on the page. The unformatted digits also overran
   * their container, truncating the third card's range to "6835420–".
   */
  it('the card hero is formatted through estMoneyServer', () => {
    expect(emitted).toMatch(/tc-val">\$\{esc\(estMoneyServer\(o\.estMedian\)\)\}/);
  });

  it('the range endpoints are formatted too', () => {
    expect(emitted).toMatch(/estMoneyServer\(o\.estLow\)/);
    expect(emitted).toMatch(/estMoneyServer\(o\.estHigh\)/);
  });

  it('no money field is interpolated raw', () => {
    // The exact shape that shipped. Any `esc(o.est…)` without a formatter is this bug again.
    expect(emitted).not.toMatch(/esc\(o\.estMedian\)/);
    expect(emitted).not.toMatch(/esc\(o\.estLow\)/);
    expect(emitted).not.toMatch(/esc\(o\.estHigh\)/);
  });

  it('uses the SHARED formatter rather than a local copy', () => {
    // A second local money formatter is the lib-duplicate drift class: the map and /today
    // would silently disagree about how an M-Estimate reads.
    expect(emitted).toMatch(/import \{ estMoneyServer \} from '@\/lib\/opportunities\/map-data'/);
    expect(emitted).not.toMatch(/function estMoney/);
  });
});

describe('no raw codes or fabricated numbers reach the page', () => {
  const lib = stripComments(readFileSync(join(process.cwd(), 'src', 'lib', 'today', 'your-market.ts'), 'utf8'));
  const markets = stripComments(readFileSync(join(process.cwd(), 'src', 'lib', 'today', 'markets.ts'), 'utf8'));

  it('machine enums are humanized before display (names, not codes)', () => {
    expect(lib).toMatch(/NEXT_ACTION_LABEL/);
    expect(lib).toMatch(/nextAction: humanAction\(/);
  });

  it('an unknown count is null, never coalesced to zero', () => {
    // `count ?? 0` turns "I don't know" into "this market is empty" — Bug Prevention Rule #11.
    expect(markets).not.toMatch(/count\s*\?\?\s*0/);
    expect(markets).not.toMatch(/count\s*\|\|\s*0/);
    expect(markets).toMatch(/typeof count !== 'number'/);
  });

  it('a partially-counted market is dropped rather than under-reported', () => {
    // Summing only the parts that succeeded would print a confident, wrong total.
    expect(markets).toMatch(/parts\.some\(\(p\) => p === null\)/);
  });
});
