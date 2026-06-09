/**
 * /api/app/coach
 *
 * Coach Mode (PRD-coach-mode-apex). A coach at a partner org (APEX, SBDC, …)
 * manages many client businesses. This returns the coach's org + assigned
 * clients + the "Org Tab" feed (cross-client deadlines, alerts, news).
 *
 * GET ?email=                  → { isCoach, org, clients[], orgTab }
 * POST { email, action }       → 'add_client' { business_name } | 'assign' …
 *
 * Each client = a workspace_id. Switching the active client (client-side) sets
 * the x-active-workspace header so the rest of the app operates as that client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { keywordCoverage } from '@/lib/market/keyword-coverage';
import { sanitizeKeywords } from '@/lib/market/keyword-sanitize';

// US state codes + a few aliases, to pull a location out of capability text
// (Eric: "staffing in or around PR professional service" → PR).
const STATE_ALIASES: Record<string, string> = {
  'puerto rico': 'PR', 'pr': 'PR', 'washington dc': 'DC', 'd.c.': 'DC',
};
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU'];

/**
 * Seed a new client workspace's profile from pasted capability/website text
 * (Eric: "paste their info → extract keywords + NAICS/PSC + location → so I track
 * them + get their alerts"). Grounds codes in real USASpending (this session's
 * keyword-first work), sanitizes keywords, pulls a state, and writes the
 * workspace's notification settings (keyed by the client email) so alerts flow.
 */
async function seedClientProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, workspaceId: string, businessName: string, text: string,
): Promise<{ naics: string[]; psc: string[]; keywords: string[]; states: string[] }> {
  // Keywords — significant terms from the text, sanitized (drop noise/abbrevs).
  const rawTerms = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  const keywords = sanitizeKeywords(rawTerms).slice(0, 10);

  // 1) Grounded codes — resolve on the CORE industry phrase, not the whole
  //    sentence (a full sentence matches unrelated codes). Try the strongest 1-2
  //    significant terms; keyword-coverage already does candidate fallback.
  const corePhrase = keywords.slice(0, 2).join(' ') || keywords[0] || text.slice(0, 60);
  const cov = await keywordCoverage(corePhrase).catch(() => null);
  const naics = cov?.coverageCodes?.slice(0, 8) || [];
  const psc = cov?.topPsc ? [cov.topPsc.code] : [];

  // 3) Location — scan for a state name/code (PR for "Puerto Rico").
  const lower = ` ${text.toLowerCase()} `;
  const states = new Set<string>();
  for (const [alias, code] of Object.entries(STATE_ALIASES)) {
    if (lower.includes(` ${alias} `)) states.add(code);
  }
  for (const st of US_STATES) {
    if (new RegExp(`\\b${st}\\b`).test(text)) states.add(st);
  }

  // 4) Write the workspace's notification profile (keyed by the client email).
  const clientEmail = `${workspaceId}@clients.getmindy.ai`;
  await supabase.from('user_notification_settings').upsert({
    user_email: clientEmail,
    naics_codes: naics,
    keywords,
    location_states: Array.from(states),
    business_type: 'Small Business',
    primary_industry: businessName,
    alerts_enabled: true,
    alert_frequency: 'weekly',     // start gentle for a tracked client, not daily spam
    is_active: true,
  }, { onConflict: 'user_email' });

  return { naics, psc, keywords, states: Array.from(states) };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;
  const supabase = sb();

  // Is this user a coach/admin in any org?
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_email', email)
    .eq('status', 'active')
    .in('role', ['coach', 'org_admin'])
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ success: true, isCoach: false });
  }

  const { data: org } = await supabase.from('organizations').select('*').eq('id', membership.org_id).maybeSingle();

  // The coach's assigned clients (org_admin sees all in the org).
  let cq = supabase.from('org_clients').select('*').eq('org_id', membership.org_id).eq('status', 'active');
  if (membership.role === 'coach') cq = cq.eq('assigned_coach', email);
  const { data: clients } = await cq;
  const clientList = clients || [];

  // Org Tab: cross-client deadlines (next 30d) + recent pursuit changes + news.
  const workspaceIds = clientList.map((c: { workspace_id: string }) => c.workspace_id);
  const wsToName = new Map<string, string>();
  for (const c of clientList) wsToName.set(c.workspace_id, c.business_name);

  let deadlines: Array<Record<string, unknown>> = [];
  let changes: Array<Record<string, unknown>> = [];
  if (workspaceIds.length) {
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString();
    const { data: pl } = await supabase
      .from('user_pipeline')
      .select('id, workspace_id, title, response_deadline, stage')
      .in('workspace_id', workspaceIds)
      .not('response_deadline', 'is', null)
      .lte('response_deadline', in30)
      .neq('is_archived', true)
      .order('response_deadline', { ascending: true })
      .limit(50);
    deadlines = (pl || []).map((p: Record<string, unknown>) => ({ ...p, client: wsToName.get(p.workspace_id as string) || 'Client' }));

    // Recent amendment/change alerts across the coach's clients' pursuits.
    const pursuitIds = (pl || []).map((p: { id: string }) => p.id);
    if (pursuitIds.length) {
      const { data: ch } = await supabase
        .from('pursuit_change_log')
        .select('pursuit_id, summary, change_type, detected_at')
        .in('pursuit_id', pursuitIds)
        .eq('acknowledged', false)
        .order('detected_at', { ascending: false })
        .limit(30);
      changes = ch || [];
    }
  }

  const { data: news } = await supabase
    .from('org_news')
    .select('id, title, body, pinned, created_at')
    .eq('org_id', membership.org_id)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    success: true,
    isCoach: true,
    role: membership.role,
    org: org ? { id: org.id, name: org.name, tabLabel: org.tab_label, logoUrl: org.logo_url, brandColor: org.brand_color } : null,
    clients: clientList.map((c: Record<string, unknown>) => ({
      id: c.id, workspaceId: c.workspace_id, businessName: c.business_name, primaryEmail: c.primary_email,
    })),
    orgTab: { deadlines, changes, news: news || [] },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;
  const supabase = sb();

  let { data: membership } = await supabase
    .from('org_members').select('org_id, role').eq('user_email', email).eq('status', 'active')
    .in('role', ['coach', 'org_admin']).maybeSingle();

  // Solo-consultant self-serve (Eric's use case): a non-coach who adds a client
  // gets a lightweight personal org auto-created, with them as admin + coach.
  // No APEX-style org provisioning needed — same machinery, lighter entry.
  if (!membership && body.action === 'add_client') {
    const slug = `solo-${email.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)}`;
    const { data: org } = await supabase.from('organizations').insert({
      name: `${email.split('@')[0]}'s clients`, slug, org_type: 'consultant', tab_label: 'My Clients', tier: 'pro',
    }).select().single();
    if (org) {
      await supabase.from('org_members').insert({ org_id: org.id, user_email: email, role: 'org_admin' });
      membership = { org_id: org.id, role: 'org_admin' };
    }
  }
  if (!membership) return NextResponse.json({ success: false, error: 'Not a coach' }, { status: 403 });

  if (body.action === 'add_client') {
    const businessName = String(body.business_name || '').trim();
    if (!businessName) return NextResponse.json({ success: false, error: 'business_name required' }, { status: 400 });
    // Each client gets its own workspace_id (stable, derived from org+name).
    const workspaceId = `org-${membership.org_id.slice(0, 8)}-${businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    const { data, error } = await supabase.from('org_clients').insert({
      org_id: membership.org_id, workspace_id: workspaceId, business_name: businessName,
      primary_email: body.primary_email || null, assigned_coach: email,
    }).select().single();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    // SEED FROM CAPABILITY TEXT (Eric: "I paste their website/capability statement,
    // you extract the keywords + NAICS/PSC + location → so I can track them + get
    // their alerts"). Extract grounded codes (this session's keyword-first work) +
    // a location, and write the workspace's notification profile so alerts flow.
    let seeded: { naics: string[]; psc: string[]; keywords: string[]; states: string[] } | null = null;
    const capabilityText = String(body.capability_text || '').trim();
    if (capabilityText) {
      seeded = await seedClientProfile(supabase, workspaceId, businessName, capabilityText);
    }

    return NextResponse.json({ success: true, client: { id: data.id, workspaceId, businessName }, seeded });
  }

  if (body.action === 'post_news' && membership.role === 'org_admin') {
    const { error } = await supabase.from('org_news').insert({
      org_id: membership.org_id, title: String(body.title || '').slice(0, 200), body: String(body.body || ''),
      pinned: !!body.pinned, posted_by: email,
    });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
}
