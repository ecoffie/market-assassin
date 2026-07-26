/**
 * Guards formatAgencyDisplay — the agency-name normalizer for Gov Buyer cards/pins/drawer.
 *
 * The bug it fixes: the opportunity-map's client-side clean() stripped ", DEPARTMENT OF"
 * and title-cased, turning "STATE, DEPARTMENT OF" into the bare word "State" (reads like a
 * field label). formatAgencyDisplay rearranges the inverted SAM form back to natural order
 * ("Department of State") and Title-Cases the rest, without inventing anything.
 */
import { describe, it, expect } from 'vitest';
import { formatAgencyDisplay } from './agency-display';

describe('formatAgencyDisplay', () => {
  it('un-inverts "<BODY>, DEPARTMENT OF" → "Department of <BODY>"', () => {
    expect(formatAgencyDisplay('STATE, DEPARTMENT OF')).toBe('Department of State');
    expect(formatAgencyDisplay('AGRICULTURE, DEPARTMENT OF')).toBe('Department of Agriculture');
    expect(formatAgencyDisplay('HEALTH AND HUMAN SERVICES, DEPARTMENT OF')).toBe('Department of Health and Human Services');
  });

  it('handles the "... OF THE" variant', () => {
    expect(formatAgencyDisplay('INTERIOR, DEPARTMENT OF THE')).toBe('Department of the Interior');
    expect(formatAgencyDisplay('TREASURY, DEPARTMENT OF THE')).toBe('Department of the Treasury');
  });

  it('title-cases plain agency names, preserving acronyms + joining words', () => {
    expect(formatAgencyDisplay('GENERAL SERVICES ADMINISTRATION')).toBe('General Services Administration');
    expect(formatAgencyDisplay('NATIONAL AERONAUTICS AND SPACE ADMINISTRATION')).toBe('National Aeronautics and Space Administration');
    expect(formatAgencyDisplay('EXPORT-IMPORT BANK OF THE US')).toBe('Export-Import Bank of the US');
    expect(formatAgencyDisplay('ENVIRONMENTAL PROTECTION AGENCY')).toBe('Environmental Protection Agency');
  });

  it('never renders the bare field-label "State"', () => {
    expect(formatAgencyDisplay('STATE, DEPARTMENT OF')).not.toBe('State');
  });

  it('empty / null → empty string (caller supplies a neutral fallback)', () => {
    expect(formatAgencyDisplay('')).toBe('');
    expect(formatAgencyDisplay(null)).toBe('');
    expect(formatAgencyDisplay(undefined)).toBe('');
  });
});
