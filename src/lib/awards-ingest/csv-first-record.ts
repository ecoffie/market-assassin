/**
 * Bounded read of the first CSV record (one row, may contain quoted newlines).
 * Never loads the whole file — used for multi-GB USASpending split exports.
 */

import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { StagingLoadError } from './staging-errors';

export const DEFAULT_FIRST_RECORD_MAX_BYTES = 1_048_576;

/** Parse one CSV record line/segment (RFC4180-style quotes; commas inside quotes). */
export function parseCsvRecordFields(record: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  const text = record.replace(/^\uFEFF/, '');

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          current += '"';
          index++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current.trim());
  return fields;
}

/** Extract the first complete CSV record from a buffer (may end mid-file). */
export function extractFirstCsvRecord(text: string): { record: string; complete: boolean } {
  let record = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      record += char;
      if (char === '"') {
        if (text[index + 1] === '"') {
          record += text[index + 1];
          index++;
          continue;
        }
        inQuotes = false;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      record += char;
      continue;
    }
    if (char === '\n') {
      return { record: record.replace(/\r$/, ''), complete: true };
    }
    if (char === '\r' && text[index + 1] === '\n') {
      return { record, complete: true };
    }
    record += char;
  }

  return { record: record.replace(/\r$/, ''), complete: !inQuotes && record.length > 0 };
}

export function readBoundedCsvFirstRecord(
  csvPath: string,
  memberBasename: string,
  maxBytes = DEFAULT_FIRST_RECORD_MAX_BYTES,
): string {
  const fd = openSync(csvPath, 'r');
  try {
    const fileSize = fstatSync(fd).size;
    if (fileSize === 0) {
      throw new StagingLoadError('staging_header_read_truncated', memberBasename, 'empty file');
    }

    const chunkSize = Math.min(maxBytes, fileSize);
    const buffer = Buffer.alloc(chunkSize);
    const bytesRead = readSync(fd, buffer, 0, chunkSize, 0);
    const text = buffer.toString('utf8', 0, bytesRead);
    const { record, complete } = extractFirstCsvRecord(text);

    if (!complete || !record) {
      throw new StagingLoadError(
        'staging_header_read_truncated',
        memberBasename,
        `first record exceeds ${maxBytes} bytes or unclosed quote`,
      );
    }
    return record;
  } finally {
    closeSync(fd);
  }
}

/** Test hook: bounded read via injectable reader (simulates large files). */
export function readBoundedCsvFirstRecordVia(
  readChunk: (maxBytes: number) => string,
  memberBasename: string,
  maxBytes = DEFAULT_FIRST_RECORD_MAX_BYTES,
): string {
  const text = readChunk(maxBytes);
  const { record, complete } = extractFirstCsvRecord(text);
  if (!complete || !record) {
    throw new StagingLoadError(
      'staging_header_read_truncated',
      memberBasename,
      `first record exceeds ${maxBytes} bytes or unclosed quote`,
    );
  }
  return record;
}
