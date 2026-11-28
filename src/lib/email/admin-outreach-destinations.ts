/**
 * Destinations for the two ADMIN-TRIGGERED customer emails (2026-11-22).
 *
 * Both used to send their main button to the legacy `/briefings` with no UTM tags:
 *   - "Let's improve your GovCon briefings" (POST /api/admin/feedback, "Update My Preferences")
 *   - the treatment-upgrade notice (POST /api/admin/align-treatment-types mode=notify,
 *     "View Your Dashboard")
 * `/briefings` is a legacy surface no customer email may target
 * (src/lib/email/legacy-destination-guard.ts), and an untagged link makes the email's effect
 * unmeasurable.
 *
 * Each CTA goes where its words say:
 *   - "Update My Preferences" -> the preferences page (NAICS, keywords, agencies, state — the
 *     four things the email asks the reader to refine), with ?email= so it loads their profile.
 *   - "View Your Dashboard" -> the Map, the product (mindyDashboardUrlFor carries ?email=).
 */
import { appendEmailUtm } from '@/lib/engagement';
import { MINDY_PREFERENCES_URL, mindyDashboardUrlFor } from '@/lib/mindy/email-branding';

export function feedbackOutreachPreferencesUrl(email: string): string {
  const clean = (email || '').trim().toLowerCase();
  const base = clean ? `${MINDY_PREFERENCES_URL}${MINDY_PREFERENCES_URL.includes('?') ? '&' : '?'}email=${encodeURIComponent(clean)}` : MINDY_PREFERENCES_URL;
  return appendEmailUtm(base, { campaign: 'feedback_outreach', content: 'update_preferences' });
}

export function treatmentUpgradeDashboardUrl(email: string): string {
  return appendEmailUtm(mindyDashboardUrlFor(email), { campaign: 'treatment_upgrade', content: 'view_dashboard' });
}
