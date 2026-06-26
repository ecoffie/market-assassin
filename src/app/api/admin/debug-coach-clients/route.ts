/**
 * GET /api/admin/debug-coach-clients?password=...&email=<coach>
 *
 * Coach Mode data diagnostic. Dumps the coach's OWN notification profile plus
 * every assigned client's workspace_id + the profile actually stored under that
 * client's synthetic email (clientNotificationEmail). Auto-flags the failure
 * modes behind "database overlap / wrong codes for the wrong client":
 *   - workspace_id COLLISION (two clients sharing one row — the slug is truncated
 *     to 40 chars, so similar names can collide);
 *   - client row MISSING (asClient reads find nothing → fall back to coach);
 *   - client codes EQUAL the coach's (a save leaked onto the coach, or seed bug);
 *   - client profile EMPTY (never seeded / saved elsewhere).
 *
 * Read-only. Standard admin auth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clientNotificationEmail } from '@/lib/app/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const PROFILE_COLS = 'user_email, naics_codes, psc_codes, keywords, location_states, primary_industry, alert_recipient_email, alerts_enabled';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function codesOf(p: any) {
  return {
    naics: (p?.naics_codes as string[]) || [],
    psc: (p?.psc_codes as string[]) || [],
    keywords: (p?.keywords as string[]) || [],
    states: (p?.location_states as string[]) || [],
    industry: p?.primary_industry || null,
    alertRecipient: p?.alert_recipient_email || null,
    alertsEnabled: p?.alerts_enabled ?? null,
  };
}
const sameSet = (a: string[], b: string[]) =>
  a.length > 0 && a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password');
  if (pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }
  const email = (request.nextUrl.searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const supabase = sb();

  // Coach's own profile (what the dashboard shows when asClient=false).
  const { data: coachRow } = await supabase
    .from('user_notification_settings').select(PROFILE_COLS).eq('user_email', email).maybeSingle();
  const coach = codesOf(coachRow);

  // Coach/admin membership.
  const { data: membership } = await supabase
    .from('org_members').select('org_id, role').eq('user_email', email).eq('status', 'active')
    .in('role', ['coach', 'org_admin']).maybeSingle();

  if (!membership) {
    return NextResponse.json({
      success: true, email, isCoach: false,
      message: 'Not an active coach/org_admin in any org — so every surface operates as this user (no client to switch to).',
      coachProfile: { email, ...coach, hasRow: !!coachRow },
    });
  }

  // Assigned clients (org_admin = all in org; coach = only assigned).
  let cq = supabase.from('org_clients').select('*').eq('org_id', membership.org_id).eq('status', 'active');
  if (membership.role === 'coach') cq = cq.eq('assigned_coach', email);
  const { data: clientRows } = await cq;
  const clients = clientRows || [];

  // Read every client's stored profile in one shot.
  const clientEmails = clients.map((c: { workspace_id: string }) => clientNotificationEmail(c.workspace_id));
  const { data: profs } = clientEmails.length
    ? await supabase.from('user_notification_settings').select(PROFILE_COLS).in('user_email', clientEmails)
    : { data: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byEmail = new Map<string, any>((profs || []).map((p: any) => [p.user_email, p]));

  // Per-client view + collision tracking.
  const wsCount = new Map<string, string[]>(); // workspace_id → business names
  const clientReport = clients.map((c: Record<string, unknown>) => {
    const ws = String(c.workspace_id);
    wsCount.set(ws, [...(wsCount.get(ws) || []), String(c.business_name)]);
    const clientEmail = clientNotificationEmail(ws);
    const row = byEmail.get(clientEmail);
    const codes = codesOf(row);
    const flags: string[] = [];
    if (!row) flags.push('NO_PROFILE_ROW (client-mode reads find nothing → falls back to coach)');
    if (codes.naics.length === 0 && codes.keywords.length === 0) flags.push('EMPTY (no NAICS/keywords stored)');
    if (sameSet(codes.naics, coach.naics) || (coach.keywords.length && sameSet(codes.keywords, coach.keywords)))
      flags.push("EQUALS_COACH (this client's codes match the coach's — leak or seed bug)");
    return {
      businessName: c.business_name,
      workspaceId: ws,
      clientEmail,
      assignedCoach: c.assigned_coach,
      primaryEmail: c.primary_email,
      ...codes,
      hasRow: !!row,
      flags,
    };
  });

  // Cross-client overlap: identical code-sets across two different clients.
  const overlaps: string[] = [];
  for (let i = 0; i < clientReport.length; i++) {
    for (let j = i + 1; j < clientReport.length; j++) {
      const a = clientReport[i], b = clientReport[j];
      if (a.workspaceId === b.workspaceId) continue; // collision handled below
      if (sameSet(a.naics, b.naics) && a.naics.length)
        overlaps.push(`"${a.businessName}" and "${b.businessName}" have IDENTICAL NAICS [${a.naics.join(', ')}]`);
    }
  }
  const collisions = [...wsCount.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([ws, names]) => `workspace_id "${ws}" is shared by ${names.length} clients: ${names.join(', ')} → ONE row, guaranteed overlap`);

  const diagnosis: string[] = [];
  if (collisions.length) diagnosis.push(...collisions);
  if (overlaps.length) diagnosis.push(...overlaps);
  clientReport.forEach((c: { businessName: string; flags: string[] }) =>
    c.flags.forEach((f) => diagnosis.push(`"${c.businessName}": ${f}`)));
  if (!diagnosis.length) diagnosis.push('No structural overlap detected — each client has its own row with distinct codes. If a client still shows the wrong codes in-app, the active-workspace SWITCH (or asClient authorization) is the suspect, not stored data.');

  return NextResponse.json({
    success: true,
    email,
    isCoach: true,
    role: membership.role,
    orgId: membership.org_id,
    coachProfile: { email, ...coach, hasRow: !!coachRow },
    clientCount: clients.length,
    clients: clientReport,
    diagnosis,
  });
}
