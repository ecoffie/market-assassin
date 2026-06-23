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
import { buildProfileFromText } from '@/lib/market/profile-from-text';
import { clientNotificationEmail } from '@/lib/app/workspace';
import {
  coachAtClientLimit,
  requireCoachAccess,
  resolveCoachAccess,
} from '@/lib/mindy/coach-access';

/**
 * Seed a new client workspace from pasted capability text. Uses the SHARED
 * buildProfileFromText engine (#64) — the SAME one onboarding uses — so a
 * consultant adding a client they don't deeply understand gets Mindy's expert
 * extraction: LLM picks the real INDUSTRY (not a company name / cert), grounds
 * codes in USASpending, detects states + set-aside certs, and finds who buys.
 * Then writes the workspace's notification profile + pre-loads target agencies.
 */
async function seedClientProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, workspaceId: string, businessName: string, text: string,
): Promise<{ naics: string[]; psc: string[]; keywords: string[]; states: string[]; setAsides: string[]; agencies: number }> {
  const p = await buildProfileFromText(text);
  const naics = p?.naics || [];
  const psc = p?.topPsc ? [p.topPsc.code] : [];
  const keywords = p?.keywords || [];
  const states = p?.states || [];
  const setAsides = p?.setAsides || [];

  const clientEmail = `${workspaceId}@clients.getmindy.ai`;
  await supabase.from('user_notification_settings').upsert({
    user_email: clientEmail,
    naics_codes: naics,
    psc_codes: psc,
    keywords,
    location_states: states,
    set_aside_certifications: setAsides,
    business_type: 'Small Business',
    primary_industry: businessName,
    alerts_enabled: true,
    alert_frequency: 'weekly',     // gentle for a tracked client, not daily spam
    is_active: true,
  }, { onConflict: 'user_email' });

  // Pre-load the top buying agencies into the client's Target List (who to talk to).
  let agenciesSeeded = 0;
  if (p?.agencies?.length) {
    const targets = p.agencies.slice(0, 6).map(a => ({
      workspace_id: workspaceId,
      user_email: clientEmail,
      agency_name: a.name,
      set_aside_spending: a.amount,
      status: 'targeting',
      added_from: 'capability_text_seed',
      source_naics: naics.join(','),
    }));
    const { error } = await supabase.from('user_target_list').insert(targets);
    if (!error) agenciesSeeded = targets.length;
  }

  return { naics, psc, keywords, states, setAsides, agencies: agenciesSeeded };
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
  const coachAccess = await resolveCoachAccess(email!);

  if (!coachAccess.allowed) {
    return NextResponse.json({
      success: true,
      isCoach: false,
      coachAccess,
    });
  }

  // Is this user a coach/admin in any org?
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_email', email)
    .eq('status', 'active')
    .in('role', ['coach', 'org_admin'])
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ success: true, isCoach: false, coachAccess });
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

  // Per-client profile + counts so the My Clients panel shows what was seeded.
  const profileByWs = new Map<string, Record<string, unknown>>();
  const pipelineCount = new Map<string, number>();
  const targetCount = new Map<string, number>();
  if (workspaceIds.length) {
    const clientEmails = workspaceIds.map((ws: string) => clientNotificationEmail(ws));
    const { data: profiles } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, location_states, primary_industry')
      .in('user_email', clientEmails);
    for (const p of profiles || []) {
      const ws = clientEmails.find((e: string) => e === p.user_email);
      const wsId = workspaceIds.find((id: string) => clientNotificationEmail(id) === p.user_email);
      if (wsId) profileByWs.set(wsId, p);
      void ws;
    }
    const { data: plRows } = await supabase
      .from('user_pipeline')
      .select('workspace_id')
      .in('workspace_id', workspaceIds)
      .neq('is_archived', true);
    for (const r of plRows || []) {
      const ws = r.workspace_id as string;
      pipelineCount.set(ws, (pipelineCount.get(ws) || 0) + 1);
    }
    const { data: tlRows } = await supabase
      .from('user_target_list')
      .select('workspace_id')
      .in('workspace_id', workspaceIds);
    for (const r of tlRows || []) {
      const ws = r.workspace_id as string;
      targetCount.set(ws, (targetCount.get(ws) || 0) + 1);
    }
  }

  return NextResponse.json({
    success: true,
    isCoach: true,
    coachAccess,
    role: membership.role,
    org: org ? { id: org.id, name: org.name, tabLabel: org.tab_label, logoUrl: org.logo_url, brandColor: org.brand_color } : null,
    clients: clientList.map((c: Record<string, unknown>) => {
      const ws = c.workspace_id as string;
      const prof = profileByWs.get(ws);
      const naics = (prof?.naics_codes as string[] | undefined) || [];
      const keywords = (prof?.keywords as string[] | undefined) || [];
      const states = (prof?.location_states as string[] | undefined) || [];
      return {
        id: c.id,
        workspaceId: ws,
        businessName: c.business_name,
        primaryEmail: c.primary_email,
        profile: prof ? {
          naics,
          keywords,
          states,
          naicsCount: naics.length,
          keywordCount: keywords.length,
          industry: prof.primary_industry || null,
        } : null,
        stats: {
          pipeline: pipelineCount.get(ws) || 0,
          targets: targetCount.get(ws) || 0,
        },
      };
    }),
    orgTab: { deadlines, changes, news: news || [] },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;
  const supabase = sb();

  const coachAccess = await requireCoachAccess(email);
  if (!coachAccess) {
    const denied = await resolveCoachAccess(email);
    return NextResponse.json(
      {
        success: false,
        error: 'My Clients requires Mindy Teams. Upgrade to manage client workspaces.',
        coachAccess: denied,
      },
      { status: 403 },
    );
  }

  let { data: membership } = await supabase
    .from('org_members').select('org_id, role').eq('user_email', email).eq('status', 'active')
    .in('role', ['coach', 'org_admin']).maybeSingle();

  // Teams-tier solo consultant: first add_client auto-creates a personal org.
  // Pro users without grandfather org membership are blocked above.
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

    const { count: clientCount } = await supabase
      .from('org_clients')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', membership.org_id)
      .eq('status', 'active');
    if (coachAtClientLimit(coachAccess, clientCount ?? 0)) {
      return NextResponse.json(
        {
          success: false,
          error: `Client limit reached (${coachAccess.maxClients} active clients). Upgrade to Enterprise for more.`,
          coachAccess,
        },
        { status: 403 },
      );
    }
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
    let seeded: Awaited<ReturnType<typeof seedClientProfile>> | null = null;
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
