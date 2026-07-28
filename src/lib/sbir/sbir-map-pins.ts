/**
 * SBIR/STTR topics as APPROXIMATE map pins under Open Opportunities (Eric 2026-07-28: "put SBIR under
 * open opps"). SBIR topics have NO place of performance (national R&D topics), so they can't drop a
 * real pin. We plot them at the SPONSORING COMPONENT's HQ — a real, geocoded city — clearly flagged
 * APPROXIMATE (locSrc='office', same honesty flag the office-derived SAM pins use). This shows SBIR on
 * the map alongside SAM/DIBBS without pretending the location is a real place of performance.
 *
 * Reads the cached `dod_sbir_topics` table (filled by the sync cron) — NEVER the rate-limited sbir.gov
 * API. Fail-soft: any error → [] so SBIR never takes down the SAM pins (mirrors the DIBBS integration).
 */
import { createClient } from '@supabase/supabase-js';
import { geocodeCity } from '@/lib/geo/city-geocode';

// Sponsoring component → a REAL HQ city+state (geocoded to real coords, never a guessed lat/lng). Keyed
// on how `branch` appears in the sbir.gov feed. Fallback = the Pentagon (Arlington, VA) for generic DoD.
const BRANCH_HQ: Record<string, { city: string; state: string }> = {
  army: { city: 'Aberdeen', state: 'MD' },          // Army Futures / DEVCOM at Aberdeen Proving Ground
  navy: { city: 'Washington', state: 'DC' },        // NAVSEA / ONR, DC/NCR
  'air force': { city: 'Dayton', state: 'OH' },      // AFRL / Wright-Patterson AFB
  'space force': { city: 'El Segundo', state: 'CA' }, // Space Systems Command
  socom: { city: 'Tampa', state: 'FL' },            // USSOCOM, MacDill AFB
  dtra: { city: 'Fort Belvoir', state: 'VA' },
  mda: { city: 'Huntsville', state: 'AL' },         // Missile Defense Agency, Redstone
  darpa: { city: 'Arlington', state: 'VA' },
  dla: { city: 'Fort Belvoir', state: 'VA' },
  dha: { city: 'Falls Church', state: 'VA' },       // Defense Health Agency
};
const DEFAULT_HQ = { city: 'Arlington', state: 'VA' }; // the Pentagon — generic DoD

function hqFor(branch: string | null): { city: string; state: string } {
  const b = (branch || '').toLowerCase().trim();
  for (const key of Object.keys(BRANCH_HQ)) if (b.includes(key)) return BRANCH_HQ[key];
  return DEFAULT_HQ;
}

export interface SbirMapPin {
  id: string; title: string; agency: string; naics: string; cat: string;
  loc: string; close: string | null; posted: string | null;
  sol: string; uiLink: string | null; lat: number; lng: number;
  src: 'SBIR'; locSrc: 'office'; // 'office' = approximate (branch HQ, not a place of performance)
  set: string; setLabel: string; subAgency: string | null; office: string;
  noticeType: string; docs: boolean; pocs: number; est: number;
}

/**
 * Fetch OPEN DoD SBIR/STTR topics from the cache → approximate map pins. `limit` bounds the set (topics
 * are a few hundred). Returns [] on any error (fail-soft) so SBIR never takes down the SAM pins.
 */
export async function getSbirMapPins(limit = 400): Promise<SbirMapPin[]> {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await sb
      .from('dod_sbir_topics')
      .select('topic_number, title, agency, branch, program, close_date, url, description, status')
      .eq('status', 'open')
      .order('close_date', { ascending: true })
      .limit(limit);
    if (error) { console.error('[sbir-map-pins] read failed (SAM unaffected):', error.message); return []; }

    const seenCity = new Map<string, number>(); // per-HQ jitter seed so co-located topics fan out
    const pins: SbirMapPin[] = [];
    for (const t of data || []) {
      const hq = hqFor(t.branch as string | null);
      const key = `${hq.city}|${hq.state}`;
      const seed = seenCity.get(key) || 0; seenCity.set(key, seed + 1);
      const g = geocodeCity(hq.city, hq.state, seed);
      if (!g) continue; // no real coords → no pin (never fabricate a location)
      const branch = (t.branch as string) || 'DoD';
      pins.push({
        id: `sbir:${t.topic_number}`,
        title: `${t.topic_number} — ${t.title}`,
        agency: `${t.agency || 'DOD'}${branch ? ' / ' + branch : ''}`,
        naics: '', cat: (t.program as string) || 'SBIR',
        loc: `${hq.city}, ${hq.state}`, close: (t.close_date as string) || null, posted: null,
        sol: t.topic_number as string, uiLink: (t.url as string) || null,
        lat: g.lat, lng: g.lng, src: 'SBIR', locSrc: 'office',
        set: 'None', setLabel: 'SBIR/STTR', subAgency: branch, office: branch,
        noticeType: (t.program as string) || 'SBIR', docs: !!t.url, pocs: 0, est: 0,
      });
    }
    return pins;
  } catch (e) {
    console.error('[sbir-map-pins] failed (SAM unaffected):', (e as Error).message);
    return [];
  }
}
