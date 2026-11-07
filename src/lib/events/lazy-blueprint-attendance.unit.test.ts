import { describe, expect, it } from 'vitest';
import { classifyAttendance, hasZoomLink } from './lazy-blueprint-attendance';

const c = (id: string, email: string, customFields: Array<{ id: string; value: unknown }> = []) =>
  ({ id, email, firstName: '', lastName: '', phone: '', tags: [], customFields });

describe('Lazy Blueprint attendance', () => {
  it('counts 60+ seconds as attended, less as no-show, and keeps no-email registrants apart', () => {
    const r = classifyAttendance(
      [c('a', 'a@x.com'), c('b', 'b@x.com'), c('d', 'd@x.com'), c('e', '')],
      [{ email: 'a@x.com', seconds: 3600 }, { email: 'b@x.com', seconds: 20 }],
    );
    expect(r.attended.map((x) => x.id)).toEqual(['a']);
    expect(r.noShow.map((x) => x.id)).toEqual(['b', 'd']);
    expect(r.noEmail.map((x) => x.id)).toEqual(['e']);
  });

  it('finds an existing Zoom link by field id', () => {
    expect(hasZoomLink(c('a', 'a@x.com', [{ id: 'F', value: 'https://us06web.zoom.us/w/1' }]), 'F')).toBe(true);
    expect(hasZoomLink(c('a', 'a@x.com', [{ id: 'F', value: '' }]), 'F')).toBe(false);
    expect(hasZoomLink(c('a', 'a@x.com'), 'F')).toBe(false);
  });
});
