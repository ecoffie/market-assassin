/**
 * Company set-aside chips come from SAM's REAL certifications by UEI (Eric 2026-07-28: SAM.gov is the
 * source of truth, not award inference). certBuckets maps the cert flags → the map's chip buckets; a
 * SAM-registered firm with no small-biz cert (SAIC) yields [] (no chip), un-foolable.
 */
import { describe, it, expect } from 'vitest';
import { certBuckets, type RecipientCert } from './recipient-certs';

const cert = (o: Partial<RecipientCert>): RecipientCert =>
  ({ uei: 'X', found: true, is8a: false, isSdvosb: false, isWosb: false, isHubzone: false, ...o });

describe('certBuckets — SAM certs → chip buckets', () => {
  it('SAIC (registered, no small-biz cert) → NO chip', () => {
    expect(certBuckets(cert({ found: true }))).toEqual([]);
  });
  it('a real SDVOSB firm → SDVOSB chip', () => {
    expect(certBuckets(cert({ isSdvosb: true }))).toEqual(['SDVOSB']);
  });
  it('a firm with multiple certs → all of them, ranked', () => {
    expect(certBuckets(cert({ is8a: true, isSdvosb: true, isHubzone: true }))).toEqual(['8A', 'SDVOSB', 'HZ']);
  });
  it('an UNresolved UEI (no SAM record / null) → [] (caller falls back to award-share)', () => {
    expect(certBuckets(null)).toEqual([]);
    expect(certBuckets(cert({ found: false, isSdvosb: true }))).toEqual([]); // found=false never chips
  });
});
