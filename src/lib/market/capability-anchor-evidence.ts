/**
 * Local SAM + award-history evidence for capability anchor cross-check.
 * Uses the sam_entities mirror + BigQuery UEI history — no live SAM API, no name-substring BQ search.
 *
 * ⚠️ IDENTITY IS THE GATE. A name search returning rows is not corroboration: `ilike
 * '%Vision Centric%'` matches every firm with that string, and merging their NAICS
 * invents a registration profile for a company that may not be the caller's. Only a
 * UNIQUELY resolved entity may elevate anchor confidence. Ambiguous or absent identity
 * returns no NAICS at all — the anchor then has to stand on its own text, which is the
 * honest outcome.
 */
import { localEntitiesByName } from '@/lib/sam/entity-local-fallback';
import { getContractorHistoryByUei } from '@/lib/contractor/history-by-uei';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import type { AnchorEvidence, EntityIdentityStatus } from '@/lib/market/capability-anchor';
import { emptyAnchorEvidence } from '@/lib/market/capability-anchor';

function naicsFromEntity(entity: {
  primaryNaics?: string;
  naicsList?: Array<{ code?: string; naicsCode?: string }>;
}): string[] {
  const out = new Set<string>();
  if (entity.primaryNaics) out.add(String(entity.primaryNaics).slice(0, 6));
  for (const n of entity.naicsList || []) {
    const c = n.code || n.naicsCode;
    if (c) out.add(String(c).slice(0, 6));
  }
  return [...out];
}

/** Legal-suffix-insensitive form so "Acme LLC" and "Acme, Inc." compare as the same name. */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|plc|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ResolvedIdentity {
  status: EntityIdentityStatus;
  uei: string | null;
  legalName: string | null;
  candidates: number;
}

interface IdentityCandidate {
  uei: string;
  legalName: string;
}

/**
 * Decide whether a name search resolved to ONE real entity.
 *
 * Exact normalized-name matches win over substring noise, but two exact matches with
 * different UEIs is a collision, not a resolution — that is a real cohort case
 * ("Building Consultants, Inc." exists in several states) and it must not be broken
 * by picking the first row.
 */
export function resolveIdentity(query: string, candidates: IdentityCandidate[]): ResolvedIdentity {
  const withUei = candidates.filter((c) => c.uei);
  const usable = withUei.filter((c) => isWellFormedUei(c.uei));
  if (!usable.length) return { status: 'none', uei: null, legalName: null, candidates: withUei.length };

  const byUei = new Map(usable.map((c) => [c.uei.toUpperCase(), { ...c, uei: c.uei.toUpperCase() }]));
  if (byUei.size === 1) {
    const only = [...byUei.values()][0];
    return { status: 'unique', uei: only.uei, legalName: only.legalName, candidates: 1 };
  }

  const target = normalizeEntityName(query);
  const exact = [...byUei.values()].filter((c) => normalizeEntityName(c.legalName) === target);
  if (exact.length === 1) {
    return { status: 'unique', uei: exact[0].uei, legalName: exact[0].legalName, candidates: byUei.size };
  }

  return { status: 'ambiguous', uei: null, legalName: null, candidates: byUei.size };
}

export async function loadAnchorEvidence(clientName: string | undefined): Promise<AnchorEvidence> {
  const empty = emptyAnchorEvidence();
  if (!clientName?.trim()) return empty;

  const hits = await localEntitiesByName(clientName.trim(), 10);
  const identity = resolveIdentity(
    clientName.trim(),
    hits.map((h) => ({ uei: h.entity.ueiSAM ?? '', legalName: h.entity.legalBusinessName ?? '' })),
  );

  if (identity.status !== 'unique') {
    return { ...empty, identity: identity.status, identityCandidates: identity.candidates };
  }
  const uei = identity.uei;
  if (!uei || !isWellFormedUei(uei)) {
    return { ...empty, identity: 'none', identityCandidates: identity.candidates };
  }

  const matched = hits.find((h) => (h.entity.ueiSAM ?? '').toUpperCase() === uei);
  const samNaics = matched ? naicsFromEntity(matched.entity) : [];

  const awardNaics: string[] = [];
  let awardObligatedUsd: number | null = null;
  try {
    const hist = await getContractorHistoryByUei({ uei, coldPolicy: 'never' });
    awardObligatedUsd =
      hist.history?.summary?.totalObligations ?? hist.history?.contractor?.totalContractValue ?? null;
    for (const n of hist.history?.topNaics ?? []) {
      if (n.naics) awardNaics.push(String(n.naics).slice(0, 6));
    }
  } catch (err) {
    console.error('[capability-anchor-evidence] award lookup failed:', err);
  }

  return {
    identity: 'unique',
    identityUei: uei,
    identityName: identity.legalName,
    identityCandidates: identity.candidates,
    samNaics,
    awardNaics: [...new Set(awardNaics)],
    awardObligatedUsd,
    samAsOf: matched?.asOf ?? null,
    awardAsOf: null,
  };
}
