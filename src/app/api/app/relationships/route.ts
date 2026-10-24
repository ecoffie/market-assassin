import { NextRequest, NextResponse } from 'next/server';
import { displayContactName } from '@/lib/gov-contacts/contact-quality';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { ensureWorkspaceMember, recordAppActivity, resolveActiveWorkspace } from '@/lib/app/workspace';
import { searchContractors } from '@/lib/contractor-database';
import { getAllCommands, getEnhancedAgencyInfo, type SmallBusinessOffice } from '@/lib/utils/command-info';
import { shadowEntitlement } from '@/lib/entitlements/shadow';

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

type RelationshipType = 'government_buyer' | 'osbp' | 'prime' | 'subcontractor' | 'partner' | 'internal';

/**
 * Cap for "directory" candidate searches (Gov Buyers / OSBP / Find
 * Partners). Was 40 — Eric (2026-05-27) flagged that Gov Buyers and
 * OSBP both hit exactly 40 was suspicious (it was). Bumped to 250
 * so users can actually scan the directory. We also return `total`
 * (pre-truncation count) so the UI can show "Showing 250 of 1,400 —
 * narrow your search".
 */
const MAX_DIRECTORY_RESULTS = 250;

interface RelationshipContactInput {
  user_email: string;
  contact_type?: RelationshipType;
  full_name: string;
  title?: string;
  email?: string;
  phone?: string;
  organization?: string;
  agency?: string;
  target_agency?: string;       // v2: the target-agency this relationship is for
  relationship_stage?: string;  // v2: prospect | warm | contacted | met | champion
  office?: string;
  sub_tier?: string;
  source?: string;
  source_record_id?: string;
  notes?: string;
}

interface RelationshipCandidate {
  id: string;
  contact_type: RelationshipType;
  full_name: string;
  title?: string;
  email?: string;
  phone?: string;
  organization?: string;
  agency?: string;
  office?: string;
  sub_tier?: string;
  source?: string;
  source_record_id?: string;
  context?: string;
}

async function ensureRelationshipSchema() {
  const supabase = getSupabase();
  const { error } = await supabase.from('mi_beta_contacts').select('id').limit(1);
  if (!error || error.code !== '42P01') return { ready: true };

  const { error: migrationError } = await supabase.rpc('exec_migration', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS mi_beta_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        contact_type TEXT NOT NULL DEFAULT 'partner',
        full_name TEXT NOT NULL,
        title TEXT,
        email TEXT,
        phone TEXT,
        organization TEXT,
        agency TEXT,
        office TEXT,
        sub_tier TEXT,
        source TEXT DEFAULT 'manual',
        source_record_id TEXT,
        notes TEXT,
        owner_email TEXT,
        created_by TEXT,
        updated_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mi_beta_contact_opportunity_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        contact_id UUID NOT NULL REFERENCES mi_beta_contacts(id) ON DELETE CASCADE,
        pipeline_id UUID NOT NULL REFERENCES user_pipeline(id) ON DELETE CASCADE,
        relationship_role TEXT DEFAULT 'contact',
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_mi_beta_contact_pipeline UNIQUE (contact_id, pipeline_id)
      );

      CREATE TABLE IF NOT EXISTS mi_beta_pursuit_activity (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        pipeline_id UUID,
        actor_email TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_workspace ON mi_beta_contacts(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_email ON mi_beta_contacts(email);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_type ON mi_beta_contacts(contact_type);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_contact_links_workspace ON mi_beta_contact_opportunity_links(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_contact_links_pipeline ON mi_beta_contact_opportunity_links(pipeline_id);

    `,
  });

  return { ready: !migrationError, error: migrationError?.message };
}

function normalizeEmail(value?: string | null) {
  return (value || '').toLowerCase().trim();
}

function normalizeText(value?: string | null) {
  return (value || '').toLowerCase().trim();
}

function matchesCandidateSearch(candidate: RelationshipCandidate, search: string, agency: string) {
  const query = normalizeText(search);
  const agencyQuery = normalizeText(agency);
  const haystack = [
    candidate.full_name,
    candidate.title,
    candidate.organization,
    candidate.agency,
    candidate.office,
    candidate.sub_tier,
    candidate.email,
    candidate.context,
  ].filter(Boolean).join(' ').toLowerCase();

  if (query && !haystack.includes(query)) return false;
  if (agencyQuery && !haystack.includes(agencyQuery)) return false;
  return true;
}

function pushUniqueCandidate(
  candidates: RelationshipCandidate[],
  seen: Set<string>,
  candidate: RelationshipCandidate
) {
  const key = normalizeText(candidate.email || candidate.source_record_id || `${candidate.full_name}:${candidate.organization}:${candidate.agency}`);
  if (!key || seen.has(key)) return;
  seen.add(key);
  candidates.push(candidate);
}

function mapOSBPContact(
  contact: SmallBusinessOffice,
  agency: string,
  office: string,
  sourceRecordId: string,
  source: string
): RelationshipCandidate {
  return {
    id: `osbp:${sourceRecordId}`,
    contact_type: 'osbp',
    full_name: contact.director || contact.name,
    title: contact.director && contact.director !== contact.name ? contact.name : 'Small business office',
    email: contact.email || '',
    phone: contact.phone || '',
    organization: contact.name,
    agency,
    office,
    source,
    source_record_id: sourceRecordId,
    context: [contact.address, 'Use this for capability statement introductions and small business guidance.'].filter(Boolean).join(' · '),
  };
}

function mapOSBPCandidates(search: string, agency: string) {
  const candidates: RelationshipCandidate[] = [];
  const seen = new Set<string>();

  for (const command of getAllCommands()) {
    const candidate = mapOSBPContact(
      command.smallBusinessOffice,
      command.parentAgency,
      command.fullName,
      `command:${command.abbreviation}`,
      'agency_osbp_directory'
    );
    if (matchesCandidateSearch(candidate, search, agency)) {
      pushUniqueCandidate(candidates, seen, candidate);
    }
  }

  const commonAgencies = [
    'Department of Defense',
    'Department of Veterans Affairs',
    'General Services Administration',
    'Department of Homeland Security',
    'Department of Health and Human Services',
    'Department of Transportation',
    'Department of Justice',
    'Department of the Interior',
    'Department of Agriculture',
    'Department of Commerce',
    'Department of Labor',
    'Department of Energy',
    'Department of the Treasury',
    'Department of State',
    'Environmental Protection Agency',
    'National Aeronautics and Space Administration',
    'Department of Education',
    'Department of Housing and Urban Development',
    'Small Business Administration',
    'Social Security Administration',
    'Office of Personnel Management',
  ];

  for (const agencyName of commonAgencies) {
    const enhanced = getEnhancedAgencyInfo(agencyName, agencyName, agencyName);
    if (enhanced.osbpSource !== 'directory' || !enhanced.smallBusinessContact) continue;

    const candidate = mapOSBPContact(
      enhanced.smallBusinessContact,
      agencyName,
      enhanced.commandInfo?.fullName || agencyName,
      `agency:${agencyName}`,
      'agency_osbp_directory'
    );
    if (matchesCandidateSearch(candidate, search, agency)) {
      pushUniqueCandidate(candidates, seen, candidate);
    }
  }

  return { candidates: candidates.slice(0, MAX_DIRECTORY_RESULTS), total: candidates.length };
}

function mapContractorCandidates(search: string, naics: string, agency: string) {
  const results = searchContractors({
    search: search || undefined,
    naics: naics || undefined,
    agency: agency || undefined,
    hasContact: true,
    limit: 25,
    sortBy: 'contract_value',
    sortOrder: 'desc',
  });

  return results.contractors.map(contractor => ({
    id: `contractor:${contractor.company}:${contractor.email || contractor.sblo_name}`,
    contact_type: 'prime' as RelationshipType,
    full_name: contractor.sblo_name || contractor.company,
    title: contractor.title || 'Small business liaison',
    email: contractor.email || '',
    phone: contractor.phone || '',
    organization: contractor.company,
    agency: contractor.agencies,
    office: '',
    sub_tier: '',
    source: 'contractor_database',
    source_record_id: contractor.company,
    context: [
      contractor.naics ? `NAICS ${contractor.naics}` : '',
      contractor.total_contract_value ? `${contractor.total_contract_value} in visible value` : '',
    ].filter(Boolean).join(' · '),
  }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function collectContactObjects(value: unknown, output: Record<string, unknown>[] = [], depth = 0) {
  if (depth > 4 || !value) return output;

  if (Array.isArray(value)) {
    value.forEach(item => collectContactObjects(item, output, depth + 1));
    return output;
  }

  const record = asRecord(value);
  if (!record) return output;

  const keys = Object.keys(record).map(key => key.toLowerCase());
  const hasContactSignal = keys.some(key => (
    key.includes('email') ||
    key.includes('phone') ||
    key.includes('contact') ||
    key.includes('poc') ||
    key.includes('name')
  ));

  if (hasContactSignal) output.push(record);

  for (const [key, nested] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('contact') ||
      lowerKey.includes('poc') ||
      lowerKey.includes('pointof') ||
      lowerKey.includes('office')
    ) {
      collectContactObjects(nested, output, depth + 1);
    }
  }

  return output;
}

function mapSamContactCandidate(row: Record<string, unknown>, contact: Record<string, unknown>, index: number): RelationshipCandidate | null {
  const email = getStringField(contact, ['email', 'emailAddress', 'contactEmail', 'pocEmail', 'poc_email']);
  const phone = getStringField(contact, ['phone', 'phoneNumber', 'contactPhone', 'pocPhone', 'poc_phone']);
  // Get name from contact-specific fields only (NOT 'title' which could be job title or opportunity title)
  const name = getStringField(contact, [
    'fullName',
    'contactFullname',
    'ContactFullname',
    'contactName',
    'pocName',
    'poc_name',
  ]);
  // Job title is separate from name - only look for title-specific fields
  const jobTitle = getStringField(contact, ['contactTitle', 'ContactTitle', 'role', 'position']) || 'Government point of contact';

  // MUST have email or phone - name alone is too unreliable (could be opportunity title leaking through)
  if (!email && !phone) return null;

  const noticeId = String(row.notice_id || row.solicitation_number || index);
  const agency = String(row.department || '');
  const subTier = String(row.sub_tier || '');
  const office = String(row.office || '');
  const opportunityTitle = String(row.title || '');

  return {
    id: `sam-contact:${noticeId}:${email || index}`,
    contact_type: 'government_buyer',
    full_name: name || email?.split('@')[0] || 'Government Contact',
    title: jobTitle,
    email,
    phone,
    organization: office || subTier || agency,
    agency,
    office,
    sub_tier: subTier,
    source: 'sam_opportunities',
    source_record_id: `sam:${noticeId}:${email || index}`,
    context: [opportunityTitle, row.solicitation_number ? `Sol# ${row.solicitation_number}` : '', row.response_deadline ? `Due ${row.response_deadline}` : ''].filter(Boolean).join(' · '),
  };
}

async function mapGovernmentBuyerCandidates(search: string, naics: string, agency: string) {
  let query = getSupabase()
    .from('sam_opportunities')
    .select('notice_id,solicitation_number,title,department,sub_tier,office,naics_code,response_deadline,raw_data')
    .eq('active', true)
    .not('raw_data', 'is', null)
    .order('response_deadline', { ascending: true })
    .limit(150);

  if (naics) {
    const codes = naics.split(',').map(code => code.trim()).filter(Boolean);
    if (codes.length === 1) query = query.ilike('naics_code', `${codes[0]}%`);
    if (codes.length > 1) query = query.in('naics_code', codes);
  }

  if (agency) {
    query = query.or(`department.ilike.%${agency}%,sub_tier.ilike.%${agency}%,office.ilike.%${agency}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const candidates: RelationshipCandidate[] = [];
  const seen = new Set<string>();

  for (const row of (data || []) as Record<string, unknown>[]) {
    const contactObjects = collectContactObjects(row.raw_data);
    contactObjects.forEach((contact, index) => {
      const candidate = mapSamContactCandidate(row, contact, index);
      if (candidate && matchesCandidateSearch(candidate, search, agency)) {
        pushUniqueCandidate(candidates, seen, candidate);
      }
    });
  }

  return { candidates: candidates.slice(0, MAX_DIRECTORY_RESULTS), total: candidates.length };
}

async function getSavedContacts(workspaceId: string, email: string, type?: string, search?: string) {
  let query = getSupabase()
    .from('mi_beta_contacts')
    .select('*')
    .or(`workspace_id.eq.${workspaceId},user_email.eq.${email}`)
    .order('created_at', { ascending: false });

  if (type && type !== 'all') {
    query = query.eq('contact_type', type);
  }

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,organization.ilike.%${search}%,agency.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(100);
  if (error) throw error;
  return data || [];
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const mode = request.nextUrl.searchParams.get('mode') || 'saved';
  const type = request.nextUrl.searchParams.get('type') || 'all';
  const search = request.nextUrl.searchParams.get('search') || '';
  const naics = request.nextUrl.searchParams.get('naics') || '';
  const agency = request.nextUrl.searchParams.get('agency') || '';

  if (!email) {
    return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  try {
    await ensureRelationshipSchema();
    const normalizedEmail = normalizeEmail(email);
    const { workspaceId } = await resolveActiveWorkspace(normalizedEmail, request);

    if (mode === 'pursuits') {
      // Only LIVE pursuits should appear in the "Save + attach to:" dropdown.
      // Attaching a contact to a won/lost/no-bid or archived pursuit is never
      // what the user wants — those are closed out. Filter terminal stages and
      // archived rows here so every consumer of mode=pursuits stays clean
      // (mirrors the live-only filter in ContactsPanel / ProposalsPanel).
      const { data, error } = await getSupabase()
        .from('user_pipeline')
        .select('id,title,agency,stage,response_deadline,is_archived')
        .or(`workspace_id.eq.${workspaceId},user_email.eq.${normalizedEmail}`)
        .not('stage', 'in', '("won","lost","no_bid","archived")')
        .order('updated_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      const livePursuits = (data || []).filter(
        (p: { is_archived?: boolean }) => !p.is_archived
      );
      return NextResponse.json({ success: true, pursuits: livePursuits });
    }

    if (mode === 'candidates') {
      let candidates: RelationshipCandidate[] = [];
      let total = 0;  // pre-truncation count (Eric: surface so user knows when 250 cap kicked in)
      let dataSourceStatus = '';

      if (type === 'government_buyer') {
        const buyers = await mapGovernmentBuyerCandidates(search, naics, agency);
        candidates = buyers.candidates;
        total = buyers.total;
        dataSourceStatus = candidates.length > 0
          ? 'sam_opportunities'
          : 'No buyer contacts found for this search. Try an agency or broader keyword, or use OSBP contacts for relationship outreach.';
      } else if (type === 'osbp') {
        const osbpResult = mapOSBPCandidates(search, agency);
        candidates = osbpResult.candidates;
        total = osbpResult.total;
        dataSourceStatus = candidates.length > 0
          ? 'agency_osbp_directory'
          : 'No OSBP contacts matched this search. Try a parent agency name like VA, DHS, GSA, Navy, or Army.';
      } else if (type === 'prime' || type === 'subcontractor' || type === 'partner') {
        candidates = mapContractorCandidates(search, naics, agency);
        total = candidates.length;  // mapContractorCandidates wasn't capped; total === candidates.length is correct
        dataSourceStatus = candidates.length > 0
          ? 'contractor_database'
          : 'No partner records matched this search.';
      }

      return NextResponse.json({
        success: true,
        candidates,
        total,                       // pre-truncation count
        truncated: total > candidates.length,
        cap: MAX_DIRECTORY_RESULTS,
        dataSourceStatus,
      });
    }

    const contacts = await getSavedContacts(workspaceId, normalizedEmail, type, search);
    const { data: links, error: linksErr } = await getSupabase()
      .from('mi_beta_contact_opportunity_links')
      .select('id,contact_id,pipeline_id,relationship_role,user_pipeline(id,title,agency,stage)')
      .eq('workspace_id', workspaceId);
    if (linksErr) console.error('[relationships] links query error:', linksErr.message);

    return NextResponse.json({
      success: true,
      contacts,
      links: links || [],
    });
  } catch (error) {
    console.error('MI relationships GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load relationships' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureRelationshipSchema();
    const body = await request.json();
    const action = body.action || 'save_contact';
    const email = normalizeEmail(body.user_email);

    if (!email) {
      return NextResponse.json({ success: false, error: 'user_email is required' }, { status: 400 });
    }

    const authSession = requireMIAuthSession(request, email);
    if (!authSession.ok) return authSession.response;
    shadowEntitlement({ route: 'app/relationships POST', capability: 'relationships.manage', email: email, identityVerified: true, currentAllow: true });
    const { workspaceId } = await resolveActiveWorkspace(email, request);

    if (action === 'link_contact') {
      if (!body.contact_id || !body.pipeline_id) {
        return NextResponse.json({ success: false, error: 'contact_id and pipeline_id are required' }, { status: 400 });
      }

      const { data, error } = await getSupabase()
        .from('mi_beta_contact_opportunity_links')
        .upsert({
          workspace_id: workspaceId,
          contact_id: body.contact_id,
          pipeline_id: body.pipeline_id,
          relationship_role: body.relationship_role || 'contact',
          notes: body.notes || null,
          created_by: email,
        }, { onConflict: 'contact_id,pipeline_id' })
        .select()
        .single();

      if (error) throw error;

      await recordAppActivity({
        workspaceId,
        userEmail: email,
        actorEmail: email,
        entityType: 'relationship',
        entityId: data.id,
        action: 'linked_to_pursuit',
        summary: 'Attached contact to pursuit',
        metadata: { contactId: body.contact_id, pipelineId: body.pipeline_id },
      });

      return NextResponse.json({ success: true, link: data });
    }

    const input = body as RelationshipContactInput;
    if (!input.full_name) {
      return NextResponse.json({ success: false, error: 'full_name is required' }, { status: 400 });
    }

    // v2 fields (target_agency, relationship_stage) live in a separate object
    // so we can drop them and retry if the migration hasn't run yet.
    const v2 = {
      target_agency: input.target_agency || input.agency || null,
      relationship_stage: input.relationship_stage || 'prospect',
    };
    const payload = {
      workspace_id: workspaceId,
      user_email: email,
      contact_type: input.contact_type || 'partner',
      full_name: input.full_name,
      title: input.title || null,
      email: input.email || null,
      phone: input.phone || null,
      organization: input.organization || null,
      agency: input.agency || null,
      office: input.office || null,
      sub_tier: input.sub_tier || null,
      source: input.source || 'manual',
      source_record_id: input.source_record_id || null,
      notes: input.notes || null,
      owner_email: email,
      created_by: email,
      updated_by: email,
      ...v2,
    };

    if (payload.email || payload.source_record_id) {
      let duplicateQuery = getSupabase()
        .from('mi_beta_contacts')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('contact_type', payload.contact_type)
        .limit(1);

      duplicateQuery = payload.email
        ? duplicateQuery.eq('email', payload.email)
        : duplicateQuery.eq('source_record_id', payload.source_record_id);

      const { data: existing } = await duplicateQuery.maybeSingle();
      if (existing) {
        return NextResponse.json({ success: true, contact: existing, alreadySaved: true });
      }
    }

    let { data, error } = await getSupabase()
      .from('mi_beta_contacts')
      .insert(payload)
      .select()
      .single();

    // Migration not run yet → retry without the v2 columns (graceful degrade).
    if (error && /target_agency|relationship_stage|schema cache|column/.test(error.message || '')) {
      const { target_agency: _ta, relationship_stage: _rs, ...base } = payload;
      void _ta; void _rs;
      ({ data, error } = await getSupabase().from('mi_beta_contacts').insert(base).select().single());
    }
    if (error) throw error;

    await recordAppActivity({
      workspaceId,
      userEmail: email,
      actorEmail: email,
      entityType: 'contact',
      entityId: data.id,
      action: 'saved',
      summary: `Saved ${data.full_name} to My Network`,
      metadata: { contactType: data.contact_type, source: data.source },
    });

    return NextResponse.json({ success: true, contact: data });
  } catch (error) {
    console.error('MI relationships POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save relationship' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await ensureRelationshipSchema();
    const body = await request.json();
    const email = normalizeEmail(body.user_email);

    if (!email || !body.id) {
      return NextResponse.json({ success: false, error: 'id and user_email are required' }, { status: 400 });
    }

    const authSession = requireMIAuthSession(request, email);
    if (!authSession.ok) return authSession.response;
    const { workspaceId } = await resolveActiveWorkspace(email, request);

    // Only include provided fields (don't null out untouched columns).
    const updates: Record<string, unknown> = {
      updated_by: email,
      updated_at: new Date().toISOString(),
    };
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.title !== undefined) updates.title = body.title;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.email !== undefined) updates.email = body.email;
    if (body.relationship_stage !== undefined) updates.relationship_stage = body.relationship_stage; // v2
    if (body.target_agency !== undefined) updates.target_agency = body.target_agency;               // v2

    const runUpdate = (u: Record<string, unknown>) => getSupabase()
      .from('mi_beta_contacts')
      .update(u)
      .eq('id', body.id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${email}`)
      .select()
      .single();

    let { data, error } = await runUpdate(updates);
    if (error && /target_agency|relationship_stage|schema cache|column/.test(error.message || '')) {
      const { relationship_stage: _rs, target_agency: _ta, ...base } = updates;
      void _rs; void _ta;
      ({ data, error } = await runUpdate(base));
    }
    if (error) throw error;
    return NextResponse.json({ success: true, contact: data });
  } catch (error) {
    console.error('MI relationships PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update relationship' }, { status: 500 });
  }
}
