/**
 * SOW/PWS detection (#66) — Eric's "in-between" catalog. The SAM cache stores
 * attachments as opaque download URLs (no filename), but FETCHING returns a
 * content-disposition header with the real filename
 * ("Performance Work Statement Commercial ISP.pdf"). So we detect the scope
 * document CHEAPLY by filename — often without extracting the PDF body — and only
 * extract text for the records that have one.
 *
 * The result: a clean ~12K-record corpus (the ~38% of active opps with a doc),
 * biased toward records that actually describe their scope — exactly where work
 * hiding under "funny names" (building envelope = leasing + cyber) lives.
 */
import { extractPdf, extractDocx, extractTxt } from './pdf-extract';

export type SowDocType = 'sow' | 'pws' | 'soo' | 'combined' | 'specs' | null;

// Order matters — most specific first. A filename that says "Performance Work
// Statement" is a PWS even though it also contains "statement".
const TYPE_PATTERNS: [RegExp, Exclude<SowDocType, null>][] = [
  [/performance work statement|\bpws\b/i, 'pws'],
  [/statement of objectives|\bsoo\b/i, 'soo'],
  [/statement of work|scope of work|\bsow\b/i, 'sow'],
  [/combined synopsis/i, 'combined'],
  [/specifications?|requirements? (and|&) specs?|\bspec\b/i, 'specs'],
];

/** Classify a filename → SOW/PWS/SOO/Combined/Specs, or null if not a scope doc. */
export function classifyByFilename(filename: string): SowDocType {
  const f = (filename || '').trim();
  if (!f) return null;
  for (const [re, type] of TYPE_PATTERNS) if (re.test(f)) return type;
  return null;
}

/** Same patterns against extracted document TEXT (first page) — the fallback when
 *  the filename is generic ("Attachment 1.pdf") but the body says SOW/PWS. */
export function classifyByText(text: string): SowDocType {
  const head = (text || '').slice(0, 1500); // first ~page is where the title sits
  for (const [re, type] of TYPE_PATTERNS) if (re.test(head)) return type;
  return null;
}

/** Parse the real filename out of a content-disposition header (RFC 5987 + plain). */
export function filenameFromDisposition(cd: string | null): string {
  if (!cd) return '';
  const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* */ } }
  const plain = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
  return plain ? plain[1].replace(/\+/g, ' ').trim() : '';
}

/** Normalize a SAM attachments value (string[] | object) into download URLs. */
export function attachmentUrls(attachments: unknown): string[] {
  if (!attachments) return [];
  const arr = Array.isArray(attachments) ? attachments : Object.values(attachments as object);
  return arr
    .map(a => (typeof a === 'string' ? a : (a as { url?: string; href?: string })?.url || (a as { href?: string })?.href || ''))
    .filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
}

export interface SowScanResult {
  hasSowDoc: boolean;
  docType: SowDocType;
  text: string | null;       // extracted scope text (only when a SOW/PWS is found)
  filename: string | null;
  attachmentsChecked: number;
}

const MAX_ATTACH_CHECK = 6;          // a bundle rarely has more relevant docs
const MAX_SOW_TEXT = 40_000;         // cap stored scope text

/**
 * Scan one opportunity's attachments for a SOW/PWS. Cheap path: read filenames
 * from content-disposition (a ranged/aborted fetch is enough to get the header).
 * When a scope doc is found by name, download + extract its text for the corpus.
 * Falls back to body-text classification for generically-named files.
 */
export async function scanAttachmentsForSow(urls: string[], apiKey: string): Promise<SowScanResult> {
  const toCheck = urls.slice(0, MAX_ATTACH_CHECK);
  let bestType: SowDocType = null;
  let bestUrl: string | null = null;
  let bestName: string | null = null;
  let checked = 0;

  // Pass 1 (cheap) — classify every attachment by filename only.
  const named: { url: string; filename: string }[] = [];
  for (const url of toCheck) {
    checked++;
    try {
      const res = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
      const filename = filenameFromDisposition(res.headers.get('content-disposition'));
      res.body?.cancel?.();           // don't download the body just to read the header
      if (filename) named.push({ url, filename });
      const type = classifyByFilename(filename);
      if (type && !bestType) { bestType = type; bestUrl = url; bestName = filename; }
    } catch { /* skip this attachment */ }
  }

  // Pass 2 (only if we found a SOW/PWS) — download + extract its text.
  let text: string | null = null;
  if (bestType && bestUrl) {
    text = await downloadAndExtract(bestUrl, bestName || '', apiKey);
  } else if (named.length) {
    // Fallback: no scope doc by name → peek the body of the largest named file.
    const target = named[0];
    const body = await downloadAndExtract(target.url, target.filename, apiKey);
    const type = body ? classifyByText(body) : null;
    if (type) { bestType = type; bestName = target.filename; text = body; }
  }

  return {
    hasSowDoc: !!bestType,
    docType: bestType,
    text: text ? text.slice(0, MAX_SOW_TEXT) : null,
    filename: bestName,
    attachmentsChecked: checked,
  };
}

async function downloadAndExtract(url: string, filename: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.pdf') || buffer.subarray(0, 4).toString() === '%PDF') {
      return (await extractPdf(buffer)).text || null;
    }
    if (lower.endsWith('.docx')) return (await extractDocx(buffer)).text || null;
    if (lower.endsWith('.txt')) return extractTxt(buffer).text || null;
    // Unknown type — try PDF (most common), else give up.
    try { return (await extractPdf(buffer)).text || null; } catch { return null; }
  } catch {
    return null;
  }
}
