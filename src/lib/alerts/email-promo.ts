import type { AlertProfileFields } from '@/lib/alerts/profile-setup';
import { userNeedsMindySetup } from '@/lib/alerts/profile-setup';
import { MINDY_APP_URL } from '@/lib/mindy/email-branding';
import { MINDY_DAY } from '@/lib/mindy/mindy-day';

/**
 * Sales angles from docs/MARKETING-FEATURE-LITERATURE.md — §1, §11, §12, §20.
 * Proof: FY2025 USASpending — obvious NAICS ≈ 28% of market; 72–74% hides elsewhere.
 */
export const ALERT_MARKETING = {
  /** Headline miss rate (drones); cybersecurity & medical supplies = 74% in literature */
  missPct: 72,
  obviousCodePct: 28,
  missPctCyberMed: 74,
  /** Pull quotes tuned for alert emails */
  alertMissHeadline:
    'If your alerts run on one obvious NAICS code, you miss up to 72% of matching opportunities',
  wrongSetupBreaksAlerts:
    'The wrong setup quietly breaks every alert you\'ll ever get — most contractors pick one code and silently miss three-quarters of their market.',
  keywordMatchesBody:
    'Keywords match the actual contract text — catching opportunities a NAICS code alone will never surface.',
  naicsOnlyThin:
    'A profile that\'s NAICS-only quietly under-matches. That\'s why your alerts feel thin.',
  expensiveMistake:
    'The single most expensive mistake in federal BD: searching one code when the money flows across dozens of buying codes.',
  keywordFirstFlip:
    'Mindy flips it: tell us what you sell in plain words — keywords first, codes derived from real award data.',
  dataGrounded: 'Every match grounded in USASpending + SAM — not generic AI.',
} as const;

/** Live GovCon Giants bootcamp — §29 MARKETING-FEATURE-LITERATURE.
 *  Date fields come from MINDY_DAY (src/lib/mindy/mindy-day.ts). */
export const ALERT_BOOTCAMP = {
  dateLabel: MINDY_DAY.dateLabel,
  shortDate: MINDY_DAY.shortDate,
  title: 'Mindy Day',
  tagline:
    'Watch Mindy find real federal contracts, live — the product unveil. See it work before you configure a thing.',
  url: 'https://govcongiants.com/mindy-launch',
  registerLabel: 'Save Your Seat — Free →',
} as const;

/** Mindy v1.0 — one-line positioning from literature header */
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

export interface AlertEmailCta {
  url: string;
  label: string;
  trackingLabel: string;
  headerSubtitle: string;
  footerHeadline: string;
  footerBody: string;
  footerFinePrint: string;
  needsKeywordSetup: boolean;
}

export function getAlertEmailCta(
  preferencesUrl: string,
  mindyDashboardUrl: string,
  user: AlertProfileFields,
): AlertEmailCta {
  const needsKeywordSetup = userNeedsMindySetup(user);
  const m = ALERT_MARKETING;
  const v1 = MINDY_V1;

  if (needsKeywordSetup) {
    return {
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

  return {
    url: mindyDashboardUrl,
    label: v1.ctaLabel,
    trackingLabel: 'open_mindy_dashboard',
    headerSubtitle:
      `Your keyword filters are active. <strong>Mindy ${v1.version}</strong> is now live — ${v1.positioning}`,
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

  if (cta.needsKeywordSetup) {
    return `
  <a href="${trackedUrl(cta.url, cta.trackingLabel, 'banner_keyword_setup')}" style="text-decoration: none; display: block;">
    <div style="background-color: #b91c1c; background-image: linear-gradient(135deg, #b91c1c 0%, #dc2626 100%); padding: 10px 20px; text-align: center; border-radius: 12px 12px 0 0;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; line-height: 1.4;">
        ⚠️ One NAICS code ≈ ${m.obviousCodePct}% of your market &nbsp;•&nbsp; <span style="text-decoration: underline;">You're missing the other ${m.missPct}% — fix your alert filters →</span>
      </p>
    </div>
  </a>`;
  }

  const v1 = MINDY_V1;
  return `
  <a href="${trackedUrl(v1.url, 'open_mindy_v1', 'top_banner_v1')}" style="text-decoration: none; display: block;">
    <div style="background-color: #7c3aed; background-image: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%); padding: 10px 20px; text-align: center; border-radius: 12px 12px 0 0;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;">
        ✨ NEW &nbsp;•&nbsp; <span style="text-decoration: underline;">Mindy ${v1.version} is live — AI BD analyst grounded in real federal data →</span>
      </p>
    </div>
  </a>`;
}

export function renderKeywordSetupNudgeHtml(
  preferencesUrl: string,
  trackedUrl: TrackedUrlFn,
): string {
  const m = ALERT_MARKETING;
  // ONE LINE, not a red alarm slab.
  //
  // This nudge sits between the header and the opportunities — the space a
  // reader crosses to reach the thing they opened the email for. It used to
  // spend that space on four stacked paragraphs, two statistics, an emoji
  // callout and a red button, styled like an error. 60% of recipients (6,350
  // of 10,589 profiles carry no keywords) saw that on EVERY alert, which
  // trains people to scroll past the top of the email — including the map and
  // the match count.
  //
  // Same message, one sentence: the miss rate, and the link that fixes it.
  // Amber, not red — this is a tip about their settings, not a failure.
  return `
  <div style="background:#fffbeb;border-bottom:1px solid #fde68a;padding:11px 20px;">
    <p style="color:#78350f;margin:0;font-size:13px;line-height:1.5;">
      Your alerts run on NAICS only — that misses up to <strong>${m.missPct}%</strong> of matching work.
      <a href="${trackedUrl(preferencesUrl, 'alert_keyword_setup', 'setup_nudge')}" style="color:#b45309;font-weight:700;text-decoration:underline;white-space:nowrap;">Add keywords &rarr;</a>
    </p>
  </div>`;
}

export function renderMindyV10PromoHtml(trackedUrl: TrackedUrlFn): string {
  const v1 = MINDY_V1;
  return `
  <div style="background-color: #1e293b; background-image: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 10px; padding: 20px 22px; margin-top: 20px; text-align: center; border: 1px solid #334155;">
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
  return `
  <div style="background-color: #4c1d95; background-image: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); border-radius: 10px; padding: 20px 22px; margin-top: 20px; text-align: center;">
    <p style="color: #c4b5fd; margin: 0 0 4px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
      Free Live · ${boot.shortDate}
    </p>
    <h3 style="color: white; margin: 0 0 8px 0; font-size: 17px; font-weight: 700;">
      🚀 ${boot.title}
    </h3>
    <p style="color: #ddd6fe; margin: 0 0 14px 0; font-size: 13px; line-height: 1.5;">
      ${boot.tagline}. <strong>${boot.dateLabel}</strong> — full live walkthrough of Mindy ${v1.version}.
    </p>
    <a href="${trackedUrl(boot.url, 'bootcamp_register', 'bootcamp_promo')}" style="background: white; color: #5b21b6; padding: 10px 22px; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 13px; display: inline-block;">
      ${boot.registerLabel}
    </a>
  </div>`;
}

/** @deprecated Use ALERT_MARKETING.missPct — kept for any external imports */
export const ALERT_GENERIC_MISS_PCT = ALERT_MARKETING.missPct;
