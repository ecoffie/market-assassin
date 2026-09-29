/**
 * Slack digest for one SEO health run. Plain facts from the run summary; escalations
 * only when a persistence threshold was crossed. Always states that the job is observe-only.
 */
import type { Escalation } from './escalate';

interface DigestInput {
  status: 'ok' | 'partial' | 'failed';
  summary: Record<string, unknown>;
  escalations: Escalation[];
  problems: string[];
}

const pct = (x: unknown) => (typeof x === 'number' ? `${(100 * x).toFixed(1)}%` : 'n/a');
const counts = (o: unknown) =>
  Object.entries((o as Record<string, number>) ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ') || 'none';

export function buildDigest({ status, summary, escalations, problems }: DigestInput): { text: string; blocks: unknown[] } {
  const icon = status === 'ok' ? '✅' : status === 'partial' ? '⚠️' : '❌';
  const crawl = (summary.crawl ?? {}) as Record<string, unknown>;
  const inspect = (summary.inspect ?? {}) as Record<string, unknown>;
  const headline = `${icon} SEO health (getmindy.ai): ${status}${escalations.length ? ` · ${escalations.length} escalation${escalations.length === 1 ? '' : 's'}` : ''}`;

  const lines = [
    `*Sitemap population:* ${summary.population ?? 'n/a'} URLs`,
    crawl.skipped
      ? `*Our crawl:* skipped (${crawl.skipped})`
      : `*Our crawl:* ${crawl.observed ?? 0}/${crawl.planned ?? 0} observed, ${crawl.committed ?? 0} committed · ${counts(crawl.outcomes)}`,
    crawl.canaries ? `*Canaries:* ${Object.entries(crawl.canaries as Record<string, string>).map(([u, o]) => `${u} ${o}`).join(' · ')}` : '',
    `*Google (URL Inspection):* ${inspect.observed ?? 0}/${inspect.planned ?? 0} inspected · indexed ${pct(inspect.indexedShare)} · ${counts(inspect.outcomes)}`,
  ].filter(Boolean);

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: headline.slice(0, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ];
  if (escalations.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Escalations (persisted across runs):*\n' + escalations.slice(0, 15).map((e) => `• ${e.severity === 'critical' ? '🔴' : '🟠'} ${e.rule}: ${e.key.split('|')[0]} — ${e.message}`).join('\n') + (escalations.length > 15 ? `\n…and ${escalations.length - 15} more` : '') },
    });
  }
  if (problems.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Run problems:*\n' + problems.slice(0, 8).map((p) => `• ${p}`).join('\n') } });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Observe-only: this job records and reports. It never edits the sitemap, noindex, pages, caches, IndexNow or BigQuery.' }] });
  return { text: headline, blocks };
}
