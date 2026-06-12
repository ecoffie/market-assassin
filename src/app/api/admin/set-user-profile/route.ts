import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';

/**
 * POST /api/admin/set-user-profile?password=...
 *
 * Support tool: set a single user's alert profile (NAICS + keywords [+ PSC])
 * directly, by email — for unblocking users whose onboarding/save didn't take.
 * Service-role write to user_notification_settings. REPLACES the listed fields.
 *
 * Body: { email, naicsCodes?: string[], keywords?: string[], pscCodes?: string[],
 *         businessType?: string }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Bad JSON' }, { status: 400 }); }

  const email = String(body.email || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const update: Record<string, unknown> = {
    user_email: email,
    alerts_enabled: true,
    updated_at: new Date().toISOString(),
  };

  if (Array.isArray(body.naicsCodes)) {
    const raw = body.naicsCodes.map((c) => String(c).trim()).filter(Boolean);
    update.naics_codes = raw.length ? expandNAICSCodes(raw) : [];
  }
  if (Array.isArray(body.keywords)) {
    update.keywords = Array.from(new Set(body.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean))).slice(0, 30);
  }
  // PSC only written when a psc_codes column exists — guarded so a missing column
  // doesn't fail the whole write. Try it; on column error, retry without it.
  let pscCodes: string[] | null = null;
  if (Array.isArray(body.pscCodes)) {
    pscCodes = body.pscCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  }
  if (typeof body.businessType === 'string' && body.businessType.trim()) {
    update.business_type = body.businessType.trim();
  }

  async function writeProfile(withPsc: boolean) {
    const payload = withPsc && pscCodes ? { ...update, psc_codes: pscCodes } : update;
    // Upsert by user_email; if the row exists, update it.
    const { data: existing } = await supabase
      .from('user_notification_settings')
      .select('user_email')
      .eq('user_email', email)
      .maybeSingle();
    if (existing) {
      return supabase.from('user_notification_settings').update(payload).eq('user_email', email);
    }
    return supabase.from('user_notification_settings').insert(payload);
  }

  let res = await writeProfile(Boolean(pscCodes));
  let pscWritten = Boolean(pscCodes);
  if (res.error && /psc_codes/.test(res.error.message)) {
    // No psc_codes column → retry without it, report honestly.
    pscWritten = false;
    res = await writeProfile(false);
  }
  if (res.error) {
    return NextResponse.json({ success: false, error: res.error.message }, { status: 500 });
  }

  // Read back to confirm.
  const { data: after } = await supabase
    .from('user_notification_settings')
    .select('user_email, naics_codes, keywords, business_type')
    .eq('user_email', email)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    email,
    pscWritten,
    pscSkippedReason: pscCodes && !pscWritten ? 'no psc_codes column in user_notification_settings' : undefined,
    profile: after,
  });
}
