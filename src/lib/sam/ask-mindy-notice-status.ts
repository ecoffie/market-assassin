/**
 * What Ask Mindy is allowed to say about a SAM notice.
 *
 * `sam_opportunities.active` means "not archived yet". SAM keeps that flag true
 * past the response deadline (measured 2026-07-11: 55% of active respondable
 * notices were already past deadline). #1557 `deriveSolicitationStatus` stays
 * the solicitation clock: open only when active=true and the deadline is missing
 * or still in the future. This file does not change that function.
 *
 * A missing deadline is not, by itself, "open for responses". Award status and
 * the contract performance period are different clocks and are named as such.
 */
import { classifyNoticeType } from '@/lib/utils/notice-type';
import { deriveSolicitationStatus, solicitationStatusLabel } from '@/lib/sam/resolve-solicitation';

export interface AskMindyNoticeStatusInput {
  active: boolean | null;
  response_deadline: string | null;
  archive_date?: string | null;
  notice_type?: string | null;
  title?: string | null;
}

export function askMindyNoticeStatusLines(
  row: AskMindyNoticeStatusInput,
  now: Date = new Date(),
): string[] {
  const status = deriveSolicitationStatus({
    active: row.active,
    response_deadline: row.response_deadline,
    archive_date: row.archive_date ?? null,
  }, now);
  const kind = classifyNoticeType(row.notice_type, row.title);
  const deadlineMs = row.response_deadline ? Date.parse(row.response_deadline) : NaN;
  const deadlinePassed = Number.isFinite(deadlineMs) && deadlineMs <= now.getTime();
  const lines = [
    `Solicitation status: ${status} (${solicitationStatusLabel(status)}). This is the response window, not an award and not a contract performance period.`,
    `SAM archive flag: ${row.active === true ? 'active (not archived)' : row.active === false ? 'inactive (archived)' : 'not stated'}. The archive flag is not by itself open for responses.`,
  ];
  if (row.active === true && deadlinePassed) {
    lines.push('The response deadline has passed while SAM still lists the notice as not archived. Do not tell the user it is open for responses.');
  }
  if (!row.response_deadline) {
    if (kind.respondability === 'none') {
      lines.push(`No response deadline is recorded. Notice type "${row.notice_type || 'unspecified'}" has nothing to submit. Do not describe it as open for responses.`);
    } else {
      lines.push('No response deadline is recorded. Do not tell the user the notice is open solely because the deadline is missing. Say the deadline is not stated.');
    }
  }
  if (/award/i.test(row.notice_type || '')) {
    lines.push('This is an award notice. Award status comes from the notice type, not from the SAM active flag, and it is not a contract performance period.');
  } else {
    lines.push('Award status is not established by this notice\'s active flag or response deadline.');
  }
  lines.push('Contract performance period is not on this notice. Do not read the response deadline as a period of performance.');
  return lines;
}
