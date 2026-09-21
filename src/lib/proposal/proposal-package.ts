/**
 * Full 4-volume IDIQ/MACC proposal package assembler.
 *
 * Ties the pieces together into the complete copy-paste-ready package people
 * can't structure themselves:
 *   Volume I   — Technical          (assembleTechnicalVolume, #6)
 *   Volume II  — Past Performance   (the labeled reference-project format, reused
 *                                    from the LOI template — one source of truth)
 *   Volume III — Pricing            (price schedule placeholders)
 *   Volume IV  — Solicitation, Offer & Award (SF1442 / reps & certs checklist)
 *
 * Structure is driven by the compliance matrix (#5): each volume renders only
 * if the RFP requires it (or includeOptional shows the full canonical set), and
 * every volume opens with the compliance requirements it must satisfy so the
 * user knows it traces to THIS solicitation.
 *
 * Deterministic — the format + placeholders. Narrative drafting is a separate
 * optional pass. (Memory: proposal_assist_v1; builds on #4/#5/#6.)
 */

import type { ComplianceReq } from './section-alignment';
import { buildProposalStructure, type ProposalStructure } from './proposal-structure';
import { assembleTechnicalVolume } from './volume1-technical';
import { relevantExperienceBlock } from './loi-template';
import type { VaultContext } from './types';

const ph = (label: string) => `[${label}]`;

function reqLines(reqs: ComplianceReq[]): string {
  if (!reqs.length) return '';
  return reqs.map((r) => {
    const ref = r.section ? `${r.section} — ` : '';
    return `  • ${ref}${(r.requirement || '').slice(0, 120)}`;
  }).join('\n');
}

function volumeIII(structure: ProposalStructure): string {
  const vol = structure.volumes.find((v) => v.key === 'vol3_pricing');
  const reqs = vol?.sections[0]?.requirements || [];
  const lines = ['3.0  Volume III — Pricing', ''];
  if (reqs.length) { lines.push('Requirements this volume satisfies:', reqLines(reqs), ''); }
  lines.push(
    '3.1  Price / Cost Schedule',
    `    ${ph('Complete every CLIN / line item in the solicitation\'s pricing schedule (Schedule B / SF1449 continuation). Enter unit prices, quantities, and extended totals. Do NOT leave a priced line blank — an incomplete price schedule is non-responsive.')}`,
    '',
    '3.2  Basis of Pricing',
    `    ${ph('Briefly state how prices were built up (labor rates, material, equipment, overhead, profit) if the RFP requests a cost narrative. For a firm-fixed-price IDIQ, a short statement that prices are complete and valid for the stated period is usually enough.')}`,
    '',
    '3.3  Price Validity',
    `    ${ph('State the period your prices remain valid (e.g. 90 days from submission).')}`,
  );
  return lines.join('\n');
}

function volumeIV(structure: ProposalStructure): string {
  const vol = structure.volumes.find((v) => v.key === 'vol4_forms');
  const reqs = vol?.sections[0]?.requirements || [];
  const lines = ['4.0  Volume IV — Solicitation, Offer & Award', ''];
  if (reqs.length) { lines.push('Forms / representations this volume requires:', reqLines(reqs), ''); }
  lines.push(
    '4.1  Standard Forms',
    `    ${ph('Sign and complete SF1442 (or SF1449 for commercial), blocks for offer and award.')}`,
    '',
    '4.2  Representations & Certifications',
    `    ${ph('Complete FAR 52.204-8 / 52.212-3 reps & certs, or confirm they are current in SAM.gov. List any solicitation-specific provisions (e.g. 52.219, 52.222) the RFP requires.')}`,
    '',
    '4.3  Acknowledgment of Amendments',
    `    ${ph('Acknowledge every amendment (SF30) issued — list amendment numbers and dates.')}`,
  );
  return lines.join('\n');
}

export interface ProposalPackageInput {
  requirements: ComplianceReq[];
  vault: VaultContext | null;
  includeOptional?: boolean;
}

export interface ProposalPackageResult {
  /** The full package text, volumes separated by form-feed markers. */
  text: string;
  /** Per-volume text so the export can page-break between volumes. */
  volumes: Array<{ title: string; text: string }>;
  exampleDocTypes: string[];
  critical: ComplianceReq[];
  crossCutting: ComplianceReq[];
}

export function assembleProposalPackage(opts: ProposalPackageInput): ProposalPackageResult {
  const structure = buildProposalStructure(opts.requirements);
  const exampleDocTypes = new Set<string>();

  // Volume I — Technical (#6)
  const tech = assembleTechnicalVolume({ structure, vault: opts.vault, includeOptional: opts.includeOptional });
  tech.exampleDocTypes.forEach((t) => exampleDocTypes.add(t));

  // Volume II — Past Performance: reuse the LOI labeled reference-project block.
  const ppVol = structure.volumes.find((v) => v.key === 'vol2_past_performance');
  const ppReqs = ppVol?.sections[0]?.requirements || [];
  const volIILines = ['2.0  Volume II — Past Performance', ''];
  if (ppReqs.length) { volIILines.push('Requirements this volume satisfies:', reqLines(ppReqs), ''); }
  volIILines.push(relevantExperienceBlock(opts.vault));
  exampleDocTypes.add('past_performance');

  const volumes = [
    { title: 'Volume I — Technical', text: tech.text },
    { title: 'Volume II — Past Performance', text: volIILines.join('\n') },
    { title: 'Volume III — Pricing', text: volumeIII(structure) },
    { title: 'Volume IV — Solicitation, Offer & Award', text: volumeIV(structure) },
  ].filter((v) => {
    // Drop a volume only when the structure marked it optional AND we're not
    // showing the full canonical set. Volume I always renders.
    if (opts.includeOptional) return true;
    const key = v.title.startsWith('Volume I ') ? 'vol1_technical'
      : v.title.startsWith('Volume II ') ? 'vol2_past_performance'
      : v.title.startsWith('Volume III') ? 'vol3_pricing' : 'vol4_forms';
    const sv = structure.volumes.find((x) => x.key === key);
    return key === 'vol1_technical' || !sv?.optional;
  });

  exampleDocTypes.add('proposal_template');

  return {
    text: volumes.map((v) => v.text).join('\n\n\f\n\n'),
    volumes,
    exampleDocTypes: [...exampleDocTypes],
    critical: structure.critical,
    crossCutting: structure.crossCutting,
  };
}
