/**
 * On-demand SEO performance report for getmindy.ai.
 *
 * Pulls live Google Search Console data via the BigQuery service
 * account (GCP_SA_JSON). Shares its data-building with the weekly
 * Slack cron (src/lib/gsc/report.ts → buildReport).
 *
 * Run:  npx tsx scripts/seo-report.ts
 *
 * Prereq: the BQ service account must be a user on the getmindy.ai
 * GSC property (sc-domain:getmindy.ai).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { buildReport, pct, deltaPct, shortPath } from '../src/lib/gsc/report';
import type { GscRow } from '../src/lib/gsc/query';

function pos(n: number): string {
  return n ? n.toFixed(1) : '—';
}

async function main() {
  const r = await buildReport(new Date());

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  SEO PERFORMANCE REPORT — getmindy.ai');
  console.log(`  Current:  ${r.range.current.startDate} → ${r.range.current.endDate}  (trailing 28d)`);
  console.log(`  Previous: ${r.range.previous.startDate} → ${r.range.previous.endDate}`);
  console.log('════════════════════════════════════════════════════════════');

  const t = r.totals;
  console.log('\n── SITE TOTALS (28d vs prior 28d) ──');
  console.log(`  Clicks:       ${t.clicks.toLocaleString().padStart(8)}   (${deltaPct(t.clicks, t.prevClicks)})`);
  console.log(`  Impressions:  ${t.impressions.toLocaleString().padStart(8)}   (${deltaPct(t.impressions, t.prevImpressions)})`);
  console.log(`  CTR:          ${pct(t.ctr).padStart(8)}   (prev ${pct(t.prevCtr)})`);
  console.log(`  Avg position: ${pos(t.position).padStart(8)}   (prev ${pos(t.prevPosition)})`);

  const printRows = (rows: GscRow[], label: string) => {
    console.log(`\n── ${label} ──`);
    console.log('  clicks  impr    ctr     pos   key');
    for (const row of rows) {
      console.log(
        `  ${String(row.clicks).padStart(5)}  ${String(row.impressions).padStart(6)}  ${pct(row.ctr).padStart(6)}  ${pos(row.position).padStart(5)}  ${shortPath(row.keys[0])}`
      );
    }
  };

  printRows(r.topPages, 'TOP PAGES BY CLICKS');
  printRows(r.topQueries, 'TOP QUERIES BY CLICKS');

  console.log('\n── CTR OPPORTUNITIES (high impressions, low CTR) ──');
  console.log('  impr    ctr     pos   page');
  for (const row of r.ctrLosers) {
    console.log(`  ${String(row.impressions).padStart(6)}  ${pct(row.ctr).padStart(6)}  ${pos(row.position).padStart(5)}  ${shortPath(row.keys[0])}`);
  }

  console.log('\n── STRIKING DISTANCE (page-2 queries, pos 11-20) ──');
  console.log('  impr    pos   query');
  for (const row of r.striking) {
    console.log(`  ${String(row.impressions).padStart(6)}  ${pos(row.position).padStart(5)}  ${row.keys[0]}`);
  }

  console.log('\n── BIGGEST GAINERS (clicks Δ vs prior 28d) ──');
  for (const d of r.gainers) {
    console.log(`  ${('▲ +' + d.clicksDelta).padStart(8)}  ${d.prevClicks}→${d.clicks}   ${shortPath(d.page)}`);
  }

  console.log('\n── BIGGEST DECLINERS ──');
  if (r.decliners.length === 0) console.log('  (none)');
  for (const d of r.decliners) {
    console.log(`  ${('▼ ' + d.clicksDelta).padStart(8)}  ${d.prevClicks}→${d.clicks}   ${shortPath(d.page)}`);
  }

  console.log('\n════════════════════════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error('\n❌ SEO report failed:', e instanceof Error ? e.message : e);
  if (String(e).includes('403') || String(e).includes('does not have')) {
    console.error(
      '\n→ Likely the service account is not added to the GSC property.\n' +
        '  Add the BQ service account to the getmindy.ai property, then re-run.'
    );
  }
  process.exit(1);
});
