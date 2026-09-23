/**
 * GUARD — the share-attribution claim contract (src/lib/attribution/share-attribution.ts).
 *
 * The browser's `entry`/`sh` are claims from a URL anyone can type. These tests pin what turns a
 * claim into attribution: a real, earliest listing_share with the same record, before the arrival,
 * from someone else — and a claim that only ever applies to a NEW account, once.
 */
import { describe, it, expect } from 'vitest';
import { makeFakeDb } from './fake-db.test-helper';
import {
  claimAnonAttribution, resolveFirstShareArrival, sanitizeShareMetadata, sanitizeTouch,
} from './share-attribution';

const A = 'sharer@example.com';
const B = 'anon:11111111-2222-4333-8444-555555555555';
const OTHER = 'anon:99999999-2222-4333-8444-555555555555';
const S = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const X = '0fdb5f972b2a46648adf2e2b8a6558ce';
const Y = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const share = (over: Partial<{ user_email: string; created_at: string; notice: string; id: string }> = {}) => ({
  user_email: over.user_email ?? A, event_source: 'opportunity_map', created_at: over.created_at ?? '2026-09-20T10:00:00Z',
  metadata: { action: 'listing_share', share_id: over.id ?? S, notice_id: over.notice ?? X, kind: 'opp', method: 'clipboard' },
});
const arrival = (over: Partial<{ created_at: string; notice: string; id: string; visitor: string; entry: string }> = {}) => ({
  user_email: over.visitor ?? B, event_source: 'opportunity_map', created_at: over.created_at ?? '2026-09-20T11:00:00Z',
  metadata: { action: 'map_view', entry: over.entry ?? 'share', share_id: over.id ?? S, notice_id: over.notice ?? X },
});

describe('sanitizeShareMetadata — the endpoint never stores a malformed share claim', () => {
  it('keeps a well-formed id (lowercased)', () => {
    expect(sanitizeShareMetadata({ entry: 'share', share_id: S.toUpperCase() })).toMatchObject({ entry: 'share', share_id: S });
  });
  it('drops a malformed id and relabels the arrival share_invalid', () => {
    const m = sanitizeShareMetadata({ entry: 'share', share_id: 'bibsf-not-a-uuid' });
    expect(m.share_id).toBeUndefined();
    expect(m.share_id_invalid).toBe(true);
    expect(m.entry).toBe('share_invalid');
  });
  it('entry=share without any id is not share traffic', () => {
    expect(sanitizeShareMetadata({ entry: 'share' }).entry).toBe('share_invalid');
  });
  it('leaves non-share events untouched', () => {
    expect(sanitizeShareMetadata({ entry: 'alert', action: 'map_view' })).toEqual({ entry: 'alert', action: 'map_view' });
  });
  it('drops an unknown share method', () => {
    expect(sanitizeShareMetadata({ action: 'listing_share', share_id: S, method: 'facebook' }).method).toBeUndefined();
    expect(sanitizeShareMetadata({ action: 'listing_share', share_id: S, method: 'native' }).method).toBe('native');
  });
});

describe('resolveFirstShareArrival — only a REAL share attributes an arrival', () => {
  it('valid share → arrival names the share, the record and the sharer', async () => {
    const db = makeFakeDb({ user_engagement: [share(), arrival()] });
    const r = await resolveFirstShareArrival(db, B);
    expect(r).toMatchObject({ ok: true, arrival: { shareId: S, noticeId: X, sharer: A } });
  });
  it('a random well-formed id with no listing_share resolves to nothing', async () => {
    const db = makeFakeDb({ user_engagement: [arrival()] });
    expect(await resolveFirstShareArrival(db, B)).toEqual({ ok: true, arrival: null });
  });
  it('a REAL id lifted onto a different opportunity does not attribute', async () => {
    const db = makeFakeDb({ user_engagement: [share(), arrival({ notice: Y })] });
    expect((await resolveFirstShareArrival(db, B) as { arrival: unknown }).arrival).toBeNull();
  });
  it('an arrival before the share cannot be caused by it', async () => {
    const db = makeFakeDb({ user_engagement: [share({ created_at: '2026-09-21T00:00:00Z' }), arrival()] });
    expect((await resolveFirstShareArrival(db, B) as { arrival: unknown }).arrival).toBeNull();
  });
  it('opening your own shared link is not acquisition', async () => {
    const db = makeFakeDb({ user_engagement: [share({ user_email: B }), arrival()] });
    expect((await resolveFirstShareArrival(db, B) as { arrival: unknown }).arrival).toBeNull();
  });
  it('a forged LATER listing_share reusing a real id cannot take the share over (earliest wins)', async () => {
    const forged = share({ user_email: OTHER, created_at: '2026-09-20T10:30:00Z' });
    const db = makeFakeDb({ user_engagement: [forged, share(), arrival()] });
    const r = await resolveFirstShareArrival(db, B) as { arrival: { sharer: string } };
    expect(r.arrival.sharer).toBe(A);
  });
  it('the FIRST valid share arrival wins over a later one', async () => {
    const S2 = '7f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const db = makeFakeDb({ user_engagement: [
      share(), share({ id: S2, notice: Y, created_at: '2026-09-22T00:00:00Z' }),
      arrival(), arrival({ id: S2, notice: Y, created_at: '2026-09-22T01:00:00Z' }),
    ] });
    expect((await resolveFirstShareArrival(db, B) as { arrival: { shareId: string } }).arrival.shareId).toBe(S);
  });
});

describe('claimAnonAttribution — anonymous history joins the account, once, for new accounts', () => {
  const base = () => ({ user_engagement: [share(), arrival()] as Record<string, unknown>[], signup_attribution: [] as Record<string, unknown>[] });

  it('OAuth class (no mi-signup row): inserts the account row with anon_id + validated share_id', async () => {
    const t = base(); const db = makeFakeDb(t);
    const r = await claimAnonAttribution(db, { anonId: B, verifiedEmail: 'New@Example.com', accountCreatedAt: '2026-09-20T12:00:00Z' });
    expect(r).toEqual({ ok: true, status: 'claimed', shareId: S });
    expect(t.signup_attribution).toHaveLength(1);
    expect(t.signup_attribution[0]).toMatchObject({ email: 'new@example.com', anon_id: B, share_id: S, entry: 'share', source: 'share' });
  });

  it('email class (mi-signup already wrote the row): enriches it, never adds a second', async () => {
    const t = base();
    t.signup_attribution.push({ id: 1, email: 'new@example.com', utm_source: 'share', anon_id: null, created_at: '2026-09-20T11:30:00Z' });
    const db = makeFakeDb(t);
    const r = await claimAnonAttribution(db, { anonId: B, verifiedEmail: 'new@example.com', accountCreatedAt: '2026-09-20T11:30:00Z' });
    expect(r).toMatchObject({ status: 'claimed', shareId: S });
    expect(t.signup_attribution).toHaveLength(1);
    expect(t.signup_attribution[0]).toMatchObject({ anon_id: B, share_id: S });
  });

  it('an EXISTING account signing in on a share-visited browser is not a share signup', async () => {
    const t = base(); const db = makeFakeDb(t);
    const r = await claimAnonAttribution(db, { anonId: B, verifiedEmail: 'old@example.com', accountCreatedAt: '2025-01-01T00:00:00Z' });
    expect(r).toEqual({ ok: true, status: 'existing_account' });
    expect(t.signup_attribution).toHaveLength(0);
  });

  it('unknown account age never asserts acquisition', async () => {
    const t = base(); const db = makeFakeDb(t);
    expect(await claimAnonAttribution(db, { anonId: B, verifiedEmail: 'x@example.com', accountCreatedAt: null }))
      .toEqual({ ok: true, status: 'existing_account' });
    expect(t.signup_attribution).toHaveLength(0);
  });

  it('first claim wins — a later browser/share never re-attributes the account', async () => {
    const t = base();
    t.signup_attribution.push({ id: 1, email: 'new@example.com', anon_id: OTHER, share_id: null });
    const db = makeFakeDb(t);
    expect(await claimAnonAttribution(db, { anonId: B, verifiedEmail: 'new@example.com', accountCreatedAt: '2026-09-20T12:00:00Z' }))
      .toEqual({ ok: true, status: 'already_claimed' });
    expect(t.signup_attribution[0]).toMatchObject({ anon_id: OTHER, share_id: null });
  });

  it('a browser with no recorded history claims nothing', async () => {
    const db = makeFakeDb({ user_engagement: [], signup_attribution: [] });
    expect(await claimAnonAttribution(db, { anonId: B, verifiedEmail: 'n@example.com', accountCreatedAt: '2026-09-20T12:00:00Z' }))
      .toEqual({ ok: true, status: 'no_history' });
  });

  it('a non-share arrival still records anon_id + first touch, with share_id null', async () => {
    const t = { user_engagement: [arrival({ entry: 'direct', id: '' })], signup_attribution: [] as Record<string, unknown>[] };
    const db = makeFakeDb(t);
    const r = await claimAnonAttribution(db, { anonId: B, verifiedEmail: 'd@example.com', accountCreatedAt: '2026-09-20T12:00:00Z' });
    expect(r).toMatchObject({ status: 'claimed', shareId: null });
    expect(t.signup_attribution[0]).toMatchObject({ anon_id: B, share_id: null, entry: 'direct' });
  });

  it('a client-supplied share_id in first_touch is NOT promoted without a validated arrival', async () => {
    const t = { user_engagement: [arrival({ entry: 'direct', id: '' })], signup_attribution: [] as Record<string, unknown>[] };
    const db = makeFakeDb(t);
    await claimAnonAttribution(db, {
      anonId: B, verifiedEmail: 'f@example.com', accountCreatedAt: '2026-09-20T12:00:00Z',
      clientFirstTouch: { captured_at: '2026-09-20T11:00:00Z', entry: 'share', share_id: S, utm_source: 'share' },
    });
    expect(t.signup_attribution[0].share_id).toBeNull();
  });

  it('rejects an anon id or email that is not well formed', async () => {
    const db = makeFakeDb({});
    expect((await claimAnonAttribution(db, { anonId: 'anon:bad', verifiedEmail: 'a@b.com', accountCreatedAt: null })).ok).toBe(false);
    expect((await claimAnonAttribution(db, { anonId: B, verifiedEmail: B, accountCreatedAt: null })).ok).toBe(false);
  });
});

describe('sanitizeTouch', () => {
  it('keeps only known keys and drops a malformed share id', () => {
    expect(sanitizeTouch({ utm_source: 'share', share_id: 'nope', evil: 'x', captured_at: 't' }))
      .toEqual({ utm_source: 'share', captured_at: 't' });
  });
});
