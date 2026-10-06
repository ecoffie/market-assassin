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

/**
 * Where a hierarchy sub-agency can actually be filtered. Only SAM open notices carry the contracting
 * office's Federal Hierarchy path. Awarded/recompete rows (USASpending awarding_sub_agency: 0 of
 * 186K say "Marine Corps", 18,767 say Navy) and agency forecasts (76 free-text mentions, no office
 * path) have no authoritative Marine Corps identifier — so those horizons are an implementation
 * LIMITATION for this filter: disclosed and excluded, never silently ignored and never broadened to Navy.
 */
export const HIERARCHY_SUPPORTED_HORIZONS = ['open'] as const;
export const HIERARCHY_UNSUPPORTED_HORIZONS = ['recompete', 'forecast'] as const;
export type MapHorizon = 'open' | 'recompete' | 'forecast';

export type FilterLimitation = {
  field: 'subAgency' | 'agency';
  value: string;
  horizon: MapHorizon;
  reason: string;
};

const USMC: HierarchySubAgency = {
  key: 'USMC',
  label: 'U.S. Marine Corps',
  pathPrefix: 'DEPT OF DEFENSE.DEPT OF THE NAVY.USMC',
};

/** Whole-value aliases (normalized), never substrings: "Marine Corps Logistics" is not an alias. */
export const ALIASES: Record<string, HierarchySubAgency> = {
  'marine corps': USMC,
  'us marine corps': USMC,
  'u s marine corps': USMC,
  'united states marine corps': USMC,
  'usmc': USMC,
  'marines': USMC,
  'department of the navy usmc': USMC,
  'dept of the navy usmc': USMC,
};

export function normalizeHierarchyAlias(v: string): string {
  return v.toLowerCase().replace(/[.,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Resolve a user-typed sub-agency/agency value to a hierarchy sub-agency, or null (unchanged semantics). */
export function resolveHierarchySubAgency(value: string | null | undefined): HierarchySubAgency | null {
  if (!value) return null;
  return ALIASES[normalizeHierarchyAlias(value)] ?? null;
}

/**
 * PostgREST `.or()` conditions selecting rows whose contracting office sits under the sub-agency:
 * the path equals the prefix, or continues with a further "." segment.
 */
export function hierarchyPathConds(h: HierarchySubAgency): string[] {
  return [`agency_hierarchy.ilike.${h.pathPrefix}`, `agency_hierarchy.ilike.${h.pathPrefix}.%`];
}

function filterValues(v: unknown, sep: RegExp): string[] {
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(sep).map((x) => x.trim()).filter(Boolean);
  return [];
}

/**
 * Implementation limitations of a saved filter set on the given horizons — the ONLY source of
 * "this filter cannot be represented". A supported filter that simply has no records is not a
 * limitation (that is "no matches in available data").
 */
export function hierarchyFilterLimitations(
  filters: Record<string, unknown>,
  horizons: readonly MapHorizon[],
): FilterLimitation[] {
  const out: FilterLimitation[] = [];
  const fields: Array<{ field: 'subAgency' | 'agency'; values: string[] }> = [
    { field: 'subAgency', values: filterValues(filters.subAgency, /,/) },
    { field: 'agency', values: filterValues(filters.agency, /\|/) },
  ];
  for (const { field, values } of fields) {
    for (const value of values) {
      const h = resolveHierarchySubAgency(value);
      if (!h) continue;
      for (const horizon of horizons) {
        if ((HIERARCHY_UNSUPPORTED_HORIZONS as readonly string[]).includes(horizon)) {
          out.push({
            field,
            value,
            horizon,
            reason: `${h.label} cannot be filtered on ${horizon === 'forecast' ? 'agency forecasts' : 'awarded contracts (recompetes)'}: that data has no ${h.label} office identifier, and it is not broadened to Navy.`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Browser-side twin for the Opportunity Map (injected as a string, like LAYOUT_MOVE_JS). Built FROM
 * the server alias table so the two cannot drift. window.__hierarchyLimit(FILT) → null when no
 * hierarchy sub-agency is set, else {label, supported:[...], unsupported:[...]}.
 */
export const HIERARCHY_HORIZON_LIMIT_JS = '<script>(function(){'
  + 'var A=' + JSON.stringify(Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [k, v.label]))) + ';'
  + 'var S=' + JSON.stringify(HIERARCHY_SUPPORTED_HORIZONS) + ',U=' + JSON.stringify(HIERARCHY_UNSUPPORTED_HORIZONS) + ';'
  + 'function n(v){return String(v||"").toLowerCase().replace(/[.,()]/g," ").replace(/\\s+/g," ").trim();}'
  + 'function vals(v,sep){return String(v||"").split(sep).map(function(x){return x.trim();}).filter(Boolean);}'
  + 'window.__hierarchyLimit=function(F){F=F||{};var hit=null;'
  + 'vals(F.subAgency,",").concat(vals(F.agency,"|")).forEach(function(x){if(!hit&&A[n(x)])hit=A[n(x)];});'
  + 'return hit?{label:hit,supported:S.slice(),unsupported:U.slice()}:null;};'
  // Disclosure bar: states which layers are excluded and why. Shown only while the limit applies.
  + 'window.__renderHierarchyLimit=function(L){try{var el=document.getElementById("hierarchyLimitBar");'
  + 'if(!L){if(el)el.style.display="none";return;}'
  + 'if(!el){el=document.createElement("div");el.id="hierarchyLimitBar";el.setAttribute("role","status");'
  + 'var nw=window.innerWidth<700;'
  + 'el.style.cssText="position:fixed;z-index:1000;"+(nw?"left:12px;right:12px;top:118px;":"left:76px;top:120px;max-width:min(560px,calc(100vw - 460px));")'
  + '+"background:#9a3412;color:#fff;border-radius:10px;padding:8px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)";'
  + 'document.body.appendChild(el);}'
  + 'el.textContent=L.label+" filter: showing open notices only. Awarded contracts and forecasts cannot be filtered to the "+L.label+", so they are hidden, not shown as all of Navy.";'
  + 'el.style.display="block";}catch(e){}};'
  + '})();</script>';
