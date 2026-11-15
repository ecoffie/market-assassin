/**
 * Deterministic "stated filters only" guard for Ask Mindy tool calls.
 *
 * Why: the planner (GPT-4o) repeatedly added a state the customer never mentioned (R10: "Who won the
 * Navy business management support services contract in October 2026?" ran with state=VA), even
 * with an explicit prompt rule. A filter the customer did not ask for silently narrows the search.
 *
 * Rule: a `state` / `states` argument survives only when the conversation implies that state: the
 * state's name, its 2-letter code typed in capitals, or a city located in it (Mindy's US city list;
 * "Memphis" implies TN and the other states with a Memphis). Ambiguous city names only make the
 * guard more permissive, never stricter. A removed value is reported to the caller for the trace.
 */
import cityCoords from '@/data/us-city-coords.json';
import { normalizeStateCode, US_STATE_NAMES } from '@/lib/utils/us-states';

let CITY_STATES: Map<string, Set<string>> | null = null;
function cityStates(): Map<string, Set<string>> {
  if (CITY_STATES) return CITY_STATES;
  CITY_STATES = new Map();
  for (const key of Object.keys(cityCoords as Record<string, unknown>)) {
    const [city, st] = key.split('|');
    if (!city || !st || city.length < 4) continue; // very short names are too ambiguous to imply a place
    const set = CITY_STATES.get(city) ?? new Set<string>();
    set.add(st);
    CITY_STATES.set(city, set);
  }
  return CITY_STATES;
}

/** States implied by free text (names, capitalized codes, city names). */
export function impliedStates(text: string): Set<string> {
  const out = new Set<string>();
  const src = String(text || '');
  for (const [code, name] of Object.entries(US_STATE_NAMES as Record<string, string>)) {
    if (new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i').test(src)) out.add(code);
    if (new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`).test(src)) out.add(code); // capitals only
  }
  const words = src.toUpperCase().replace(/[^A-Z0-9.' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const map = cityStates();
  for (let i = 0; i < words.length; i++) {
    for (let n = 3; n >= 1; n--) {
      if (i + n > words.length) continue;
      const gram = words.slice(i, i + n).join(' ');
      const hit = map.get(gram) ?? map.get(gram.replace(/^FT\.? /, 'FORT '));
      if (hit) hit.forEach((s) => out.add(s));
    }
  }
  return out;
}

const STATE_ARGS = ['state', 'states'] as const;

/**
 * Remove state values the conversation does not imply. Returns updated JSON args and what was
 * removed. Unparseable args are returned untouched (the executor refuses them).
 */
export function guardUnstatedStates(rawArgs: string, conversationText: string): { args: string; removed: string[] } {
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(rawArgs || '{}');
  } catch {
    return { args: rawArgs, removed: [] };
  }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, removed: [] };
  const implied = impliedStates(conversationText);
  const removed: string[] = [];
  for (const key of STATE_ARGS) {
    const v = a[key];
    if (v == null || v === '') continue;
    const tokens = (Array.isArray(v) ? v : [v]).flatMap((x) => String(x ?? '').split(/\s*[,;/&]\s*|\s+(?:or|and)\s+/i)).map((t) => t.trim()).filter(Boolean);
    const keep: string[] = [];
    for (const t of tokens) {
      const code = normalizeStateCode(t);
      // An unrecognizable value is left for the tool to refuse explicitly (never silently dropped here).
      if (!code || implied.has(code)) keep.push(t);
      else removed.push(`${key}=${t}`);
    }
    if (keep.length === tokens.length) continue;
    if (!keep.length) delete a[key];
    else a[key] = Array.isArray(v) ? keep : keep.join(',');
    // state_scope only qualifies a state filter; drop it with the state.
    if (key === 'state' && !keep.length && 'state_scope' in a) delete a.state_scope;
  }
  return removed.length ? { args: JSON.stringify(a), removed } : { args: rawArgs, removed };
}

const CITY_ARGS = ['city', 'cities'] as const;

function normPlace(s: string): string {
  return String(s || '').toUpperCase().replace(/^FT\.?\s+/, 'FORT ').replace(/[^A-Z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the conversation names this city (whole words, case-insensitive, "Ft." = "Fort"). */
export function cityNamed(city: string, conversationText: string): boolean {
  const c = normPlace(city);
  if (!c) return false;
  const text = ` ${normPlace(String(conversationText || '').replace(/\bft\.?\s+/gi, 'Fort '))} `;
  return text.includes(` ${c} `);
}

/**
 * Remove city values the conversation never named (same rule as states).
 *
 * Why: on 2026-11-15 a map "ask about this view" turn carried no place at all, and the planner called
 * get_buying_offices with city=Birmingham, taken from nowhere the customer said (their saved profile
 * lists AL). guardUnstatedStates removed the state but kept the city, so the search ran on a city
 * the customer never asked about. A city survives only when its name appears in the conversation.
 * "Germantown, TN" is matched on the part before the comma; a bare 2-letter state token inside
 * `city` is left for the state guard and the tool. A removed value is reported for the trace.
 */
export function guardUnstatedCities(rawArgs: string, conversationText: string): { args: string; removed: string[] } {
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(rawArgs || '{}');
  } catch {
    return { args: rawArgs, removed: [] };
  }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, removed: [] };
  const removed: string[] = [];
  for (const key of CITY_ARGS) {
    const v = a[key];
    if (v == null || v === '') continue;
    const tokens = key === 'city'
      ? String(Array.isArray(v) ? v.join(',') : v).split(/\s*[,;]\s*/).map((t) => t.trim()).filter(Boolean)
      : (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '').trim()).filter(Boolean);
    const keep: string[] = [];
    for (const t of tokens) {
      const name = t.split(',')[0].trim();
      if (/^[A-Za-z]{2}$/.test(name) && normalizeStateCode(name)) { keep.push(t); continue; }
      if (cityNamed(name, conversationText)) keep.push(t);
      else removed.push(`${key}=${t}`);
    }
    if (keep.length === tokens.length) continue;
    if (!keep.length) delete a[key];
    else if (key === 'cities' && keep.length === 1 && a.city == null) {
      // Model-recalled suburbs removed around the one named city: pass it as the core `city`, so the
      // tool's deterministic metro expansion still covers the metro (instead of an exact one-city match).
      delete a.cities;
      a.city = keep[0];
    } else a[key] = Array.isArray(v) || key === 'cities' ? keep : keep.join(', ');
  }
  // A metro radius only qualifies a city; drop it with the last city.
  if (removed.length && a.city == null && a.cities == null && 'metro_radius_miles' in a) delete a.metro_radius_miles;
  return removed.length ? { args: JSON.stringify(a), removed } : { args: rawArgs, removed };
}
