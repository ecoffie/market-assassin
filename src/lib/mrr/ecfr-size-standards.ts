/**
 * SBA size standards read from the codified regulation itself: 13 CFR 121.201
 * on eCFR (the Office of the Federal Register's official electronic CFR).
 *
 * WHY: the versioned fixture held ONE code (541512). Any other NAICS — 236220
 * in the Vandenberg demo — printed "Unknown". A guessed threshold can flip a
 * set-aside, so the value must come from the regulation, with the date the
 * regulation text was current as of and the date the section last changed.
 *
 * eCFR versioner API (no key). The /full endpoint REQUIRES a compressed
 * response (it returns HTTP 406 to a request without Accept-Encoding).
 */
import { gunzipSync } from 'node:zlib';

const ECFR = 'https://www.ecfr.gov/api/versioner/v1';
export const ECFR_SECTION_URL = 'https://www.ecfr.gov/current/title-13/section-121.201';

export interface EcfrSizeRow {
  naics: string;
  title: string;
  /** Millions of dollars of average annual receipts, when the row is receipts-based. */
  receiptsMillions: number | null;
  /** Employee count, when the row is employee-based. */
  employees: number | null;
  /** "541330 (Exception 1)" rows: a different threshold applies to these requirements. */
  exceptions: Array<{ label: string; title: string; receiptsMillions: number | null; employees: number | null }>;
}

export interface EcfrSizeTable {
  /** Date the eCFR text was current as of (the version that was read). */
  asOf: string;
  /** Date §121.201 was last amended, per eCFR's version history. */
  lastAmended: string | null;
  rows: Record<string, EcfrSizeRow>;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function cellText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x2014;|&mdash;/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse the §121.201 table. Columns: NAICS · title · $ millions · employees. */
export function parseSizeStandardTable(xml: string): Record<string, EcfrSizeRow> {
  const rows: Record<string, EcfrSizeRow> = {};
  for (const tr of xml.match(/<TR>[\s\S]*?<\/TR>/g) ?? []) {
    const cells = [...tr.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/g)].map((m) => cellText(m[1]));
    if (cells.length < 4) continue;
    const exception = /^(\d{6})\s*\((Exception[^)]*)\)$/i.exec(cells[0]);
    const code = exception ? exception[1] : cells[0];
    if (!/^\d{6}$/.test(code)) continue;
    const receipts = parseNumber(cells[2]);
    const employees = parseNumber(cells[3]);
    if (receipts == null && employees == null) continue;
    if (exception) {
      rows[code]?.exceptions.push({ label: exception[2], title: cells[1], receiptsMillions: receipts, employees });
      continue;
    }
    if (rows[code]) continue;
    rows[code] = { naics: code, title: cells[1], receiptsMillions: receipts, employees, exceptions: [] };
  }
  return rows;
}

async function readText(res: Response): Promise<string> {
  // fetch() normally decompresses; tolerate a raw gzip body as well.
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

export async function fetchEcfrSizeTable(fetcher: Fetcher = fetch): Promise<EcfrSizeTable> {
  const titlesRes = await fetcher(`${ECFR}/titles.json`, { headers: { Accept: 'application/json' } });
  if (!titlesRes.ok) throw new Error(`eCFR titles HTTP ${titlesRes.status}`);
  const titles = (await titlesRes.json()) as {
    titles?: Array<{ number: number; up_to_date_as_of?: string }>;
  };
  const asOf = titles.titles?.find((t) => t.number === 13)?.up_to_date_as_of;
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('eCFR did not report a current date for title 13');

  const fullRes = await fetcher(
    `${ECFR}/full/${asOf}/title-13.xml?part=121&section=121.201`,
    { headers: { Accept: 'application/xml', 'Accept-Encoding': 'gzip' } },
  );
  if (!fullRes.ok) throw new Error(`eCFR §121.201 HTTP ${fullRes.status}`);
  const rows = parseSizeStandardTable(await readText(fullRes));
  if (Object.keys(rows).length < 500) {
    throw new Error(`eCFR §121.201 table parsed only ${Object.keys(rows).length} rows`);
  }

  let lastAmended: string | null = null;
  try {
    const versionsRes = await fetcher(`${ECFR}/versions/title-13.json?section=121.201`, {
      headers: { Accept: 'application/json' },
    });
    if (versionsRes.ok) {
      const versions = (await versionsRes.json()) as {
        content_versions?: Array<{ amendment_date?: string; substantive?: boolean }>;
      };
      const dates = (versions.content_versions ?? [])
        .filter((v) => v.substantive !== false && typeof v.amendment_date === 'string')
        .map((v) => v.amendment_date as string)
        .sort();
      lastAmended = dates.at(-1) ?? null;
    }
  } catch {
    lastAmended = null;
  }

  return { asOf, lastAmended, rows };
}
