/**
 * COMMAND vocabulary — the unit contractors actually think and sell in.
 *
 * Eric, 2026-08-01 (with the army.mil org chart): "we have to do this for FAA,
 * NAVFAC, NAVSUP, NAVSEA, NAVAIR, NAVWAR."
 *
 * THE PROBLEM (measured against dodaac_directory_display, 2026-08-01):
 * A command's offices are almost never named after the command. Searching the
 * literal string finds a fraction of the real estate:
 *
 *   command   literal match   actual family
 *   USACE           1              48        (they are "ENDIST <city>")
 *   NAVAIR          1              19        (NAWC, NAVAIRWARCEN…)
 *   NAVFAC          1              13        (NAVFACSYSCOM, ROICC…)
 *   NAVSEA          1               9        (NSWC Crane, NUWC Newport…)
 *   NAVWAR          0               3        (NIWC Atlantic/Pacific, SPAWAR)
 *
 * So a contractor searching "NAVSEA" misses seven of its own warfare centers,
 * and "NAVWAR" returns nothing at all. This is the same shape as the ENDIST bug
 * fixed in the office alias layer, one level up: there the abbreviation was
 * invisible, here the PARENT COMMAND is.
 *
 * Kept separate from OFFICE_ABBREVIATIONS deliberately. That map answers "what
 * does this abbreviation mean" (ENDIST → Engineer District). This one answers
 * "which offices belong to this command" — a hierarchy, not a synonym. Merging
 * them would make a search for one office pull in its 47 siblings.
 */

export interface CommandDef {
  /** Canonical short name, as a contractor would type it. */
  key: string;
  /** Full name, for display. */
  name: string;
  /** Parent service/department, for grouping. */
  service: 'Army' | 'Navy' | 'Air Force' | 'DoD' | 'DHS' | 'DOT';
  /**
   * Regex (case-insensitive) matching how this command's offices are ACTUALLY
   * named in the directory. Each alternative is grounded in real office names —
   * see the counts in the header. Never speculative.
   */
  pattern: RegExp;
  /** How a user might refer to it, for the resolver. */
  aliases: string[];
}

export const COMMANDS: CommandDef[] = [
  // ---- Navy (Eric's list) ----
  {
    key: 'NAVSEA', name: 'Naval Sea Systems Command', service: 'Navy',
    // 9 offices: NAVSEA HQ, NSWC Crane/Dahlgren/Carderock/Indian Head/
    // Philadelphia, NUWC Newport, NSWCEN ATC, NAVSEALOGCEN.
    pattern: /NAVSEA|NAVAL SEA|\bNSWC|\bNUWC|SUPSHIP|NSWCEN|NAVSEALOG/i,
    aliases: ['naval sea systems command', 'sea systems', 'surface warfare center', 'undersea warfare center'],
  },
  {
    key: 'NAVAIR', name: 'Naval Air Systems Command', service: 'Navy',
    // 19 offices: NAVAIR HQ, Naval Air Warfare Center (aircraft + weapons divs).
    pattern: /NAVAIR|NAVAL AIR|\bNAWC|NAVAIRWARCEN|NAVAL AIR WARFARE/i,
    aliases: ['naval air systems command', 'air systems', 'naval air warfare center'],
  },
  {
    key: 'NAVSUP', name: 'Naval Supply Systems Command', service: 'Navy',
    // 23 offices: NAVSUP WSS Mechanicsburg/Philadelphia, Fleet Logistics Centers.
    pattern: /NAVSUP|FLT LOG|FLEET LOG|WEAPON SYSTEMS SUPPORT|NAVAL SUPPLY/i,
    aliases: ['naval supply systems command', 'fleet logistics center', 'weapon systems support'],
  },
  {
    key: 'NAVFAC', name: 'Naval Facilities Engineering Systems Command', service: 'Navy',
    // 13 offices: NAVFACSYSCOM regions (Pacific, Mid-Atlantic, Southeast…).
    pattern: /NAVFAC|NAVAL FACILITIES|NAVFACSYSCOM|\bROICC\b/i,
    aliases: ['naval facilities engineering systems command', 'navy facilities', 'navy construction'],
  },
  {
    key: 'NAVWAR', name: 'Naval Information Warfare Systems Command', service: 'Navy',
    // 3 offices: NAVWAR HQ, NIWC Atlantic, NIWC Pacific. ZERO match the literal
    // "NAVWAR" — the command was renamed from SPAWAR and the centers from
    // SSC, so every real office is spelled NIWC.
    pattern: /NAVWAR|SPAWAR|\bNIWC|NAVAL INFORMATION WARFARE/i,
    aliases: ['naval information warfare systems command', 'spawar', 'niwc', 'information warfare'],
  },

  // ---- Army (from the army.mil org chart Eric sent) ----
  {
    key: 'USACE', name: 'U.S. Army Corps of Engineers', service: 'Army',
    // 48 offices, and only ONE contains "USACE" — they are all "ENDIST <city>".
    pattern: /ENDIST|ENDIV|USACE|CORPS OF ENGINEER|ENGINEER DISTRICT|ENGINEER DIVISION/i,
    aliases: ['army corps of engineers', 'corps of engineers', 'engineer district'],
  },
  // MICC and ACC are SUBORDINATE commands under AMC, and each is a real
  // targeting unit on its own (MICC 44 offices, ACC 34). An earlier version had
  // one AMC pattern covering all 79 — so searching "MICC" returned ACC offices
  // too, which is a worse answer than the 44 the user asked for. Keep the
  // specific commands specific; AMC is the parent that unions them.
  {
    key: 'MICC', name: 'Mission and Installation Contracting Command', service: 'Army',
    // 44 offices: MICC-FT BRAGG, MICC-FT HOOD, MICC-WEST POINT…
    pattern: /\bMICC\b/i,
    aliases: ['mission and installation contracting command', 'army installation contracting'],
  },
  {
    key: 'ACC', name: 'Army Contracting Command', service: 'Army',
    // 34 offices: ACC-APG, ACC-RSA, ACC-RI, ACC-DTA…
    pattern: /\bACC-|ACC APG|\bACC\b/i,
    aliases: ['army contracting command'],
  },
  {
    key: 'AMC', name: 'Army Materiel Command', service: 'Army',
    // The PARENT: unions its subordinates plus the depots/arsenals.
    pattern: /\bAMC\b|ARMY MATERIEL|\bACC-|ACC APG|\bMICC\b|TACOM|CECOM|AMCOM|ANNISTON|LETTERKENNY|TOBYHANNA/i,
    aliases: ['army materiel command'],
  },
  // NOT INCLUDED, deliberately: MEDCOM, ARCYBER, INSCOM, SDDC. They appear on
  // the army.mil org chart but have ZERO matching offices in dodaac_directory
  // (checked 2026-08-01) — the medical/intel offices that DO exist are Navy and
  // VA (NAVAL HOSPITAL *, VA MEDICAL CENTER *, OFFICE OF NAVAL INTELLIGENCE),
  // so a MEDCOM pattern broad enough to catch them would wrongly file Navy
  // hospitals under Army Medical Command. A command that matches nothing is
  // worse than an absent one: it promises coverage the data cannot back.
  // Add them when they actually post through an office we can see.
  {
    key: 'TRANSCOM', name: 'U.S. Transportation Command', service: 'DoD',
    // 1 office (USTRANSCOM-AQ). Small but real — SDDC, its Army component, has
    // no office of its own here.
    pattern: /TRANSCOM|TRANSPORTATION COMMAND/i,
    aliases: ['transportation command', 'ustranscom', 'sddc'],
  },

  // ---- Other services / civilian commands Eric named ----
  {
    key: 'FAA', name: 'Federal Aviation Administration', service: 'DOT',
    pattern: /\bFAA\b|FEDERAL AVIATION/i,
    aliases: ['federal aviation administration'],
  },
  {
    key: 'USCG', name: 'U.S. Coast Guard', service: 'DHS',
    // The forecast side spells these USCG/SFLC, USCG/ALC, USCG/CG-SHORE.
    pattern: /\bUSCG\b|COAST GUARD|\bSFLC\b|\bALC\b/i,
    aliases: ['coast guard', 'surface forces logistics center'],
  },
  {
    key: 'DLA', name: 'Defense Logistics Agency', service: 'DoD',
    pattern: /\bDLA\b|DEFENSE LOGISTICS/i,
    aliases: ['defense logistics agency'],
  },
  {
    key: 'DHA', name: 'Defense Health Agency', service: 'DoD',
    pattern: /\bDHA\b|DEFENSE HEALTH/i,
    aliases: ['defense health agency'],
  },
];

const BY_KEY = new Map(COMMANDS.map(c => [c.key.toUpperCase(), c]));

/**
 * Resolve a user's term to a command definition. Matches the key, the full
 * name, or any alias — "NAVWAR", "SPAWAR", "naval information warfare" and
 * "NIWC" all land on the same command.
 *
 * Returns null for anything unrecognised, so callers fall through to their
 * normal search rather than silently getting a wrong command.
 */
export function resolveCommand(term: string): CommandDef | null {
  const t = (term || '').trim().toLowerCase();
  if (!t) return null;
  const direct = BY_KEY.get(t.toUpperCase());
  if (direct) return direct;
  for (const c of COMMANDS) {
    if (c.name.toLowerCase() === t) return c;
    if (c.aliases.some(a => a === t)) return c;
  }
  // Looser pass: the term contains a command's name or alias (e.g. "NAVSEA HQ
  // Washington"). Requires >=4 chars so a 2-3 letter fragment can't grab a
  // command it has nothing to do with.
  if (t.length >= 4) {
    for (const c of COMMANDS) {
      if (t.includes(c.key.toLowerCase())) return c;
      if (c.aliases.some(a => t.includes(a) || a.includes(t))) return c;
    }
  }
  return null;
}

/** Does this office name belong to the command? */
export function officeInCommand(officeName: string, cmd: CommandDef): boolean {
  return cmd.pattern.test(officeName || '');
}

/** Every command an office name belongs to (usually 0 or 1). */
export function commandsForOffice(officeName: string): CommandDef[] {
  const n = officeName || '';
  return COMMANDS.filter(c => c.pattern.test(n));
}
