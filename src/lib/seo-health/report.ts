/**
 * Slack digest for one SEO health run. Plain facts from the run summary, per stratum;
 * escalations only when a persistence threshold was crossed. Always states that the job
 * is observe-only, and states coverage honestly (days per full pass at the current
 * allocation), so a sample is never mistaken for a census.
 */
import type { Escalation, StratumIndexShare } from './escalate';

interface DigestInput {
  status: 'ok' | 'partial' | 'failed';
  summary: Record<string, unknown>;
  escalations: Escalation[];
  problems: string[];
}

interface StratumStream { population: number; perRun: number; coverageDays: number | null; observed: number; planned: number; outcomes: Record<string, number> }

const pct = (x: number | null | undefined) => (typeof x === 'number' ? `${(100 * x).toFixed(1)}%` : 'n/a');
const top = (o: Record<string, number> = {}) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

export function buildDigest({ status, summary, escalations, problems }: DigestInput): { text: string; blocks: unknown[] } {
  const icon = status === 'ok' ? '✅' : status === 'partial' ? '⚠️' : '❌';
  const headline = `${icon} SEO health (getmindy.ai): ${status}${escalations.length ? ` · ${escalations.length} escalation${escalations.length === 1 ? '' : 's'}` : ''}`;
  const crawl = (summary.crawl ?? {}) as { skipped?: string; byStratum?: Record<string, StratumStream>; canaries?: Record<string, string> };
  const inspect = ((summary.inspect ?? {}) as { byStratum?: Record<string, StratumStream> }).byStratum ?? {};
  const shares = (summary.indexedShare ?? []) as StratumIndexShare[];
  const sc = (summary.searchConsole ?? {}) as { window?: string[]; rows?: number; pages?: number; complete?: boolean; evaluated?: boolean };

  const lines: string[] = [`*Sitemap:* ${summary.population ?? 'n/a'} URLs`];
  if (crawl.skipped) lines.push(`*Our crawl:* skipped (${crawl.skipped})`);
  if (crawl.canaries) lines.push(`*Canaries:* ${Object.entries(crawl.canaries).map(([u, o]) => `${u} ${o}`).join(' · ')}`);
  lines.push(sc.complete
    ? `*Search Console:* ${sc.rows} rows / ${sc.pages} page(s), complete, window ${sc.window?.[0]} to ${sc.window?.[1]} (mature days only)`
    : `*Search Console:* INCOMPLETE (${sc.rows ?? 0} rows / ${sc.pages ?? 0} pages); trend not evaluated`);

  const strata = Object.keys({ ...crawl.byStratum, ...inspect });
  const rows = strata.map((s) => {
    const c = crawl.byStratum?.[s];
    const i = inspect[s];
    const share = shares.find((x) => x.stratum === s);
    const cov = (x?: StratumStream) => (x ? `${x.observed}/${x.planned} (pass ≈ ${x.coverageDays ?? '∞'} d)` : '-');
    return `• *${s}* (${(c ?? i)?.population ?? 0}): crawl ${cov(c)} · ${top(c?.outcomes)}\n    inspect ${cov(i)} · indexed ${pct(share?.current.share)} (n=${share?.current.n ?? 0}) vs ${pct(share?.previous.share)} (n=${share?.previous.n ?? 0}) prior week`;
  });

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: headline.slice(0, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ];
  if (rows.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ('*By stratum* (sampled; "pass" = days for one full rotation at this allocation)\n' + rows.join('\n')).slice(0, 2900) } });
  if (escalations.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: ('*Escalations (persisted across runs):*\n' + escalations.slice(0, 15).map((e) => `• ${e.severity === 'critical' ? '🔴' : '🟠'} ${e.rule}: ${e.key.split('|')[0]} — ${e.message}`).join('\n') + (escalations.length > 15 ? `\n…and ${escalations.length - 15} more` : '')).slice(0, 2900) },
    });
  }
  if (problems.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ('*Run problems:*\n' + problems.slice(0, 8).map((p) => `• ${p}`).join('\n')).slice(0, 2900) } });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Observe-only: this job records and reports. It never edits the sitemap, noindex, pages, caches, IndexNow or BigQuery.' }] });
  return { text: headline, blocks };
}
