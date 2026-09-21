/**
 * SOW/PWS/SOO extraction primitives — shared by the in-app export route
 * (`/api/app/proposal/extract-sow`, which turns the result into a .docx for subs)
 * and the MCP tool (`extract_statement_of_work`, which returns the text).
 *
 * Two pure detectors, no IO:
 *  - extractSow(text): find the Statement of Work / PWS / SOO / Section C block in a
 *    solicitation by heading, captured until the next top-level section heading.
 *  - buildClinScope(pricingText): reconstruct a readable scope from a CLIN/pricing
 *    schedule when there is no standalone SOW ("the CLINs tell you what the work is").
 *
 * Factored out of the route (Jul 2026) so both callers share one detector.
 */

// Headings that START a SOW/PWS/SOO block.
const START_RE = /(STATEMENT\s+OF\s+WORK|PERFORMANCE\s+WORK\s+STATEMENT|STATEMENT\s+OF\s+OBJECTIVES|\bP\.?W\.?S\.?\b|\bS\.?O\.?W\.?\b|SECTION\s+C\b|^C\.\s)/im;
// Headings that END it (the next major section).
const END_RE = /(SECTION\s+[D-M]\b|^[D-M]\.\s|INSTRUCTIONS\s+TO\s+OFFERORS|EVALUATION\s+FACTORS|CONTRACT\s+CLAUSES|LIST\s+OF\s+ATTACHMENTS)/im;

/** Minimum captured length for a real SOW block — shorter is treated as a TOC ref. */
export const SOW_MIN_CHARS = 400;

export interface SowDetection {
  found: boolean;
  title: string;
  body: string;
}

/** Detect the SOW/PWS/SOO block in a solicitation body by heading boundaries. */
export function extractSow(text: string): SowDetection {
  const startM = START_RE.exec(text);
  if (!startM) return { found: false, title: 'Statement of Work', body: '' };
  const startIdx = startM.index;
  // Look for the end heading AFTER the start.
  const after = text.slice(startIdx + startM[0].length);
  const endM = END_RE.exec(after);
  const endIdx = endM ? startIdx + startM[0].length + endM.index : text.length;
  const body = text.slice(startIdx, endIdx).trim();
  const title = /performance\s+work/i.test(startM[0])
    ? 'Performance Work Statement'
    : /objectives/i.test(startM[0])
      ? 'Statement of Objectives'
      : 'Statement of Work';
  // Guard: if the captured block is tiny, treat as not-found (likely a TOC ref).
  if (body.length < SOW_MIN_CHARS) return { found: false, title, body: '' };
  return { found: true, title, body };
}

/**
 * Build a "Scope at a Glance" from a CLIN/pricing schedule — the CLINs tell you what
 * the work is. Parses "CLIN, Description, …" rows into a readable scope list a sub can
 * act on. Returns null if no CLIN rows are found.
 */
export function buildClinScope(pricingText: string): string | null {
  const lines = pricingText.split('\n');
  const items: string[] = [];
  for (const line of lines) {
    // CLIN row: a 4-digit CLIN, then a description that may be QUOTED (with internal
    // commas — room lists) or unquoted. Capture the quoted form first.
    let m = line.match(/^[",\s]*(\d{4}[A-Z]?)\s*,\s*"([^"]{12,})"/); // quoted desc
    if (!m) m = line.match(/^[",\s]*(\d{4}[A-Z]?)\s*,\s*([^",][^,]{11,}?)\s*,/); // unquoted
    if (m) {
      const desc = m[2].replace(/\s+/g, ' ').trim();
      if (desc && !/^\$?0?\.?0+$/.test(desc)) items.push(`CLIN ${m[1]}: ${desc}`);
    }
  }
  if (items.length === 0) return null;
  return [
    'This scope is reconstructed from the solicitation’s pricing schedule (CLINs). Each line is a unit of work the contractor must price and perform. Use it to brief subcontractors — then confirm details against the full solicitation + drawings.',
    '',
    ...items,
  ].join('\n');
}
