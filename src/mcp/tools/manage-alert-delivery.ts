/**
 * MCP: manage alert delivery email (separate from login / change-email / merge).
 *
 * Cassy-class: receive alerts at a verified address without re-keying the account.
 * Verified pool = account_linked_emails. Selected = alert_recipient_email.
 * Never accepts an arbitrary recipient — set only after assertSelectableDeliveryEmail.
 */
import { requestEmailLink } from '@/lib/mindy/linked-emails';
import {
  alertDestinationKind,
  assertSelectableDeliveryEmail,
  getAlertDeliverySettings,
  listDeliveryEmailCandidates,
  resolveAlertDeliveryEmail,
  setAlertDeliveryEmail,
} from '@/lib/mindy/alert-delivery';
import { mcpFlags } from '@/lib/mcp/flags';

export type ManageAlertDeliveryAction = 'list' | 'request_verify' | 'set' | 'clear';

export type ManageAlertDeliveryInput = {
  userEmail: string;
  action: ManageAlertDeliveryAction;
  /** Target for request_verify or set. Ignored for list/clear. */
  email?: string;
};

export type ManageAlertDeliveryResult = {
  action: ManageAlertDeliveryAction;
  account_email: string;
  linked: Array<{ email: string; verified_at: string | null }>;
  pending: Array<{ email: string; verified_at: string | null }>;
  selected: string | null;
  alert_destination: 'account_email' | 'delivery_email';
  delivery_email: string;
  message: string;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    /** True when set/clear/request_verify mutated or sent OTP successfully. */
    changed: boolean;
  };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string };
};

function emptyResult(
  action: ManageAlertDeliveryAction,
  account: string,
  message: string,
  degraded = false,
): ManageAlertDeliveryResult {
  return {
    action,
    account_email: account,
    linked: [],
    pending: [],
    selected: null,
    alert_destination: 'account_email',
    delivery_email: account,
    message,
    _meta: { grounded: false, degraded, changed: false },
  };
}

async function snapshot(owner: string, action: ManageAlertDeliveryAction, message: string, changed: boolean) {
  const candidates = await listDeliveryEmailCandidates(owner);
  const settings = await getAlertDeliverySettings(owner);
  const delivery = resolveAlertDeliveryEmail(owner, settings);
  const selected =
    settings?.alert_recipient_email &&
    settings.alert_recipient_email.toLowerCase() !== owner.toLowerCase()
      ? settings.alert_recipient_email.toLowerCase()
      : null;
  const result: ManageAlertDeliveryResult = {
    action,
    account_email: candidates.account_email || owner,
    linked: candidates.linked,
    pending: candidates.pending,
    selected,
    alert_destination: alertDestinationKind(owner, settings),
    delivery_email: delivery,
    message,
    _meta: { grounded: true, degraded: false, changed },
  };
  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: message,
      how_to_use:
        'list → request_verify (OTP to the new address) → user enters code in Settings or linked-emails API → set with that verified email. clear restores login inbox.',
      key_caveats:
        'set only accepts the account email or a verified linked address. This does not change login, credits, or saved watches. Account merge is a separate support action.',
    };
  }
  return result;
}

export async function manageAlertDelivery(
  input: ManageAlertDeliveryInput,
): Promise<ManageAlertDeliveryResult> {
  const owner = (input.userEmail || '').toLowerCase().trim();
  if (!owner) {
    return emptyResult(input.action || 'list', '', 'Authenticated account email required.', true);
  }

  const action = input.action;
  if (action !== 'list' && action !== 'request_verify' && action !== 'set' && action !== 'clear') {
    return emptyResult('list', owner, 'action must be list | request_verify | set | clear.');
  }

  if (action === 'list') {
    return snapshot(owner, 'list', 'Alert delivery status for this account.', false);
  }

  if (action === 'clear') {
    const wrote = await setAlertDeliveryEmail(owner, null);
    if (!wrote.ok) {
      return emptyResult('clear', owner, wrote.error || 'Could not clear delivery email.', true);
    }
    return snapshot(
      owner,
      'clear',
      `Alerts will go to ${owner} (login email). Saved watches are unchanged.`,
      true,
    );
  }

  const target = (input.email || '').toLowerCase().trim();
  if (!target || !target.includes('@')) {
    return emptyResult(action, owner, 'email is required for request_verify and set.');
  }

  if (action === 'request_verify') {
    const r = await requestEmailLink(owner, target);
    if (!r.ok) {
      const msg =
        r.reason === 'same-email'
          ? 'That is already your login email — select it with action=set or clear.'
          : r.reason === 'throttled'
            ? 'A code was just sent — check the inbox or wait a minute.'
            : r.reason === 'limit'
              ? 'This account already has the maximum linked emails.'
              : r.reason === 'taken'
                ? 'That email is already connected to another Mindy account.'
                : r.error || 'Could not start verification.';
      const snap = await snapshot(owner, 'request_verify', msg, false);
      snap._meta.grounded = false;
      return snap;
    }
    return snapshot(
      owner,
      'request_verify',
      `Verification code sent to ${target}. Enter the code in Mindy Settings (or linked-emails confirm), then call set.`,
      true,
    );
  }

  // action === 'set'
  const check = await assertSelectableDeliveryEmail(owner, target);
  if (!check.ok) {
    const msg =
      check.reason === 'unverified'
        ? `Verify ${target} first (request_verify + enter the code), then set.`
        : check.reason === 'foreign'
          ? `${target} is not linked to this account. Call request_verify first.`
          : check.error || 'Cannot select that address.';
    const snap = await snapshot(owner, 'set', msg, false);
    snap._meta.grounded = false;
    return snap;
  }

  const wrote = await setAlertDeliveryEmail(owner, target);
  if (!wrote.ok) {
    return emptyResult('set', owner, wrote.error || 'Could not save delivery email.', true);
  }
  return snapshot(
    owner,
    'set',
    target === owner
      ? `Alerts will go to ${owner} (login email). Saved watches are unchanged.`
      : `Alerts will go to ${target}. Login, credits, and saved watches stay on ${owner}.`,
    true,
  );
}
