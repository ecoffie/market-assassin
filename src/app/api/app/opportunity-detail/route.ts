/**
 * GET /api/app/opportunity-detail?id=<notice_id>
 *
 * Powers the Opportunity Map detail drawer (the Zillow "home details" equivalent).
 * Returns one opportunity shaped for the drawer's render(), PLUS:
 *  - bidFacts : a clean fact grid (set-aside, NAICS, PSC, deadline, agency/office, POP, docs, POC)
 *  - similar  : a few similar opportunities (same NAICS or agency, nearby) — the flywheel
 *
 * All fields are real columns from sam_opportunities. No fabrication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setGroupKey, SET_LABEL } from '@/lib/opportunities/map-data';
import { buildOppIntel, intelHasContent } from '@/lib/opportunities/opp-intel';
import { extractSowCardFacts, sowCardFactsHasContent, type SowCardFacts } from '@/lib/opportunities/sow-card-facts';
import { logMEstimate } from '@/lib/opportunities/m-estimate-log';
import { decodeFSC, extractNSNs, type FSCDecode } from '@/lib/codes/fsc';
import { longDate as fmtOppDate } from '@/lib/utils/opp-date';
import { getNsnReference } from '@/lib/nsn/reference';
import { formatAgencyDisplay } from '@/lib/mindy/agency-display';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// buildOppIntel now lives in the shared lib (reused by the precompute backfill/cron).

const DETAIL_COLS = 'notice_id, solicitation_number, title, description, naics_code, psc_code, department, sub_tier, office, agency_hierarchy, posted_date, response_deadline, archive_date, synced_at, source, active, set_aside_code, set_aside_description, notice_type, pop_city, pop_state, pop_country, ui_link, attachments, points_of_contact, office_address, has_sow_doc, sow_text, sow_filename, additional_info_link, additional_info_text, map_loc_source, intel_predecessor, intel_agency, intel_pricing, intel_value_range, intel_computed_at';
// sow_card_facts (Tier 1 — brand-name/or-equal flag, eval basis, set-aside-from-text) is
// selected SEPARATELY, not folded into DETAIL_COLS: a single .select() naming a column that
// doesn't exist yet fails the WHOLE query silently ([[postgrest_missing_column_nulls]]), and
// this column's migration (20260726_sow_card_facts.sql) may not be run yet. The second query
// below tries it and degrades to null on ANY error (including 42703 undefined-column) rather
// than risk the whole detail route 500ing pre-migration.
const CARD_FACTS_COL = 'sow_card_facts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeOpp(r: any) {
  const setKey = setGroupKey(r.set_aside_code);
  return {
    id: r.notice_id,
    solicitation: r.solicitation_number || r.notice_id,
    title: r.title,
    naics: r.naics_code,
    psc: r.psc_code,
    // RAW here — internal lookups below (buildOppIntel agency match, the `.eq('department', …)`
    // similar-opps filter) key off the DB value, so cleaning here would break the match. The
    // DISPLAY-cleaned copies are separate fields (department_display / subTier_display) that the
    // drawer renders; the raw stays for matching. (Eric 2026-08-03 — the "DEPT OF DEFENSE" fix.)
    department: r.department,
    subTier: r.sub_tier,
    // Cleaned for display only — SAM stores ALL-CAPS ("DEPT OF DEFENSE"); the open-opp drawer showed
    // it raw while recompete/forecast cleaned theirs. formatAgencyDisplay title-cases, inverts
    // "<BODY>, DEPARTMENT OF" → "Department of <BODY>", and preserves acronyms (U.S., NASA, GSA).
    department_display: formatAgencyDisplay(r.department) || r.department || null,
    subTier_display: formatAgencyDisplay(r.sub_tier) || r.sub_tier || null,
    office: r.office || (r.office_address && r.office_address.city) || null,
    noticeType: r.notice_type,
    setAsideLabel: r.set_aside_description || (r.set_aside_code ? (SET_LABEL[setKey] || r.set_aside_code) : ''),
    deadline: r.response_deadline ? String(r.response_deadline).slice(0, 10) : null,
    posted: r.posted_date ? String(r.posted_date).slice(0, 10) : null,
    // Data-freshness + provenance (the Zillow "last checked · Source" line). syncedAt is the full
    // ISO timestamp so the client can render a relative "updated 3 hours ago". source defaults to SAM.
    syncedAt: r.synced_at || r.updated_at || null,
    source: (r.source && /^sam/i.test(r.source)) ? 'SAM.gov' : (r.source || 'SAM.gov'),
    active: r.active !== false, // treat null as active (don't imply archived on a missing flag)
    location: {
      city: r.pop_city || (r.office_address && r.office_address.city) || null,
      state: r.pop_state || (r.office_address && r.office_address.state) || null,
      country: r.pop_country || null,
      source: r.map_loc_source || (r.pop_state ? 'pop' : 'office'),
    },
    synopsis: r.description || null,
    sow: (r.sow_text ? { text: r.sow_text, filename: r.sow_filename || null } : null),
    contacts: Array.isArray(r.points_of_contact) ? r.points_of_contact : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    additionalInfo: (r.additional_info_link || r.additional_info_text)
      ? { link: r.additional_info_link || null, text: r.additional_info_text || null } : null,
    uiLink: r.ui_link || null,
  };
}

export interface NSNDecodeResult {
  nsn: string;
  fsc: string;
  fscTitle: string;
  fsg: string;
  fsgTitle: string;
}

/**
 * Find NSNs in the opp's title/description/SOW text and decode their FSC/FSG class
 * (Phase 1 of the Federal Code Glossary — see docs/strategy/PRD-nsn-part-number-codify.md).
 * Pure, synchronous, no DB write — safe to run on every detail request. Caps at 5 distinct
 * NSNs (a DLA parts-buy notice can list dozens; this is a "what am I looking at" surface,
 * not an exhaustive parts list).
 */
function decodeNSNsInOpp(opp: { title: string | null; synopsis: string | null; sow: { text: string } | null }): NSNDecodeResult[] {
  const text = [opp.title, opp.synopsis, opp.sow?.text].filter(Boolean).join(' \n ');
  const nsns = extractNSNs(text);
  const out: NSNDecodeResult[] = [];
  const seenFsc = new Set<string>();
  for (const nsn of nsns) {
    const decoded: FSCDecode | null = decodeFSC(nsn);
    if (!decoded) continue;
    // One row per distinct FSC (not per NSN) — several NSNs in the same class is common
    // (a parts list) and repeating the identical decode line adds noise, not signal.
    if (seenFsc.has(decoded.fsc)) continue;
    seenFsc.add(decoded.fsc);
    out.push({ nsn, fsc: decoded.fsc, fscTitle: decoded.fscTitle, fsg: decoded.fsg, fsgTitle: decoded.fsgTitle });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Read (or compute + self-warm) SOW card facts for one opp. Kept OFF the main DETAIL_COLS
 * query (see the comment above CARD_FACTS_COL) — this is a small separate query, tolerant of
 * the column not existing yet (pre-migration), which returns null rather than surfacing an
 * error to the caller (this is a supplementary fact block, not the core opp detail).
 */
async function fetchCardFacts(
  db: ReturnType<typeof sb>,
  noticeId: string,
  sowText: string | null,
  setAsideCode: string | null,
): Promise<SowCardFacts | null> {
  const { data, error } = await db.from('sam_opportunities')
    .select(`${CARD_FACTS_COL}, sow_card_facts_computed_at`)
    .eq('notice_id', noticeId).limit(1).maybeSingle();
  if (error || !data) return null; // column not migrated yet, or a transient error — degrade silently
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  if (row.sow_card_facts_computed_at) return row.sow_card_facts || null;
  // Not precomputed yet (new opp ahead of the cron/backfill) → compute live + self-warm, same
  // pattern as the intel block below. Only worth it when there's real SOW text to extract from.
  if (!sowText || sowText.length <= 200) return null;
  try {
    const facts = await extractSowCardFacts(sowText, setAsideCode);
    if (sowCardFactsHasContent(facts)) {
      db.from('sam_opportunities')
        .update({ sow_card_facts: facts, sow_card_facts_computed_at: new Date().toISOString() })
        .eq('notice_id', noticeId).then(() => {}, () => {});
    }
    return facts;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

  const db = sb();
  // Match on notice_id first, then solicitation_number (cards may carry either).
  let { data, error } = await db.from('sam_opportunities').select(DETAIL_COLS).eq('notice_id', id).limit(1).maybeSingle();
  if (!data && !error) {
    ({ data, error } = await db.from('sam_opportunities').select(DETAIL_COLS).eq('solicitation_number', id).limit(1).maybeSingle());
  }
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // DLA/DIBBS FALLBACK (Eric 2026-07-31): DLA supply bids live in dibbs_rfqs, NOT sam_opportunities,
  // so clicking a DLA pin on the map opened the drawer to "Couldn't load this opportunity" (this route
  // 404'd — the id is a DIBBS solicitation_number, not a SAM notice_id). If the SAM lookup missed, try
  // dibbs_rfqs and return a shaped DLA detail. DLA bids have no SAM intel/similar/roster, so we return
  // the focused detail directly (the drawer renders what's present + hides empty sections).
  if (!data) {
    const { data: dla, error: dlaErr } = await db.from('dibbs_rfqs')
      .select('solicitation_number, nsn, fsc, description, quantity, unit_of_issue, return_by_date, buyer, status, url, pdf_url, synced_at, map_office, map_loc, raw')
      .eq('solicitation_number', id).limit(1).maybeSingle();
    if (dlaErr) return NextResponse.json({ success: false, error: dlaErr.message }, { status: 500 });
    if (dla) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = dla as any;
      const raw = d.raw || {};
      const opp = {
        id: d.solicitation_number,
        solicitation: d.solicitation_number,
        title: d.description || d.solicitation_number,
        naics: null, psc: d.fsc || null,   // DLA is FSC-coded, not NAICS
        department: 'Defense Logistics Agency', subTier: d.buyer || raw.buyerCode || 'DLA',
        office: d.map_office || d.buyer || null,
        noticeType: 'RFQ',
        setAsideLabel: '',
        deadline: d.return_by_date ? String(d.return_by_date).slice(0, 10) : null,
        posted: null,
        syncedAt: d.synced_at || null,
        source: 'DLA DIBBS',
        active: (d.status || '').toLowerCase() !== 'closed',
        location: { city: null, state: null, country: 'USA', source: 'office' },
        synopsis: [d.description, d.nsn ? `NSN ${d.nsn}` : null, d.quantity ? `Qty ${d.quantity}${d.unit_of_issue ? ' ' + d.unit_of_issue : ''}` : null].filter(Boolean).join(' · ') || null,
        sow: null, contacts: [], attachments: [],
        additionalInfo: null,
        uiLink: d.url || d.pdf_url || null,
        // ── DLA-specific bid fields (drive the DLA drawer + the price-to-quote helper) ──
        isDla: true,
        nsn: d.nsn || null, fsc: d.fsc || null,
        quantity: d.quantity ?? null, unitOfIssue: d.unit_of_issue || null,
        purchaseRequest: raw.purchaseRequest || null,   // the DLA PR number
        buyerCode: d.buyer || raw.buyerCode || null,
        dibbsUrl: d.url || null,                          // the RFQ page (quote here)
        pdfUrl: d.pdf_url || raw.pdfUrl || null,          // the RFQ PDF (the "spec")
      };
      // DLA bids carry no SAM-style intel/similar/roster — return the focused detail with EMPTY
      // arrays for those sections (so the drawer client never hits undefined; empty sections collapse).
      // NSN decode IS useful for a DLA parts buy — compute it from the description/NSN.
      const nsnDecodes = decodeNSNsInOpp(opp);
      // NSN Intelligence Layer: DLA PUB LOG / FLIS reference (item name + govt reference unit price
      // + manufacturer part numbers). Honest {grounded,degraded} — null-grounded on a genuine miss,
      // never fabricated. Drives the drawer's "DLA reference: $X" price anchor + part#/maker.
      const nsnReference = await getNsnReference(d.nsn || null);
      return NextResponse.json({ success: true, opp, bidFacts: null, similar: [], nsnDecodes, nsnReference, trackingCount: 0, source: 'dibbs' });
    }
    return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  }

  const opp = shapeOpp(data);
  // FSC/FSG decode (Federal Code Glossary Phase 1) — cheap + synchronous, computed on every
  // request (title/description/SOW text are already in hand from DETAIL_COLS).
  const nsnDecodes = decodeNSNsInOpp(opp);

  // ?intel=1 → the reused-intelligence block. READ the precomputed columns first (instant);
  // only fall back to live tools when this opp hasn't been computed yet — and self-warm by
  // storing the result so the next open is instant too. (The backfill/cron precompute the rest.)
  if (request.nextUrl.searchParams.get('intel') === '1') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = data as any;
    // SOW card facts — fetched/computed independently of the intel_computed_at cursor above
    // (own column, own cursor, own migration) so it works regardless of which precompute has
    // run for this opp. Degrades to null on any error (pre-migration, transient, etc).
    const cardFacts = await fetchCardFacts(db, opp.id, opp.sow?.text || null, row.set_aside_code || null);
    if (row.intel_computed_at) {
      const cachedRange = row.intel_value_range as { low: number; median: number; high: number; source?: string } | null | undefined;
      // M-Estimate learning loop (Phase 0) — append-only snapshot of the range served
      // to this request. Best-effort, non-blocking; see src/lib/opportunities/m-estimate-log.ts.
      if (cachedRange) {
        logMEstimate({
          noticeId: opp.id,
          solicitationNumber: opp.solicitation || null,
          naics: opp.naics || null,
          agency: opp.department || null,
          subAgency: opp.subTier || null,
          ourLow: cachedRange.low ?? null,
          ourMedian: cachedRange.median ?? null,
          ourHigh: cachedRange.high ?? null,
          source: cachedRange.source || null,
        }).catch(() => {});
      }
      return NextResponse.json({ success: true, cached: true, intel: {
        predecessor: row.intel_predecessor || null,
        agency: row.intel_agency || null,
        pricing: row.intel_pricing || null,
        valueRange: row.intel_value_range || null,
      }, cardFacts });
    }
    // Not precomputed yet → compute live, return it, and store it (best-effort). The value_range
    // column may not exist yet (hand-run migration) — store it separately so a missing column
    // doesn't drop the rest of the intel write.
    const intel = await buildOppIntel(opp.naics, opp.department, opp.title, undefined, opp.subTier || null);
    if (intelHasContent(intel)) {
      db.from('sam_opportunities').update({
        intel_predecessor: intel.predecessor, intel_agency: intel.agency,
        intel_pricing: intel.pricing, intel_computed_at: new Date().toISOString(),
      }).eq('notice_id', opp.id).then(() => {}, () => {});
      if (intel.valueRange) {
        db.from('sam_opportunities').update({ intel_value_range: intel.valueRange }).eq('notice_id', opp.id).then(() => {}, () => {});
      }
    }
    // M-Estimate learning loop (Phase 0) — same append-only snapshot for the live-compute path.
    if (intel.valueRange) {
      logMEstimate({
        noticeId: opp.id,
        solicitationNumber: opp.solicitation || null,
        naics: opp.naics || null,
        agency: opp.department || null,
        subAgency: opp.subTier || null,
        ourLow: intel.valueRange.low ?? null,
        ourMedian: intel.valueRange.median ?? null,
        ourHigh: intel.valueRange.high ?? null,
        source: intel.valueRange.source || null,
      }).catch(() => {});
    }
    return NextResponse.json({ success: true, cached: false, intel, cardFacts });
  }

  // Bid Facts — the "Facts & features" grid. All real columns.
  const bidFacts = [
    { k: 'Set-aside', v: opp.setAsideLabel || 'Open (unrestricted)' },
    { k: 'NAICS', v: opp.naics || '—' },
    { k: 'PSC', v: opp.psc || '—' },
    { k: 'Notice type', v: opp.noticeType || '—' },
    { k: 'Response due', v: fmtOppDate(opp.deadline) },
    { k: 'Posted', v: fmtOppDate(opp.posted) },
    { k: 'Agency', v: opp.department || '—' },
    { k: 'Sub-agency', v: opp.subTier || '—' },
    { k: 'Place of performance', v: [opp.location.city, opp.location.state || opp.location.country].filter(Boolean).join(', ') || '—' },
    { k: 'Documents', v: opp.attachments.length ? `${opp.attachments.length} attachment${opp.attachments.length > 1 ? 's' : ''}` : (data.has_sow_doc ? 'SOW on file' : 'None posted') },
    { k: 'Contacts', v: opp.contacts.length ? `${opp.contacts.length} listed` : 'None listed' },
    { k: 'Solicitation #', v: opp.solicitation || '—' },
  ];
  // Surface the first decoded NSN class inline in the fact grid (e.g. "2915 — Engine Fuel
  // System Components Aircraft"); the full list (up to 5) still ships as `nsnDecodes` below
  // for a richer UI treatment (tooltip/badge per NSN) without re-deriving it client-side.
  if (nsnDecodes.length > 0) {
    bidFacts.push({
      k: 'NSN item class',
      v: `${nsnDecodes[0].fsc} — ${nsnDecodes[0].fscTitle}${nsnDecodes.length > 1 ? ` (+${nsnDecodes.length - 1} more)` : ''}`,
    });
  }

  // Similar opportunities (the flywheel) — same NAICS 3-digit subsector OR same agency,
  // active, not this one, deadline soonest. Real opps only.
  const nowIso = new Date().toISOString();
  let simQ = db.from('sam_opportunities')
    .select('notice_id, title, department, naics_code, set_aside_code, response_deadline, pop_state, pop_city')
    .eq('active', true).gt('response_deadline', nowIso)
    .neq('notice_id', opp.id)
    .order('response_deadline', { ascending: true })
    .limit(6);
  if (opp.naics) simQ = simQ.like('naics_code', `${String(opp.naics).slice(0, 3)}%`);
  else if (opp.department) simQ = simQ.eq('department', opp.department);
  const { data: sim } = await simQ;
  const similar = (sim || []).slice(0, 5).map((s: Record<string, unknown>) => ({
    id: s.notice_id,
    title: s.title,
    agency: s.department,
    naics: s.naics_code,
    setAside: s.set_aside_description || (s.set_aside_code ? (SET_LABEL[setGroupKey(s.set_aside_code as string)] || s.set_aside_code) : ''),
    deadline: s.response_deadline ? String(s.response_deadline).slice(0, 10) : null,
    location: [s.pop_city, s.pop_state].filter(Boolean).join(', '),
  }));

  // Activity signal (the Zillow "N saves" analog): how many contractors are tracking THIS notice in
  // their pipeline. A real competition/popularity tell, not vanity. DISTINCT users, non-archived.
  // Fail-soft: on any error → null (the client shows the stat only when it's a real count ≥2, so a
  // null or a 0/1 simply omits it — never "0 tracking this", which reads worse than nothing).
  let trackingCount: number | null = null;
  try {
    const { count, error: tcErr } = await db
      .from('user_pipeline')
      .select('user_email', { count: 'exact', head: true })
      .eq('notice_id', opp.id)
      .eq('is_archived', false);
    if (!tcErr) trackingCount = count ?? 0;
  } catch { /* fail-soft — trackingCount stays null */ }

  return NextResponse.json({ success: true, opp, bidFacts, similar, nsnDecodes, trackingCount });
}
