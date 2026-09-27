/**
 * POST /api/company-setup — the ONE write path for company setup.
 *
 * ⚠️ THE RULE THIS ROUTE ENFORCES: **Skip is not acceptance.** A derived suggestion may
 * not enter the ACTIVE profile because Mindy generated it and the user walked away.
 * Writing `derived_suggestion` on skip would recreate the false-completeness defect that
 * left 7,928 of 9,778 users (81.1%) carrying a placeholder nobody chose.
 *
 * The route does NOT decide provenance. `resolveSetupWrite` (locked, tested) returns the
 * profile patch, and skip returns `{}` — so applying it is a structural no-op rather than
 * something this handler has to remember not to do.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveSetupWrite, type SetupAction } from '@/lib/profile/company-setup-outcome';
import { resolveSetupInput, type CertificationAnswer } from '@/lib/profile/company-setup-input';
import { resolvePostSignupDestination } from '@/lib/mindy/post-signup-destination';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { validateMarketCodesInput } from '@/lib/codes/validate-market-codes';
import { freeNotificationSettingsInsert } from '@/lib/onboarding/free-notification-defaults';

const ACTIONS: SetupAction[] = ['confirm', 'accept_all', 'skip'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || '') as SetupAction;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 });
    }

    // Setup writes to the caller's OWN profile only.
    // requireStrongAuth: the weak-auth sweep measured that the default path trusts ANY
    // staff email with no credential. This route writes a user's own profile, so it takes
    // the strong path rather than the permissive default.
    const auth = await verifyUserOwnsEmail(request, body.email, { requireStrongAuth: true });
    if (!auth.authenticated || !auth.email) {
      return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
    }
    const email = auth.email;

    // Where they go afterwards NEVER depends on whether they filled the form in.
    const destination = resolvePostSignupDestination({
      next: body.next, intent: body.intent, purchaseNext: body.purchase_next,
    });

    // Screen 1 answers — user-entered, never derived.
    const screen1 = resolveSetupInput({
      companyName: body.companyName,
      description: body.description,
      certifications: (body.certifications ?? null) as CertificationAnswer,
      states: body.states ?? null,
    });

    // Screen 2 outcome — the locked semantics. Skip yields `{}`.
    const outcome = resolveSetupWrite(action, body.selection || {});
    if (outcome.profile.naics_codes || outcome.profile.psc_codes) {
      const codesCheck = validateMarketCodesInput(
        outcome.profile.naics_codes,
        outcome.profile.psc_codes,
      );
      if (!codesCheck.ok) {
        return NextResponse.json({ success: false, error: codesCheck.error, path: destination.path }, { status: 400 });
      }
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // ── Screen 1 is written on EVERY action, including skip. Skipping the SUGGESTIONS is
    // not the same as discarding what the user typed about themselves: a name and a
    // description are their own statements, not Mindy's inference.
    const notif: Record<string, unknown> = {};
    if (screen1.company_name) notif.company_name = screen1.company_name;
    if (screen1.set_aside_preferences) notif.set_aside_preferences = screen1.set_aside_preferences;
    if (screen1.location_states) notif.location_states = screen1.location_states;

    // ── Screen 2 patch. For skip this is `{}` and adds nothing.
    Object.assign(notif, outcome.profile);

    let createdRow = false;
    if (Object.keys(notif).length) {
      // ── A MISSING ROW IS NOT A WRITE (P0-E). `.update()` against a user with no settings
      // row matches zero rows and returns no error, so it used to answer success while the
      // confirmed codes went nowhere. Ask for the touched rows and CREATE the row (same free
      // defaults /api/app/profile creates) when there is none. An existing row is only ever
      // patched with the keys above — nothing else on it changes. The row count comes from
      // { count: 'exact' } (never a RETURNING payload), and a NULL count is UNKNOWN — a failure,
      // not "no row" (INT-005 / Bug Prevention Rule #11).
      const nowIso = new Date().toISOString();
      const patch = { ...notif, updated_at: nowIso };
      const updateRow = () => sb.from('user_notification_settings')
        .update(patch, { count: 'exact' })
        .eq('user_email', email);
      const fail = (message: string) => {
        // Surface the write failure — a silent one would look identical to a skip.
        console.error('[company-setup] profile update failed:', message);
        return NextResponse.json({ success: false, error: message, path: destination.path }, { status: 500 });
      };

      const { count: updated, error } = await updateRow();
      if (error) return fail(error.message);
      if (updated == null) return fail('settings update count unknown');
      if (updated === 0) {
        const { error: insErr } = await sb.from('user_notification_settings')
          .insert({ ...freeNotificationSettingsInsert(email, nowIso), ...patch });
        if (insErr) {
          // 23505: a concurrent request created the row between our update and insert.
          // Patch that row rather than reporting a false failure.
          if (insErr.code !== '23505') return fail(insErr.message);
          const { count: retried, error: retryErr } = await updateRow();
          if (retryErr) return fail(retryErr.message);
          if (!retried) return fail('settings row could not be written');
        } else {
          createdRow = true;
        }
      }
    }

    if (screen1.business_description) {
      const { error } = await sb.from('user_business_profiles')
        .upsert({
          user_email: email,
          business_description: screen1.business_description,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_email' });
      if (error) console.error('[company-setup] description upsert failed:', error.message);
    }

    return NextResponse.json({
      success: true,
      path: destination.path,
      wrote: Object.keys(notif),
      created_settings_row: createdRow,
      provenance: outcome.profile.naics_source ?? null,
      reason: outcome.reason,
    });
  } catch (err) {
    console.error('[company-setup] failed:', err);
    return NextResponse.json({ success: false, error: 'setup failed' }, { status: 500 });
  }
}
