/**
 * Deterministic BigQuery staging schema for USASpending bulk CSVs.
 *
 * Autodetect infers sparsely populated phone/fax/ZIP/ID columns as INT64 from early
 * numeric-looking rows, then fails when a later row carries formatted text like
 * "(626) 440-2724". Staging loads every source column as STRING; typed casts happen
 * only in the MERGE SELECT (SAFE_CAST / CAST).
 */

export type BqStringField = {
  name: string;
  type: 'STRING';
  mode: 'NULLABLE';
};

/** Strip BOM and split a one-line CSV header (USASpending bulk headers are unquoted). */
export function parseCsvHeaderLine(line: string): string[] {
  const names = line.replace(/^\uFEFF/, '').split(',').map((name) => name.trim());
  if (names.length === 0 || names.some((name) => !name)) {
    throw new Error('invalid CSV header: empty column name');
  }
  return names;
}

export function buildStringStagingSchema(headerLine: string): BqStringField[] {
  return parseCsvHeaderLine(headerLine).map((name) => ({
    name,
    type: 'STRING',
    mode: 'NULLABLE',
  }));
}

export function assertCsvHeadersMatch(firstHeaderLine: string, otherHeaderLine: string): void {
  const first = parseCsvHeaderLine(firstHeaderLine);
  const other = parseCsvHeaderLine(otherHeaderLine);
  if (first.length !== other.length || first.some((col, index) => col !== other[index])) {
    throw new Error('split export CSV headers do not match — refusing append load');
  }
}

export function readCsvHeaderLineFromFile(readFirstLine: (path: string) => string, csvPath: string): string {
  const line = readFirstLine(csvPath).replace(/\r?\n$/, '');
  if (!line) throw new Error(`empty CSV header: ${csvPath}`);
  return line;
}
