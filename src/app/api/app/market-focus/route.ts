import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import {
  ensureAppWorkspaceSchema,
  getAppSupabase,
  normalizeEmail,
  recordAppActivity,
  resolveActiveWorkspace,
} from '@/lib/app/workspace';

export const dynamic = 'force-dynamic';

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function cleanStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }

  return cleanString(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanFilters(input: Record<string, unknown> = {}) {
  return {
    businessType: cleanString(input.businessType || input.business_type),
    naicsCodes: cleanStringArray(input.naicsCodes || input.naics_codes),
    pscCodes: cleanStringArray(input.pscCodes || input.psc_codes),
    agencies: cleanStringArray(input.agencies || input.targetAgencies || input.target_agencies),
    zipCode: cleanString(input.zipCode || input.zip_code),
    companyName: cleanString(input.companyName || input.company_name),
    excludeDOD: Boolean(input.excludeDOD || input.exclude_dod),
  };
}

async function requireFocusContext(request: NextRequest, email: string) {
  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return { error: authSession.response };

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) {
    return {
      error: NextResponse.json({ success: false, error: schema.error }, { status: 500 }),
    };
  }

  const { workspaceId } = await resolveActiveWorkspace(email, request);
  return { workspaceId };
}

export async function GET(request: NextRequest) {
  const email = normalizeEmail(request.nextUrl.searchParams.get('email') || '');
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

  const context = await requireFocusContext(request, email);
  if ('error' in context) return context.error;

  const { data, error } = await getAppSupabase()
    .from('mi_beta_market_focuses')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .order('updated_at', { ascending: false })
    .limit(25);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, focuses: data || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = normalizeEmail(body.email || '');
  const name = cleanString(body.name);

  if (!email || !name) {
    return NextResponse.json({ success: false, error: 'Email and focus name are required' }, { status: 400 });
  }

  const context = await requireFocusContext(request, email);
  if ('error' in context) return context.error;

  const filters = cleanFilters(body.filters || {});
  const { data, error } = await getAppSupabase()
    .from('mi_beta_market_focuses')
    .insert({
      workspace_id: context.workspaceId,
      user_email: email,
      name: name.slice(0, 80),
      description: cleanString(body.description).slice(0, 180) || null,
      filters,
      is_default: false,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await recordAppActivity({
    workspaceId: context.workspaceId,
    userEmail: email,
    actorEmail: email,
    entityType: 'market_focus',
    entityId: data.id,
    action: 'created',
    summary: `Saved market focus: ${data.name}`,
    metadata: { filters },
  });

  return NextResponse.json({ success: true, focus: data });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email || request.nextUrl.searchParams.get('email') || '');
  const id = cleanString(body.id || request.nextUrl.searchParams.get('id'));

  if (!email || !id) {
    return NextResponse.json({ success: false, error: 'Email and focus id are required' }, { status: 400 });
  }

  const context = await requireFocusContext(request, email);
  if ('error' in context) return context.error;

  const { error } = await getAppSupabase()
    .from('mi_beta_market_focuses')
    .delete()
    .eq('workspace_id', context.workspaceId)
    .eq('id', id);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await recordAppActivity({
    workspaceId: context.workspaceId,
    userEmail: email,
    actorEmail: email,
    entityType: 'market_focus',
    entityId: id,
    action: 'deleted',
    summary: 'Deleted market focus',
  });

  return NextResponse.json({ success: true });
}
