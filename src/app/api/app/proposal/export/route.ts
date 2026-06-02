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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function buildResponseTemplateSections(kind: 'loi' | 'rfq'): Array<{ label: string; draft: string }> {
  const isRfq = kind === 'rfq';
  if (!isRfq) {
    return [
      {
        label: 'Letter of Intent / Statement of Capability',
        draft: [
          blank('Date'),
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
          '[Company Name], a [City / State]-based [small-business designation(s)], is pleased to submit this Letter of Intent / Statement of Capability to demonstrate its intention and ability to support the above-referenced requirement.',
          '',
          '[Company Name] has successfully completed work of similar scope and size for [agency / customer types]. We specialize in [core services relevant to this notice]. Our team is prepared to provide the personnel, management, and technical capability required for this effort.',
          '',
          'Following is a Summary of Qualifications along with the requested submittal information.',
        ].join('\n'),
      },
      {
        label: 'Submittal Requirements',
        draft: [
          'Submittal Intention: [Company Name] has reviewed this opportunity and is interested in providing services for the above-referenced project. Our team has relevant experience in [similar project type / location / customer environment].',
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
          blank('Company legal name'),
          blank('Number of employees'),
          blank('Office location'),
          blank('Single bonding capacity / insurance information if requested'),
          blank('Aggregate bonding capacity if requested'),
          blank('UEI number'),
          blank('CAGE code'),
          blank('Primary NAICS code'),
          blank('Small business designation / status claimed'),
        ].join('\n'),
      },
      {
        label: 'Responsible Office / Contact Person',
        draft: [
          blank('Responsible office / company address'),
          blank('Contact person'),
          blank('Title'),
          blank('Phone'),
          blank('Email'),
          blank('Website'),
        ].join('\n'),
      },
      {
        label: 'Relevant Experience',
        draft: [
          'Project 1',
          blank('Contract / project title'),
          blank('Role: Prime / Subcontractor'),
          blank('Agency / customer'),
          blank('Contract value'),
          blank('Period of performance'),
          blank('Point of contact'),
          blank('Telephone / email'),
          blank('Timeliness of performance'),
          blank('Customer satisfaction / CPARS / performance result'),
          blank('Scope and relevance to this requirement'),
          '',
          'Project 2',
          blank('Contract / project title'),
          blank('Role: Prime / Subcontractor'),
          blank('Agency / customer'),
          blank('Contract value'),
          blank('Period of performance'),
          blank('Point of contact'),
          blank('Telephone / email'),
          blank('Timeliness of performance'),
          blank('Customer satisfaction / CPARS / performance result'),
          blank('Scope and relevance to this requirement'),
          '',
          'Project 3',
          blank('Contract / project title'),
          blank('Role: Prime / Subcontractor'),
          blank('Agency / customer'),
          blank('Contract value'),
          blank('Period of performance'),
          blank('Point of contact'),
          blank('Telephone / email'),
          blank('Timeliness of performance'),
          blank('Customer satisfaction / CPARS / performance result'),
          blank('Scope and relevance to this requirement'),
        ].join('\n'),
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
        blank('Date'),
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
        `[Company Name] is pleased to submit this ${isRfq ? 'RFQ response' : 'Letter of Intent / Statement of Capability'} for the above-referenced requirement.`,
        '',
        blank('One-sentence summary of fit'),
        blank('Primary NAICS / business designation'),
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
        blank('Company legal name'),
        blank('Office location'),
        blank('Number of employees'),
        blank('UEI number'),
        blank('CAGE code'),
        blank('Small business designation / status claimed'),
        blank('Bonding capacity / insurance information if requested'),
      ].join('\n'),
    },
    {
      label: 'Responsible Office / Contact Person',
      draft: [
        blank('Responsible office'),
        blank('Contact person'),
        blank('Title'),
        blank('Phone'),
        blank('Email'),
        blank('Website'),
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
  const orderedSections = sectionOrder.filter(id => drafts[id]?.draft);
  const templateSections = orderedSections.length === 0 && isSimpleResponsePackage
    ? buildResponseTemplateSections(isRfqPackage ? 'rfq' : 'loi')
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
