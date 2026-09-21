/**
 * Builds a structured SEO performance report from live GSC data.
 *
 * Shared by:
 *   - scripts/seo-report.ts          (on-demand terminal report)
 *   - src/app/api/cron/seo-report    (weekly Slack report)
 *
 * Keeping the data-building here (not in the script or the route) means
 * one source of truth for what "the report" is.
 */
import {
  trailing28Windows,
  getTotals,
  getTopPages,
  getTopQueries,
  getCtrLosers,
  getStriking,
  getPageDeltas,
  type GscRow,
  type PageDelta,
} from './query';

export interface SeoReport {
  range: { current: { startDate: string; endDate: string }; previous: { startDate: string; endDate: string } };
  totals: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    prevClicks: number;
    prevImpressions: number;
    prevCtr: number;
    prevPosition: number;
  };
  topPages: GscRow[];
  topQueries: GscRow[];
  ctrLosers: GscRow[];
  striking: GscRow[];
  gainers: PageDelta[];
  decliners: PageDelta[];
}

/**
 * Pull every section of the report. `ref` defaults to now; pass an
 * explicit Date from a caller that has one (the route does).
 */
export async function buildReport(ref: Date): Promise<SeoReport> {
  const { current, previous } = trailing28Windows(ref);

  const [curTotals, prevTotals, topPages, topQueries, ctrLosers, striking, deltas] =
    await Promise.all([
      getTotals(current),
      getTotals(previous),
      getTopPages(current, 15),
      getTopQueries(current, 15),
      getCtrLosers(current, 100, 10),
      getStriking(current, 10),
      getPageDeltas(current, previous),
    ]);

  const movers = deltas.filter((d) => d.clicks + d.prevClicks >= 5);
  const gainers = [...movers]
    .sort((a, b) => b.clicksDelta - a.clicksDelta)
    .filter((d) => d.clicksDelta > 0)
    .slice(0, 8);
  const decliners = [...movers]
    .sort((a, b) => a.clicksDelta - b.clicksDelta)
    .filter((d) => d.clicksDelta < 0)
    .slice(0, 8);

  return {
    range: { current, previous },
    totals: {
      clicks: curTotals.clicks,
      impressions: curTotals.impressions,
      ctr: curTotals.ctr,
      position: curTotals.position,
      prevClicks: prevTotals.clicks,
      prevImpressions: prevTotals.impressions,
      prevCtr: prevTotals.ctr,
      prevPosition: prevTotals.position,
    },
    topPages,
    topQueries,
    ctrLosers,
    striking,
    gainers,
    decliners,
  };
}

// ── formatting helpers (shared) ──

export function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}
export function deltaPct(cur: number, prev: number): string {
  if (!prev) return cur ? 'new' : '—';
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
}
export function shortPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '') || '/';
}

/**
 * Format the report as Slack Block Kit blocks.
 * Kept compact — Slack truncates very long sections.
 */
export function toSlackBlocks(r: SeoReport): unknown[] {
  const t = r.totals;
  const posTrend =
    t.position && t.prevPosition
      ? t.position < t.prevPosition
        ? `↑ improved (${t.prevPosition.toFixed(1)} → ${t.position.toFixed(1)})`
        : `↓ slipped (${t.prevPosition.toFixed(1)} → ${t.position.toFixed(1)})`
      : `${t.position.toFixed(1)}`;

  const topPagesText = r.topPages
    .slice(0, 8)
    .map((p) => `${String(p.clicks).padStart(4)} clk · ${shortPath(p.keys[0])}`)
    .join('\n');

  const ctrText = r.ctrLosers
    .slice(0, 6)
    .map((p) => `${p.impressions.toLocaleString()} impr · ${pct(p.ctr)} · ${shortPath(p.keys[0])}`)
    .join('\n');

  const strikingText = r.striking
    .slice(0, 6)
    .map((q) => `pos ${q.position.toFixed(1)} · ${q.impressions} impr · ${q.keys[0]}`)
    .join('\n');

  const gainersText =
    r.gainers.length > 0
      ? r.gainers.slice(0, 5).map((d) => `▲ +${d.clicksDelta} · ${shortPath(d.page)}`).join('\n')
      : '_none_';
  const declinersText =
    r.decliners.length > 0
      ? r.decliners.slice(0, 5).map((d) => `▼ ${d.clicksDelta} · ${shortPath(d.page)}`).join('\n')
      : '_none_';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📊 Weekly SEO Report — getmindy.ai', emoji: true },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Trailing 28d: ${r.range.current.startDate} → ${r.range.current.endDate} (vs prior 28d)`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Clicks:*\n${t.clicks.toLocaleString()} (${deltaPct(t.clicks, t.prevClicks)})` },
        {
          type: 'mrkdwn',
          text: `*Impressions:*\n${t.impressions.toLocaleString()} (${deltaPct(t.impressions, t.prevImpressions)})`,
        },
        { type: 'mrkdwn', text: `*CTR:*\n${pct(t.ctr)} (prev ${pct(t.prevCtr)})` },
        { type: 'mrkdwn', text: `*Avg position:*\n${posTrend}` },
      ],
    },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*Top pages*\n${topPagesText || '_no data_'}` } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*CTR opportunities* (high impr, low CTR → rewrite/serve intent)\n${ctrText || '_none_'}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Striking distance* (page-2 queries, one push from page 1)\n${strikingText || '_none_'}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Gainers (Δ clicks)*\n${gainersText}` },
        { type: 'mrkdwn', text: `*Decliners*\n${declinersText}` },
      ],
    },
  ];
}
