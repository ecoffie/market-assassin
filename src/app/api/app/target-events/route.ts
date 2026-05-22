/**
 * /api/app/target-events — Event Radar for the user's saved target list.
 *
 * Slice 4 of the Target Market Research roadmap. The strategic moat
 * lives here: "AI plus your saved target list builds federal BD
 * relationships over 12-18 months." This endpoint surfaces upcoming
 * industry days, RFIs, webinars, and major annual conferences that
 * match each office in the user's saved target list — so the user
 * knows where to physically (or virtually) meet decision-makers.
 *
 * Data sources joined:
 *   1. sam_events table (cron-populated daily from SAM.gov Special
 *      Notices — see tasks/PRD-federal-events-database.md)
 *   2. src/data/federal-events-sources.json (static catalog of
 *      30 event series + 12 major annual conferences)
 *
 * Matching strategy:
 *   - For each saved target, build a set of agency-name variants
 *     using the agency-aliases JSON ("Department of the Air Force"
 *     → ["Air Force", "USAF", "Department of the Air Force", "DAF"])
 *   - Match against sam_events.agency (free-text field)
 *   - Match against eventSources[].agencies and conferences[].audience
 *
 * Returns: { events_by_target: Record<target_id, EventCard[]> }
 *
 * Pro-gated. Free users get 402 (target lists are Pro-only anyway,
 * but defense-in-depth).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import eventsStaticData from '@/data/federal-events-sources.json';
import agencyAliasesData from '@/data/agency-aliases.json';

const EVENT_HORIZON_DAYS = 90;

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

// --- Types --------------------------------------------------------

interface TargetRow {
  id: string;
  agency_name: string;
  sub_agency_name: string | null;
  office_name: string;
}

interface EventCard {
  source: 'sam' | 'static_series' | 'static_conference';
  title: string;
  event_type: string;
  event_date: string | null;   // YYYY-MM-DD when known
  location: string | null;
  url: string | null;
  description: string | null;
  matched_agency: string;      // which alias triggered the match
}

interface StaticEventSource {
  name: string;
  url: string;
  type: string;
  frequency?: string;
  categories?: string[];
  agencies?: string[];
  notes?: string;
}

interface StaticConference {
  name: string;
  typical_month: string;
  location: string;
  audience: string;
  url?: string;
  registration_cost?: string;
  value?: string;
}

// --- Agency-name variant builder ---------------------------------
//
// Build a Set of every name we'd reasonably search for given an
// agency. Pulls from:
//   - The raw agency_name + sub_agency_name from the target
//   - agency-aliases.json reverse-lookup
//
// Returns a Set so callers can do .has() / .forEach() cheaply.
function buildAgencyVariants(target: TargetRow): Set<string> {
  const variants = new Set<string>();
  const raw = [target.agency_name, target.sub_agency_name].filter(Boolean) as string[];
  const aliases = (agencyAliasesData as { aliases: Record<string, string> }).aliases || {};

  for (const name of raw) {
    if (!name) continue;
    const trimmed = name.trim();
    variants.add(trimmed);
    variants.add(trimmed.toLowerCase());

    // Reverse-lookup: agency-aliases.json maps short → canonical
    // ("DAF" → "Department of the Air Force"). For each entry that
    // maps TO our agency, add the short form. That way "Department
    // of the Air Force" matches events tagged "Air Force" / "DAF".
    for (const [short, canonical] of Object.entries(aliases)) {
      if (canonical.toLowerCase() === trimmed.toLowerCase()) {
        variants.add(short);
        variants.add(short.toLowerCase());
      }
      // Also: if our raw name IS a short alias, add the canonical.
      if (short.toLowerCase() === trimmed.toLowerCase()) {
        variants.add(canonical);
        variants.add(canonical.toLowerCase());
      }
    }

    // Drop "Department of " / "the " prefixes for looser matching.
    // "Department of Defense" → "Defense" so we can catch events
    // tagged "DOD" / "Defense" / "DoD".
    const stripped = trimmed.replace(/^(department of|the)\s+/i, '').trim();
    if (stripped && stripped !== trimmed) {
      variants.add(stripped);
      variants.add(stripped.toLowerCase());
    }
  }

  return variants;
}

// Check whether ANY name in the variants set is a substring match
// against the candidate field. Case-insensitive, substring (not
// equality) so "DOD" matches "DOD Industry Day at Pentagon."
function variantMatches(candidate: string | null | undefined, variants: Set<string>): string | null {
  if (!candidate) return null;
  const lower = candidate.toLowerCase();
  for (const v of variants) {
    if (!v || v.length < 2) continue;
    if (lower.includes(v.toLowerCase())) return v;
  }
  return null;
}

// --- Endpoint -----------------------------------------------------

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }

  // Pro gate. Belt + suspenders since target-list itself is Pro.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      {
        upgrade_required: true,
        message: 'Event Radar is included with Mindy Pro',
      },
      { status: 402 }
    );
  }

  try {
    const supabase = getSupabase();
    const lowerEmail = email.toLowerCase();

    // Load the user's saved target list.
    const { data: targets, error: tErr } = await supabase
      .from('user_target_list')
      .select('id, agency_name, sub_agency_name, office_name')
      .eq('user_email', lowerEmail);

    if (tErr) {
      console.error('[target-events] target list query failed:', tErr);
      return NextResponse.json({ error: tErr.message, code: tErr.code }, { status: 500 });
    }

    if (!targets || targets.length === 0) {
      return NextResponse.json({
        success: true,
        events_by_target: {},
        target_count: 0,
        message: 'No saved targets — events appear here once you save offices from Market Research.',
      });
    }

    // Pull all upcoming sam_events for the next horizon window in
    // one query. We'll match per-target in memory; doing 1 query
    // instead of N keeps cost flat regardless of target list size.
    const today = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + EVENT_HORIZON_DAYS);

    const { data: samEventsAll, error: eErr } = await supabase
      .from('sam_events')
      .select('notice_id, title, event_type, agency, event_date, event_location, description, registration_url, source_notice_type')
      .gte('event_date', today.toISOString().slice(0, 10))
      .lte('event_date', horizon.toISOString().slice(0, 10))
      .order('event_date', { ascending: true });

    if (eErr) {
      console.warn('[target-events] sam_events query soft-failed:', eErr);
      // Don't 500 — we can still return static catalog matches.
    }

    const sources = ((eventsStaticData as unknown) as {
      eventSources?: Record<string, StaticEventSource>;
      majorAnnualConferences?: StaticConference[];
    });
    const staticSourceList = Object.values(sources.eventSources || {});
    const staticConferenceList = sources.majorAnnualConferences || [];

    // Build events per target.
    const eventsByTarget: Record<string, EventCard[]> = {};

    for (const target of targets as TargetRow[]) {
      const variants = buildAgencyVariants(target);
      const events: EventCard[] = [];
      const seen = new Set<string>(); // de-dupe by title within target

      // 1) sam_events (cron-populated SAM Special Notices)
      for (const row of (samEventsAll || [])) {
        const matched = variantMatches(row.agency, variants);
        if (!matched) continue;
        const key = `sam:${row.notice_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
          source: 'sam',
          title: row.title,
          event_type: row.event_type || 'event',
          event_date: row.event_date,
          location: row.event_location,
          url: row.registration_url,
          description: row.description,
          matched_agency: matched,
        });
      }

      // 2) Static event sources (AFCEA, SAME, GSA Interact, etc.)
      // These are recurring series, not date-stamped events. We
      // surface them as "ongoing" entries so the user knows where
      // to look for upcoming events in this series.
      for (const src of staticSourceList) {
        const matched = (src.agencies || [])
          .map(a => variantMatches(a, variants))
          .find(Boolean);
        if (!matched) continue;
        const key = `series:${src.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
          source: 'static_series',
          title: src.name,
          event_type: src.type || 'event_series',
          event_date: null,            // ongoing
          location: null,
          url: src.url,
          description: src.notes || (src.frequency ? `${src.frequency} — check calendar for upcoming dates.` : null),
          matched_agency: matched,
        });
      }

      // 3) Major annual conferences (AFCEA TechNet, SAME FSBC, etc.)
      // Match against the audience field since these aren't tagged
      // with structured agency arrays — audience strings like
      // "Navy/Marine Corps IT contractors" carry the signal.
      for (const conf of staticConferenceList) {
        const audienceMatch = variantMatches(conf.audience, variants);
        const valueMatch = variantMatches(conf.value, variants);
        const matched = audienceMatch || valueMatch;
        if (!matched) continue;
        const key = `conf:${conf.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
          source: 'static_conference',
          title: conf.name,
          event_type: 'conference',
          event_date: null,            // typical_month only; not exact
          location: conf.location,
          url: conf.url || null,
          description: [
            `${conf.typical_month} (annual)`,
            conf.value,
            conf.registration_cost ? `Reg: ${conf.registration_cost}` : null,
          ].filter(Boolean).join(' · '),
          matched_agency: matched,
        });
      }

      // Sort within target: dated events first (by date), then
      // ongoing series, then annual conferences alphabetically.
      events.sort((a, b) => {
        if (a.event_date && b.event_date) return a.event_date.localeCompare(b.event_date);
        if (a.event_date && !b.event_date) return -1;
        if (!a.event_date && b.event_date) return 1;
        return a.title.localeCompare(b.title);
      });

      eventsByTarget[target.id] = events;
    }

    return NextResponse.json({
      success: true,
      events_by_target: eventsByTarget,
      target_count: targets.length,
      horizon_days: EVENT_HORIZON_DAYS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[target-events] threw:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
