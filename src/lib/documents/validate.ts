/**
 * Validate a DocModel before it is stored or rendered.
 *
 * The rules a renderer relies on are enforced HERE, never trusted to whatever produced the model
 * (an LLM, a feature adapter, a client):
 *   - structure: known block types, unique ids, required fields, size limits;
 *   - EVERY BLOCK IS LABELED: a block (or bullet item) with no claim is an error. An unlabeled block
 *     used to skip the citation rule entirely (review M1, 2026-11-17);
 *   - FACTS MUST CITE: a block labeled `fact` needs at least one cite, and every cite must resolve to
 *     a source in `sources`. A fact with no resolvable cite is an error, not a warning — an uncited
 *     "fact" in a client-facing PDF is exactly the claim Mindy cannot defend;
 *   - CONTEXT HAS NO NUMBERS: `context` describes the document; a digit means it is a claim;
 *   - ASSUMPTIONS MAY PLAN, NOT ASSERT (Eric, 2026-11-17): an assumption may state a planning figure,
 *     but one asserting a factual claim about the world must cite (assumptionAssertsFact); an uncited
 *     assumption states its origin; certifications, contract awards, past performance and
 *     eligibility/set-aside status are never an assumption (neverAnAssumption: cite as fact or omit);
 *     a revision never turns an assumption into a fact (hardenedAssumptions);
 *   - numbers: table/chart values must be finite; a missing value is null ("Not available"), never 0.
 *
 * Sanctioned repairs (Ask Mindy runs ONE tool round per turn — "fix and call again" is unreachable):
 *   - `repairDocModelStructure`: uniquify duplicate ids; infer missing table columns from row keys.
 *     Live 2026-11-19: comprehensive market-research create_document failed twice on duplicate
 *     section/block ids and "at least one column" — the model apologised instead of saving.
 *   - `demoteUncitedFacts` (Eric's rule: verified, ASSUMPTION, or omitted — never "estimate"): an
 *     uncited decision-critical statement is OMITTED; any other uncited statement is relabeled
 *     `unverified`, which renders "Unverified — no source" and is listed in its own section.
 */
import { DOC_LIMITS, DOC_SCHEMA, labeledUnits, type Block, type DocModel } from './model';
import agencyAliases from '@/data/agency-aliases.json';

export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { ok: true; model: DocModel } | { ok: false; issues: ValidationIssue[] };

/** The allowed values, exported so a producer's schema (create_document) states them exactly. */
export const BLOCK_TYPE_VALUES = ['paragraph', 'bullets', 'table', 'chart', 'callout', 'pagebreak'] as const;
export const CLAIM_VALUES = ['fact', 'assumption', 'recommendation', 'unverified', 'context'] as const;
export const SOURCE_KIND_VALUES = ['sam_notice', 'usaspending', 'upload', 'vault', 'tool', 'web', 'other'] as const;
const BLOCK_TYPES = new Set<string>(BLOCK_TYPE_VALUES);
const CLAIMS = new Set<string>(CLAIM_VALUES);
const SOURCE_KINDS = new Set<string>(SOURCE_KIND_VALUES);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ATTENTION_MAX_CHARS = 120;

// A count or an amount: a free-standing number ("$640M", "16", "24 months", "5%") or a number
// word ("eight", "forty-two", "million"). Not a digit glued to letters (FY26, Q3, W912PL) and not
// a program name like 8(a). "one" is excluded: "one of the offices" is not a figure.
const NUMERIC_TOKEN = /(?<![A-Za-z0-9])\$?\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9(])|(?<![A-Za-z0-9])\$?\d[\d,]*(?:\.\d+)?(?:[KkMmBb]|%)(?![A-Za-z0-9])/;
const NUMBER_WORD = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|dozen|percent)\b/i;
// Proportions are figures too ("half of all obligations", "a third", "most buyers"). "quarter" counts only
// in its proportion form ("a quarter of", "three quarters of"); "fourth-quarter buying" is a time.
// "third"/"fifth" likewise only as proportions ("a third", "two thirds", "the upper third of"), never the
// ordinal ("the third quarter").
const FRACTION_WORD = /\b(?:half|halves|majority|minority|most|twice|double|triple|doubled|tripled)\b|\b(?:a|one|three)\s+quarters?\s+of\b|\b(?:a|one|two|three|four)\s+(?:third|fifth)s?\b|\b(?:third|fifth)s?\s+of\b/i;

// `context` describes the DOCUMENT. It may never carry a decision-relevant claim, whatever section the
// model put it in (the model chooses the section role, so the role alone proves nothing):
//   - eligibility / set-aside / competition vocabulary,
//   - an incumbent, an award, or a named company (by legal suffix),
//   - a date, deadline or due day.
const CONTEXT_FORBIDDEN_PARTS: RegExp[] = [
  // Eligibility, set-aside and competition vocabulary (any case).
  /\b(?:SDVOSB|VOSB|WOSB|EDWOSB|HUBZone|set[- ]asides?|sole[- ]source|small[- ]business|eligib\w*|certif\w*|incumbent\w*|award\w*|recompete\w*|competed|competition|bidders?|offerors?)\b/i,
  /\b8\s*\(\s*a\s*\)/i,
  // A named company: a capitalized legal or trade suffix ("Acme Federal", "Delta Corp.", "Apex LLC").
  /\b[A-Z][\w&'-]*\s+(?:Inc|LLC|L\.L\.C|Corp|Corporation|Company|Co|Ltd|LLP|PLLC|Holdings|Federal|Technologies|Solutions|Group|Systems|Services)\b/,
  // A date or deadline. Month names are matched capitalized so the verb "may" never trips it.
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Sept?|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Oct|Nov|Dec|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/,
  /\b(?:deadline|due date|due by|due on|is due|are due|tomorrow|yesterday)\b/i,
];
const CONTEXT_FORBIDDEN = { test: (t: string) => CONTEXT_FORBIDDEN_PARTS.some((re) => re.test(t)) };
/** An 'about' section is a short note on the document, never a place to put content. */
const ABOUT_MAX_CONTEXT_BLOCKS = 4;
const CONTEXT_MAX_CHARS = 600;
/** Does this text state a count or an amount? */
export function statesFigure(text: string): boolean {
  const plain = text.replace(/\*\*|_/g, '');
  return NUMERIC_TOKEN.test(plain) || NUMBER_WORD.test(plain) || FRACTION_WORD.test(plain);
}

// ── ASSUMPTION rule (Eric, 2026-11-17) ───────────────────────────────────────────────────────────
// A strategic assumption is allowed when labeled ASSUMPTION, and may state a PLANNING figure
// ("we assume a ~$2M annual budget for planning"). It may not smuggle a FACTUAL claim about the
// world — an award value, obligation, ceiling, incumbent, date, or a count of buyers, vendors,
// contracts… — without a cite; those get cite / "Unverified — no source" / omit, like any fact.

// Nouns that make a figure a claim about the federal market rather than the author's plan.
// Nouns AND verb forms that make a figure a claim about the federal market rather than the author's
// plan (A4 round 2: "awarded", "spends", "buys", "% of" used to slip past a noun-only list).
const WORLD_TERM = /\b(?:agenc(?:y|ies)|departments?|offices?|buyers?|vendors?|bidders?|offerors?|competitors?|incumbents?|contractors?|firms?|compan(?:y|ies)|recompet\w*|contracts?|awar\w*|obligat\w*|spen(?:d|ds|ding|t)|ceilings?|solicitations?|opportunit(?:y|ies)|(?:task|delivery) orders?|market|buy|buys|bought|buying|purchas\w*|procur\w*|share)\b|\bpercent of\b|%\s+of\b/i;
// A federal buyer named in the text. Acronyms come from the repo's agency alias list, matched
// case-sensitively as whole words; acronyms that collide with ordinary usage are left out
// (BPA = blanket purchase agreement, USA = the country, and two-letter codes like AG/ED/AF).
const ACRONYM_COLLISIONS = new Set(['BPA', 'USA', 'AG', 'ED', 'CG', 'AF', 'RD', 'SC', 'FE', 'NE', 'EM']);
const AGENCY_ACRONYM = new RegExp(`\\b(?:${Object.keys(agencyAliases.aliases).filter((k) => /^[A-Z]{2,8}$/.test(k) && !ACRONYM_COLLISIONS.has(k)).join('|')})\\b`);
const AGENCY_NAME = /\b(?:the )?(?:Army|Navy|Air Force|Marine Corps|Coast Guard|Space Force|Pentagon)\b|\bDepartment of (?:the )?[A-Z]|\b[A-Z][a-z]+ (?:Agency|Administration|Command|Bureau)\b/;
const namesAgency = (t: string) => AGENCY_ACRONYM.test(t) || AGENCY_NAME.test(t);
// A named company (capitalized legal/trade suffix) — the same test context uses.
const NAMED_COMPANY = /\b[A-Z][\w&'-]*\s+(?:Inc|LLC|L\.L\.C|Corp|Corporation|Company|Co|Ltd|LLP|PLLC|Holdings|Federal|Technologies|Solutions|Group|Systems|Services)\b/;
// A contract/solicitation number: 6-char office code, 2-digit FY, type letter, serial (W912PL21C0001, 36C24226Q0857).
const CONTRACT_NUMBER = /\b[A-Z0-9]{6}-?\d{2}-?[A-Z]-?[A-Z0-9]{4,}\b/;
// Who holds the work is a fact, figure or not.
const INCUMBENT_CLAIM = /\b(?:incumbent\w*|holds? the (?:current )?contract|current (?:contract )?holder)\b/i;
// Who won is the same kind of fact as who holds it — figure or not ("the Army awarded it to Acme").
const AWARD_CLAIM = /\b(?:awarded (?:\w+ )?to|(?:was|were|been) awarded|won (?:the|a|an|this|that|it|its)|winner of)\b/i;
const WENT_TO_COMPANY = /\bwent to (?:[A-Z][\w&'-]*)/;
// A specific date or a deadline. A bare month ("buying peaks in July through September") is seasonal
// planning language and is allowed; a day ("March 15", "12 Dec", "2026-12-12") or a due date is not.
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)';
const SPECIFIC_DATE = new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\b|\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`);
const DEADLINE = /\b(?:deadline|due date|due by|due on|is due|are due|closes on|closing date)\b/i;
// Words that present a figure as the author's own planning premise.
const PLANNING_FRAME = /\b(?:assum\w*|for planning|planning|plan(?:ned)? (?:for|on)|budget(?:ed|ing|s)?|target(?:ed|ing|s)?|goal|we (?:will|would|plan|intend)|our)\b/i;

/**
 * Does an ASSUMPTION assert a factual claim about the world (so it must cite)? True when it states a
 * figure about the market (an award, obligation, ceiling, contract, buyer, vendor, spending, share…
 * in noun or verb form, a named agency, a named company or a contract number), states a figure NOT
 * framed as the author's planning premise, names an incumbent or a winner, or gives a specific date or
 * deadline. A figure about the customer's own environment ("250 users across 12 sites"), framed as a
 * planning premise, is a strategic assumption and passes (Eric's rule, settled 2026-11-17). A framed planning figure with none of those passes.
 */
export function assumptionAssertsFact(text: string): boolean {
  const plain = text.replace(/\*\*|_/g, '');
  const figure = statesFigure(plain);
  if (figure && (WORLD_TERM.test(plain) || namesAgency(plain) || NAMED_COMPANY.test(plain) || CONTRACT_NUMBER.test(plain))) return true;
  if (figure && !PLANNING_FRAME.test(plain)) return true;
  return INCUMBENT_CLAIM.test(plain) || AWARD_CLAIM.test(plain) || WENT_TO_COMPANY.test(plain) || SPECIFIC_DATE.test(plain) || DEADLINE.test(plain);
}

// ── Never an assumption (Eric, 2026-11-17) ───────────────────────────────────────────────────────
// Certifications, contract awards, past performance and eligibility/set-aside status are facts about a
// company's standing. They can NEVER ride on an ASSUMPTION block: they cite (as a fact) or are omitted —
// never shown as "unverified", never left as a premise. "Award volume" (a seasonal pattern) is not an award.
const NEVER_ASSUMPTION_PARTS: RegExp[] = [
  // Socioeconomic status / certification — acronyms and spelled out. Only the COMPANY's standing:
  // "certified payroll" and a person's certification ("staff will complete Security+ certification")
  // are planning, not status (A4 round 2).
  /\b(?:8\s*\(\s*a\s*\)|HUBZone)|\b(?:SDVOSB|VOSB|EDWOSB|WOSB|VetCert|DBE|SDB)\b/,
  /\b(?:(?:service[- ]disabled )?veteran[- ]owned|wom[ae]n[- ]owned|minority[- ]owned|(?:socially and )?economically disadvantaged|small disadvantaged business)\b/i,
  /\b(?:certified|certification) (?:as|under)\b|\bSBA[- ]certified\b/i,
  /\b(?:we are|we're|we remain|our (?:firm|company|business) is|the (?:firm|company|business) is)\s+(?:an?\s+)?(?:[\w-]+\s+){0,2}certified\b/i,
  /\b(?:we|firm|company|business) (?:holds?|has|have|maintains?) (?:an? |the |its |our )?(?:active |current |valid )?(?:[\w()-]+ ){0,2}certification\b/i,
  // Size / small-business status.
  /\b(?:is|are|as|we're) (?:a |an )?(?:[\w-]+ ){0,3}small[- ]business(?:es)?\b|\bsmall[- ]business (?:status|concern|size)\b|\bsize standard\b|\bother than small\b/i,
  // Set-aside / sole-source status.
  /\b(?:set[- ]asides?|sole[- ]source\w*)\b/i,
  // Eligibility / qualification — only when tied to an award, contract, set-aside, program or size
  // ("only eligible travel costs", "qualifies for overtime pay" are planning).
  /\b(?:eligib\w*|ineligib\w*|qualif(?:y|ies|ied))\b[^.]{0,40}\b(?:awards?|contracts?|set[- ]asides?|programs?|size|preference|8\s*\(\s*a\s*\)|HUBZone|SDVOSB|WOSB|small[- ]business|price evaluation)\b/i,
  /\b(?:award|contract|set[- ]aside|program) eligibility\b/i,
  // Past performance — named, or a first-person record of prior work.
  /\b(?:past performance|CPARS|PPIRS)\b|\b(?:prior|previous) (?:contracts?|work|awards?) (?:with|for)\b/i,
  /\b(?:[Ww]e|[Oo]ur (?:firm|company|team))\b[^.]{0,40}?\b(?:previously |have |has )?(?:supported|performed|delivered|served|held|completed|managed)\b[^.]{0,60}?(?:\b(?:contracts?|task orders?|requirements?|programs?|agenc(?:y|ies))\b|\bfor (?:the )?[A-Z])/,
  /\b(?:were|was|as) the (?:prime|incumbent|subcontractor|sub) on\b/i,
  // Contract-vehicle holding is eligibility.
  /\bGSA (?:MAS|[Ss]chedule)\b|\b(?:GWAC|IDIQ|BPA|MAC) (?:holder|award)\b|\bhold (?:a|an|the|our) [\w -]{0,20}(?:schedule|vehicle|GWAC|IDIQ|BPA)\b/i,
  // Contract awards and who won.
  /\b(?:awarded|contract awards?|award (?:of|to)|won (?:the|a|an|this|that|it|its)|winner of|(?:was|were|been) awarded)\b/i,
];
// A CITED statement of a measured market figure is an observation — a fact — not an assumption
// ("no vendor appears to hold more than about 5% of obligations [1]"). An assumption about the market
// projects FORWARD from the evidence, so only a forward reference counts (A4, v3 early check): a hedge
// ("may", "could", "if") on a past figure is still an observation ("Obligations may have peaked at
// $412M"), and a sentence that reports a past measurement stays an observation even when it adds a
// forecast ("Spending was flat at $24M, and may continue"). An explicit planning premise ("for
// planning, assume …") is the author's assumption by Eric's rule.
const FORWARD = /\b(?:will|expect\w*|forecast\w*|project(?:s|ed|ion|ions)?|anticipat\w*|likely to|at the current pace|next (?:year|quarter|fiscal year|FY)|by FY\s?\d{2,4})\b/i;
const PLANNING_PREMISE = /\b(?:for planning|planning (?:figure|purposes|basis|premise|assumption))\b/i;
const PAST_MEASURED = /\b(?:obligated|awarded|spent|was|were|peaked|totaled|totalled|grew|fell|rose|declined|increased|decreased|bought|purchased|procured|won|received|reached|averaged)\b|\b(?:may|might|could|would|must|should) have\b/i;

/** A cited assumption that reports a measured market figure rather than projecting it: mislabeled. */
export function citedObservationAsAssumption(u: { claim?: string; cites?: string[]; text: string }, sourceIds: Set<string>): boolean {
  if (u.claim !== 'assumption' || !(u.cites ?? []).some((c) => sourceIds.has(c))) return false;
  const t = u.text.replace(/\*\*|_/g, '');
  if (!assumptionAssertsFact(t)) return false;
  if (PAST_MEASURED.test(t)) return true;
  return !FORWARD.test(t) && !PLANNING_PREMISE.test(t);
}

export function neverAnAssumption(text: string): boolean {
  const plain = text.replace(/\*\*|_/g, '');
  return NEVER_ASSUMPTION_PARTS.some((re) => re.test(plain));
}

/** What an uncited assumption says about its origin when the producer gave none (set only by demotion). */
export const DEFAULT_ASSUMPTION_ORIGIN = 'This is a planning assumption made for this analysis. It was not verified against the customer\'s records.';
const ORIGIN_MAX_CHARS = 300;

/**
 * Revisions never harden an assumption into a fact (Eric, 2026-11-17). Compares a revised model with
 * the one it revises and returns every unit that was an ASSUMPTION before and now claims to be a FACT
 * (or carries no label / context): matched by unit location (block id, bullet index) or by identical
 * text. Dropping an assumption or demoting it to unverified is fine; re-emitting it as a fact is not.
 * The revision save path (saveGeneratedDocument, #2116) must refuse a non-empty result.
 */
export function hardenedAssumptions(prev: DocModel, next: DocModel): string[] {
  const norm = (t: string) => t.replace(/\*\*|_/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const prevWhere = new Set<string>();
  const prevText = new Set<string>();
  for (const sec of prev.sections) for (const b of sec.blocks) for (const u of labeledUnits(b)) {
    if (u.claim === 'assumption') { prevWhere.add(u.where); prevText.add(norm(u.text)); }
  }
  const out: string[] = [];
  for (const sec of next.sections) for (const b of sec.blocks) for (const u of labeledUnits(b)) {
    const hardened = u.claim === 'fact' || u.claim === undefined || u.claim === 'context';
    if (hardened && (prevWhere.has(u.where) || prevText.has(norm(u.text)))) out.push(u.where);
  }
  return out;
}

// ── Per-section boilerplate: a SIGNAL for the producer, not a rule (A4 MED-2) ────────────────────
// Method text belongs once, in the 'about' section. But a long sentence repeated across blocks is
// not reliably boilerplate: a cited fact can be true of two bullets ("No forecast has been published
// by this office in the last 24 months"), and a qualification belongs next to EACH claim it qualifies.
// The engine therefore never refuses or cuts on repetition — silently deleting a cited fact is worse
// than a repeated sentence. repeatedSentences() reports UNCITED repeats across different sections so
// the producer (the generate tool's retry) can rewrite them; cited units are never reported.
const BOILERPLATE_MIN_CHARS = 60;
const sentencesOf = (t: string) => t.replace(/\*\*|_/g, '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const sentenceKey = (x: string) => x.replace(/\s+/g, ' ').toLowerCase();

/** Long sentences repeated in uncited units across two or more sections (unit locations, reading order). */
export function repeatedSentences(model: DocModel): Array<{ sentence: string; where: string[] }> {
  const ids = new Set(model.sources.map((x) => x.id));
  const seen = new Map<string, { sentence: string; where: string[]; sections: Set<string> }>();
  for (const sec of model.sections) for (const b of sec.blocks) {
    if (b.type === 'table' || b.type === 'chart') continue;
    for (const u of labeledUnits(b)) {
      if ((u.cites ?? []).some((c) => ids.has(c))) continue;
      for (const x of new Set(sentencesOf(u.text))) {
        if (x.length < BOILERPLATE_MIN_CHARS) continue;
        const k = sentenceKey(x);
        const e = seen.get(k) ?? { sentence: x, where: [], sections: new Set<string>() };
        e.where.push(u.where);
        e.sections.add(sec.id);
        seen.set(k, e);
      }
    }
  }
  return [...seen.values()].filter((e) => e.sections.size > 1).map(({ sentence, where }) => ({ sentence, where }));
}

/** Must this unit cite a source, given its label? (recommendation: any figure; assumption: a factual claim) */
function labelNeedsSource(claim: string | undefined, text: string): boolean {
  if (claim === 'recommendation') return statesFigure(text);
  if (claim === 'assumption') return assumptionAssertsFact(text);
  return false;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function str(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function blockChars(b: Block): number {
  switch (b.type) {
    case 'paragraph':
    case 'callout':
      return b.text.length;
    case 'bullets':
      return b.items.reduce((n, it) => n + it.text.length, 0);
    case 'table':
      return b.rows.reduce((n, r) => n + Object.values(r).reduce<number>((m, v) => m + String(v ?? '').length, 0), 0);
    case 'chart':
      return b.series.reduce((n, s) => n + s.points.length * 8, 0);
    default:
      return 0;
  }
}

export function validateDocModel(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isObj(input)) return { ok: false, issues: [{ path: '$', message: 'model must be an object' }] };
  const m = input as Partial<DocModel> & Record<string, unknown>;

  if (m.schema !== DOC_SCHEMA) add('schema', `must be "${DOC_SCHEMA}"`);
  // Cover "Attention" line (A4 LOW): plain text, one line, at most ATTENTION_MAX_CHARS after trimming.
  const attention = (m.meta as { attention?: unknown } | undefined)?.attention;
  if (attention !== undefined) {
    if (typeof attention !== 'string') add('meta.attention', 'must be a string');
    else if (/[\u0000-\u001f\u007f]/.test(attention)) add('meta.attention', 'must be a single line of plain text');
    else if (attention.trim().length > ATTENTION_MAX_CHARS) add('meta.attention', `longer than ${ATTENTION_MAX_CHARS} chars`);
  }
  if (!str(m.title)) add('title', 'required');
  else if (m.title.length > DOC_LIMITS.maxTitleChars) add('title', `longer than ${DOC_LIMITS.maxTitleChars} chars`);
  if (m.subtitle !== undefined && typeof m.subtitle !== 'string') add('subtitle', 'must be a string');
  if (m.preparedFor !== undefined && typeof m.preparedFor !== 'string') add('preparedFor', 'must be a string');
  if (!str(m.date) || !ISO_DATE.test(m.date)) add('date', 'must be YYYY-MM-DD');

  // Sources
  const sourceIds = new Set<string>();
  if (!Array.isArray(m.sources)) add('sources', 'must be an array');
  else {
    if (m.sources.length > DOC_LIMITS.maxSources) add('sources', `more than ${DOC_LIMITS.maxSources}`);
    m.sources.forEach((s, i) => {
      const p = `sources[${i}]`;
      if (!isObj(s)) return add(p, 'must be an object');
      if (!str(s.id)) add(`${p}.id`, 'required');
      else if (sourceIds.has(s.id)) add(`${p}.id`, `duplicate source id "${s.id}"`);
      else sourceIds.add(s.id);
      if (!str(s.label)) add(`${p}.label`, 'required');
      if (!SOURCE_KINDS.has(String(s.kind))) add(`${p}.kind`, `unknown source kind "${String(s.kind)}"; allowed values: ${SOURCE_KIND_VALUES.join(', ')}`);
      if (s.url !== undefined && (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url))) add(`${p}.url`, 'must be an http(s) URL');
    });
  }

  // Sections and blocks
  const ids = new Set<string>();
  let blockCount = 0;
  let chars = 0;
  if (!Array.isArray(m.sections) || m.sections.length === 0) add('sections', 'at least one section is required');
  else {
    if (m.sections.length > DOC_LIMITS.maxSections) add('sections', `more than ${DOC_LIMITS.maxSections}`);
    m.sections.forEach((sec, si) => {
      const sp = `sections[${si}]`;
      if (!isObj(sec)) return add(sp, 'must be an object');
      if (!str(sec.id)) add(`${sp}.id`, 'required');
      else if (ids.has(sec.id)) add(`${sp}.id`, `duplicate id "${sec.id}"`);
      else ids.add(sec.id);
      if (!str(sec.heading)) add(`${sp}.heading`, 'required');
      if (sec.level !== undefined && ![1, 2, 3].includes(sec.level as number)) add(`${sp}.level`, 'must be 1, 2 or 3');
      if (sec.role !== undefined && sec.role !== 'body' && sec.role !== 'about') add(`${sp}.role`, "must be 'body' or 'about'");
      const isAbout = sec.role === 'about';
      const contextBlocks = Array.isArray(sec.blocks) ? sec.blocks.filter((b) => isObj(b) && (b as { claim?: unknown }).claim === 'context').length : 0;
      if (contextBlocks > ABOUT_MAX_CONTEXT_BLOCKS) add(`${sp}.blocks`, `at most ${ABOUT_MAX_CONTEXT_BLOCKS} context blocks per section; move content into a cited section`);
      if (!Array.isArray(sec.blocks)) return add(`${sp}.blocks`, 'must be an array');
      sec.blocks.forEach((b, bi) => {
        const bp = `${sp}.blocks[${bi}]`;
        blockCount++;
        if (!isObj(b) || !BLOCK_TYPES.has(String((b as { type?: unknown }).type))) return add(bp, 'unknown block type');
        const blk = b as Block;
        if (!str(blk.id)) add(`${bp}.id`, 'required');
        else if (ids.has(blk.id)) add(`${bp}.id`, `duplicate id "${blk.id}"`);
        else ids.add(blk.id);

        switch (blk.type) {
          case 'paragraph':
          case 'callout':
            if (!str(blk.text)) add(`${bp}.text`, 'required');
            if (blk.type === 'callout' && !['note', 'warning', 'key_finding'].includes(blk.tone)) add(`${bp}.tone`, 'unknown tone');
            break;
          case 'bullets':
            if (!Array.isArray(blk.items) || blk.items.length === 0) add(`${bp}.items`, 'at least one item');
            else blk.items.forEach((it, ii) => { if (!isObj(it) || !str(it.text)) add(`${bp}.items[${ii}].text`, 'required'); });
            break;
          case 'table': {
            if (!Array.isArray(blk.columns) || blk.columns.length === 0) { add(`${bp}.columns`, 'at least one column'); break; }
            if (blk.columns.length > DOC_LIMITS.maxTableColumns) add(`${bp}.columns`, `more than ${DOC_LIMITS.maxTableColumns}`);
            const keys = new Set<string>();
            blk.columns.forEach((c, ci) => {
              if (!isObj(c) || !str(c.key) || !str(c.label)) add(`${bp}.columns[${ci}]`, 'key and label required');
              else if (keys.has(c.key)) add(`${bp}.columns[${ci}].key`, `duplicate key "${c.key}"`);
              else keys.add(c.key);
            });
            if (!Array.isArray(blk.rows)) { add(`${bp}.rows`, 'must be an array'); break; }
            if (blk.rows.length > DOC_LIMITS.maxTableRows) add(`${bp}.rows`, `more than ${DOC_LIMITS.maxTableRows}`);
            blk.rows.forEach((r, ri) => {
              if (!isObj(r)) return add(`${bp}.rows[${ri}]`, 'must be an object');
              for (const [k, v] of Object.entries(r)) {
                if (!keys.has(k)) add(`${bp}.rows[${ri}].${k}`, 'not a declared column');
                if (v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) add(`${bp}.rows[${ri}].${k}`, 'must be a string, a finite number or null');
              }
            });
            break;
          }
          case 'chart':
            if (!['bar', 'line', 'pie'].includes(blk.kind)) add(`${bp}.kind`, 'unknown chart kind');
            for (const k of ['xLabel', 'yLabel'] as const) {
              const v = (blk as unknown as Record<string, unknown>)[k];
              if (v !== undefined && (typeof v !== 'string' || v.length > 80)) add(`${bp}.${k}`, 'must be a string of at most 80 chars');
            }
            if (!Array.isArray(blk.series) || blk.series.length === 0) { add(`${bp}.series`, 'at least one series'); break; }
            if (blk.series.length > DOC_LIMITS.maxChartSeries) add(`${bp}.series`, `more than ${DOC_LIMITS.maxChartSeries}`);
            if (blk.kind === 'pie' && blk.series.length !== 1) add(`${bp}.series`, 'a pie chart has exactly one series');
            blk.series.forEach((s, ssi) => {
              if (!isObj(s) || !str(s.name) || !Array.isArray(s.points) || s.points.length === 0) return add(`${bp}.series[${ssi}]`, 'name and points required');
              if (s.points.length > DOC_LIMITS.maxChartPoints) add(`${bp}.series[${ssi}].points`, `more than ${DOC_LIMITS.maxChartPoints}`);
              s.points.forEach((pt, pi) => {
                if (!isObj(pt) || typeof pt.x !== 'string' || typeof pt.y !== 'number' || !Number.isFinite(pt.y)) add(`${bp}.series[${ssi}].points[${pi}]`, 'x must be a string and y a finite number');
                else if (blk.kind === 'pie' && pt.y < 0) add(`${bp}.series[${ssi}].points[${pi}]`, 'pie values cannot be negative');
              });
            });
            break;
          default:
            break;
        }

        // Claim labels and the facts-must-cite rule.
        for (const u of labeledUnits(blk)) {
          if (u.claim === undefined) add(`${bp}`, `a claim label is required (fact, assumption, recommendation, unverified or context) at ${u.where}`);
          else if (!CLAIMS.has(u.claim)) add(`${bp}`, `unknown claim "${String(u.claim)}" at ${u.where}${String(u.claim) === 'estimate' ? ' — there is no estimate label; use assumption, or cite a source' : ''}`);
          if (u.critical !== undefined && typeof u.critical !== 'boolean') add(`${bp}`, `critical must be a boolean at ${u.where}`);
          if (u.claim === 'context') {
            if (!isAbout) add(`${bp}`, `context is allowed only in a section with role 'about' (how to read, method, limitations) (${u.where}); in this section label it fact and cite a source`);
            if (/\d/.test(u.text) || NUMBER_WORD.test(u.text) || blk.type === 'table' || blk.type === 'chart') add(`${bp}`, `context may not contain numbers (in digits or words), tables or charts (${u.where}); label it fact and cite a source`);
            if (CONTEXT_FORBIDDEN.test(u.text)) add(`${bp}`, `context may not name a company, an incumbent or award, eligibility or set-aside terms, or a date (${u.where}); that is a claim: label it fact and cite a source`);
            if (u.text.length > CONTEXT_MAX_CHARS) add(`${bp}`, `context is limited to ${CONTEXT_MAX_CHARS} characters (${u.where})`);
          }
          if (u.claim === 'unverified' && u.critical === true) add(`${bp}`, `a decision-critical statement cannot be unverified (${u.where}); cite a source or omit it`);
          // "Unverified — no source" next to a [n] citation contradicts itself, and the cited source would
          // still be listed under Sources as if it supported the statement.
          if (u.claim === 'unverified' && Array.isArray(u.cites) && u.cites.length) add(`${bp}`, `an unverified statement carries no cites (${u.where}); if the source supports it, label it fact`);
          if (labelNeedsSource(u.claim, u.text) && (u.cites ?? []).filter((c) => sourceIds.has(c)).length === 0) {
            add(`${bp}`, u.claim === 'assumption'
              ? `an assumption may state a planning figure, but a factual claim (an award, obligation, ceiling, incumbent, date, or a count of buyers, vendors or contracts) must cite its source (${u.where})`
              : `a recommendation that states a count or amount must cite its source (${u.where})`);
          }
          if (citedObservationAsAssumption(u, sourceIds)) {
            add(`${bp}`, `a cited measurement of the market is a fact, not an assumption (${u.where}); label it fact (an assumption about the market projects from the evidence)`);
          }
          if (u.claim === 'assumption' && neverAnAssumption(u.text)) {
            add(`${bp}`, `certifications, contract awards, past performance and eligibility/set-aside status can never be an assumption (${u.where}); label it fact and cite a source, or omit it`);
          }
          if (u.origin !== undefined) {
            if (u.claim !== 'assumption') add(`${bp}`, `origin applies only to an assumption (${u.where})`);
            else if (typeof u.origin !== 'string' || !u.origin.trim()) add(`${bp}`, `origin must be a non-empty string (${u.where})`);
            else if (u.origin.length > ORIGIN_MAX_CHARS) add(`${bp}`, `origin is limited to ${ORIGIN_MAX_CHARS} characters (${u.where})`);
          }
          if (u.claim === 'assumption' && (u.cites ?? []).filter((c) => sourceIds.has(c)).length === 0 && !(typeof u.origin === 'string' && u.origin.trim())) {
            add(`${bp}`, `an uncited assumption must state its origin (${u.where}), e.g. "This analysis models these figures; they were not verified against the customer's records."`);
          }
          if (u.cites !== undefined && !Array.isArray(u.cites)) { add(`${bp}`, `cites must be an array at ${u.where}`); continue; }
          const cites = u.cites ?? [];
          const unresolved = cites.filter((c) => !sourceIds.has(c));
          if (unresolved.length) add(`${bp}`, `cites unknown source(s) ${unresolved.join(', ')} at ${u.where}`);
          if (u.claim === 'fact' && cites.length - unresolved.length === 0) add(`${bp}`, `a fact must cite at least one source (${u.where})`);
        }
        if (isObj(b) && BLOCK_TYPES.has(String(blk.type))) chars += blockChars(blk);
      });
    });
  }
  if (blockCount > DOC_LIMITS.maxBlocks) add('sections', `more than ${DOC_LIMITS.maxBlocks} blocks`);
  if (chars > DOC_LIMITS.maxTotalChars) add('sections', `more than ${DOC_LIMITS.maxTotalChars} characters of content`);

  return issues.length ? { ok: false, issues } : { ok: true, model: input as unknown as DocModel };
}

export interface DemotionResult {
  model: DocModel;
  /** Relabeled `unverified` (still in the document, listed in "Unverified statements"). */
  unverified: string[];
  /** Removed: decision-critical statements with no resolvable source. */
  omitted: string[];
  /**
   * Cite ids with no source behind them, removed from the unit at `where` (whatever else happened to
   * it). A non-empty list means the producer referenced sources it never supplied: surface it, don't
   * treat the repaired document as a clean one.
   */
  droppedCites: Array<{ where: string; ids: string[] }>;
}

export interface StructureRepairResult {
  model: DocModel;
  /** Human-readable notes for diagnostics (never customer-facing). */
  changes: string[];
}

function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim();
  if (!s) return 'Value';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function uniqueId(base: string, used: Set<string>, fallback: string): string {
  const root = (typeof base === 'string' && base.trim() ? base.trim() : fallback).slice(0, 80);
  let id = root;
  let n = 2;
  while (used.has(id)) {
    id = `${root}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Repair structural DocModel problems that LLMs hit on long comprehensive reports and that cannot
 * be fixed in a second tool call on the same turn: duplicate ids, empty table columns when rows
 * already carry keys, and column entries missing key/label.
 *
 * Does NOT invent facts, dollars, or claim labels — only shape. Call before demoteUncitedFacts.
 */
export function repairDocModelStructure(model: DocModel): StructureRepairResult {
  const changes: string[] = [];
  const usedIds = new Set<string>();

  const sources = Array.isArray(model.sources)
    ? model.sources.map((src, i) => {
        if (!src || typeof src !== 'object') return src;
        const nextId = uniqueId(String(src.id ?? ''), usedIds, `src-${i + 1}`);
        if (nextId !== src.id) changes.push(`source id "${String(src.id)}" → "${nextId}"`);
        return nextId === src.id ? src : { ...src, id: nextId };
      })
    : model.sources;

  const sections = Array.isArray(model.sections)
    ? model.sections.map((sec, si) => {
        if (!sec || typeof sec !== 'object') return sec;
        const secId = uniqueId(String(sec.id ?? ''), usedIds, `sec-${si + 1}`);
        if (secId !== sec.id) changes.push(`section id "${String(sec.id)}" → "${secId}"`);
        const blocks = Array.isArray(sec.blocks)
          ? sec.blocks.map((blk, bi) => {
              if (!blk || typeof blk !== 'object') return blk;
              const blkId = uniqueId(String(blk.id ?? ''), usedIds, `${secId}-b${bi + 1}`);
              if (blkId !== blk.id) changes.push(`block id "${String(blk.id)}" → "${blkId}"`);
              if (blk.type !== 'table') return blkId === blk.id ? blk : { ...blk, id: blkId };

              const rows = Array.isArray(blk.rows) ? blk.rows : [];
              let columns = Array.isArray(blk.columns) ? [...blk.columns] : [];
              const colKeys = new Set<string>();
              const fixedCols: typeof columns = [];
              for (let ci = 0; ci < columns.length; ci++) {
                const c = columns[ci];
                if (!c || typeof c !== 'object') continue;
                let key = typeof c.key === 'string' ? c.key.trim() : '';
                let label = typeof c.label === 'string' ? c.label.trim() : '';
                if (!key && label) key = label.toLowerCase().replace(/\s+/g, '_').slice(0, 40);
                if (!key) key = `col_${ci + 1}`;
                if (colKeys.has(key)) {
                  let n = 2;
                  let k2 = `${key}_${n}`;
                  while (colKeys.has(k2)) { n += 1; k2 = `${key}_${n}`; }
                  changes.push(`table ${blkId}: duplicate column key "${key}" → "${k2}"`);
                  key = k2;
                }
                colKeys.add(key);
                if (!label) {
                  label = humanizeKey(key);
                  changes.push(`table ${blkId}: filled missing label for column "${key}"`);
                }
                fixedCols.push({ ...c, key, label });
              }
              // Infer columns from row keys when the model supplied rows but forgot columns
              // (live create_document failure: "at least one column").
              if (fixedCols.length === 0 && rows.length > 0) {
                const inferred: string[] = [];
                for (const r of rows) {
                  if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
                  for (const k of Object.keys(r)) {
                    if (!inferred.includes(k)) inferred.push(k);
                  }
                }
                for (const k of inferred) {
                  fixedCols.push({ key: k, label: humanizeKey(k) });
                  colKeys.add(k);
                }
                if (fixedCols.length) changes.push(`table ${blkId}: inferred ${fixedCols.length} column(s) from row keys`);
              } else {
                // Expand columns for undeclared row keys (validator: "not a declared column").
                for (const r of rows) {
                  if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
                  for (const k of Object.keys(r)) {
                    if (colKeys.has(k)) continue;
                    colKeys.add(k);
                    fixedCols.push({ key: k, label: humanizeKey(k) });
                    changes.push(`table ${blkId}: added column "${k}" from row data`);
                  }
                }
              }
              columns = fixedCols;
              return { ...blk, id: blkId, columns, rows };
            })
          : sec.blocks;
        return { ...sec, id: secId, blocks };
      })
    : model.sections;

  return { model: { ...model, sources, sections }, changes };
}

/**
 * Repair everything the citation rules would refuse — uncited facts, unlabeled units, uncited
 * figures in recommendations/assumptions, misplaced context, critical+unverified: decision-critical
 * ones are OMITTED, the rest are relabeled `unverified`. Never relabels anything as an estimate or assumption —
 * an assumption is a premise the author states on purpose, not a demoted fact. A bullets block whose
 * items are all omitted is removed; a section can end up empty and keeps its heading.
 */
export function demoteUncitedFacts(model: DocModel): DemotionResult {
  const ids = new Set(model.sources.map((s) => s.id));
  const unverified: string[] = [];
  const omitted: string[] = [];
  const droppedCites: Array<{ where: string; ids: string[] }> = [];
  type Unit = { claim?: string; cites?: string[]; critical?: boolean; text?: string; caption?: string; origin?: string };
  // Returns the repaired unit, or null when it must be omitted. A unit is held to the
  // facts-must-cite rule when it is a fact, unlabeled, a recommendation stating a figure, an
  // assumption asserting a factual claim (assumptionAssertsFact), or `context` the validator would refuse (outside an 'about' section, or with a number).
  const withoutCites = <T extends Unit>(x: T): T => { const { cites: _dropped, ...rest } = x; return rest as T; };
  const fix = <T extends Unit>(input: T, where: string, about: boolean, isTableOrChart: boolean): T | null => {
    // A cite id with no source behind it is not evidence. Drop it so the repaired model validates
    // (a hallucinated "s9" used to survive demotion and make the result fail validation).
    const all = Array.isArray(input.cites) ? input.cites : [];
    const resolved = all.filter((c) => ids.has(c));
    if (resolved.length !== all.length) droppedCites.push({ where, ids: all.filter((c) => !ids.has(c)) });
    const u: T = resolved.length === all.length ? input : resolved.length ? { ...input, cites: resolved } : withoutCites(input);
    const text = u.text ?? u.caption ?? '';
    const cited = resolved.length > 0;
    // Never an assumption: cited or not, it is omitted — never relabeled a fact (assumptions do not
    // harden) and never shown as unverified (these topics cite or are left out).
    if (u.claim === 'assumption' && neverAnAssumption(text)) { omitted.push(where); return null; }
    // Mislabeled cited observation: OMITTED, never relabeled — an assumption never becomes a fact
    // (Eric's rule 3; hardenedAssumptions would refuse that on a revision). The producer's retry is
    // where it gets relabeled fact, before demotion runs.
    if (citedObservationAsAssumption({ claim: u.claim, cites: u.cites, text }, ids)) { omitted.push(where); return null; }
    const mustCite =
      u.claim === 'fact' || u.claim === undefined ||
      labelNeedsSource(u.claim, text) ||
      (u.claim === 'context' && (!about || isTableOrChart || /\d/.test(text) || NUMBER_WORD.test(text) || CONTEXT_FORBIDDEN.test(text) || text.length > CONTEXT_MAX_CHARS)) ||
      (u.claim === 'unverified' && u.critical === true);
    // An explicitly unverified (non-critical) statement keeps the producer's own doubt; only its cites go.
    if (!mustCite) {
      if (u.claim === 'unverified') return withoutCites(u);
      // An uncited planning assumption must say where it comes from; supply the honest default.
      if (u.claim === 'assumption' && !cited && !(typeof u.origin === 'string' && u.origin.trim())) return { ...u, origin: DEFAULT_ASSUMPTION_ORIGIN };
      return u;
    }
    if (cited) return u.claim === undefined || u.claim === 'context' || u.claim === 'unverified' ? { ...u, claim: 'fact' } : u;
    if (u.critical === true) { omitted.push(where); return null; }
    unverified.push(where);
    const { origin: _origin, ...rest } = withoutCites(u);
    return { ...rest, claim: 'unverified' } as T;
  };
  const sections = model.sections.map((sec) => ({
    ...sec,
    blocks: sec.blocks.flatMap((b): Block[] => {
      const about = sec.role === 'about';
      if (b.type === 'pagebreak') return [b];
      if (b.type === 'bullets') {
        const items = b.items.map((it, i) => fix(it, `${b.id}[${i}]`, about, false)).filter((it): it is NonNullable<typeof it> => it !== null);
        return items.length ? [{ ...b, items }] : [];
      }
      const fixed = fix(b as Block & Unit, b.id, about, b.type === 'table' || b.type === 'chart');
      return fixed ? [fixed as Block] : [];
    }),
  }));
  return { model: { ...model, sections }, unverified, omitted, droppedCites };
}

/**
 * Test-fixture content must never reach a customer document. The fixture marks itself
 * (meta.generatedBy 'fixture', "(fixture)" labels) and every reserved example domain (RFC 2606:
 * example.com/.net/.org) is a test-only address. Production entry points refuse a model carrying
 * any of these (the render route; the generate tool will call the same predicate).
 */
export function fixtureMarkers(model: unknown): string[] {
  const found: string[] = [];
  const m = model as { meta?: { generatedBy?: unknown }; title?: unknown; sources?: Array<{ url?: unknown; label?: unknown }> };
  if (m?.meta?.generatedBy === 'fixture') found.push('meta.generatedBy is "fixture"');
  if (typeof m?.title === 'string' && /\(fixture\)/i.test(m.title)) found.push('title is marked (fixture)');
  for (const src of Array.isArray(m?.sources) ? m.sources : []) {
    if (typeof src?.url === 'string' && /^https?:\/\/(?:[\w-]+\.)*example\.(?:com|net|org)(?:[/:?#]|$)/i.test(src.url)) found.push(`source url ${src.url}`);
    if (typeof src?.label === 'string' && /\(fixture\)/i.test(src.label)) found.push(`source "${src.label}"`);
  }
  return found;
}
