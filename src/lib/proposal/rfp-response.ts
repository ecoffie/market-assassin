/**
 * Deterministic NORMAL-RFP response template — the "in-between" between the LOI
 * (simplest) and the IDIQ/MACC 4-volume package (hardest).
 *
 * Grounded in docs/RFP-FORMAT-ANALYSIS.md (488 real RFPs): only ~1% of real RFPs
 * are full UCF with explicit Section L AND M; ~35% show commercial/FAR-12/RFQ
 * signals; only ~6% use a volume scheme. So a normal RFP is USUALLY a single,
 * light commercial response — NOT a multi-volume L/M proposal.
 *
 * Therefore this is SPECTRUM-AWARE:
 *   - DEFAULT (the ~99% case): a single light response — cover/offer, technical
 *     approach to the SOW, past performance (if asked), reps/certs + SAM
 *     confirmation, and the price/quote pointer. One document.
 *   - ESCALATE to the UCF volume structure (reuse buildProposalStructure #5) ONLY
 *     when the RFP actually carries Section L/M / volume signals.
 *
 * Output IS the template — deterministic headings + instructive placeholders,
 * pre-filled from the vault where we have facts. (Memory: proposal_assist_v1.)
 */

import type { ComplianceReq } from './section-alignment';
import { alignMatrix } from './section-alignment';
import { buildProposalStructure } from './proposal-structure';
import { relevantExperienceBlock } from './loi-template';
import type { VaultContext } from './types';

const ph = (label: string) => `[${label}]`;
function s(v: unknown): string { return typeof v === 'string' ? v.trim() : v == null ? '' : String(v); }

export type RfpWeight = 'light_commercial' | 'ucf_volumes';

export interface RfpResponseInput {
  requirements: ComplianceReq[];
  vault: VaultContext | null;
  /** Raw notice/RFP body — used to detect L/M / volume signals. */
  sourceText?: string;
  /** Force a weight; otherwise auto-detected. */
  forceWeight?: RfpWeight;
}

export interface RfpResponseResult {
  text: string;
  weight: RfpWeight;
  /** Why this weight was chosen — surfaced to the user. */
  weightReason: string;
  exampleDocTypes: string[];
}

// Detect whether THIS RFP warrants the heavy UCF volume structure or the light
// commercial response. Conservative: only escalate on real L/M / volume signals,
// because the data says the vast majority are light.
function detectWeight(reqs: ComplianceReq[], sourceText: string): { weight: RfpWeight; reason: string } {
  const hay = (sourceText + ' ' + reqs.map(r => r.requirement).join(' ')).toLowerCase();
  const hasLM = /\bsection\s+l\b/.test(hay) && /\bsection\s+m\b/.test(hay);
  const hasVolumes = /\b(technical|price|cost|past[- ]performance)\s+volume\b|\bvolume\s+(i{1,3}|iv|one|two|three)\b/.test(hay);
  const farNegotiated = /far\s*15|negotiated\s+procurement|best[- ]value\s+trade[- ]?off|52\.215/.test(hay);
  if (hasLM || (hasVolumes && farNegotiated)) {
    return { weight: 'ucf_volumes', reason: 'This RFP carries explicit Section L/M instructions and a volume structure (full FAR-15 negotiated procurement), so it gets the multi-volume layout.' };
  }
  return { weight: 'light_commercial', reason: 'This reads as a commercial / simplified acquisition (no explicit Section L/M volume scheme — the ~99% case). A single, focused response is correct; do not over-build it.' };
}

function reqsFor(reqs: ComplianceReq[], section: string): ComplianceReq[] {
  return alignMatrix(reqs).bySection[section] || [];
}

/** The light commercial single-document response (the default). */
function buildLightResponse(reqs: ComplianceReq[], vault: VaultContext | null): string {
  const id = (vault?.identity || {}) as Record<string, unknown>;
  const company = s(id.legal_name) || ph('Your company name');
  const oneLiner = s(id.one_liner) || s(id.elevator_pitch) || ph('one-line description of what your firm does');

  const techReqs = reqsFor(reqs, 'technical').concat(reqsFor(reqs, 'management'));
  const ppReqs = reqsFor(reqs, 'past_performance');
  const hasPastPerfAsk = ppReqs.length > 0 || reqs.some(r => /past\s+performance|references?|relevant\s+(experience|projects?)/i.test(r.requirement));
  const hasPriceAsk = reqs.some(r => /price|cost|quote|schedule\s+b|clin|unit\s+price/i.test(r.requirement));

  const lines: string[] = [];

  // 1. Cover / offer
  lines.push('1. Cover Letter / Offer', '');
  lines.push(`${company} is pleased to submit this response to ${ph('solicitation number / title')}. ${oneLiner}.`);
  lines.push(`We confirm our intent to perform as a ${ph('PRIME / subcontractor')} and that this offer is valid for ${ph('N')} days.`, '');

  // 2. Technical approach to the SOW
  lines.push('2. Technical Approach', '');
  if (techReqs.length) {
    lines.push('Address each requirement the solicitation states (from the SOW / Section C):');
    for (const r of techReqs.slice(0, 12)) {
      lines.push(`  • ${r.section ? r.section + ' — ' : ''}${ph(`how you will meet: "${(r.requirement || '').slice(0, 80)}"`)}`);
    }
  } else {
    lines.push(`${ph('Describe how you will perform the work in the SOW / specification — your approach, methods, equipment, schedule. Anchor in the actual scope, not generic capability prose.')}`);
  }
  lines.push('');

  // 3. Past performance (only if asked — the data shows it's a ~21% ask)
  if (hasPastPerfAsk) {
    lines.push('3. Past Performance / Relevant Experience', '');
    lines.push(relevantExperienceBlock(vault).replace(/^RELEVANT EXPERIENCE\n\n/, ''));
    lines.push('');
  }

  // 4. Price / quote
  if (hasPriceAsk) {
    lines.push(`${hasPastPerfAsk ? '4' : '3'}. Price / Quote`, '');
    lines.push(`${ph('Complete every line item / CLIN in the solicitation\'s pricing schedule with unit prices, quantities, and extended totals. Keep price separate from the technical narrative.')}`, '');
  }

  // Compliance confirmations — the real DQ gates from the data.
  const n = (hasPastPerfAsk ? 1 : 0) + (hasPriceAsk ? 1 : 0) + 3;
  lines.push(`${n}. Compliance Confirmations`, '');
  lines.push(`  • SAM.gov registration: ${ph('confirm active')}`);
  lines.push(`  • Representations & certifications (FAR 52.212-3): ${ph('confirm complete / current in SAM')}`);
  lines.push(`  • Amendments acknowledged: ${ph('list amendment numbers, or "none issued"')}`);
  lines.push(`  • Submission: ${ph('confirm method/portal and that you will submit before the deadline')}`);

  return lines.join('\n');
}

/** Heavy UCF response — reuse the #5 structure as a multi-section outline. */
function buildUcfResponse(reqs: ComplianceReq[], vault: VaultContext | null): { text: string; docTypes: string[] } {
  const structure = buildProposalStructure(reqs);
  const docTypes = new Set<string>();
  const lines: string[] = ['RFP Response — Volume Structure (Section L / M driven)', ''];
  for (const vol of structure.volumes) {
    if (vol.optional) continue;
    lines.push(vol.title);
    for (const sec of vol.sections) {
      if (sec.optional) continue;
      lines.push(`  ${sec.title}`);
      const refs = sec.requirements.map(r => r.section).filter(Boolean);
      if (refs.length) lines.push(`    (Addresses: ${refs.join(', ')})`);
      lines.push(`    ${ph(`Respond to: ${sec.requirements.map(r => (r.requirement || '').slice(0, 60)).join('; ') || 'this volume\'s requirements'}`)}`);
      const dt = sec.subsections[0]?.exampleDocType;
      if (dt) docTypes.add(dt);
    }
    lines.push('');
  }
  return { text: lines.join('\n'), docTypes: [...docTypes] };
}

export function assembleRfpResponse(opts: RfpResponseInput): RfpResponseResult {
  const { weight, reason } = opts.forceWeight
    ? { weight: opts.forceWeight, reason: 'Weight set explicitly by the caller.' }
    : detectWeight(opts.requirements, opts.sourceText || '');

  if (weight === 'ucf_volumes') {
    const { text, docTypes } = buildUcfResponse(opts.requirements, opts.vault);
    return { text, weight, weightReason: reason, exampleDocTypes: ['technical_volume', 'proposal_subdoc', ...docTypes] };
  }
  return {
    text: buildLightResponse(opts.requirements, opts.vault),
    weight, weightReason: reason,
    exampleDocTypes: ['technical_volume', 'cap_statement', 'past_performance'],
  };
}
