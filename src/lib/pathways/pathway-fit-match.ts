/**
 * PATHWAY FIT v0 — pure matcher (docs/PRD-pathway-fit-v0.md).
 *
 * Killer rule: SUPPORTED_FIT / POSSIBLE_FIT require buyer_evidence AND company_evidence.
 * NO_PROVEN_DOOR is success. No Talent. No vehicle-portfolio invention. No set-aside-first.
 */

import {
  CAPABILITY_RECENCY_YEARS,
  DOOR_LABELS,
  HOST_RULES_PATHWAY_FIT,
  NYM_DOOR_KINDS,
  OWNER_ASSERTED_DISCLAIMER,
  type AdditionalAdvantage,
  type CaiObservedPathway,
  type CaiPackageSlim,
  type CompanyAwardFact,
  type CompanyCertFact,
  type CompanyPublicRecord,
  type EvidenceItem,
  type MatchCompanyToPathwaysResult,
  type PathwayDetermination,
  type PathwayDoorFit,
  type PathwayDoorKind,
  type ProofLeadItem,
  type ProofMissingCode,
  type ProofMissingItem,
  type RankComponents,
} from './pathway-fit-types';

const TIE_ORDER: PathwayDoorKind[] = [
  'idv_task_order',
  'cso',
  'conventional_solicitation',
  'other_transaction',
  'set_aside',
  'consortium',
  'rapid_acquisition_office',
  'pae_portfolio',
  'other_mechanism',
];

const MISSING_PENALTY: Partial<Record<ProofMissingCode, number>> = {
  vehicle_access_unverified: 2,
  demonstrable_product_unestablished: 2,
  past_performance_weak_or_distant: 3,
  capability_relation_unestablished: 3,
  ot_nontraditional_status_unestablished: 2,
  cert_self_identified_not_authoritative: 1,
  cso_topic_fit_weak: 1,
  measurable_outcome_unavailable: 1,
  delivery_speed_unavailable: 1,
};

function tokenize(...parts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const t of p.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 3) out.add(t);
    }
  }
  return out;
}

function yearsAgo(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function inRecencyWindow(award: CompanyAwardFact, now = new Date()): boolean {
  const yEnd = yearsAgo(award.endDate, now);
  const yStart = yearsAgo(award.startDate, now);
  const y = yEnd ?? yStart;
  if (y === null) return false;
  return y <= CAPABILITY_RECENCY_YEARS;
}

export type CapabilityOverlap = {
  level: 0 | 1 | 2;
  awards: CompanyAwardFact[];
  reason: string;
};

/** Pure capability relation — amount never increases level. */
export function scoreCapabilityOverlap(
  company: CompanyPublicRecord,
  cai: CaiPackageSlim,
  now = new Date(),
): CapabilityOverlap {
  const scopeTokens = tokenize(
    cai.scope.capability,
    ...(cai.scope.keywords || []),
    ...(cai.scope.naics || []),
    ...(cai.scope.psc || []),
    cai.scope.agency,
  );
  const scopeNaics = new Set((cai.scope.naics || []).map((n) => n.replace(/\D/g, '')).filter(Boolean));
  const scopePsc = new Set((cai.scope.psc || []).map((p) => p.toUpperCase()));

  let best: CapabilityOverlap = { level: 0, awards: [], reason: 'no related public awards' };
  const related: CompanyAwardFact[] = [];

  for (const a of company.awards) {
    const awardNaics = (a.naics || '').replace(/\D/g, '');
    const awardTokens = tokenize(a.title, a.description || '', a.agency, a.naics || '', a.psc || '');
    let level: 0 | 1 | 2 = 0;
    let reason = '';

    const exactNaics =
      awardNaics.length === 6 &&
      [...scopeNaics].some((n) => n.length === 6 && n === awardNaics);
    const prefixNaics =
      awardNaics.length >= 3 &&
      [...scopeNaics].some((n) => n.length >= 3 && (awardNaics.startsWith(n.slice(0, 3)) || n.startsWith(awardNaics.slice(0, 3))));
    const pscHit = a.psc && scopePsc.has(a.psc.toUpperCase());
    let tokenHits = 0;
    for (const t of awardTokens) if (scopeTokens.has(t)) tokenHits += 1;

    if (exactNaics || pscHit || tokenHits >= 3) {
      level = inRecencyWindow(a, now) ? 2 : 1;
      reason = exactNaics
        ? 'exact NAICS match to buyer capability scope'
        : pscHit
          ? 'PSC match to buyer capability scope'
          : 'title/description overlap with capability scope';
    } else if (prefixNaics || tokenHits >= 1) {
      level = 1;
      reason = prefixNaics ? '3-digit NAICS family overlap' : 'weak keyword overlap with capability';
    }

    // Explicit: obligation amount must NOT raise level
    void a.amount;

    if (level > 0) related.push(a);
    if (level > best.level) best = { level, awards: [a], reason };
    else if (level === best.level && level > 0) best.awards.push(a);
  }

  if (best.level === 0) return best;
  // Prefer most recent among related for lead proof
  best.awards = [...related].sort((a, b) => {
    const ta = Date.parse(a.endDate || a.startDate || '') || 0;
    const tb = Date.parse(b.endDate || b.startDate || '') || 0;
    return tb - ta;
  });
  return best;
}

function buyerEvidenceFromObserved(obs: CaiObservedPathway): EvidenceItem[] {
  return obs.citations.map((c) => ({
    evidence_class: 'government_public' as const,
    role: 'buyer_side' as const,
    source_kind: c.source_kind,
    source_id: c.source_id,
    locator: c.locator,
    as_of: c.as_of,
    statement: obs.statement,
  }));
}

function companyAwardEvidence(awards: CompanyAwardFact[], reason: string): EvidenceItem[] {
  return awards.slice(0, 3).map((a) => ({
    evidence_class: 'government_public' as const,
    role: 'company_side' as const,
    source_kind: 'usaspending_awards',
    source_id: a.id,
    locator: `award.id=${a.id}`,
    as_of: a.endDate || a.startDate,
    statement: `${a.title} for ${a.agency}` + (reason ? ` — ${reason}` : ''),
  }));
}

function certEvidence(certs: CompanyCertFact[]): EvidenceItem[] {
  return certs.map((c) => ({
    evidence_class: 'government_public' as const,
    role: 'company_side' as const,
    source_kind: 'recipient_certifications',
    source_id: c.code,
    locator: `cert=${c.code};provenance=${c.provenance_state}`,
    as_of: null,
    statement: `${c.label} (${c.authoritative ? 'authoritative' : 'SAM self-identified'})`,
    provenance_state: c.provenance_state,
    authoritative: c.authoritative,
  }));
}

function normalizeCertCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function certMatchesRestriction(cert: CompanyCertFact, codes: string[]): boolean {
  if (!codes.length) {
    // Buyer observed set-aside without specific codes — any socioeconomic cert is a weak match
    return true;
  }
  const c = normalizeCertCode(cert.code);
  return codes.some((raw) => {
    const r = normalizeCertCode(raw);
    if (c === r) return true;
    if (c.includes(r) || r.includes(c)) return true;
    // common aliases
    if ((c === '8A' || c === 'A8A') && (r === '8A' || r.includes('8A'))) return true;
    if (c === 'SDVOSB' && r.includes('SDV')) return true;
    if (c === 'WOSB' && r.includes('WOSB')) return true;
    if ((c === 'HZ' || c === 'HUBZONE') && r.includes('HUB')) return true;
    return false;
  });
}

function missing(
  code: ProofMissingCode,
  statement: string,
  blocks?: ProofMissingItem['blocks_upgrade_to'],
): ProofMissingItem {
  return { code, statement, blocks_upgrade_to: blocks ?? null };
}

function leadFromAwards(awards: CompanyAwardFact[], why: string): ProofLeadItem[] {
  return awards.slice(0, 3).map((a) => ({
    kind: 'award' as const,
    label: a.title,
    piid: a.id,
    customer: a.agency,
    work_description: a.description || a.title,
    obligation: a.amount,
    period: [a.startDate, a.endDate].filter(Boolean).join(' → ') || null,
    naics: a.naics,
    psc: a.psc || null,
    why_related: why,
    citations: companyAwardEvidence([a], why),
  }));
}

function scoreDoor(components: RankComponents): number {
  return (
    10 * components.buyer_certainty +
    10 * components.company_capability +
    8 * components.access_evidence +
    5 * components.recency_relevance -
    components.missing_penalty -
    components.set_aside_opener_penalty
  );
}

function missingPenaltySum(items: ProofMissingItem[]): number {
  let n = 0;
  for (const m of items) {
    if (m.blocks_upgrade_to) n += MISSING_PENALTY[m.code] ?? 1;
  }
  return n;
}

function enforceTwoSided(door: PathwayDoorFit): PathwayDoorFit {
  const positive = door.determination === 'SUPPORTED_FIT' || door.determination === 'POSSIBLE_FIT';
  if (!positive) return door;
  if (door.buyer_evidence.length >= 1 && door.company_evidence.length >= 1) return door;
  return {
    ...door,
    determination: 'NOT_ESTABLISHED',
    why_this_fit: null,
    proof_to_lead_with: [],
    safe_next_actions: [],
    proof_missing: [
      ...door.proof_missing,
      missing(
        door.buyer_evidence.length ? 'capability_relation_unestablished' : 'buyer_door_not_observed',
        'Positive fit requires both buyer-side and company-side stranger-verifiable evidence.',
        'POSSIBLE_FIT',
      ),
    ],
  };
}

function evaluateNym(kind: PathwayDoorKind): PathwayDoorFit {
  const components: RankComponents = {
    buyer_certainty: 0,
    company_capability: 0,
    access_evidence: 0,
    recency_relevance: 0,
    missing_penalty: 3,
    set_aside_opener_penalty: 0,
  };
  return {
    door: kind,
    door_label: DOOR_LABELS[kind],
    determination: 'NOT_ESTABLISHED',
    buyer_evidence: [],
    company_evidence: [],
    why_this_fit: null,
    proof_to_lead_with: [],
    proof_missing: [
      missing(
        'cai_door_not_yet_measurable',
        'Current Acquisition Intelligence has not established this pathway from live records — PATHWAY FIT cannot upgrade it.',
        'POSSIBLE_FIT',
      ),
    ],
    additional_advantages: [],
    safe_next_actions: [],
    rank: { score: scoreDoor(components), components },
  };
}

function evaluateSetAside(
  obs: CaiObservedPathway | null,
  company: CompanyPublicRecord,
  overlap: CapabilityOverlap,
): PathwayDoorFit {
  const door: PathwayDoorKind = 'set_aside';
  const codes = obs?.set_aside_codes || [];
  const matching = company.certifications.filter((c) => certMatchesRestriction(c, codes));

  if (!obs) {
    const components: RankComponents = {
      buyer_certainty: 0,
      company_capability: overlap.level,
      access_evidence: matching.length ? (matching.some((c) => c.authoritative) ? 2 : 1) : 0,
      recency_relevance: 0,
      missing_penalty: 2,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_APPLICABLE',
      buyer_evidence: [],
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing(
          'socioeconomic_restriction_absent',
          'No socioeconomic restriction was observed on this buyer scope — certification alone is not a pathway fit.',
          'POSSIBLE_FIT',
        ),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const buyerEv = buyerEvidenceFromObserved(obs);
  if (!matching.length) {
    const components: RankComponents = {
      buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
      company_capability: overlap.level,
      access_evidence: 0,
      recency_relevance: overlap.level >= 2 ? 2 : overlap.level,
      missing_penalty: 2,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: buyerEv,
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing(
          'capability_relation_unestablished',
          'Buyer scope shows a socioeconomic restriction, but matching SAM certification status was not found for this company.',
          'POSSIBLE_FIT',
        ),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const allAuth = matching.every((c) => c.authoritative);
  const companyEv = certEvidence(matching);
  const proofMissing: ProofMissingItem[] = [
    missing(
      'measurable_outcome_unavailable',
      'Measurable delivery outcome is not established from public records.',
      'SUPPORTED_FIT',
    ),
  ];
  if (!allAuth) {
    proofMissing.unshift(
      missing(
        'cert_self_identified_not_authoritative',
        'Matching status is SAM self-identified — not silently treated as SBA/VetCert authoritative.',
        'SUPPORTED_FIT',
      ),
    );
  }

  const determination: PathwayDetermination = allAuth ? 'SUPPORTED_FIT' : 'POSSIBLE_FIT';
  const components: RankComponents = {
    buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
    company_capability: Math.max(overlap.level, 1) as 0 | 1 | 2,
    access_evidence: allAuth ? 2 : 1,
    recency_relevance: overlap.level >= 2 ? 2 : (overlap.level as 0 | 1 | 2),
    missing_penalty: missingPenaltySum(proofMissing),
    set_aside_opener_penalty: 0,
  };

  return enforceTwoSided({
    door,
    door_label: DOOR_LABELS[door],
    determination,
    buyer_evidence: buyerEv,
    company_evidence: companyEv,
    why_this_fit: allAuth
      ? 'This buyer scope shows a socioeconomic restriction and your SAM record verifies a matching status with authoritative provenance.'
      : 'This buyer scope shows a socioeconomic restriction and your SAM record shows a matching status, but provenance is self-identified rather than authoritative.',
    proof_to_lead_with: matching.slice(0, 2).map((c) => ({
      kind: 'certification' as const,
      label: `${c.label} (${c.authoritative ? 'authoritative' : 'self-identified'})`,
      why_related: 'Matches the socioeconomic restriction observed on this buyer scope.',
      citations: certEvidence([c]),
    })),
    proof_missing: proofMissing,
    additional_advantages: [],
    safe_next_actions: [
      allAuth
        ? 'Treat the socioeconomic-restricted path as one eligible route — not the automatic opener if other doors exist.'
        : 'Confirm whether VetCert/SBA certification can be verified before relying on this route.',
    ],
    rank: { score: scoreDoor(components), components },
  });
}

function evaluateIdv(
  obs: CaiObservedPathway | null,
  company: CompanyPublicRecord,
  overlap: CapabilityOverlap,
): PathwayDoorFit {
  const door: PathwayDoorKind = 'idv_task_order';
  if (!obs) {
    const components: RankComponents = {
      buyer_certainty: 0,
      company_capability: overlap.level,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 2,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: [],
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing('buyer_door_not_observed', 'No vehicle / task-order pathway was observed in the CAI package.', 'POSSIBLE_FIT'),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const buyerEv = buyerEvidenceFromObserved(obs);
  if (overlap.level === 0) {
    const components: RankComponents = {
      buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
      company_capability: 0,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 3,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: buyerEv,
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing(
          'capability_relation_unestablished',
          'Buyer evidence shows a vehicle/task-order path, but no related public performance was found for this company.',
          'POSSIBLE_FIT',
        ),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const holds = company.verified_vehicle_holds.filter(Boolean);
  const verifiedHold = holds.length > 0;
  const proofMissing: ProofMissingItem[] = [
    missing(
      'measurable_outcome_unavailable',
      'Measurable outcome on the related awards is not established from public records.',
      'SUPPORTED_FIT',
    ),
  ];
  if (!verifiedHold) {
    proofMissing.unshift(
      missing(
        'vehicle_access_unverified',
        'Vehicle access is not verified from public evidence — do not claim you can bid this vehicle.',
        'SUPPORTED_FIT',
      ),
    );
  }

  const determination: PathwayDetermination = verifiedHold ? 'SUPPORTED_FIT' : 'POSSIBLE_FIT';
  const companyEv = companyAwardEvidence(overlap.awards, overlap.reason);
  const components: RankComponents = {
    buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
    company_capability: overlap.level,
    access_evidence: verifiedHold ? 2 : 0,
    recency_relevance: overlap.level >= 2 ? 2 : 1,
    missing_penalty: missingPenaltySum(proofMissing),
    set_aside_opener_penalty: 0,
  };

  return enforceTwoSided({
    door,
    door_label: DOOR_LABELS[door],
    determination,
    buyer_evidence: buyerEv,
    company_evidence: companyEv,
    why_this_fit: verifiedHold
      ? 'Buyer records show work moving through a vehicle/task-order path, and public evidence verifies vehicle access alongside related performance.'
      : "Your record fits this work, but I can't verify that you hold this vehicle. The evidence supports investigating a teaming route.",
    proof_to_lead_with: leadFromAwards(overlap.awards, overlap.reason),
    proof_missing: proofMissing,
    additional_advantages: [],
    safe_next_actions: verifiedHold
      ? ['Confirm the named vehicle still covers the buyer’s requirement before pursuit.']
      : ['Investigate teaming with a verified vehicle holder rather than assuming direct access.'],
    rank: { score: scoreDoor(components), components },
  });
}

function evaluateCso(
  obs: CaiObservedPathway | null,
  company: CompanyPublicRecord,
  overlap: CapabilityOverlap,
): PathwayDoorFit {
  const door: PathwayDoorKind = 'cso';
  if (!obs) {
    const components: RankComponents = {
      buyer_certainty: 0,
      company_capability: overlap.level,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 2,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: [],
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing('buyer_door_not_observed', 'No Commercial Solutions Opening pathway was observed in the CAI package.', 'POSSIBLE_FIT'),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const buyerEv = buyerEvidenceFromObserved(obs);
  if (overlap.level === 0) {
    const components: RankComponents = {
      buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
      company_capability: 0,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 3,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: buyerEv,
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing(
          'capability_relation_unestablished',
          'CSO is observed for the buyer, but no related public performance was found for this company.',
          'POSSIBLE_FIT',
        ),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  // v0: demonstrable product never established from public awards alone
  const proofMissing: ProofMissingItem[] = [
    missing(
      'demonstrable_product_unestablished',
      'A demonstrable product/prototype ready for this pathway is not established from public evidence.',
      'SUPPORTED_FIT',
    ),
    missing(
      'measurable_outcome_unavailable',
      'Measurable outcome is not established from public records.',
      'SUPPORTED_FIT',
    ),
  ];
  if (overlap.level < 2) {
    proofMissing.unshift(
      missing('cso_topic_fit_weak', 'Related public work is only weakly tied to this CSO capability topic.', 'SUPPORTED_FIT'),
    );
  }

  const components: RankComponents = {
    buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
    company_capability: overlap.level,
    access_evidence: 1, // related awards only — level 2 blocked in v0
    recency_relevance: overlap.level >= 2 ? 2 : 1,
    missing_penalty: missingPenaltySum(proofMissing),
    set_aside_opener_penalty: 0,
  };

  return enforceTwoSided({
    door,
    door_label: DOOR_LABELS[door],
    determination: 'POSSIBLE_FIT',
    buyer_evidence: buyerEv,
    company_evidence: companyAwardEvidence(overlap.awards, overlap.reason),
    why_this_fit:
      "Your record makes this worth investigating, but I can't establish that you have a demonstrable solution ready for this pathway.",
    proof_to_lead_with: leadFromAwards(overlap.awards, overlap.reason),
    proof_missing: proofMissing,
    additional_advantages: [],
    safe_next_actions: ['Treat as a pitch/demo candidate only after confirming a working capability you can show.'],
    rank: { score: scoreDoor(components), components },
  });
}

function evaluateOt(
  obs: CaiObservedPathway | null,
  company: CompanyPublicRecord,
  overlap: CapabilityOverlap,
): PathwayDoorFit {
  const door: PathwayDoorKind = 'other_transaction';
  if (!obs) {
    const components: RankComponents = {
      buyer_certainty: 0,
      company_capability: overlap.level,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 2,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: [],
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing('buyer_door_not_observed', 'No other-transaction pathway was observed in the CAI package.', 'POSSIBLE_FIT'),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const buyerEv = buyerEvidenceFromObserved(obs);
  // Never infer nontraditional from certs/size/awards
  void company.certifications;

  if (overlap.level === 0) {
    const components: RankComponents = {
      buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
      company_capability: 0,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 3,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: buyerEv,
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing(
          'capability_relation_unestablished',
          'OT is observed for the buyer, but no related public performance was found for this company.',
          'POSSIBLE_FIT',
        ),
        missing(
          'ot_nontraditional_status_unestablished',
          'Nontraditional / OT eligibility status is not established (not inferred from size, certification, age, or award history).',
          'POSSIBLE_FIT',
        ),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const proofMissing: ProofMissingItem[] = [
    missing(
      'ot_nontraditional_status_unestablished',
      'Nontraditional / OT eligibility status is not established (not inferred from size, certification, age, or award history).',
      'SUPPORTED_FIT',
    ),
    missing(
      'measurable_outcome_unavailable',
      'Measurable outcome is not established from public records.',
      'SUPPORTED_FIT',
    ),
  ];

  if (company.ot_nontraditional_established) {
    // Still max POSSIBLE without richer OT eligibility — v0 has no full OT suitability model
    proofMissing[0] = missing(
      'ot_nontraditional_status_unestablished',
      'Nontraditional signal noted, but full OT suitability is not established in v0.',
      'SUPPORTED_FIT',
    );
  }

  const components: RankComponents = {
    buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
    company_capability: overlap.level,
    access_evidence: company.ot_nontraditional_established ? 1 : 0,
    recency_relevance: overlap.level >= 2 ? 2 : 1,
    missing_penalty: missingPenaltySum(proofMissing),
    set_aside_opener_penalty: 0,
  };

  return enforceTwoSided({
    door,
    door_label: DOOR_LABELS[door],
    determination: 'POSSIBLE_FIT',
    buyer_evidence: buyerEv,
    company_evidence: companyAwardEvidence(overlap.awards, overlap.reason),
    why_this_fit:
      'Buyer records show an other-transaction path and your public record shows related work, but OT eligibility/nontraditional status is not fully established.',
    proof_to_lead_with: leadFromAwards(overlap.awards, overlap.reason),
    proof_missing: proofMissing,
    additional_advantages: [],
    safe_next_actions: ['Confirm OT eligibility / nontraditional status from a verifiable source before treating this as a primary route.'],
    rank: { score: scoreDoor(components), components },
  });
}

function evaluateConventional(
  obs: CaiObservedPathway | null,
  company: CompanyPublicRecord,
  overlap: CapabilityOverlap,
): PathwayDoorFit {
  const door: PathwayDoorKind = 'conventional_solicitation';
  if (!obs) {
    const components: RankComponents = {
      buyer_certainty: 0,
      company_capability: overlap.level,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 2,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: [],
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing('buyer_door_not_observed', 'No conventional solicitation pathway was observed in the CAI package.', 'POSSIBLE_FIT'),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const buyerEv = buyerEvidenceFromObserved(obs);
  if (overlap.level === 0) {
    const components: RankComponents = {
      buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
      company_capability: 0,
      access_evidence: 0,
      recency_relevance: 0,
      missing_penalty: 3,
      set_aside_opener_penalty: 0,
    };
    return enforceTwoSided({
      door,
      door_label: DOOR_LABELS[door],
      determination: 'NOT_ESTABLISHED',
      buyer_evidence: buyerEv,
      company_evidence: [],
      why_this_fit: null,
      proof_to_lead_with: [],
      proof_missing: [
        missing(
          'past_performance_weak_or_distant',
          'Conventional path is observed, but related public performance was not found for this company.',
          'POSSIBLE_FIT',
        ),
      ],
      additional_advantages: [],
      safe_next_actions: [],
      rank: { score: scoreDoor(components), components },
    });
  }

  const proofMissing: ProofMissingItem[] = [
    missing(
      'measurable_outcome_unavailable',
      'Measurable outcome is not established from public records — related awards show transaction history, not win quality.',
      'SUPPORTED_FIT',
    ),
    missing(
      'delivery_speed_unavailable',
      'Delivery speed is not established from public records.',
      'SUPPORTED_FIT',
    ),
  ];
  if (overlap.level < 2) {
    proofMissing.unshift(
      missing(
        'past_performance_weak_or_distant',
        'Related public performance is only weakly tied or outside the preferred recency window.',
        'SUPPORTED_FIT',
      ),
    );
  }

  const determination: PathwayDetermination = overlap.level >= 2 ? 'SUPPORTED_FIT' : 'POSSIBLE_FIT';
  const components: RankComponents = {
    buyer_certainty: (obs.evidence_count ?? 1) >= 2 ? 2 : 1,
    company_capability: overlap.level,
    access_evidence: overlap.level > 0 ? 2 : 0,
    recency_relevance: overlap.level >= 2 ? 2 : 1,
    missing_penalty: missingPenaltySum(proofMissing),
    set_aside_opener_penalty: 0,
  };

  return enforceTwoSided({
    door,
    door_label: DOOR_LABELS[door],
    determination,
    buyer_evidence: buyerEv,
    company_evidence: companyAwardEvidence(overlap.awards, overlap.reason),
    why_this_fit:
      determination === 'SUPPORTED_FIT'
        ? 'Buyer records show a conventional solicitation path and your public federal performance relates to this capability. That is pathway relevance — not a win forecast.'
        : 'Buyer records show a conventional path and there is some related public performance, but the capability link is only partial.',
    proof_to_lead_with: leadFromAwards(overlap.awards, overlap.reason),
    proof_missing: proofMissing,
    additional_advantages: [],
    safe_next_actions: ['Use related awards as proof of relevant federal work when engaging — do not claim a win forecast.'],
    rank: { score: scoreDoor(components), components },
  });
}

function applySetAsideOpenerPenalty(doors: PathwayDoorFit[]): void {
  const positive = doors.filter(
    (d) => d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT',
  );
  const hasNonSetAsidePositive = positive.some((d) => d.door !== 'set_aside');
  for (const d of doors) {
    if (d.door !== 'set_aside') continue;
    if (!hasNonSetAsidePositive) continue;
    if (d.determination !== 'SUPPORTED_FIT' && d.determination !== 'POSSIBLE_FIT') continue;
    d.rank.components.set_aside_opener_penalty = 5;
    d.rank.score = scoreDoor(d.rank.components);
  }
}

function sortDoors(doors: PathwayDoorFit[]): PathwayDoorFit[] {
  return [...doors].sort((a, b) => {
    if (b.rank.score !== a.rank.score) return b.rank.score - a.rank.score;
    return TIE_ORDER.indexOf(a.door) - TIE_ORDER.indexOf(b.door);
  });
}

function buildAdditionalAdvantages(
  company: CompanyPublicRecord,
  doors: PathwayDoorFit[],
): void {
  const setAsidePositive = doors.some(
    (d) =>
      d.door === 'set_aside' &&
      (d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT'),
  );
  if (setAsidePositive) return;
  if (!company.certifications.length) return;

  const advantages: AdditionalAdvantage[] = company.certifications.map((c) => ({
    kind: 'certification' as const,
    statement: `Your SAM record shows ${c.label} (${c.authoritative ? 'authoritative' : 'SAM self-identified'}). That matters if this acquisition is restricted or the buyer chooses that route; it is not why another pathway is listed.`,
    not_the_pathway_reason: true as const,
    citations: certEvidence([c]),
  }));

  for (const d of doors) {
    if (d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT') {
      if (d.door === 'set_aside') continue;
      d.additional_advantages = advantages;
    }
  }
}

/** Codes that can change a no_proven_door determination if the customer answers. */
const HONEST_MISS_ACTIONABLE: ProofMissingCode[] = [
  'vehicle_access_unverified',
  'demonstrable_product_unestablished',
];

function promptForMissingCode(code: ProofMissingCode): string | null {
  if (code === 'vehicle_access_unverified') {
    return 'Are you currently on this vehicle, or do you have a teaming relationship with a holder?';
  }
  if (code === 'demonstrable_product_unestablished') {
    return 'Do you have a working capability you can demonstrate today?';
  }
  if (code === 'measurable_outcome_unavailable') {
    return 'What measurable result did your team produce on this work?';
  }
  if (code === 'ot_nontraditional_status_unestablished') {
    return 'Can you point to a verifiable source that establishes your OT / nontraditional eligibility for this path?';
  }
  if (code === 'cert_self_identified_not_authoritative') {
    return 'Can you confirm SBA or VetCert certification for the socioeconomic status that matches this restriction?';
  }
  return null;
}

function nextFromCodes(
  doors: PathwayDoorFit[],
  codes: ProofMissingCode[],
): MatchCompanyToPathwaysResult['_next'] {
  for (const code of codes) {
    for (const d of doors) {
      const hit = d.proof_missing.find((m) => m.code === code);
      if (!hit) continue;
      if (code === 'cert_self_identified_not_authoritative' && d.door !== 'set_aside') continue;
      const prompt = promptForMissingCode(code);
      if (!prompt) continue;
      return [{ prompt, requires_confirmation: true }];
    }
  }
  return [];
}

/**
 * Presentation `_next` only — does not change determinations.
 * no_proven_door: at most one evidence-changing question, else none (not a research menu).
 */
export function buildPathwayFitNext(
  doors: PathwayDoorFit[],
  company: CompanyPublicRecord,
): MatchCompanyToPathwaysResult['_next'] {
  if (!company.uei) {
    return [
      {
        prompt: 'What’s your company name? I match public federal records from that — you don’t need contracting jargon.',
        requires_confirmation: true,
      },
    ];
  }

  const positive = doors.filter(
    (d) => d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT',
  );
  const noProven = positive.length === 0;

  if (noProven) {
    // Honest miss is complete. Only ask if a proof_missing item could open a door.
    return nextFromCodes(sortDoors(doors), HONEST_MISS_ACTIONABLE);
  }

  const ranked = sortDoors(positive);
  const priorityCodes: ProofMissingCode[] = [
    'company_identity_unresolved',
    'vehicle_access_unverified',
    'demonstrable_product_unestablished',
    'ot_nontraditional_status_unestablished',
    'measurable_outcome_unavailable',
    'cert_self_identified_not_authoritative',
    'capability_relation_unestablished',
  ];
  const hit = nextFromCodes(ranked, priorityCodes);
  if (hit.length) return hit;
  return [
    {
      prompt: 'What measurable result did your team produce on this work?',
      requires_confirmation: true,
    },
  ];
}

function headlineFor(summary: {
  no_proven_door: boolean;
  supported_count: number;
  possible_count: number;
}): string {
  if (summary.no_proven_door) {
    return 'I don’t have enough evidence to establish an acquisition door for this company yet.';
  }
  if (summary.supported_count > 0) {
    return 'Here are the doors I can actually support from the evidence.';
  }
  return 'Here are the doors worth investigating from the evidence — each still has proof I cannot verify.';
}

/**
 * Pure matcher. Pass a pre-resolved company public record (fixtures or live loader).
 */
export function matchCompanyToPathwaysPure(
  cai: CaiPackageSlim,
  company: CompanyPublicRecord,
  opts?: { include_owner_asserted?: boolean; now?: Date },
): MatchCompanyToPathwaysResult {
  const now = opts?.now ?? new Date();
  const overlap = scoreCapabilityOverlap(company, cai, now);

  const observedByKind = new Map<PathwayDoorKind, CaiObservedPathway>();
  for (const o of cai.pathways.observed) observedByKind.set(o.kind, o);

  const nymKinds = new Set<PathwayDoorKind>([
    ...NYM_DOOR_KINDS,
    ...cai.pathways.potential_not_established.map((p) => p.kind),
  ]);

  const doors: PathwayDoorFit[] = [];

  // Always evaluate the five establishable kinds
  doors.push(evaluateConventional(observedByKind.get('conventional_solicitation') || null, company, overlap));
  doors.push(evaluateIdv(observedByKind.get('idv_task_order') || null, company, overlap));
  doors.push(evaluateCso(observedByKind.get('cso') || null, company, overlap));
  doors.push(evaluateOt(observedByKind.get('other_transaction') || null, company, overlap));
  doors.push(evaluateSetAside(observedByKind.get('set_aside') || null, company, overlap));

  // NYM kinds from CAI potential / always-blocked
  for (const kind of nymKinds) {
    if (doors.some((d) => d.door === kind)) continue;
    doors.push(evaluateNym(kind));
  }

  // If CAI listed a NYM kind as observed (should not happen) — still force NOT_ESTABLISHED
  for (const o of cai.pathways.observed) {
    if ((NYM_DOOR_KINDS as readonly string[]).includes(o.kind)) {
      const idx = doors.findIndex((d) => d.door === o.kind);
      if (idx >= 0) doors[idx] = evaluateNym(o.kind);
    }
  }

  applySetAsideOpenerPenalty(doors);
  buildAdditionalAdvantages(company, doors);
  const sorted = sortDoors(doors);

  const supported_count = sorted.filter((d) => d.determination === 'SUPPORTED_FIT').length;
  const possible_count = sorted.filter((d) => d.determination === 'POSSIBLE_FIT').length;
  const not_established_count = sorted.filter((d) => d.determination === 'NOT_ESTABLISHED').length;
  const not_applicable_count = sorted.filter((d) => d.determination === 'NOT_APPLICABLE').length;
  const no_proven_door = supported_count === 0 && possible_count === 0;

  const summary = {
    headline: '',
    no_proven_door,
    supported_count,
    possible_count,
    not_established_count,
    not_applicable_count,
  };
  summary.headline = headlineFor(summary);

  let owner_asserted_context: MatchCompanyToPathwaysResult['owner_asserted_context'];
  if (opts?.include_owner_asserted && company.owner_asserted) {
    const items: Array<{ kind: string; statement: string }> = [];
    for (const o of company.owner_asserted.outcomes || []) {
      items.push({ kind: 'outcome', statement: o });
    }
    for (const v of company.owner_asserted.claimed_vehicles || []) {
      items.push({ kind: 'claimed_vehicle', statement: v });
    }
    if (company.owner_asserted.claimed_demo_ready) {
      items.push({ kind: 'claimed_demo', statement: 'Owner asserts demonstrable product readiness.' });
    }
    owner_asserted_context = {
      shown: items.length > 0,
      items,
      disclaimer: OWNER_ASSERTED_DISCLAIMER,
    };
  }

  return {
    company: {
      uei: company.uei,
      legal_name: company.legal_name,
      cage: company.cage,
      identity_source: company.identity_source,
      certifications: company.certifications,
    },
    buyer_context: {
      agency: cai.scope.agency,
      office: cai.scope.office ?? null,
      capability: cai.scope.capability,
      cai_as_of: cai.as_of ?? null,
      observed_door_kinds: cai.pathways.observed.map((o) => o.kind),
      not_yet_measurable_kinds: [...nymKinds],
    },
    doors: sorted,
    summary,
    owner_asserted_context,
    _meta: {
      grounded: Boolean(company.uei) && cai.pathways.observed.length + cai.pathways.potential_not_established.length > 0,
      degraded: false,
      journey: 'pathway_fit',
      epistemic_note: 'two_sided_evidence_required; talent_forbidden_v0; no_vehicle_portfolio_invention',
      sources_queried: ['cai_package', 'company_public_record'],
      sources_failed: [],
      ranking_rule_version: 'pf_rank_v1',
      next_outputs_not_yet: [
        'full_talent',
        'win_claim',
        'vehicle_portfolio',
        'demo_readiness_verified',
        'measurable_outcome_verified',
      ],
    },
    _next: buildPathwayFitNext(sorted, company),
    presentation: {
      host_rules: [...HOST_RULES_PATHWAY_FIT],
      sections: no_proven_door
        ? {
            honest_miss: {
              display_title: 'No door I can prove yet',
              provenance_label:
                'Based on the evidence available, I cannot responsibly connect this company to one of the buyer’s observed acquisition paths.',
            },
            verify: {
              display_title: 'What I can verify',
              provenance_label: 'Buyer-side and company-side public evidence that exists — not a pathway fit',
            },
            missing: {
              display_title: "What's missing",
              provenance_label: 'Exact proof_missing items preventing a positive determination',
            },
            would_change: {
              display_title: 'What would change the answer',
              provenance_label: 'The smallest evidence class that could change this determination — not a research menu',
            },
          }
        : {
            doors: {
              display_title: 'Here are the doors I can actually support from the evidence',
              provenance_label: 'Two-sided: CAI buyer doors + stranger-verifiable company record',
            },
            proof: {
              display_title: 'What proves it',
              provenance_label: 'Government / public evidence only',
            },
            talent_verified: {
              display_title: 'What proof I can verify',
              provenance_label: 'Stranger-verifiable public records only — not owner-asserted',
            },
            talent_missing: {
              display_title: "What's missing",
              provenance_label: 'The single most important proof gap — one question, not a questionnaire',
            },
            missing: {
              display_title: 'What I cannot verify',
              provenance_label: 'Blocks upgrade — drives the next question',
            },
          },
    },
  };
}

/** Strip buyer or company evidence for red-team (mutates a deep copy). */
export function stripEvidenceSide(
  result: MatchCompanyToPathwaysResult,
  side: 'buyer' | 'company',
): MatchCompanyToPathwaysResult {
  const doors = result.doors.map((d) => {
    const next = {
      ...d,
      buyer_evidence: side === 'buyer' ? [] : [...d.buyer_evidence],
      company_evidence: side === 'company' ? [] : [...d.company_evidence],
    };
    return enforceTwoSided(next);
  });
  const supported_count = doors.filter((d) => d.determination === 'SUPPORTED_FIT').length;
  const possible_count = doors.filter((d) => d.determination === 'POSSIBLE_FIT').length;
  const no_proven_door = supported_count === 0 && possible_count === 0;
  const nextDoors = sortDoors(doors);
  return {
    ...result,
    doors: nextDoors,
    summary: {
      ...result.summary,
      supported_count,
      possible_count,
      no_proven_door,
      headline: headlineFor({
        no_proven_door,
        supported_count,
        possible_count,
      }),
    },
    _next: buildPathwayFitNext(nextDoors, {
      uei: result.company.uei,
      legal_name: result.company.legal_name,
      cage: result.company.cage,
      identity_source: result.company.identity_source,
      certifications: result.company.certifications,
      awards: [],
      verified_vehicle_holds: [],
      ot_nontraditional_established: false,
    }),
  };
}

export function caiContextRequiredResult(): MatchCompanyToPathwaysResult {
  return {
    company: {
      uei: null,
      legal_name: null,
      cage: null,
      identity_source: 'unresolved',
      certifications: [],
    },
    buyer_context: {
      agency: '',
      office: null,
      capability: '',
      cai_as_of: null,
      observed_door_kinds: [],
      not_yet_measurable_kinds: [],
    },
    doors: [],
    summary: {
      headline: 'Pass the Current Acquisition Intelligence package so I can match doors without re-deriving them.',
      no_proven_door: true,
      supported_count: 0,
      possible_count: 0,
      not_established_count: 0,
      not_applicable_count: 0,
    },
    _meta: {
      grounded: false,
      degraded: false,
      journey: 'pathway_fit',
      epistemic_note: 'cai_context_required',
      sources_queried: [],
      sources_failed: [],
      ranking_rule_version: 'pf_rank_v1',
      next_outputs_not_yet: ['full_talent'],
      error: 'cai_context_required',
    },
    _next: [
      {
        prompt: 'Run Current Acquisition Intelligence for this buyer and capability first, then I can match your company’s public record to those doors.',
        requires_confirmation: true,
        tool: 'get_current_acquisition_intelligence',
      },
    ],
    presentation: {
      host_rules: [...HOST_RULES_PATHWAY_FIT],
      sections: {},
    },
  };
}
