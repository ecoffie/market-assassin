/**
 * Seed My Target List (user_target_list) from the user's HAND-PICKED target
 * agencies (user_notification_settings.agencies).
 *
 * The gap this closes: a user picks target agencies in onboarding / profile, but
 * those only drove view filters — they never appeared in My Target List (which only
 * filled from the "✨ Set up my Mindy" NAICS-buyer scan). Expectation mismatch
 * (Eric, coffiemiami test).
 *
 * ENRICHED-ONLY (Eric, Jun 28): for each chosen agency, add its actual BUYING
 * OFFICES that match the user's NAICS (enriched with spend/contacts, reusing the
 * same find-agencies scan auto-setup uses). An agency that buys NOTHING in the
 * user's codes is SKIPPED — irrelevant buyers (e.g. VA/HHS for a drone maker)
 * should not clutter the list (was: a bare department-level fallback row).
 *
 * Principles (mirrors auto-setup, memory: simplify-not-complicate):
 *   - Reuses EXISTING pieces (find-agencies scan, user_target_list). No new tables.
 *   - ADD-ONLY. The table's UNIQUE (user_email, office_name) returns 23505 on a row
 *     the user already has → counted as "skipped", never overwritten. Sport-mode /
 *     auto-setup / hand-added rows always survive.
 *   - Best-effort + non-blocking: the caller must not fail the profile save if this
 *     errors. Imperfect agency-name matching degrades gracefully to a bare row.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any;

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

/** Normalize an agency name for fuzzy matching: lowercase, strip punctuation and
 *  the boilerplate words that differ between a picker label and a scan result. */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\b(department|dept|of|the|u\.?s\.?|united states|office|agency|administration)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A scan agency belongs to a chosen agency if either normalized name contains the
 *  other (catches "Navy" → "Department of the Navy" / its sub-agencies/offices). */
function matchesChosen(scan: ScanAgency, chosenNorm: string): boolean {
  if (!chosenNorm) return false;
  for (const candidate of [scan.parentAgency, scan.name, scan.subAgency]) {
    const c = norm(String(candidate || ''));
    if (!c) continue;
    if (c === chosenNorm || c.includes(chosenNorm) || chosenNorm.includes(c)) return true;
  }
  return false;
}

const MAX_CHOSEN = 15;            // cap how many picked agencies we process
const MAX_OFFICES_PER_AGENCY = 15; // top buying offices per chosen agency (by spend)
const MAX_NAICS_SCAN = 12;        // scan up to this many of the user's NAICS codes

export async function seedTargetListFromAgencies(opts: {
  supabase: Supabase;
  base: string;                 // internalBaseUrl(request)
  rowEmail: string;
  workspaceId: string | null;
  asClient: boolean;
  naicsCodes: string[];
  states: string[];
  chosenAgencies: string[];
}): Promise<{ added: number; skipped: number; dropped: number }> {
  const { supabase, base, rowEmail, workspaceId, asClient, naicsCodes, states } = opts;
  const chosen = (opts.chosenAgencies || []).map((a) => String(a).trim()).filter(Boolean).slice(0, MAX_CHOSEN);
  if (chosen.length === 0) return { added: 0, skipped: 0, dropped: 0 };

  // 1) Scan buying agencies across the user's NAICS (same call auto-setup uses —
  //    find-agencies needs no MI session and returns the fields we map). We scan
  //    ALL the user's codes (bounded) so a chosen agency surfaces every office that
  //    buys ANY of their work, not just the top-3 codes.
  const byKey = new Map<string, ScanAgency>();
  const codesToScan = (naicsCodes || []).map(String).filter(Boolean).slice(0, MAX_NAICS_SCAN);
  if (codesToScan.length > 0) {
    try {
      const scans = await Promise.all(
        codesToScan.map((code) =>
          fetch(`${base}/api/usaspending/find-agencies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ naicsCode: code, ...(states.length ? { locationStates: states } : {}) }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      );
      for (const body of scans) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = body as any;
        if (!b?.success || !Array.isArray(b.agencies)) continue;
        for (const a of b.agencies as ScanAgency[]) {
          const key = `${(a.name || '').toLowerCase()}|${(a.contractingOffice || '').toLowerCase()}`;
          const prev = byKey.get(key);
          if (!prev || (a.setAsideSpending || 0) > (prev.setAsideSpending || 0)) byKey.set(key, a);
        }
      }
    } catch { /* non-fatal — fall through to bare rows */ }
  }
  const scanAgencies = Array.from(byKey.values()).sort(
    (x, y) => (y.setAsideSpending || 0) - (x.setAsideSpending || 0),
  );

  const sourceNaics = naicsCodes.join(',') || null;
  let dropped = 0;

  // 2) For each chosen agency, collect its matching buying offices (enriched, top
  //    by spend). An agency with NO matching offices (buys nothing in the user's
  //    codes) is skipped entirely — no clutter from irrelevant buyers. Dedup by
  //    office_name (the table's unique key) so each office is inserted once.
  const seenOffice = new Set<string>();
  const payloads: RowPayload[] = [];
  for (const chosenName of chosen) {
    const chosenNorm = norm(chosenName);
    const offices = scanAgencies
      .filter((a) => matchesChosen(a, chosenNorm))
      .slice(0, MAX_OFFICES_PER_AGENCY);

    if (offices.length === 0) { dropped++; continue; }

    for (const a of offices) {
      const officeName = a.contractingOffice || a.name;
      const key = officeName.toLowerCase();
      if (seenOffice.has(key)) continue;
      seenOffice.add(key);
      payloads.push({
        rowEmail, workspaceId, asClient, sourceNaics,
        agency_name: a.name,
        office_name: officeName,
        agency_code: a.agencyCode || null,
        sub_agency_code: a.subAgencyCode || null,
        sub_agency_name: a.subAgency || null,
        office_code: a.officeId || null,
        location: a.location || null,
        set_aside_spending: Math.min(Math.round(a.setAsideSpending || 0), 9_000_000_000),
        contract_count: Math.round(a.contractCount || 0),
      });
    }
  }

  // Insert all in parallel (add-only; each 23505 = already saved).
  const results = await Promise.all(payloads.map((p) => insertRow(supabase, p)));
  const added = results.filter((r) => r === 'added').length;
  const skipped = results.filter((r) => r === 'skipped').length;

  return { added, skipped, dropped };
}

interface RowPayload {
  rowEmail: string; workspaceId: string | null; asClient: boolean; sourceNaics: string | null;
  agency_name: string; office_name: string; agency_code: string | null;
  sub_agency_code: string | null; sub_agency_name: string | null; office_code: string | null;
  location: string | null; set_aside_spending: number; contract_count: number;
}

async function insertRow(
  supabase: Supabase,
  f: RowPayload,
): Promise<'added' | 'skipped' | 'error'> {
  const { error } = await supabase.from('user_target_list').insert({
    user_email: f.rowEmail,
    workspace_id: f.asClient ? f.workspaceId : null,
    agency_code: f.agency_code,
    agency_name: f.agency_name,
    sub_agency_code: f.sub_agency_code,
    sub_agency_name: f.sub_agency_name,
    office_code: f.office_code,
    office_name: f.office_name,
    location: f.location,
    source_naics: f.sourceNaics,
    set_aside_spending: f.set_aside_spending,
    contract_count: f.contract_count,
    status: 'targeting',
    priority: 'medium',
    added_from: 'profile_agency',
  });
  if (!error) return 'added';
  if (error.code === '23505') return 'skipped'; // already in their list — add-only
  return 'error';
}
