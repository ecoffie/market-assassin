/**
 * DocModel — the one structured document Mindy renders to every format.
 *
 * Content generation and rendering are separate: whatever produces a document (Ask Mindy, and later
 * other features through an adapter) produces a DocModel; renderers (render-docx.ts, render-pdf.ts,
 * later XLSX/PPTX) turn the same model into a file. Revisions edit the stored model, never re-prompt
 * from scratch.
 *
 * Every content block may carry a claim label:
 *   fact           — must cite at least one source (validate.ts enforces it)
 *   estimate       — rendered with a visible "Estimate" label
 *   recommendation — rendered with a visible "Recommendation" label
 *
 * Neutral module: nothing here may import Proposal AI (src/lib/proposal/*), gov-buyer or MRR logic.
 */

export const DOC_SCHEMA = 'mindy.doc/1' as const;

export type Claim = 'fact' | 'estimate' | 'recommendation';

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
  /** Source ids from DocModel.sources. */
  cites?: string[];
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
  blocks: Block[];
}

export interface DocModel {
  schema: typeof DOC_SCHEMA;
  title: string;
  subtitle?: string;
  /** Who the document is for. Never auto-filled from the Vault. */
  preparedFor?: string;
  /** ISO date (YYYY-MM-DD), set by the server. */
  date: string;
  sources: DocSource[];
  sections: DocSection[];
  meta?: {
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
export function labeledUnits(block: Block): Array<{ claim?: Claim; cites?: string[]; where: string }> {
  switch (block.type) {
    case 'bullets':
      return block.items.map((it, i) => ({ claim: it.claim, cites: it.cites, where: `${block.id}[${i}]` }));
    case 'pagebreak':
      return [];
    default:
      return [{ claim: block.claim, cites: block.cites, where: block.id }];
  }
}
