/**
 * Alert emails must take people to the map (Eric 2026-08-13).
 * Mission Control: 759 email opens, 29 map arrivals (3.8%). Dedicated map link converted 18.8%.
 * Titles used to go to Track-in-pipeline or SAM.gov — those clicks never counted as map arrivals.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const DAILY = read('src/app/api/cron/daily-alerts/route.ts');
const WEEKLY = read('src/app/api/cron/weekly-alerts/route.ts');
const WELCOME = read('src/app/api/alerts/save-profile/route.ts');
const BRANDING = read('src/lib/mindy/email-branding.ts');
const CONVERTER = read('src/lib/analytics/email-map-converter.ts');

describe('mindyMapUrl helper', () => {
  it('builds /opportunity-map?src=&opp=', () => {
    expect(BRANDING).toContain('export function mindyMapUrl');
    expect(BRANDING).toContain("p.set('opp', String(opts.noticeId))");
    expect(BRANDING).toContain('opportunity-map?');
  });
});

describe('daily alert: titles and primary CTA go to the map', () => {
  it('per-opp title and button use alert_opp_map, not Track as the title href', () => {
    expect(DAILY).toContain("trackedUrl(mapUrlFor(opp), 'alert_opp_map'");
    expect(DAILY).toContain('Open on the Map');
    expect(DAILY).not.toContain('📌 Track in Mindy');
    // title used to wrap trackUrl — that path is now the secondary Track text link only
    expect(DAILY).not.toContain("trackedUrl(trackUrl(opp), 'track_in_mindy', `track_${opp.noticeId");
  });
  it('always renders a map hero (quiet lens if compute fails)', () => {
    expect(DAILY).toContain('todaysLens || quietLens');
    expect(DAILY).not.toContain('omitting block');
  });
  it('converter counts per-opp map clicks', () => {
    expect(CONVERTER).toContain("'alert_opp_map'");
  });
});

describe('welcome alert: first email opens the map, not SAM.gov', () => {
  it('hero CTA and titles use mindyMapUrl, not opp.uiLink', () => {
    expect(WELCOME).toContain("mindyMapUrl({ src: 'welcome_alert' })");
    expect(WELCOME).toContain("mindyMapUrl({ noticeId: opp.noticeId");
    expect(WELCOME).toContain('Open the Map');
    expect(WELCOME).not.toContain('Welcome to Daily Alerts!');
    expect(WELCOME).not.toContain('href="${opp.uiLink}"');
  });
});

describe('weekly alert titles go to the map', () => {
  it('weekly opportunity titles use mindyMapUrl not SAM.gov', () => {
    expect(WEEKLY).toContain("mindyMapUrl({ noticeId: opp.noticeId, src: 'weekly_alert' })");
    expect(WEEKLY).not.toContain("trackedUrl(opp.uiLink, 'sam_gov_opportunity'");
  });
});
