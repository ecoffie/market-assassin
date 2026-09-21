/**
 * RETIRED (410 Gone) — seeded paying customers into the dropped `user_alert_settings`
 * subsystem. See src/lib/retired-route.ts / tasks/smart-profile-dead-table-findings.md.
 */
import { retiredAlertRoute } from '@/lib/retired-route';

export const GET = retiredAlertRoute('seed-alerts');
