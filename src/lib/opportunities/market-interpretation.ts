/**
 * FIND market interpretation — customer language → government market plan.
 *
 * Buyer alias lookup is NORMALIZATION (not expansion): SOCOM and USSOCOM are
 * the same buyer. Walking to Department of Defense is expansion and is refused.
 *
 * Capability related-market is EXPANSION and must stay labeled:
 * DIRECT_MATCH vs RELATED_MARKET_CANDIDATE. Cybersecurity is not the IT NAICS
 * family; that family may contain cyber work but cannot be claimed as cyber.
 */
import aliasData from '@/data/agency-aliases.json';
import { getIndustryPreset, type IndustryPreset } from '@/lib/industry-presets';
import { agencyOrExpr } from '@/lib/opportunities/agency-match';

export type EvidenceClass = 'DIRECT_MATCH' | 'RELATED_MARKET_CANDIDATE';

export type BuyerKind = 'none' | 'normalization' | 'passthrough';

export interface BuyerIdentity {
  requested: string | null;
  canonical: string | null;
  aliases: string[];
  needles: string[];
  kind: BuyerKind;
  parent_department_applied: false;
  reason: string;
}

export interface TaxonomyPin {
  source: string;
  naics: string[];
  psc: string[];
  terms: string[];
  reason: string;
}

export interface CapabilityInterpretation {
  requested: string;
  kind: 'cyber_with_related_it' | 'industry_preset' | 'literal';
  direct: TaxonomyPin;
  related_market: TaxonomyPin | null;
  excluded: Array<{ phrase: string; reason: string }>;
}

export interface MarketInterpretation {
  customer_phrase: string;
  buyer: BuyerIdentity;
  capability: CapabilityInterpretation;
  retrieval_plan: {
    buyer_is_normalization: true;
    related_market_applied: boolean;
    related_market_reason: string | null;
  };
  truth: {
    what_was_requested: { phrase: string; buyer: string | null };
    what_was_consumed: string[];
    what_was_expanded: string[];
  why: string;
  what_remains_unsupported: string[];
  records?: {
    DIRECT_MATCH: string[];
    RELATED_MARKET_CANDIDATE: string[];
  };
};
}

export interface ClassifiableRecord {
  title?: string | null;
  description?: string | null;
  naics_code?: string | null;
  naics_description?: string | null;
  psc_code?: string | null;
  incumbent_name?: string | null;
}

const SHARED_ALIASES = (aliasData as { aliases?: Record<string, string> }).aliases || {};

function fold(s: string): string {
  return String(s || '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/[,/&()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_BY_FOLD = new Map<string, { key: string; canonical: string }>();
for (const [k, v] of Object.entries(SHARED_ALIASES)) {
  const fk = fold(k);
  if (fk && !ALIAS_BY_FOLD.has(fk)) ALIAS_BY_FOLD.set(fk, { key: k, canonical: v });
}

/** DoD parent spellings — never added when the requested buyer is a component. */
const DOD_PARENT_FOLDS = new Set(
  [
    'DEPARTMENT OF DEFENSE',
    'DEPT OF DEFENSE',
    'DOD',
    'DD',
    'DEFENSE',
    'PENTAGON',
    'MILITARY',
  ].map(fold),
);

export const CYBER_DIRECT_RE =
  /\b(cyber(?:\s*security)?|information\s+security|infosec|network\s+security|zero[\s-]?trust|siem)\b/i;

export const PHYSICAL_SECURITY_RE =
  /\b(physical\s+security|access[\s-]?control|security\s+doors?|guard\s+services|perimeter\s+security|security\s+fence|locksmith|security\s+guard)\b/i;

const PHRASE_PRESET: Array<{ match: RegExp; name: string }> = [
  { match: /\bconstruction\b/i, name: 'Construction' },
  { match: /\bjanitorial\b|\bcustodial\b/i, name: 'Facilities & Maintenance' },
  { match: /\bit\s+services\b|\binformation\s+technology\b/i, name: 'IT Services' },
];

function uniqueFold(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = String(v || '').trim();
    if (!t) continue;
    const k = fold(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function stripParenAcronym(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function pinFromPreset(preset: IndustryPreset, reason: string, extraTerms: string[] = []): TaxonomyPin {
  return {
    source: preset.name,
    naics: [...preset.codes],
    psc: [...(preset.psc || [])],
    terms: uniqueFold([preset.name, ...extraTerms]),
    reason,
  };
}

/**
 * Normalize a customer buyer string to search needles using agency-aliases.json.
 * Sibling spellings of the SAME canonical identity are included. Parent department
 * is never added.
 */
export function resolveBuyerIdentity(raw: string | null | undefined): BuyerIdentity {
  const requested = String(raw || '').trim();
  if (!requested) {
    return {
      requested: null,
      canonical: null,
      aliases: [],
      needles: [],
      kind: 'none',
      parent_department_applied: false,
      reason: 'No buyer named.',
    };
  }

  const hit = ALIAS_BY_FOLD.get(fold(requested));
  if (!hit) {
    return {
      requested,
      canonical: null,
      aliases: [requested],
      needles: [requested],
      kind: 'passthrough',
      parent_department_applied: false,
      reason: `No alias for “${requested}”; used as typed. Not broadened to a parent department.`,
    };
  }

  const canonical = hit.canonical;
  const siblings: string[] = [];
  for (const [k, v] of Object.entries(SHARED_ALIASES)) {
    if (v === canonical) siblings.push(k);
  }
  const needles = uniqueFold([
    requested,
    canonical,
    stripParenAcronym(canonical),
    ...siblings,
  ]).filter((n) => !DOD_PARENT_FOLDS.has(fold(n)) || DOD_PARENT_FOLDS.has(fold(requested)));

  return {
    requested,
    canonical,
    aliases: uniqueFold(siblings),
    needles,
    kind: 'normalization',
    parent_department_applied: false,
    reason: `“${requested}” is the same buyer as ${canonical}. This is spelling normalization, not a wider department.`,
  };
}

/** PostgREST OR across awarding/department AND sub-agency/sub_tier for the same buyer. */
export function dualBuyerOrExpr(depCol: string, subCol: string, needles: string[]): string {
  const dep = agencyOrExpr(depCol, needles);
  const sub = agencyOrExpr(subCol, needles);
  return [dep, sub].filter(Boolean).join(',');
}

export function interpretCapability(phrase: string): CapabilityInterpretation {
  const requested = String(phrase || '').trim();
  const excluded: CapabilityInterpretation['excluded'] = [];

  if (PHYSICAL_SECURITY_RE.test(requested) && !CYBER_DIRECT_RE.test(requested)) {
    excluded.push({
      phrase: 'physical security / access control',
      reason: 'Physical security is not cybersecurity. Generic “security” does not enter the cyber market.',
    });
    return {
      requested,
      kind: 'literal',
      direct: {
        source: 'literal',
        naics: [],
        psc: [],
        terms: [requested],
        reason: 'Literal phrase. No cyber related-market expansion.',
      },
      related_market: null,
      excluded,
    };
  }

  if (/\bsecurity\b/i.test(requested) && !CYBER_DIRECT_RE.test(requested) && !PHYSICAL_SECURITY_RE.test(requested)) {
    excluded.push({
      phrase: 'generic security',
      reason: 'Bare “security” is not cybersecurity and is not expanded into IT or cyber codes.',
    });
  }

  if (CYBER_DIRECT_RE.test(requested)) {
    const cyber = getIndustryPreset('Cybersecurity');
    const it = getIndustryPreset('IT Services');
    if (!cyber || !it) {
      return {
        requested,
        kind: 'literal',
        direct: { source: 'literal', naics: [], psc: [], terms: [requested], reason: 'Industry presets unavailable.' },
        related_market: null,
        excluded,
      };
    }
    return {
      requested,
      kind: 'cyber_with_related_it',
      direct: pinFromPreset(
        cyber,
        'Direct cyber taxonomy: PSC IT Security & Compliance plus hosting NAICS 518210. Not the IT-services family.',
        ['cybersecurity', 'cyber', 'information security', 'network security', 'infosec', 'zero trust', 'SIEM'],
      ),
      related_market: {
        source: it.name,
        naics: [...it.codes],
        psc: [],
        terms: [],
        reason:
          'Cyber has no NAICS home. These IT-service codes can contain the requested cyber work, but they are not cybersecurity. Rows retrieved only this way are RELATED_MARKET_CANDIDATE.',
      },
      excluded: [
        ...excluded,
        {
          phrase: 'physical security',
          reason: 'Physical security, access-control doors, and generic “security” are not cyber DIRECT_MATCH.',
        },
      ],
    };
  }

  for (const row of PHRASE_PRESET) {
    if (!row.match.test(requested)) continue;
    const preset = getIndustryPreset(row.name);
    if (!preset) continue;
    return {
      requested,
      kind: 'industry_preset',
      direct: pinFromPreset(preset, `Customer phrase maps to the “${preset.name}” industry preset.`, [requested]),
      related_market: null,
      excluded,
    };
  }

  return {
    requested,
    kind: 'literal',
    direct: {
      source: 'literal',
      naics: [],
      psc: [],
      terms: requested ? [requested] : [],
      reason: 'No industry preset. Literal keyword retrieval. No related-market expansion.',
    },
    related_market: null,
    excluded,
  };
}

export function interpretMarket(phrase: string, buyerRaw?: string | null): MarketInterpretation {
  const customer_phrase = String(phrase || '').trim();
  const buyer = resolveBuyerIdentity(buyerRaw);
  const capability = interpretCapability(customer_phrase);
  const related = capability.related_market;
  const consumed = [
    customer_phrase && `phrase:${customer_phrase}`,
    buyer.requested && `buyer:${buyer.requested}`,
    buyer.kind === 'normalization' && `buyer_canonical:${buyer.canonical}`,
    capability.direct.source !== 'literal' && `direct_taxonomy:${capability.direct.source}`,
    related && `related_market:${related.source}`,
  ].filter(Boolean) as string[];
  const expanded = related
    ? [`related_market:${related.source} naics ${related.naics.join(',')}`]
    : [];
  const unsupported: string[] = [];
  if (buyer.kind === 'passthrough') unsupported.push('buyer alias not in agency-aliases.json');
  if (capability.kind === 'literal' && !capability.direct.naics.length) {
    unsupported.push('no industry-preset NAICS/PSC pin for this phrase');
  }

  return {
    customer_phrase,
    buyer,
    capability,
    retrieval_plan: {
      buyer_is_normalization: true,
      related_market_applied: !!related,
      related_market_reason: related?.reason ?? null,
    },
    truth: {
      what_was_requested: { phrase: customer_phrase, buyer: buyer.requested },
      what_was_consumed: consumed,
      what_was_expanded: expanded,
      why: related
        ? `${buyer.reason} ${related.reason}`
        : buyer.reason,
      what_remains_unsupported: unsupported,
    },
  };
}

/**
 * BUY-SIDE text only. The holder's name (`incumbent_name`) is deliberately absent: a company called
 * "… Machining and Fabrication" or "CyberCore" says nothing about what THIS contract bought. Holder
 * identity is its own signal (HOLDER_SIGNAL, match-evidence.ts), never an acquisition's direct match.
 * Measured 2026-09-22 (IMI test): 7 TYONEK MACHINING AND FABRICATION orders — NAICS 334515, PSC 4920,
 * "VERSATILE DIAGNOSTIC AUTOMATED TEST STATION" — were DIRECT_MATCH for "industrial steel fabrication".
 */
function blob(row: ClassifiableRecord): string {
  return [row.title, row.description, row.naics_description]
    .map((s) => String(s || ''))
    .join(' ');
}

function codeIn(list: string[], value: string | null | undefined): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  return list.some((c) => (c.length < 6 ? v.startsWith(c) : v === c));
}

/**
 * Classify one retrieved row. Returns null when a cyber plan retrieved a
 * physical-security-only record — it must not enter the cyber market.
 */
export function classifyRecord(
  row: ClassifiableRecord,
  cap: CapabilityInterpretation,
): EvidenceClass | null {
  const text = blob(row);
  const physicalOnly = PHYSICAL_SECURITY_RE.test(text) && !CYBER_DIRECT_RE.test(text);

  if (cap.kind === 'cyber_with_related_it') {
    if (physicalOnly) return null;
    const directText = cap.direct.terms.some((t) => t && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
      || CYBER_DIRECT_RE.test(text);
    const directCode = codeIn(cap.direct.naics, row.naics_code) || codeIn(cap.direct.psc, row.psc_code);
    if (directText || directCode) return 'DIRECT_MATCH';
    if (cap.related_market && codeIn(cap.related_market.naics, row.naics_code)) {
      return 'RELATED_MARKET_CANDIDATE';
    }
    return null;
  }

  if (physicalOnly && CYBER_DIRECT_RE.test(cap.requested)) return null;
  if (codeIn(cap.direct.naics, row.naics_code) || codeIn(cap.direct.psc, row.psc_code)) return 'DIRECT_MATCH';
  if (CYBER_DIRECT_RE.test(text) && cap.kind !== 'literal') return 'DIRECT_MATCH';
  // A direct term in the BUY-SIDE text. This used to fall through to an unconditional DIRECT_MATCH,
  // so any row the retrieval admitted — including by the holder's NAME — was labelled a direct match.
  const termHit = cap.direct.terms.some((t) => t && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  return termHit ? 'DIRECT_MATCH' : null;
}

export function evidenceWhy(cls: EvidenceClass, phrase: string): string {
  if (cls === 'DIRECT_MATCH') {
    return `Direct match for “${phrase}” — the record itself establishes relevance.`;
  }
  return `Related-market candidate for “${phrase}” — buyer matches, but this record is in a broader market and is not confirmed ${phrase}.`;
}

export function pipeNeedles(needles: string[]): string {
  return needles.join('|');
}

/** All NAICS used in the capability filter (direct ∪ related). */
export function retrievalNaics(cap: CapabilityInterpretation): string[] {
  return uniqueFold([...cap.direct.naics, ...(cap.related_market?.naics || [])]);
}

export function retrievalPsc(cap: CapabilityInterpretation): string[] {
  return uniqueFold([...cap.direct.psc, ...(cap.related_market?.psc || [])]);
}

/** Host-facing one-liner. No NAICS dump. */
export function plainEnglishInterpretation(interp: MarketInterpretation): string {
  const buyerBit = interp.buyer.canonical
    ? `I treated “${interp.buyer.requested}” as ${interp.buyer.canonical} (same buyer, not all of DoD).`
    : interp.buyer.requested
      ? `I searched the buyer as “${interp.buyer.requested}”.`
      : '';
  if (interp.capability.kind === 'cyber_with_related_it') {
    return [
      buyerBit,
      `I looked for confirmed cybersecurity work, then also listed this buyer’s broader IT contracts as related-market candidates — not as confirmed cyber demand.`,
    ].filter(Boolean).join(' ');
  }
  return buyerBit || `I searched “${interp.customer_phrase}” as typed.`;
}
