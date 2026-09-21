/**
 * RETIRED (410 Gone) — sent "catch-up" alert emails to recipients pulled from the dropped
 * `user_alert_settings` subsystem. Alerts/briefings now run off `user_notification_settings`
 * via the dispatcher crons. Kept as a loud 410 (behind admin/cron auth) so this email-SENDING
 * route can never accidentally fire again. src/lib/retired-route.ts /
 * tasks/smart-profile-dead-table-findings.md.
 */
import { retiredAlertRoute } from '@/lib/retired-route';

export const GET = retiredAlertRoute('send-catch-up-alerts');
