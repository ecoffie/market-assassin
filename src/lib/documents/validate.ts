/**
 * Validate a DocModel before it is stored or rendered.
 *
 * The rules a renderer relies on are enforced HERE, never trusted to whatever produced the model
 * (an LLM, a feature adapter, a client):
 *   - structure: known block types, unique ids, required fields, size limits;
 *   - FACTS MUST CITE: a block labeled `fact` needs at least one cite, and every cite must resolve to
 *     a source in `sources`. A fact with no resolvable cite is an error, not a warning — an uncited
 *     "fact" in a client-facing PDF is exactly the claim Mindy cannot defend;
 *   - numbers: table/chart values must be finite; a missing value is null ("Not available"), never 0.
 *
 * `demoteUncitedFacts` is the one sanctioned repair: it relabels an uncited fact as an estimate (which
 * renders with a visible "Estimate" label) instead of dropping content.
 */
import { DOC_LIMITS, DOC_SCHEMA, labeledUnits, type Block, type DocModel } from './model';

export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { ok: true; model: DocModel } | { ok: false; issues: ValidationIssue[] };

const BLOCK_TYPES = new Set(['paragraph', 'bullets', 'table', 'chart', 'callout', 'pagebreak']);
const CLAIMS = new Set(['fact', 'estimate', 'recommendation']);
const SOURCE_KINDS = new Set(['sam_notice', 'usaspending', 'upload', 'vault', 'tool', 'web', 'other']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
          if (u.claim !== undefined && !CLAIMS.has(u.claim)) add(`${bp}`, `unknown claim "${String(u.claim)}" at ${u.where}`);
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

/**
 * Relabel every `fact` that has no resolvable cite as an `estimate`. Returns a new model and the
 * locations changed. Content is never dropped; it just stops claiming to be a sourced fact.
 */
export function demoteUncitedFacts(model: DocModel): { model: DocModel; demoted: string[] } {
  const ids = new Set(model.sources.map((s) => s.id));
  const demoted: string[] = [];
  const fix = <T extends { claim?: string; cites?: string[] }>(u: T, where: string): T => {
    if (u.claim !== 'fact') return u;
    if ((u.cites ?? []).some((c) => ids.has(c))) return u;
    demoted.push(where);
    return { ...u, claim: 'estimate' };
  };
  const sections = model.sections.map((sec) => ({
    ...sec,
    blocks: sec.blocks.map((b): Block => {
      if (b.type === 'bullets') return { ...b, items: b.items.map((it, i) => fix(it, `${b.id}[${i}]`)) };
      if (b.type === 'pagebreak') return b;
      return fix(b, b.id);
    }),
  }));
  return { model: { ...model, sections }, demoted };
}
