/**
 * Sub-agencies that SAM files BELOW sub_tier, resolved through SAM's own Federal Hierarchy path.
 *
 * SAM gives Marine Corps notices `sub_tier = "DEPT OF THE NAVY"`; the Marine Corps appears only as the
 * third segment of the contracting office's Federal Hierarchy path, stored verbatim in
 * `sam_opportunities.agency_hierarchy` (= raw_data.fullParentPathName), e.g.
 *   DEPT OF DEFENSE.DEPT OF THE NAVY.USMC.MARCORP I&L.MARINE CORPS INSTALLATIONS COMMAND.…
 * with the matching code path `017.1700.USMC.…`. So a `sub_tier ILIKE '%Marine Corps%'` filter matched
 * zero rows, ever (measured 2026-10-06: 0 of 26,631 Navy notices), while the hierarchy path identifies
 * 1,135 (name-path and code-path agree on every row).
 *
 * Rejected alternatives, measured on the same corpus:
 *   - Solicitation prefix "M": 26 non-USMC hits (NAVSEA "MEA-26-…", SPAWAR "MIDS_…", MSC "MSC_ETFO…",
 *     NAVFAC "ML26-85") and 24 USMC misses (free-form numbers like "GFSC", "26172").
 *   - Even a strict uniform-PIID "M#####YY…" shape: 2 non-USMC offices.
 *   - Free-text "%USMC%" on the path: catches Bureau of Prisons "USMCFP Springfield".
 * The match is therefore anchored to the exact path segment, never a substring.
 *
 * Known gap: 51 Navy notices carry a path truncated at "DEPT OF DEFENSE.DEPT OF THE NAVY" (no office
 * segment). Their command cannot be established from the hierarchy, so they are NOT matched — the
 * filter stays exact rather than broadening to Navy.
 */

export type HierarchySubAgency = {
  key: string;
  label: string;
  /** The full hierarchy path prefix, segment-exact. */
  pathPrefix: string;
};

const USMC: HierarchySubAgency = {
  key: 'USMC',
  label: 'U.S. Marine Corps',
  pathPrefix: 'DEPT OF DEFENSE.DEPT OF THE NAVY.USMC',
};

/** Whole-value aliases (normalized), never substrings: "Marine Corps Logistics" is not an alias. */
const ALIASES: Record<string, HierarchySubAgency> = {
  'marine corps': USMC,
  'us marine corps': USMC,
  'u s marine corps': USMC,
  'united states marine corps': USMC,
  'usmc': USMC,
  'marines': USMC,
  'department of the navy usmc': USMC,
  'dept of the navy usmc': USMC,
};

function normalize(v: string): string {
  return v.toLowerCase().replace(/[.,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Resolve a user-typed sub-agency/agency value to a hierarchy sub-agency, or null (unchanged semantics). */
export function resolveHierarchySubAgency(value: string | null | undefined): HierarchySubAgency | null {
  if (!value) return null;
  return ALIASES[normalize(value)] ?? null;
}

/**
 * PostgREST `.or()` conditions selecting rows whose contracting office sits under the sub-agency:
 * the path equals the prefix, or continues with a further "." segment.
 */
export function hierarchyPathConds(h: HierarchySubAgency): string[] {
  return [`agency_hierarchy.ilike.${h.pathPrefix}`, `agency_hierarchy.ilike.${h.pathPrefix}.%`];
}
