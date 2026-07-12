/**
 * RETIRED (410 Gone). This was the one-time migration that copied users FROM the old
 * `user_alert_settings` INTO `user_notification_settings`. Its SOURCE table has since been
 * dropped, so it can never do anything again. The real table is now the sole source of
 * truth and is written directly. src/lib/retired-route.ts /
 * tasks/smart-profile-dead-table-findings.md.
 */
import { retiredAlertRoute } from '@/lib/retired-route';

export const GET = retiredAlertRoute('sync-alert-to-notification');
export const POST = retiredAlertRoute('sync-alert-to-notification');
