/**
 * Hosted report link controls in the store (report sharing Option 1, Eric 2026-11-22).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeMarketReportsDb } from './__tests__/fake-market-reports-db';

const db = fakeMarketReportsDb();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db.client }));

import {
  linkStatus, saveMarketReport, getMarketReport, getOwnedMarketReport, listOwnedMarketReports,
  revokeOwnedReportLink, setOwnedReportExpiry, extendedExpiry, deleteOwnedMarketReport, REPORT_LINK_DAYS,
} from './report-store';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-22T12:00:00Z');

beforeEach(() => {
  db.rows.length = 0;
  db.state.missingLinkColumns = false;
  db.state.failNext = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
});

const save = () => saveMarketReport({ ownerEmail: 'sue@example.com', subject: 'drones', clientName: 'Acme', params: {}, payload: { subject: 'drones' } });

describe('linkStatus', () => {
  it('a row with no expiry and not revoked is live (every link that exists today)', () => {
    expect(linkStatus({ expires_at: null, revoked_at: null }, NOW)).toBe('live');
    expect(linkStatus({}, NOW)).toBe('live'); // before the migration: columns absent
  });
  it('future expiry is live; past (or exactly now) is expired', () => {
    expect(linkStatus({ expires_at: new Date(NOW + DAY).toISOString() }, NOW)).toBe('live');
    expect(linkStatus({ expires_at: new Date(NOW - 1).toISOString() }, NOW)).toBe('expired');
    expect(linkStatus({ expires_at: new Date(NOW).toISOString() }, NOW)).toBe('expired');
  });
  it('revoked wins over a future expiry', () => {
    expect(linkStatus({ expires_at: new Date(NOW + DAY).toISOString(), revoked_at: new Date(NOW).toISOString() }, NOW)).toBe('revoked');
  });
});

describe('saveMarketReport', () => {
  it('new links expire after 90 days', async () => {
    const before = Date.now();
    const id = await save();
    expect(id).toBeTruthy();
    const exp = Date.parse(String(db.rows[0].expires_at));
    expect(REPORT_LINK_DAYS).toBe(90);
    expect(exp - before).toBeGreaterThanOrEqual(90 * DAY - 1000);
    expect(exp - before).toBeLessThanOrEqual(90 * DAY + 5000);
    expect(db.rows[0].revoked_at).toBeUndefined();
  });

  it('before the migration is applied, the report is still saved (without an expiry), never lost', async () => {
    db.state.missingLinkColumns = true;
    const id = await save();
    expect(id).toBeTruthy();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].expires_at).toBeUndefined();
    db.state.missingLinkColumns = false;
    const loaded = await getMarketReport(id!);
    expect(linkStatus(loaded!)).toBe('live');
  });

  it('stores the owner key lowercase, so the (lowercased) verified owner keeps access', async () => {
    const id = await saveMarketReport({ ownerEmail: '  Sue.Smith@Example.COM ', subject: 's', params: {}, payload: { subject: 's' } });
    expect(db.rows[0].owner_email).toBe('sue.smith@example.com');
    expect(await getOwnedMarketReport(id!, 'sue.smith@example.com')).not.toBeNull();
  });

  it('an unrelated storage error still returns null (no silent retry)', async () => {
    db.state.failNext = 'boom';
    expect(await save()).toBeNull();
    expect(db.rows).toHaveLength(0);
  });
});

describe('owner controls', () => {
  it('revoking the link never deletes the report; the owner still loads it, payload included', async () => {
    const id = (await save())!;
    expect(await revokeOwnedReportLink(id, 'sue@example.com', NOW)).toBe(true);
    expect(db.rows).toHaveLength(1);
    const r = await getOwnedMarketReport(id, 'sue@example.com');
    expect(r?.payload).toEqual({ subject: 'drones' });
    expect(linkStatus(r!)).toBe('revoked');
  });

  it('an expired link never deletes the report either', async () => {
    const id = (await save())!;
    await setOwnedReportExpiry(id, 'sue@example.com', new Date(NOW - DAY).toISOString());
    expect(db.rows).toHaveLength(1);
    expect(linkStatus((await getOwnedMarketReport(id, 'sue@example.com'))!, NOW)).toBe('expired');
  });

  it('every owner action is scoped to the owner: another account changes and reads nothing', async () => {
    const id = (await save())!;
    expect(await getOwnedMarketReport(id, 'eve@example.com')).toBeNull();
    expect(await revokeOwnedReportLink(id, 'eve@example.com')).toBe(false);
    expect(await setOwnedReportExpiry(id, 'eve@example.com', new Date().toISOString())).toBe(false);
    expect(await deleteOwnedMarketReport(id, 'eve@example.com')).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].revoked_at).toBeUndefined();
    expect(await listOwnedMarketReports('eve@example.com')).toEqual([]);
  });

  it('delete is the only path that removes the row', async () => {
    const id = (await save())!;
    expect(await deleteOwnedMarketReport(id, 'sue@example.com')).toBe(true);
    expect(db.rows).toHaveLength(0);
    expect(await getMarketReport(id)).toBeNull();
  });

  it('the owner list carries link fields and never the payload; a storage error is null, not empty', async () => {
    await save();
    const list = await listOwnedMarketReports('sue@example.com');
    expect(list).toHaveLength(1);
    expect(Object.keys(list![0]).sort()).toEqual(['client_name', 'created_at', 'expires_at', 'id', 'revoked_at', 'subject']);
    db.state.failNext = 'down';
    expect(await listOwnedMarketReports('sue@example.com')).toBeNull();
  });

  it('the owner list works before the migration (all links live)', async () => {
    await save();
    db.state.missingLinkColumns = true;
    const list = await listOwnedMarketReports('sue@example.com');
    expect(list).toHaveLength(1);
    expect(linkStatus(list![0])).toBe('live');
  });

  it('extendedExpiry counts from the later of now and the current expiry', () => {
    expect(extendedExpiry(new Date(NOW + 10 * DAY).toISOString(), 30, NOW)).toBe(new Date(NOW + 40 * DAY).toISOString());
    expect(extendedExpiry(new Date(NOW - 10 * DAY).toISOString(), 30, NOW)).toBe(new Date(NOW + 30 * DAY).toISOString());
  });
});
