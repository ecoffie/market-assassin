/**
 * OSBP parent-command alias resolution (FM-06, Eric/QA 2026-07-28). lookup_federal_osbp returned
 * grounded:false for a field activity / PEO / subcommand ("Indian Head", "PEO Ammunition", "Joint
 * Munitions Command") — those aren't top-level command keys, but the PARENT command's OSBP is the right
 * small-business door. getCommandInfo now aliases them to a real parent command (verified present).
 */
import { describe, it, expect } from 'vitest';
import { getCommandInfo } from './command-info';

describe('OSBP alias resolution (FM-06) — field activity / PEO → parent command OSBP', () => {
  it('the exact FM-06 misses now resolve to a real parent command', () => {
    expect(getCommandInfo('Indian Head')?.abbreviation).toBe('NAVSEA');
    expect(getCommandInfo('PEO Ammunition')?.abbreviation).toBe('ACC');
    expect(getCommandInfo('Joint Munitions Command')?.abbreviation).toBe('ACC');
  });
  it('Navy warfare centers → NAVSEA', () => {
    for (const q of ['NSWC Dahlgren', 'Naval Surface Warfare Center', 'NUWC Newport', 'Crane']) {
      expect(getCommandInfo(q)?.abbreviation, q).toBe('NAVSEA');
    }
  });
  it('Army armament/munitions → ACC or TACOM (real armament OSBP parents)', () => {
    expect(getCommandInfo('ACC-Picatinny')?.abbreviation).toBe('ACC');
    expect(getCommandInfo('Rock Island Arsenal')?.abbreviation).toBe('ACC');
    expect(getCommandInfo('Detroit Arsenal')?.abbreviation).toBe('TACOM');
  });
  it('a DIRECT command key still wins (alias never overrides an exact match)', () => {
    expect(getCommandInfo('NAVSEA')?.abbreviation).toBe('NAVSEA');
    expect(getCommandInfo('TACOM')?.abbreviation).toBe('TACOM');
  });
  it('an unknown agency still returns null (never fabricates a parent)', () => {
    expect(getCommandInfo('totally made up command xyz')).toBeNull();
  });
});
