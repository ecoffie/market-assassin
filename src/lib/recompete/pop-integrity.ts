/**
 * Place-of-performance integrity for recompete rows.
 *
 * IMI test (2026-09-22): FA805126F0034 (Apex FSE JV — "HVAC RECOMMISSIONING ... AT PATRICK SFB")
 * was returned for a Georgia search. The row's `place_of_performance_state` is GA.
 *
 * Root cause, measured — NOT a field leak in our code. `usaspending-sync.ts` maps
 * `place_of_performance_state` from USASpending's "Place of Performance State Code" only; there
 * is no awardee/office/agency fallback anywhere in the write path. The award record itself says
 * PoP = ROSWELL, GA 30076 — which is the AWARDEE's address (recipient location: ROSWELL, GA).
 * The contracting office entered the vendor's address as the place of performance. The
 * description names Patrick SFB, which is in Florida.
 *
 * So the canonical field is the only field we use, and the canonical field is wrong for this
 * row. We must not substitute another state (the description is corroboration, never identity —
 * same rule as incumbent RULE D). What we CAN do is refuse to assert a state the record's own
 * text contradicts: when the description names exactly ONE installation, placed in one state that
 * differs from the reported PoP state (and the text never names that state), the PoP state is
 * CONTESTED → unknown. Multi-site or partly-unplaced descriptions never withdraw.
 *
 * The installation → state lookup reuses the bundled GeoNames table the maps already use
 * (`src/data/us-city-coords.json`, keys like "PATRICK AFB|FL"). No new source. It holds 31
 * installation keys, so coverage is deliberately narrow: a description naming an installation
 * that is not in the table yields no verdict (the reported state stands), never a guess.
 */
import { CITY_COORDS } from '@/lib/geo/city-geocode';

/** Where the place-of-performance state on a returned row came from. */
export type PopStateSource = 'usaspending_place_of_performance_state_code';

export type PopStateStatus = 'reported' | 'missing' | 'contested';

export interface PopResolution {
  /** The state we are willing to assert — null when missing or contested. */
  state: string | null;
  status: PopStateStatus;
  /** Which stored field `state` came from; null when we assert nothing. */
  source: PopStateSource | null;
  /** The raw stored value, kept so nothing measured is hidden. */
  reported_state: string | null;
  /** Present only when status = contested. */
  contest: { named_installations: string[]; installation_state: string } | null;
}

// Installation names in the bundled table, e.g. "PATRICK" → {"FL"}. Suffixes that denote an
// installation (AFB / ARB / SFB) — the table spells Space Force bases with their former AFB
// name, so SFB is normalized to AFB for the lookup.
const INSTALLATION_STATES: Map<string, Set<string>> = (() => {
  const out = new Map<string, Set<string>>();
  for (const key of Object.keys(CITY_COORDS)) {
    const [name, st] = key.split('|');
    const m = /^(.+) (AFB|ARB)$/.exec(name || '');
    if (!m || !st) continue;
    const k = `${m[1]} ${m[2]}`;
    const set = out.get(k) ?? new Set<string>();
    set.add(st);
    out.set(k, set);
  }
  return out;
})();

const INSTALLATION_MENTION = /\b([A-Z][A-Z.' -]{1,60}?)\s+(AFB|SFB|ARB|AIR FORCE BASE|SPACE FORCE BASE|AIR RESERVE BASE)\b/g;

function suffixKey(raw: string): 'AFB' | 'ARB' {
  return /ARB|RESERVE/.test(raw) ? 'ARB' : 'AFB';
}

/**
 * Installations named in free text that resolve to exactly ONE state in the bundled table.
 * Tries the last 3, 2, then 1 words before the suffix so "... AT PATRICK SFB" resolves
 * "PATRICK AFB" without swallowing the sentence.
 */
export function namedInstallations(text: string | null | undefined): Array<{ name: string; state: string }> {
  return scanInstallations(text).resolved;
}

/**
 * Every installation mention (resolved or not) plus the ones the table can place. The
 * unresolved count matters: "VANCE AFB, OK AND LAUGHLIN AFB, TX" names two sites and only
 * Laughlin is in the table — treating the one we CAN place as the whole story would withdraw a
 * correct OK place of performance (measured live 2026-09-23, 140D0424C0064).
 */
function scanInstallations(text: string | null | undefined): { mentions: number; resolved: Array<{ name: string; state: string }> } {
  const upper = String(text || '').toUpperCase();
  const resolved: Array<{ name: string; state: string }> = [];
  const seenResolved = new Set<string>();
  const seenMentions = new Set<string>();
  for (const m of upper.matchAll(INSTALLATION_MENTION)) {
    const words = m[1].replace(/[^A-Z' ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const sfx = suffixKey(m[2]);
    let placed = false;
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      const key = `${words.slice(-n).join(' ')} ${sfx}`;
      const states = INSTALLATION_STATES.get(key);
      if (states && states.size === 1) {
        seenMentions.add(key);
        if (!seenResolved.has(key)) {
          seenResolved.add(key);
          resolved.push({ name: `${words.slice(-n).join(' ')} ${m[2]}`, state: [...states][0] });
        }
        placed = true;
        break;
      }
    }
    // An unplaced mention is identified by its last word — enough to count distinct sites.
    if (!placed && words.length) seenMentions.add(`?${words[words.length - 1]} ${sfx}`);
  }
  // Other installation forms and plural-site wording count as additional sites: "EIELSON AFB,
  // JOINT BASE ELMENDORF RICHARDSON" / "DELIVERY LOCATIONS:" / "TWO CONUS BASES" are multi-site.
  for (const m of upper.matchAll(OTHER_SITE_MENTION)) seenMentions.add(`#${m[0]}`);
  if (PLURAL_SITES.test(upper)) seenMentions.add('#plural');
  return { mentions: seenMentions.size, resolved };
}

const OTHER_SITE_MENTION = /\b(?:JOINT BASE|JB|FORT|FT|NAS|NAVAL (?:AIR )?STATION|CAMP|ARSENAL|ARMY DEPOT|MCAS|MCB)\s+[A-Z]+/g;
const PLURAL_SITES = /\b(?:BASES|LOCATIONS|SITES|INSTALLATIONS)\b/;

/** True when free text names the state itself — ", GA", " GA ", "GEORGIA". */
function textNamesState(text: string, code: string): boolean {
  const upper = text.toUpperCase();
  if (new RegExp(`(^|[\\s,(])${code}(?=$|[\\s,.)])`).test(upper)) return true;
  const name = STATE_NAMES[code];
  return !!name && upper.includes(name);
}

const STATE_NAMES: Record<string, string> = {
  AL: 'ALABAMA', AK: 'ALASKA', AZ: 'ARIZONA', AR: 'ARKANSAS', CA: 'CALIFORNIA', CO: 'COLORADO',
  CT: 'CONNECTICUT', DE: 'DELAWARE', DC: 'DISTRICT OF COLUMBIA', FL: 'FLORIDA', GA: 'GEORGIA',
  HI: 'HAWAII', ID: 'IDAHO', IL: 'ILLINOIS', IN: 'INDIANA', IA: 'IOWA', KS: 'KANSAS', KY: 'KENTUCKY',
  LA: 'LOUISIANA', ME: 'MAINE', MD: 'MARYLAND', MA: 'MASSACHUSETTS', MI: 'MICHIGAN', MN: 'MINNESOTA',
  MS: 'MISSISSIPPI', MO: 'MISSOURI', MT: 'MONTANA', NE: 'NEBRASKA', NV: 'NEVADA', NH: 'NEW HAMPSHIRE',
  NJ: 'NEW JERSEY', NM: 'NEW MEXICO', NY: 'NEW YORK', NC: 'NORTH CAROLINA', ND: 'NORTH DAKOTA',
  OH: 'OHIO', OK: 'OKLAHOMA', OR: 'OREGON', PA: 'PENNSYLVANIA', RI: 'RHODE ISLAND',
  SC: 'SOUTH CAROLINA', SD: 'SOUTH DAKOTA', TN: 'TENNESSEE', TX: 'TEXAS', UT: 'UTAH', VT: 'VERMONT',
  VA: 'VIRGINIA', WA: 'WASHINGTON', WV: 'WEST VIRGINIA', WI: 'WISCONSIN', WY: 'WYOMING',
  PR: 'PUERTO RICO', GU: 'GUAM', VI: 'VIRGIN ISLANDS',
};

/**
 * The place-of-performance state a row may assert. Uses ONLY the canonical PoP column; the
 * description can only WITHDRAW that assertion, never replace it.
 */
export function resolvePlaceOfPerformance(row: {
  place_of_performance_state?: string | null;
  description?: string | null;
}): PopResolution {
  const reported = String(row.place_of_performance_state || '').trim().toUpperCase() || null;
  if (!reported) {
    return { state: null, status: 'missing', source: null, reported_state: null, contest: null };
  }
  // Withdraw ONLY on a single unambiguous contradiction: the description names exactly one
  // installation, the table places it in exactly one state, that state is not the reported one,
  // and the text does not also name the reported state. Anything multi-site or partly unplaced
  // leaves the reported state standing — a withdrawal removes a row from a state result, so it
  // must be the precise case, not the broad one.
  const description = String(row.description || '');
  const scan = scanInstallations(description);
  const named = scan.resolved;
  const states = new Set(named.map((n) => n.state));
  if (scan.mentions === 1 && named.length === 1 && !states.has(reported) && !textNamesState(description, reported)) {
    return {
      state: null,
      status: 'contested',
      source: null,
      reported_state: reported,
      contest: { named_installations: named.map((n) => n.name), installation_state: [...states][0] },
    };
  }
  return {
    state: reported,
    status: 'reported',
    source: 'usaspending_place_of_performance_state_code',
    reported_state: reported,
    contest: null,
  };
}
