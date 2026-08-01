/**
 * Guards for SAM `agency_hierarchy` → office-name extraction.
 *
 * Every case here is a REAL row that broke an earlier version of this parser
 * (measured against sam_opportunities, 2026-07-31). They exist to stop the
 * three failure modes that a naive "take the last segment" rule produces:
 * junk routing-code prefixes, bare-code stubs, and non-DoDAAC solicitation
 * numbers slicing into garbage.
 */
import { describe, it, expect } from 'vitest';
import { officeNameFromHierarchy } from './refresh-dodaac-directory';

describe('officeNameFromHierarchy', () => {
  it('strips the parent routing code from the leaf', () => {
    // W912DR — leaf is "W2SD ENDIST BALTIMORE"; W2SD is the division's code.
    expect(
      officeNameFromHierarchy(
        'DEPT OF DEFENSE.DEPT OF THE ARMY.US ARMY CORPS OF ENGINEERS.ENGINEER DIVISION NORTH ATLANTIC.ENDIST BALTIMORE.W2SD ENDIST BALTIMORE'
      )
    ).toBe('ENDIST BALTIMORE');
  });

  it('keeps the untruncated district name SAM provides', () => {
    // W912EF — FPDS truncates this to "US ARMY ENGINEER DISTRICT WALLA WAL".
    expect(
      officeNameFromHierarchy(
        'DEPT OF DEFENSE.DEPT OF THE ARMY.US ARMY CORPS OF ENGINEERS.ENGINEER DIVISION NORTHWESTERN.ENDIST WALLA WALLA'
      )
    ).toBe('ENDIST WALLA WALLA');
  });

  it('does not use a fixed depth index (depth varies 5-7)', () => {
    // W911S2 is depth 7; the leaf, not level 5, is the specific office.
    expect(
      officeNameFromHierarchy(
        'DEPT OF DEFENSE.DEPT OF THE ARMY.AMC.ACC.MISSION INSTALLATION CONTRACTING COMMAND.419TH CSB.MICC-FT DRUM'
      )
    ).toBe('MICC-FT DRUM');
  });

  it('rejects bare-code stubs that are not names', () => {
    // Real leaves that would otherwise be stored as office names.
    for (const junk of ['_', '1', 'FAO', 'PL8', 'ABMC', 'SERO']) {
      expect(officeNameFromHierarchy(`DEPT OF X.SUB.${junk}`)).toBeNull();
    }
  });

  it('returns null for empty or missing hierarchies', () => {
    expect(officeNameFromHierarchy('')).toBeNull();
    expect(officeNameFromHierarchy('...')).toBeNull();
  });

  it('does not strip an all-alpha leading word as if it were a code', () => {
    // REGRESSION: "ENDIST" is 6 uppercase chars and looks like a routing code,
    // but has no digit. Stripping it deletes the Corps-of-Engineers marker.
    expect(officeNameFromHierarchy('DEPT OF X.SUB.ENDIST NEW ENGLAND')).toBe('ENDIST NEW ENGLAND');
    expect(officeNameFromHierarchy('DEPT OF X.SUB.NAVSUP FLT LOG CTR NORFOLK')).toBe(
      'NAVSUP FLT LOG CTR NORFOLK'
    );
  });

  it('rejects a leaf that is all codes with no real word', () => {
    // Digit-bearing prefix and "A1" is not a word — there is no name here at
    // all, so this must be dropped rather than stored as "W912 A1".
    expect(officeNameFromHierarchy('DEPT OF X.SUB.W912 A1')).toBeNull();
  });
});
