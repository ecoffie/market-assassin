import { NextRequest, NextResponse } from 'next/server';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageBreak,
  TableLayoutType,
} from 'docx';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { createClient } from '@supabase/supabase-js';
import type { LoiFields } from '@/lib/proposal/loi-fields';
import { assembleLoiTemplate } from '@/lib/proposal/loi-template';
import { assembleProposalPackage } from '@/lib/proposal/proposal-package';
import { assembleRfpResponse } from '@/lib/proposal/rfp-response';
import { normalizeCategory, type ComplianceReq } from '@/lib/proposal/section-alignment';
import type { VaultContext } from '@/lib/proposal/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

// The subset of the user's Vault + profile we merge into the LOI / RFQ
// response template so it doesn't export as all-blank placeholders.
interface CompanyProfile {
  legalName?: string;
  oneLiner?: string;
  elevatorPitch?: string;
  uei?: string;
  cageCode?: string;
  primaryNaics?: string;
  certifications?: string[];
  hqCity?: string;
  hqState?: string;
  serviceStates?: string[];
  website?: string;
  phone?: string;
  contactName?: string;
  contactEmail?: string;
  pastPerformance?: Array<{
    title?: string;
    customer?: string;
    value?: string;
    pop?: string;
    role?: string;
    scope?: string;
  }>;
}

// Load identity profile + past performance + the user's display contact info so
// the response template pre-fills everything we already know about them.
async function loadCompanyProfile(email: string): Promise<CompanyProfile> {
  const sb = getSupabase();
  const userEmail = email.toLowerCase().trim();
  const [idRes, ppRes, settingsRes] = await Promise.all([
    sb.from('user_identity_profile').select('*').eq('user_email', userEmail).maybeSingle().then((r: { data: unknown }) => r, () => ({ data: null })),
    sb.from('user_past_performance').select('*').eq('user_email', userEmail).is('archived_at', null).order('updated_at', { ascending: false }).limit(3).then((r: { data: unknown }) => r, () => ({ data: [] })),
    sb.from('mi_beta_user_settings').select('display_name, company_name, role_title').eq('user_email', userEmail).maybeSingle().then((r: { data: unknown }) => r, () => ({ data: null })),
  ]);

  const id = (idRes.data || {}) as Record<string, unknown>;
  const settings = (settingsRes.data || {}) as Record<string, unknown>;
  const pp = Array.isArray(ppRes.data) ? ppRes.data as Array<Record<string, unknown>> : [];
  // Treat bracket-placeholder text ("[Contract Title]", "[Briefly describe…]")
  // as empty. The AI coach seeds sample past-performance rows with these — they
  // are prompts for the user, not real data. Returning undefined makes the
  // export render a clean fill-in blank ("Contract / project title: ______")
  // instead of dumping the raw "[Contract Title]" text into the document.
  const isPlaceholder = (t: string): boolean => {
    // Whole-string bracket ("[Contract Title]"), a value that STARTS with a
    // bracket prompt ("[Briefly describe…]\n\n📝 Fill in…"), or the AI coach's
    // "📝 Fill in / Use this section…" guidance text.
    return /^\[[^\]]*\]/.test(t) || /📝|^fill in\b|^use this section\b|^describe\b/i.test(t);
  };
  const str = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    if (!t || isPlaceholder(t)) return undefined;
    return t;
  };
  const arr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v) || !v.length) return undefined;
    const cleaned = v.map(String).map(s => s.trim()).filter(s => s && !isPlaceholder(s));
    return cleaned.length ? cleaned : undefined;
  };

  return {
    legalName: str(id.legal_name) || str(settings.company_name),
    oneLiner: str(id.one_liner),
    elevatorPitch: str(id.elevator_pitch),
    uei: str(id.uei),
    cageCode: str(id.cage_code),
    primaryNaics: arr(id.primary_naics)?.[0],
    certifications: arr(id.certifications),
    hqCity: str(id.hq_city),
    hqState: str(id.hq_state),
    serviceStates: arr(id.service_states),
    contactName: str(settings.display_name),
    pastPerformance: pp.map((p) => ({
      title: str(p.contract_title) || str(p.project_title) || str(p.title),
      customer: [str(p.agency), str(p.sub_agency)].filter(Boolean).join(' — ') || str(p.customer),
      value: str(p.contract_value) || str(p.value),
      pop: [str(p.period_start), str(p.period_end)].filter(Boolean).join(' to ') || str(p.period_of_performance),
      role: str(p.role),
      scope: str(p.scope_description) || str(p.scope) || str(p.outcomes),
    })),
  };
}

// Load the raw vault rows (identity + past performance) shaped as a VaultContext
// so the deterministic LOI assembler (assembleLoiTemplate) can render the proven
// "(a)(b)(c)(d) + RELEVANT EXPERIENCE" letter. We load the RAW rows (not the
// reshaped CompanyProfile) because the assembler needs office / reference_name /
// reference_phone / sub_agency to fill the labeled reference-project blocks.
async function loadVaultForLoi(email: string): Promise<VaultContext> {
  const sb = getSupabase();
  const userEmail = email.toLowerCase().trim();
  const [idRes, ppRes] = await Promise.all([
    sb.from('user_identity_profile').select('*').eq('user_email', userEmail).maybeSingle().then((r: { data: unknown }) => r, () => ({ data: null })),
    sb.from('user_past_performance').select('*').eq('user_email', userEmail).is('archived_at', null).order('updated_at', { ascending: false }).limit(10).then((r: { data: unknown }) => r, () => ({ data: [] })),
  ]);
  const identity = (idRes.data || null) as Record<string, unknown> | null;
  const past_performance = (Array.isArray(ppRes.data) ? ppRes.data : []) as Array<Record<string, unknown>>;
  return { has_any: Boolean(identity) || past_performance.length > 0, identity, past_performance };
}

// Render the deterministic LOI letter (a formatted plain-text string) as docx
// paragraphs. The RELEVANT EXPERIENCE block uses space-aligned labels, so it is
// rendered in a monospace font to preserve the column alignment; the rest reads
// as a normal letter.
function renderLoiTemplateParagraphs(letter: string): Paragraph[] {
  const [body, ...expParts] = letter.split('RELEVANT EXPERIENCE');
  const out: Paragraph[] = [];

  for (const line of body.split('\n')) {
    out.push(new Paragraph({ children: [new TextRun({ text: line })] }));
  }

  if (expParts.length) {
    out.push(new Paragraph({ children: [new TextRun({ text: 'RELEVANT EXPERIENCE', bold: true })] }));
    const exp = expParts.join('RELEVANT EXPERIENCE');
    for (const line of exp.split('\n')) {
      // Monospace so "Role:  …  / Contract Value:  …" labels stay aligned.
      out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New', size: 20 })] }));
    }
  }
  return out;
}

// Render the deterministic 4-volume IDIQ package. Volumes are separated by a
// form-feed (\f) marker → a page break. A line's leading numbering (1.0, 1.2,
// 1.2.1) drives its heading weight so the numbered skeleton reads as a real
// proposal; bracketed [placeholders] stay inline for the user to fill.
function renderProposalPackageParagraphs(packageText: string): (Paragraph)[] {
  const out: Paragraph[] = [];
  const blocks = packageText.split('\f');
  blocks.forEach((block, bi) => {
    if (bi > 0) out.push(new Paragraph({ children: [new PageBreak()] }));
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      const t = line.trim();
      // Volume header (N.0) → big bold; top-level numbered section (N. Title, the
      // light RFP response) → big bold; section (N.M) → bold; sub (N.M.K) → bold-ish.
      if (/^\d\.0\s/.test(t)) {
        out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true })] }));
      } else if (/^\d+\.\s+\S/.test(t) && !/^\d\.\d/.test(t)) {
        out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: t, bold: true })] }));
      } else if (/^\d\.\d+\s/.test(t)) {
        out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t, bold: true })] }));
      } else if (/^\d\.\d+\.\d+\s/.test(t)) {
        out.push(new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: line, bold: true })] }));
      } else {
        out.push(new Paragraph({ children: [new TextRun({ text: line })] }));
      }
    }
  });
  return out;
}

interface ComplianceRow {
  id: string;
  requirement: string;
  category: string;
  section?: string;
  owner?: string;
  status?: string;
  source_quote?: string;
}

interface DraftSection {
  label: string;
  draft: string;
  wordCount?: number;
}

interface ChecklistItem {
  label: string;
  checked: boolean;
}

interface ExportBody {
  fileName?: string;
  compliance?: ComplianceRow[];
  drafts?: Record<string, DraftSection>;
  checklist?: ChecklistItem[];
  sectionOrder?: string[];
  packageType?: 'proposal' | 'sources_sought_loi' | 'rfq_response' | 'idiq_proposal' | 'rfp_response';
  rfpFileName?: string;
  // The real solicitation body text. Used by the RFP export to detect Section
  // L/M / volume structure (detectWeight). Must be the document text, NOT the
  // filename — a filename never carries those signals (Eric QC 2026-06).
  rfpSourceText?: string;
  // Structured fields extracted from the SAM.gov notice text (Sources Sought /
  // RFI). When present, the LOI template pre-fills agency/address/solicitation/
  // submission-requirement blanks instead of leaving them empty.
  loiFields?: LoiFields;
}

const HEADING_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
};

/**
 * Parse inline markdown (**bold**, *italic*) into an array of TextRun
 * objects with proper bold/italic flags. Mirrors Content Reaper's
 * parseMarkdownLine (public/content-generator/index.html:3043).
 *
 * Survives both **bold** and __bold__, *italic* and _italic_. Order
 * matters: handle bold first (greedy match) so it doesn't get eaten
 * by italic.
 */
function parseInlineMarkdown(line: string): TextRun[] {
  if (!line) return [new TextRun({ text: '' })];
  const runs: TextRun[] = [];
  // Tokenize: split on bold/italic markers while keeping them
  const tokens = line.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/);
  for (const token of tokens) {
    if (!token) continue;
    if (/^\*\*[^*]+\*\*$/.test(token) || /^__[^_]+__$/.test(token)) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (/^\*[^*]+\*$/.test(token) || /^_[^_]+_$/.test(token)) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    } else {
      runs.push(new TextRun({ text: token }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text: line })];
}

function plain(text: string) {
  return new Paragraph({ children: parseInlineMarkdown(text) });
}

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun({ text, bold: true })] });
}

// Build a Word table from markdown table lines (Eric: the "FUNCTION/DESCRIPTION"
// table was flattening into a paragraph on export).
function tableFromMarkdown(rows: string[]): Table {
  const cells = (line: string) =>
    line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  // Skip the separator row (|---|---|).
  const dataRows = rows.filter(r => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
  const tableRows = dataRows.map((line, i) => new TableRow({
    children: cells(line).map(text => new TableCell({
      children: [new Paragraph({ children: parseInlineMarkdown(text), spacing: { before: 20, after: 20 } })],
    })),
    tableHeader: i === 0,
  }));
  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
  });
}

function paragraphsFromMarkdown(md: string): (Paragraph | Table)[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: (Paragraph | Table)[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join(' ').trim();
    if (joined) out.push(new Paragraph({ children: parseInlineMarkdown(joined), spacing: { after: 120 } }));
    buffer = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trimEnd();

    if (!line.trim()) { flushBuffer(); continue; }

    // Markdown TABLE: a line with pipes followed by a separator row. Gather the
    // whole block and render as a real Word table.
    if (/\|/.test(line) && idx + 1 < lines.length && /^\s*\|?[\s:|-]{3,}\|?\s*$/.test(lines[idx + 1])) {
      flushBuffer();
      const block: string[] = [line];
      let j = idx + 1;
      while (j < lines.length && /\|/.test(lines[j])) { block.push(lines[j].trimEnd()); j++; }
      out.push(tableFromMarkdown(block));
      idx = j - 1;
      continue;
    }

    // Markdown # headings.
    const h = /^(#{1,6})\s+(.*)/.exec(line);
    if (h) {
      flushBuffer();
      const level = h[1].length;
      const headingLevel = level === 1 ? HeadingLevel.HEADING_2 : level === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
      out.push(new Paragraph({ heading: headingLevel, children: [new TextRun({ text: h[2], bold: true })], spacing: { before: 160, after: 80 } }));
      continue;
    }

    // Decimal-numbered SECTION headings (5.0, 5.2, 5.10 …) — these are SOW
    // section titles, not list items. Make them real headings (Eric: they ran
    // together as dense paragraphs). Title = the section number + its heading
    // text up to the first sentence end, kept on its own line.
    const section = /^(\d+\.\d+)\s+(.+)/.exec(line);
    if (section && section[2].length < 90 && !/[.;]\s/.test(section[2])) {
      flushBuffer();
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: `${section[1]} ${section[2]}`, bold: true })], spacing: { before: 140, after: 60 } }));
      continue;
    }

    // Bullets.
    const bullet = /^[-*]\s+(.*)/.exec(line);
    if (bullet) { flushBuffer(); out.push(new Paragraph({ children: parseInlineMarkdown(bullet[1]), bullet: { level: 0 } })); continue; }

    // Plain numbered list (1. 2. 3.).
    const numbered = /^\d+\.\s+(.*)/.exec(line);
    if (numbered) { flushBuffer(); out.push(new Paragraph({ children: parseInlineMarkdown(numbered[1]), numbering: undefined, bullet: { level: 0 } })); continue; }

    buffer.push(line);
  }
  flushBuffer();
  return out;
}

function buildComplianceTable(rows: ComplianceRow[]): Table {
  const header = new TableRow({
    tableHeader: true,
    children: ['ID', 'Requirement', 'Category', 'Section', 'Owner', 'Status'].map(t =>
      new TableCell({
        width: { size: 100 / 6, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
        borders: HEADING_BORDER,
      })
    ),
  });

  const body = rows.map(r =>
    new TableRow({
      children: [
        new TableCell({ children: [plain(r.id)], borders: HEADING_BORDER }),
        new TableCell({ children: [plain(r.requirement)], borders: HEADING_BORDER }),
        new TableCell({ children: [plain(r.category || '')], borders: HEADING_BORDER }),
        new TableCell({ children: [plain(r.section || '')], borders: HEADING_BORDER }),
        new TableCell({ children: [plain(r.owner || '')], borders: HEADING_BORDER }),
        new TableCell({ children: [plain(r.status || 'open')], borders: HEADING_BORDER }),
      ],
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...body],
  });
}

function blank(label: string) {
  return `${label}: ______________________________`;
}

// Pre-fill a label with a known value when we have it, else leave a blank line.
// "Company legal name: GOVCON GIANTS INC" vs "Company legal name: ______".
function fill(label: string, value?: string | null) {
  const v = (value || '').trim();
  return v ? `${label}: ${v}` : blank(label);
}

function buildResponseTemplateSections(
  kind: 'loi' | 'rfq',
  profile: CompanyProfile = {},
  loi: LoiFields = {},
): Array<{ label: string; draft: string }> {
  const isRfq = kind === 'rfq';
  const company = profile.legalName || '[Company Name]';
  const cityState = [profile.hqCity, profile.hqState].filter(Boolean).join(', ');
  const designation = (profile.certifications && profile.certifications.length)
    ? profile.certifications.join(', ')
    : '[small-business designation(s)]';
  const services = profile.oneLiner || '[core services relevant to this notice]';
  const cityStateLabel = cityState || '[City / State]';

  // Agency address assembled from extracted fields (any subset).
  const addr = loi.agencyAddress || {};
  const cityStateZip = [
    [addr.city, addr.state].filter(Boolean).join(', '),
    addr.zip,
  ].filter(Boolean).join(' ');
  // The requirement title prefers an explicit project title, else falls back to
  // whatever the notice called the requirement.
  const capRequested = loi.capabilityStatementRequested === 'yes' ? 'Yes'
    : loi.capabilityStatementRequested === 'no' ? 'No'
    : loi.capabilityStatementRequested === 'not_stated' ? 'Not stated'
    : undefined;
  // Join list fields into a single readable line; leave a blank if absent.
  const requestedContent = loi.requestedContent?.length
    ? loi.requestedContent.map((s) => `  • ${s}`).join('\n')
    : undefined;
  const requiredAttachments = loi.requiredAttachments?.length
    ? loi.requiredAttachments.join(', ')
    : undefined;

  if (!isRfq) {
    return [
      {
        label: 'Letter of Intent',
        draft: [
          fill('Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
          '',
          fill('Attention', loi.agencyAttention || loi.contactName),
          fill('Agency / Office', loi.agencyName),
          fill('Street Address', addr.street),
          fill('City, State ZIP', cityStateZip),
          '',
          fill('Reference / Solicitation Number', loi.solicitationNumber),
          fill('Project / Requirement Title', loi.projectTitle),
          '',
          'To whom it may concern,',
          '',
          `${company}, a ${cityStateLabel}-based ${designation} firm, is pleased to submit this Letter of Intent to demonstrate its intention and ability to support the above-referenced requirement.`,
          '',
          `${company} has successfully completed work of similar scope and size for federal and commercial customers. We specialize in ${services}. Our team is prepared to provide the personnel, management, and technical capability required for this effort.`,
          '',
          'Following is a Summary of Qualifications along with the requested submittal information.',
        ].join('\n'),
      },
      {
        label: 'Submittal Requirements',
        draft: [
          `Submittal Intention: ${company} has reviewed this opportunity and is interested in providing services for the above-referenced project. Our team has relevant experience in ${services}.`,
          '',
          fill('Submission deadline', loi.submissionDeadline),
          fill('Submission email / portal', loi.submissionMethod),
          fill('Page limit / format instructions', loi.pageLimit),
          // Requested response content can be multi-line; render the label then
          // the bullets beneath it, else a single blank.
          requestedContent
            ? `Requested response content / questions from the notice:\n${requestedContent}`
            : blank('Requested response content / questions from the notice'),
          fill('Required attachments', requiredAttachments),
          fill('Capability statement requested? Yes / No / Not stated', capRequested),
          blank('Capability statement attached? Yes / No / N/A'),
        ].join('\n'),
      },
      {
        label: 'Company Profile',
        draft: [
          fill('Company legal name', profile.legalName),
          blank('Number of employees'),
          fill('Office location', cityState),
          blank('Single bonding capacity / insurance information if requested'),
          blank('Aggregate bonding capacity if requested'),
          fill('UEI number', profile.uei),
          fill('CAGE code', profile.cageCode),
          // Prefer the NAICS the notice itself cites (authoritative for THIS
          // opportunity), then the company's primary NAICS.
          fill('Primary NAICS code', loi.naicsCode || profile.primaryNaics),
          fill('Small business designation / status claimed', profile.certifications?.join(', ')),
        ].join('\n'),
      },
      {
        label: 'Responsible Office / Contact Person',
        draft: [
          fill('Responsible office / company address', cityState),
          fill('Contact person', profile.contactName),
          blank('Title'),
          blank('Phone'),
          fill('Email', profile.contactEmail),
          fill('Website', profile.website),
        ].join('\n'),
      },
      {
        label: 'Relevant Experience',
        // Pre-fill from the user's Vault past performance; pad to 3 project
        // blocks so they always have the full template structure to complete.
        draft: (() => {
          const pp = profile.pastPerformance || [];
          const blocks: string[] = [];
          for (let i = 0; i < Math.max(3, pp.length); i++) {
            const p = pp[i];
            blocks.push(`Project ${i + 1}`);
            blocks.push(fill('Contract / project title', p?.title));
            blocks.push(fill('Role: Prime / Subcontractor', p?.role));
            blocks.push(fill('Agency / customer', p?.customer));
            blocks.push(fill('Contract value', p?.value));
            blocks.push(fill('Period of performance', p?.pop));
            blocks.push(blank('Point of contact'));
            blocks.push(blank('Telephone / email'));
            blocks.push(blank('Timeliness of performance'));
            blocks.push(blank('Customer satisfaction / CPARS / performance result'));
            blocks.push(fill('Scope and relevance to this requirement', p?.scope));
            blocks.push('');
          }
          return blocks.join('\n').trim();
        })(),
      },
      {
        label: 'Attachment Reminder',
        draft: [
          'Attach the company capability statement as a separate document only if the Sources Sought / RFI requests or requires it.',
          '',
          blank('Capability statement attached? Yes / No / N/A'),
          blank('Other attachments included'),
        ].join('\n'),
      },
    ];
  }

  return [
    {
      label: isRfq ? 'RFQ Response Cover' : 'Letter of Intent',
      draft: [
        fill('Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
        '',
        blank('Attention'),
        blank('Agency / Office'),
        blank('Street Address'),
        blank('City, State ZIP'),
        '',
        blank('Reference / Solicitation Number'),
        blank('Project / Requirement Title'),
        '',
        'To whom it may concern,',
        '',
        `${company} is pleased to submit this ${isRfq ? 'RFQ response' : 'Letter of Intent'} for the above-referenced requirement.`,
        '',
        fill('One-sentence summary of fit', profile.oneLiner),
        fill('Primary NAICS / business designation', [profile.primaryNaics, profile.certifications?.join(', ')].filter(Boolean).join(' / ')),
        blank('Capability statement attached? Yes / No / N/A'),
      ].join('\n'),
    },
    {
      label: 'Submittal Requirements',
      draft: [
        blank('Submission deadline'),
        blank('Submission email / portal'),
        blank('Page limit / format instructions'),
        blank('Required attachments'),
        blank('Questions or requested information from notice'),
        isRfq ? blank('Quoted price / rates / CLIN references') : blank('Intent statement / teaming posture'),
      ].join('\n'),
    },
    {
      label: 'Company Profile',
      draft: [
        fill('Company legal name', profile.legalName),
        fill('Office location', cityState),
        blank('Number of employees'),
        fill('UEI number', profile.uei),
        fill('CAGE code', profile.cageCode),
        fill('Small business designation / status claimed', profile.certifications?.join(', ')),
        blank('Bonding capacity / insurance information if requested'),
      ].join('\n'),
    },
    {
      label: 'Responsible Office / Contact Person',
      draft: [
        fill('Responsible office', cityState),
        fill('Contact person', profile.contactName),
        blank('Title'),
        blank('Phone'),
        fill('Email', profile.contactEmail),
        fill('Website', profile.website),
      ].join('\n'),
    },
    {
      label: 'Relevant Experience',
      draft: [
        'Project 1',
        blank('Contract / project title'),
        blank('Role: Prime / Sub'),
        blank('Agency / customer'),
        blank('Contract value'),
        blank('Period of performance'),
        blank('Point of contact'),
        blank('Scope and relevance to this requirement'),
        '',
        'Project 2',
        blank('Contract / project title'),
        blank('Role: Prime / Sub'),
        blank('Agency / customer'),
        blank('Contract value'),
        blank('Period of performance'),
        blank('Point of contact'),
        blank('Scope and relevance to this requirement'),
      ].join('\n'),
    },
  ];
}

// ---- Template-faithful LOI / Statement of Capability builder ----------------
// Mirrors public/templates/loi-govcon-edu-template.docx: a real letter (no
// title/contents page), with aligned label/value rows rendered as borderless
// 2-column tables so the colons line up, and bold per-project experience
// headers. blank fields stay as fill-in lines for the user.

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24 })],
  });
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  let body: ExportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileNameBase = (body.fileName || 'proposal-package').replace(/[^a-z0-9-_.]/gi, '_');
  const drafts = body.drafts || {};
  const compliance = body.compliance || [];
  const checklist = body.checklist || [];
  const sectionOrder = body.sectionOrder || ['exec_summary', 'technical', 'management', 'past_performance', 'pricing'];
  const isLoiPackage = body.packageType === 'sources_sought_loi';
  const isRfqPackage = body.packageType === 'rfq_response';
  const isIdiqPackage = body.packageType === 'idiq_proposal';
  const isRfpResponsePackage = body.packageType === 'rfp_response';
  const isSimpleResponsePackage = isLoiPackage || isRfqPackage;
  // Reference line for the LOI. Prefer the parsed solicitation number; else the
  // source name with the synthetic "— notice text" suffix stripped (the
  // notice-body fallback labels its virtual doc that way for the docs list, and
  // it was leaking into the Reference field — Eric QC 2026-06-13).
  const cleanedRfpName = (body.rfpFileName || '')
    .replace(/\s*[—-]\s*notice text\s*$/i, '')
    .trim();
  const solNumber = (body.loiFields?.solicitationNumber || '').trim();
  const rfpName = solNumber || cleanedRfpName || 'RFP';

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Section order in the final doc — caller sends the tab order currently shown
  // in the UI so SS/RFI LOI sections export correctly too.
  // Load the user's Vault + profile so the LOI / RFQ template pre-fills company
  // name, UEI, CAGE, NAICS, services, and past performance instead of exporting
  // as all-blank placeholders. Best-effort — a lookup failure just falls back
  // to blanks.
  const companyProfile = isSimpleResponsePackage
    ? await loadCompanyProfile(email).catch(() => ({} as CompanyProfile))
    : {} as CompanyProfile;

  const orderedSections = sectionOrder.filter(id => drafts[id]?.draft);
  const templateSections = orderedSections.length === 0 && isSimpleResponsePackage
    ? buildResponseTemplateSections(isRfqPackage ? 'rfq' : 'loi', companyProfile, body.loiFields || {})
    : [];

  const children: (Paragraph | Table)[] = [];

  // LOI / Statement of Capability (Sources Sought / RFI): render the
  // template-faithful letter (no title/contents page), mirroring
  // public/templates/loi-govcon-edu-template.docx. Any AI-drafted narrative
  // sections the user generated are appended after the template body, so the
  // single "Export LOI .docx" button always produces the complete document.
  const useLoiTemplate = isLoiPackage;
  if (useLoiTemplate) {
    // DETERMINISTIC LOI (2026-06-13): render the proven GovCon Giants letter
    // format — letterhead → "(a)(b)(c)(d)" intent block → Responsible Office /
    // Contact Person → RELEVANT EXPERIENCE (labeled per reference project) — via
    // assembleLoiTemplate. The output IS the template: real CO/notice + vault
    // data fills automatically; everything unknown is a labeled [placeholder]
    // the user pastes over. No LLM in the letter itself = exact format fidelity.
    // (memory: sources_sought_loi_prefill; this replaces the old key/value form.)
    const loiVault = await loadVaultForLoi(email).catch(() => ({ has_any: false } as VaultContext));
    const letter = assembleLoiTemplate({ fields: body.loiFields || null, vault: loiVault });

    // PREVIEW MODE (?format=text): return the assembled LOI as plain text so the
    // panel can show it on-screen BEFORE the user exports .docx (Eric QC: "drafted
    // the LOI but no button to open and review"). Same text the .docx renders.
    if (request.nextUrl.searchParams.get('format') === 'text') {
      return NextResponse.json({ success: true, format: 'text', letter });
    }

    children.push(...renderLoiTemplateParagraphs(letter));

    // Any AI-drafted narrative the user generated (Capability Fit, Why Us, etc.)
    // is appended AFTER the template letter as optional supporting narrative, so
    // their drafted content isn't lost. POC prose is skipped (the letter already
    // carries the structured Responsible Office / Contact Person block).
    const NARRATIVE_ORDER = ['cap_past_performance', 'capabilities', 'differentiators'];
    const narrativeIds = NARRATIVE_ORDER.filter(id => orderedSections.includes(id) && drafts[id]?.draft);
    const extraIds = orderedSections.filter(id => id !== 'poc' && id !== 'company_overview' && !narrativeIds.includes(id) && drafts[id]?.draft);
    const supporting = [...narrativeIds, ...extraIds];
    if (supporting.length) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(sectionHeader('Supporting Narrative (optional):'));
      for (const id of supporting) {
        const s = drafts[id];
        if (!s || !s.draft) continue;
        children.push(sectionHeader(`${s.label}:`));
        children.push(...paragraphsFromMarkdown(s.draft));
      }
    }
    const loiDoc = new Document({
      creator: 'Mindy',
      title: `Statement of Capability — ${rfpName}`,
      description: 'Statement of Capability / Letter of Intent generated by Mindy from your profile.',
      sections: [{ children }],
    });
    const loiBuffer = await Packer.toBuffer(loiDoc);
    const loiFileName = `${fileNameBase}-${new Date().toISOString().split('T')[0]}.docx`;
    return new NextResponse(new Uint8Array(loiBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${loiFileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // IDIQ / MACC 4-volume proposal package (#7): the deterministic Volume I–IV
  // skeleton — the format people can't structure themselves. Driven by the
  // compliance matrix the caller already extracted (body.compliance); pre-filled
  // from the vault; everything unknown is an instructive labeled [placeholder].
  if (isIdiqPackage) {
    // The UI sends `category` as a HUMAN LABEL ("Technical", "Past Performance")
    // via CATEGORY_LABELS — normalizeCategory maps it (and the requirement text)
    // back to the enum the structure builder buckets on. Casting the label
    // directly would mis-bucket every requirement.
    const reqs: ComplianceReq[] = compliance.map((c) => ({
      id: c.id,
      requirement: c.requirement,
      category: normalizeCategory(c.category, c.requirement),
      section: c.section,
    }));
    const idiqVault = await loadVaultForLoi(email).catch(() => ({ has_any: false } as VaultContext));
    const pkg = assembleProposalPackage({ requirements: reqs, vault: idiqVault });

    const idiqChildren: (Paragraph | Table)[] = [
      new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Proposal Package (IDIQ / MACC)', bold: true, size: 52 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: rfpName, size: 28 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generated ${today} via Mindy`, italics: true, color: '666666' })] }),
    ];
    // Critical requirements up front (deadlines, mandatory plans/certs).
    if (pkg.critical.length) {
      idiqChildren.push(new Paragraph({ children: [new PageBreak()] }));
      idiqChildren.push(heading('Critical Requirements — handle first'));
      for (const r of pkg.critical) {
        idiqChildren.push(new Paragraph({ children: [new TextRun({ text: `• ${r.section ? r.section + ' — ' : ''}${r.requirement}` })] }));
      }
    }
    idiqChildren.push(new Paragraph({ children: [new PageBreak()] }));
    idiqChildren.push(...renderProposalPackageParagraphs(pkg.text));

    const idiqDoc = new Document({
      creator: 'Mindy',
      title: `Proposal Package — ${rfpName}`,
      description: '4-volume IDIQ/MACC proposal skeleton generated by Mindy from the solicitation compliance matrix + your profile.',
      sections: [{ children: idiqChildren }],
    });
    const idiqBuffer = await Packer.toBuffer(idiqDoc);
    const idiqFileName = `${fileNameBase}-${new Date().toISOString().split('T')[0]}.docx`;
    return new NextResponse(new Uint8Array(idiqBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${idiqFileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Normal single-award RFP response (#10): SPECTRUM-AWARE — a light commercial
  // response by default (the ~99% case from docs/RFP-FORMAT-ANALYSIS.md), or the
  // UCF volume structure when the RFP actually carries Section L/M signals.
  if (isRfpResponsePackage) {
    const reqs: ComplianceReq[] = compliance.map((c) => ({
      id: c.id,
      requirement: c.requirement,
      category: normalizeCategory(c.category, c.requirement),
      section: c.section,
    }));
    const rfpVault = await loadVaultForLoi(email).catch(() => ({ has_any: false } as VaultContext));
    // Feed the REAL solicitation text so detectWeight can see Section L/M /
    // volume signals. The old code passed rfpFileName (the filename), which
    // never contains those signals → every RFP misdetected as light_commercial.
    const rfp = assembleRfpResponse({ requirements: reqs, vault: rfpVault, sourceText: body.rfpSourceText || '' });

    const rfpChildren: (Paragraph | Table)[] = [
      new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'RFP Response', bold: true, size: 52 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: rfpName, size: 28 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generated ${today} via Mindy`, italics: true, color: '666666' })] }),
      // Tell the user which shape was chosen and why.
      new Paragraph({ spacing: { before: 160, after: 160 }, children: [new TextRun({ text: rfp.weightReason, italics: true, color: '888888' })] }),
    ];
    rfpChildren.push(...renderProposalPackageParagraphs(rfp.text));

    const rfpDoc = new Document({
      creator: 'Mindy',
      title: `RFP Response — ${rfpName}`,
      description: 'Single-award RFP response skeleton generated by Mindy from the solicitation compliance matrix + your profile.',
      sections: [{ children: rfpChildren }],
    });
    const rfpBuffer = await Packer.toBuffer(rfpDoc);
    const rfpFileName = `${fileNameBase}-${new Date().toISOString().split('T')[0]}.docx`;
    return new NextResponse(new Uint8Array(rfpBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${rfpFileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // --- Title page ---
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: isSimpleResponsePackage
          ? isRfqPackage ? 'RFQ Response Template' : 'LOI Response Template'
          : 'Proposal Package',
        bold: true,
        size: 56,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: rfpName, size: 28 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Generated ${today} via Mindy`, italics: true, color: '666666' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '', break: 2 })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Contents', bold: true })],
    })
  );

  const tocItems: string[] = [];
  if (compliance.length > 0) {
    tocItems.push(isSimpleResponsePackage
      ? `Response Requirements (${compliance.length} items)`
      : `Compliance Matrix (${compliance.length} requirements)`);
  }
  for (const id of orderedSections) {
    const s = drafts[id];
    if (s && s.draft) tocItems.push(s.label);
  }
  for (const s of templateSections) tocItems.push(s.label);
  if (checklist.length > 0) tocItems.push(`Review Checklist (${checklist.filter(c => c.checked).length}/${checklist.length} complete)`);

  for (const item of tocItems) {
    children.push(new Paragraph({ children: [new TextRun({ text: `• ${item}` })] }));
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // --- Compliance matrix ---
  if (compliance.length > 0) {
    children.push(heading(isSimpleResponsePackage ? 'Response Requirements' : 'Compliance Matrix'));
    children.push(
      new Paragraph({
        children: [new TextRun({
          text: isLoiPackage
            ? `${compliance.length} response instructions / requested content items extracted from ${rfpName}.`
            : `${compliance.length} requirements extracted from ${rfpName}.`,
          italics: true,
          color: '666666',
        })],
      })
    );
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    children.push(buildComplianceTable(compliance));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // --- Each drafted section ---
  for (const id of orderedSections) {
    const s = drafts[id];
    if (!s || !s.draft) continue;
    children.push(heading(s.label));
    if (s.wordCount) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${s.wordCount} words`, italics: true, color: '666666' })],
        })
      );
    }
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    children.push(...paragraphsFromMarkdown(s.draft));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  for (const s of templateSections) {
    children.push(heading(s.label));
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'Complete the blanks before submission. Attach your existing capability statement separately if the notice requests it.',
        italics: true,
        color: '666666',
      })],
    }));
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    children.push(...paragraphsFromMarkdown(s.draft));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // --- Review checklist appendix ---
  if (checklist.length > 0) {
    children.push(heading('Review Checklist'));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${checklist.filter(c => c.checked).length} of ${checklist.length} items confirmed.`, italics: true, color: '666666' })],
      })
    );
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    for (const item of checklist) {
      const mark = item.checked ? '☑' : '☐';
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${mark}  ${item.label}` })],
        })
      );
    }
  }

  const doc = new Document({
    creator: 'Mindy',
    title: `${isSimpleResponsePackage ? isRfqPackage ? 'RFQ Response Template' : 'LOI Response Template' : 'Proposal Package'} — ${rfpName}`,
    description: isSimpleResponsePackage
      ? 'Fillable response template generated by Mindy from the LOI structure.'
      : 'Compliance matrix, draft sections, and review checklist for federal proposal.',
    sections: [{ children }],
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    const fileName = `${fileNameBase}-${new Date().toISOString().split('T')[0]}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[proposal/export] packer failed:', err);
    return NextResponse.json(
      { success: false, error: 'Could not assemble the document. Try again.' },
      { status: 500 }
    );
  }
}
