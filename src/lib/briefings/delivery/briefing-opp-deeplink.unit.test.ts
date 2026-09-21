/**
 * GUARD — the daily briefing's per-opportunity CTA must open THAT opportunity.
 *
 * The sibling of `api/cron/daily-alerts/alert-opp-deeplink.unit.test.ts`. The daily ALERT
 * was fixed in PR #1441; the daily BRIEFING, which is a second email built from the same
 * SAM rows, kept emitting market scope from a link that names one record.
 *
 * `mapHrefFor()` emitted `?naics=<code>&subAgency=<agency>&state=<popState>` and NO id,
 * on a CTA reading "See it on the map ->" attached to a single ranked card, and on each
 * "Deadlines this week" row. Measured on prod (`user_engagement`, 30d to 2026-09-21):
 *
 *   · 1,613 of the daily briefing's 1,984 link clicks (81.3%) went through it, and not one
 *     carried a record id. Click-weighted mean destination: 68 open rows to search by eye
 *     for the listing the card had already named (215 for `?naics=236220&subAgency=VA`).
 *   · 457 of those (28.3%) carried a COMMA-bearing sub-agency. `multiVal()` splits
 *     `?subAgency=` on commas into an OR, so "VETERANS AFFAIRS, DEPARTMENT OF" became
 *     `%VETERANS AFFAIRS%` OR `%DEPARTMENT OF%` -> 3,598 rows vs the correct 2,849; and
 *     "HOMELAND SECURITY, DEPARTMENT OF" landed on THE SAME 3,598 rows, 0 of them DHS.
 *   · A market link is filtered `active = true`. The deadline CTA (705 of those clicks) is
 *     by construction the one most likely to be clicked after its notice closes — at which
 *     point the market renders WITHOUT the record. `?opp=` still opens it: opportunity-detail
 *     addresses a row, it does not filter a corpus.
 *
 * This renders the REAL email and asserts on the href, so it fails on any regression in the
 * builder, the call sites or the tracking wrap — not just on the helper's source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSamGreenEmailHtml, type SamDailyBriefing } from './sam-green-email-template';

const NOTICE_ID = 'aa11bb22cc33dd44ee55ff6600778899';
const DEADLINE_NOTICE_ID = '99887766554433221100ffeeddccbbaa';

const BRIEFING: SamDailyBriefing = {
  date: 'Monday, September 21, 2026',
  opportunities: [
    {
      rank: 1,
      title: 'Base Operations Support Services',
      agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
      parentAgency: 'VETERANS AFFAIRS, DEPARTMENT OF',
      naicsCode: '541330',
      setAside: 'Total Small Business Set-Aside (FAR 19.5)',
      popState: 'DC',
      responseDeadline: 'Oct 3, 2026',
      daysRemaining: 12,
      noticeType: 'Solicitation',
      solicitationNumber: 'VA-26-R-0042',
      noticeId: NOTICE_ID,
      samLink: `https://sam.gov/opp/${NOTICE_ID}/view`,
      quickWinAssessment: 'Active opportunity matching your NAICS.',
      postedDate: 'Sep 12, 2026',
    },
  ],
  deadlinesThisWeek: [
    {
      title: 'Grounds Maintenance',
      fullTitle: 'Grounds Maintenance — Regional',
      deadline: 'Sep 25, 2026',
      daysRemaining: 4,
      samLink: `https://sam.gov/opp/${DEADLINE_NOTICE_ID}/view`,
      noticeType: 'Combined Synopsis/Solicitation',
      // Solicitation-number-preferred, exactly as the builders produce it.
      noticeId: 'W912PL-26-Q-0007',
      samNoticeId: DEADLINE_NOTICE_ID,
      solicitationNumber: 'W912PL-26-Q-0007',
      agency: 'DEPT OF THE ARMY',
      naicsCode: '561730',
      setAside: '',
      popState: 'GA',
    },
  ],
  actionTips: ['Review solicitation documents within 48 hours.'],
  noticeSummary: { totalMatched: 1, rfp: 1, rfq: 0, sourcesSought: 0, preSol: 0, combined: 0, other: 0 },
};

/**
 * The PER-RECORD map CTAs in the rendered email, unwrapped from the /api/track redirect.
 *
 * Selected by tracking LABEL (`open_in_map` / `open_in_map_deadline`), not by path: the
 * footer's "Open Mindy Dashboard" also resolves to /opportunity-map (MINDY_APP_URL) and is
 * a legitimate market link — it names no record, so this rule does not apply to it.
 * Those two labels are exactly the 1,613 clicks measured above.
 */
const RECORD_CTA_LABELS = ['open_in_map', 'open_in_map_deadline'];

function recordCtaHrefs(html: string): URL[] {
  const out: URL[] = [];
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const raw = m[1].replace(/&amp;/g, '&');
    if (!raw.includes('/api/track')) continue;
    // /api/track?t=..&a=click&url=<encoded destination>&l=<label> — the destination is the
    // whole point; asserting on the wrapper would pass no matter where it redirected.
    const label = raw.match(/[?&]l=([^&]+)/);
    const dest = raw.match(/[?&]url=([^&]+)/);
    if (!label || !dest) continue;
    if (!RECORD_CTA_LABELS.includes(decodeURIComponent(label[1]))) continue;
    out.push(new URL(decodeURIComponent(dest[1])));
  }
  return out;
}

describe('daily briefing — the per-opportunity CTA is a RECORD link', () => {
  const { htmlBody } = generateSamGreenEmailHtml(BRIEFING, 'reader@example.com', 'tok_test');
  const hrefs = recordCtaHrefs(htmlBody);

  it('rendered the real email and found its per-record map CTAs (a vacuous pass would hide everything below)', () => {
    expect(htmlBody.length).toBeGreaterThan(2_000);
    // One per ranked card + one per deadline row.
    expect(hrefs.length).toBe(2);
  });

  it('the ranked card opens THAT notice via ?opp=<notice_id>', () => {
    const card = hrefs.find((u) => u.searchParams.get('opp') === NOTICE_ID);
    expect(card, `no ?opp=${NOTICE_ID} among ${hrefs.map((u) => u.search).join(' | ')}`).toBeTruthy();
  });

  it('the deadline row uses the SAM notice_id, not the solicitation-number-preferred field', () => {
    const dl = hrefs.find((u) => u.searchParams.get('opp') === DEADLINE_NOTICE_ID);
    expect(dl, 'deadline CTA did not address the SAM notice_id').toBeTruthy();
  });

  it('NO map CTA carries a scope param — that is the late writer that empties the map', () => {
    // With any of these present the map's scope IIFE stops early-returning and applies
    // __applySavedSearch in a 40x150ms retry loop, racing (and losing to) the drawer open.
    for (const u of hrefs) {
      for (const k of ['naics', 'subAgency', 'subagency', 'agency', 'state', 'setAside', 'psc', 'q', 'ss']) {
        expect(u.searchParams.get(k), `${k} must not ride on a record link (${u.search})`).toBeNull();
      }
    }
  });

  it('no map CTA is a bare /opportunity-map — that is the unfiltered national map, not an answer', () => {
    for (const u of hrefs) expect(u.searchParams.get('opp')).toBeTruthy();
  });
});

describe('daily briefing — the id-less FALLBACK stays a truthful market link', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/lib/briefings/delivery/sam-green-email-template.ts'), 'utf8');

  it('the fallback runs a comma-bearing sub-agency through firstScopeSegment', () => {
    // A comma in ?subAgency= is a multi-select separator (map-filters.ts multiVal), so
    // "VETERANS AFFAIRS, DEPARTMENT OF" raw ORs in every sub_tier containing "DEPARTMENT OF".
    const at = SRC.indexOf('function mapHrefFor(');
    expect(at).toBeGreaterThan(-1);
    const fn = SRC.slice(at, at + 900);
    expect(fn).toContain("p.set('subAgency', firstScopeSegment(");
    expect(fn).toContain("p.set('agency', firstScopeSegment(");
  });

  it('the record id short-circuits BEFORE any scope param is built', () => {
    const at = SRC.indexOf('function mapHrefFor(');
    const fn = SRC.slice(at, at + 900);
    const idAt = fn.indexOf('?opp=');
    const scopeAt = fn.indexOf("p.set('naics'");
    expect(idAt).toBeGreaterThan(-1);
    expect(scopeAt).toBeGreaterThan(-1);
    expect(idAt).toBeLessThan(scopeAt);
  });
});

describe('weekly alert — the opportunity title opens Mindy, not sam.gov', () => {
  const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/cron/weekly-alerts/route.ts'), 'utf8');

  it('the title href goes through oppHref (the map record address), not opp.uiLink', () => {
    expect(ROUTE).toContain("trackedUrl(oppHref(opp), 'open_in_map'");
    expect(ROUTE).not.toContain("trackedUrl(opp.uiLink, 'sam_gov_opportunity', `opportunity_");
  });

  it('oppHref emits the notice id ALONE — no scope params on a record link', () => {
    const at = ROUTE.indexOf('const oppHref =');
    expect(at).toBeGreaterThan(-1);
    const fn = ROUTE.slice(at, at + 260);
    expect(fn).toContain('/opportunity-map?opp=');
    expect(fn).toContain('encodeURIComponent');
    for (const k of ['naics=', 'agency=', 'state=', 'subAgency=']) {
      expect(fn.includes(k), `${k} must not ride on the weekly alert record link`).toBe(false);
    }
  });

  it('SAM.gov is still reachable — the source record link was moved, not deleted', () => {
    expect(ROUTE).toContain("'sam_gov_opportunity', `sam_${opp.noticeId}`");
  });
});
