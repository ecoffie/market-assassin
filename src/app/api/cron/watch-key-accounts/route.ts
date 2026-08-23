/**
 * Key-account health watchdog.
 *
 * Our highest-signal users (active, giving feedback, paying) are the ones whose
 * breakage costs the most and gets noticed the least — the platform-wide
 * watchdogs average them away. check-alert-throughput fires when the WHOLE
 * batch collapses; one user silently losing their NAICS, their entitlements,
 * or their daily send never moves that needle.
 *
 * This route checks a small named list, per account, every weekday morning —
 * shortly after the daily alert batch — and alerts ONLY when something is
 * wrong. Silence means healthy.
 *
 * Written 2026-08-04 after marketresearch@xcelligen.com (Xcelligen — most
 * active user, actively sending feedback) reported that alert opportunities
 * didn't appear in Today's Intel. Root cause was a matching mismatch
 * (mi-dashboard read NAICS only; daily-alerts reads NAICS + PSC + keywords),
 * but the deeper problem was that nothing would have told us. This closes that.
 *
 * Checks per account:
 *   1. Today's daily alert actually sent, with a non-zero opportunity count
 *   2. Targeting intact — NAICS/PSC/keywords didn't silently empty out
 *   3. Entitlements intact — paid access flags didn't flip false
 *   4. Alerts still enabled/active
 *
 * Auth: x-vercel-cron header, the dispatcher's `Authorization: Bearer
 * <CRON_SECRET>`, OR ?password=<ADMIN_PASSWORD> for manual triggering.
 *
 * Manual dry-run (no alert sent, prints the report):
 *   /api/cron/watch-key-accounts?password=<ADMIN_PASSWORD>&dry=1
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOpsAlert } from '@/lib/ops-alert';
import { findBriefingsDrift, type DriftRow } from '@/lib/supabase/briefings-entitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The watch list. Keep it SHORT — this is for accounts whose breakage we want
 * to hear about the same morning, not a general dashboard. Every entry costs a
 * few queries and, more importantly, a slice of attention when it fires.
 *
 * `minNaics`/`minPsc`/`minKeywords` are floors, not exact counts: targeting
 * legitimately grows, but a collapse toward zero is the failure we're catching
 * (a profile wipe, a bad migration, an onboarding overwrite).
 */
interface WatchedAccount {
  email: string;
  label: string;
  minNaics: number;
  minPsc: number;
  minKeywords: number;
  /** Paid flags expected true. Flipping false = a silent entitlement loss. */
  expectAccess: string[];
}

const WATCHED: WatchedAccount[] = [
  {
    email: 'marketresearch@xcelligen.com',
    label: 'Xcelligen (most active user, active feedback)',
    // Baseline 2026-08-04: 12 NAICS / 24 PSC / 40 keywords.
    // Floors sit well under baseline so normal editing doesn't page us.
    minNaics: 4,
    minPsc: 6,
    minKeywords: 8,
    expectAccess: [
      'ma_access',
      'access_contractor_db',
      'access_recompete',
      'access_hunter_pro',
      'access_briefings',
      'access_daily_briefings',
    ],
  },
];

/** A single thing that's wrong. Severity drives whether we alert or just log. */
interface Finding {
  email: string;
  label: string;
  severity: 'critical' | 'warning';
  message: string;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const passwordOk = request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  const hasCronSecret =
    !!process.env.CRON_SECRET &&
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !passwordOk && !hasCronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = request.nextUrl.searchParams.get('dry') === '1';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const findings: Finding[] = [];
  const checked: Record<string, unknown>[] = [];

  for (const acct of WATCHED) {
    const { email, label } = acct;
    const snapshot: Record<string, unknown> = { email, label };

    // ---- 1. Did today's daily alert send? -------------------------------
    // Weekend sends don't happen, so only judge this Mon-Fri.
    const dow = new Date().getUTCDay();
    const isWeekday = dow >= 1 && dow <= 5;
    const { data: todayAlerts, error: alertErr } = await supabase
      .from('alert_log')
      // construction, regardless of alert_log being 131,217 rows.
      // truncation-ok: predicate-bounded (see the note above) — measured, not assumed.
      .select('alert_date, alert_type, delivery_status, opportunities_count, sent_at, error_message')
      .eq('user_email', email)
      .eq('alert_date', todayUtcDate())
      .eq('alert_type', 'daily');

    if (alertErr) {
      findings.push({ email, label, severity: 'warning', message: `alert_log query failed: ${alertErr.message}` });
    } else {
      const sent = (todayAlerts || []).find(a => a.delivery_status === 'sent');
      snapshot.todayAlert = sent
        ? { status: 'sent', opportunities: sent.opportunities_count, at: sent.sent_at }
        : (todayAlerts || [])[0] || null;

      if (isWeekday && !todayAlerts?.length) {
        findings.push({ email, label, severity: 'critical', message: 'No daily alert row for today — the send never ran for this user.' });
      } else if (isWeekday && !sent) {
        const row = todayAlerts![0];
        // 'skipped' with send_guard_blocked is the anti-double-send guard doing
        // its job when a send already happened — not a failure.
        const benignSkip = row.delivery_status === 'skipped' && row.error_message === 'send_guard_blocked';
        if (!benignSkip) {
          findings.push({
            email, label, severity: 'critical',
            message: `Today's daily alert did not send — status='${row.delivery_status}'${row.error_message ? `, error='${row.error_message}'` : ''}.`,
          });
        }
      } else if (sent && (sent.opportunities_count ?? 0) === 0) {
        findings.push({ email, label, severity: 'warning', message: 'Daily alert sent but contained 0 opportunities — targeting may have broken.' });
      }
    }

    // ---- 2 & 4. Targeting + alert switches ------------------------------
    const { data: settings, error: setErr } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, psc_codes, keywords, agencies, alerts_enabled, is_active, paid_status')
      .eq('user_email', email)
      .maybeSingle();

    if (setErr) {
      findings.push({ email, label, severity: 'warning', message: `settings query failed: ${setErr.message}` });
    } else if (!settings) {
      findings.push({ email, label, severity: 'critical', message: 'No user_notification_settings row — this account has no targeting at all.' });
    } else {
      const nNaics = (settings.naics_codes || []).length;
      const nPsc = (settings.psc_codes || []).length;
      const nKw = (settings.keywords || []).length;
      snapshot.targeting = { naics: nNaics, psc: nPsc, keywords: nKw };
      snapshot.switches = {
        alerts_enabled: settings.alerts_enabled,
        is_active: settings.is_active,
        paid_status: settings.paid_status,
      };

      if (nNaics < acct.minNaics) {
        findings.push({ email, label, severity: 'critical', message: `NAICS codes dropped to ${nNaics} (floor ${acct.minNaics}) — targeting collapsed.` });
      }
      if (nPsc < acct.minPsc) {
        findings.push({ email, label, severity: 'warning', message: `PSC codes dropped to ${nPsc} (floor ${acct.minPsc}).` });
      }
      if (nKw < acct.minKeywords) {
        findings.push({ email, label, severity: 'warning', message: `Keywords dropped to ${nKw} (floor ${acct.minKeywords}).` });
      }
      if (settings.alerts_enabled === false) {
        findings.push({ email, label, severity: 'critical', message: 'alerts_enabled flipped to false — they will receive nothing.' });
      }
      if (settings.is_active === false) {
        findings.push({ email, label, severity: 'critical', message: 'is_active flipped to false — excluded from the alert batch.' });
      }
    }

    // ---- 3. Entitlements ------------------------------------------------
    const { data: profile, error: profErr } = await supabase
      .from('user_profiles')
      .select(acct.expectAccess.join(', '))
      .eq('email', email)
      .maybeSingle();

    if (profErr) {
      findings.push({ email, label, severity: 'warning', message: `user_profiles query failed: ${profErr.message}` });
    } else if (!profile) {
      findings.push({ email, label, severity: 'critical', message: 'No user_profiles row — the account lost its profile.' });
    } else {
      // Supabase can't type a runtime-built select(), so widen through unknown.
      const flags = profile as unknown as Record<string, unknown>;
      const lost = acct.expectAccess.filter(f => flags[f] !== true);
      snapshot.accessLost = lost;
      if (lost.length > 0) {
        findings.push({
          email, label, severity: 'critical',
          message: `Paid access flags flipped false: ${lost.join(', ')} — they are being downgraded silently.`,
        });
      }
    }

    checked.push(snapshot);
  }

  // ---- Fleet-wide invariant: entitled ⇒ deliverable -------------------
  // Not per-account: this catches the whole population, including people we
  // aren't explicitly watching. access_briefings=true with briefings_enabled=
  // false means precompute-briefings skips them — entitled, never sent.
  // Found 2026-08-05 affecting 27 accounts, 14 of them paying ($7,202).
  // Silent by construction: they still get alerts, so nothing looks broken.
  let briefingsDrift: DriftRow[] = [];
  const drift = await findBriefingsDrift(supabase);
  if (!drift.ok) {
    findings.push({
      email: '(fleet)', label: 'briefings drift check', severity: 'warning',
      message: `Drift query failed: ${drift.error}`,
    });
  } else if (drift.rows.length > 0) {
    briefingsDrift = drift.rows;
    const paid = drift.rows.filter(r => r.paid_status).length;
    const blockedOnEntitlement = drift.rows.filter(r => !r.entitlement_ok).length;
    const sample = drift.rows.slice(0, 5).map(r => r.user_email).join(', ');
    findings.push({
      email: '(fleet)',
      label: 'briefings entitled-but-undelivered',
      // Paying customers not receiving what they bought is critical; a comped
      // account in the same state is worth knowing but isn't an emergency.
      severity: paid > 0 ? 'critical' : 'warning',
      message:
        `${drift.rows.length} account(s) have access_briefings=true but ` +
        `briefings_enabled=false — entitled, with real targeting, never sent a briefing` +
        (paid > 0 ? ` (${paid} PAYING)` : '') +
        `. e.g. ${sample}${drift.rows.length > 5 ? ` +${drift.rows.length - 5} more` : ''}. ` +
        // Name the gate that is ACTUALLY blocking delivery. Advising a flag
        // flip for an account blocked on entitlement is advising a no-op —
        // it gets applied, reported as fixed, and the customer stays silent.
        (blockedOnEntitlement === drift.rows.length
          ? `Fix: ALL of these are blocked by customer_classifications (briefings_access) — ` +
            `setting briefings_enabled=true alone delivers NOTHING. Grant the classification first, then flip the preference.`
          : blockedOnEntitlement > 0
            ? `Fix: ${drift.rows.length - blockedOnEntitlement} need briefings_enabled=true; ` +
              `the other ${blockedOnEntitlement} are ALSO blocked by customer_classifications (briefings_access) ` +
              `and need that granted FIRST or the flag flip is a no-op.`
            : `Fix: set briefings_enabled=true on their notification settings.`),
    });
  }

  const critical = findings.filter(f => f.severity === 'critical');
  const healthy = findings.length === 0;

  // Alert only when something is wrong — a watchdog that emails on healthy days
  // trains you to ignore it.
  if (!healthy && !dry) {
    const rows = findings
      .map(f => `<li><b>[${f.severity.toUpperCase()}]</b> ${f.label} (${f.email})<br/>${f.message}</li>`)
      .join('');
    await sendOpsAlert({
      subject: `Key account issue: ${findings.length} finding${findings.length === 1 ? '' : 's'}${critical.length ? ` (${critical.length} critical)` : ''}`,
      html: `<p>The key-account watchdog found problems this morning:</p><ul>${rows}</ul>
             <p>Checked: ${WATCHED.map(w => w.email).join(', ')}</p>`,
    });
  }

  return NextResponse.json({
    success: true,
    healthy,
    dry,
    checkedAt: new Date().toISOString(),
    accountsChecked: WATCHED.length,
    briefingsDrift,
    findings,
    snapshot: checked,
  });
}
