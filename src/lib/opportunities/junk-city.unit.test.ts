/**
 * THE JUNK-CITY GUARD (Eric, 2026-09-12: "a value like 77416|DC or 0|TX must never become
 * exact/city because a geocoder happened to accept it").
 *
 * 484 of the 10,491 unmapped open rows carry a NUMERIC "city": "0" (~330 — 0|OK 48, 0|CA 41,
 * 0|TX 38) and ZIPs sitting in the city column (77416|DC 13, 53470|VA 7). "0" is a placeholder,
 * not a place; a ZIP in the city field is a data-entry error. Either one accepted as a city NAME
 * is a confidently-wrong pin — the exact failure class this repo calls a number that looks
 * plausible enough to influence a decision.
 *
 * A real ZIP still geocodes — through pop_zip, its actual column. This guard only stops it being
 * read as a city name.
 */
import { describe, it, expect } from 'vitest';
import { isJunkCity } from '../../../scripts/backfill-sam-map-latlng';

describe('isJunkCity', () => {
  it('rejects the placeholder "0" (the single most common junk value)', () => {
    expect(isJunkCity('0')).toBe(true);
    expect(isJunkCity(' 0 ')).toBe(true);
  });

  it('rejects a ZIP sitting in the city field', () => {
    for (const z of ['77416', '53470', '48560', '70000', '51595']) {
      expect(isJunkCity(z), `${z} is a ZIP, not a city name`).toBe(true);
    }
  });

  it('rejects empty/missing', () => {
    expect(isJunkCity('')).toBe(true);
    expect(isJunkCity('   ')).toBe(true);
    expect(isJunkCity(null)).toBe(true);
    expect(isJunkCity(undefined)).toBe(true);
  });

  it('ACCEPTS real cities, including military installations and digit-containing names', () => {
    for (const c of [
      'Washington', 'KANSAS CITY', 'Curtis Bay', 'Wright Patterson AFB',
      'Aberdeen Proving Ground', 'JBPHH', 'Twentynine Palms', 'Fort Bragg',
    ]) {
      expect(isJunkCity(c), `${c} is a real place`).toBe(false);
    }
  });

  it('accepts a name that merely CONTAINS digits (only all-digits is junk)', () => {
    expect(isJunkCity('29 Palms')).toBe(false);
  });
});
