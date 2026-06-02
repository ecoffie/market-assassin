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
} from 'docx';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { createClient } from '@supabase/supabase-js';

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
  packageType?: 'proposal' | 'sources_sought_loi' | 'rfq_response';
  rfpFileName?: string;
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

function paragraphsFromMarkdown(md: string): Paragraph[] {
  // Lightweight markdown → docx: handle # headings, blank-line paragraphs, bullets.
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: Paragraph[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join(' ').trim();
    if (joined) out.push(new Paragraph({ children: parseInlineMarkdown(joined) }));
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushBuffer();
      continue;
    }

    // Heading levels
    const h = /^(#{1,6})\s+(.*)/.exec(line);
    if (h) {
      flushBuffer();
      const level = h[1].length;
      const headingLevel =
        level === 1 ? HeadingLevel.HEADING_2 :
        level === 2 ? HeadingLevel.HEADING_3 :
        HeadingLevel.HEADING_4;
      out.push(new Paragraph({ heading: headingLevel, children: [new TextRun({ text: h[2], bold: true })] }));
      continue;
    }

    // Bullet (with inline markdown preserved)
    const bullet = /^[-*]\s+(.*)/.exec(line);
    if (bullet) {
      flushBuffer();
      out.push(new Paragraph({ children: parseInlineMarkdown(bullet[1]), bullet: { level: 0 } }));
      continue;
    }

    // Numbered (with inline markdown preserved)
    const numbered = /^\d+\.\s+(.*)/.exec(line);
    if (numbered) {
      flushBuffer();
      out.push(new Paragraph({ children: parseInlineMarkdown(numbered[1]), bullet: { level: 0 } }));
      continue;
    }

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
): Array<{ label: string; draft: string }> {
  const isRfq = kind === 'rfq';
  const company = profile.legalName || '[Company Name]';
  const cityState = [profile.hqCity, profile.hqState].filter(Boolean).join(', ');
  const designation = (profile.certifications && profile.certifications.length)
    ? profile.certifications.join(', ')
    : '[small-business designation(s)]';
  const services = profile.oneLiner || '[core services relevant to this notice]';
  const cityStateLabel = cityState || '[City / State]';
  if (!isRfq) {
    return [
      {
        label: 'Letter of Intent',
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
          blank('Submission deadline'),
          blank('Submission email / portal'),
          blank('Page limit / format instructions'),
          blank('Requested response content / questions from the notice'),
          blank('Required attachments'),
          blank('Capability statement requested? Yes / No / Not stated'),
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
          fill('Primary NAICS code', profile.primaryNaics),
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
  const isSimpleResponsePackage = isLoiPackage || isRfqPackage;
  const rfpName = body.rfpFileName || 'RFP';

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
    ? buildResponseTemplateSections(isRfqPackage ? 'rfq' : 'loi', companyProfile)
    : [];

  const children: (Paragraph | Table)[] = [];

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
