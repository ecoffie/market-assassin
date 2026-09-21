import { describe, it, expect } from 'vitest';
import {
  parseBulkImportRows,
  computeBulkImportCap,
  clientWorkspaceId,
  recipientFromPrimary,
  BULK_IMPORT_MAX_ROWS,
} from './coach-provision';

/**
 * Coach Mode bulk-import is the NCMBC demo path (memory: coach_mode_tenancy). The
 * cap math has a null-means-unlimited branch that, if wrong, would silently
 * truncate an SBDC/APEX importing hundreds of clients — a demo-killer. Locked here.
 */

describe('computeBulkImportCap — the enterprise unlimited branch', () => {
  it('maxClients=null → UNLIMITED: processes every row regardless of existing count', () => {
    const r = computeBulkImportCap(300, null, 250);
    expect(r.remaining).toBe(300);
    expect(r.rejectedForCap).toBe(0);
  });

  it('maxClients=undefined is also treated as unlimited (defensive)', () => {
    const r = computeBulkImportCap(60, undefined, 0);
    expect(r.remaining).toBe(60);
    expect(r.rejectedForCap).toBe(0);
  });

  it('a finite cap allows only the remaining slots and rejects the rest', () => {
    // cap 10, already 8 active → only 2 slots left of a 5-row import
    const r = computeBulkImportCap(5, 10, 8);
    expect(r.remaining).toBe(2);
    expect(r.rejectedForCap).toBe(3);
  });

  it('a full cap rejects everything (never negative remaining)', () => {
    const r = computeBulkImportCap(5, 10, 10);
    expect(r.remaining).toBe(0);
    expect(r.rejectedForCap).toBe(5);
  });

  it('over-full cap (existing > cap) still floors remaining at 0', () => {
    const r = computeBulkImportCap(5, 10, 99);
    expect(r.remaining).toBe(0);
    expect(r.rejectedForCap).toBe(5);
  });

  it('never processes more than the rows requested even with huge headroom', () => {
    const r = computeBulkImportCap(3, 1000, 0);
    expect(r.remaining).toBe(3);
    expect(r.rejectedForCap).toBe(0);
  });
});

describe('parseBulkImportRows', () => {
  it('accepts business_name OR name, trims, and carries capability + email', () => {
    const rows = parseBulkImportRows([
      { business_name: '  ACME Corp ', capability_text: 'welding', primary_email: 'a@acme.com' },
      { name: 'Beta LLC' },
    ]);
    expect(rows).toEqual([
      { businessName: 'ACME Corp', capabilityText: 'welding', primaryEmail: 'a@acme.com' },
      { businessName: 'Beta LLC', capabilityText: null, primaryEmail: null },
    ]);
  });

  it('drops rows with no business name', () => {
    const rows = parseBulkImportRows([{ capability_text: 'x' }, { name: '   ' }, { name: 'Real Co' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessName).toBe('Real Co');
  });

  it('caps at BULK_IMPORT_MAX_ROWS', () => {
    const many = Array.from({ length: BULK_IMPORT_MAX_ROWS + 50 }, (_, i) => ({ name: `Co ${i}` }));
    expect(parseBulkImportRows(many)).toHaveLength(BULK_IMPORT_MAX_ROWS);
  });

  it('returns [] for non-array / junk input', () => {
    expect(parseBulkImportRows(null)).toEqual([]);
    expect(parseBulkImportRows('nope')).toEqual([]);
    expect(parseBulkImportRows(undefined)).toEqual([]);
  });
});

describe('clientWorkspaceId — stable + collision-resistant', () => {
  it('is deterministic for the same org + name (idempotent provisioning)', () => {
    expect(clientWorkspaceId('org-12345678', 'ACME Corp')).toBe(clientWorkspaceId('org-12345678', 'ACME Corp'));
  });

  it('slugs the business name and namespaces by org prefix', () => {
    const id = clientWorkspaceId('abcdef1234567890', 'ACME Corp, LLC');
    expect(id).toMatch(/^org-abcdef12-acme-corp-llc$/);
  });

  it('falls back to "client" when the name has no alphanumerics', () => {
    expect(clientWorkspaceId('org-11111111', '!!!')).toMatch(/-client$/);
  });
});

describe('recipientFromPrimary — undeliverable guard', () => {
  it('returns a real email lowercased', () => {
    expect(recipientFromPrimary('Ops@ACME.com')).toBe('ops@acme.com');
  });

  it('rejects blanks, non-emails, and the synthetic client namespace', () => {
    expect(recipientFromPrimary('')).toBeNull();
    expect(recipientFromPrimary('not-an-email')).toBeNull();
    expect(recipientFromPrimary('org-x-acme@clients.getmindy.ai')).toBeNull();
  });
});
