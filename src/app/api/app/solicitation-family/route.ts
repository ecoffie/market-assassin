/**
 * GET /api/app/solicitation-family?q=<notice_id|solicitation_number|customer_rfp>
 *
 * Known-ID family current truth. Does not change FIND Open.
 * Record UUID lookups still identify the worked-from notice; `current` is Amd N.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isKnownIdQuery, resolveFamilyForQuery } from '@/lib/sam/solicitation-family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ success: false, error: 'q is required' }, { status: 400 });
  }
  if (!isKnownIdQuery(q)) {
    return NextResponse.json({
      success: false,
      error: 'not a known identifier',
      hint: 'Pass a notice_id, SAM solicitation_number, or official RFP token — not a title.',
    }, { status: 400 });
  }

  try {
    const family = await resolveFamilyForQuery(q, { client: sb() });
    if (!family) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      queried: q,
      family,
      current: {
        notice_id: family.current_notice_id,
        status: family.current_status,
        deadline: family.current_deadline,
        amendment: family.current_amendment,
        set_aside: family.current_set_aside,
        office: family.office,
        contact: family.current_contact,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
