/**
 * Wording for the throughput-digest "Briefing entitlement" line.
 *
 * The old line said "N users have briefings_enabled but NO customer_classifications
 * row". It was wrong in three ways: its entitled set held only ENTITLING rows, so a
 * user WITH a row of access free/none/excluded was reported as having no row; it
 * ignored briefings_expiry, so an expired paid row read as entitled; and it counted
 * synthetic Coach-Mode workspace addresses as customers. The split below comes from
 * classifyBriefingClassificationDrops(), which calls the sender's own
 * isBriefingEntitled() predicate, so the monitor and the sender cannot disagree.
 */
import type { ClassificationDropReport } from './delivery/rollout';

/** The customer-facing drop: everything except synthetic coach workspace rows. */
export function customerDropCount(report: ClassificationDropReport): number {
  return report.droppedByClassification - report.coachWorkspace;
}

export function describeBriefingClassificationDrops(
  report: ClassificationDropReport,
  syntheticIgnored = 0,
): string {
  const dropped = customerDropCount(report);
  const extras: string[] = [];
  if (report.coachWorkspace > 0) extras.push(`+${report.coachWorkspace} coach workspace address(es) excluded`);
  if (syntheticIgnored > 0) extras.push(`+${syntheticIgnored} test/healthcheck accounts ignored`);
  const suffix = extras.length ? ` (${extras.join('; ')})` : '';

  if (dropped === 0) {
    return `every briefings-enabled user passes the sender's classification gate${suffix}`;
  }

  const parts: string[] = [];
  if (report.noRow > 0) parts.push(`no_row ${report.noRow}`);
  for (const [access, n] of Object.entries(report.notEntitling).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    parts.push(`not_entitling:${access} ${n}`);
  }
  if (report.expired > 0) parts.push(`expired ${report.expired}`);

  return `${dropped} briefings-enabled user(s) are dropped by the sender's classification gate — ${parts.join(', ')}${suffix}`;
}
