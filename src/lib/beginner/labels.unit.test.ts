import { describe, expect, it } from 'vitest';
import {
  applyEligibilityGuard,
  beginnerPscLabel,
  classifySetAside,
  dedupeStrings,
  FORBIDDEN_ELIGIBILITY_PHRASES,
  formatBeginnerAmount,
  formatDueLabel,
  parseDeadlineMs,
  translateNoticeType,
  translateSetAside,
} from './labels';

const NOW = Date.parse('2026-09-08T16:00:00Z');

describe('set-aside translation', () => {
  it('maps live SAM descriptions and codes into beginner copy', () => {
    expect(translateSetAside('Total Small Business Set-Aside (FAR 19.5)').label).toBe(
      'Small Business set-aside',
    );
    expect(translateSetAside('SBA').kind).toBe('sb');
    expect(translateSetAside('8a Competed').kind).toBe('8a');
    expect(translateSetAside('8(a) Sole Source').label).toBe('8(a) set-aside');
    expect(translateSetAside('8A').kind).toBe('8a');
    expect(translateSetAside('8AN').kind).toBe('8a');
    expect(translateSetAside('WOSB').label).toBe('Women-Owned set-aside');
    expect(translateSetAside('EDWOSB').kind).toBe('edwosb');
    expect(translateSetAside('SDVOSBC').label).toBe('Service-Disabled Veteran-Owned set-aside');
    expect(translateSetAside('HZC').kind).toBe('hubzone');
    expect(translateSetAside('No Set aside used').kind).toBe('open');
    expect(translateSetAside('NONE').kind).toBe('open');
    expect(translateSetAside(null).kind).toBe('open');
    expect(translateSetAside('').kind).toBe('open');
  });

  it('never renders a raw SAM code as the beginner label', () => {
    for (const raw of ['SBA', 'SBP', 'SDVOSBC', '8A', '8AN', 'HZC', 'WOSB', 'NONE']) {
      const copy = translateSetAside(raw);
      expect(copy.label).not.toBe(raw);
      expect(copy.label ?? '').not.toMatch(/^(SBA|SBP|SDVOSBC|8A|8AN|HZC|WOSB|NONE)$/);
    }
  });

  it('omits unrecognized all-caps codes rather than printing them', () => {
    expect(classifySetAside('QZ9')).toBe('unknown');
    expect(translateSetAside('QZ9').label).toBeNull();
  });
});

describe('notice-type translation', () => {
  it('maps actual SAM notice types into beginner labels', () => {
    expect(translateNoticeType('Solicitation').label).toBe('Open to bid now');
    expect(translateNoticeType('Combined Synopsis/Solicitation').label).toBe('Open to bid now');
    expect(translateNoticeType('Presolicitation').label).toBe('Coming soon — get ready');
    expect(translateNoticeType('Sources Sought').label).toBe("They're researching the market");
    expect(translateNoticeType('Request for Information').kind).toBe('sources_sought');
    expect(translateNoticeType('Award Notice').label).toBe('Already awarded — study who won');
  });

  it('does not call an unknown or informational notice "open to bid now"', () => {
    expect(translateNoticeType('Special Notice').label).not.toBe('Open to bid now');
    expect(translateNoticeType('Justification').label).not.toBe('Open to bid now');
    expect(translateNoticeType('Mysterious SAM Type').label).not.toBe('Open to bid now');
    expect(translateNoticeType(null).label).toBeNull();
  });
});

describe('date rendering', () => {
  it('renders due-in, due today, closed, and missing', () => {
    expect(formatDueLabel('2026-09-16T21:00:00Z', NOW)).toBe('Due in 8 days · Sept 16');
    expect(formatDueLabel('2026-09-08T20:00:00Z', NOW)).toBe('Due today');
    expect(formatDueLabel('2026-09-01T00:00:00Z', NOW)).toBe('Closed');
    expect(formatDueLabel(null, NOW)).toBe('Due date not listed');
    expect(formatDueLabel('', NOW)).toBe('Due date not listed');
    expect(formatDueLabel('not-a-date', NOW)).toBe('Due date not listed');
  });

  it('never treats unix epoch / 1970 as a real deadline', () => {
    expect(parseDeadlineMs('1970-01-01T00:00:00Z')).toBeNull();
    expect(parseDeadlineMs('0')).toBeNull();
    expect(formatDueLabel('1970-01-01T00:00:00.000Z', NOW)).toBe('Due date not listed');
  });
});

describe('amount rendering', () => {
  it('compacts dollars and distinguishes zero from missing', () => {
    expect(formatBeginnerAmount(850_000)).toEqual({ kind: 'value', label: '$850K' });
    expect(formatBeginnerAmount(1_200_000)).toEqual({ kind: 'value', label: '$1.2M' });
    expect(formatBeginnerAmount(4_700_000_000)).toEqual({ kind: 'value', label: '$4.7B' });
    expect(formatBeginnerAmount(0)).toEqual({ kind: 'zero', label: '$0' });
    expect(formatBeginnerAmount(null)).toEqual({ kind: 'missing', label: 'Amount not listed' });
    expect(formatBeginnerAmount(undefined)).toEqual({ kind: 'omitted' });
    expect(formatBeginnerAmount(Number.NaN).kind).toBe('missing');
  });
});

describe('PSC description', () => {
  it('shows a trusted description and omits a bare code', () => {
    expect(beginnerPscLabel('Janitorial Services', 'S201')).toBe('Janitorial Services');
    expect(beginnerPscLabel(null, 'S201')).toBeNull();
    expect(beginnerPscLabel('', 'S201')).toBeNull();
    expect(beginnerPscLabel(undefined, 'S201')).toBeNull();
  });
});

describe('eligibility guard', () => {
  it('never claims the user qualifies from a description-only profile', () => {
    const copy = translateSetAside('SBA');
    const guarded = applyEligibilityGuard(copy, { established: false });
    expect(guarded.userQualifies).toBe(false);
    expect(guarded.audienceLabel).toBe("Who it's for: Small businesses");
    const blob = `${copy.label} ${copy.explanation} ${guarded.audienceLabel}`.toLowerCase();
    for (const phrase of FORBIDDEN_ELIGIBILITY_PHRASES) {
      expect(blob).not.toContain(phrase);
    }
  });

  it('still uses who-its-for language even when evidence is established', () => {
    const copy = translateSetAside('8A');
    const guarded = applyEligibilityGuard(copy, {
      established: true,
      programs: ['8a'],
      source: 'profile',
    });
    expect(guarded.userQualifies).toBe(true);
    expect(guarded.audienceLabel?.toLowerCase()).not.toContain('likely you');
    expect(guarded.audienceLabel?.toLowerCase()).not.toContain('you qualify');
  });
});

describe('duplicate removal', () => {
  it('dedupes codes and keywords case-insensitively', () => {
    expect(dedupeStrings(['561720', '561720', ' 561720 ', '541512'])).toEqual(['561720', '541512']);
    expect(dedupeStrings(['Janitorial', 'janitorial', 'office cleaning'])).toEqual([
      'Janitorial',
      'office cleaning',
    ]);
  });
});
