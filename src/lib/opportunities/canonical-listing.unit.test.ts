import { describe, it, expect } from 'vitest';
import {
  canonicalListingKey,
  canonicalWinner,
  dedupeByListing,
  countDistinctListings,
} from './canonical-listing';

// Mirrors the REAL duplicate structure: one SAM solicitation posted as many notice_ids (synopsis +
// each amendment). VA 36C77026R0007 had 4 rows; here we model the same shape compactly.
function rows() {
  return [
    // solicitation A — 3 duplicate notices (the "same listing, many rows" case)
    { notice_id: 'a1', solicitation_number: '36C77026R0007', posted_date: '2026-07-23', intel_value_range: { median: 290455 } },
    { notice_id: 'a2', solicitation_number: '36C77026R0007', posted_date: '2026-06-24', intel_value_range: { median: 1127561 } },
    { notice_id: 'a3', solicitation_number: '36C77026R0007', posted_date: '2026-05-01', intel_value_range: null },
    // solicitation B — single row
    { notice_id: 'b1', solicitation_number: 'SPE4A626T11PZ', posted_date: '2026-07-01', intel_value_range: { median: 219665 } },
    // solicitation-less notice — must stay its OWN listing (fallback = notice_id), never merged with others
    { notice_id: 'c1', solicitation_number: '', posted_date: '2026-07-10', intel_value_range: null },
    { notice_id: 'c2', solicitation_number: null, posted_date: '2026-07-11', intel_value_range: null },
  ];
}

describe('canonical listing — one key everywhere', () => {
  it('key prefers solicitation number (uppercased), falls back to notice_id, prefixed so they never collide', () => {
    expect(canonicalListingKey({ solicitation_number: '36c77026r0007', notice_id: 'a1' })).toBe('sol:36C77026R0007');
    expect(canonicalListingKey({ solicitation_number: '', notice_id: 'c1' })).toBe('nid:c1');
    expect(canonicalListingKey({ solicitation_number: null, notice_id: 'c2' })).toBe('nid:c2');
    // A notice_id can never masquerade as a solicitation (different prefixes).
    expect(canonicalListingKey({ notice_id: 'X' })).not.toBe(canonicalListingKey({ solicitation_number: 'X' }));
    // Unusable row (no key at all).
    expect(canonicalListingKey({})).toBe('');
  });

  it('winner: an M-Estimate beats none; tie → most recently posted (deterministic)', () => {
    const withEst = { notice_id: 'a1', posted_date: '2026-01-01', intel_value_range: { median: 100 } };
    const noEst = { notice_id: 'a2', posted_date: '2026-12-31', intel_value_range: null };
    // Estimate wins even though the other is newer.
    expect(canonicalWinner(withEst, noEst).notice_id).toBe('a1');
    // Both have estimates → newest posted wins.
    const older = { notice_id: 'x', posted_date: '2026-06-24', intel_value_range: { median: 1 } };
    const newer = { notice_id: 'y', posted_date: '2026-07-23', intel_value_range: { median: 2 } };
    expect(canonicalWinner(older, newer).notice_id).toBe('y');
    expect(canonicalWinner(newer, older).notice_id).toBe('y'); // order-independent
  });

  // (1) raw duplicate rows remain PRESERVED for amendment/history purposes.
  it('preserves the raw duplicate rows (dedupe is non-mutating; the source array is untouched)', () => {
    const input = rows();
    const before = JSON.parse(JSON.stringify(input));
    dedupeByListing(input);
    expect(input).toEqual(before); // the 3 duplicate solicitation-A rows still all exist in the source
    expect(input.filter((r) => r.solicitation_number === '36C77026R0007')).toHaveLength(3);
  });

  // (2) only ONE canonical listing is counted per solicitation.
  it('collapses each solicitation to ONE canonical row (the estimate-bearing newest)', () => {
    const deduped = dedupeByListing(rows());
    // A(3 rows)→1, B(1)→1, C(2 solicitation-less)→2 distinct = 4 unique listings.
    expect(deduped).toHaveLength(4);
    const a = deduped.find((r) => r.solicitation_number === '36C77026R0007');
    expect(a?.notice_id).toBe('a1'); // the $290,455 / newest row won — the drawer opens THIS notice
    // The solicitation-less notices stay separate (not merged into one).
    expect(deduped.filter((r) => !String(r.solicitation_number ?? '').trim())).toHaveLength(2);
  });

  // (4) the count equals the unique listings represented by the (deduped) dataset — same key, by
  // construction: countDistinctListings over the RAW rows === dedupeByListing(rows).length.
  it('countDistinctListings === deduped pin count (the count can never disagree with the pins)', () => {
    const raw = rows();
    const keyRows = raw.map((r) => ({ solicitation_number: r.solicitation_number, notice_id: r.notice_id }));
    expect(countDistinctListings(keyRows)).toBe(dedupeByListing(raw).length);
    expect(countDistinctListings(keyRows)).toBe(4);
  });

  // (3) changing the filtered set updates the unique count correctly.
  it('a filter that drops rows updates the unique count (and never counts a dropped listing)', () => {
    const raw = rows();
    // Simulate a filter that keeps only solicitation A's rows → still ONE unique listing.
    const onlyA = raw.filter((r) => r.solicitation_number === '36C77026R0007');
    expect(countDistinctListings(onlyA.map((r) => ({ solicitation_number: r.solicitation_number, notice_id: r.notice_id })))).toBe(1);
    // A filter that removes A entirely → the count drops A's listing (4 → 3).
    const noA = raw.filter((r) => r.solicitation_number !== '36C77026R0007');
    expect(countDistinctListings(noA.map((r) => ({ solicitation_number: r.solicitation_number, notice_id: r.notice_id })))).toBe(3);
    // Empty filtered set → 0.
    expect(countDistinctListings([])).toBe(0);
  });

  it('drops truly unusable rows (no solicitation AND no notice_id) from BOTH count and dedupe', () => {
    const junk = [{ solicitation_number: '', notice_id: '' }, { solicitation_number: 'S1', notice_id: 'n1' }];
    expect(countDistinctListings(junk)).toBe(1);
    expect(dedupeByListing(junk)).toHaveLength(1);
  });
});
