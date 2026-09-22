/**
 * OSBP parent-command alias resolution (FM-06, Eric/QA 2026-07-28). lookup_federal_osbp returned
 * grounded:false for a field activity / PEO / subcommand ("Indian Head", "PEO Ammunition", "Joint
 * Munitions Command") — those aren't top-level command keys, but the PARENT command's OSBP is the right
 * small-business door. getCommandInfo now aliases them to a real parent command (verified present).
 */
import { describe, it, expect } from 'vitest';
import commandInfoData from '@/data/dod-command-info.json';
import {
  getCommandInfo,
  getCommandsByParentAgency,
  OSBP_PARENT_ALIASES,
  type CommandInfo,
} from './command-info';

const COMMANDS = commandInfoData.commands as Record<string, CommandInfo>;

describe('OSBP alias resolution (FM-06) — field activity / PEO → parent command OSBP', () => {
  it('the exact FM-06 misses now resolve to a real parent command', () => {
    expect(getCommandInfo('Indian Head')?.abbreviation).toBe('NAVSEA');
    expect(getCommandInfo('PEO Ammunition')?.abbreviation).toBe('ACC');
    expect(getCommandInfo('Joint Munitions Command')?.abbreviation).toBe('ACC');
  });

  // FM-11 (Eric/QA 2026-07-28): the data file has TWO "ACC" commands — Army Contracting Command AND
  // Air Combat Command (Air Force). PEO Ammunition resolved to the AIR FORCE (confidently wrong).
  // Assert on the SERVICE (parentAgency), not just the ambiguous "ACC" abbreviation, which is what
  // let the bug hide. Army munitions must NEVER route to the Air Force.
  it('Army munitions aliases resolve to the ARMY, never Air Force ACC (FM-11)', () => {
    for (const q of ['PEO Ammunition', 'Joint Munitions Command', 'JMC', 'ACC-Picatinny', 'Rock Island Arsenal']) {
      const info = getCommandInfo(q);
      expect(info?.fullName, q).toBe('Army Contracting Command');
      expect(info?.parentAgency, q).toMatch(/Army/i);
      expect(info?.parentAgency, q).not.toMatch(/Air Force/i);
    }
  });
  it('a direct "ACC" query still resolves (Air Combat Command by key) — the alias does not hijack it', () => {
    // A bare "ACC" is a direct key hit for Air Combat Command; the Army alias must not intercept it.
    expect(getCommandInfo('ACC')?.parentAgency).toMatch(/Air Force/i);
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

  it('every alias parent is a known directory key whose service matches parentAgency', () => {
    expect(OSBP_PARENT_ALIASES.length).toBeGreaterThan(0);
    for (const { parent, service } of OSBP_PARENT_ALIASES) {
      const resolved = COMMANDS[parent];
      expect(resolved, parent).toBeTruthy();
      expect(
        resolved.parentAgency.toUpperCase().includes(service.toUpperCase())
        || resolved.fullName.toUpperCase().includes(service.toUpperCase()),
        `${parent} service=${service} parentAgency=${resolved.parentAgency}`,
      ).toBe(true);
    }
  });

  it('word boundaries: a token substring is not an alias hit', () => {
    expect(getCommandInfo('cranberry')).toBeNull();
    expect(getCommandInfo('indianhead')).toBeNull();
    expect(getCommandInfo('picatinnyx')).toBeNull();
  });

  it('aliases do not capture parent or toptier identity queries', () => {
    expect(getCommandInfo('Navy')).toBeNull();
    expect(getCommandInfo('Department of Homeland Security')?.abbreviation).toBe('DHS');
    expect(getCommandInfo('United States Coast Guard')?.abbreviation).toBe('USCG');
  });

  it('Indian Head is NAVSEA, not whichever Navy child appears first', () => {
    const firstNavyChild = getCommandsByParentAgency('Navy')[0];
    expect(firstNavyChild).toBeTruthy();
    const indianHead = getCommandInfo('Indian Head');
    expect(indianHead?.abbreviation).toBe('NAVSEA');
    expect(indianHead?.fullName).toBe(COMMANDS.NAVSEA.fullName);
    if (firstNavyChild.abbreviation !== 'NAVSEA') {
      expect(indianHead?.abbreviation).not.toBe(firstNavyChild.abbreviation);
    }
  });
});
