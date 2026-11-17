/**
 * Classification and CUI marking detection for documents entering the Vault.
 *
 * Rule (Eric, 2026-11-17): classified information is prohibited. CUI is not accepted
 * without verified authorization and compliance controls, and none exist today. A
 * file that carries a classification or CUI MARKING is refused and NOTHING is
 * stored: no blob, no row, nothing sent to a model.
 *
 * What counts is a MARKING (EO 13526 / 32 CFR 2002), not the words in prose. Federal
 * RFPs routinely say "the contractor shall safeguard CUI" (DFARS 252.204-7012), carry
 * a "CONTROLLED UNCLASSIFIED INFORMATION" section heading, or require a SECRET
 * clearance. Refusing those would refuse most DoD solicitations, which are the main
 * thing users attach. So the detector looks for:
 *   - BANNER LINES — a line that is nothing but a marking: "SECRET", "TOP SECRET//SCI",
 *     "CONFIDENTIAL//REL TO USA, FVEY", "CUI", "CUI//SP-PRVCY", "UNCLASSIFIED//FOUO",
 *     "FOR OFFICIAL USE ONLY", "NOFORN".
 *   - BANNERS MERGED INTO A LINE by PDF extraction, next to a page number:
 *     "CUI Page 1 of 12 Statement of Work…", "…Page 3 of 9 SECRET".
 *   - CONTROL MARKINGS anywhere: "SECRET//…" (not preceded by another word, so
 *     "COMPANY CONFIDENTIAL//PROPRIETARY" passes), "CUI//…", "//NOFORN", "//SCI" …
 *   - PORTION MARKINGS at the start of a line: "(S//NF)", "(CUI)", and bare
 *     "(S)"/"(C)"/"(TS)" only in a document that also portion-marks "(U)".
 *   - CLASSIFICATION AUTHORITY / CUI DESIGNATION blocks: "Classified By:",
 *     "Declassify On:", "CUI Category:".
 *
 * Header and footer text (where real banners live) is checked as banner text: one
 * occurrence there is enough. A spelled-out "CONTROLLED UNCLASSIFIED INFORMATION" line
 * in the BODY counts only when it repeats (a banner repeats on every page; a section
 * heading appears once). Long lines are scanned too.
 *
 * Bare "CONFIDENTIAL" never counts: commercial proposals are stamped "Company
 * Confidential". Banner forms are case-sensitive (markings are capitals by rule),
 * which keeps "Our secret sauce" and "Secretary of the Army" out. URLs are removed
 * before matching so "HTTPS://WWW.SAM.GOV//SI" is not a control marking.
 */

export type ProhibitedMarkingKind = 'classified' | 'cui';

export interface MarkingVerdict {
  blocked: boolean;
  kind?: ProhibitedMarkingKind;
  /** The marking text as it appeared (trimmed, max 80 chars), for logs and copy. */
  marking?: string;
}

export interface MarkingInput {
  /** Body text (what the extractor returns). */
  body: string;
  /** Page header / footer text, when the format keeps it separately (DOCX). */
  headerFooter?: string;
}

// Dissemination / SCI / CUI control tokens that only appear in marked material.
const CONTROL_TOKENS = '(?:NOFORN|NF|SCI|SI|TK|HCS|ORCON|OC|IMCON|RELIDO|PROPIN|FISA|REL TO|FOUO|LIMDIS|LES|SBU|SP-[A-Z]+|SAR-[A-Z]+|RD|FRD|CNWDI|FED ONLY|FEDCON|NOCON|DL ONLY|DISPLAY ONLY)';
// Page numbers in any common casing ("Page 1 of 12", "PAGE 3", "2 of 9"); the banner token stays case-sensitive.
const PAGE_NO = '(?:(?:Page|PAGE|page)\\s+\\d+(?:\\s+(?:of|OF)\\s+\\d+)?|\\d+\\s+(?:of|OF)\\s+\\d+)';

// ── classified ────────────────────────────────────────────────────────────────
const CLASSIFIED_BANNER = /^(?:TOP SECRET|SECRET)(?:\s*\/\/.*)?$|^CONFIDENTIAL\s*\/\/.*$/;
// Level + "//" counts when (a) nothing word-like precedes it (line start, "(", "//"),
// or (b) a real control marking follows it, wherever it sits ("marked TOP SECRET//HCS").
// A commercial stamp — "COMPANY CONFIDENTIAL//PROPRIETARY", "TRADE SECRET//INTERNAL" —
// has a word before it and no control token after it, so it passes.
const CLASSIFIED_CONTROL = /(?:^|[^A-Za-z ]|\/\/ ?)(?:TOP SECRET|SECRET|CONFIDENTIAL)\s*\/\//;
const CLASSIFIED_CONTROL_TOKEN = new RegExp(`\\b(?:TOP SECRET|SECRET|CONFIDENTIAL)\\s*//\\s*${CONTROL_TOKENS}\\b`);
const CLASSIFIED_MERGED = new RegExp(`^(?:TOP SECRET|SECRET)\\s+${PAGE_NO}\\b|\\b${PAGE_NO}\\s+(?:TOP SECRET|SECRET)$`);
const CLASSIFIED_PORTION = /^\((?:TS|S|C)\/\/[A-Z0-9 ,/-]+\)\s/;
const CLASSIFIED_AUTHORITY = [/^Classified\s+By\s*:/i, /^Declassify\s+On\s*:/i, /^Derived\s+From\s*:.*\b(?:SCG|Security Classification Guide)\b/i];

// ── CUI ───────────────────────────────────────────────────────────────────────
const CUI_BANNER = /^CUI(?:\s*\/\/.*)?$/;
const CUI_SPELLED_BANNER = /^CONTROLLED(?: UNCLASSIFIED INFORMATION)?(?:\s*\/\/.*)?$/;
const CUI_LEGACY = [
  /^UNCLASSIFIED\s*\/\/\s*(?:FOUO|FOR OFFICIAL USE ONLY|LES|SBU|NOFORN|LIMDIS)\b/,
  /^(?:FOR OFFICIAL USE ONLY|FOUO|NOFORN|LAW ENFORCEMENT SENSITIVE|SENSITIVE BUT UNCLASSIFIED)$/,
];
// "CUI//…" anywhere (a control-marked CUI token is never prose); not "SOMECUI//".
const CUI_CONTROL = /(?:^|[^A-Za-z])CUI\s*\/\//;
const CUI_MERGED = new RegExp(`^CUI\\s+${PAGE_NO}\\b|\\b${PAGE_NO}\\s+CUI$`);
const CONTROL_ANYWHERE = new RegExp(`//\\s*${CONTROL_TOKENS}\\b`);
const CUI_PORTION = /^\((?:CUI(?:\/\/[A-Z0-9 ,/-]+)?|U\/\/(?:FOUO|LES|SBU))\)\s/;
const CUI_DESIGNATION = /^CUI\s+Categor(?:y|ies)\s*:/i;

/** Remove URLs so their slashes are never read as control separators. */
function stripUrls(line: string): string {
  return line.replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g, ' ').replace(/\bwww\.\S+/gi, ' ').trim();
}

/** Every non-empty line, URLs removed. No length cap: control markings on long lines count. */
function linesOf(text: string): string[] {
  return (text || '').split(/\r?\n/).map((l) => stripUrls(l.trim())).filter((l) => l.length > 0);
}

const hit = (kind: ProhibitedMarkingKind, line: string): MarkingVerdict => ({ blocked: true, kind, marking: line.slice(0, 80) });

export function detectProhibitedMarkings(input: string | MarkingInput): MarkingVerdict {
  const { body, headerFooter = '' } = typeof input === 'string' ? { body: input } : input;
  const bodyLines = linesOf(body);
  const hfLines = linesOf(headerFooter);
  const all = [...hfLines, ...bodyLines];
  if (all.length === 0) return { blocked: false };

  // Classified first: it is the more serious refusal and its copy differs.
  for (const line of all) {
    if (CLASSIFIED_BANNER.test(line) || CLASSIFIED_CONTROL.test(line) || CLASSIFIED_CONTROL_TOKEN.test(line) || CLASSIFIED_MERGED.test(line) || CLASSIFIED_PORTION.test(line)) return hit('classified', line);
    if (CLASSIFIED_AUTHORITY.some((re) => re.test(line))) return hit('classified', line);
  }
  if (all.some((l) => /^\(U\)\s/.test(l))) {
    const bare = all.find((l) => /^\((?:TS|S|C)\)\s/.test(l));
    if (bare) return hit('classified', bare);
  }

  for (const line of all) {
    if (CUI_BANNER.test(line) || CUI_CONTROL.test(line) || CUI_MERGED.test(line) || CUI_PORTION.test(line) || CUI_DESIGNATION.test(line)) return hit('cui', line);
    if (CONTROL_ANYWHERE.test(line)) return hit('cui', line);
    if (CUI_LEGACY.some((re) => re.test(line))) return hit('cui', line);
  }
  // Spelled-out banner: any occurrence in a header/footer, or a REPEAT in the body.
  const spelledHf = hfLines.find((l) => CUI_SPELLED_BANNER.test(l));
  if (spelledHf) return hit('cui', spelledHf);
  const spelledBody = bodyLines.filter((l) => CUI_SPELLED_BANNER.test(l));
  if (spelledBody.length >= 2) return hit('cui', spelledBody[0]);

  return { blocked: false };
}

/**
 * Header and footer text of a DOCX, one paragraph per line. mammoth's extractRawText
 * (used by the shared extractDocx) drops headers and footers, which is exactly where
 * banners live, so the marking check reads them from the package directly. Used ONLY
 * by the marking check; other extractDocx callers are unchanged.
 */
export async function docxHeaderFooterText(buffer: Buffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), { filter: (f) => /^word\/(header|footer)\d*\.xml$/.test(f.name) });
  } catch {
    return '';
  }
  const out: string[] = [];
  for (const name of Object.keys(files).sort()) {
    const xml = strFromU8(files[name]);
    for (const para of xml.split(/<\/w:p>/)) {
      const text = [...para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
      const decoded = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      if (decoded.trim()) out.push(decoded.trim());
    }
  }
  return out.join('\n');
}

/** User-facing copy. Says why, says nothing was kept. */
export function markingRefusalMessage(kind: ProhibitedMarkingKind): string {
  return kind === 'classified'
    ? 'This file carries a classification marking, so Mindy did not accept it. Classified information can never be uploaded. Nothing from this file was saved.'
    : 'This file carries a CUI (Controlled Unclassified Information) marking, so Mindy did not accept it. Mindy cannot store CUI yet because the required authorization and safeguards are not in place. Nothing from this file was saved.';
}
