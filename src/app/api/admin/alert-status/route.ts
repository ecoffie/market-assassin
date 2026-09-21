/**
 * RETIRED (410 Gone) — reported status for the dropped `user_alert_settings` subsystem.
 * Use /api/admin/user-breakdown (reads user_notification_settings) for real profile/alert
 * counts. src/lib/retired-route.ts / tasks/smart-profile-dead-table-findings.md.
 */
import { retiredAlertRoute } from '@/lib/retired-route';

export const GET = retiredAlertRoute('alert-status');
