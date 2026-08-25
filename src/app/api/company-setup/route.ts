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

    if (Object.keys(notif).length) {
      const { error } = await sb.from('user_notification_settings')
        .update({ ...notif, updated_at: new Date().toISOString() })
        .eq('user_email', email);
      if (error) {
        // Surface the write failure — a silent one would look identical to a skip.
        console.error('[company-setup] profile update failed:', error.message);
        return NextResponse.json({ success: false, error: error.message, path: destination.path }, { status: 500 });
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
      provenance: outcome.profile.naics_source ?? null,
      reason: outcome.reason,
    });
  } catch (err) {
    console.error('[company-setup] failed:', err);
    return NextResponse.json({ success: false, error: 'setup failed' }, { status: 500 });
  }
}
