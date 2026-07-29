/**
 * The ONE briefing NAICS-profile hash (Eric/QA 2026-07-28). This md5 is the ROUTING KEY that groups
 * users into precomputed briefing templates: precompute crons WRITE naics_profile_hash, send crons
 * READ a user's template by it, triage scopes dismissals by it. It was copy-pasted into 7 routes and
 * had DRIFTED — 6 hashed [...codes].sort(), triage hashed with an extra trim+filter. Identical for
 * clean 6-digit profiles (so it hid), but a whitespace/empty code hashed two ways → a template written
 * under one key could never be found under the other. Consolidated into this lib.
 *
 * Canonical = trim + drop-empty + sort. Verified against prod: a NO-OP on 1722/1724 templates (byte-
 * identical hash to the old plain-sort form), re-keying only 2 junk [""] empty-profile templates.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { hashNaicsProfile, naicsProfileKey, normalizeNaicsProfileCodes } from './naics-profile-hash';

// The OLD cron form (plain sort, no trim/filter) — what already sits in briefing_templates.
const oldPlainSortHash = (c: string[]) =>
  crypto.createHash('md5').update(JSON.stringify([...c].sort())).digest('hex');

describe('hashNaicsProfile — the consolidated routing key', () => {
  it('a clean 6-digit profile hashes IDENTICALLY to the old plain-sort form (no orphaned templates)', () => {
    const clean = ['236115', '236116', '236117', '236118', '236210', '236220'];
    expect(hashNaicsProfile(clean)).toBe(oldPlainSortHash(clean));
    // the real stored hash for this exact profile (from prod), pinned so a future edit can't drift it
    expect(hashNaicsProfile(clean)).toBe('6acd0a76f874dd5bf4c12abf2d90732e');
  });

  it('is order-independent (sorts before hashing)', () => {
    expect(hashNaicsProfile(['541512', '541611'])).toBe(hashNaicsProfile(['541611', '541512']));
  });

  it('is whitespace/empty-robust — the drift that hid (messy == clean)', () => {
    const clean = ['541512', '541611', '541330'];
    const messy = [' 541611', '541512 ', '', '  ', '541330'];
    expect(hashNaicsProfile(messy)).toBe(hashNaicsProfile(clean));
  });

  it('the [""] junk profile re-keys to the empty-array hash (the 2 prod rows it orphans, by design)', () => {
    expect(hashNaicsProfile([''])).toBe(hashNaicsProfile([]));
    // NOT the old plain-sort hash of [""] (that is the orphaned junk-template key)
    expect(hashNaicsProfile([''])).not.toBe(oldPlainSortHash(['']));
  });

  it('null/undefined → the empty-profile hash (no throw)', () => {
    expect(hashNaicsProfile(null)).toBe(hashNaicsProfile([]));
    expect(hashNaicsProfile(undefined)).toBe(hashNaicsProfile([]));
  });
});

describe('naicsProfileKey / normalizeNaicsProfileCodes — the stored naics_profile string', () => {
  it('key is the JSON of the canonical (trimmed, sorted, empty-dropped) codes', () => {
    expect(naicsProfileKey([' 541611', '541512', ''])).toBe(JSON.stringify(['541512', '541611']));
  });
  it('normalize drops empties and sorts', () => {
    expect(normalizeNaicsProfileCodes(['  ', '541611', '541512', null as unknown as string]))
      .toEqual(['541512', '541611']);
  });
  it('the hash is md5 of exactly the key (producer + consumer share one basis)', () => {
    const codes = ['561210', '541512'];
    expect(hashNaicsProfile(codes)).toBe(
      crypto.createHash('md5').update(naicsProfileKey(codes)).digest('hex'),
    );
  });
});
