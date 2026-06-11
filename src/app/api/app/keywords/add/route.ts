import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserSession } from '@/lib/api-auth';

/**
 * POST /api/app/keywords/add  { email, keywords: string[] }
 *
 * ADDITIVE merge of keywords into user_notification_settings.keywords — never
 * clobbers the existing (tuned) array. Used when a user researches by keyword in
 * Market Research Sport mode: their own words are the strongest search signal, so
 * we capture them into the profile instead of throwing them away after one report.
 *
 * Lowercases + dedupes; caps the stored array at 40 so a power user can't bloat it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : '';
    const incoming = Array.isArray(body?.keywords) ? body.keywords : [];
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

    const auth = await verifyUserSession(request);
    if (!auth.authenticated || auth.email !== email) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    const clean = Array.from(new Set(
      incoming.map((k: unknown) => String(k).trim().toLowerCase()).filter(Boolean),
    ));
    if (clean.length === 0) {
      return NextResponse.json({ success: true, added: 0, note: 'no usable keywords' });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: cur } = await supabase
      .from('user_notification_settings')
      .select('keywords')
      .eq('user_email', email)
      .maybeSingle();

    const existing = Array.isArray(cur?.keywords)
      ? cur!.keywords.map((k: unknown) => String(k).trim().toLowerCase()).filter(Boolean)
      : [];
    const merged = Array.from(new Set([...existing, ...clean])).slice(0, 40);
    const added = merged.length - existing.length;
    if (added <= 0) {
      return NextResponse.json({ success: true, added: 0, total: merged.length });
    }

    const { error } = await supabase
      .from('user_notification_settings')
      .upsert(
        { user_email: email, keywords: merged, updated_at: new Date().toISOString() },
        { onConflict: 'user_email' },
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, added, total: merged.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
