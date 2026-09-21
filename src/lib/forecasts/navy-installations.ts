/**
 * Navy / USMC installation gazetteer — turn LRAE place shorthand into a real
 * location the geocoder can already resolve.
 *
 * WHY: the Navy LRAE carries "Anticipated Place of Performance" on 5,026
 * unmapped rows, and it was captured into raw_data and never mapped to
 * pop_state — the EPA bug at 200x scale, found by the map-coverage audit.
 *
 * The column is not a state column. It is a NAVFAC operational shorthand:
 *
 *   "ML: OCEANA"        region code + installation  (Mid-Atlantic)
 *   "NW: BANGOR PDC"    region + base + facility-type suffix
 *   "W: PAX RIVER"      region + base by nickname
 *   "FE: DIEGO GARC"    Far East region + a TRUNCATED name
 *   "Philadelphia, PA (NSWC)"  a real place with a command in parens
 *   "JBPHH"             a bare acronym (Joint Base Pearl Harbor-Hickam)
 *
 * SCOPE — this file does ONE job: shorthand → { city, state } or
 * { city, country }. It does NOT geocode. The existing resolver already knows
 * cities, ISO3 countries and world cities (verified: Norfolk VA, Crane IN,
 * Yokosuka JPN all resolve today), so duplicating that here would be a second
 * source of truth for coordinates.
 *
 * TWO RULES THIS FILE OBEYS:
 *
 * 1. OCONUS stays OCONUS. Sigonella is Italy, Sasebo is Japan, Diego Garcia is
 *    IOT. Mapping a foreign base onto its US parent command would put Navy work
 *    in the wrong hemisphere — the exact failure the geocoder's foreign branch
 *    exists to prevent.
 * 2. Never guess. An unrecognised code returns undefined and the row stays
 *    unpinned. "ML: CON22 PDC" is a contract-vehicle code, not a place; there is
 *    no honest coordinate for it. An absent pin is a fact; a wrong pin is a claim.
 *
 * Entries were built from the 276 distinct values in the live table, ranked by
 * row count, so the coverage follows the data rather than my recall of Navy
 * geography.
 */

export interface NavyPlace {
  city?: string;
  /** USPS code for CONUS. */
  state?: string;
  /** ISO3 for OCONUS — the geocoder's foreign branch keys on this. */
  country?: string;
}

/**
 * Installation shorthand → place. Keys are UPPERCASED and stripped of the
 * region prefix, so "ML: OCEANA" and "OCEANA" hit the same entry.
 */
export const NAVY_INSTALLATIONS: Record<string, NavyPlace> = {
  // ---- CONUS: Mid-Atlantic (ML) ----
  'OCEANA': { city: 'Virginia Beach', state: 'VA' },
  'NORFOLK': { city: 'Norfolk', state: 'VA' },
  'NNSY': { city: 'Portsmouth', state: 'VA' },          // Norfolk Naval Shipyard
  'LCREEK': { city: 'Virginia Beach', state: 'VA' },     // Little Creek
  'LITTLE CREEK': { city: 'Virginia Beach', state: 'VA' },
  'YORKTOWN': { city: 'Yorktown', state: 'VA' },
  'PORTSMOUTH': { city: 'Portsmouth', state: 'VA' },
  'DAHLGREN': { city: 'Dahlgren', state: 'VA' },
  'QUANTICO': { city: 'Quantico', state: 'VA' },
  'MCB QUANTICO': { city: 'Quantico', state: 'VA' },
  'PENNS': { city: 'Philadelphia', state: 'PA' },        // Penns Landing / NSA Philadelphia
  'EARLE': { city: 'Colts Neck', state: 'NJ' },
  'NEWPORT': { city: 'Newport', state: 'RI' },
  'NEW LONDON': { city: 'Groton', state: 'CT' },
  'GREAT LAKES': { city: 'Great Lakes', state: 'IL' },
  'CRANE': { city: 'Crane', state: 'IN' },
  'BEAUFORT': { city: 'Beaufort', state: 'SC' },
  'CHERRY POINT': { city: 'Cherry Point', state: 'NC' },
  'MARINE CORPS AIR STATION, CHERRY POINT': { city: 'Cherry Point', state: 'NC' },

  // ---- CONUS: Washington / National Capital (W) ----
  'PAX RIVER': { city: 'Patuxent River', state: 'MD' },
  'PAX': { city: 'Patuxent River', state: 'MD' },
  'PATUXENT RIVER': { city: 'Patuxent River', state: 'MD' },
  'BETHESDA': { city: 'Bethesda', state: 'MD' },
  'USNA': { city: 'Annapolis', state: 'MD' },            // US Naval Academy
  'IND HD': { city: 'Indian Head', state: 'MD' },
  'INDIAN HEAD': { city: 'Indian Head', state: 'MD' },

  // ---- CONUS: Southwest (SW) ----
  'SAN DIEGO': { city: 'San Diego', state: 'CA' },
  'PTLOMA': { city: 'San Diego', state: 'CA' },          // Point Loma
  'POINT LOMA': { city: 'San Diego', state: 'CA' },
  'NORTH ISLAND': { city: 'Coronado', state: 'CA' },
  'CORONADO': { city: 'Coronado', state: 'CA' },
  'CAMP PENDLETON': { city: 'Oceanside', state: 'CA' },
  'MIRAMAR': { city: 'San Diego', state: 'CA' },
  'MCAS MIRAMAR': { city: 'San Diego', state: 'CA' },
  'MCRD SANDIEGO': { city: 'San Diego', state: 'CA' },
  'CHINALAKE': { city: 'Ridgecrest', state: 'CA' },
  'CHINA LAKE': { city: 'Ridgecrest', state: 'CA' },
  'RIDGECREST': { city: 'Ridgecrest', state: 'CA' },
  // Point Mugu is not in the city gazetteer; Port Hueneme is adjacent (5km).
  'POINT MUGU NAWC': { city: 'Port Hueneme', state: 'CA' },
  'PORT HUENEME CBC BASE': { city: 'Port Hueneme', state: 'CA' },
  'PORT HUENEME': { city: 'Port Hueneme', state: 'CA' },
  'SEAL BEACH': { city: 'Seal Beach', state: 'CA' },
  'IMPERIAL BEACH': { city: 'Imperial Beach', state: 'CA' },
  'CHULA VISTA': { city: 'Chula Vista', state: 'CA' },
  'NATIONAL CITY': { city: 'National City', state: 'CA' },
  'LEMOORE': { city: 'Lemoore', state: 'CA' },
  'MONTEREY': { city: 'Monterey', state: 'CA' },
  'FALLON': { city: 'Fallon', state: 'NV' },
  'OXNARD': { city: 'Oxnard', state: 'CA' },
  'BIC': { city: 'San Diego', state: 'CA' },             // Broadway Island Complex

  // ---- CONUS: Northwest (NW) ----
  'BANGOR': { city: 'Silverdale', state: 'WA' },
  'BANGOR PDC': { city: 'Silverdale', state: 'WA' },
  'BREM': { city: 'Bremerton', state: 'WA' },
  'BREMERTON': { city: 'Bremerton', state: 'WA' },

  // ---- CONUS: Southeast (SE) ----
  'JACKSONVILLE': { city: 'Jacksonville', state: 'FL' },
  'MAYPORT': { city: 'Jacksonville', state: 'FL' },
  'CORE PDC': { city: 'Jacksonville', state: 'FL' },
  'MCRD PARRIS ISLAND': { city: 'Parris Island', state: 'SC' },
  'PARRIS ISLAND': { city: 'Parris Island', state: 'SC' },

  // ---- Hawaii (H) ----
  // 'Pearl Harbor' is not in the city gazetteer and fell back to a STATE
  // centroid (mid-ocean between islands). Aiea borders the base, ~4km away.
  'JBPHH': { city: 'Aiea', state: 'HI' },
  'PHNSY': { city: 'Aiea', state: 'HI' },        // Pearl Harbor Naval Shipyard
  'PEARL HARBOR': { city: 'Aiea', state: 'HI' },
  'MCBH': { city: 'Kaneohe', state: 'HI' },              // MCB Hawaii

  // ---- OCONUS — these MUST resolve abroad, never to a US parent command ----
  // Use the nearest city the world gazetteer actually KNOWS. "Sigonella" and
  // "Souda" are not in it, so they fell through to a country centroid — which
  // put the Sicily air station in central Italy (42.8N) and Souda Bay in
  // mainland Greece. Catania (17km from NAS Sigonella) and Chania (7km from
  // Souda Bay) resolve properly and are honest to within a few kilometres.
  'SIGONELLA': { city: 'Catania', country: 'ITA' },
  'SOUDA BAY': { city: 'Chania', country: 'GRC' },
  'NAPLES': { city: 'Naples', country: 'ITA' },
  'ROTA': { city: 'Rota', country: 'ESP' },
  'BAHRAIN': { city: 'Manama', country: 'BHR' },
  'MANAMA BAHRAIN': { city: 'Manama', country: 'BHR' },
  'DIEGO GARC': { country: 'IOT' },                      // truncated in the source
  'DIEGO GARCIA': { country: 'IOT' },
  'SASEBO': { city: 'Sasebo', country: 'JPN' },
  'ATSUGI': { city: 'Atsugi', country: 'JPN' },
  'IWAKUNI': { city: 'Iwakuni', country: 'JPN' },
  'MISAWA': { city: 'Misawa', country: 'JPN' },
  'YOKOSUKA': { city: 'Yokosuka', country: 'JPN' },
  'CORE YOKO': { city: 'Yokosuka', country: 'JPN' },
  'OKINAWA': { country: 'JPN' },
  'MCB CAMP BUTLER': { country: 'JPN' },                 // Okinawa
  'CHINHAE': { city: 'Jinhae', country: 'KOR' },
  'GUAM': { country: 'GUM' },
  'GTMO CUBA': { country: 'CUB' },                       // Guantanamo Bay
  'NSGB': { country: 'CUB' },
  'DJIBOUTI, DJIBOUTI': { country: 'DJI' },
  'RABAT, MOROCCO': { city: 'Rabat', country: 'MAR' },
  'MOGADISHU, SOMALIA': { city: 'Mogadishu', country: 'SOM' },
  'PHILIPPINES': { country: 'PHL' },
  'JAPAN': { country: 'JPN' },
  'ITALY': { country: 'ITA' },
  'SPAIN': { country: 'ESP' },
  'NORWAY': { country: 'NOR' },
  'ROMANIA': { country: 'ROU' },

  // ---- Named commands whose HQ location is unambiguous ----
  // Only where the command sits at ONE known place. A command spanning many
  // installations ("MCI West", "MCIEAST", "EURAFCENT", "North Capital Region")
  // is deliberately ABSENT: it is a region, and pinning a region to one base
  // would misstate where the work is.
  'ONR HQ': { city: 'Arlington', state: 'VA' },          // Office of Naval Research
  'MARINE CORPS RECRUITING COMMAND': { city: 'Quantico', state: 'VA' },
  'CNRH REGIONAL BOAT MAINTENANCE CENTER': { city: 'Aiea', state: 'HI' },
  'NCTAMS PAC': { city: 'Wahiawa', state: 'HI' },
};

/** NAVFAC region prefixes — stripped before lookup, never used as a location. */
const REGION_PREFIX = /^(ML|NW|SW|SE|W|H|E|FE|L|MAR|NEXWC|EURAFCENT|MCI ?EAST|MCI ?WEST|MCIWEST|MCIEAST)\s*:\s*/i;

/** Facility-type suffixes that qualify a base, not a different place. */
const FACILITY_SUFFIX = /\s+(PDC|FSC|CON|CBC BASE|NAWC|DEPOT|BASE)$/i;

/**
 * Values that assert NO single place. Kept here rather than in the caller so the
 * classifier and the parser agree on what "not a place" means for the Navy.
 * "VENDOR'S FACILITY" (1,607 rows) and "TBD" (1,810) are the two biggest values
 * in the whole column and neither is a location.
 */
const NOT_A_PLACE = /^(tbd|tba|various|various sites|multiple|multiple locations|n\/?a|other|virtual|remote|conus|oconus|secret|classified|off ?site|govt site|government site|vendor'?s? facilit(y|ies)|contractor'?s? facilit(y|ies)|contractor site|\d+%.*)/i;

export function isNavyNonPlace(raw: string): boolean {
  return NOT_A_PLACE.test(raw.trim());
}

/**
 * Resolve an LRAE place string to a location, or undefined if it names none.
 *
 * Order matters: the explicit "not a place" check runs FIRST, so a percentage
 * split ("80% Government site; 20% off-site") never falls through to a partial
 * city match.
 */
export function resolveNavyPlace(raw: string | null | undefined): NavyPlace | undefined {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (isNavyNonPlace(s)) return undefined;

  // "Philadelphia, PA (NSWC)" / "San Diego, CA North Island" — a real place with
  // a command appended. Take the city+state and drop the command.
  const cityState = /^([A-Za-z .'\-]+),\s*([A-Z]{2})\b/.exec(s);
  if (cityState && US_STATES.has(cityState[2])) {
    return { city: cityState[1].trim(), state: cityState[2] };
  }

  // "Okinawa, Japan" / "Iwakuni, Japan" — the same city-comma-place shape, but
  // the tail is a COUNTRY, not a USPS code. Checked before the base lookup so a
  // foreign city is never silently matched against a US installation name.
  const cityCountry = /^([A-Za-z .'\-]+),\s*([A-Za-z .'\-]+)$/.exec(s);
  if (cityCountry) {
    const iso = COUNTRY_NAMES[cityCountry[2].trim().toUpperCase()];
    if (iso) return { city: cityCountry[1].trim(), country: iso };
  }

  // Strip the NAVFAC region prefix and any facility-type suffix, then look up.
  let key = s.replace(REGION_PREFIX, '').replace(FACILITY_SUFFIX, '').trim().toUpperCase();
  if (NAVY_INSTALLATIONS[key]) return NAVY_INSTALLATIONS[key];

  // Try the full string (handles entries that include their own comma, e.g.
  // "DJIBOUTI, DJIBOUTI").
  if (NAVY_INSTALLATIONS[s.toUpperCase()]) return NAVY_INSTALLATIONS[s.toUpperCase()];

  // A bare 2-letter USPS code is already a state.
  if (/^[A-Z]{2}$/.test(key) && US_STATES.has(key)) return { state: key };

  // Unrecognised → no pin. Deliberately NOT a fuzzy match: "ML: CON22 PDC" is a
  // contract-vehicle code and there is no honest coordinate for it.
  return undefined;
}

/**
 * Country names the LRAE spells out, for the "City, Country" shape. Only the
 * countries actually present in the data — an unlisted country returns
 * undefined rather than being guessed onto a coordinate.
 */
const COUNTRY_NAMES: Record<string, string> = {
  JAPAN: 'JPN', ITALY: 'ITA', SPAIN: 'ESP', GREECE: 'GRC', BAHRAIN: 'BHR',
  MOROCCO: 'MAR', SOMALIA: 'SOM', DJIBOUTI: 'DJI', PHILIPPINES: 'PHL',
  NORWAY: 'NOR', ROMANIA: 'ROU', POLAND: 'POL', CUBA: 'CUB',
  GERMANY: 'DEU', KOREA: 'KOR', 'SOUTH KOREA': 'KOR', GUAM: 'GUM',
  'UNITED KINGDOM': 'GBR', UK: 'GBR', BELGIUM: 'BEL', 'UNITED STATES': 'USA', USA: 'USA',
};

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','PR','VI','GU','AS','MP',
]);
