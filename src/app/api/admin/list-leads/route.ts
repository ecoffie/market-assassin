import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

/**
 * GET /api/admin/list-leads
 *
 * List all leads from free resource downloads
 */

/** Paginated read — PostgREST caps responses at 1,000 rows silently. See docs/engineering/postgrest-1000-row-cap.md */
async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error };
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return { data: out, error: null };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    // Get all leads
    // count:'exact' is the TRUE population; the rows are paginated to match it.
    // Reading both lets the route CHECK ITSELF rather than trust the read (below).
    const { count, error: countError } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });
    if (countError) {
      return NextResponse.json({ error: 'Failed to count leads', details: countError }, { status: 500 });
    }
    const { data: leads, error } = await readAllRows<Record<string, string | null>>((from, to) => supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to));

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch leads', details: error }, { status: 500 });
    }

    // SELF-CHECK: if the paginated read disagrees with the exact head-count, the
    // numbers below are not the population — say so rather than report them.
    if (count !== null && (leads || []).length !== count) {
      return NextResponse.json({
        error: 'Lead read incomplete — refusing to report a partial population as a total.',
        rowsRead: (leads || []).length,
        actualCount: count,
      }, { status: 500 });
    }

    // Get unique emails
    const uniqueEmails = new Set((leads || []).map(l => l.email?.toLowerCase()).filter(Boolean));

    // Check which are already in user_profiles
    const { data: profiles } = await readAllRows<{ email: string | null }>((from, to) => supabase
      .from('user_profiles')
      .select('email')
      .range(from, to));

    const profileEmails = new Set((profiles || []).map(p => p.email?.toLowerCase()).filter(Boolean));

    // Check which are already in user_notification_settings
    const { data: alertSettings } = await readAllRows<{ user_email: string | null }>((from, to) => supabase
      .from('user_notification_settings')
      .select('user_email')
      .range(from, to));

    const alertEmails = new Set((alertSettings || []).map(s => s.user_email?.toLowerCase()).filter(Boolean));

    // Find leads NOT in either table (truly new free users)
    const newFreeUsers = Array.from(uniqueEmails).filter(
      email => !profileEmails.has(email) && !alertEmails.has(email)
    );

    return NextResponse.json({
      success: true,
      stats: {
        // NOT `count || 0`: a missing/unreadable table returns count=null with NO
        // error, and reporting 0 leads would read as a real (catastrophic) measurement.
        // countError already returned 500 above; null here means genuinely unknown.
        totalLeads: count,
        uniqueEmails: uniqueEmails.size,
        alreadyInProfiles: Array.from(uniqueEmails).filter(e => profileEmails.has(e)).length,
        alreadyInAlerts: Array.from(uniqueEmails).filter(e => alertEmails.has(e)).length,
        newFreeUsers: newFreeUsers.length,
      },
      newFreeUsers: newFreeUsers.slice(0, 50), // Show first 50
      recentLeads: (leads || []).slice(0, 20).map(l => ({
        email: l.email,
        resource: l.resource_id,
        created: l.created_at,
        source: l.source
      }))
    });

  } catch (error) {
    console.error('[List Leads] Error:', error);
    return NextResponse.json({
      error: 'Server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
