/**
 * POST /api/app/auto-setup
 *
 * "Set up my Mindy" (Auto mode). Takes the user's saved profile (NAICS/keywords)
 * and POPULATES their existing surfaces instead of sending them to a separate
 * aggregated page. v1 fills My Target List: it runs the same buying-agency scan
 * Market Research uses, then ADDS the top agencies to user_target_list — where
 * each one already carries its spend, sources sought, events, and contacts.
 *
 * Principles (memory: simplify-not-complicate):
 *   - Reuses EXISTING pieces — target-market-research for the scan,
 *     user_target_list for the write. No new tables or columns.
 *   - ADD-ONLY. The table's unique constraint returns 23505 on a row the user
 *     already has → counted as "skipped", never overwritten. Sport-mode /
 *     hand-added targets always survive.
 *
 * Returns counts the receipt screen shows ("added N agencies to your Target
 * List"). Forecasts/Pursuits already inherit the profile's codes when opened, so
 * Auto deliberately doesn't touch them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { verifyMIAccess } from '@/lib/api-auth';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { internalBaseUrl } from '@/lib/utils/internal-base-url';
import { normalizeOfficeName } from '@/lib/gov-contacts/office-name';
import { distinctiveKeywords } from '@/lib/market/keyword-sanitize';
import { mergeScanAgencies, clampSetAsideSpending, validOfficeCode, emptyScanOutcome, type ScanAgency as PureScanAgency } from '@/lib/app/auto-setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) {
    _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/** How many of the top buying agencies Auto seeds into the Target List. */
const MAX_AGENCIES = 8;

interface ScanAgency {
  name: string;
  contractingOffice?: string;
  subAgency?: string;
  parentAgency?: string;
  agencyCode?: string;
  subAgencyCode?: string;
  officeId?: string;
  location?: string;
  setAsideSpending?: number;
  contractCount?: number;
}

export async function POST(request: NextRequest) {
  let body: { email?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const email = body.email?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  // Target List is a Pro feature — mirror the target-list POST gate.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      { upgrade_required: true, message: 'Auto-setup populates your Target List, a Mindy Pro feature.' },
      { status: 402 },
    );
  }

  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const rowEmail = asClient ? clientNotificationEmail(workspaceId) : email;

  // 1) Read the profile's codes (the same source every surface inherits).
  const { data: prof, error: profErr } = await getSupabase()
    .from('user_notification_settings')
    .select('naics_codes, keywords, location_states')
    .eq('user_email', rowEmail)
    .maybeSingle();
  if (profErr) console.error('[auto-setup] profile query error:', profErr.message);

  const naicsCodes: string[] = (prof?.naics_codes || []).map(String).filter(Boolean);
  const keywords: string[] = (prof?.keywords || []).map(String).filter(Boolean);
  const states: string[] = (prof?.location_states || []).map(String).filter(Boolean);

  if (naicsCodes.length === 0 && keywords.length === 0) {
    return NextResponse.json(
      { success: false, needsProfile: true, error: 'Add NAICS codes or keywords to your profile first.' },
      { status: 400 },
    );
  }

  // 2) Find the buying agencies — call find-agencies directly (NOT the richer
  // target-market-research). find-agencies needs NO MI session auth and returns
  // the exact fields we map, so it avoids the server→server auth-forward + 308
  // body-drop fragility that made Auto silently return 0 agencies in Coach Mode.
  // It takes ONE naicsCode, so scan the top 5 profile codes and merge/dedup —
  // a richer pool of candidate buyers before the top-MAX_AGENCIES cut, so the
  // seeded list is chosen from more of the profile, not just its first 3 codes.
  const base = internalBaseUrl(request);
  const stateFilter = states.length ? { locationStates: states } : {};

  // Discovery is TWO axes, not one (memory: naics-vs-psc-search, keyword-first
  // market research). NAICS finds buyers by who the SELLER is — a catch-all that
  // misses buyers who classify the same work under a different code. Keywords
  // find buyers by what was actually BOUGHT (matches the contract text), so they
  // surface agencies NAICS alone would miss. We run both and merge before the cut.
  const codesToScan = naicsCodes.slice(0, 5);
  // Keyword axis: only DISTINCTIVE terms (phrases / real product words) — generic
  // singles ("management", "services") would flood the scan with every big buyer,
  // the exact over-width problem we just fixed. Cap at 3 to bound the fan-out.
  const kwToScan = distinctiveKeywords(keywords).slice(0, 3);

  // Each request is labelled so a keyword scan's failure is reported distinctly
  // from a NAICS scan's, and so we never let one empty axis mask the other.
  type ScanReq = { kind: 'naics' | 'keyword'; label: string; body: Record<string, unknown> };
  const requests: ScanReq[] = [
    ...codesToScan.map((code) => ({
      kind: 'naics' as const,
      label: `naics ${code}`,
      body: { naicsCode: code, ...stateFilter },
    })),
    ...kwToScan.map((kw) => ({
      kind: 'keyword' as const,
      label: `keyword "${kw}"`,
      // Keyword-primary discovery: marketFilter drives the buyer sampling, NAICS
      // is left off so the term isn't trapped inside a single seller code.
      body: {
        marketFilter: { keywords: [kw], mode: 'keyword', rankingLabel: `keyword "${kw}"` },
        searchKeywords: [kw],
        ...stateFilter,
      },
    })),
  ];

  const agencyLists: ScanAgency[][] = [];
  const scanErrors: string[] = [];
  try {
    const scans = await Promise.all(
      requests.map((req) =>
        fetch(`${base}/api/usaspending/find-agencies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        })
          .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null), req }))
          .catch((e) => ({ ok: false, status: 0, body: null as unknown, req, err: String(e) })),
      ),
    );
    for (const s of scans) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = s as any;
      if (!s.ok || !sb.body?.success) {
        scanErrors.push(`${s.req.label}: ${sb.body?.error || `find-agencies ${s.status}`}`);
        continue;
      }
      agencyLists.push((Array.isArray(sb.body.agencies) ? sb.body.agencies : []) as ScanAgency[]);
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Could not scan your market: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 502 },
    );
  }
  // Dedup by name+office (keep highest set-aside spend), highest spend first — see lib.
  const agencies = mergeScanAgencies(agencyLists as unknown as PureScanAgency[][]) as unknown as ScanAgency[];

  if (agencies.length === 0) {
    // Surface the REAL reason instead of a generic "none found" (the silent failure):
    // every-scan-errored (502) vs genuinely-empty (200) — see emptyScanOutcome.
    const { allFailed, status } = emptyScanOutcome(scanErrors.length, requests.length);
    return NextResponse.json(
      {
        success: false,
        error: allFailed
          ? `Market scan failed: ${scanErrors[0]}`
          : 'No matching buying agencies found for your codes.',
        scanErrors: scanErrors.slice(0, 3),
      },
      { status },
    );
  }

  // 3) ADD-ONLY insert into user_target_list. 23505 (already saved) → skipped.
  const sourceNaics = naicsCodes.join(',') || null;
  let added = 0;
  let skipped = 0;
  const addedNames: string[] = [];
  let insertError: string | null = null;

  for (const a of agencies.slice(0, MAX_AGENCIES)) {
    const rawOfficeName = a.contractingOffice || a.name;
    // DODAAC ingestion guard: the FPDS path can emit a bogus office_code (e.g.
    // "GU22"/"CA09" — postcode-ish junk, NOT a 6-char DoDAAC) and an office name
    // with a stray "/xx" suffix ("Army Sustainment Command/ysk"). Only persist a
    // real DoDAAC, and clean the name — so auto_setup stops saving the garbage the
    // manual-save path would have caught via dodaac_directory enrichment.
    const officeCode = validOfficeCode(a.officeId);
    const officeName = normalizeOfficeName(rawOfficeName, { mode: 'clean' }) || rawOfficeName;
    const payload = {
      user_email: rowEmail,
      workspace_id: asClient ? workspaceId : null,
      agency_code: a.agencyCode || null,
      agency_name: a.name,
      sub_agency_code: a.subAgencyCode || null,
      sub_agency_name: a.subAgency || null,
      office_code: officeCode,
      office_name: officeName,
      location: a.location || null,
      source_naics: sourceNaics,
      // set_aside_spending can be billions — round to a safe integer; clamp so a
      // bigint/int column can't reject the row and fail the whole batch silently.
      set_aside_spending: clampSetAsideSpending(a.setAsideSpending),
      contract_count: Math.round(a.contractCount || 0),
      status: 'targeting',
      priority: 'medium',
      added_from: 'auto_setup',
    };
    const { error } = await getSupabase().from('user_target_list').insert(payload);
    if (!error) {
      added++;
      addedNames.push(a.name);
    } else if (error.code === '23505') {
      skipped++; // already in their list — add-only, leave it
    } else if (!insertError) {
      insertError = error.message; // remember the first real failure
    }
  }

  // If we found agencies but couldn't write ANY (and none were dupes), that's a
  // real failure — surface it instead of a misleading "added 0".
  if (added === 0 && skipped === 0 && insertError) {
    return NextResponse.json(
      { success: false, error: `Found ${agencies.length} agencies but couldn't save them: ${insertError}`, agenciesFound: agencies.length },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    agenciesFound: agencies.length,
    added,
    skipped,
    addedNames,
    surface: 'target-list',
  });
}
