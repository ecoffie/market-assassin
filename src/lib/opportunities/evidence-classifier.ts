/**
 * EVIDENCE-BASED OPEN CLASSIFICATION (Agent 3, RC2; Eric approved 2026-11-14).
 *
 * Decides DIRECT / RELATED / not relevant for an already-RETRIEVED open notice. It never removes a row (retrieval recall
 * is unchanged and separate); it only labels and therefore orders. The rule Eric set: a notice is DIRECT only when it
 * actually procures what the business offers; never on an agency name, boilerplate, or a broad code alone.
 *
 * Measured problem (Agent 4, v6 blind top-20, RC1): every top-20 row was DIRECT because production made any notice
 * DIRECT when a customer word appeared ANYWHERE in title or description. Coast Guard / Marine Security Guard notices led
 * guards (18/20 irrelevant), grease-trap and hull cleaning led janitorial (17/20), NAVSUP boilerplate ("Hull,
 * Mechanical and Electrical (HM&E) testing") made springs and canisters "electrical", DLA repair notices filled aircraft.
 *
 * Evidence ladder (strongest first):
 *  1. The PROCURED THING: the title's head (text before "for / at / in support of / supporting / to support"), with
 *     agency and program names masked. A customer concept or the preset's vocabulary there is DIRECT.
 *     Trade presets (services): the trade's OWN specific code is DIRECT too (6-digit NAICS / its PSC).
 *     Product presets: DIRECT also requires a PRODUCT notice (PSC starting with a digit). A product code with no item
 *     evidence is RELATED; a product-code match is never proof.
 *  2. The REQUIREMENT TEXT: a match only in the description is RELATED ("mentioned, not the title"). For a product
 *     search on a product notice, a description-only mention is boilerplate (DLA item notices state packaging, testing
 *     and data-submission terms), so it is NOT RELEVANT.
 *  3. Everything else retrieved (agency name, SOW-only, code family) is NOT RELEVANT, kept and shown last with a reason.
 *  Repair: for a parts-only search (a product preset, and no repair / overhaul / maintenance words), a repair /
 *  overhaul / return-to-RFI notice or a J/K service PSC is NOT RELEVANT (Eric: a parts supplier is not a repair
 *  contractor). If the customer offers repair, it is evaluated normally.
 */
import aliasData from '@/data/agency-aliases.json';
import { STRICT_ITEM_PRESETS, type CapabilityInterpretation } from './market-interpretation';
import type { DiscoveryPlan } from '@/lib/discovery';
import { conceptHit, phraseRegex, jsRegex, framedVerbs, type Alternative, type Concept } from '@/lib/discovery/matcher';

export type EvidenceCls = 'DIRECT_MATCH' | 'RELATED_MARKET_CANDIDATE' | 'WEAK_NON_MARKET';
export type EvidenceBasis =
  | 'title_item' | 'own_trade_code' | 'description_only' | 'product_code_only' | 'related_family_code'
  | 'boilerplate_only' | 'agency_or_program_name' | 'repair_notice_for_parts' | 'no_evidence' | 'single_list_word';
export interface EvidenceVerdict { cls: EvidenceCls; basis: EvidenceBasis }

/**
 * Organization and program names that contain ordinary words. The registry's multi-word canonical names
 * (agency-aliases.json) plus forms that registry does not carry. A name the customer TYPED is never masked.
 */
const EXTRA_ORG_NAMES = [
  'Coast Guard', 'United States Coast Guard', 'National Guard', 'Army National Guard', 'Air National Guard',
  'Marine Security Guard', 'Marine Security Guard Detachment',
];
const ORG_NAMES: string[] = (() => {
  const vals = new Set<string>();
  const a = (aliasData as { aliases: Record<string, string | string[]> }).aliases;
  for (const v of Object.values(a)) for (const s of Array.isArray(v) ? v : [v]) if (typeof s === 'string') vals.add(s);
  const out = new Set<string>(EXTRA_ORG_NAMES);
  for (const v of vals) {
    for (const f of [v, v.replace(/\s*\([^)]*\)\s*$/, ''), v.replace(/^(U\.S\.|United States)\s+/i, '')]) {
      const t = f.trim();
      if (t.split(/\s+/).length >= 2 && t.length >= 6) out.add(t);
    }
  }
  return [...out].sort((x, y) => y.length - x.length);
})();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function maskOrgNames(text: string, query: string): string {
  const q = query.toLowerCase();
  const names = ORG_NAMES.filter((n) => !q.includes(n.toLowerCase()));
  if (!names.length || !text) return text || '';
  return text.replace(new RegExp(`\\b(${names.map((n) => esc(n).replace(/\s+/g, '\\s+')).join('|')})\\b`, 'gi'), ' ');
}

/** The procured thing: the title before a beneficiary / location clause. "Food Services for the MSG" → "Food Services". */
export function titleHead(title: string): string {
  const t = String(title || '');
  const cut = t.search(/\s+(?:for|at|in\s+support\s+of|supporting|to\s+support)\s+/i);
  return cut > 0 ? t.slice(0, cut) : t;
}

const REPAIR_TITLE = /\b(repair|repairs|overhaul|refurbish\w*|rebuild|in\s+repair\/modification|return(?:ed)?\s+to\s+(?:rfi|ready\s+for\s+issue)|ready\s+for\s+issue)\b/i;
/**
 * The requirement says it buys a repair. Read from the first 5,000 characters of the description, where DLA / NAVSUP
 * state the requirement type ("This is an EAF REPAIR requirement", "Articles to be furnished hereunder shall be
 * repaired", "criteria for repair and testing", "return ... to RFI"). Measured on the benchmark labels: 57 of 746 rows
 * both reviewers marked NO match; 3 of 458 rows marked relevant match, and all 3 state a repair requirement in their own
 * text (the reviewers missed it), so they are sent back for adjudication rather than treated as false positives.
 * 2026-11-15 (Agent 4 v7, IT top 5): NAVSUP Mechanicsburg repair buys say it as "Vendor shall have 90 days after receipt of
 * carcass(es) to complete a teardown & evaluation (TD&E)", "the full repair effort", "requirements for repair",
 * "Repair Turn Around Time" — "NRP,KEYBOARD,DATA E" / "ASSEMBLY, KEYBOARD" / "SERVER,AUTOMATIC DA" were DIRECT for a reseller.
 */
const REPAIR_DESC = /\b(?:this\s+(?:solicitation|requirement|procurement)\s+is\s+for\s+(?:the\s+)?repair|repair\s+(?:upgrade|requirements?|and\s+overhaul|and\s+return|services?\s+(?:for|of|to))|return(?:ed)?\s+(?:the\s+)?(?:\S+\s+){0,6}?to\s+(?:rfi|ready\s+for\s+issue|serviceable)|overhaul\s+(?:and\s+repair|of\s+the)|in\s+repair\/modification|articles\s+to\s+be\s+furnished\s+hereunder\s+shall\s+be\s+repaired|criteria\s+for\s+(?:the\s+)?repair|teardown\s*(?:&|and)\s*evaluation|receipt\s+of\s+(?:the\s+)?carcass|full\s+repair\s+effort|requirements\s+for\s+repair\b|repair\s+turn\s*-?\s*around\s+time)/i;
const REPAIR_DESC_WINDOW = 5000;
const REPAIR_INTENT = /\b(repair|repairs|overhaul|refurbish\w*|rebuild|maintain|maintenance|mro|service\s+and\s+repair)\b/i;

function alternativeHit(a: Alternative, text: string): boolean {
  if (a.eligibility === 'all') return a.eligible.every((c) => conceptHit(c, text));
  const needs = new Set(a.partnerRequired || []);
  if (a.eligible.some((c) => !needs.has(c.label) && conceptHit(c, text))) return true;
  return a.eligible.filter((c) => needs.has(c.label) && conceptHit(c, text)).length >= 2;
}
/** The customer's own eligibility (or a code / exact phrase) satisfied inside `text`. */
function customerHit(plan: DiscoveryPlan, text: string): boolean {
  const m = plan.matcher;
  if (!text.trim()) return false;
  if (m.mode === 'exact_phrase' || m.mode === 'code') return jsRegex(phraseRegex(m.phrase || '')).test(text) || text.toLowerCase().includes(String(m.phrase || '').toLowerCase());
  if (m.mode !== 'lexical') return false;
  return m.alternatives.some((a) => alternativeHit(a, text));
}
function vocabHit(cap: CapabilityInterpretation, text: string): boolean {
  return (cap.direct.vocab || []).some((v) => jsRegex(phraseRegex(v.toLowerCase())).test(text));
}
/**
 * LONG-LIST FAMILY GUARD (Agent 3, 2026-11-15; diagnosis on Agent 4's v7 RC3 preview). In a long description of the
 * business (more than LIST_QUERY_WORDS words) every list word is an eligible alternative, so one of them in the title head
 * made a notice DIRECT whatever it bought: "mill and pave asphalt" put "Chemically Milled Plate" (FSC 9650) and an HH-60
 * "PAVE HAWK" damper (FSC 1615) on top of paving; "consumables such as … dressings" put "PERCUSSION CONSUMABLES"
 * (FSC 7720) and a menu of "DRESSING AND CONDIMENTS" (FSC 8950) on top of medical supplies; "parts … for … vehicles"
 * put whole-vehicle buys on top of a parts supplier.
 *
 * In a long query only, when the title head carries none of the preset's own vocabulary:
 *  - a head that matches only MODIFIER words (words that appear in the query only inside a "for … / to …" clause, which
 *    names who the work or items are for, not what is sold) is RELATED;
 *  - a head that matches exactly ONE list word is DIRECT only if the notice's code family agrees with the business:
 *    a product preset's own FSC groups; otherwise a work business (construction / services) needs a service code, and
 *    a supplier ("we supply / sell / distribute …", "supplier", "distributor"; never "provide" / "offer", which frame
 *    services just as often) needs a product code. R&D codes (A…) never
 *    agree unless the business says it does research. A missing code agrees (unknown is not evidence against).
 * Two or more list words in the head stay DIRECT. Rows are never dropped; this only moves them from DIRECT to RELATED.
 * Short queries and trade presets are untouched (trades already require their own vocabulary or code).
 */
export const LIST_QUERY_WORDS = 15;
const MODIFIER_CLAUSE = /\b(?:for|to|in\s+support\s+of|used\s+(?:in|on|by))\b([^.:;]*)/gi;
const SUPPLIER_ROLE = /\b(supplier|distributor|reseller|vendor|dealer|wholesaler)s?\b/i;
/** "provide" / "offer" frame services as often as goods ("we provide janitorial services"), so they never mark a supplier. */
const GOODS_VERBS = new Set(['supply', 'supplies', 'sell', 'sells', 'resell', 'resells', 'distribute', 'distributes', 'furnish', 'furnishes', 'source', 'sources', 'deliver', 'delivers']);
const RESEARCH_INTENT = /\b(research|r&d|development|prototyp\w*|engineering\s+services?)\b/i;

function queryConcepts(plan: DiscoveryPlan): Concept[] {
  const m = plan.matcher;
  if (m.mode !== 'lexical') return [];
  const seen = new Map<string, Concept>();
  for (const a of m.alternatives) for (const c of a.eligible) if (!seen.has(c.label)) seen.set(c.label, c);
  return [...seen.values()];
}
/** List words that occur in the query only inside "for … / to …" clauses (who it is for, not what is sold). */
function modifierLabels(query: string, concepts: Concept[]): Set<string> {
  const q = String(query || '');
  const inClauses = [...q.matchAll(MODIFIER_CLAUSE)].map((x) => x[1]).join(' \n ');
  const outside = q.replace(MODIFIER_CLAUSE, ' ');
  return new Set(concepts.filter((c) => conceptHit(c, inClauses) && !conceptHit(c, outside)).map((c) => c.label));
}
function familyAgrees(psc: string, query: string, cap: CapabilityInterpretation): boolean {
  if (!psc) return true;
  const products = cap.codePresets?.products || [];
  if (products.length) {
    const groups = new Set([...(cap.related_market?.psc || []), ...products.flatMap((id) => STRICT_ITEM_PRESETS[id] || [])].map((c) => c.slice(0, 2)));
    return groups.has(psc.slice(0, 2));
  }
  if (/^A/i.test(psc)) return RESEARCH_INTENT.test(query);
  const supplier = [...framedVerbs(query)].some((v) => GOODS_VERBS.has(v)) || SUPPLIER_ROLE.test(query);
  return supplier ? /^\d/.test(psc) : /^[A-Z]/i.test(psc);
}
/** null = the guard does not apply; otherwise the verdict that replaces DIRECT. */
function longListGuard(row: Record<string, unknown>, plan: DiscoveryPlan, cap: CapabilityInterpretation, residual: string, head: string): EvidenceVerdict | null {
  // Sentence structure ("for …" clauses, subject verbs) is read from the query AS TYPED: the residual has its periods and
  // colons stripped, so a "for" clause would run to the end of the paragraph and swallow the whole list.
  const query = String(plan.raw || residual || '');
  if (query.trim().split(/\s+/).length <= LIST_QUERY_WORDS) return null;
  if ((cap.codePresets?.trades || []).length || vocabHit(cap, head)) return null;
  const concepts = queryConcepts(plan);
  if (!concepts.length) return null;
  const mods = modifierLabels(query, concepts);
  const hits = concepts.filter((c) => conceptHit(c, head));
  const core = hits.filter((c) => !mods.has(c.label));
  const relatedV: EvidenceVerdict = { cls: 'RELATED_MARKET_CANDIDATE', basis: 'single_list_word' };
  if (hits.length && !core.length) return relatedV;
  if (core.length === 1 && !familyAgrees(String(row.psc_code || ''), query, cap)) return relatedV;
  return null;
}

const codeIn = (list: string[], v: unknown) => { const s = String(v || '').trim(); return !!s && list.some((c) => (c.length < 6 ? s.startsWith(c) : s === c)); };

export function classifyOpenEvidence(
  row: Record<string, unknown>, plan: DiscoveryPlan, cap: CapabilityInterpretation, query: string,
): EvidenceVerdict {
  const trades = cap.codePresets?.trades || [];
  const products = cap.codePresets?.products || [];
  const psc = String(row.psc_code || '');
  const productNotice = /^\d/.test(psc);
  const head = maskOrgNames(titleHead(String(row.title || '')), query);
  const fullTitle = maskOrgNames(String(row.title || ''), query);
  const desc = maskOrgNames(String(row.description || ''), query);

  // Parts-only seller vs a repair notice.
  if (products.length && !trades.length && !REPAIR_INTENT.test(query)
    && (REPAIR_TITLE.test(String(row.title || '')) || /^[JK]/.test(psc) || REPAIR_DESC.test(String(row.description || '').slice(0, REPAIR_DESC_WINDOW)))) {
    return { cls: 'WEAK_NON_MARKET', basis: 'repair_notice_for_parts' };
  }
  // 1 · own trade code (specific 6-digit NAICS / its PSC)
  if (trades.length && (codeIn(cap.direct.naics, row.naics_code) || codeIn(cap.direct.psc, psc))) {
    return { cls: 'DIRECT_MATCH', basis: 'own_trade_code' };
  }
  // 1 · the procured thing names the work / item
  const inHead = vocabHit(cap, head) || (trades.length ? false : customerHit(plan, head));
  // A product search needs the item itself: a product notice, AND either the preset's own item code or the term in the
  // DLA noun slot ("NN--NOUN,MODIFIER"). "17--TOWBAR,AIRCRAFT" (ground equipment, FSC 1730) names aircraft only as a
  // modifier: RELATED, not DIRECT (benchmark labels: NO / PARTIAL).
  const strictFamilies = products.flatMap((id) => STRICT_ITEM_PRESETS[id] || []);
  const productDirect = () => {
    if (!productNotice) return false;
    if (codeIn(cap.related_market?.psc || [], psc)) return true;
    const noun = String(row.title || '').replace(/^\d{2}--/, '').split(',')[0];
    // Strict presets (IT hardware): only the preset's item nouns, and only inside its PSC families.
    if (strictFamilies.length && products.every((id) => STRICT_ITEM_PRESETS[id])) {
      return strictFamilies.some((f) => psc.startsWith(f)) && vocabHit(cap, noun);
    }
    return vocabHit(cap, noun) || customerHit(plan, noun);
  };
  if (inHead && (!products.length || productDirect())) {
    return longListGuard(row, plan, cap, query, head) || { cls: 'DIRECT_MATCH', basis: 'title_item' };
  }
  // A trade search whose only title evidence is the customer's generic word ("clean" in "grease trap cleaning",
  // "guards" in "Coast Guard ...") is RELATED, not DIRECT: the trade's own vocabulary or code must appear.
  if (trades.length && customerHit(plan, head)) return { cls: 'RELATED_MARKET_CANDIDATE', basis: 'description_only' };
  // product code with no item evidence
  if (codeIn(cap.related_market?.psc || [], psc)) return { cls: 'RELATED_MARKET_CANDIDATE', basis: 'product_code_only' };
  if (cap.related_market && codeIn(cap.related_market.naics, row.naics_code)) return { cls: 'RELATED_MARKET_CANDIDATE', basis: 'related_family_code' };
  // 2 · requirement text
  const inDesc = customerHit(plan, `${fullTitle} \n ${desc}`) || vocabHit(cap, `${fullTitle} \n ${desc}`);
  if (inDesc) {
    if (products.length && productNotice) return { cls: 'WEAK_NON_MARKET', basis: 'boilerplate_only' };
    return { cls: 'RELATED_MARKET_CANDIDATE', basis: 'description_only' };
  }
  // 3 · only an agency/program name, the buyer columns, or the SOW carried the words
  const raw = `${row.title || ''} \n ${row.description || ''}`;
  if (customerHit(plan, raw)) return { cls: 'WEAK_NON_MARKET', basis: 'agency_or_program_name' };
  return { cls: 'WEAK_NON_MARKET', basis: 'no_evidence' };
}
