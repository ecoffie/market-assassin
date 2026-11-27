/**
 * Cache-only company identity resolution for Ask Mindy research (Eric, 2026-11-25: "we have sam cache no need to make
 * live calls"). Reads ONLY Mindy's `sam_entities` mirror (~910K registrations). Zero live SAM calls.
 *
 * The research workflow (Agent 1) supplies clues from a typed name or a pasted screenshot plus web research: a name
 * (legal or trading), a UEI, a state, a city, a website. This returns every candidate with the fields that decide
 * between them, never a single best guess when more than one fits. Agent 1 decides whether to ask the customer.
 *
 * Rules:
 *   - A UEI is authoritative: found or none_found by UEI alone, other clues only annotate.
 *   - Names match WHOLE WORDS against the legal AND the DBA name (entity-local-fallback localNameFilters), legal
 *     suffixes ignored; state narrows in the query, city after it.
 *   - A website matches the registration's own SAM entityURL by domain. Only where the mirror holds it: most rows
 *     carry none today (see PR notes), and a missing website is never evidence against a candidate.
 *   - `unavailable` means the cache could not be read. It is never "not registered".
 *   - Every candidate carries `as_of` (the row's synced_at): a cached registration, not a live check.
 */
import type { SAMEntity } from '@/lib/sam/entity-api';
import {
  lookupLocalEntitiesByName,
  lookupLocalEntitiesByWebsite,
  lookupLocalEntityByUEI,
  type LocalEntityHit,
} from '@/lib/sam/entity-local-fallback';

export interface EntityClues {
  uei?: string | null;
  /** Legal OR trading (DBA) name; both columns are searched. */
  name?: string | null;
  /** 2-letter state. */
  state?: string | null;
  city?: string | null;
  /** Website URL or bare domain ("efsdigital.com", "https://www.efsdigital.com/about"). */
  website?: string | null;
}

export type MatchOn = 'uei' | 'legal_name' | 'dba_name' | 'website';

export interface EntityCandidate {
  uei: string;
  cage: string | null;
  legal_name: string;
  dba_name: string | null;
  address: { city: string | null; state: string | null; zip: string | null; country: string | null };
  website: string | null;
  registration_status: SAMEntity['registrationStatus'];
  registration_expiry: string | null;
  primary_naics: string | null;
  /** Which clues this candidate satisfies (a UEI or website hit is stronger evidence than a name). */
  match_on: MatchOn[];
  /** The clue fields this candidate CONTRADICTS (e.g. a different state than the screenshot showed). */
  conflicts: Array<'state' | 'city' | 'website'>;
  sam_url: string;
  /** When this row was last refreshed from SAM. A cached registration, not a live check. */
  as_of: string | null;
}

export interface EntityResolution {
  status: 'found' | 'ambiguous' | 'none_found' | 'unavailable';
  candidates: EntityCandidate[];
  /** The source and what was checked, for the answer's provenance line. */
  checked: Array<{ by: 'uei' | 'name' | 'website'; status: 'ok' | 'unavailable'; hits: number }>;
  note: string;
}

/** "https://www.EFSdigital.com/about?x" → "efsdigital.com". Null when nothing domain-like remains. */
export function websiteDomain(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase();

function toCandidate(h: LocalEntityHit, clues: EntityClues, match_on: MatchOn[]): EntityCandidate {
  const e = h.entity;
  const state = e.physicalAddress?.stateOrProvince || null;
  const city = e.physicalAddress?.city || null;
  const site = e.entityUrl || null;
  const conflicts: EntityCandidate['conflicts'] = [];
  if (clues.state && state && norm(clues.state) !== norm(state)) conflicts.push('state');
  if (clues.city && city && norm(clues.city) !== norm(city)) conflicts.push('city');
  const want = websiteDomain(clues.website);
  const have = websiteDomain(site);
  if (want && have) {
    if (want === have) { if (!match_on.includes('website')) match_on.push('website'); } else conflicts.push('website');
  }
  return {
    uei: e.ueiSAM,
    cage: e.cageCode || null,
    legal_name: e.legalBusinessName,
    dba_name: e.dbaName || null,
    address: { city, state, zip: e.physicalAddress?.zipCode || null, country: e.physicalAddress?.countryCode || null },
    website: site,
    registration_status: e.registrationStatus,
    registration_expiry: e.registrationExpirationDate || null,
    primary_naics: e.primaryNaics || null,
    match_on,
    conflicts,
    sam_url: `https://sam.gov/entity/${e.ueiSAM}`,
    as_of: h.asOf,
  };
}

/** Which name column(s) a hit satisfied, by the same whole-word rule the query used. */
function nameMatchOn(e: SAMEntity, name: string): MatchOn[] {
  const words = name.toUpperCase().replace(/\b(INCORPORATED|INC|LLC|L\.L\.C\.?|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|LP|LLP|PLLC)\b/g, ' ')
    .split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const re = new RegExp(`\\b${words.join('[^A-Z0-9]+')}\\b`);
  const out: MatchOn[] = [];
  if (re.test(norm(e.legalBusinessName))) out.push('legal_name');
  if (e.dbaName && re.test(norm(e.dbaName))) out.push('dba_name');
  return out;
}

async function byWebsite(domain: string, limit: number): Promise<{ status: 'ok' | 'unavailable'; hits: LocalEntityHit[] }> {
  const looked = await lookupLocalEntitiesByWebsite(domain, limit);
  if (looked.status === 'unavailable') return { status: 'unavailable', hits: [] };
  // Exact host only: efsdigital.com never matches notefsdigital.com.
  const hits = looked.status === 'found' ? looked.hits.filter((h) => websiteDomain(h.entity.entityUrl) === domain) : [];
  return { status: 'ok', hits };
}

export async function resolveEntityFromCache(clues: EntityClues, opts: { limit?: number } = {}): Promise<EntityResolution> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const checked: EntityResolution['checked'] = [];
  const uei = norm(clues.uei);

  // ── UEI: authoritative ───────────────────────────────────────────────────────────────────
  if (uei) {
    const looked = await lookupLocalEntityByUEI(uei);
    if (looked.status === 'unavailable') {
      checked.push({ by: 'uei', status: 'unavailable', hits: 0 });
      return { status: 'unavailable', candidates: [], checked, note: 'Mindy\'s SAM cache could not be read. This is not "unregistered".' };
    }
    checked.push({ by: 'uei', status: 'ok', hits: looked.status === 'found' ? 1 : 0 });
    if (looked.status === 'found') {
      return { status: 'found', candidates: [toCandidate(looked.hit, clues, ['uei'])], checked, note: 'Resolved by UEI (authoritative) from Mindy\'s SAM cache.' };
    }
    return { status: 'none_found', candidates: [], checked, note: `UEI ${uei} is not in Mindy's SAM cache. It may be unregistered, expired out of the extract, or newer than the last refresh.` };
  }

  const byUei = new Map<string, EntityCandidate>();
  const add = (h: LocalEntityHit, match_on: MatchOn[]) => {
    const u = h.entity.ueiSAM;
    if (!u) return;
    const prev = byUei.get(u);
    if (prev) { for (const m of match_on) if (!prev.match_on.includes(m)) prev.match_on.push(m); return; }
    byUei.set(u, toCandidate(h, clues, [...match_on]));
  };

  // ── Website: the registration's own entityURL ───────────────────────────────────────────
  const domain = websiteDomain(clues.website);
  if (domain) {
    const w = await byWebsite(domain, limit);
    checked.push({ by: 'website', status: w.status, hits: w.hits.length });
    for (const h of w.hits) add(h, ['website']);
  }

  // ── Name: legal + DBA, whole words, state in the query ──────────────────────────────────
  const name = String(clues.name ?? '').trim();
  if (name) {
    const st = norm(clues.state);
    const looked = await lookupLocalEntitiesByName(name, limit, /^[A-Z]{2}$/.test(st) ? st : undefined);
    if (looked.status === 'unavailable') checked.push({ by: 'name', status: 'unavailable', hits: 0 });
    else {
      const hits = looked.status === 'found' ? looked.hits : [];
      checked.push({ by: 'name', status: 'ok', hits: hits.length });
      for (const h of hits) add(h, nameMatchOn(h.entity, name));
    }
  }

  if (!domain && !name) {
    return { status: 'none_found', candidates: [], checked, note: 'No usable clue: give a name, UEI or website.' };
  }

  // City narrows only when it leaves at least one candidate (a city mismatch is reported, not hidden).
  let candidates = [...byUei.values()];
  if (clues.city) {
    const inCity = candidates.filter((c) => !c.conflicts.includes('city'));
    if (inCity.length) candidates = inCity;
  }
  // Strongest evidence first: website, then DBA/legal name, then fewer conflicts, then active registration.
  const strength = (c: EntityCandidate) => (c.match_on.includes('website') ? 4 : 0) + (c.match_on.includes('dba_name') ? 1 : 0)
    + (c.match_on.includes('legal_name') ? 1 : 0) - c.conflicts.length * 2 + (c.registration_status === 'Active' ? 0.5 : 0);
  candidates.sort((a, b) => strength(b) - strength(a));

  if (checked.length && checked.every((c) => c.status === 'unavailable')) {
    return { status: 'unavailable', candidates: [], checked, note: 'Mindy\'s SAM cache could not be read. This is not "unregistered".' };
  }
  if (!candidates.length) {
    return {
      status: 'none_found', candidates, checked,
      note: 'No registration in Mindy\'s SAM cache matches these clues (legal name, DBA name and website checked). It may be registered under a different legal name.',
    };
  }
  if (candidates.length === 1 && !candidates[0].conflicts.length) {
    return { status: 'found', candidates, checked, note: `One registration matches (${candidates[0].match_on.join(', ')}). Cached as of ${candidates[0].as_of ?? 'unknown'}.` };
  }
  return {
    status: 'ambiguous', candidates, checked,
    note: `${candidates.length} registration${candidates.length === 1 ? '' : 's'} could match; compare UEI, address, DBA and website before choosing.`,
  };
}
