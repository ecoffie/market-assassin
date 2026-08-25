/**
 * OPERATIONAL CUSTOMER IDENTITY — who you actually sell to, distinct from who signs.
 *
 * ── NS-3, the defect this closes (measured 2026-08-25) ─────────────────────────────────
 * A live session read North Star's SABER IDIQ (FA461025D0001, Jan 2025) as "an Air Force
 * SABER" and moved on. It is a **Vandenberg Space Force Base / Space Launch Delta 30**
 * installation vehicle, and that changes the strategy entirely.
 *
 * That was NOT a reasoning failure. It was reading the only fields available:
 *
 *     department  DEPT OF DEFENSE
 *     sub_tier    DEPT OF THE AIR FORCE      <- what Mindy reads
 *     office      null                       <- 0% populated, corpus-wide
 *     office_address.city  VANDENBERG SFB    <- the answer, 99.1% populated
 *
 * MEASURED: **399 notices name a Space Force installation in the address, and ALL 399 say
 * AIR FORCE in sub_tier.** Four bases — Patrick, Peterson, Vandenberg, Schriever.
 *
 * The administrative data is CORRECT: these units were Air Force wings before USSF stood
 * up, and the contracting hierarchy still runs through the Department of the Air Force.
 * It is stale in a way that INVERTS STRATEGY, which is the dangerous kind: nothing looks
 * broken.
 *
 * ── THE DESIGN RULE (Eric) ─────────────────────────────────────────────────────────────
 * Preserve TWO TRUTHS rather than overwriting one:
 *
 *   administrative hierarchy   DoD -> Department of the Air Force -> 30 CONS PK
 *   operational customer       Vandenberg SFB / Space Launch Delta 30
 *
 * And: **do not hardcode FA4610 = Space Force.** This resolves from EVIDENCE — the
 * installation named in the office address, and the contracting unit named in the DoDAAC
 * directory — so it generalizes to installations nobody has enumerated. Every conclusion
 * carries the evidence that produced it and when that evidence was observed.
 */

/** One piece of evidence behind a conclusion, so the caller can audit the reasoning. */
export interface IdentityEvidence {
  /** Which field produced it. */
  field: 'office_address.city' | 'pop_city' | 'dodaac_directory.office_name' | 'sub_tier' | 'department';
  value: string;
  /** When the underlying record was last observed, when the source carries it. */
  observedAt?: string | null;
}

export interface OperationalCustomer {
  /** ADMINISTRATIVE: who contracts. Never overwritten, never inferred away. */
  administrative: {
    department: string | null;
    subTier: string | null;
    contractingOffice: string | null;   // e.g. "30 CONS PK", from the DoDAAC directory
    dodaac: string | null;
  };
  /** OPERATIONAL: who the work is actually for. Null when evidence does not support one. */
  operational: {
    installation: string | null;        // e.g. "VANDENBERG SFB"
    /** Service component when the EVIDENCE supports naming one. Never assumed. */
    component: string | null;           // e.g. "U.S. Space Force"
    /** Named unit when the contracting office reveals one. */
    unit: string | null;                // e.g. "Space Launch Delta 30"
  };
  /**
   * True when operational identity DIFFERS from the administrative hierarchy — the case
   * that changes strategy and the one Mindy silently missed.
   */
  divergesFromAdministrative: boolean;
  /** Why we concluded what we concluded. Empty when nothing was resolvable. */
  evidence: IdentityEvidence[];
  /** Plain-language explanation, safe to show a user. */
  explanation: string | null;
}

/**
 * Installation-name patterns. These are NAMING CONVENTIONS, not an entity list: "SFB"
 * (Space Force Base) and "SFS" (Space Force Station) are how the government writes these
 * places, so a base that opens tomorrow resolves without a code change.
 *
 * ⚠️ Deliberately NOT a map of specific bases. Enumerating FA4610 -> Vandenberg would fix
 * one demo and leave the class open.
 */
const SPACE_FORCE_SITE = /\b(SFB|SFS|SPACE FORCE (BASE|STATION))\b/i;

/**
 * Contracting-unit patterns that name a Space Force organization. Again conventions:
 * "SLD" = Space Launch Delta, "STARCOM" = Space Training and Readiness Command,
 * "SPACE SYSTEMS" = SSC. Measured: FA2549 resolves to "STARCOM CONTRACTING PK" — a Space
 * Force unit whose sub_agency still reads Department of the Air Force.
 */
const SPACE_FORCE_UNIT = /\b(SLD|STARCOM|SPACE (LAUNCH DELTA|SYSTEMS|OPERATIONS|DELTA)|SSC)\b/i;

/** "30 CONS PK" -> Space Launch Delta 30, when the site is already known to be Space Force. */
function unitFromContractingOffice(officeName: string | null, isSpaceSite: boolean): string | null {
  if (!officeName) return null;
  if (SPACE_FORCE_UNIT.test(officeName)) return officeName.trim();
  // A numbered contracting squadron at a Space Force installation belongs to that site's
  // delta. We name the DELTA only when the site evidence already established the component
  // — the number alone proves nothing.
  const m = officeName.match(/\b(\d{1,3})\s*CONS\b/i);
  if (m && isSpaceSite) return `Space Launch Delta ${m[1]}`;
  return null;
}

export interface ResolveInput {
  department?: string | null;
  subTier?: string | null;
  /** `office_address` JSON from sam_opportunities (99.1% populated). */
  officeAddressCity?: string | null;
  popCity?: string | null;
  /** 6-char DoDAAC, typically the solicitation-number prefix. */
  dodaac?: string | null;
  /** `dodaac_directory.office_name`, e.g. "30 CONS PK". */
  contractingOfficeName?: string | null;
  observedAt?: string | null;
}

/**
 * Resolve operational customer identity from evidence. Returns BOTH truths.
 *
 * Never invents a component: if no evidence names one, `component` stays null and
 * `divergesFromAdministrative` stays false. Absence of evidence is not evidence of
 * sameness — it is simply nothing to report.
 */
export function resolveOperationalCustomer(input: ResolveInput): OperationalCustomer {
  const evidence: IdentityEvidence[] = [];
  const city = (input.officeAddressCity || '').trim();
  const popCity = (input.popCity || '').trim();
  const officeName = (input.contractingOfficeName || '').trim() || null;
  const subTier = (input.subTier || '').trim() || null;

  const administrative = {
    department: (input.department || '').trim() || null,
    subTier,
    contractingOffice: officeName,
    dodaac: (input.dodaac || '').trim().toUpperCase() || null,
  };

  // ── Evidence 1: the installation named in the office address (99.1% populated) ──
  let installation: string | null = null;
  let siteIsSpaceForce = false;
  for (const [value, field] of [[city, 'office_address.city'], [popCity, 'pop_city']] as const) {
    if (!value) continue;
    if (SPACE_FORCE_SITE.test(value)) {
      installation = value.toUpperCase();
      siteIsSpaceForce = true;
      evidence.push({ field, value, observedAt: input.observedAt ?? null });
      break;
    }
    if (!installation) installation = value.toUpperCase();   // keep the place even if not USSF
  }

  // ── Evidence 2: the contracting unit named in the DoDAAC directory ──
  let unit = unitFromContractingOffice(officeName, siteIsSpaceForce);
  if (officeName && SPACE_FORCE_UNIT.test(officeName)) {
    siteIsSpaceForce = true;
    evidence.push({ field: 'dodaac_directory.office_name', value: officeName, observedAt: input.observedAt ?? null });
  } else if (unit && officeName) {
    evidence.push({ field: 'dodaac_directory.office_name', value: officeName, observedAt: input.observedAt ?? null });
  }
  if (!unit) unit = unitFromContractingOffice(officeName, siteIsSpaceForce);

  const component = siteIsSpaceForce ? 'U.S. Space Force' : null;

  // Divergence = the evidence names a component the administrative hierarchy does not.
  const adminSaysSpace = /SPACE/i.test(subTier || '') || /SPACE/i.test(administrative.department || '');
  const diverges = !!component && !adminSaysSpace;
  if (diverges && subTier) {
    evidence.push({ field: 'sub_tier', value: subTier, observedAt: input.observedAt ?? null });
  }

  let explanation: string | null = null;
  if (diverges) {
    const bits = [
      installation ? `the contracting office address is ${installation}` : null,
      officeName ? `the buying office is ${officeName}` : null,
    ].filter(Boolean).join(' and ');
    explanation =
      `Contracted through ${subTier || 'the Department of Defense'}, but ${bits || 'the location evidence'} `
      + `indicates the customer is ${unit ? `${unit}, ` : ''}${component}. `
      + `Both are true: ${subTier || 'the department'} is the contracting authority; ${component} is the operational customer.`;
  }

  return {
    administrative,
    operational: { installation, component, unit },
    divergesFromAdministrative: diverges,
    evidence,
    explanation,
  };
}
