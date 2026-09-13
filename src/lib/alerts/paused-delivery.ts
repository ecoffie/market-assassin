/**
 * Preserve an explicit unsubscribe across writers that exist to SAVE TARGETING
 * or REFRESH PAID STATE — not to turn mail back on.
 *
 * Reproduced 2026-09-13 on Adam.Sokolowski01@gmail.com: he clicked Unsubscribe
 * (GET /api/alerts/unsubscribe → alerts_enabled=false, alert_frequency=paused)
 * then a later targeting save re-enabled daily mail because:
 *   • POST /api/alerts/save-profile always wrote alerts_enabled=true
 *   • ensureNotificationSettings always wrote alerts_enabled=true on paid refresh
 *   • the public preferences page posted briefingsEnabled:false / isActive from frequency
 *
 * A paused frequency is the CAN-SPAM signal. Targeting edits and webhook retries
 * must not treat it as "turn daily back on."
 */

export type AlertDeliveryRow = {
  alerts_enabled?: boolean | null;
  alert_frequency?: string | null;
  is_active?: boolean | null;
  briefings_enabled?: boolean | null;
};

export function isPausedAlertDelivery(row: AlertDeliveryRow | null | undefined): boolean {
  if (!row) return false;
  return row.alert_frequency === 'paused';
}

/**
 * Delivery fields for a targeting save (save-profile).
 *
 * Missing / empty requestedFrequency = "leave delivery alone."
 * Explicit daily|weekly = the user chose to resume.
 */
export function saveProfileAlertDeliveryPatch(
  existing: AlertDeliveryRow | null | undefined,
  requestedFrequency: string | undefined,
): { alerts_enabled: boolean; alert_frequency: string } {
  const requested = String(requestedFrequency || '').trim().toLowerCase();
  if (requested === 'paused') {
    return { alerts_enabled: false, alert_frequency: 'paused' };
  }
  if (requested === 'weekly' || requested === 'daily') {
    return { alerts_enabled: true, alert_frequency: requested };
  }
  if (isPausedAlertDelivery(existing)) {
    return { alerts_enabled: false, alert_frequency: 'paused' };
  }
  const existingFreq = String(existing?.alert_frequency || 'daily').toLowerCase();
  if (existingFreq === 'weekly') {
    return {
      alerts_enabled: existing?.alerts_enabled !== false,
      alert_frequency: 'weekly',
    };
  }
  return {
    alerts_enabled: existing?.alerts_enabled !== false,
    alert_frequency: existingFreq && existingFreq !== 'paused' ? existingFreq : 'daily',
  };
}

/**
 * Paid-state refresh for an EXISTING notification row.
 *
 * Writes paid_status / stripe_customer_id / briefings_enabled.
 * Does NOT unmute a paused alert frequency. Does NOT flip is_active on an
 * account that already opted out of all mail.
 */
export function paidRefreshNotificationPatch(
  existing: AlertDeliveryRow,
  args: { stripeCustomerId: string | null; nowIso: string },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    paid_status: true,
    stripe_customer_id: args.stripeCustomerId,
    updated_at: args.nowIso,
  };

  if (existing.is_active === false) {
    return patch;
  }

  patch.briefings_enabled = true;
  patch.is_active = true;
  if (!isPausedAlertDelivery(existing)) {
    patch.alerts_enabled = true;
  }
  return patch;
}
