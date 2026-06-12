import type { AlertProfileFields, AlertProfileStage } from '@/lib/alerts/profile-setup';
import { getAlertProfileStage } from '@/lib/alerts/profile-setup';
import { MINDY_APP_URL } from '@/lib/mindy/email-branding';

/**
 * Sales angles from docs/MARKETING-FEATURE-LITERATURE.md — §1, §11, §12, §20.
 * Proof: FY2025 USASpending — obvious NAICS ≈ 28% of market; 72–74% hides elsewhere.
 */
export const ALERT_MARKETING = {
  missPct: 72,
  obviousCodePct: 28,
  missPctCyberMed: 74,
  alertMissHeadline:
    'If your alerts run on one obvious NAICS code, you miss up to 72% of matching opportunities',
  wrongSetupBreaksAlerts:
    'The wrong setup quietly breaks every alert you\'ll ever get — most contractors pick one code and silently miss three-quarters of their market.',
  keywordMatchesBody:
    'Keywords match the actual contract text — catching opportunities a NAICS code alone will never surface.',
  naicsOnlyThin:
    'A profile that\'s NAICS-only quietly under-matches. That\'s why your alerts feel thin.',
  narrowMarketHeadline:
    'You\'re only searching a narrow slice of your market',
  narrowMarketBody:
    'Most contractors stop at 1–2 NAICS codes. Real FY2025 award data shows the "obvious" code is usually only ~28% of the market — Mindy Sport mode maps the other ~72% from what you actually sell.',
  didYouKnowTeaser:
    'The obvious NAICS for what you sell is usually only ~28% of the federal market. The other ~72% hides in buying codes you\'d never think to search (FY2025 USASpending).',
  expensiveMistake:
    'The single most expensive mistake in federal BD: searching one code when the money flows across dozens of buying codes.',
  keywordFirstFlip:
    'Mindy flips it: tell us what you sell in plain words — keywords first, codes derived from real award data.',
  dataGrounded: 'Every match grounded in USASpending + SAM — not generic AI.',
} as const;

export const ALERT_BOOTCAMP = {
  dateLabel: 'Saturday, June 27, 2026',
  shortDate: 'June 27',
  title: 'Mindy Bootcamp',
  tagline:
    'The fastest way to see Mindy find the hidden 72% of your market — live, hands-on',
  url: 'https://govcongiants.com/mindy-launch',
  registerLabel: 'Save Your Seat — Free →',
} as const;

export const MINDY_V1 = {
  version: 'v1.0',
  headline: 'Mindy v1.0 is now live',
  positioning:
    'The AI BD analyst for federal small business — reads the solicitation, knows the incumbent\'s real contract, finds who\'s buying, and drafts the response.',
  body:
    'Market intel, keyword alerts, recompete intelligence, and Proposal Assist — one platform. Every number grounded in real federal data, not generic AI.',
  url: MINDY_APP_URL,
  ctaLabel: 'Open Mindy v1.0 →',
} as const;

export const MINDY_MARKET_RESEARCH_URL = `${MINDY_APP_URL}?panel=research`;

export interface AlertEmailCta {
  stage: AlertProfileStage;
  naicsCount?: number;
  url: string;
  label: string;
  trackingLabel: string;
  headerSubtitle: string;
  footerHeadline: string;
  footerBody: string;
  footerFinePrint: string;
  /** @deprecated Use stage === 'unconfigured' */
  needsKeywordSetup: boolean;
}

export function getAlertEmailCta(
  preferencesUrl: string,
  mindyDashboardUrl: string,
  user: AlertProfileFields,
): AlertEmailCta {
  const stage = getAlertProfileStage(user);
  const m = ALERT_MARKETING;
  const v1 = MINDY_V1;
  const sportUrl = MINDY_MARKET_RESEARCH_URL;

  if (stage === 'unconfigured') {
    return {
      stage,
      url: preferencesUrl,
      label: `Stop Missing ${m.missPct}% — Fix My Alerts →`,
      trackingLabel: 'alert_keyword_setup',
      headerSubtitle:
        `<strong>${m.alertMissHeadline}.</strong> ${m.wrongSetupBreaksAlerts} Add <strong>keywords + NAICS</strong> on your free alert profile (2 min) — or open <strong>Mindy ${v1.version}</strong>, now live.`,
      footerHeadline: `You're only seeing ~${m.obviousCodePct}% of your market`,
      footerBody:
        `${m.expensiveMistake} ${m.keywordFirstFlip} Fix your free alerts now — or jump into <strong>Mindy ${v1.version}</strong> for the full platform.`,
      footerFinePrint: `2-minute setup • ${m.dataGrounded}`,
      needsKeywordSetup: true,
    };
  }

  if (stage === 'narrow_market') {
    const naicsCount = (user.naics_codes || []).filter(code => Boolean(String(code).trim())).length;
    return {
      stage,
      naicsCount,
      url: sportUrl,
      label: `See Your Full Market (${m.missPct}% hidden) →`,
      trackingLabel: 'market_research_sport',
      headerSubtitle:
        `<strong>${m.narrowMarketHeadline}.</strong> You have keywords set, but only <strong>${naicsCount} NAICS code${naicsCount === 1 ? '' : 's'}</strong> — the obvious one is usually ~${m.obviousCodePct}% of the market. Use <strong>Sport mode</strong> in Mindy ${v1.version} to map the other ~${m.missPct}%.`,
      footerHeadline: `You're still missing ~${m.missPct}% of opportunities`,
      footerBody:
        `${m.expensiveMistake} Type what you sell in Sport mode — Mindy derives every buying NAICS from real award data so you don't have to guess codes.`,
      footerFinePrint: m.dataGrounded,
      needsKeywordSetup: false,
    };
  }

  return {
    stage,
    url: mindyDashboardUrl,
    label: v1.ctaLabel,
    trackingLabel: 'open_mindy_dashboard',
    headerSubtitle:
      `Your filters cover a broader NAICS set. <strong>Mindy ${v1.version}</strong> is now live — ${v1.positioning}`,
    footerHeadline: v1.headline,
    footerBody: v1.body,
    footerFinePrint: m.dataGrounded,
    needsKeywordSetup: false,
  };
}

type TrackedUrlFn = (url: string, label: string, content?: string) => string;

export function renderAlertTopBannerHtml(
  cta: AlertEmailCta,
  trackedUrl: TrackedUrlFn,
): string {
  const m = ALERT_MARKETING;

  if (cta.stage === 'unconfigured') {
    return `
  <a href="${trackedUrl(cta.url, cta.trackingLabel, 'banner_keyword_setup')}" style="text-decoration: none; display: block;">
    <div style="background: linear-gradient(135deg, #b91c1c 0%, #dc2626 100%); padding: 10px 20px; text-align: center; border-radius: 12px 12px 0 0;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; line-height: 1.4;">
        ⚠️ One NAICS code ≈ ${m.obviousCodePct}% of your market &nbsp;•&nbsp; <span style="text-decoration: underline;">You're missing the other ${m.missPct}% — fix your alert filters →</span>
      </p>
    </div>
  </a>`;
  }

  if (cta.stage === 'narrow_market') {
    return `
  <a href="${trackedUrl(cta.url, cta.trackingLabel, 'banner_narrow_market')}" style="text-decoration: none; display: block;">
    <div style="background: linear-gradient(135deg, #c2410c 0%, #ea580c 100%); padding: 10px 20px; text-align: center; border-radius: 12px 12px 0 0;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; line-height: 1.4;">
        📊 Only ${cta.naicsCount ?? '1–2'} NAICS code${cta.naicsCount === 1 ? '' : 's'}? &nbsp;•&nbsp; <span style="text-decoration: underline;">~${m.missPct}% of your market is still hidden — see full coverage →</span>
      </p>
    </div>
  </a>`;
  }

  const boot = ALERT_BOOTCAMP;
  return `
  <a href="${trackedUrl(boot.url, 'bootcamp_register', 'top_banner_bootcamp')}" style="text-decoration: none; display: block;">
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%); padding: 10px 20px; text-align: center; border-radius: 12px 12px 0 0;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; line-height: 1.4;">
        🚀 Free Live · ${boot.shortDate} &nbsp;•&nbsp; <span style="text-decoration: underline;">See how Mindy finds the hidden ${m.missPct}% — ${boot.registerLabel}</span>
      </p>
    </div>
  </a>`;
}

/** Shown on every alert — teaches the 72% insight even when profile looks "complete". */
export function renderMarketCoverageTeaserHtml(
  cta: AlertEmailCta,
  preferencesUrl: string,
  trackedUrl: TrackedUrlFn,
): string {
  const m = ALERT_MARKETING;
  const teaserUrl = cta.stage === 'unconfigured' ? preferencesUrl : MINDY_MARKET_RESEARCH_URL;
  const teaserLabel = cta.stage === 'unconfigured' ? 'Fix your alert filters →' : 'See your market coverage →';
  const teaserTrack = cta.stage === 'unconfigured' ? 'alert_keyword_setup' : 'market_research_sport';

  return `
  <div style="background: #f5f3ff; border: 1px solid #ddd6fe; border-left: 4px solid #7c3aed; padding: 12px 16px; margin: 0;">
    <p style="color: #5b21b6; margin: 0 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;">
      Did you know?
    </p>
    <p style="color: #4c1d95; margin: 0 0 10px 0; font-size: 13px; line-height: 1.5;">
      ${m.didYouKnowTeaser} Example: "drones" spans <strong>70+ buying NAICS codes</strong>; cybersecurity and medical supplies miss up to <strong>${m.missPctCyberMed}%</strong>.
    </p>
    <a href="${trackedUrl(teaserUrl, teaserTrack, 'coverage_teaser')}" style="color: #7c3aed; font-weight: 700; font-size: 12px; text-decoration: none;">
      ${teaserLabel}
    </a>
  </div>`;
}

export function renderKeywordSetupNudgeHtml(
  preferencesUrl: string,
  trackedUrl: TrackedUrlFn,
): string {
  const m = ALERT_MARKETING;
  return `
  <div style="background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; padding: 14px 18px;">
    <p style="color: #991b1b; margin: 0 0 8px 0; font-size: 14px; font-weight: 700;">
      ⚠️ ${m.alertMissHeadline}
    </p>
    <p style="color: #7f1d1d; margin: 0 0 8px 0; font-size: 13px; line-height: 1.5;">
      ${m.naicsOnlyThin} ${m.keywordMatchesBody}
    </p>
    <p style="color: #7f1d1d; margin: 0 0 12px 0; font-size: 12px; line-height: 1.5; font-style: italic;">
      Real FY2025 data: "drones" alone spans <strong>70+ buying NAICS codes</strong> — the obvious code is only <strong>${m.obviousCodePct}%</strong> of the market.
    </p>
    <a href="${trackedUrl(preferencesUrl, 'alert_keyword_setup', 'setup_nudge')}" style="background: #dc2626; color: white; padding: 9px 16px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 13px; display: inline-block;">
      Fix My Alert Filters →
    </a>
  </div>`;
}

export function renderNarrowMarketNudgeHtml(
  sportUrl: string,
  naicsCount: number,
  trackedUrl: TrackedUrlFn,
): string {
  const m = ALERT_MARKETING;
  return `
  <div style="background: #fff7ed; border: 1px solid #fed7aa; border-left: 4px solid #ea580c; padding: 14px 18px;">
    <p style="color: #9a3412; margin: 0 0 8px 0; font-size: 14px; font-weight: 700;">
      📊 ${m.narrowMarketHeadline}
    </p>
    <p style="color: #7c2d12; margin: 0 0 12px 0; font-size: 13px; line-height: 1.5;">
      You have <strong>${naicsCount} NAICS code${naicsCount === 1 ? '' : 's'}</strong> on your profile — that's usually only ~${m.obviousCodePct}% of the federal market for what you sell. <strong>Sport mode</strong> in Mindy maps the other ~${m.missPct}% from real USASpending data.
    </p>
    <a href="${trackedUrl(sportUrl, 'market_research_sport', 'narrow_market_nudge')}" style="background: #ea580c; color: white; padding: 9px 16px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 13px; display: inline-block;">
      See Your Full Market →
    </a>
  </div>`;
}

export function renderMindyV10PromoHtml(trackedUrl: TrackedUrlFn): string {
  const v1 = MINDY_V1;
  return `
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 10px; padding: 20px 22px; margin-top: 20px; text-align: center; border: 1px solid #334155;">
    <p style="color: #a78bfa; margin: 0 0 4px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
      Now Available
    </p>
    <h3 style="color: white; margin: 0 0 8px 0; font-size: 17px; font-weight: 700;">
      ✨ ${v1.headline}
    </h3>
    <p style="color: #cbd5e1; margin: 0 0 6px 0; font-size: 13px; line-height: 1.5;">
      ${v1.positioning}
    </p>
    <p style="color: #94a3b8; margin: 0 0 14px 0; font-size: 12px; line-height: 1.5;">
      ${v1.body}
    </p>
    <a href="${trackedUrl(v1.url, 'open_mindy_v1', 'v1_promo')}" style="background: #7c3aed; color: white; padding: 10px 22px; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 13px; display: inline-block;">
      ${v1.ctaLabel}
    </a>
  </div>`;
}

export function renderBootcampPromoHtml(trackedUrl: TrackedUrlFn): string {
  const boot = ALERT_BOOTCAMP;
  const v1 = MINDY_V1;
  const m = ALERT_MARKETING;
  return `
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); border-radius: 10px; padding: 20px 22px; margin-top: 20px; text-align: center;">
    <p style="color: #c4b5fd; margin: 0 0 4px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
      Free Live · ${boot.shortDate}
    </p>
    <h3 style="color: white; margin: 0 0 8px 0; font-size: 17px; font-weight: 700;">
      🚀 ${boot.title}
    </h3>
    <p style="color: #ddd6fe; margin: 0 0 14px 0; font-size: 13px; line-height: 1.5;">
      ${boot.tagline}. <strong>${boot.dateLabel}</strong> — live walkthrough of how Mindy finds the hidden ~${m.missPct}% in Mindy ${v1.version}.
    </p>
    <a href="${trackedUrl(boot.url, 'bootcamp_register', 'bootcamp_promo')}" style="background: white; color: #5b21b6; padding: 10px 22px; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 13px; display: inline-block;">
      ${boot.registerLabel}
    </a>
  </div>`;
}

/** @deprecated Use ALERT_MARKETING.missPct */
export const ALERT_GENERIC_MISS_PCT = ALERT_MARKETING.missPct;
