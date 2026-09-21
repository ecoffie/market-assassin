/**
 * #1601 — anonymous shortlist, after security review.
 *
 * Map funnel (30 days): 2,021 users opened a listing, 53 pursued (2.6%); 96% of
 * map users are not signed in. Review found three defects, each pinned here:
 *   1. claim accepted an arbitrary email -> rows into another user's pursuits
 *   2. rows lived in user_pipeline, which has SIX global consumers (one emails)
 *   3. the browser supplied title/agency/NAICS/deadline
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAnonId, addToAnonShortlist, claimAnonShortlist, MAX_ANON_SHORTLIST } from './anon-shortlist';

const ANON = 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70';
const LIB = readFileSync(join(process.cwd(), 'src/lib/shortlist/anon-shortlist.ts'), 'utf8');
const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/app/shortlist/route.ts'), 'utf8');
const MIG = readFileSync(join(process.cwd(), 'supabase/migrations/20260921_anonymous_shortlist.sql'), 'utf8');
const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

/** A chainable stub whose behaviour depends on the table asked for. */
function mkDb(opts: { opp?: unknown; insertErr?: { code?: string; message: string } | null } = {}) {
  const seen: string[] = [];
  const make = (table: string) => {
    seen.push(table);
    const q: Record<string, unknown> = {};
    q.select = () => q; q.eq = () => q; q.is = () => q; q.in = () => q;
    q.order = () => q; q.limit = () => q; q.update = () => q;
    q.maybeSingle = async () =>
      table === 'sam_opportunities' ? { data: opts.opp ?? null, error: null } : { data: null, error: null };
    q.insert = async () => ({ error: table === 'anonymous_shortlist' ? (opts.insertErr ?? null) : null });
    q.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(r);
    return q;
  };
  return { db: { from: (t: string) => make(t) } as never, seen };
}

describe('the browser cannot manufacture an opportunity', () => {
  it('a notice that does not exist is refused', async () => {
    const { db } = mkDb({ opp: null });
    const r = await addToAnonShortlist(db, ANON, 'MADE-UP-NOTICE');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unknown noticeId');
  });

  it('a real notice is accepted', async () => {
    const { db } = mkDb({ opp: { notice_id: 'n1' } });
    expect((await addToAnonShortlist(db, ANON, 'n1')).saved).toBe(true);
  });

  it('only owner + notice are stored — no client metadata columns exist', () => {
    for (const col of ['title', 'agency', 'naics_code', 'response_deadline']) {
      expect(MIG).not.toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
    }
    expect(MIG).toMatch(/owner_anon_id\s+TEXT NOT NULL CHECK/);
    expect(MIG).toMatch(/notice_id\s+TEXT NOT NULL REFERENCES public\.sam_opportunities/);
  });

  it('the Map sends ONLY the notice id', () => {
    // Assert the exact anonymous-save payload anywhere in the file, rather than
    // slicing on a keyword that also occurs in prose.
    expect(MAP).toMatch(/body:JSON\.stringify\(\{anonId:_aid2,noticeId:_o2\.sol\}\)/);
    // No client-supplied opportunity metadata may be posted to the shortlist.
    const call = MAP.slice(MAP.indexOf("fetch('/api/app/shortlist',{method:'POST',headers:{'Content-Type':'application/json'},"));
    const payload = call.slice(0, call.indexOf('})})') + 4);
    for (const bad of ['title:', 'agency:', 'naicsCode', 'responseDeadline']) {
      expect(payload).not.toContain(bad);
    }
  });

  it('promotion reads metadata from sam_opportunities, not from the shortlist', () => {
    expect(LIB).toMatch(/from\('sam_opportunities'\)[\s\S]{0,240}select\('notice_id,title,department,naics_code,set_aside,response_deadline,notice_type'\)/);
  });
});

describe('a caller cannot write into someone else\'s pursuits', () => {
  it('the claim branch requires a verified MI session', () => {
    const claim = ROUTE.slice(ROUTE.indexOf("body.action === 'claim'"), ROUTE.indexOf('Abuse control'));
    expect(claim).toMatch(/requireMIAuthSession\(request\)/);
    expect(claim).toMatch(/const verifiedEmail = session\.session\.email/);
    // The verified email now travels inside the write context, alongside the
    // workspace resolved from the SAME request /api/pipeline resolves from.
    expect(claim).toMatch(/claimAnonShortlist\(db\(\), anonId, \{/);
    expect(claim).toMatch(/verifiedEmail,/);
    expect(claim).toMatch(/resolveActiveWorkspace\(verifiedEmail, request\)/);
  });

  it('the route never reads an email from the body', () => {
    expect(ROUTE).not.toMatch(/body\.email/);
  });

  it('claim refuses anything that is not a real account email', async () => {
    const { db } = mkDb();
    const ctx = (verifiedEmail: string) => ({
      verifiedEmail, workspaceId: 'ws-1', asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    });
    expect((await claimAnonShortlist(db, ANON, ctx('nope'))).ok).toBe(false);
    expect((await claimAnonShortlist(db, ANON, ctx(ANON))).ok).toBe(false);
    expect((await claimAnonShortlist(db, 'bad-anon', ctx('a@b.com'))).ok).toBe(false);
  });

  it('the Map never sends an email on claim', () => {
    const helper = MAP.slice(MAP.indexOf('window.__claimAnonShortlist=function'), MAP.indexOf('window.savePursuit=function'));
    expect(helper).toMatch(/action:'claim',anonId:aid/);
    expect(helper).not.toMatch(/email:/);
  });
});

describe('anonymous rows can never be mistaken for pursuits', () => {
  it('they live in their own table, not user_pipeline', () => {
    expect(LIB).toMatch(/from\('anonymous_shortlist'\)/);
    // The ONLY user_pipeline touch left here is the already-tracked READ. The
    // WRITE moved to the canonical pursuit writer, so this lib can no longer
    // create a pursuit of its own shape.
    const hits = LIB.match(/from\('user_pipeline'\)/g) ?? [];
    expect(hits.length).toBe(1);
    expect(LIB).not.toMatch(/from\('user_pipeline'\)[\s\S]{0,80}\.insert\(/);
  });

  it('the table forbids a real account owning a row', () => {
    expect(MIG).toMatch(/CHECK \(owner_anon_id ~ '\^anon:/);
  });

  it('the migration records WHY reuse was rejected', () => {
    expect(MIG).toMatch(/cron\/pursuit-changes/);
    expect(MIG).toMatch(/SENDS EMAIL/);
  });

  it('a promoted row is tagged as claimed, distinct from a native pursuit', () => {
    expect(LIB).toMatch(/CLAIMED_SOURCE = 'opportunity_map_claimed'/);
    expect(LIB).toMatch(/source: CLAIMED_SOURCE/);
  });
});

describe('promotion is safe and idempotent', () => {
  it('marks claimed ONLY after the pursuit write succeeds', () => {
    const body = LIB.slice(LIB.indexOf('export async function claimAnonShortlist'));
    const writeIdx = body.indexOf('createCanonicalPursuit(');
    const markIdx = body.indexOf('await markClaimed(row.id);\n    promoted');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeGreaterThan(writeIdx);
  });

  it('never overwrites an existing pursuit, but DOES resolve the shortlist row', () => {
    // Leaving it unclaimed was the loop: the row was reconsidered on every Map
    // load forever. Its value HAS transferred — the pursuit exists.
    const body = LIB.slice(LIB.indexOf('export async function claimAnonShortlist'));
    expect(body).toMatch(/if \(tracked\.has\(row\.notice_id\)\) \{[\s\S]{0,160}alreadyTracked \+= 1;[\s\S]{0,80}await markClaimed\(row\.id\);/);
    // …and nothing in this lib updates an existing pursuit row.
    expect(body).not.toMatch(/from\('user_pipeline'\)[\s\S]{0,80}\.update\(/);
  });

  it('an empty shortlist is not an error', async () => {
    const { db } = mkDb();
    expect(await claimAnonShortlist(db, ANON, {
      verifiedEmail: 'a@b.com', workspaceId: 'ws-1', asClient: false, clientOwnerEmail: 'ws-1@clients.getmindy.ai',
    })).toEqual({ ok: true, promoted: 0, alreadyTracked: 0, failed: 0, postWrite: [] });
  });

  it('a FAILED metadata read is surfaced, not silently skipped', () => {
    // Swallowing it would drop a promotion the user asked for and still report
    // success. The row stays unclaimed so the next attempt retries.
    expect(LIB).toMatch(/const \{ data: opp, error: oppErr \}/);
    expect(LIB).toMatch(/if \(oppErr\) \{[\s\S]{0,220}failed \+= 1/);
    expect(LIB).toMatch(/console\.error\(`\[anon-shortlist\] metadata read failed/);
  });
});

describe('unauthenticated writes are bounded', () => {
  it('uses the existing KV rate limiter', () => {
    expect(ROUTE).toMatch(/from '@\/lib\/rate-limit'/);
    expect(ROUTE).toMatch(/checkRateLimit\(`shortlist:ip:/);
    expect(ROUTE).toMatch(/checkRateLimit\(`shortlist:anon:/);
  });
  it('caps rows per anon identity', () => {
    expect(ROUTE).toMatch(/held >= MAX_ANON_SHORTLIST/);
    expect(MAX_ANON_SHORTLIST).toBeGreaterThan(0);
  });
  it('an unverifiable count refuses the write', () => {
    expect(ROUTE).toMatch(/held == null[\s\S]{0,180}could not verify shortlist size/);
  });
  it('rejects a malformed anon id and an oversized notice id', async () => {
    const { db } = mkDb({ opp: { notice_id: 'n' } });
    expect((await addToAnonShortlist(db, 'nope', 'n1')).ok).toBe(false);
    expect((await addToAnonShortlist(db, ANON, 'x'.repeat(200))).ok).toBe(false);
  });
});

describe('the visitor can see what they kept', () => {
  it('the Map restores ✓ Saved on load', () => {
    expect(MAP).toMatch(/window\.__loadAnonShortlist=function/);
    expect(MAP).toMatch(/b\.textContent='\\u2713 Saved'/);
  });
  it('a failed read is UNKNOWN, never rendered as an empty shortlist', () => {
    expect(ROUTE).toMatch(/ids == null[\s\S]{0,180}could not read shortlist/);
    expect(MAP).toMatch(/if\(!d\|\|!d\.success\|\|!d\.noticeIds\)return;/);
  });
  it('the claim path is actually reachable, not dead code', () => {
    expect(MAP).toMatch(/window\.__claimAnonShortlist&&window\.__claimAnonShortlist\(\)/);
  });
});

describe('signed-in pursuits are untouched', () => {
  // This assertion USED to be "the pipeline route is not modified". That is no
  // longer the goal and would now be the wrong guard: the route IS refactored,
  // deliberately, so both callers share one writer. What must not change is its
  // BEHAVIOUR — so the guard moved to the observable contract.
  it('the pipeline route keeps its auth, its status codes and its response shape', () => {
    const PIPE = readFileSync(join(process.cwd(), 'src/app/api/pipeline/route.ts'), 'utf8');
    // Auth: unchanged, and still bound to the body email.
    expect(PIPE).toMatch(/requireMIAuthSession\(request, body\.user_email\)/);
    // Required fields, duplicate 409, error 500, success payload.
    expect(PIPE).toMatch(/user_email and title are required/);
    expect(PIPE).toMatch(/Opportunity already in pipeline[\s\S]{0,120}status: 409/);
    expect(PIPE).toMatch(/status: 500/);
    expect(PIPE).toMatch(/success: true,[\s\S]{0,120}opportunity: result\.pursuit,[\s\S]{0,80}family: result\.family/);
    expect(PIPE).toMatch(/message: 'Added to pipeline'/);
    // The pursuit itself is created by the shared writer, not a local insert.
    expect(PIPE).toMatch(/createCanonicalPursuit\(/);
    expect(PIPE).not.toMatch(/from\('user_pipeline'\)\s*\.insert\(/);
  });
});
