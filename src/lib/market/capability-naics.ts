/**
 * Deterministic capability-to-NAICS interpretation of ordinary customer language.
 *
 * Why: the chat planner (GPT-4o) chose NAICS codes inconsistently for the same words. One run of
 * "temporary staffing, clerical, admin and warehouse work" sent 561320,561110,493110; the next
 * sent only 5613 or only 561320, silently narrowing the question. The same words must always
 * produce the same codes, chosen by Mindy, not re-guessed by a model on each turn.
 *
 * Rules:
 *  - Every code is a real 2022 NAICS code present in Mindy's NAICS reference (enforced by test).
 *  - Specific phrases win over generic ones ("medical staffing" before "staffing"): a matched span
 *    is claimed and cannot be matched again.
 *  - Words not in the lexicon are NOT mapped (no guessing). They are returned as unmapped so the
 *    caller searches them as keywords.
 *  - The interpretation is advisory to the planner: codes the customer typed always win.
 */
import { getNaics } from '@/lib/codes/lookup';

export interface CapabilityEntry {
  /** Customer-language pattern (case-insensitive, word-bounded). */
  match: RegExp;
  /** Short label for the interpreted capability. */
  label: string;
  naics: string[];
}

/** Ordered: more specific phrases first. */
export const CAPABILITY_LEXICON: CapabilityEntry[] = [
  // Staffing
  { match: /\b(medical|nurse|nursing|clinical|healthcare|health care)\s+staffing\b/i, label: 'medical staffing', naics: ['561320', '621399'] },
  { match: /\b(it|technical|tech)\s+staffing\b/i, label: 'IT staffing', naics: ['561320', '541519'] },
  { match: /\b(temporary|temp|contract|light industrial|industrial)\s+(staffing|labor|help|workers?|personnel)\b|\bpersonnel services\b|\btemporary help\b|\bstaffing\b|\btemp\s+agency\b/i, label: 'temporary staffing', naics: ['561320'] },
  { match: /\b(employment placement|recruiting|recruitment|executive search)\b/i, label: 'employment placement', naics: ['561311'] },
  // Administrative and office support
  { match: /\b(clerical|clerks?|secretar(?:y|ies|ial)|receptionists?|office assistants?|administrative support|admin support|office support|office administrative|administrative services|admin services|admin|administrative)\b/i, label: 'clerical and administrative support', naics: ['561110'] },
  { match: /\b(document preparation|word processing|data entry)\b/i, label: 'document preparation and data entry', naics: ['561410'] },
  { match: /\b(call center|answering service|help line|contact center)\b/i, label: 'call center', naics: ['561421'] },
  { match: /\b(translation|interpretation|interpreting|interpreter|translator)s?\b/i, label: 'translation and interpretation', naics: ['541930'] },
  // Warehousing, logistics, moving
  { match: /\b(cold storage|refrigerated (warehous\w*|storage))\b/i, label: 'refrigerated warehousing', naics: ['493120'] },
  { match: /\b(warehous\w*|storage and distribution|material handling|forklift)\b/i, label: 'warehousing', naics: ['493110'] },
  { match: /\b(freight forwarding|freight brokerage|logistics management|freight arrangement)\b/i, label: 'freight arrangement', naics: ['488510'] },
  { match: /\b(office moving|household goods moving|movers?|moving services|relocation services)\b/i, label: 'moving services', naics: ['484210'] },
  { match: /\b(courier|express delivery)\w*\b/i, label: 'courier and delivery', naics: ['492110'] },
  { match: /\b(ground transportation|transportation of|transportation services|detainee transport\w*|transport of)\b/i, label: 'transportation', naics: ['485999'] },
  // Facilities
  { match: /\b(janitorial|custodial|cleaning services|housekeeping)\b/i, label: 'janitorial', naics: ['561720'] },
  { match: /\b(landscaping|grounds maintenance|lawn care|mowing)\b/i, label: 'landscaping and grounds', naics: ['561730'] },
  { match: /\b(facilities support|facility support|base operations support|facilities management|facility management|facility operations)\b/i, label: 'facilities support', naics: ['561210'] },
  { match: /\b(pest control|exterminat\w*)\b/i, label: 'pest control', naics: ['561710'] },
  { match: /\b(security guards?|(?<!coast\s)(?<!national\s)guard\s+services?|armed guards?|unarmed guards?|security officers?|protective security officers?|court security officers?|protective services)\b/i, label: 'security guards', naics: ['561612'] },
  { match: /\b(security systems?|alarm systems?|access control systems?|cctv|video surveillance)\b/i, label: 'security systems', naics: ['561621'] },
  { match: /\b(waste collection|trash (removal|collection)|refuse collection|garbage collection)\b/i, label: 'waste collection', naics: ['562111'] },
  { match: /\b(environmental remediation|remediation|abatement|hazardous waste cleanup)\b/i, label: 'remediation', naics: ['562910'] },
  // Construction trades
  { match: /\b(hvac|heating and (air|cooling)|air conditioning|plumbing|plumbers?)\b/i, label: 'HVAC and plumbing', naics: ['238220'] },
  { match: /\b(electrical (work|contractor|services|installation)|electricians?)\b/i, label: 'electrical', naics: ['238210'] },
  { match: /\b(roofing|roofers?)\b/i, label: 'roofing', naics: ['238160'] },
  { match: /\b(painting|painters?|wall covering)\b/i, label: 'painting', naics: ['238320'] },
  { match: /\b(site preparation|excavation|earthwork|demolition)\b/i, label: 'site preparation', naics: ['238910'] },
  { match: /\b(general contractor|commercial construction|building construction|new construction)\b/i, label: 'commercial building construction', naics: ['236220'] },
  { match: /\b(renovation|remodel\w*)\b/i, label: 'renovation', naics: ['236220', '236118'] },
  { match: /\b(building inspection|home inspection)s?\b/i, label: 'building inspection', naics: ['541350'] },
  { match: /\b(surveying|land survey\w*|mapping services|gis services)\b/i, label: 'surveying and mapping', naics: ['541370'] },
  // Professional and technical services
  { match: /\b(software development|custom software|application development|app development|programming)\b/i, label: 'software development', naics: ['541511'] },
  { match: /\b(it help desk|help desk|service desk|desktop support|it support|network administration|systems administration)\b/i, label: 'IT support', naics: ['541513', '541519'] },
  { match: /\b(it services|information technology services|systems integration|it consulting)\b/i, label: 'IT services', naics: ['541512', '541519'] },
  { match: /\b(cloud hosting|data center|web hosting|data processing)\b/i, label: 'hosting and data processing', naics: ['518210'] },
  { match: /\b(engineering services|civil engineering|mechanical engineering|electrical engineering|engineering support)\b/i, label: 'engineering', naics: ['541330'] },
  { match: /\b(environmental consulting|environmental services|environmental assessments?)\b/i, label: 'environmental consulting', naics: ['541620'] },
  { match: /\b(management consulting|program management|project management|business consulting|acquisition support)\b/i, label: 'management consulting', naics: ['541611'] },
  { match: /\b(marketing|public relations|outreach campaigns?)\b/i, label: 'marketing', naics: ['541613'] },
  { match: /\b(training|instructors?|curriculum development)\b/i, label: 'training', naics: ['611430'] },
  { match: /\b(testing laborator\w*|lab testing|laboratory testing)\b/i, label: 'testing laboratories', naics: ['541380'] },
  // Health, food, other
  { match: /\b(home health)\b/i, label: 'home health care', naics: ['621610'] },
  { match: /\b(food service|dining facility|dining services|cafeteria)\b/i, label: 'food service', naics: ['722310'] },
  { match: /\b(catering|caterers?)\b/i, label: 'catering', naics: ['722320'] },
  { match: /\b(printing services|commercial printing|print shop)\b/i, label: 'commercial printing', naics: ['323111'] },
  { match: /\b(equipment repair|machinery repair|equipment maintenance)\b/i, label: 'equipment repair', naics: ['811310'] },
  { match: /\b(vehicle maintenance|fleet maintenance|auto repair|automotive repair)\b/i, label: 'vehicle maintenance', naics: ['811111'] },
];

export interface CapabilityInterpretationItem {
  phrase: string;
  label: string;
  naics: Array<{ code: string; title: string }>;
}

export interface CapabilityNaicsResult {
  items: CapabilityInterpretationItem[];
  /** All codes, de-duplicated, in the order the capabilities appear in the text. */
  codes: string[];
  /** 6-digit codes the customer typed themselves (these always win). */
  typedCodes: string[];
}

/** Interpret capabilities in free text. Pure and deterministic. */
export function interpretCapabilityNaics(text: string): CapabilityNaicsResult {
  const src = String(text || '');
  const claimed: Array<[number, number]> = [];
  const hits: Array<{ at: number; item: CapabilityInterpretationItem }> = [];
  const overlaps = (s: number, e: number) => claimed.some(([a, b]) => s < b && e > a);
  for (const entry of CAPABILITY_LEXICON) {
    const re = new RegExp(entry.match.source, entry.match.flags.includes('g') ? entry.match.flags : `${entry.match.flags}g`);
    for (const m of src.matchAll(re)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (overlaps(s, e)) continue;
      claimed.push([s, e]);
      if (hits.some((h) => h.item.label === entry.label)) continue;
      hits.push({
        at: s,
        item: {
          phrase: m[0],
          label: entry.label,
          naics: entry.naics.map((code) => ({ code, title: getNaics(code)?.title ?? '' })),
        },
      });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const items = hits.map((h) => h.item);
  const codes: string[] = [];
  for (const it of items) for (const n of it.naics) if (!codes.includes(n.code)) codes.push(n.code);
  const typedCodes = Array.from(new Set(src.match(/\b\d{6}\b/g) ?? [])).filter((c) => !!getNaics(c));
  return { items, codes, typedCodes };
}

/** One system-prompt paragraph for the chat planner, or null when nothing was interpreted. */
export function capabilityPlannerNote(text: string): string | null {
  const r = interpretCapabilityNaics(text);
  if (!r.items.length) return null;
  const lines = r.items.map((it) => `"${it.phrase}" = ${it.label}: ${it.naics.map((n) => `${n.code} ${n.title}`).join('; ')}`);
  const typed = r.typedCodes.length ? ` The user typed NAICS ${r.typedCodes.join(', ')}: use those as given.` : '';
  return (
    'CAPABILITY INTERPRETATION (deterministic, from Mindy\'s capability lexicon; use it, do not re-guess codes): '
    + lines.join(' | ')
    + `. Cover ALL of them unless the user asked for something narrower: tools that accept a NAICS list (get_expiring_contracts, search_sam_opportunities) take "${r.codes.join(',')}" in one call; for a tool that takes one NAICS, call it once per code.`
    + typed
    + ' Words not listed here were not mapped to a code; search them as keywords rather than inventing a code.'
  );
}
