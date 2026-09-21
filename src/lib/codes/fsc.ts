/**
 * FSC/FSG Decode — Federal Supply Classification lookup.
 *
 * An NSN (National Stock Number) is FSC (4-digit Federal Supply Class) + NIIN
 * (9-digit National Item Identification Number). Example: 2915-01-218-7655
 *   - 2915 = FSC "Engine Fuel System Components Aircraft"
 *   - 29   = FSG "Engine Accessories" (the 2-digit group the FSC rolls into)
 *   - 01-218-7655 = the NIIN (unique item identity — not decoded by this table)
 *
 * Data: src/data/fsc-codes.json — 662 FSC codes / 78 FSG groups, bundled from the
 * DLA cataloging FSC/FSG reference (public), cross-verified against two independent
 * public mirrors (armyproperty.com/fsg, everyspec.com/FSC-CODE/). See
 * docs/strategy/PRD-nsn-part-number-codify.md for source detail + the Phase 2/3/4 plan.
 *
 * This is Phase 1 of the "Federal Code Glossary" roadmap (PRD linked above): FSC/FSG
 * is the first bundled lookup table; the same `decodeCode`-style pattern extends to
 * FAR/DFARS clauses, CAGE codes, and other cryptic codes users currently have to Google.
 */
import fscData from '@/data/fsc-codes.json';

export interface FSCDecode {
  fsc: string;
  fscTitle: string;
  fsg: string;
  fsgTitle: string;
}

interface FSCEntry {
  title: string;
  fsg: string;
  fsg_title: string;
}

const data = fscData as {
  lastUpdated: string;
  version: number;
  totalCodes: number;
  totalGroups: number;
  groups: Record<string, string>;
  codes: Record<string, FSCEntry>;
};

/**
 * Decode a bare 4-digit FSC or a full NSN string down to its FSC/FSG.
 * Accepts:
 *   - a bare 4-digit FSC: "2915"
 *   - a formatted NSN: "2915-01-218-7655"
 *   - an unformatted NSN: "2915012187655"
 *   - with or without an "NSN" prefix/label
 * Returns null if the leading 4 digits aren't in the table (unknown/retired class)
 * or the input doesn't contain at least 4 digits.
 */
export function decodeFSC(codeOrNsn: string | null | undefined): FSCDecode | null {
  if (!codeOrNsn) return null;
  const digits = String(codeOrNsn).replace(/\D/g, '');
  if (digits.length < 4) return null;
  const fsc = digits.slice(0, 4);
  const entry = data.codes[fsc];
  if (!entry) return null;
  return {
    fsc,
    fscTitle: entry.title,
    fsg: entry.fsg,
    fsgTitle: entry.fsg_title,
  };
}

/** Look up an FSG (2-digit group) title directly, e.g. "29" -> "Engine Accessories". */
export function getFSGTitle(fsg: string | null | undefined): string | null {
  if (!fsg) return null;
  return data.groups[fsg] ?? null;
}

/**
 * Find NSN-shaped substrings in free text (opportunity titles/descriptions/SOWs).
 * Matches, in order of specificity:
 *   1. "NSN: 2915-01-218-7655" / "NSN 2915-01-218-7655" (explicit label + formatted)
 *   2. "2915-01-218-7655" (formatted, unlabeled — the FSC-NIIN dash pattern)
 *   3. "2915-012187655" (FSC dash + 9-digit NIIN run-together)
 *   4. "NSN_6115012345860HY" / "NSN: 1680994354135KT" (fully unformatted 13-digit run,
 *      only near an "NSN" label — separated by `[:_\s#]*` rather than a `\b` word
 *      boundary, since real listings glue "NSN" to the digits with an underscore, and
 *      the digits themselves are often immediately followed by a 1-3 letter suffix
 *      code like "HY"/"KT"/"FD" with no boundary between digit and letter)
 * Returns the raw matched NSN strings (not deduped beyond exact-string dedup) so a
 * caller can decode each with decodeFSC().
 */
export function extractNSNs(text: string | null | undefined): string[] {
  if (!text) return [];

  const found = new Set<string>();

  // Labeled or unlabeled formatted NSN: ####-##-###-####, with an optional "NSN" /
  // "NSN:" / "NSN#" label captured but not required.
  const formatted = /\b(?:nsn\s*:?\s*#?\s*)?(\d{4}-\d{2}-\d{3}-\d{4})\b/gi;
  for (const m of text.matchAll(formatted)) found.add(m[1]);

  // FSC dash + 9-digit NIIN run together: ####-#########
  const dashRun = /\b(?:nsn\s*:?\s*#?\s*)?(\d{4}-\d{9})\b/gi;
  for (const m of text.matchAll(dashRun)) found.add(m[1]);

  // Fully unformatted 13-digit run — only trust this near an explicit "NSN" label,
  // since a bare 13-digit number elsewhere (phone/PO/tracking number) is not an NSN.
  // Neither the boundary BEFORE "nsn" nor the separator after it can rely on `\b`:
  // real listings glue an underscore straight onto "NSN" on both sides
  // ("F15_NSN_6115012345860HY" — underscore is a \w char, so \b never fires there),
  // and the digit run is often immediately followed by a letter suffix code with no
  // boundary either. Use lookarounds keyed on "not a letter/digit" instead of \b.
  const bareLabeled = /(?<![a-z0-9])nsn[:_\s#]*(\d{13})(?=[^0-9]|$)/gi;
  for (const m of text.matchAll(bareLabeled)) found.add(m[1]);

  return [...found];
}

export function isFscTableLoaded(): boolean {
  return data.totalCodes > 0;
}

export function getFscTableInfo() {
  return {
    lastUpdated: data.lastUpdated,
    version: data.version,
    totalCodes: data.totalCodes,
    totalGroups: data.totalGroups,
  };
}
