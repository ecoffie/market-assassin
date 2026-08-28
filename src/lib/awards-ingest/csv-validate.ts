import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type CsvValidation =
  | { status: 'loadable'; dataRows: number }
  | { status: 'empty_acquisition'; dataRows: 0 };

function fromDataRowCount(dataRows: number): CsvValidation {
  return dataRows > 0
    ? { status: 'loadable', dataRows }
    : { status: 'empty_acquisition', dataRows: 0 };
}

/** Count non-empty lines. First line is the header; remaining lines are data rows. */
export function validateCsvText(csv: string): CsvValidation {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return fromDataRowCount(Math.max(0, lines.length - 1));
}

export async function validateCsvFile(path: string): Promise<CsvValidation> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let lineCount = 0;
  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    lineCount += 1;
    // Header + one data row is enough to prove the acquisition is non-empty.
    if (lineCount >= 2) {
      rl.close();
      return fromDataRowCount(1);
    }
  }
  return fromDataRowCount(Math.max(0, lineCount - 1));
}
