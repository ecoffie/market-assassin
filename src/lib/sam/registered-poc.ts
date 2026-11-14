/**
 * REGISTERED SAM POINTS OF CONTACT — read from data we already hold, never from live SAM.
 *
 * Ask Mindy R8 (2026-11-13): "Small business contact at Concord Professional Services" returned
 * no named person. The curated SBLO roster covers ~200 large primes, so a small firm always
 * misses it, and the BigQuery tier carries award data with no people. Meanwhile Mindy already
 * held the firm's registered SAM points of contact (Geoff Haas, President; Daniel Reed, Proposal
 * Manager; Chris Rud, Office Manager) in two places:
 *   1. `sam_entities.points_of_contact` (the bulk mirror; populated for some rows), and
 *   2. `sam_api_cache` (api_type='entity'): the raw live response for every UEI we ever fetched,
 *      with the POC block at response_data.entityData[0].pointsOfContact.
 *
 * CACHE-FIRST, and here CACHE-ONLY: this module never calls the SAM API. An expired cache row is
 * still a real past SAM response; it is returned with its `fetched_at` as `as_of` so the caller
 * can say "as of <date>". Reads only: it does not bump hit_count or delete expired rows.
 *
 * WHAT A REGISTERED POC IS NOT: a designated small business liaison. It is whoever the firm
 * listed on its SAM registration (government-business / electronic-business / past-performance
 * roles). Every result carries that label. SAM's public API redacts POC email and phone, so
 * those are normally blank; blanks are dropped, never filled in.
 */
import { createClient } from '@supabase/supabase-js';
import { transformEntity, type SAMEntity } from './entity-api';
import { lookupLocalEntitiesByName, lookupLocalEntityByUEI } from './entity-local-fallback';
import { classifyNameHits } from '@/lib/contractor/name-resolution';

export type SamPoc = NonNullable<SAMEntity['pointsOfContact']>[number];

export const REGISTERED_POC_LABEL =
  'registered SAM point of contact, not a designated small business liaison';

/** One person, with every SAM role they hold on the registration. */
export interface RegisteredPocPerson {
  name: string;
  title?: string;
  /** Plain-English SAM POC roles, e.g. "government business POC". */
  roles: string[];
  /** Present only when SAM returned a non-blank value. Never inferred. */
  email?: string;
  phone?: string;
}

export interface RegisteredPocs {
  label: typeof REGISTERED_POC_LABEL;
  company: string;
  uei: string;
  /** sam_entities mirror, or the stored raw SAM entity response. Never a live call. */
  source: 'sam_entities_mirror' | 'sam_api_cache';
  /** When that row was last fetched from SAM. */
  as_of: string | null;
  contacts: RegisteredPocPerson[];
  note: string;
}

export type CachedPocLookup =
  | { status: 'found'; pocs: SamPoc[]; asOf: string | null; legalBusinessName: string }
  | { status: 'absent' }
  | { status: 'unavailable'; detail: string };

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Keep only entries that name a person; same field set the live transformer emits. */
export function normalizePocs(raw: unknown): SamPoc[] {
  if (!Array.isArray(raw)) return [];
  const out: SamPoc[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const name = s(r.name);
    if (!name) continue;
    out.push({ name, title: s(r.title), phone: s(r.phone), email: s(r.email), type: s(r.type) });
  }
  return out;
}

/**
 * Cache-only POC read for one UEI: the newest stored SAM entity response for that UEI.
 * Expired rows count (they are past SAM answers, dated by as_of). No SAM call, no writes.
 */
export async function lookupCachedEntityPocs(uei: string): Promise<CachedPocLookup> {
  const id = s(uei).toUpperCase();
  if (!id) return { status: 'absent' };
  const sb = db();
  if (!sb) return { status: 'unavailable', detail: 'Supabase client unavailable' };
  const { data, error } = await sb
    .from('sam_api_cache')
    .select('response_data, fetched_at')
    .eq('api_type', 'entity')
    .eq('query_params->>ueiSAM', id)
    .order('fetched_at', { ascending: false })
    .limit(3);
  if (error) {
    console.error('[registered-poc] sam_api_cache read failed:', error.message);
    return { status: 'unavailable', detail: error.message };
  }
  for (const row of (data || []) as Array<{ response_data: unknown; fetched_at: string | null }>) {
    const raw = (row.response_data as { entityData?: Record<string, unknown>[] } | null)?.entityData?.[0];
    if (!raw) continue;
    let entity: SAMEntity;
    try { entity = transformEntity(raw); } catch { continue; }
    if (s(entity.ueiSAM).toUpperCase() !== id) continue;
    const pocs = normalizePocs(entity.pointsOfContact);
    if (!pocs.length) continue;
    return { status: 'found', pocs, asOf: row.fetched_at ?? null, legalBusinessName: entity.legalBusinessName };
  }
  return { status: 'absent' };
}

const ROLE_LABELS: Record<string, string> = {
  governmentBusinessPOC: 'government business POC',
  governmentBusinessAlternatePOC: 'alternate government business POC',
  electronicBusinessPOC: 'electronic business POC',
  electronicBusinessAlternatePOC: 'alternate electronic business POC',
  pastPerformancePOC: 'past performance POC',
  pastPerformanceAlternatePOC: 'alternate past performance POC',
};

const ROLE_ORDER = Object.values(ROLE_LABELS).sort((a, b) => {
  const w = (r: string) => (r.includes('government') ? 0 : r.includes('electronic') ? 2 : 4) + (r.startsWith('alternate') ? 1 : 0);
  return w(a) - w(b);
});

/** Collapse SAM's six role slots into one entry per person (name + title). */
export function groupPocsByPerson(pocs: SamPoc[]): RegisteredPocPerson[] {
  const byKey = new Map<string, RegisteredPocPerson>();
  for (const p of pocs) {
    const name = s(p.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const role = ROLE_LABELS[s(p.type)] || s(p.type) || 'registered POC';
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        name,
        ...(s(p.title) ? { title: s(p.title) } : {}),
        roles: [role],
        ...(s(p.email) ? { email: s(p.email) } : {}),
        ...(s(p.phone) ? { phone: s(p.phone) } : {}),
      });
      continue;
    }
    if (!prev.roles.includes(role)) prev.roles.push(role);
    if (!prev.title && s(p.title)) prev.title = s(p.title);
    if (!prev.email && s(p.email)) prev.email = s(p.email);
    if (!prev.phone && s(p.phone)) prev.phone = s(p.phone);
  }
  // Order by the most government-facing role each person holds (SAM's government business POC,
  // then its alternate, then electronic business, then past performance), ties by role count.
  const rank = (p: RegisteredPocPerson) => Math.min(...p.roles.map((r) => {
    const i = ROLE_ORDER.indexOf(r);
    return i < 0 ? ROLE_ORDER.length : i;
  }));
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b) || b.roles.length - a.roles.length);
}

const NOTE =
  'These are the people the firm listed on its SAM.gov registration. They are not a designated '
  + 'small business liaison. SAM redacts POC email and phone on the public API; do not invent them. '
  + 'Contact through the firm\'s website or a SAM-listed channel.';

export function buildRegisteredPocs(args: {
  company: string; uei: string; source: RegisteredPocs['source']; asOf: string | null; pocs: SamPoc[];
}): RegisteredPocs | null {
  const contacts = groupPocsByPerson(args.pocs);
  if (!contacts.length) return null;
  return {
    label: REGISTERED_POC_LABEL,
    company: args.company,
    uei: args.uei,
    source: args.source,
    as_of: args.asOf,
    contacts,
    note: NOTE,
  };
}

export type RegisteredPocResolution =
  | { status: 'found'; pocs: RegisteredPocs }
  /** The firm resolved, but no POCs are held for it (mirror and cache both silent). */
  | { status: 'no_pocs_held'; company: string; uei: string }
  | { status: 'ambiguous' | 'not_found' }
  | { status: 'unavailable'; detail: string };

/**
 * Resolve a company to its registered SAM POCs without calling SAM:
 *   UEI given → mirror row → cache. Name → local mirror name lookup, unique pick only
 *   (classifyNameHits: sole hit, or exactly one exact legal-stem among a complete list).
 * An ambiguous name returns nothing rather than another firm's people.
 */
export async function resolveRegisteredPocs(input: { name?: string; uei?: string }): Promise<RegisteredPocResolution> {
  let uei = s(input.uei).toUpperCase();
  let company = '';
  let mirrorPocs: SamPoc[] = [];
  let mirrorAsOf: string | null = null;

  const name = s(input.name);
  if (!uei && name) {
    const looked = await lookupLocalEntitiesByName(name, 25);
    if (looked.status === 'unavailable') return { status: 'unavailable', detail: looked.detail };
    if (looked.status === 'absent') return { status: 'not_found' };
    const hits = looked.hits;
    const classified = classifyNameHits(
      name,
      hits.map((h) => ({
        name: h.entity.legalBusinessName || '', uei: h.entity.ueiSAM,
        total_obligated: 0, award_count: 0, dba: h.entity.dbaName,
      })),
      // A full page may hide another exact match; classifyNameHits refuses to pick then.
      hits.length >= 25 ? hits.length + 1 : hits.length,
    );
    if (classified.status !== 'unique') return { status: classified.status === 'ambiguous' ? 'ambiguous' : 'not_found' };
    const hit = hits.find((h) => h.entity.ueiSAM === classified.uei);
    if (!hit) return { status: 'not_found' };
    uei = s(hit.entity.ueiSAM).toUpperCase();
    company = hit.entity.legalBusinessName;
    mirrorPocs = normalizePocs(hit.entity.pointsOfContact);
    mirrorAsOf = hit.asOf;
  }
  if (!uei) return { status: 'not_found' };

  if (!company) {
    // UEI given directly: the mirror row may already carry the POC block.
    const row = await lookupLocalEntityByUEI(uei);
    if (row.status === 'found') {
      company = row.hit.entity.legalBusinessName;
      mirrorPocs = normalizePocs(row.hit.entity.pointsOfContact);
      mirrorAsOf = row.hit.asOf;
    }
  }

  if (mirrorPocs.length) {
    const pocs = buildRegisteredPocs({ company, uei, source: 'sam_entities_mirror', asOf: mirrorAsOf, pocs: mirrorPocs });
    if (pocs) return { status: 'found', pocs };
  }

  const cached = await lookupCachedEntityPocs(uei);
  if (cached.status === 'unavailable') return { status: 'unavailable', detail: cached.detail };
  if (cached.status === 'found') {
    const pocs = buildRegisteredPocs({
      company: company || cached.legalBusinessName, uei, source: 'sam_api_cache', asOf: cached.asOf, pocs: cached.pocs,
    });
    if (pocs) return { status: 'found', pocs };
  }
  return { status: 'no_pocs_held', company, uei };
}
