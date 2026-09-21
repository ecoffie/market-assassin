/**
 * Classify the first record of a split USASpending export member against file-1 header.
 */

import { parseCsvRecordFields } from './csv-first-record';
import { StagingLoadError } from './staging-errors';

export type SplitMemberLeadKind = 'matching_header' | 'headerless_data';

export type SplitMemberLead = {
  kind: SplitMemberLeadKind;
  skipLeadingRows: 0 | 1;
};

const USASPENDING_TXN_KEY = 'contract_transaction_unique_key';

export function parseCsvHeaderColumns(headerRecord: string): string[] {
  const names = parseCsvRecordFields(headerRecord);
  if (names.length === 0 || names.some((name) => !name)) {
    throw new Error('invalid CSV header: empty column name');
  }
  return names;
}

export function headerColumnsMatch(authoritative: string[], candidate: string[]): boolean {
  return authoritative.length === candidate.length
    && authoritative.every((col, index) => col === candidate[index]);
}

/** True when every field looks like a USASpending column identifier (not a transaction row). */
export function looksLikeColumnHeaderRow(fields: string[]): boolean {
  if (fields.length < 3) return false;
  const identifier = /^[a-z][a-z0-9_]*$/i;
  return fields.every((field) => identifier.test(field) && field.length <= 128);
}

/** True when the first field is a bulk-export transaction key value, not the column name. */
export function looksLikeUsaspendingTransactionRow(fields: string[]): boolean {
  const first = fields[0]?.trim();
  if (!first) return false;
  if (first === USASPENDING_TXN_KEY) return false;
  if (first.startsWith('CONT_')) return true;
  if (first.startsWith('CONT_IDV_')) return true;
  return false;
}

export function classifySplitExportMemberLead(
  authoritativeHeader: string[],
  firstRecord: string,
  memberBasename: string,
): SplitMemberLead {
  const fields = parseCsvRecordFields(firstRecord);

  if (headerColumnsMatch(authoritativeHeader, fields)) {
    return { kind: 'matching_header', skipLeadingRows: 1 };
  }

  if (looksLikeColumnHeaderRow(fields)) {
    throw new StagingLoadError(
      'staging_conflicting_header',
      memberBasename,
      `first record has ${fields.length} column identifiers but does not match file-1 header`,
    );
  }

  if (looksLikeUsaspendingTransactionRow(fields)
    || (fields.length === authoritativeHeader.length && fields[0] !== authoritativeHeader[0])) {
    return { kind: 'headerless_data', skipLeadingRows: 0 };
  }

  throw new StagingLoadError(
    'staging_unrecognized_lead',
    memberBasename,
    `first record has ${fields.length} fields; cannot classify as header or data`,
  );
}

/**
 * Run #6 planner required identical headers on every member; when file 2 is headerless
 * (first field CONT_*), the naive compare fails before any bq load.
 */
export function legacyPlannerHeaderMismatchReason(
  authoritativeHeader: string[],
  memberFirstRecord: string,
): string | null {
  const fields = parseCsvRecordFields(memberFirstRecord);
  if (headerColumnsMatch(authoritativeHeader, fields)) return null;
  return 'split export CSV headers do not match — refusing append load';
}
