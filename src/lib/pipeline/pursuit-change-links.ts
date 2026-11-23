/**
 * Destinations for the "Changes to your tracked pursuits" alert (/api/cron/pursuit-changes).
 *
 * The digest is about rows in user_pipeline, which the Map's Pursuits page lists
 * (src/app/opportunity-map/pursuits/route.ts). `/app` is a legacy surface no customer
 * email may target (src/lib/email/legacy-destination-guard.ts).
 */
import { appendEmailUtm } from '@/lib/engagement';

export const PURSUITS_PAGE_URL = 'https://getmindy.ai/opportunity-map/pursuits';

/** Email CTA ("Open My Pursuits"): the Pursuits page, UTM-tagged for attribution. */
export const PURSUIT_CHANGES_EMAIL_CTA_URL = appendEmailUtm(PURSUITS_PAGE_URL, {
  campaign: 'pursuit_changes',
  content: 'open_my_pursuits',
});

/**
 * SMS link: same page, no scheme and no UTM — the SMS is a 160-char-friendly nudge and
 * UTM parameters would add ~80 characters.
 */
export const PURSUIT_CHANGES_SMS_LINK = 'getmindy.ai/opportunity-map/pursuits';
