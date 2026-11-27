/**
 * Capability statement layout (Eric, 2026-11-27: "good information but bad formatting"). A capability statement
 * is a ONE-PAGE leave-behind a contracting officer reads in under a minute, not a report: no cover page, no
 * "How to read this", no numbered Sources list on its face.
 *
 *   header band: company name + one-line value statement (the model's subtitle)
 *   left column:  Core Competencies · Past Performance · Differentiators (· any other body section, trimmed first)
 *   right column: a shaded Company Data box (UEI, CAGE, NAICS, PSC, certifications, vehicles) and Point of Contact
 *   footer:       one small provenance line ("Company data from the SAM.gov registration.")
 *
 * Selected by `model.kind === 'capability_statement'` (create_document passes it) or, as a fallback, a title that
 * says "capability statement". The DocModel is unchanged: sections are recognised by their headings, sources and
 * claim labels stay in the stored model. On the face:
 *   - a Company Data or contact line appears ONLY when it cites a declared source (never an unsourced UEI, CAGE,
 *     certification or set-aside);
 *   - an item labeled unverified is left off the page (and logged), never shown as a company claim;
 *   - no citation markers, no em dashes, no dates (renderers run clientCopy first).
 * It must fit one page: extractCapability takes item limits, and renderPdf tightens them until the PDF is one page,
 * logging what was trimmed. Shared by the PDF/HTML renderer (render-html.ts) and Word (render-docx.ts).
 */
import type { Block, DocModel, DocSection } from './model';
import { labeledUnits } from './model';

export const CAPABILITY_STATEMENT_KIND = 'capability_statement' as const;
/** What the customer fills in when no completed project is on record (coaching itself stays in the chat answer). */
export const PAST_PERFORMANCE_PLACEHOLDER = '[Add a completed project: agency or client, the work, and the value]';

export function isCapabilityStatement(model: Pick<DocModel, 'title'> & { kind?: unknown }): boolean {
  if (model.kind === CAPABILITY_STATEMENT_KIND) return true;
  return /\bcapabilit(?:y|ies)\s+statement\b/i.test(String(model.title || ''));
}

export type CapRole = 'overview' | 'competencies' | 'past_performance' | 'differentiators' | 'company_data' | 'contact' | 'skip' | 'other';

/** A section's place on the page, from its heading. */
export function capRole(heading: string): CapRole {
  const h = heading.toLowerCase();
  // Report furniture never printed on a capability statement (sources stay in the stored model).
  if (/\bsources?\b|\bcitations?\b|\bhow to read\b|\bmethod(?:ology)?\b|\bcoverage\b|\bnotes? for\b/.test(h)) return 'skip';
  if (/\b(?:company\s+)?overview\b|\babout\b|\bwho we are\b|\bsummary\b|\bintroduction\b/.test(h)) return 'overview';
  if (/\b(?:core\s+)?competenc|\bcapabilities\b|\bwhat we do\b|\bservices\b/.test(h)) return 'competencies';
  if (/\bpast\s+performance\b|\bexperience\b|\bcontracts?\s+(?:won|held|history)\b|\bselected\s+projects?\b/.test(h)) return 'past_performance';
  if (/\bdifferentiat|\bwhy\s+(?:us|choose)\b|\bwhat\s+sets\b/.test(h)) return 'differentiators';
  if (/\bpoint\s+of\s+contact\b|\bcontact\b/.test(h)) return 'contact';
  if (/\bcompany\s+(?:data|information|snapshot|facts|profile)\b|\bcorporate\s+(?:data|information)\b|\bcodes?\b|\bcertifications?\b/.test(h)) return 'company_data';
  return 'other';
}

export interface CapLimits { competencies: number; pastPerformance: number; differentiators: number; other: number; itemChars: number }
/** Tightening steps for the one-page rule (renderPdf walks them until the PDF is one page). */
export const CAP_LIMIT_STEPS: CapLimits[] = [
  { competencies: 8, pastPerformance: 4, differentiators: 5, other: 3, itemChars: 260 },
  { competencies: 7, pastPerformance: 3, differentiators: 4, other: 2, itemChars: 200 },
  { competencies: 6, pastPerformance: 3, differentiators: 3, other: 0, itemChars: 170 },
  { competencies: 5, pastPerformance: 2, differentiators: 3, other: 0, itemChars: 140 },
];

export interface CapEntry { lead?: string; text: string }
export interface CapField { label: string; value: string }
export interface Capability {
  name: string;
  tagline: string | null;
  competencies: CapEntry[];
  pastPerformance: CapEntry[];
  differentiators: CapEntry[];
  /** One or two short sentences under the header band, from an overview section. */
  overview: string[];
  other: Array<{ heading: string; items: CapEntry[] }>;
  companyData: CapField[];
  contact: CapField[];
  footer: string | null;
  /** What did not fit or was left off the face, for the log. */
  trimmed: string[];
}

/** "Acme Corp Capability Statement" / "Capability Statement: Acme Corp" -> "Acme Corp". */
export function companyName(title: string): string {
  const t = title
    .replace(/^\s*capabilit(?:y|ies)\s+statement\s*[:|,-]?\s*/i, '')
    .replace(/\s*[:|,-]?\s*(?:federal\s+)?capabilit(?:y|ies)\s+statement\s*$/i, '')
    .trim();
  return t || title.trim();
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

/** Every readable unit of a section: paragraphs, bullet items, and table rows ("Col: val" / lead + rest). */
function units(sec: DocSection, resolved: (cites?: string[]) => boolean): Array<CapEntry & { sourced: boolean; unverified: boolean }> {
  const out: Array<CapEntry & { sourced: boolean; unverified: boolean }> = [];
  for (const b of sec.blocks as Block[]) {
    if (b.type === 'table') {
      const sourced = resolved(b.cites);
      for (const r of b.rows) {
        const cells = b.columns.map((c) => ({ label: c.label, v: r[c.key] })).filter((x) => x.v !== null && x.v !== undefined && String(x.v).trim() !== '');
        if (!cells.length) continue;
        out.push({ lead: String(cells[0].v), text: cells.slice(1).map((x) => String(x.v)).join(' · '), sourced, unverified: b.claim === 'unverified' });
      }
      continue;
    }
    for (const u of labeledUnits(b)) {
      if (!u.text.trim()) continue;
      out.push({ text: u.text.trim(), sourced: resolved(u.cites), unverified: u.claim === 'unverified' });
    }
  }
  return out;
}

/** "UEI: ABC123DEF456" -> { UEI, ABC123DEF456 }; a two-column table row -> { lead, text }. */
function field(e: CapEntry): CapField | null {
  if (e.lead && e.text) return { label: e.lead, value: e.text };
  const m = /^\s*\**([^:*]{2,40}?)\**\s*:\s*(.+)$/.exec(e.text);
  return m ? { label: m[1].trim(), value: m[2].trim() } : null;
}

const DATA_ORDER = [/\buei\b/i, /\bcage\b/i, /\bnaics\b/i, /\bpsc\b/i, /certif|set[- ]aside|socio/i, /vehicle|schedule|gwac|idiq|bpa/i];
const dataRank = (label: string) => { const i = DATA_ORDER.findIndex((re) => re.test(label)); return i < 0 ? DATA_ORDER.length : i; };

export function extractCapability(model: DocModel, limits: CapLimits = CAP_LIMIT_STEPS[0]): Capability {
  const ids = new Set(model.sources.map((s) => s.id));
  const resolved = (cites?: string[]) => Array.isArray(cites) && cites.some((c) => ids.has(c));
  const trimmed: string[] = [];
  const cap: Capability = {
    name: companyName(model.title), tagline: model.subtitle?.trim() || null,
    overview: [], competencies: [], pastPerformance: [], differentiators: [], other: [], companyData: [], contact: [], footer: null, trimmed,
  };
  const dataSources = new Set<string>();
  for (const sec of model.sections) {
    if (sec.role === 'about') continue; // method / how-to-read text is not printed on a capability statement
    const role = capRole(sec.heading);
    if (role === 'skip') continue;
    // Coaching ("add your first completed project...") belongs in the chat answer, never on the page: callouts are
    // left off; Past Performance then carries a clean [bracketed] placeholder for the customer to fill.
    const coached = sec.blocks.some((b) => b.type === 'callout');
    if (coached) trimmed.push(`${sec.heading}: coaching note left off the page`);
    const all = units({ ...sec, blocks: sec.blocks.filter((b) => b.type !== 'callout') }, resolved);
    const kept = all.filter((u) => {
      if (u.unverified) { trimmed.push(`unverified, left off: ${clip(u.text || u.lead || '', 60)}`); return false; }
      return true;
    });
    if (role === 'company_data' || role === 'contact') {
      for (const u of kept) {
        // A contact line may be plain ("Jordan Example, President"): one item per line, no label.
        const f = field(u) ?? (role === 'contact' ? { label: '', value: u.text } : null);
        if (!f) continue;
        // A company fact on the face must cite a source: an unsourced UEI, certification or set-aside is never shown.
        if (!u.sourced) { trimmed.push(`unsourced ${role === 'contact' ? 'contact' : 'company data'}, left off: ${f.label || clip(f.value, 40)}`); continue; }
        (role === 'contact' ? cap.contact : cap.companyData).push({ label: f.label, value: clip(f.value, 160) });
      }
      for (const b of sec.blocks) for (const u of labeledUnits(b)) for (const c of u.cites ?? []) if (ids.has(c)) dataSources.add(c);
      for (const b of sec.blocks) if (b.type === 'table') for (const c of b.cites ?? []) if (ids.has(c)) dataSources.add(c);
      continue;
    }
    const entries = kept.map((u) => ({ lead: u.lead, text: clip(u.text, limits.itemChars) }));
    const take = (list: CapEntry[], max: number, label: string) => {
      if (entries.length > max) trimmed.push(`${label}: kept ${max} of ${entries.length}`);
      list.push(...entries.slice(0, Math.max(0, max - list.length)));
    };
    if (role === 'overview') { cap.overview.push(...entries.slice(0, 1).map((e) => clip(e.lead ? `${e.lead} ${e.text}` : e.text, Math.min(320, limits.itemChars + 80)))); if (entries.length > 1) trimmed.push(`${sec.heading}: kept the first paragraph`); }
    else if (role === 'competencies') take(cap.competencies, limits.competencies, 'core competencies');
    else if (role === 'past_performance') take(cap.pastPerformance, limits.pastPerformance, 'past performance');
    else if (role === 'differentiators') take(cap.differentiators, limits.differentiators, 'differentiators');
    else if (limits.other > 0 && entries.length) {
      if (entries.length > limits.other) trimmed.push(`${sec.heading}: kept ${limits.other} of ${entries.length}`);
      cap.other.push({ heading: sec.heading, items: entries.slice(0, limits.other) });
    } else if (entries.length) trimmed.push(`${sec.heading}: left off to fit one page`);
  }
  if (!cap.pastPerformance.length || model.sections.some((s) => capRole(s.heading) === 'past_performance' && s.blocks.some((b) => b.type === 'callout'))) {
    cap.pastPerformance.push({ text: PAST_PERFORMANCE_PLACEHOLDER });
  }
  cap.companyData.sort((a, b) => dataRank(a.label) - dataRank(b.label));
  const srcs = model.sources.filter((s) => dataSources.has(s.id));
  const sam = srcs.some((s) => /sam\.gov/i.test(s.url ?? '') || /\bsam\b/i.test(s.label));
  const upload = srcs.some((s) => s.kind === 'upload' || s.kind === 'vault');
  cap.footer = sam && upload ? 'Company data from the SAM.gov registration and the company’s own materials.'
    : sam ? 'Company data from the SAM.gov registration.'
      : upload ? 'Company data from the company’s own materials.'
        : srcs.length ? 'Company data from the sources recorded with this document.' : null;
  return cap;
}
