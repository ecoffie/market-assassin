import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { ensureWorkspaceMember, recordMIBetaActivity } from '@/lib/mi-beta/workspace';
import { searchContractors } from '@/lib/contractor-database';
import { getAllCommands, getEnhancedAgencyInfo, type SmallBusinessOffice } from '@/lib/utils/command-info';

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

const BIGQUERY_CONTACTS_PROJECT_ID = process.env.BIGQUERY_CONTACTS_PROJECT_ID || 'fresh-ward-455220-j0';
const BIGQUERY_CONTACTS_DATASET_ID = process.env.BIGQUERY_CONTACTS_DATASET_ID || 'samgovcons';
const BIGQUERY_CONTACTS_TABLE_ID = process.env.BIGQUERY_CONTACTS_TABLE_ID || 'AllSamContacts';
const BIGQUERY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BIGQUERY_SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly';

interface RelationshipContactInput {
  user_email: string;
  contact_type?: RelationshipType;
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

interface BigQueryCredentials {
  client_email: string;
  private_key: string;
}

interface BigQueryField {
  name: string;
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

      CREATE TABLE IF NOT EXISTS opengov_iq_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_table TEXT NOT NULL DEFAULT 'AllSamContacts',
        source_row_key TEXT NOT NULL UNIQUE,
        contact_fullname TEXT,
        contact_title TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        department_ind_agency TEXT,
        office TEXT,
        sub_tier TEXT,
        posted_date TEXT,
        solicitation_number TEXT,
        raw_data JSONB DEFAULT '{}'::jsonb,
        imported_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_opengov_iq_contacts_search ON opengov_iq_contacts
        USING GIN (to_tsvector('english', coalesce(contact_fullname, '') || ' ' || coalesce(contact_title, '') || ' ' || coalesce(department_ind_agency, '') || ' ' || coalesce(office, '') || ' ' || coalesce(sub_tier, '')));
      CREATE INDEX IF NOT EXISTS idx_opengov_iq_contacts_agency ON opengov_iq_contacts(department_ind_agency);
      CREATE INDEX IF NOT EXISTS idx_opengov_iq_contacts_email ON opengov_iq_contacts(contact_email);
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

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getBigQueryCredentials(): BigQueryCredentials | null {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.BIGQUERY_SERVICE_ACCOUNT_JSON;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as BigQueryCredentials;
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch (error) {
      console.error('Invalid BigQuery service account JSON:', error);
    }
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || process.env.BIGQUERY_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.BIGQUERY_PRIVATE_KEY;

  if (!clientEmail || !privateKey) return null;

  return {
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, '\n'),
  };
}

async function getBigQueryAccessToken(credentials: BigQueryCredentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: credentials.client_email,
    scope: BIGQUERY_SCOPE,
    aud: BIGQUERY_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claimSet))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedToken)
    .sign(credentials.private_key);
  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch(BIGQUERY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BigQuery auth failed: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error('BigQuery auth did not return an access token');
  return data.access_token;
}

function bigQueryStringParam(name: string, value: string) {
  return {
    name,
    parameterType: { type: 'STRING' },
    parameterValue: { value },
  };
}

function bigQueryIntParam(name: string, value: number) {
  return {
    name,
    parameterType: { type: 'INT64' },
    parameterValue: { value: String(value) },
  };
}

function parseBigQueryRows(fields: BigQueryField[] = [], rows: Array<{ f?: Array<{ v?: unknown }> }> = []) {
  return rows.map(row => {
    const record: Record<string, string> = {};
    fields.forEach((field, index) => {
      const rawValue = row.f?.[index]?.v;
      record[field.name] = rawValue == null ? '' : String(rawValue);
    });
    return record;
  });
}

function getFirstRecordValue(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const direct = record[key];
    if (direct && direct.trim()) return direct.trim();

    const matchingKey = Object.keys(record).find(recordKey => recordKey.toLowerCase() === key.toLowerCase());
    if (matchingKey && record[matchingKey]?.trim()) return record[matchingKey].trim();
  }

  return '';
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

function sanitizeSupabasePattern(value: string) {
  return value.replace(/[%,()]/g, ' ').trim();
}

async function queryImportedOpenGovContacts(search: string, agency: string) {
  let query = getSupabase()
    .from('opengov_iq_contacts')
    .select('id,source_table,source_row_key,contact_fullname,contact_title,contact_email,contact_phone,department_ind_agency,office,sub_tier,posted_date,solicitation_number')
    .order('imported_at', { ascending: false })
    .limit(80);

  const searchTerm = sanitizeSupabasePattern(search);
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    query = query.or([
      `contact_fullname.ilike.${pattern}`,
      `contact_title.ilike.${pattern}`,
      `contact_email.ilike.${pattern}`,
      `department_ind_agency.ilike.${pattern}`,
      `office.ilike.${pattern}`,
      `sub_tier.ilike.${pattern}`,
      `solicitation_number.ilike.${pattern}`,
    ].join(','));
  }

  const agencyTerm = sanitizeSupabasePattern(agency);
  if (agencyTerm) {
    const pattern = `%${agencyTerm}%`;
    query = query.or([
      `department_ind_agency.ilike.${pattern}`,
      `office.ilike.${pattern}`,
      `sub_tier.ilike.${pattern}`,
    ].join(','));
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return { candidates: [] as RelationshipCandidate[], configured: false };
    }
    throw error;
  }

  const seen = new Set<string>();
  const candidates: RelationshipCandidate[] = [];

  for (const row of (data || []) as Record<string, string>[]) {
    const candidate: RelationshipCandidate = {
      id: `opengov-contact:${row.id}`,
      contact_type: 'government_buyer',
      full_name: row.contact_fullname || row.contact_email || 'Government point of contact',
      title: row.contact_title || 'Government point of contact',
      email: row.contact_email || '',
      phone: row.contact_phone || '',
      organization: row.office || row.sub_tier || row.department_ind_agency || '',
      agency: row.department_ind_agency || '',
      office: row.office || '',
      sub_tier: row.sub_tier || '',
      source: 'opengov_iq_contacts_import',
      source_record_id: `opengov-import:${row.source_row_key}`,
      context: [
        row.solicitation_number ? `Sol# ${row.solicitation_number}` : '',
        row.posted_date ? `Posted ${row.posted_date}` : '',
        row.source_table || 'AllSamContacts',
      ].filter(Boolean).join(' · '),
    };

    if (matchesCandidateSearch(candidate, search, agency)) {
      pushUniqueCandidate(candidates, seen, candidate);
    }
  }

  return { candidates: candidates.slice(0, 40), configured: true };
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
    if (!enhanced.smallBusinessContact) continue;

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

  return candidates.slice(0, 40);
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

async function queryBigQueryContacts(search: string, agency: string) {
  const credentials = getBigQueryCredentials();
  if (!credentials) return { candidates: [] as RelationshipCandidate[], configured: false };

  const token = await getBigQueryAccessToken(credentials);
  const tablePath = `\`${BIGQUERY_CONTACTS_PROJECT_ID}.${BIGQUERY_CONTACTS_DATASET_ID}.${BIGQUERY_CONTACTS_TABLE_ID}\``;
  const searchTerm = search.trim() ? `%${search.trim().toLowerCase()}%` : '';
  const agencyTerm = agency.trim() ? `%${agency.trim().toLowerCase()}%` : '';

  const query = `
    SELECT *
    FROM ${tablePath}
    WHERE
      (@searchTerm = '' OR (
        LOWER(TRIM(CAST(ContactFullname AS STRING))) LIKE @searchTerm OR
        LOWER(TRIM(CAST(ContactTitle AS STRING))) LIKE @searchTerm OR
        LOWER(TRIM(CAST(Department_Ind_Agency AS STRING))) LIKE @searchTerm OR
        LOWER(TRIM(CAST(Office AS STRING))) LIKE @searchTerm OR
        LOWER(TRIM(CAST(Sub_Tier AS STRING))) LIKE @searchTerm
      ))
      AND
      (@agencyTerm = '' OR (
        LOWER(TRIM(CAST(Department_Ind_Agency AS STRING))) LIKE @agencyTerm OR
        LOWER(TRIM(CAST(Office AS STRING))) LIKE @agencyTerm OR
        LOWER(TRIM(CAST(Sub_Tier AS STRING))) LIKE @agencyTerm
      ))
    ORDER BY SAFE_CAST(PostedDate AS TIMESTAMP) DESC
    LIMIT @limit
  `;

  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${BIGQUERY_CONTACTS_PROJECT_ID}/queries`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      useLegacySql: false,
      parameterMode: 'NAMED',
      queryParameters: [
        bigQueryStringParam('searchTerm', searchTerm),
        bigQueryStringParam('agencyTerm', agencyTerm),
        bigQueryIntParam('limit', 40),
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BigQuery contacts query failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const result = await response.json() as {
    schema?: { fields?: BigQueryField[] };
    rows?: Array<{ f?: Array<{ v?: unknown }> }>;
  };

  const records = parseBigQueryRows(result.schema?.fields || [], result.rows || []);
  const seen = new Set<string>();
  const candidates: RelationshipCandidate[] = [];

  for (const record of records) {
    const fullName = getFirstRecordValue(record, ['ContactFullname', 'contact_fullname', 'full_name', 'name']);
    const title = getFirstRecordValue(record, ['ContactTitle', 'contact_title', 'title']);
    const department = getFirstRecordValue(record, ['Department_Ind_Agency', 'department_ind_agency', 'department', 'agency']);
    const office = getFirstRecordValue(record, ['Office', 'office']);
    const subTier = getFirstRecordValue(record, ['Sub_Tier', 'sub_tier', 'subtier']);
    const email = getFirstRecordValue(record, ['ContactEmail', 'Email', 'email', 'email_address', 'POCEmail']);
    const phone = getFirstRecordValue(record, ['ContactPhone', 'Phone', 'phone', 'phone_number', 'POCPhone']);
    const postedDate = getFirstRecordValue(record, ['PostedDate', 'posted_date']);
    const solicitation = getFirstRecordValue(record, ['SolNum', 'SolicitationNumber', 'solicitation_number', 'NoticeId', 'notice_id']);

    const candidate: RelationshipCandidate = {
      id: `bigquery-contact:${email || `${fullName}:${department}:${office}:${solicitation}`}`,
      contact_type: 'government_buyer',
      full_name: fullName || email || 'Government point of contact',
      title: title || 'Government point of contact',
      email,
      phone,
      organization: office || subTier || department,
      agency: department,
      office,
      sub_tier: subTier,
      source: 'opengov_iq_all_sam_contacts',
      source_record_id: `opengov:${email || `${fullName}:${department}:${office}:${solicitation}`}`,
      context: [solicitation ? `Sol# ${solicitation}` : '', postedDate ? `Posted ${postedDate}` : '', `${BIGQUERY_CONTACTS_TABLE_ID}`].filter(Boolean).join(' · '),
    };

    if (matchesCandidateSearch(candidate, search, agency)) {
      pushUniqueCandidate(candidates, seen, candidate);
    }
  }

  return { candidates, configured: true };
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
  const name = getStringField(contact, [
    'fullName',
    'name',
    'contactFullname',
    'ContactFullname',
    'contactName',
    'pocName',
    'poc_name',
    'title',
  ]);
  const title = getStringField(contact, ['title', 'contactTitle', 'ContactTitle', 'type', 'role']) || 'Government point of contact';

  if (!email && !phone && !name) return null;

  const noticeId = String(row.notice_id || row.solicitation_number || index);
  const agency = String(row.department || '');
  const subTier = String(row.sub_tier || '');
  const office = String(row.office || '');
  const opportunityTitle = String(row.title || '');

  return {
    id: `sam-contact:${noticeId}:${email || name || index}`,
    contact_type: 'government_buyer',
    full_name: name || email || 'Government point of contact',
    title,
    email,
    phone,
    organization: office || subTier || agency,
    agency,
    office,
    sub_tier: subTier,
    source: 'sam_opportunities',
    source_record_id: `sam:${noticeId}:${email || name || index}`,
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

  return candidates.slice(0, 40);
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
    const { workspaceId } = await ensureWorkspaceMember(normalizedEmail);

    if (mode === 'pursuits') {
      const { data, error } = await getSupabase()
        .from('user_pipeline')
        .select('id,title,agency,stage,response_deadline')
        .or(`workspace_id.eq.${workspaceId},user_email.eq.${normalizedEmail}`)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return NextResponse.json({ success: true, pursuits: data || [] });
    }

    if (mode === 'candidates') {
      let candidates: RelationshipCandidate[] = [];
      let dataSourceStatus = '';

      if (type === 'government_buyer') {
        try {
          const importedResult = await queryImportedOpenGovContacts(search, agency);
          candidates = importedResult.candidates;
          dataSourceStatus = importedResult.configured
            ? 'opengov_iq_contacts_import'
            : 'OpenGov IQ import table is not loaded yet.';
        } catch (importError) {
          console.error('OpenGov IQ imported contacts query failed:', importError);
          dataSourceStatus = 'OpenGov IQ imported contacts query failed. Trying live BigQuery when available.';
        }

        if (candidates.length === 0) {
          try {
            const bigQueryResult = await queryBigQueryContacts(search, agency);
            candidates = bigQueryResult.candidates;
            dataSourceStatus = bigQueryResult.configured
              ? 'opengov_iq_all_sam_contacts'
              : `${dataSourceStatus} BigQuery contacts table is identified, but credentials are not configured yet. Showing SAM cache contacts when available.`;
          } catch (bigQueryError) {
            console.error('OpenGov IQ BigQuery contacts query failed:', bigQueryError);
            dataSourceStatus = `${dataSourceStatus} Live BigQuery query failed. Showing SAM cache contacts when available.`;
          }
        }

        if (candidates.length === 0) {
          candidates = await mapGovernmentBuyerCandidates(search, naics, agency);
          dataSourceStatus = candidates.length > 0
            ? `${dataSourceStatus} Fallback: sam_opportunities.`
            : 'No buyer contacts found for this search. Try an agency or broader keyword, or use OSBP contacts for relationship outreach.';
        }
      } else if (type === 'osbp') {
        candidates = mapOSBPCandidates(search, agency);
        dataSourceStatus = candidates.length > 0
          ? 'agency_osbp_directory'
          : 'No OSBP contacts matched this search. Try a parent agency name like VA, DHS, GSA, Navy, or Army.';
      } else if (type === 'prime' || type === 'subcontractor' || type === 'partner') {
        candidates = mapContractorCandidates(search, naics, agency);
        dataSourceStatus = candidates.length > 0
          ? 'contractor_database'
          : 'No partner records matched this search.';
      }

      return NextResponse.json({
        success: true,
        candidates,
        dataSourceStatus,
      });
    }

    const contacts = await getSavedContacts(workspaceId, normalizedEmail, type, search);
    const { data: links } = await getSupabase()
      .from('mi_beta_contact_opportunity_links')
      .select('id,contact_id,pipeline_id,relationship_role,user_pipeline(id,title,agency,stage)')
      .eq('workspace_id', workspaceId);

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
    const { workspaceId } = await ensureWorkspaceMember(email);

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

      await recordMIBetaActivity({
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

    const { data, error } = await getSupabase()
      .from('mi_beta_contacts')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    await recordMIBetaActivity({
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
    const { workspaceId } = await ensureWorkspaceMember(email);

    const updates = {
      notes: body.notes,
      title: body.title,
      phone: body.phone,
      email: body.email,
      updated_by: email,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await getSupabase()
      .from('mi_beta_contacts')
      .update(updates)
      .eq('id', body.id)
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${email}`)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, contact: data });
  } catch (error) {
    console.error('MI relationships PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update relationship' }, { status: 500 });
  }
}
