import { describe, it, expect } from 'vitest';
import { deriveNavySourceState } from './navy-watch';
import { hashSourceFingerprint } from './navy-lrae';

describe('Navy source state — revision current is NOT content current', () => {
  it('THE NAVY CASE: matching revision, short population -> content_stale', () => {
    const r = deriveNavySourceState('current', 9922, 8821);
    expect(r.state).toBe('content_stale');
    expect(r.detail).toContain('9922');
    expect(r.detail).toContain('8821');
  });

  it('a newer upstream revision -> content_stale regardless of population', () => {
    expect(deriveNavySourceState('behind_upstream', 100, 100).state).toBe('content_stale');
  });

  it('unmeasured upstream can NEVER report current', () => {
    expect(deriveNavySourceState('latest_upstream_unmeasured', 9922, 8821).state).toBe('unreachable');
    expect(deriveNavySourceState('latest_upstream_unmeasured', null, null).state).toBe('unreachable');
  });

  it('an unmeasured population is not equality — never current', () => {
    expect(deriveNavySourceState('current', null, 8821).state).toBe('unmeasured');
    expect(deriveNavySourceState('current', 9922, null).state).toBe('unmeasured');
  });

  it('only a genuine match on BOTH axes is current', () => {
    expect(deriveNavySourceState('current', 9922, 9922).state).toBe('current');
  });

  it('held exceeding upstream is not stale (we are not behind)', () => {
    expect(deriveNavySourceState('current', 8000, 8821).state).toBe('current');
  });
});

describe('SOURCE FINGERPRINT — same revision can change in place', () => {
  // A. identical on all three axes -> unchanged
  it('A. 02.2026 / 9,922 / fingerprint A -> unchanged (current)', () => {
    expect(deriveNavySourceState('current', 9922, 9922, 'unchanged').state).toBe('current');
  });

  // B. THE WHOLE POINT: revision and population identical, bytes different.
  it('B. 02.2026 / 9,922 / fingerprint B -> changed, intervention required', () => {
    const r = deriveNavySourceState('current', 9922, 9922, 'changed');
    expect(r.state).toBe('content_stale');
    expect(r.detail).toContain('changed in place');
  });

  // C. population moves -> changed even if the fingerprint somehow matched
  it('C. 02.2026 / 10,000 upstream vs 9,922 held / fingerprint A -> changed', () => {
    expect(deriveNavySourceState('current', 10000, 9922, 'unchanged').state).toBe('content_stale');
  });

  // D. contract metadata gone -> UNMEASURED, never unchanged
  it('D. missing etag/last-modified/size -> unmeasured, NOT unchanged', () => {
    const r = deriveNavySourceState('current', 9922, 9922, 'unmeasured');
    expect(r.state).toBe('unmeasured');
    expect(r.state).not.toBe('current');
    expect(r.detail).toContain('cannot prove');
  });

  it('a changed fingerprint outranks a matching revision AND a matching population', () => {
    // Without the fingerprint axis this exact input reads "current".
    expect(deriveNavySourceState('current', 9922, 9922).state).toBe('current');
    expect(deriveNavySourceState('current', 9922, 9922, 'changed').state).toBe('content_stale');
  });
});

describe('hashSourceFingerprint', () => {
  it('is deterministic and order-sensitive (etag/size cannot swap)', () => {
    const a = hashSourceFingerprint({ revision: '02.2026', etag: 'X', lastModified: 'L', contentLength: 10 });
    const b = hashSourceFingerprint({ revision: '02.2026', etag: 'X', lastModified: 'L', contentLength: 10 });
    const c = hashSourceFingerprint({ revision: '02.2026', etag: '10', lastModified: 'L', contentLength: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('returns NULL when no metadata is comparable — never a hash of nothing', () => {
    expect(hashSourceFingerprint({ revision: '02.2026', etag: null, lastModified: null, contentLength: null })).toBeNull();
  });

  it('a bumped SharePoint etag version counter changes the hash', () => {
    const v4 = hashSourceFingerprint({ revision: '02.2026', etag: '"{ABC},4"', lastModified: 'L', contentLength: 4118847 });
    const v5 = hashSourceFingerprint({ revision: '02.2026', etag: '"{ABC},5"', lastModified: 'L', contentLength: 4118847 });
    expect(v4).not.toBe(v5);
  });
});
