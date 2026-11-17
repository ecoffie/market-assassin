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
 *     but one asserting a factual claim about the world must cite (assumptionAssertsFact);
 *   - numbers: table/chart values must be finite; a missing value is null ("Not available"), never 0.
 *
 * `demoteUncitedFacts` is the one sanctioned repair (Eric's rule: verified, ASSUMPTION, or omitted —
 * never "estimate"): an uncited decision-critical statement is OMITTED; any other uncited statement
 * is relabeled `unverified`, which renders "Unverified — no source" and is listed in its own section.
 * Ask Mindy retries sourcing first and only then calls this.
 */
import { DOC_LIMITS, DOC_SCHEMA, labeledUnits, type Block, type DocModel } from './model';
import agencyAliases from '@/data/agency-aliases.json';

export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { ok: true; model: DocModel } | { ok: false; issues: ValidationIssue[] };

const BLOCK_TYPES = new Set(['paragraph', 'bullets', 'table', 'chart', 'callout', 'pagebreak']);
const CLAIMS = new Set(['fact', 'assumption', 'recommendation', 'unverified', 'context']);
const SOURCE_KINDS = new Set(['sam_notice', 'usaspending', 'upload', 'vault', 'tool', 'web', 'other']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
      if (!SOURCE_KINDS.has(String(s.kind))) add(`${p}.kind`, 'unknown source kind');
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
  type Unit = { claim?: string; cites?: string[]; critical?: boolean; text?: string; caption?: string };
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
    const mustCite =
      u.claim === 'fact' || u.claim === undefined ||
      labelNeedsSource(u.claim, text) ||
      (u.claim === 'context' && (!about || isTableOrChart || /\d/.test(text) || NUMBER_WORD.test(text) || CONTEXT_FORBIDDEN.test(text) || text.length > CONTEXT_MAX_CHARS)) ||
      (u.claim === 'unverified' && u.critical === true);
    // An explicitly unverified (non-critical) statement keeps the producer's own doubt; only its cites go.
    if (!mustCite) return u.claim === 'unverified' ? withoutCites(u) : u;
    if (cited) return u.claim === undefined || u.claim === 'context' || u.claim === 'unverified' ? { ...u, claim: 'fact' } : u;
    if (u.critical === true) { omitted.push(where); return null; }
    unverified.push(where);
    return { ...withoutCites(u), claim: 'unverified' };
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
