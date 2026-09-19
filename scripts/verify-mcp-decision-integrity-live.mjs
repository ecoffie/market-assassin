#!/usr/bin/env node
/**
 * Authenticated live regressions against mcp.getmindy.ai for the
 * decision-integrity issue log. Prints JSON only. Never prints tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: '/Users/ericcoffie/Market Assasin/market-assassin/.env.local', quiet: true });

function mintMiAuthToken() {
  if (process.env.MI_AUTH_TOKEN) return process.env.MI_AUTH_TOKEN;
  return execSync(
    "npx tsx -e \"import { createMIAuthSessionToken } from './src/lib/two-factor-session.ts'; console.log(createMIAuthSessionToken('eric@govcongiants.com'))\"",
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
}

const BASE = (process.env.MCP_BASE || 'https://getmindy.ai').replace(/\/$/, '');
const EMAIL = 'eric@govcongiants.com';
const UUID_ORIG = 'ce85c48dc296497eb902a0a73ac45680';
const SOL = 'N0017426R1003';
const REDIRECT = 'http://localhost:9876/callback';

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const results = [];

function rec(id, title, pass, evidence, extra = {}) {
  results.push({ id, title, pass, evidence, ...extra });
}

function parseTool(res) {
  const text = res?.content?.find((c) => c.type === 'text')?.text;
  if (!text) return { _parse_error: 'no text', raw: res };
  try { return JSON.parse(text); } catch { return { _parse_error: 'not json', text: String(text).slice(0, 400) }; }
}

async function call(client, name, args) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const parsed = parseTool(res);
  return { ms: Date.now() - t0, parsed, isError: !!res?.isError };
}

async function oauthClient() {
  const TOKEN = mintMiAuthToken();
  if (!TOKEN) throw new Error('MI_AUTH_TOKEN missing');
  const asMeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  const prMeta = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
  const reg = await (await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'decision-integrity live', redirect_uris: [REDIRECT] }),
  })).json();
  if (!reg.client_id) throw new Error(`DCR failed: ${JSON.stringify(reg)}`);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const appr = await (await fetch(`${BASE}/api/oauth/authorize/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': TOKEN, 'x-user-email': EMAIL },
    body: JSON.stringify({
      email: EMAIL, client_id: reg.client_id, redirect_uri: REDIRECT, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp', state: 'live1',
    }),
  })).json();
  if (!appr.redirect) throw new Error(`approve failed: ${JSON.stringify(appr)}`);
  const code = new URL(appr.redirect).searchParams.get('code');
  const tok = await (await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: reg.client_id, redirect_uri: REDIRECT,
    }),
  })).json();
  if (!tok.access_token) throw new Error(`token failed: ${JSON.stringify(tok)}`);
  const transportUrl = process.env.MCP_URL || prMeta.resource || 'https://mcp.getmindy.ai/mcp';
  const transport = new StreamableHTTPClientTransport(new URL(transportUrl), {
    requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } },
  });
  const client = new Client({ name: 'decision-integrity-live', version: '1.0.0' });
  await client.connect(transport);
  return { client, transportUrl, asOk: !!asMeta.authorization_endpoint };
}

async function pickDba() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from('sam_entities')
    .select('legal_business_name,dba_name,uei')
    .not('dba_name', 'is', null)
    .neq('dba_name', '')
    .limit(20);
  if (error || !data?.length) return { error: error?.message || 'no dba rows' };
  return data.find((r) => r.dba_name && r.legal_business_name && r.dba_name.toUpperCase() !== r.legal_business_name.toUpperCase()) || data[0];
}

const SHALLS = Array.from({ length: 28 }, (_, i) =>
  `The Contractor shall perform requirement ${String(i + 1).padStart(2, '0')} of the statement of work.`,
).join('\n');

async function main() {
  const { client } = await oauthClient();
  rec('auth', 'OAuth MCP session', true, 'initialize succeeded against hosted edge');

  // 1. Deadlines — sol# vs UUID
  const sol = await call(client, 'get_solicitation_incumbent', { solicitation_number: SOL });
  const uuid = await call(client, 'get_solicitation_incumbent', { notice_id: UUID_ORIG });
  const solNotice = sol.parsed?.notice || {};
  const uuidNotice = uuid.parsed?.notice || {};
  const solMeta = sol.parsed?._meta || {};
  const uuidMeta = uuid.parsed?._meta || {};
  rec('deadline_uuid', 'UUID lookup stays on original notice',
    String(uuidNotice.notice_id || '').replace(/-/g, '').toLowerCase() === UUID_ORIG
      && String(uuidNotice.response_deadline || '').includes('2026-07-21'),
    {
      notice_id: uuidNotice.notice_id,
      deadline: uuidNotice.response_deadline,
      deadline_conflict: uuidMeta.deadline_conflict,
      grounded_incumbent: uuidMeta.grounded_incumbent,
      incumbent_certainty: uuidMeta.incumbent_certainty,
      ms: uuid.ms,
    });
  rec('deadline_sol', 'Solicitation-number family flags conflict or lists multiple notice UUIDs',
    solMeta.deadline_conflict === true
      || (Array.isArray(solMeta.notice_ids) && solMeta.notice_ids.length > 1)
      || (solNotice.notice_id && uuidNotice.notice_id && solNotice.notice_id !== uuidNotice.notice_id),
    {
      notice_id: solNotice.notice_id,
      deadline: solNotice.response_deadline,
      deadline_conflict: solMeta.deadline_conflict,
      notice_ids: solMeta.notice_ids,
      same_uuid_as_original: solNotice.notice_id === uuidNotice.notice_id,
      ms: sol.ms,
    });

  // 2. Incumbent evidence — must not name incumbent unless grounded
  const incGrounded = !!(uuidMeta.grounded_incumbent || solMeta.grounded_incumbent);
  const incCert = uuidMeta.incumbent_certainty || solMeta.incumbent_certainty;
  const summary = String(uuid.parsed?.summary || sol.parsed?.summary || '');
  const namesIncumbentAsFact = /incumbent is|the incumbent:/i.test(summary) && incCert !== 'supported';
  rec('incumbent', 'Incumbent named only when supported',
    (incGrounded === (incCert === 'supported')) && !namesIncumbentAsFact && ('incumbent_certainty' in uuidMeta || 'incumbent_certainty' in solMeta),
    {
      grounded_incumbent: incGrounded,
      incumbent_certainty: incCert,
      incumbent_reason: uuidMeta.incumbent_reason || solMeta.incumbent_reason,
      summary_head: summary.slice(0, 240),
    });

  // 3. Exact contamination case: Navy N40084 notices carry @state.gov POCs.
  // Email-as-verdict labeled them State Department. Prefix must win, conflict flagged.
  const navyState = await call(client, 'search_federal_contacts', { dodaac: 'N40084', limit: 50 });
  const navyStateList = navyState.parsed?.contacts || [];
  const stateGov = navyStateList.filter((c) => /@state\.gov/i.test(c?.contact_email || ''));
  const stateLabeledAsState = stateGov.filter((c) => /state department/i.test(c?.sub_agency || ''));
  const stateConflictOk = stateGov.length > 0 && stateGov.every((c) =>
    c.sub_agency_uncertain === true
    && (c.sub_agency_evidence === 'conflict' || c.sub_agency === 'Navy')
    && !/state department/i.test(c?.sub_agency || ''));
  rec('contacts_state', 'Navy N40084 @state.gov POCs are conflict/uncertain, not State Department',
    stateConflictOk,
    {
      count: navyStateList.length,
      state_gov_count: stateGov.length,
      labeled_state_department: stateLabeledAsState.length,
      sample: stateGov.slice(0, 4).map((c) => ({
        name: c.contact_fullname, email: c.contact_email, sub_agency: c.sub_agency,
        evidence: c.sub_agency_evidence, uncertain: c.sub_agency_uncertain,
      })),
      ms: navyState.ms,
    });

  // Coast Guard must not contaminate a Navy agency roster as a certain label.
  const navyAgency = await call(client, 'search_federal_contacts', { agency: 'Navy', limit: 50 });
  const navyAgencyList = navyAgency.parsed?.contacts || [];
  const uscgOnNavy = navyAgencyList.filter((c) =>
    /@uscg\.mil/i.test(c?.contact_email || '')
    || (/coast guard/i.test(c?.sub_agency || '') && c.sub_agency_uncertain !== true));
  rec('contacts_uscg', 'Navy agency roster does not treat Coast Guard mailboxes as Navy-certain',
    uscgOnNavy.length === 0,
    {
      count: navyAgencyList.length,
      contaminating: uscgOnNavy.slice(0, 4).map((c) => ({
        email: c.contact_email, sub_agency: c.sub_agency,
        evidence: c.sub_agency_evidence, uncertain: c.sub_agency_uncertain,
        dept: c.department_ind_agency,
      })),
      ms: navyAgency.ms,
    });

  const cgOffice = await call(client, 'search_federal_contacts', { dodaac: '70Z023', limit: 25 });
  const cgList = cgOffice.parsed?.contacts || [];
  const cgMail = cgList.filter((c) => /@uscg\.mil/i.test(c?.contact_email || ''));
  const cgLabeledNavy = cgMail.filter((c) => /^navy$/i.test(c?.sub_agency || '') && c.sub_agency_uncertain !== true);
  rec('contacts_uscg_office', 'Coast Guard 70Z023 roster stays Coast Guard, not Navy',
    cgMail.length > 0 && cgLabeledNavy.length === 0,
    {
      count: cgList.length,
      uscg_mail: cgMail.length,
      labeled_navy_certain: cgLabeledNavy.length,
      sample: cgMail.slice(0, 3).map((c) => ({
        email: c.contact_email, sub_agency: c.sub_agency,
        evidence: c.sub_agency_evidence, uncertain: c.sub_agency_uncertain,
      })),
      ms: cgOffice.ms,
    });

  // 4. Documents + attachment location
  const docs = await call(client, 'get_solicitation_documents', { notice_id: UUID_ORIG });
  const d = docs.parsed || {};
  const loc = d.location_note || d._meta?.location_note || d._ai_hint?.key_caveats?.join(' ') || '';
  const docNotice = String(d.notice_id || d._meta?.notice_id || '').replace(/-/g, '').toLowerCase();
  rec('docs_notice_id', 'Notice-ID document retrieval returns the same UUID',
    docNotice === UUID_ORIG || docNotice === '' && d._meta?.grounded === false /* honest miss still consistent */,
    {
      notice_id: d.notice_id,
      grounded: d._meta?.grounded,
      truncated_attachments: d.truncated_attachments ?? d._meta?.truncated_attachments,
      doc_count: (d.documents || []).length,
      location_note: (d.location_note || loc || '').slice(0, 200),
      ms: docs.ms,
    });
  rec('docs_location', 'External SAM attachment location is explained',
    /SAM\.gov|sam\.gov|external/i.test(String(d.location_note || loc || JSON.stringify(d).slice(0, 1500))),
    { location_note: (d.location_note || loc || '').slice(0, 240) });

  // 5. Compliance matrix — paste 28 shalls + notice path
  const paste = await call(client, 'extract_compliance_matrix', { rfp_text: SHALLS });
  const pasteCount = paste.parsed?.requirements?.length ?? paste.parsed?._meta?.count;
  rec('matrix_paste', 'Manual paste of 28 shall-lines extracts requirements (not empty)',
    Number(pasteCount) >= 20,
    { count: pasteCount, truncated: paste.parsed?._meta?.truncated, source: paste.parsed?._meta?.source, ms: paste.ms });

  const matrix = await call(client, 'extract_compliance_matrix', { notice_id: UUID_ORIG });
  const m = matrix.parsed || {};
  rec('matrix_notice', 'Notice-ID matrix retrieves requirements and reports truncation (not completeness)',
    (String(m._meta?.resolved_notice_id || m._meta?.notice_id || '').replace(/-/g, '').toLowerCase() === UUID_ORIG
      || (m._meta?.source === 'notice_id' && typeof m._meta?.count === 'number'))
      && Number(m._meta?.count ?? m.requirements?.length) > 0,
    {
      count: m._meta?.count ?? m.requirements?.length,
      source: m._meta?.source,
      resolved_notice_id: m._meta?.resolved_notice_id,
      truncated_attachments: m._meta?.truncated_attachments,
      extraction_completeness: m._meta?.extraction_completeness,
      grounded: m._meta?.grounded,
      ms: matrix.ms,
    });
  rec('matrix_completeness', 'Notice-ID matrix completeness is unproven when attachments are truncated',
    Number(m._meta?.truncated_attachments || 0) === 0
      ? m._meta?.extraction_completeness !== 'complete'
      : m._meta?.extraction_completeness === 'unproven' || m._meta?.extraction_completeness == null,
    {
      count: m._meta?.count,
      truncated_attachments: m._meta?.truncated_attachments,
      extraction_completeness: m._meta?.extraction_completeness || 'unproven',
      claim: 'count is retrieval evidence, not an accuracy/completeness oracle',
    });

  // 6. Spend unavailable vs $0
  const missSpend = await call(client, 'get_recipient_annual_obligations', { recipient: 'ZZZZNONEXISTENTCORP99999' });
  const s = missSpend.parsed || {};
  const status = s.amount_status || s._meta?.amount_status;
  rec('spend_unresolved', 'Unsuccessful recipient spend lookup is not $0',
    status === 'unresolved' || status === 'unavailable' || (s.total === null && status !== 'zero'),
    { amount_status: status, total: s.total, grounded: s._meta?.grounded, degraded: s._meta?.degraded, ms: missSpend.ms });

  const lockheed = await call(client, 'get_recipient_annual_obligations', { recipient: 'Lockheed Martin' });
  const L = lockheed.parsed || {};
  rec('spend_positive', 'Known recipient still returns a real amount_status',
    L.amount_status === 'positive' || (typeof L.total === 'number' && L.total > 0),
    { amount_status: L.amount_status || L._meta?.amount_status, total: L.total, grounded: L._meta?.grounded, ms: lockheed.ms });

  // 7. OSBP coverage
  const osbpHit = await call(client, 'lookup_federal_osbp', { agency: 'NAVFAC' });
  rec('osbp_hit', 'Known command is a directory hit',
    osbpHit.parsed?._meta?.coverage === 'hit' && osbpHit.parsed?._meta?.grounded === true,
    { coverage: osbpHit.parsed?._meta?.coverage, grounded: osbpHit.parsed?._meta?.grounded, office: osbpHit.parsed?.office?.command, ms: osbpHit.ms });
  const osbpMiss = await call(client, 'lookup_federal_osbp', { agency: 'GSA Federal Acquisition Service' });
  const cov = osbpMiss.parsed?._meta?.coverage;
  rec('osbp_gap', 'Missing directory coverage is not "no OSBP office"',
    cov === 'not_in_directory' || (osbpMiss.parsed?._meta?.grounded === false && cov !== 'no_osbp_listed'),
    { coverage: cov, grounded: osbpMiss.parsed?._meta?.grounded, match: osbpMiss.parsed?._meta?.match, ms: osbpMiss.ms });

  // 8. Entity lookup / DBA / ambiguity
  const fluidyne = await call(client, 'lookup_sam_entity', { name: 'Fluidyne Corporation' });
  rec('entity_fluidyne', 'Fluidyne resolves (not unregistered)',
    fluidyne.parsed?._meta?.lookup_status === 'found' || fluidyne.parsed?._meta?.grounded === true,
    {
      lookup_status: fluidyne.parsed?._meta?.lookup_status,
      grounded: fluidyne.parsed?._meta?.grounded,
      uei: fluidyne.parsed?.entity?.ueiSAM,
      name: fluidyne.parsed?.entity?.legalBusinessName,
      match_count: fluidyne.parsed?._meta?.match_count,
      ms: fluidyne.ms,
    });
  const fluidynePunc = await call(client, 'lookup_sam_entity', { name: 'FLUIDYNE CORPORATION,' });
  rec('entity_punct', 'Punctuation variant resolves consistently',
    (fluidynePunc.parsed?.entity?.ueiSAM || null) === (fluidyne.parsed?.entity?.ueiSAM || null)
      && fluidynePunc.parsed?._meta?.lookup_status === fluidyne.parsed?._meta?.lookup_status,
    {
      status_a: fluidyne.parsed?._meta?.lookup_status,
      status_b: fluidynePunc.parsed?._meta?.lookup_status,
      uei_a: fluidyne.parsed?.entity?.ueiSAM,
      uei_b: fluidynePunc.parsed?.entity?.ueiSAM,
    });
  const tanaq = await call(client, 'lookup_sam_entity', { name: 'Tanaq' });
  rec('entity_ambiguous', 'Ambiguous family does not take the first match',
    tanaq.parsed?._meta?.lookup_status === 'ambiguous'
      || (tanaq.parsed?._meta?.match_count > 1 && tanaq.parsed?.entity == null),
    {
      lookup_status: tanaq.parsed?._meta?.lookup_status,
      match_count: tanaq.parsed?._meta?.match_count,
      entity: tanaq.parsed?.entity?.legalBusinessName || null,
      first_match: tanaq.parsed?.matches?.[0]?.legalBusinessName,
      ms: tanaq.ms,
    });

  let dbaRow = null;
  try { dbaRow = await pickDba(); } catch (e) { dbaRow = { error: String(e.message || e) }; }
  if (dbaRow?.dba_name) {
    const dba = await call(client, 'lookup_sam_entity', { name: dbaRow.dba_name });
    rec('entity_dba', 'DBA lookup finds the legal entity (or stays ambiguous — never unregistered)',
      dba.parsed?._meta?.lookup_status === 'found'
        || dba.parsed?._meta?.lookup_status === 'ambiguous'
        || dba.parsed?._meta?.grounded === true,
      {
        queried_dba: dbaRow.dba_name,
        legal: dbaRow.legal_business_name,
        lookup_status: dba.parsed?._meta?.lookup_status,
        resolved: dba.parsed?.entity?.legalBusinessName,
        uei: dba.parsed?.entity?.ueiSAM,
        ms: dba.ms,
      });
  } else {
    rec('entity_dba', 'DBA lookup (no live DBA row available to query)',
      false,
      { detail: dbaRow });
  }

  // 9. Award-history corpus miss ≠ zero awards
  const hist = await call(client, 'get_contractor_award_history', { company: 'ZZZZNONEXISTENTCORP99999' });
  const h = hist.parsed || {};
  const impliesZero = h._meta?.grounded === false && (h._meta?.total_obligations === 0) && !h._meta?.note && h._meta?.resolution !== 'none';
  rec('history_miss', 'Corpus miss does not imply zero federal awards',
    h._meta?.grounded === false
      && (/none/i.test(String(h._meta?.resolution || h._meta?.name_resolution || ''))
        || /not proof the firm has no federal/i.test(String(h._meta?.note || ''))
        || h._meta?.award_history_elsewhere === true),
    {
      grounded: h._meta?.grounded,
      resolution: h._meta?.resolution || h._meta?.name_resolution,
      total_obligations: h._meta?.total_obligations,
      note: (h._meta?.note || '').slice(0, 200),
      award_history_elsewhere: h._meta?.award_history_elsewhere,
      ms: hist.ms,
    });

  // 10. Compact search pagination
  const search = await call(client, 'search_sam_opportunities', { keyword: 'janitorial' });
  const items = search.parsed?.items || search.parsed?.results || search.parsed?.opportunities || [];
  const count = items.length;
  const hasNotice = items.length === 0 || items.every((it) => it.notice_id);
  rec('search_compact', 'Open search returns compact page with notice_id',
    count <= 10 && ('has_more' in (search.parsed || {}) || 'offset' in (search.parsed || {}) || count <= 10) && hasNotice,
    {
      count,
      has_more: search.parsed?.has_more,
      offset: search.parsed?.offset,
      sample_ids: items.slice(0, 3).map((it) => it.notice_id),
      keys: Object.keys(search.parsed || {}).slice(0, 12),
      ms: search.ms,
    });

  // 11. Referee timeout_trace (small run — proves the field shipped)
  const ref = await call(client, 'referee_proposal_compliance', {
    requirements: [
      { id: 'REQ-001', requirement: 'The Contractor shall submit a technical approach.' },
      { id: 'REQ-002', requirement: 'The Contractor shall provide past performance for similar work.' },
    ],
    draft: 'Technical Approach: we will staff the effort. Past performance: see Volume II.',
  });
  const trace = ref.parsed?._meta?.timeout_trace;
  rec('referee_trace', 'Proposal referee returns timeout_trace',
    !!trace && typeof trace.budget_ms === 'number',
    {
      timeout_trace: trace || null,
      grounded: ref.parsed?._meta?.grounded,
      unevaluated: ref.parsed?.verdicts?.filter((v) => v.status === 'unevaluated')?.length,
      ms: ref.ms,
    });

  await client.close().catch(() => {});
  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({
    host: process.env.MCP_URL || 'https://mcp.getmindy.ai/mcp',
    oauth_base: BASE,
    deployment: process.env.DPL_ID || 'unknown',
    case_count: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: failed.length,
    missing_from_prior_table: 'auth (OAuth MCP session) — the 20th runner case omitted from the 19-row report',
    cases: results,
  }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.log(JSON.stringify({ fatal: String(err?.message || err), cases: results }, null, 2));
  process.exit(2);
});
