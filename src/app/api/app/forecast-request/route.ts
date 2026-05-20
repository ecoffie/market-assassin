import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

function cleanString(value: unknown): string {
  return String(value || '').trim();
}

// GET: List user's forecast requests
export async function GET(request: NextRequest) {
  const email = cleanString(request.nextUrl.searchParams.get('email'));

  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  // SECURITY: Verify user owns this email
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await getSupabase()
    .from('forecast_requests')
    .select('*')
    .eq('user_email', auth.email!)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, requests: data || [] });
}

// POST: Create a forecast request
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = cleanString(body.email);
  const agency = cleanString(body.agency);
  const office = cleanString(body.office);
  const naicsCode = cleanString(body.naicsCode || body.naics_code);
  const description = cleanString(body.description || body.notes);

  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  // SECURITY: Verify user owns this email
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  if (!agency) {
    return NextResponse.json({ success: false, error: 'Agency is required' }, { status: 400 });
  }

  // Check for duplicate pending request
  const { data: existing } = await getSupabase()
    .from('forecast_requests')
    .select('id')
    .eq('user_email', auth.email!)
    .eq('agency', agency)
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      success: false,
      error: 'You already have a pending request for this agency',
    }, { status: 409 });
  }

  const { data, error } = await getSupabase()
    .from('forecast_requests')
    .insert({
      user_email: auth.email!,
      agency,
      office: office || null,
      naics_code: naicsCode || null,
      description: description || null,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, request: data });
}
