/**
 * COMMAND vocabulary — the unit contractors think in (Eric, with the army.mil
 * org chart: "we have to do this for FAA, NAVFAC, NAVSUP, NAVSEA, NAVAIR,
 * NAVWAR").
 *
 * A command's offices are almost never named after the command. Measured
 * against dodaac_directory_display 2026-08-01:
 *
 *   command   literal string match   real family
 *   USACE            1                   48     (they are "ENDIST <city>")
 *   NAVAIR           1                   19     (NAWC, NAVAIRWARCEN…)
 *   NAVSEA           1                    9     (NSWC Crane, NUWC Newport…)
 *   NAVWAR           0                    3     (all spelled NIWC)
 *
 * Every pattern below was validated against the live directory before shipping.
 */
import { describe, it, expect } from 'vitest';
import { COMMANDS, resolveCommand, officeInCommand, commandsForOffice } from './commands';

describe('resolveCommand', () => {
  it('resolves the commands Eric named', () => {
    for (const k of ['NAVSEA', 'NAVAIR', 'NAVSUP', 'NAVFAC', 'NAVWAR', 'FAA']) {
      expect(resolveCommand(k)?.key, k).toBe(k);
    }
  });

  it('resolves a RENAMED command by its old name', () => {
    // NAVWAR was SPAWAR; its centers were SSC and are now NIWC. A contractor
    // who learned the old name must still land on the right command.
    expect(resolveCommand('SPAWAR')?.key).toBe('NAVWAR');
    expect(resolveCommand('NIWC')?.key).toBe('NAVWAR');
    expect(resolveCommand('naval information warfare')?.key).toBe('NAVWAR');
  });

  it('is case-insensitive and accepts full names', () => {
    expect(resolveCommand('navsea')?.key).toBe('NAVSEA');
    expect(resolveCommand('Naval Sea Systems Command')?.key).toBe('NAVSEA');
    expect(resolveCommand('Corps of Engineers')?.key).toBe('USACE');
  });

  it('returns null for anything unrecognised', () => {
    // Callers fall through to normal search rather than silently getting a
    // wrong command.
    expect(resolveCommand('nonsense')).toBeNull();
    expect(resolveCommand('')).toBeNull();
    expect(resolveCommand('   ')).toBeNull();
  });

  it('does not let a 2-3 char fragment grab a command', () => {
    // The loose containment pass is gated at >=4 chars.
    expect(resolveCommand('na')).toBeNull();
    expect(resolveCommand('ac')).toBeNull();
  });
});

describe('officeInCommand — real office names from the directory', () => {
  const inCmd = (office: string, key: string) => {
    const c = COMMANDS.find(x => x.key === key)!;
    return officeInCommand(office, c);
  };

  it('claims the warfare centers for NAVSEA (none say "NAVSEA")', () => {
    expect(inCmd('NSWC CRANE', 'NAVSEA')).toBe(true);
    expect(inCmd('NSWC DAHLGREN', 'NAVSEA')).toBe(true);
    expect(inCmd('NUWC DIV NEWPORT', 'NAVSEA')).toBe(true);
    expect(inCmd('NAVSEA HQ', 'NAVSEA')).toBe(true);
  });

  it('claims NIWC for NAVWAR (zero offices contain "NAVWAR")', () => {
    expect(inCmd('NIWC ATLANTIC', 'NAVWAR')).toBe(true);
    expect(inCmd('NIWC PACIFIC', 'NAVWAR')).toBe(true);
  });

  it('claims ENDIST districts for USACE (only 1 of 48 says "USACE")', () => {
    expect(inCmd('ENDIST LOUISVILLE', 'USACE')).toBe(true);
    expect(inCmd('US ARMY ENGINEER DISTRICT WALLA WAL', 'USACE')).toBe(true);
  });

  it('claims NAVFACSYSCOM regions for NAVFAC', () => {
    expect(inCmd('NAVFACSYSCOM PACIFIC', 'NAVFAC')).toBe(true);
    expect(inCmd('NAVFACSYSCOM MID-ATLANTIC', 'NAVFAC')).toBe(true);
  });

  it('keeps MICC and ACC SEPARATE (both are real targeting units)', () => {
    // An earlier version had one AMC pattern covering all 79, so searching
    // "MICC" returned ACC offices too — a worse answer than the 44 asked for.
    expect(inCmd('MICC-FT BRAGG', 'MICC')).toBe(true);
    expect(inCmd('MICC-FT BRAGG', 'ACC')).toBe(false);
    expect(inCmd('ACC-APG NATICK', 'ACC')).toBe(true);
    expect(inCmd('ACC-APG NATICK', 'MICC')).toBe(false);
    // AMC is the PARENT and unions both.
    expect(inCmd('MICC-FT BRAGG', 'AMC')).toBe(true);
    expect(inCmd('ACC-APG NATICK', 'AMC')).toBe(true);
  });

  it('does not claim an unrelated office', () => {
    expect(inCmd('DLA TROOP SUPPORT', 'NAVSEA')).toBe(false);
    expect(inCmd('ENDIST LOUISVILLE', 'NAVAIR')).toBe(false);
  });
});

describe('data quality', () => {
  it('has no duplicate keys', () => {
    const keys = COMMANDS.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every command has a name, service, pattern and at least one alias', () => {
    for (const c of COMMANDS) {
      expect(c.name.length, c.key).toBeGreaterThan(0);
      expect(c.service.length, c.key).toBeGreaterThan(0);
      expect(c.pattern, c.key).toBeInstanceOf(RegExp);
      expect(c.aliases.length, c.key).toBeGreaterThan(0);
    }
  });

  it('commandsForOffice finds the parent AND the specific command', () => {
    const keys = commandsForOffice('MICC-FT BRAGG').map(c => c.key);
    expect(keys).toContain('MICC');
    expect(keys).toContain('AMC');
  });
});
