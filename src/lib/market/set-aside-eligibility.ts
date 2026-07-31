/**
 * THE canonical answer to "what set-asides can this firm bid?" — one lib, every surface.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * This map was COPY-PASTED into five files (daily-alerts, weekly-alerts,
 * send-notifications, admin/trigger-alerts, sam/live-opportunities). All five
 * carried the same two bugs, and fixing one fixed only one:
 *
 *   1. WRONG CODE. 'Small Business' -> 'SBP'. In SAM:
 *        SBA = Total Small Business Set-Aside   (289 active per 1,000-row sample)
 *        SBP = PARTIAL Small Business Set-Aside (36 active CACHE-WIDE)
 *      Every 'Small Business' user was filtered to a code that barely exists.
 *      257 alert-enabled users carry that business_type.
 *
 *   2. NOT ADDITIVE. The map REPLACED base eligibility with the certification —
 *      as if holding SDVOSB status stopped you bidding a Total Small Business
 *      set-aside. Every one of these firms is a small business FIRST.
 *
 * Measured on info@lcmanagementsolutions.com (skipped daily 07-12 → 07-17 with
 * "no_new_or_active_opportunities"): her profile matches 145 live opportunities;
 * the old filter returned 0. Fixed: 146 = 115 unrestricted + 22 SBA + 9 NONE.
 * The 22 were work RESERVED FOR HER that she could not see.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * A certification EXPANDS what you may bid. It must NEVER hide work you are
 * already eligible for. Anyone can bid UNRESTRICTED (full-and-open) work — the
 * LARGEST pool in the cache (488 null + 145 'NONE' vs 289 SBA per 1,000 rows) —
 * so it is always included; see `setAsideOrFilter`.
 *
 * ⚠️ This is for eligibility DERIVED from business_type. A set-aside the user
 * EXPLICITLY asked for ("show me only 8(a)") is a different question, and an
 * exclusive filter is correct there — mi-dashboard's `setAside` param and the MCP
 * `search_sam_opportunities` `set_aside` arg are right as they are. Don't route
 * those through this.
 */

/** Every small business can bid these, whatever else it is certified as. */
export const SMALL_BUSINESS_SET_ASIDES = ['SBA', 'SBP'];

/**
 * Unrestricted / full-and-open work carries a NULL or 'NONE' set_aside_code.
 * Everyone can bid it — it is never filtered out.
 */
export const UNRESTRICTED_SET_ASIDE_CODE = 'NONE';

/**
 * business_type is free-ish text collected across several onboarding versions, so
 * the SAME certification arrives spelled several ways: 'Small Business' (73 users)
 * AND 'small-business' (41), 'WOSB' (23) AND 'women-owned' (10). An unrecognized
 * key used to fall through to `set_aside_code.eq.small-business` — a code matching
 * NOTHING — which zeroed those 51 users out.
 */
export function normalizeBusinessType(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Canonical spellings → the certification's OWN reserved pool (added to the base). */
const CERTIFICATION_SET_ASIDES: Record<string, string[]> = {
  sdvosb: ['SDVOSBC'],
  servicedisabledveteranowned: ['SDVOSBC'],
  vosb: ['VSB'],
  veteranowned: ['VSB'],
  '8a': ['8A'],
  smalldisadvantagedbusiness: ['8A'],
  wosb: ['WOSB'],
  womenowned: ['WOSB'],
  womenownedsmallbusiness: ['WOSB'],
  edwosb: ['EDWOSB'],
  hubzone: ['HZC'],
  // Plain small business — no extra reserved pool beyond the base.
  smallbusiness: [],
  sba: [],
};

/**
 * The set-aside codes this business_type is eligible for, base + certification.
 *
 * Returns `[]` for an absent or unrecognized business_type — meaning DO NOT filter,
 * i.e. show everything. That is deliberate: a value we don't understand must never
 * narrow a user's results to nothing. ('dot-certified' is a real value in the DB and
 * is not a SAM set-aside at all.)
 */
export function eligibleSetAsides(businessType?: string | null): string[] {
  if (!businessType?.trim()) return [];
  const cert = CERTIFICATION_SET_ASIDES[normalizeBusinessType(businessType)];
  if (!cert) return []; // unknown → don't filter, don't guess
  return [...SMALL_BUSINESS_SET_ASIDES, ...cert];
}

/**
 * A PostgREST `.or()` string for an eligibility set, ALWAYS including unrestricted
 * work (NULL or 'NONE'). Returns null when there is nothing to filter on.
 *
 * The sibling state filter learned this lesson first — it ORs in `pop_state.is.null`
 * because SAM omits pop_state on ~64% of notices. The set-aside filter never did, and
 * silently dropped the biggest pool of biddable work.
 */
export function setAsideOrFilter(codes: string[]): string | null {
  if (!codes.length) return null;
  return [
    ...codes.map((c) => `set_aside_code.eq.${c}`),
    'set_aside_code.is.null',
    `set_aside_code.eq.${UNRESTRICTED_SET_ASIDE_CODE}`,
  ].join(',');
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSSWALK: Vault certifications → this module's SAM codes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `business_type` is ONE free-text string on user_notification_settings. The
 * Vault (`user_identity_profile.certifications`) is an ARRAY, and it is what the
 * user actually maintains — so it is routinely richer:
 *
 *   legacyprosolutions1@   business_type "Small Business"  vault [WOSB, EDWOSB, MBE, WBE]
 *   keidra@eganrose.com    business_type "Small Business"  vault [EDWOSB, WOSB]
 *   management@sandd...    business_type "Small Business"  vault [Small Business, VOSB]
 *
 * Alerts read business_type only, so those firms are filtered to plain
 * small-business work and never shown the WOSB / EDWOSB / VOSB pools RESERVED
 * FOR THEM. Same class of miss this file was written to fix (the 22 hidden
 * opportunities in the header) — different input, identical symptom. Measured
 * 2026-07-31: 6 alert-enabled users under-served this way.
 *
 * The two systems speak different vocabularies and CANNOT be pointed at each
 * other directly:
 *   this file  → SAM opportunity codes   SBA · 8A  · HZC     · SDVOSBC
 *   vault lib  → recompete vocabulary    SB-Total · 8(a) · HUBZone · SDVOSB
 * Mapping one onto the other by string equality matches nothing.
 *
 * So: translate the vault's normalized codes into SAM codes, and UNION with
 * whatever business_type already yields. Union, never replace — a certification
 * must only ever ADD a lane (the rule at the top of this file).
 */
const VAULT_CODE_TO_SAM: Record<string, string[]> = {
  'SB-Total': [],            // base pool already in SMALL_BUSINESS_SET_ASIDES
  '8(a)': ['8A'],
  'SDVOSB': ['SDVOSBC'],
  'VOSB': ['VSB'],
  'WOSB': ['WOSB'],
  'EDWOSB': ['EDWOSB'],
  'HUBZone': ['HZC'],
  'Indian-SB': ['8A'],       // tribal/ANC 8(a) firms compete the 8(a) pool
};

/**
 * Eligibility from BOTH sources, unioned.
 *
 * `vaultSetAsides` is the output of eligibleSetAsides() in lib/vault/
 * certifications (normalized codes, NOT raw user text — pass it through that
 * normalizer first, or "WOSB certified by U.S. SBA" resolves to nothing).
 *
 * Returns [] when neither source yields anything — meaning DO NOT filter, same
 * contract as eligibleSetAsides(). An empty result must never be read as
 * "eligible for nothing".
 */
export function eligibleSetAsidesCombined(
  businessType?: string | null,
  vaultSetAsides?: string[] | null,
): string[] {
  const out = new Set<string>(eligibleSetAsides(businessType));
  const vault = (vaultSetAsides || []).filter(Boolean);

  if (vault.length) {
    // Any vault certification implies small-business status, so the base pool
    // applies even when business_type is empty or unrecognized.
    for (const c of SMALL_BUSINESS_SET_ASIDES) out.add(c);
    for (const code of vault) {
      for (const sam of VAULT_CODE_TO_SAM[code] ?? []) out.add(sam);
    }
  }
  return [...out];
}
