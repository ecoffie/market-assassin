import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';

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

function clean(value?: string | null) {
  return (value || '').replace(/[%,()]/g, ' ').trim();
}

function splitTerms(value: string) {
  return value.split(/[, ]+/).map(term => term.trim()).filter(Boolean);
}

async function searchEntities(search: string, naics: string, state: string, limit: number) {
  let query = getSupabase()
    .from('opengov_iq_entities')
    .select('id,uei_sam,cage_code,legal_business_name,dba_name,entity_url,physical_city,physical_state,physical_country,business_type_string,sba_business_types_string,primary_naics,naics_code_string,psc_code_string,registration_expiration_date,exclusion_status_flag,government_poc_name,government_poc_title,electronic_poc_name,electronic_poc_title')
    .order('legal_business_name', { ascending: true })
    .limit(limit);

  const searchTerm = clean(search);
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    query = query.or([
      `legal_business_name.ilike.${pattern}`,
      `dba_name.ilike.${pattern}`,
      `uei_sam.ilike.${pattern}`,
      `cage_code.ilike.${pattern}`,
      `business_type_string.ilike.${pattern}`,
      `sba_business_types_string.ilike.${pattern}`,
    ].join(','));
  }

  const naicsTerms = splitTerms(clean(naics));
  if (naicsTerms.length === 1) {
    const pattern = `${naicsTerms[0]}%`;
    query = query.or(`primary_naics.ilike.${pattern},naics_code_string.ilike.%${naicsTerms[0]}%`);
  }

  const stateTerm = clean(state);
  if (stateTerm) {
    query = query.eq('physical_state', stateTerm.toUpperCase());
  }

  const { data, error } = await query;
  if (error) throw error;

  if (naicsTerms.length > 1) {
    return (data || []).filter((row: { primary_naics?: string | null; naics_code_string?: string | null }) => (
      naicsTerms.some(term => (
        (row.primary_naics || '').startsWith(term) ||
        (row.naics_code_string || '').includes(term)
      ))
    ));
  }

  return data || [];
}

async function searchVehicles(search: string, naics: string, agency: string, limit: number) {
  let query = getSupabase()
    .from('opengov_iq_idiq_vehicles')
    .select('id,description,award_id,naics,agency,recipient_uei,recipient_name,ai_generated_text,cleaned_vehicle')
    .order('recipient_name', { ascending: true })
    .limit(limit);

  const searchTerm = clean(search);
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    query = query.or([
      `description.ilike.${pattern}`,
      `award_id.ilike.${pattern}`,
      `recipient_name.ilike.${pattern}`,
      `cleaned_vehicle.ilike.${pattern}`,
      `ai_generated_text.ilike.${pattern}`,
    ].join(','));
  }

  const naicsTerms = splitTerms(clean(naics));
  if (naicsTerms.length === 1) {
    query = query.ilike('naics', `${naicsTerms[0]}%`);
  }

  const agencyTerm = clean(agency);
  if (agencyTerm) {
    query = query.ilike('agency', `%${agencyTerm}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  if (naicsTerms.length > 1) {
    return (data || []).filter((row: { naics?: string | null }) => (
      naicsTerms.some(term => (row.naics || '').startsWith(term))
    ));
  }

  return data || [];
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const type = request.nextUrl.searchParams.get('type') || 'entities';
  const search = request.nextUrl.searchParams.get('search') || '';
  const naics = request.nextUrl.searchParams.get('naics') || '';
  const agency = request.nextUrl.searchParams.get('agency') || '';
  const state = request.nextUrl.searchParams.get('state') || '';
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 25, 100);

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  try {
    if (type === 'vehicles') {
      const vehicles = await searchVehicles(search, naics, agency, limit);
      return NextResponse.json({ success: true, type, vehicles });
    }

    const entities = await searchEntities(search, naics, state, limit);
    return NextResponse.json({ success: true, type: 'entities', entities });
  } catch (error) {
    console.error('MI enrichment API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to load enrichment data',
    }, { status: 500 });
  }
}
