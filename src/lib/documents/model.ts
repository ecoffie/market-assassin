/**
 * DocModel — the one structured document Mindy renders to every format.
 *
 * Content generation and rendering are separate: whatever produces a document (Ask Mindy, and later
 * other features through an adapter) produces a DocModel; renderers (render-docx.ts, render-pdf.ts,
 * later XLSX/PPTX) turn the same model into a file. Revisions edit the stored model, never re-prompt
 * from scratch.
 *
 * Every content block MUST carry a claim label (validate.ts refuses an unlabeled block — an
 * unlabeled block used to skip the citation rule entirely):
 *   fact           — a verified statement; must cite at least one source
 *   assumption     — rendered "Planning assumption" with its stated origin (a premise the reader must
 *                    check). Never carries certifications, contract awards, past performance or
 *                    eligibility/set-aside status — those cite or are omitted — and never hardens
 *                    into a fact across revisions (hardenedAssumptions in validate.ts)
 *   recommendation — rendered with a visible "Recommendation" label (a suggested action)
 *   unverified     — rendered "Unverified — no source" and listed in an "Unverified statements"
 *                    section. Set by demoteUncitedFacts, never a way to dress up a guess.
 *   context        — describes the DOCUMENT itself (scope, method, how to read it). Allowed only
 *                    in a section with role 'about', and never with a number (digits or words):
 *                    a figure is always a claim about the world.
 *
 * A recommendation that states a count or an amount (digits or number words) must cite the source
 * of that figure. An assumption may state a PLANNING figure ("we assume a ~$2M annual budget for
 * planning"), but one asserting a factual claim about the world — an award value, obligation,
 * ceiling, incumbent, date, or a count of buyers, vendors or contracts — must cite (Eric,
 * 2026-11-17; validate.ts assumptionAssertsFact). `unverified` can never be `critical` — a
 * decision-critical statement without a source is omitted, not shown.
 *
 * There is no "estimate" label (Eric, 2026-11-17): a statement is verified, an ASSUMPTION, or
 * omitted. A decision-critical statement with no source (`critical: true`) is omitted, not labeled.
 *
 * Neutral module: nothing here may import Proposal AI (src/lib/proposal/*), gov-buyer or MRR logic.
 */

export const DOC_SCHEMA = 'mindy.doc/1' as const;

export type Claim = 'fact' | 'assumption' | 'recommendation' | 'unverified' | 'context';

export type SourceKind = 'sam_notice' | 'usaspending' | 'upload' | 'vault' | 'tool' | 'web' | 'other';

export interface DocSource {
  /** Stable id that blocks cite, e.g. "s1". */
  id: string;
  label: string;
  url?: string;
  kind: SourceKind;
  /** ISO date the data was read. */
  retrievedAt?: string;
  /** The record the fact came from (notice id, PIID, UEI …). */
  recordId?: string;
}

interface Labeled {
  claim?: Claim;
  /**
   * The statement drives a decision (a dollar figure, a deadline, an eligibility rule). If it has no
   * resolvable source it is OMITTED by demoteUncitedFacts, never shown as unverified.
   */
  critical?: boolean;
  /** Source ids from DocModel.sources. */
  cites?: string[];
  /**
   * Assumptions only: where the premise comes from, stated for the reader, e.g. "This analysis models
   * these figures; they were not verified against the customer's records." Rendered after the text.
   * Required on an uncited assumption (Eric, 2026-11-17: origin must be explicit).
   */
  origin?: string;
}

export interface ParagraphBlock extends Labeled {
  type: 'paragraph';
  id: string;
  /** Plain text with inline **bold** and _italic_ only. */
  text: string;
}

export interface BulletItem extends Labeled {
  text: string;
}

export interface BulletsBlock {
  type: 'bullets';
  id: string;
  items: BulletItem[];
  ordered?: boolean;
  /** Rendering hint only: 'checklist' draws an empty checkbox per item (next steps, readiness). Ignored when ordered. */
  style?: 'checklist';
}

export type ColumnFormat = 'text' | 'usd' | 'int' | 'pct' | 'date';

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: ColumnFormat;
}

export type CellValue = string | number | null;

export interface TableBlock extends Labeled {
  type: 'table';
  id: string;
  caption?: string;
  columns: TableColumn[];
  rows: Record<string, CellValue>[];
}

export interface ChartPoint {
  x: string;
  y: number;
}

export interface ChartBlock extends Labeled {
  type: 'chart';
  id: string;
  caption?: string;
  kind: 'bar' | 'line' | 'pie';
  /** Label for the value axis, e.g. "Obligations ($M)". */
  yLabel?: string;
  /** Label for the category axis, e.g. "Fiscal quarter" or "Department". */
  xLabel?: string;
  /** How values read: 'usd' ($412.5M), 'int' (1,234), 'pct' (≤1 = fraction, 0.284 → 28.4%; >1 = percent points, 40.93 → 40.9%). Omitted: plain numbers with separators. */
  valueFormat?: 'usd' | 'int' | 'pct';
  series: { name: string; points: ChartPoint[] }[];
}

export interface CalloutBlock extends Labeled {
  type: 'callout';
  id: string;
  tone: 'note' | 'warning' | 'key_finding';
  text: string;
}

export interface PageBreakBlock {
  type: 'pagebreak';
  id: string;
}

export type Block = ParagraphBlock | BulletsBlock | TableBlock | ChartBlock | CalloutBlock | PageBreakBlock;

export interface DocSection {
  id: string;
  heading: string;
  level?: 1 | 2 | 3;
  /**
   * 'about' = a section that describes the DOCUMENT (how to read it, method, limitations).
   * Only an 'about' section may hold `context` blocks; every other section holds claims.
   */
  role?: 'body' | 'about';
  blocks: Block[];
}

export interface DocModel {
  schema: typeof DOC_SCHEMA;
  /**
   * Document type, for layout only. 'capability_statement' renders the one-page capability statement layout
   * (capability-statement.ts); anything else (or absent) is the report layout. Never changes validation.
   */
  kind?: 'report' | 'capability_statement';
  title: string;
  subtitle?: string;
  /** Who the document is for. Never auto-filled from the Vault. */
  preparedFor?: string;
  /** ISO date (YYYY-MM-DD), set by the server. */
  date: string;
  sources: DocSource[];
  sections: DocSection[];
  /**
   * Visual preset ('mindy' default, 'briefing'). Styling only — see theme.ts. An unknown name falls
   * back to the default; it never blocks a render.
   */
  theme?: string;
  meta?: {
    /** Who the document is addressed to on the cover card ("Attention"), when the producer has it. */
    attention?: string;
    generatedBy?: string;
    version?: number;
    parentVersion?: number;
  };
}

/** Limits a model must satisfy (validate.ts). */
export const DOC_LIMITS = {
  maxSections: 40,
  maxBlocks: 400,
  maxTableRows: 500,
  maxTableColumns: 12,
  maxChartPoints: 60,
  maxChartSeries: 6,
  maxSources: 200,
  maxTotalChars: 150_000,
  maxTitleChars: 200,
} as const;

/** The labeled items inside a block (a bullets block labels each item; others label themselves). */
export function labeledUnits(block: Block): Array<{ claim?: Claim; cites?: string[]; critical?: boolean; origin?: string; where: string; text: string }> {
  switch (block.type) {
    case 'bullets':
      return block.items.map((it, i) => ({ claim: it.claim, cites: it.cites, critical: it.critical, origin: it.origin, where: `${block.id}[${i}]`, text: it.text }));
    case 'pagebreak':
      return [];
    case 'paragraph':
    case 'callout':
      return [{ claim: block.claim, cites: block.cites, critical: block.critical, origin: block.origin, where: block.id, text: block.text }];
    case 'table':
      return [{ claim: block.claim, cites: block.cites, critical: block.critical, origin: block.origin, where: block.id, text: block.caption || 'Table' }];
    case 'chart':
      return [{ claim: block.claim, cites: block.cites, critical: block.critical, origin: block.origin, where: block.id, text: block.caption || 'Chart' }];
  }
}
