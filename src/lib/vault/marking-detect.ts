/**
 * Classification and CUI marking detection for documents entering the Vault.
 *
 * Rule (Eric, 2026-11-17): classified information is prohibited. CUI is not accepted
 * without verified authorization and compliance controls, and none exist today. A
 * file that carries a classification or CUI MARKING is refused and NOTHING is
 * stored: no blob, no row.
 *
 * What counts as a marking: the banner and portion markings defined by EO 13526 /
 * 32 CFR 2002, not the words in prose. Federal RFPs routinely say "the contractor
 * shall safeguard CUI" (DFARS 252.204-7012) or describe a SECRET facility clearance
 * requirement. Refusing those would refuse most DoD solicitations, which the user
 * is entitled to upload. So the detector looks for:
 *   - BANNER LINES: a line that is nothing but a marking
 *       "SECRET", "TOP SECRET//SCI", "CONFIDENTIAL//REL TO USA, FVEY", "CUI",
 *       "CUI//SP-PRVCY", "CONTROLLED UNCLASSIFIED INFORMATION", "UNCLASSIFIED//FOUO",
 *       "FOR OFFICIAL USE ONLY", "NOFORN"
 *   - CONTROL MARKINGS anywhere: "SECRET//", "//NOFORN", "//SCI", "//ORCON" …
 *   - PORTION MARKINGS at the start of a line: "(S)", "(TS//SI)", "(C//NF)", "(CUI)"
 *   - CLASSIFICATION AUTHORITY / CUI DESIGNATION blocks: "Classified By:",
 *     "Declassify On:", "CUI Category:"
 *
 * Bare "CONFIDENTIAL" is deliberately NOT a marking on its own: commercial proposals
 * and capability statements are stamped "Company Confidential" all the time. It is
 * a marking only with a control separator ("CONFIDENTIAL//…") or as a portion mark.
 *
 * Detection is case-sensitive for the banner/portion forms (markings are written in
 * capitals by rule), which is what keeps "Our secret sauce" from matching.
 */

export type ProhibitedMarkingKind = 'classified' | 'cui';

export interface MarkingVerdict {
  blocked: boolean;
  kind?: ProhibitedMarkingKind;
  /** The marking text as it appeared (trimmed, max 80 chars), for logs and copy. */
  marking?: string;
}

const CLASSIFIED_LEVEL = '(?:TOP SECRET|SECRET|CONFIDENTIAL)';
// Dissemination / SCI control tokens that only appear in marked material.
const CONTROL_TOKENS = '(?:NOFORN|NF|SCI|SI|TK|HCS|ORCON|OC|IMCON|RELIDO|PROPIN|FISA|REL TO[A-Z ,]*|FOUO|LIMDIS|SP-[A-Z]+|SAR-[A-Z]+|RD|FRD|CNWDI)';

const CLASSIFIED_PATTERNS: RegExp[] = [
  // Banner: the whole line is a level, optionally with //controls.
  new RegExp(`^${'(?:TOP SECRET|SECRET)'}(?:\\s*//.*)?$`),
  new RegExp(`^CONFIDENTIAL\\s*//.*$`),
  // Level immediately followed by a control separator, anywhere on the line.
  new RegExp(`\\b${CLASSIFIED_LEVEL}//`),
  // Portion marking WITH controls at line start: (S//NF) (C//REL) (TS//SI-G//NF).
  // Bare (TS)/(S)/(C) are handled separately below — "(A) … (B) … (C)" outline
  // lists are everywhere in solicitations.
  /^\((?:TS|S|C)\/\/[A-Z0-9 ,/-]+\)\s/,
  // Classification authority block.
  /^\s*Classified\s+By\s*:/i,
  /^\s*Declassify\s+On\s*:/i,
  /^\s*Derived\s+From\s*:.*\b(?:SCG|Security Classification Guide)\b/i,
];

const CUI_PATTERNS: RegExp[] = [
  // Banner: CUI, CUI//SP-XXX, CONTROLLED, CONTROLLED UNCLASSIFIED INFORMATION.
  /^CUI(?:\s*\/\/.*)?$/,
  /^CONTROLLED(?: UNCLASSIFIED INFORMATION)?(?:\s*\/\/.*)?$/,
  // Legacy markings superseded by CUI, still widely stamped.
  /^UNCLASSIFIED\s*\/\/\s*(?:FOUO|FOR OFFICIAL USE ONLY|LES|SBU|NOFORN|LIMDIS)/,
  /^(?:FOR OFFICIAL USE ONLY|FOUO|NOFORN|LAW ENFORCEMENT SENSITIVE|SENSITIVE BUT UNCLASSIFIED)$/,
  // Control token after a separator anywhere (e.g. "...//NOFORN").
  // (?<!:) so a URL scheme ("HTTP://RD.GOV") is never read as a control marking.
  new RegExp(`(?<!:)//\\s*${CONTROL_TOKENS}\\b`),
  // Portion marking at line start: (CUI) (CUI//SP-PRVCY) (U//FOUO)
  /^\((?:CUI(?:\/\/[A-Z0-9 ,/-]+)?|U\/\/(?:FOUO|LES|SBU))\)\s/,
  // CUI designation indicator block.
  /^\s*CUI\s+Category\s*:/i,
  /^\s*Controlled\s+by\s*:.*$/i,
];

/** Lines to inspect: banners live at the top/bottom of pages, but scan every line. */
function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && l.length <= 200);
}

export function detectProhibitedMarkings(text: string): MarkingVerdict {
  if (!text) return { blocked: false };
  const ls = lines(text);
  // "Controlled by:" only counts as a CUI designation indicator when a CUI
  // category/marking is also present — otherwise it is ordinary prose
  // ("Controlled by: the program office").
  const hasCuiWord = /\bCUI\b/.test(text);
  for (const line of ls) {
    for (const re of CLASSIFIED_PATTERNS) {
      if (re.test(line)) return { blocked: true, kind: 'classified', marking: line.slice(0, 80) };
    }
  }
  // Bare portion marks (TS)/(S)/(C) count only inside a portion-marked document,
  // i.e. one that also marks paragraphs "(U)". Outline letters never come with (U).
  if (ls.some((l) => /^\(U\)\s/.test(l))) {
    const bare = ls.find((l) => /^\((?:TS|S|C)\)\s/.test(l));
    if (bare) return { blocked: true, kind: 'classified', marking: bare.slice(0, 80) };
  }
  for (const line of ls) {
    for (const re of CUI_PATTERNS) {
      if (re.source.startsWith('^\\s*Controlled') && !hasCuiWord) continue;
      if (re.test(line)) return { blocked: true, kind: 'cui', marking: line.slice(0, 80) };
    }
  }
  return { blocked: false };
}

/** User-facing copy. Says why, says nothing was kept. */
export function markingRefusalMessage(kind: ProhibitedMarkingKind): string {
  return kind === 'classified'
    ? 'This file carries a classification marking, so Mindy did not accept it. Classified information can never be uploaded. Nothing from this file was saved.'
    : 'This file carries a CUI (Controlled Unclassified Information) marking, so Mindy did not accept it. Mindy cannot store CUI yet because the required authorization and safeguards are not in place. Nothing from this file was saved.';
}
