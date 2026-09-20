/**
 * Issue-log 14 outstanding recheck — original tools + exact inputs.
 * Calls production MCP (OAuth) for items Round 3 did not retest, plus a
 * local get_agency_intel check for the LEGACY_MANUAL dollar-omission fix
 * (not yet on prod). Prints JSON only. Never prints tokens.
 *
 * #13 referee_proposal_compliance is SKIPPED when the original 17-req /
 * ~15k-draft payload is absent — never invent it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true });

const BASE = (process.env.MCP_BASE || 'https://getmindy.ai').replace(/\/$/, '');
const EMAIL = 'eric@govcongiants.com';
const REDIRECT = 'http://localhost:9876/callback';
const MATRIX_NOTICE = '6552b25bf0e648f39b44228275998eef';
const DOSSIER_SOL = 'N00024-26-R-2200';
const DOCS_SOL = 'N00024-26-R-4160';
const DOCS_UUID = '85a62e9a3f4f4f54b0ade7aa855fcc89';
const NAICS = '336612';

const b64url = (b) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function parseTool(res) {
  const text = res?.content?.find((c) => c.type === 'text')?.text;
  if (!text) return { _parse_error: 'no text', raw: res };
  try {
    return JSON.parse(text);
  } catch {
    return { _parse_error: 'not json', text: String(text).slice(0, 600) };
  }
}

async function mintMiAuthToken() {
  if (process.env.MI_AUTH_TOKEN) return process.env.MI_AUTH_TOKEN;
  // Avoid .ts import paths (tsc / allowImportingTsExtensions) — same pattern as
  // scripts/verify-mcp-decision-integrity-live.mjs.
  return execSync(
    "npx tsx -e \"import { createMIAuthSessionToken } from './src/lib/two-factor-session.ts'; console.log(createMIAuthSessionToken('eric@govcongiants.com'))\"",
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
}

async function oauthClient() {
  const TOKEN = await mintMiAuthToken();
  if (!TOKEN) throw new Error('MI_AUTH_TOKEN missing');
  const reg = await (
    await fetch(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'issue-log-14 recheck',
        redirect_uris: [REDIRECT],
      }),
    })
  ).json();
  if (!reg.client_id) throw new Error(`DCR failed: ${JSON.stringify(reg)}`);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const appr = await (
    await fetch(`${BASE}/api/oauth/authorize/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mi-auth-token': TOKEN,
        'x-user-email': EMAIL,
      },
      body: JSON.stringify({
        email: EMAIL,
        client_id: reg.client_id,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope: 'mcp',
        state: 'il14',
      }),
    })
  ).json();
  if (!appr.redirect) throw new Error(`approve failed: ${JSON.stringify(appr)}`);
  const code = new URL(appr.redirect).searchParams.get('code');
  const tok = await (
    await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        code_verifier: verifier,
        client_id: reg.client_id,
        redirect_uri: REDIRECT,
      }),
    })
  ).json();
  if (!tok.access_token) throw new Error(`token failed: ${JSON.stringify(tok)}`);
  const prMeta = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
  const transportUrl = process.env.MCP_URL || prMeta.resource || 'https://mcp.getmindy.ai/mcp';
  const transport = new StreamableHTTPClientTransport(new URL(transportUrl), {
    requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } },
  });
  const client = new Client({ name: 'issue-log-14-recheck', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  return { ms: Date.now() - t0, parsed: parseTool(res), isError: !!res?.isError };
}

function textBlob(v) {
  return JSON.stringify(v ?? '').toLowerCase();
}

async function localAgencyIntelDollarCheck() {
  // Spawn tsx so this .mts file never imports application .ts paths (tsc gate).
  const raw = execSync(
    `npx tsx -e ${JSON.stringify(`
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import { getAgencyIntel } from './src/mcp/tools/agency-intel.ts';
const r = await getAgencyIntel({ agency: 'Naval Sea Systems Command' });
const pri = r.agency?.priorities ?? [];
const cites = r.agency?.priorityCitations ?? [];
const joined = [...pri, ...cites.map((c) => c.claim)].join('\\n');
console.log(JSON.stringify({
  matchType: r.agency?.matchType,
  spending_scope: r.spending?.scope,
  command_spending: r.command_spending?.status,
  parent_service_total: r.spending?.parent_service_total ?? null,
  totalObligations: r.spending?.totalObligations ?? null,
  priority_count: pri.length,
  priorities_have_dollar: /\\$/.test(joined),
  sample_priorities: pri.slice(0, 3),
  provenanceNote: r.agency?.provenanceNote,
  provenance: cites.slice(0, 3).map((c) => c.provenance),
}));
`)}`,
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  ).trim();
  const line = raw.split('\n').filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error(`local agency intel probe produced no JSON: ${raw.slice(0, 400)}`);
  return JSON.parse(line);
}

async function main() {
  const startedUtc = new Date().toISOString();
  const servingCommitProbe = await (await fetch(`${BASE}/`)).text();
  const m = servingCommitProbe.match(/maps-account-build:([a-f0-9]+)/);
  const servingCommit = m?.[1] ?? null;

  const client = await oauthClient();
  const checks = [];

  // #1 SCIF recovery + named specs
  {
    const input = { notice_id: MATRIX_NOTICE };
    const { ms, parsed, isError } = await call(client, 'extract_compliance_matrix', input);
    const cov = parsed?._meta?.source_spec_coverage ?? {};
    const present = cov.present_in_source ?? [];
    const missing = cov.missing_from_matrix ?? [];
    const blob = textBlob(parsed);
    const specs = ['scif', 'loa', 'flight deck', 'berthing', 'magazine'];
    const inMatrix = Object.fromEntries(
      specs.map((s) => [s, blob.includes(s.replace(' ', '')) || blob.includes(s)]),
    );
    checks.push({
      id: 1,
      tool: 'extract_compliance_matrix',
      input,
      ms,
      isError,
      pass:
        !isError &&
        present.includes?.('scif') &&
        !(missing.includes?.('scif')) &&
        inMatrix.scif === true,
      note: 'All five present ≠ full-document completeness',
      evidence: {
        count: parsed?._meta?.count,
        recovered: parsed?._meta?.recovered_source_specs,
        present_in_source: present,
        missing_from_matrix: missing,
        extraction_completeness: parsed?._meta?.extraction_completeness,
        named_specs_in_matrix_blob: inMatrix,
      },
    });
  }

  // #2 contacts (regression, already independently verified)
  {
    const input = { agency: 'United States Coast Guard', search: 'small business', limit: 5 };
    const { ms, parsed, isError } = await call(client, 'search_federal_contacts', input);
    const blob = textBlob(parsed);
    checks.push({
      id: 2,
      tool: 'search_federal_contacts',
      input,
      ms,
      isError,
      pass: !isError && /uscg\.mil|kersey|small.?business/i.test(blob) && !/state\.gov|dos\.gov/i.test(blob),
      evidence: {
        grounded: parsed?._meta?.grounded,
        count: parsed?.contacts?.length ?? parsed?._meta?.count,
        sample: (parsed?.contacts ?? []).slice(0, 2).map((c) => ({
          name: c.name,
          email: c.email,
          agency: c.agency,
        })),
      },
    });
  }

  // #3 + #9 dossier
  {
    const input = { solicitation_number: DOSSIER_SOL };
    const { ms, parsed, isError } = await call(client, 'build_pursuit_dossier', input);
    const size = JSON.stringify(parsed).length;
    const incumbent = parsed?.incumbent ?? parsed?.dossier?.incumbent ?? null;
    const incumbentName =
      parsed?.incumbent_name ?? parsed?.dossier?.incumbent_name ?? incumbent?.name ?? null;
    const groundedIncumbent =
      parsed?.grounded_incumbent ?? parsed?._meta?.grounded_incumbent ?? parsed?.dossier?.grounded_incumbent;
    const blob = textBlob(parsed);
    checks.push({
      id: '3+9',
      tool: 'build_pursuit_dossier',
      input,
      ms,
      isError,
      pass:
        !isError &&
        (incumbent === null || incumbent === undefined) &&
        !/mazak/i.test(String(incumbentName ?? '')) &&
        (groundedIncumbent === false || groundedIncumbent === undefined),
      evidence: {
        size_bytes: size,
        incumbent,
        incumbent_name: incumbentName,
        grounded_incumbent: groundedIncumbent,
        mazak_in_prior_awards_only: /mazak/i.test(blob) && !/mazak/i.test(String(incumbentName ?? '')),
        omitted: parsed?._meta?.omitted,
        grounded: parsed?._meta?.grounded,
      },
    });
  }

  // #4 agency intel (prod — dollars still expected until this PR deploys)
  {
    const input = { agency: 'Naval Sea Systems Command' };
    const { ms, parsed, isError } = await call(client, 'get_agency_intel', input);
    checks.push({
      id: 4,
      tool: 'get_agency_intel',
      input,
      ms,
      isError,
      pass:
        !isError &&
        parsed?.agency?.matchType &&
        parsed?.command_spending?.status === 'NOT_ESTABLISHED' &&
        parsed?.spending?.scope === 'PARENT_SERVICE' &&
        parsed?.spending?.totalObligations == null,
      evidence: {
        matchType: parsed?.agency?.matchType,
        requested_identity: parsed?.requested_identity,
        command_spending: parsed?.command_spending,
        spending_scope: parsed?.spending?.scope,
        scope_name: parsed?.spending?.scope_name,
        totalObligations: parsed?.spending?.totalObligations,
        parent_service_total: parsed?.spending?.parent_service_total,
        priorities_have_dollar_on_prod: /\$/.test(
          JSON.stringify(parsed?.agency?.priorities ?? parsed?.agency?.priorityCitations ?? []),
        ),
        provenanceNote: parsed?.agency?.provenanceNote,
      },
    });
  }

  // #4 local dollar omission (this branch)
  {
    const local = await localAgencyIntelDollarCheck();
    checks.push({
      id: '4-local-dollar-omission',
      tool: 'get_agency_intel',
      input: { agency: 'Naval Sea Systems Command' },
      surface: 'local_worktree_not_prod',
      pass:
        local.priorities_have_dollar === false &&
        local.command_spending === 'NOT_ESTABLISHED' &&
        local.spending_scope === 'PARENT_SERVICE' &&
        local.totalObligations === null,
      evidence: local,
    });
  }

  // #6 OSBP
  {
    const input = { agency: 'United States Coast Guard' };
    const { ms, parsed, isError } = await call(client, 'lookup_federal_osbp', input);
    const blob = textBlob(parsed);
    checks.push({
      id: 6,
      tool: 'lookup_federal_osbp',
      input,
      ms,
      isError,
      pass: !isError && /uscg\.mil|kersey|small.?business/i.test(blob) && !/\bstate department\b|dos\.gov/i.test(blob),
      evidence: {
        grounded: parsed?._meta?.grounded,
        contact: parsed?.contact ?? parsed?.osbp ?? parsed?.result,
      },
    });
  }

  // #8 past contracts
  {
    const input = { naics: NAICS, limit: 5 };
    const { ms, parsed, isError } = await call(client, 'search_past_contracts', input);
    const rows = parsed?.awards ?? [];
    const first = rows[0] ?? {};
    const queriedNaics = parsed?.queried?.naics;
    const sourceNaics = first.naicsCode ?? first.naics_code ?? '';
    // Honest attribution: query filter is separate from source field; empty source stays empty.
    const noFilterStamp =
      sourceNaics === '' ||
      sourceNaics === null ||
      sourceNaics === undefined ||
      sourceNaics === NAICS; // real source may equal filter; stamp bug was inventing when source empty
    const emptySourceHonest =
      (sourceNaics === '' || sourceNaics == null) && queriedNaics === NAICS;
    checks.push({
      id: 8,
      tool: 'search_past_contracts',
      input,
      ms,
      isError,
      pass: !isError && queriedNaics === NAICS && noFilterStamp && !!parsed?._meta?.field_status,
      evidence: {
        grounded: parsed?._meta?.grounded,
        row_count: rows.length,
        queried: parsed?.queried,
        first_naicsCode: sourceNaics === '' ? '' : sourceNaics || null,
        empty_source_naics_with_query_filter: emptySourceHonest,
        first_pscCode: first.pscCode ?? first.psc_code ?? null,
        first_awardingOffice: first.awardingOffice ?? first.awarding_office ?? null,
        first_recipientState: first.recipientState ?? first.recipient_state ?? null,
        first_popState: first.popState ?? first.pop_state ?? null,
        field_status: parsed?._meta?.field_status,
      },
    });
  }

  // #10 solicitation incumbent / lot deadlines (tracker tool name)
  {
    const input = { solicitation_number: DOSSIER_SOL };
    const { ms, parsed, isError } = await call(client, 'get_solicitation_incumbent', input);
    const blob = textBlob(parsed);
    const meta = parsed?._meta ?? {};
    const notice = parsed?.notice ?? {};
    checks.push({
      id: 10,
      tool: 'get_solicitation_incumbent',
      input,
      ms,
      isError,
      pass:
        !isError &&
        meta.grounded_incumbent !== true &&
        (meta.deadline_conflict === true ||
          /2026-08-13/.test(blob) ||
          Array.isArray(meta.lot_deadlines) ||
          /lot\s*1/i.test(blob)),
      evidence: {
        grounded_notice: meta.grounded_notice,
        grounded_incumbent: meta.grounded_incumbent,
        incumbent: parsed?.incumbent,
        deadline_conflict: meta.deadline_conflict ?? notice.deadline_conflict,
        lot_deadlines: meta.lot_deadlines ?? notice.lot_deadlines,
        response_deadline: notice.response_deadline,
        notice_id: notice.notice_id,
      },
    });
  }

  // #11 SOW / PIEE
  {
    const input = { notice_id: DOSSIER_SOL };
    const { ms, parsed, isError } = await call(client, 'extract_statement_of_work', input);
    checks.push({
      id: 11,
      tool: 'extract_statement_of_work',
      input,
      ms,
      isError,
      pass:
        !isError &&
        (parsed?._meta?.piee ||
          parsed?._meta?.piee_links ||
          parsed?.piee_links ||
          parsed?._meta?.retrieval_limitation ||
          (parsed?._meta?.unread_attachments ?? 0) > 0),
      evidence: {
        grounded: parsed?._meta?.grounded,
        piee: parsed?._meta?.piee,
        piee_links: parsed?.piee_links ?? parsed?._meta?.piee_links,
        retrieval_limitation: parsed?._meta?.retrieval_limitation,
        unread_attachments: parsed?._meta?.unread_attachments,
      },
    });
  }

  // #12 docs sol vs UUID
  {
    const a = await call(client, 'get_solicitation_documents', { notice_id: DOCS_SOL });
    const b = await call(client, 'get_solicitation_documents', { notice_id: DOCS_UUID });
    const aId = a.parsed?.notice_id ?? a.parsed?._meta?.notice_id;
    const bId = b.parsed?.notice_id ?? b.parsed?._meta?.notice_id;
    const aDesc = a.parsed?.description ?? a.parsed?.source_text ?? '';
    const bDesc = b.parsed?.description ?? b.parsed?.source_text ?? '';
    checks.push({
      id: 12,
      tool: 'get_solicitation_documents',
      input: { notice_id_sol: DOCS_SOL, notice_id_uuid: DOCS_UUID },
      ms: a.ms + b.ms,
      isError: a.isError || b.isError,
      pass:
        !a.isError &&
        !b.isError &&
        aId &&
        aId === bId &&
        String(aDesc).length > 100 &&
        String(aDesc) === String(bDesc),
      evidence: {
        sol: { notice_id: aId, desc_chars: String(aDesc).length, grounded: a.parsed?._meta?.grounded, doc_count: a.parsed?._meta?.doc_count ?? a.parsed?.documents?.length },
        uuid: { notice_id: bId, desc_chars: String(bDesc).length, grounded: b.parsed?._meta?.grounded, doc_count: b.parsed?._meta?.doc_count ?? b.parsed?.documents?.length },
      },
    });
  }

  // #13 — payload missing
  checks.push({
    id: 13,
    tool: 'referee_proposal_compliance',
    input: null,
    pass: null,
    skipped: true,
    reason: 'Original 17-requirements / ~15k-draft payload is not in the repo or attachments. Never invent a missing original payload.',
  });

  // #14 Monarch
  {
    const input = { name: 'Monarch Yachts' };
    const { ms, parsed, isError } = await call(client, 'lookup_sam_entity', input);
    const recon = parsed?._meta?.reconciliation ?? parsed?.reconciliation;
    checks.push({
      id: 14,
      tool: 'lookup_sam_entity',
      input,
      ms,
      isError,
      pass:
        !isError &&
        (parsed?.lookup_status === 'not_found' || parsed?._meta?.grounded === false) &&
        !!recon,
      evidence: {
        lookup_status: parsed?.lookup_status,
        grounded: parsed?._meta?.grounded,
        degraded: parsed?._meta?.degraded,
        reconciliation: recon,
      },
    });
  }

  // market depth / past contracts NAICS companion
  {
    const input = { naics: NAICS };
    const { ms, parsed, isError } = await call(client, 'assess_market_depth', input);
    checks.push({
      id: 'market-depth-336612',
      tool: 'assess_market_depth',
      input,
      ms,
      isError,
      pass: !isError && parsed?._meta?.grounded !== false,
      evidence: {
        grounded: parsed?._meta?.grounded,
        firm_count: parsed?.firms?.length ?? parsed?._meta?.firm_count,
        capped: parsed?._meta?.capped,
      },
    });
  }

  await client.close().catch(() => {});

  const out = {
    started_utc: startedUtc,
    finished_utc: new Date().toISOString(),
    base: BASE,
    serving_commit_from_maps_account_build: servingCommit,
    production_deploy_id_observed: 'dpl_DE5v71VKaWFaq6J9UXL8omhYEWFm',
    checks,
    summary: {
      passed: checks.filter((c) => c.pass === true).length,
      failed: checks.filter((c) => c.pass === false).length,
      skipped: checks.filter((c) => c.skipped).length,
    },
  };
  const outPath = path.join(ROOT, 'tasks/issue-log-14-recheck-2026-09-20.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.error(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
