/**
 * buildProfileFromText (#64) — the SHARED "paste your capability statement →
 * full Mindy profile" engine. One function, two consumers: regular onboarding
 * (Auto mode) AND add-a-client (Coach mode). Eric: new consultants don't have
 * deep GovCon knowledge either — Mindy must be the expert.
 *
 * THE KEY FIX: don't pick the search term from the first 2 keywords (that let
 * "ABC Facility Services SDVOSB" hijack a JANITORIAL company → manufacturing
 * codes). Use gpt-4o-mini to read the text and say WHAT THE COMPANY DOES, then
 * ground THAT in real USASpending. The LLM only LABELS the industry; every FACT
 * (codes, $, agencies) still comes from real data.
 */
import { callLLM } from '@/lib/llm/call-llm';
import { keywordCoverage } from './keyword-coverage';
import { sanitizeKeywords } from './keyword-sanitize';

export interface ExtractedProfile {
  industryPhrase: string;          // what the LLM decided this company does
  naics: string[];                 // grounded 90%-coverage set
  topPsc: { code: string; name: string } | null;
  keywords: string[];
  states: string[];
  setAsides: string[];             // SDVOSB / 8(a) / WOSB / HUBZone …
  agencies: { name: string; amount: number }[];   // top buyers of these NAICS
  totalMarket: number;
  naicsCount: number;
  source: 'llm' | 'keyword-fallback';
}

const SET_ASIDE_PATTERNS: [RegExp, string][] = [
  [/\bsdvosb\b|service[- ]disabled veteran/i, 'SDVOSB'],
  [/\bvosb\b|veteran[- ]owned/i, 'VOSB'],
  [/\b8\(?a\)?\b|eight\(?a\)?/i, '8(a)'],
  [/\bedwosb\b/i, 'EDWOSB'],
  [/\bwosb\b|woman[- ]owned|women[- ]owned/i, 'WOSB'],
  [/\bhubzone\b/i, 'HUBZone'],
  [/disadvantaged business|\bsdb\b/i, 'SDB'],
];

// State name + abbreviation detection (incl. PR / DC / territories).
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR', 'washington dc': 'DC',
  'washington d.c.': 'DC',
};
const ALL_STATE_CODES = Object.values(STATE_NAME_TO_CODE).concat(['VI', 'GU']);

function detectStates(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  // Word-boundary match so "Florida." / "Puerto Rico," (with punctuation) still
  // hit — QA caught space-padding silently dropping the user's state, which would
  // make their alerts nationwide instead of local.
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    if (new RegExp(`\\b${name.replace(/[.]/g, '\\.')}\\b`).test(lower)) found.add(code);
  }
  for (const code of ALL_STATE_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(text)) found.add(code);
  }
  return Array.from(found);
}

function detectSetAsides(text: string): string[] {
  const found = new Set<string>();
  for (const [re, label] of SET_ASIDE_PATTERNS) if (re.test(text)) found.add(label);
  return Array.from(found);
}

/** Ask gpt-4o-mini what this company DOES — returns a short industry phrase. */
async function llmIndustryPhrase(text: string): Promise<string | null> {
  try {
    const { text: out } = await callLLM({
      job: 'reasoning',
      json: true,
      maxTokens: 80,
      system: [
        'You classify a US federal contractor by what they SELL/DO, for searching government spending data.',
        'Reply ONLY JSON: {"industry":"<specific 2-4 word phrase a buyer would search>"}.',
        'Rules:',
        '1. Be SPECIFIC to their actual niche — keep the distinguishing word. "nurse staffing" → "nurse staffing" (NOT "professional staffing"); "medical supplies" → "medical supplies" (NOT "professional services"); "commercial janitorial" → "commercial janitorial" (NOT "facilities"). The specific niche matters.',
        '2. Use the SERVICE/PRODUCT, never the company name, a certification (SDVOSB/8a/WOSB), or a location.',
        '3. Do NOT default to "professional services", "consulting", "IT services", or "cybersecurity" unless that is genuinely what they do. If the text clearly names a different industry (medical, janitorial, construction, staffing-of-a-specific-kind, logistics, food, etc.), use THAT.',
        '4. If you truly cannot tell what they sell, reply {"industry":""} — do not guess a generic category.',
      ].join('\n'),
      user: text.slice(0, 600),
    });
    const phrase = String(JSON.parse(out)?.industry || '').trim().toLowerCase();
    return phrase && phrase.length >= 3 ? phrase : null;
  } catch {
    return null;
  }
}

/** Top agencies buying a set of NAICS — "who to talk to". */
async function topAgencies(naics: string[]): Promise<{ name: string; amount: number }[]> {
  if (!naics.length) return [];
  try {
    const r = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: { naics_codes: naics, time_period: [{ start_date: '2024-10-01', end_date: '2025-09-30' }], award_type_codes: ['A', 'B', 'C', 'D'] },
        category: 'awarding_agency', limit: 6,
      }),
    });
    if (!r.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((await r.json()).results || []).filter((x: any) => x.name && (x.amount || 0) > 0)
      .map((x: { name: string; amount: number }) => ({ name: x.name, amount: Math.round(x.amount) }));
  } catch { return []; }
}

/**
 * The shared engine. Pass any capability text (one sentence to a full statement).
 * Returns the full extracted profile for a confirm screen. Never throws — returns
 * a best-effort profile.
 */
export async function buildProfileFromText(text: string): Promise<ExtractedProfile | null> {
  const t = (text || '').trim();
  if (t.length < 4) return null;

  // 1) The INDUSTRY phrase — LLM first (understands "facility services + janitorial
  //    = cleaning"), keyword fallback if the LLM is unavailable.
  const keywords = sanitizeKeywords(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)).slice(0, 12);

  // Guard against the LLM hallucinating an industry for nonsense (QA: "asdfqwer
  // zxcvbnm" → cyber codes). If the input has no real dictionary-ish words (no
  // sanitizable keywords AND no recognizable industry token), don't fabricate a
  // profile — be honest that we couldn't tell.
  const looksMeaningful = keywords.length > 0 || /\b(it|hr|ai|qa)\b/i.test(t);
  if (!looksMeaningful) return null;

  let industryPhrase = await llmIndustryPhrase(t);
  let source: 'llm' | 'keyword-fallback' = 'llm';
  if (!industryPhrase) {
    industryPhrase = keywords.slice(0, 2).join(' ') || keywords[0] || t.slice(0, 60);
    source = 'keyword-fallback';
  }

  // 2) Ground the industry phrase in real USASpending (codes + $ + PSC).
  const cov = await keywordCoverage(industryPhrase).catch(() => null);
  const naics = cov?.coverageCodes?.slice(0, 8) || [];

  // 3) The rest — states, set-asides, and who-buys (all from real data / text).
  const states = detectStates(t);
  const setAsides = detectSetAsides(t);
  const agencies = await topAgencies(naics);

  return {
    industryPhrase,
    naics,
    topPsc: cov?.topPsc || null,
    keywords,
    states,
    setAsides,
    agencies,
    totalMarket: cov?.totalMarket || 0,
    naicsCount: cov?.naicsCount || 0,
    source,
  };
}
