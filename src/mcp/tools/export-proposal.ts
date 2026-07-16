/**
 * MCP tool: export_proposal — turn supplied proposal sections into a clean,
 * downloadable .docx (base64). The last step of the proposal chain: draft_proposal
 * (or the agent's own sections) → export_proposal → a Word file the user can submit.
 *
 * Self-contained: it builds the document directly with the `docx` library rather
 * than reusing /api/app/proposal/export (that route is Supabase/2FA-auth-tied and
 * loads the logged-in user's Vault). This tool is stateless — it only formats the
 * sections it is given, so any MCP agent can call it.
 *
 * tier: metered, credits: 2. `_meta` always ships; `_ai_hint` OFF by default.
 * grounded=false when no sections are supplied (nothing to build) — never invent
 * content to fill an empty document.
 */
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import { mcpFlags } from '@/lib/mcp/flags';

/** Defensive cap on total input text (~200K chars) so a runaway payload can't
 *  blow up the packer. Applied across all sections combined. */
const MAX_TOTAL_CHARS = 200_000;

export interface ExportProposalInput {
  title?: string;
  sections: Array<{ heading: string; text: string }>;
}

export interface ExportProposalResult {
  filename: string;
  mime: string;
  docx_base64: string;
  byte_size: number;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    section_count: number;
  };
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Split a section body into paragraphs on blank lines (double newlines). */
function bodyParagraphs(text: string): Paragraph[] {
  const blocks = (text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return [];
  return blocks.map((b) => new Paragraph({ children: [new TextRun({ text: b })], spacing: { after: 160 } }));
}

export async function exportProposal(input: ExportProposalInput): Promise<ExportProposalResult> {
  const title = (input.title || '').trim();
  // Keep only sections that carry real content, and cap the total text defensively.
  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const sections: Array<{ heading: string; text: string }> = [];
  let used = 0;
  for (const s of rawSections) {
    if (!s || typeof s.heading !== 'string' || typeof s.text !== 'string') continue;
    const heading = s.heading.trim();
    let text = s.text;
    if (!heading && !text.trim()) continue;
    if (used + text.length > MAX_TOTAL_CHARS) text = text.slice(0, Math.max(0, MAX_TOTAL_CHARS - used));
    used += text.length;
    sections.push({ heading: heading || 'Section', text });
    if (used >= MAX_TOTAL_CHARS) break;
  }

  // Nothing to build — honest miss. Return an empty document reference (626 note),
  // grounded=false, and NEVER fabricate content to fill it.
  if (sections.length === 0) {
    const result: ExportProposalResult = {
      filename: 'proposal.docx',
      mime: DOCX_MIME,
      docx_base64: '',
      byte_size: 0,
      _meta: { grounded: false, degraded: false, section_count: 0 },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: 'No sections were supplied — there is nothing to export (626: empty document).',
        how_to_use: 'Pass sections[] (each { heading, text }) from draft_proposal or your own drafted content. Do NOT invent sections to fill an empty file.',
        key_caveats: ['grounded=false means no document was built, not that a blank one is valid to submit.'],
      };
    }
    return result;
  }

  const children: Paragraph[] = [];
  if (title) {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })], spacing: { after: 240 } }));
  }
  for (const s of sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: s.heading, bold: true })], spacing: { before: 200, after: 120 } }));
    const paras = bodyParagraphs(s.text);
    if (paras.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    } else {
      children.push(...paras);
    }
  }

  const doc = new Document({
    creator: 'Mindy',
    title: title || 'Proposal',
    description: 'Proposal document assembled by Mindy from the supplied sections.',
    sections: [{ children }],
  });

  let docx_base64 = '';
  let byte_size = 0;
  let degraded = false;
  try {
    const buffer = await Packer.toBuffer(doc);
    docx_base64 = Buffer.from(buffer).toString('base64');
    byte_size = buffer.byteLength;
  } catch (err) {
    console.error('[export-proposal] packer failed', err);
    degraded = true;
  }

  const grounded = !degraded && byte_size > 0;

  const result: ExportProposalResult = {
    filename: 'proposal.docx',
    mime: DOCX_MIME,
    docx_base64,
    byte_size,
    _meta: { grounded, degraded, section_count: sections.length },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? 'The document could not be assembled (packer error) — retry shortly.'
        : `Built a .docx with ${sections.length} section(s)${title ? ` titled "${title}"` : ''} (${byte_size.toLocaleString()} bytes).`,
      how_to_use: 'Decode docx_base64 (base64 → binary) and save it as the given filename with the given mime type. It contains exactly the sections you supplied — nothing was added or invented.',
      key_caveats: [
        'This tool only FORMATS the sections you pass; it does not draft, verify, or compliance-check them.',
        'Any [placeholders] in the supplied text are carried through verbatim — fill them before submission.',
      ],
    };
  }
  return result;
}
