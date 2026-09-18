/**
 * Derive a sub-agency / command for a federal contact when SAM doesn't store
 * one (sub_tier/office are 0% populated for the big agencies).
 *
 * Two HINTS exist: the solicitation-number prefix (a fact about the NOTICE)
 * and the email domain (a fact about the MAILBOX). Email domain alone must
 * never decide correctness — a @dla.mil address on a DARPA notice is a
 * routing oddity to FLAG, not a reason to relabel the contact as DLA or to
 * drop them from DARPA. Solicitation prefix is source evidence; email is a
 * hint. When they disagree, report the conflict instead of picking.
 */

// Email domain → sub-agency label. Longest-match wins (us.af.mil before af.mil).
const DOMAIN_MAP: Array<[RegExp, string]> = [
  [/(^|\.)af\.mil$/i, 'Air Force'],
  [/(^|\.)navy\.mil$/i, 'Navy'],
  [/(^|\.)usmc\.mil$/i, 'Marine Corps'],
  [/usace\.army\.mil$/i, 'Army Corps of Engineers'],
  [/(^|\.)army\.mil$/i, 'Army'],
  [/(^|\.)dla\.mil$/i, 'Defense Logistics Agency'],
  [/(^|\.)health\.mil$/i, 'Defense Health Agency'],
  [/(^|\.)dhs\.gov$/i, 'DHS HQ'],
  [/uscg\.mil$/i, 'Coast Guard'],
  [/cbp\.dhs\.gov$/i, 'Customs & Border Protection'],
  [/fema\.dhs\.gov$/i, 'FEMA'],
  [/ice\.dhs\.gov$/i, 'ICE'],
  [/tsa\.dhs\.gov$/i, 'TSA'],
  [/va\.gov$/i, 'Veterans Affairs'],
  [/nih\.gov$/i, 'NIH'],
  [/cdc\.gov$/i, 'CDC'],
  [/fda\.hhs\.gov$/i, 'FDA'],
  [/cms\.hhs\.gov$/i, 'CMS'],
  // --- Interior bureaus ---
  [/(^|\.)nps\.gov$/i, 'National Park Service'],
  [/(^|\.)blm\.gov$/i, 'Bureau of Land Management'],
  [/(^|\.)fws\.gov$/i, 'Fish and Wildlife Service'],
  [/(^|\.)usgs\.gov$/i, 'Geological Survey'],
  [/(^|\.)usbr\.gov$/i, 'Bureau of Reclamation'],
  [/(^|\.)bia\.gov$/i, 'Bureau of Indian Affairs'],
  [/(^|\.)boem\.gov$/i, 'Bureau of Ocean Energy Management'],
  // --- USDA agencies ---
  [/(^|\.)fs\.usda\.gov$/i, 'Forest Service'],
  [/(^|\.)fs\.fed\.us$/i, 'Forest Service'],
  [/(^|\.)nrcs\.usda\.gov$/i, 'Natural Resources Conservation Service'],
  [/(^|\.)aphis\.usda\.gov$/i, 'Animal and Plant Health Inspection Service'],
  [/(^|\.)ars\.usda\.gov$/i, 'Agricultural Research Service'],
  [/(^|\.)fsa\.usda\.gov$/i, 'Farm Service Agency'],
  [/(^|\.)rd\.usda\.gov$/i, 'Rural Development'],
  // --- Energy labs / offices ---
  [/(^|\.)netl\.doe\.gov$/i, 'National Energy Technology Laboratory'],
  [/(^|\.)inl\.gov$/i, 'Idaho National Laboratory'],
  [/(^|\.)bnl\.gov$/i, 'Brookhaven National Laboratory'],
  [/(^|\.)ornl\.gov$/i, 'Oak Ridge National Laboratory'],
  [/(^|\.)lanl\.gov$/i, 'Los Alamos National Laboratory'],
  [/(^|\.)nnsa\.doe\.gov$/i, 'National Nuclear Security Administration'],
  // --- DOT ---
  [/(^|\.)faa\.gov$/i, 'Federal Aviation Administration'],
  [/(^|\.)fhwa\.dot\.gov$/i, 'Federal Highway Administration'],
  [/(^|\.)fta\.dot\.gov$/i, 'Federal Transit Administration'],
  // --- Treasury / Justice / others with own domains ---
  [/(^|\.)irs\.gov$/i, 'Internal Revenue Service'],
  [/(^|\.)bop\.gov$/i, 'Bureau of Prisons'],
  [/(^|\.)usdoj\.gov$/i, 'Justice HQ'],
  [/(^|\.)fbi\.gov$/i, 'FBI'],
];

// Solicitation-number prefix → sub-agency. DoD-heavy (the prefixes are codified
// in the DoD Activity Address Code system). Fallback when the email is generic.
const PREFIX_MAP: Array<[RegExp, string]> = [
  [/^FA/i, 'Air Force'],
  [/^F[BDQ]/i, 'Air Force'],
  [/^N0|^N4|^N6|^N3|^N5/i, 'Navy'],
  [/^M[0-9]/i, 'Marine Corps'],
  [/^W[0-9A-Z]/i, 'Army'],
  [/^SP/i, 'Defense Logistics Agency'],
  [/^HT/i, 'Defense Health Agency'],
  [/^HC|^HQ/i, 'DISA / DoD HQ'],
];

export type SubAgencyEvidence = 'solicitation_prefix' | 'email_domain' | 'both_agree' | 'conflict' | 'none';

export interface SubAgencyDerivation {
  /** Display label. Prefix wins when present. Null when neither signal fired. */
  label: string | null;
  from_prefix: string | null;
  from_email: string | null;
  evidence: SubAgencyEvidence;
  /** True when the label is a hint (email-only) or the two signals disagree. */
  uncertain: boolean;
}

function labelFromDomain(email: string | null): string | null {
  const domain = (email || '').split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  for (const [re, label] of DOMAIN_MAP) {
    if (re.test(domain)) return label;
  }
  return null;
}

function labelFromPrefix(solicitationNumber: string | null): string | null {
  const sol = (solicitationNumber || '').trim();
  if (!sol) return null;
  for (const [re, label] of PREFIX_MAP) {
    if (re.test(sol)) return label;
  }
  return null;
}

export function deriveSubAgencyEvidence(
  email: string | null,
  solicitationNumber: string | null,
): SubAgencyDerivation {
  const from_prefix = labelFromPrefix(solicitationNumber);
  const from_email = labelFromDomain(email);
  if (from_prefix && from_email) {
    if (from_prefix === from_email) {
      return { label: from_prefix, from_prefix, from_email, evidence: 'both_agree', uncertain: false };
    }
    return {
      label: from_prefix,
      from_prefix,
      from_email,
      evidence: 'conflict',
      uncertain: true,
    };
  }
  if (from_prefix) {
    return { label: from_prefix, from_prefix, from_email, evidence: 'solicitation_prefix', uncertain: false };
  }
  if (from_email) {
    return { label: from_email, from_prefix, from_email, evidence: 'email_domain', uncertain: true };
  }
  return { label: null, from_prefix: null, from_email: null, evidence: 'none', uncertain: false };
}

/** Display label only. Prefix (notice) wins; email-only is a hint, not a verdict. */
export function deriveSubAgency(email: string | null, solicitationNumber: string | null): string | null {
  return deriveSubAgencyEvidence(email, solicitationNumber).label;
}
