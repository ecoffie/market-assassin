/**
 * COMPANY SETUP — Skip is not acceptance.
 *
 * Writing `derived_suggestion` on skip would recreate the defect the provenance column
 * exists to end, one level more sophisticated:
 *     old: "these five defaults exist, therefore this user has NAICS"
 *     new: "Mindy suggested these, therefore this user has NAICS"
 * Measured cost of the first version: 7,928 of 9,778 users (81.1%) carrying a placeholder
 * nobody chose, while downstream readers treated `naics_codes IS NOT NULL` as evidence of
 * personalization.
 */
import { describe, it, expect } from 'vitest';
import { resolveSetupWrite, provenanceRank } from './company-setup-outcome';

const SUGGESTIONS = {
  naicsCodes: ['238160', '236220'],
  keywords: ['roofing', 'building envelope'],
  pscCodes: ['Z1AA'],
};

describe('⚠️ SKIP IS NOT ACCEPTANCE', () => {
  it('writes NOTHING to the active profile', () => {
    const r = resolveSetupWrite('skip', SUGGESTIONS);
    expect(r.profile).toEqual({});
    expect(r.writesNothing).toBe(true);
  });

  it('never claims provenance on skip', () => {
    expect(resolveSetupWrite('skip', SUGGESTIONS).profile.naics_source).toBeUndefined();
  });

  it('spreading the result into an update is a NO-OP', () => {
    // The failure mode this guards: a caller doing `{...updates, ...result.profile}` and
    // silently writing suggestions the user walked away from.
    const update = { updated_at: 'now', ...resolveSetupWrite('skip', SUGGESTIONS).profile };
    expect(Object.keys(update)).toEqual(['updated_at']);
  });
});

describe('CONFIRM — reviewed and accepted', () => {
  it('writes the retained items as user_confirmed', () => {
    const r = resolveSetupWrite('confirm', SUGGESTIONS);
    expect(r.profile.naics_codes).toEqual(['238160', '236220']);
    expect(r.profile.naics_source).toBe('user_confirmed');
    expect(r.profile.keywords).toEqual(['roofing', 'building envelope']);
  });

  it('honours removals — only what survived is written', () => {
    const r = resolveSetupWrite('confirm', { naicsCodes: ['238160'], keywords: ['roofing'] });
    expect(r.profile.naics_codes).toEqual(['238160']);
    expect(r.profile.naics_source).toBe('user_confirmed');
  });
});

describe("ACCEPT_ALL — 'use Mindy's suggestions for now'", () => {
  it('writes them as derived_suggestion, NOT user_confirmed', () => {
    const r = resolveSetupWrite('accept_all', SUGGESTIONS);
    expect(r.profile.naics_codes).toEqual(['238160', '236220']);
    expect(r.profile.naics_source).toBe('derived_suggestion');
  });

  it('an UNREVIEWED suggestion is never user_confirmed', () => {
    expect(resolveSetupWrite('accept_all', SUGGESTIONS).profile.naics_source).not.toBe('user_confirmed');
  });
});

describe('this flow never creates a system_default', () => {
  it.each(['confirm', 'accept_all', 'skip'] as const)('%s does not write system_default', (a) => {
    expect(resolveSetupWrite(a, SUGGESTIONS).profile.naics_source).not.toBe('system_default');
  });
});

describe('an empty selection is not a statement', () => {
  it('confirming nothing writes nothing', () => {
    const r = resolveSetupWrite('confirm', { naicsCodes: [], keywords: [] });
    expect(r.writesNothing).toBe(true);
    expect(r.profile).toEqual({});
  });

  it('blank and duplicate entries are cleaned before writing', () => {
    const r = resolveSetupWrite('confirm', { naicsCodes: ['238160', ' 238160 ', '', '  '] });
    expect(r.profile.naics_codes).toEqual(['238160']);
  });
});

describe('the trust hierarchy is ordered', () => {
  it('user_confirmed > derived_suggestion > system_default > unknown', () => {
    expect(provenanceRank('user_confirmed')).toBeGreaterThan(provenanceRank('derived_suggestion'));
    expect(provenanceRank('derived_suggestion')).toBeGreaterThan(provenanceRank('system_default'));
    expect(provenanceRank('system_default')).toBeGreaterThan(provenanceRank(null));
  });

  it('unknown provenance ranks BELOW a system default', () => {
    // A default is a known-unknown; null is simply unexamined.
    expect(provenanceRank(undefined)).toBe(0);
  });
});
