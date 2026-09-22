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
import { isAnonId, addToAnonShortlist, claimAnonShortlist, listAccountShortlist, MAX_ANON_SHORTLIST } from './anon-shortlist';

const ANON = 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70';
const LIB = readFileSync(join(process.cwd(), 'src/lib/shortlist/anon-shortlist.ts'), 'utf8');
const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/app/shortlist/route.ts'), 'utf8');
const MIG = readFileSync(join(process.cwd(), 'supabase/migrations/20260921_anonymous_shortlist.sql'), 'utf8');
const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

/** A chainable stub whose behaviour depends on the table asked for. */
function mkDb(opts: {
  opp?: unknown;
  insertErr?: { code?: string; message: string } | null;
  /** Unclaimed rows this anon identity holds. */
  rows?: { id: string; notice_id: string }[];
  /** Rows a verified account has saved (may repeat across browsers). */
  accountRows?: { notice_id: string }[];
  /** Error on the list read. */
  readErr?: { message: string } | null;
  /** Outcome of the attach UPDATE. */
  updateErr?: { message: string } | null;
  updateCount?: number | null;
  /** What a read-back shows after a 0-row update. */
  readBack?: { claimed_at: string | null } | null;
} = {}) {
  const seen: string[] = [];
  let listReads = 0;
  const make = (table: string) => {
    seen.push(table);
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain; q.eq = chain; q.is = chain; q.in = chain; q.not = chain;
    q.order = chain; q.limit = chain;
    q.update = () => {
      const res = {
        count: opts.updateErr ? null : (opts.updateCount === undefined ? 1 : opts.updateCount),
        error: opts.updateErr ?? null,
        data: null,
      };
      const upd: Record<string, unknown> = {};
      upd.eq = () => upd; upd.is = () => upd;
      upd.then = (r: (v: unknown) => unknown) => Promise.resolve(res).then(r);
      return upd;
    };
    q.maybeSingle = async () => {
      if (table === 'sam_opportunities') return { data: opts.opp ?? null, error: null };
      // The attach read-back.
      return { data: opts.readBack ?? null, error: null };
    };
    q.insert = async () => ({ error: table === 'anonymous_shortlist' ? (opts.insertErr ?? null) : null });
    q.then = (r: (v: unknown) => unknown) => {
      if (opts.readErr) return Promise.resolve({ data: null, count: null, error: opts.readErr }).then(r);
      // First list read = the anon rows to attach; the account read uses its own set.
      const data = opts.accountRows ?? (listReads++ === 0 ? (opts.rows ?? []) : []);
      return Promise.resolve({ data, count: data.length, error: null }).then(r);
    };
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
    // The CANONICAL notice id (_nid2), never the solicitation number. Review
    // round 3: 99.0% of open SAM rows have nid != sol, so _o2.sol here meant
    // the save failed the notice_id lookup and the FK for the whole corpus.
    expect(MAP).toMatch(/body:JSON\.stringify\(\{anonId:_aid2,noticeId:_nid2\}\)/);
    expect(MAP).not.toMatch(/noticeId:_o2\.sol/);
    // No client-supplied opportunity metadata may be posted to the shortlist.
    const call = MAP.slice(MAP.indexOf("fetch('/api/app/shortlist',{method:'POST',headers:{'Content-Type':'application/json'},"));
    const payload = call.slice(0, call.indexOf('})})') + 4);
    for (const bad of ['title:', 'agency:', 'naicsCode', 'responseDeadline']) {
      expect(payload).not.toContain(bad);
    }
  });

  it('the save verifies the notice against the canonical corpus', () => {
    // The claim no longer reads opportunity metadata at all — it creates no
    // pursuit, so it needs none. What still matters is that a SAVE can only
    // name a notice that genuinely exists, checked here and enforced by the FK.
    expect(LIB).toMatch(/from\('sam_opportunities'\)[\s\S]{0,200}select\('notice_id'\)/);
    expect(LIB).toMatch(/if \(!real\) return \{ ok: false[\s\S]{0,80}unknown noticeId/);
  });
});

describe('a caller cannot write into someone else\'s space', () => {
  it('the claim branch requires a verified MI session', () => {
    const claim = ROUTE.slice(ROUTE.indexOf("body.action === 'claim'"), ROUTE.indexOf('Abuse control'));
    expect(claim).toMatch(/requireMIAuthSession\(request\)/);
    expect(claim).toMatch(/verifiedEmail = session\.session\.email/);
    expect(claim).toMatch(/claimAnonShortlist\(db\(\), anonId, \{ verifiedEmail \}\)/);
  });

  it('the route never reads an email from the body', () => {
    expect(ROUTE).not.toMatch(/body\.email/);
  });

  it('claim refuses anything that is not a real account email', async () => {
    const { db } = mkDb();
    expect((await claimAnonShortlist(db, ANON, { verifiedEmail: 'nope' })).ok).toBe(false);
    expect((await claimAnonShortlist(db, ANON, { verifiedEmail: ANON })).ok).toBe(false);
    expect((await claimAnonShortlist(db, 'bad-anon', { verifiedEmail: 'a@b.com' })).ok).toBe(false);
  });

  it('the Map never sends an email on claim', () => {
    const helper = MAP.slice(MAP.indexOf('window.__claimAnonShortlist=function'), MAP.indexOf('window.savePursuit=function'));
    expect(helper).toMatch(/action:'claim',anonId:aid/);
    expect(helper).not.toMatch(/email:/);
  });
});

// ── THE PRODUCT THESIS: RETURNING IS THE CONVERSION ────────────────────────
//
// A saved listing belongs to the DISCOVERY loop; a pursuit belongs to the
// EXECUTION loop. Signing in is not a statement of intent to bid, so a claim
// transfers SAVES and must never manufacture execution intent.

describe('a save is not a pursuit', () => {
  it('the shortlist lib does not reference user_pipeline or the pursuit writer at all', () => {
    const code = LIB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/user_pipeline/);
    expect(code).not.toMatch(/createCanonicalPursuit/);
  });

  it('claiming writes ONLY to anonymous_shortlist', async () => {
    const { db, seen } = mkDb({ rows: [{ id: 'sl-1', notice_id: 'n1' }] });
    await claimAnonShortlist(db, ANON, { verifiedEmail: 'buyer@example.com' });
    expect(new Set(seen)).toEqual(new Set(['anonymous_shortlist']));
  });

  it('the claim result counts ATTACHED saves — there is no promoted counter', async () => {
    const { db } = mkDb({ rows: [{ id: 'sl-1', notice_id: 'n1' }] });
    const r = await claimAnonShortlist(db, ANON, { verifiedEmail: 'buyer@example.com' });
    expect(r).toEqual({ ok: true, attached: 1, failed: 0 });
    expect(r).not.toHaveProperty('promoted');
    expect(r).not.toHaveProperty('alreadyTracked');
  });

  it('the Map reports saves attached, never a pursuit', () => {
    const helper = MAP.slice(MAP.indexOf('window.__claimAnonShortlist=function'), MAP.indexOf('window.savePursuit=function'));
    expect(helper).toMatch(/shortlist_attached/);
    expect(helper).not.toMatch(/pursuit_started/);
    expect(helper).not.toMatch(/promoted/);
  });

  it('an explicit Start Pursuit is still the ONLY path to a pursuit', () => {
    const PIPE = readFileSync(join(process.cwd(), 'src/app/api/pipeline/route.ts'), 'utf8');
    expect(PIPE).toMatch(/createCanonicalPursuit\(/);
    expect(PIPE).toMatch(/requireMIAuthSession\(request, body\.user_email\)/);
  });
});

describe('a claimed save is STILL a save', () => {
  it('the account can read back what it saved', async () => {
    const { db } = mkDb({ accountRows: [{ notice_id: 'n1' }, { notice_id: 'n2' }, { notice_id: 'n1' }] });
    const ids = await listAccountShortlist(db, 'Buyer@Example.com');
    // Deduped: one account can carry saves made in several browsers.
    expect(ids).toEqual(['n1', 'n2']);
  });

  it('a failed account read is UNKNOWN, never an empty shortlist', async () => {
    const { db } = mkDb({ readErr: { message: 'connection reset' } });
    expect(await listAccountShortlist(db, 'buyer@example.com')).toBeNull();
  });

  it('a signed-in GET returns the ACCOUNT saves, not an anon-id lookup', () => {
    const get = ROUTE.slice(ROUTE.indexOf('export async function GET'));
    expect(get).toMatch(/requireMIAuthSession\(request\)/);
    expect(get).toMatch(/listAccountShortlist\(db\(\), session\.session\.email\)/);
    // And an unreadable result is a 503, never a silent empty list.
    expect(get).toMatch(/status: 503/);
  });

  it('after signing in the Map re-renders the account saves', () => {
    const fn = MAP.slice(MAP.indexOf('window.__loadAnonShortlist=function'), MAP.indexOf('window.__claimAnonShortlist=function'));
    // claim (transfer) THEN read back the account's saves, so "✓ Saved"
    // survives creating an account instead of appearing to vanish.
    expect(fn).toMatch(/__claimAnonShortlist\?window\.__claimAnonShortlist\(after\)/);
    expect(fn).toMatch(/_markSaved\(d\.noticeIds\)/);
  });
});

describe('attaching a save is proven, never assumed', () => {
  it('scopes the mutation and counts it exactly', () => {
    const fn = LIB.slice(LIB.indexOf('export async function claimAnonShortlist'));
    expect(fn).toMatch(/\{ count: 'exact' \}/);
    expect(fn).toMatch(/\.eq\('id', row\.id\)/);
    expect(fn).toMatch(/\.eq\('owner_anon_id', owner\)/);
    expect(fn).toMatch(/\.is\('claimed_at', null\)/);
  });

  it('a database error counts as failed, never attached', async () => {
    const { db } = mkDb({ rows: [{ id: 'sl-1', notice_id: 'n1' }], updateErr: { message: 'connection reset' } });
    const r = await claimAnonShortlist(db, ANON, { verifiedEmail: 'buyer@example.com' });
    expect(r).toEqual({ ok: true, attached: 0, failed: 1 });
  });

  it('a NULL count is UNKNOWN, never attached', async () => {
    const { db } = mkDb({ rows: [{ id: 'sl-1', notice_id: 'n1' }], updateCount: null });
    const r = await claimAnonShortlist(db, ANON, { verifiedEmail: 'buyer@example.com' });
    expect(r.failed).toBe(1);
    expect(r.attached).toBe(0);
  });

  it('zero rows affected while still unclaimed is NOT a clean transfer', async () => {
    const { db } = mkDb({ rows: [{ id: 'sl-1', notice_id: 'n1' }], updateCount: 0, readBack: { claimed_at: null } });
    const r = await claimAnonShortlist(db, ANON, { verifiedEmail: 'buyer@example.com' });
    expect(r.failed).toBe(1);
    expect(r.attached).toBe(0);
  });

  it('zero rows BUT provably claimed concurrently IS a transfer', async () => {
    const { db } = mkDb({ rows: [{ id: 'sl-1', notice_id: 'n1' }], updateCount: 0, readBack: { claimed_at: '2026-09-21T00:00:00Z' } });
    const r = await claimAnonShortlist(db, ANON, { verifiedEmail: 'buyer@example.com' });
    expect(r.attached).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('an empty shortlist is not an error', async () => {
    const { db } = mkDb();
    expect(await claimAnonShortlist(db, ANON, { verifiedEmail: 'a@b.com' }))
      .toEqual({ ok: true, attached: 0, failed: 0 });
  });

  it('the route reports `failed` rather than hiding a partial failure', () => {
    expect(ROUTE).toMatch(/failed: r\.failed/);
  });
});
