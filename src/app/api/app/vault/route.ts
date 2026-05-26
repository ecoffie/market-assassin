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

// GET — return all vault data for the user in one shot (panel uses
// this on mount; cheap because every section is at most a few hundred
// rows per user).
export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;
  const supabase = getSupabase();

  const [identityRes, ppRes, capsRes, teamRes, docsRes] = await Promise.all([
    supabase.from('user_identity_profile').select('*').eq('user_email', userEmail).maybeSingle(),
    supabase.from('user_past_performance').select('*').eq('user_email', userEmail).is('archived_at', null).order('updated_at', { ascending: false }),
    supabase.from('user_capabilities_library').select('*').eq('user_email', userEmail).is('archived_at', null).order('updated_at', { ascending: false }),
    supabase.from('user_team_members').select('*').eq('user_email', userEmail).is('archived_at', null).order('is_key_personnel', { ascending: false }),
    supabase.from('user_boilerplate_docs').select('id,doc_type,original_filename,mime_type,size_bytes,page_count,parse_status,created_at').eq('user_email', userEmail).is('archived_at', null).order('created_at', { ascending: false }),
  ]);

  return NextResponse.json({
    success: true,
    identity: identityRes.data || {},
    past_performance: ppRes.data || [],
    capabilities: capsRes.data || [],
    team: teamRes.data || [],
    documents: docsRes.data || [],
  });
}
