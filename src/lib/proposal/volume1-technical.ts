/**
 * Deterministic Volume I — Technical assembler.
 *
 * The hardest, most-reused volume of a federal construction IDIQ/MACC proposal.
 * People can't format it — they don't know it decomposes into numbered
 * subfactors (1.1 Bonding, 1.2 Safety, 1.3 QCP, 1.4 CMP) each with a known
 * sub-structure, nor what an Accident Prevention Plan / Quality Control Plan /
 * Contract Management Plan actually contains. This renders that full numbered
 * skeleton with labeled fill-in placeholders, driven by the compliance matrix
 * (which subfactors THIS RFP requires) and pre-filled from the vault where we
 * have real facts (bonding capacity, EMR, key personnel).
 *
 * The canonical sub-structure is transcribed from the real Miami Wiipica
 * W25G1V21R0014 MACC Technical Volume (Tobyhanna Army Depot) in the vault. Each
 * subsection points at the corpus doc_type (proposal_subdoc) holding a real
 * example to mirror — so #7's drafting can ground a section in the proven format.
 *
 * Output IS the template — deterministic numbering + headings + placeholders.
 * Narrative drafting (filling a QCP body from the corpus) is a later, optional
 * pass; the skeleton alone is the thing users can't produce.
 *
 * (Memory: proposal_assist_v1; builds on proposal-structure + the #4 corpus.)
 */

import type { ProposalStructure, ProposalVolume } from './proposal-structure';
import type { VaultContext } from './types';

const ph = (label: string) => `[${label}]`;

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}
function fmtMoney(v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return s(v);
  return `$${n.toLocaleString('en-US')}`;
}

// Canonical sub-structure per subfactor (from the real MACC technical volume).
// Keyed by the subfactor key produced in proposal-structure.ts.
const SUBFACTOR_TEMPLATE: Record<string, { roman: string; letter: string; subs: string[] }> = {
  bonding: {
    roman: '1', letter: 'a',
    subs: [], // bonding is a single statement + attached surety letter
  },
  safety: {
    roman: '2', letter: 'b',
    subs: ['Accident Prevention Plan (APP)', 'Experience Modification Rate (EMR)', 'OSHA Recordable Injuries / Illnesses'],
  },
  qcp: {
    roman: '3', letter: 'c',
    subs: ['Quality Objectives', 'QC Organization & Staffing', 'QC Activities (Testing, Inspections, Deficiency Management)'],
  },
  cmp: {
    roman: '4', letter: 'd',
    subs: ['Corporate Structure', 'Contract Execution Plan', 'Project Organization', 'Scheduling Methodology', 'Providing Additional Resources', 'Provision of Qualified Personnel'],
  },
  technical_approach: {
    roman: '0', letter: '—',
    subs: [], // catch-all: free technical narrative per the notice scope
  },
};

// Pre-fill body for a subfactor from real vault facts where we have them; else a
// labeled placeholder. Keeps the format honest — real where known, bracket where not.
function subfactorBody(key: string, vault: VaultContext | null): string {
  const id = (vault?.identity || {}) as Record<string, unknown>;
  switch (key) {
    case 'bonding': {
      const single = fmtMoney(id.bonding_single);
      const agg = fmtMoney(id.bonding_aggregate);
      if (single || agg) {
        return `Our surety provides a single bonding capacity of ${single || ph('$single')} and an aggregate capacity of ${agg || ph('$aggregate')}. A bonding letter from ${ph('surety / agent name')} is attached as evidence of our capacity to bond this requirement.`;
      }
      return `${ph('Company')} maintains bonding capacity sufficient for this requirement: single ${ph('$single')} / aggregate ${ph('$aggregate')}. ${ph('Attach your surety/bonding letter.')}`;
    }
    case 'safety':
      return `${ph('Summarize your safety program. Reference your attached Accident Prevention Plan (APP), state your current EMR, and your 3-year OSHA recordable rate.')}`;
    case 'qcp':
      return `${ph('Summarize your Quality Control approach. Reference the attached Quality Control Plan (QCP): quality objectives, QC organization/staffing, and QC activities (testing, inspections, three-phase control, deficiency tracking).')}`;
    case 'cmp':
      return `${ph('Summarize your Contract Management approach: corporate structure, contract execution plan, project organization with key personnel, and scheduling methodology.')}`;
    default:
      return `${ph('Address the specific technical scope, tasks, and deliverables this notice requires. Anchor in the actual requirement — do not write generic capability prose.')}`;
  }
}

function subBody(subTitle: string): string {
  // Targeted prompts for the sub-documents whose format people most need.
  if (/accident prevention|app\b/i.test(subTitle)) return ph('Attach / summarize your Accident Prevention Plan per EM 385-1-1 — hazard analysis, site safety officer, mishap procedures.');
  if (/experience modification|emr/i.test(subTitle)) return ph('State your current EMR (e.g. 0.69) and the 3 prior years. Attach the rating sheet from your insurer.');
  if (/osha/i.test(subTitle)) return ph('State your OSHA recordable injury/illness rate for the last 3 years (DART / TRIR).');
  if (/quality objectives/i.test(subTitle)) return ph('State your measurable quality objectives for this project.');
  // Project Organization (CMP) must match BEFORE the generic QC org/staffing rule.
  if (/project organization/i.test(subTitle)) return ph('Provide your project org chart with key personnel — PM, Superintendent, QC Manager, Site Safety.');
  if (/organization|staffing/i.test(subTitle)) return ph('Identify your QC Manager and staffing — name, certifications, independence from production.');
  if (/qc activities|testing|inspection/i.test(subTitle)) return ph('Describe three-phase control (preparatory / initial / follow-up), testing plan, and how deficiencies are tracked and closed.');
  if (/corporate structure/i.test(subTitle)) return ph('Describe your corporate structure and how it supports this contract.');
  if (/execution plan/i.test(subTitle)) return ph('Describe how you execute a task order from receipt through closeout.');
  if (/scheduling/i.test(subTitle)) return ph('Describe your scheduling methodology (CPM, software, milestone tracking).');
  return ph(`Provide the ${subTitle} content.`);
}

export interface TechnicalVolumeResult {
  text: string;
  /** The corpus doc_types worth retrieving to ground each subsection. */
  exampleDocTypes: string[];
}

/**
 * Render Volume I — Technical from the proposal structure (#5) + the vault.
 * Only renders the subfactors the structure marked present (or, if the caller
 * passes includeOptional, the full canonical set so the user sees everything).
 */
export function assembleTechnicalVolume(opts: {
  structure: ProposalStructure;
  vault: VaultContext | null;
  includeOptional?: boolean;
}): TechnicalVolumeResult {
  const vol1: ProposalVolume | undefined = opts.structure.volumes.find((v) => v.key === 'vol1_technical');
  const lines: string[] = ['1.0  Volume I — Technical', ''];
  const exampleDocTypes = new Set<string>();

  const sections = (vol1?.sections || []).filter((sec) => opts.includeOptional || !sec.optional);
  // Order: Technical Approach first (if present), then a→d subfactors by roman.
  sections.sort((a, b) => {
    const ra = SUBFACTOR_TEMPLATE[a.key]?.roman ?? '9';
    const rb = SUBFACTOR_TEMPLATE[b.key]?.roman ?? '9';
    return ra.localeCompare(rb);
  });

  let secNo = 0;
  for (const sec of sections) {
    secNo++;
    const tmpl = SUBFACTOR_TEMPLATE[sec.key];
    // Lettered subfactors (a/b/c/d) show their canonical letter; the catch-all
    // Technical Approach shows no letter. The 1.N number is the running order.
    const heading = tmpl && tmpl.letter !== '—'
      ? `1.${secNo}  Subfactor ${tmpl.letter}: ${sec.title}`
      : `1.${secNo}  ${sec.title}`;
    lines.push(heading);

    // Which compliance requirement(s) this section answers — shown so the user
    // knows it traces to the RFP (and the matrix can verify coverage).
    if (sec.requirements.length) {
      const refs = sec.requirements.map((r) => r.section).filter(Boolean);
      lines.push(`    (Addresses: ${refs.length ? refs.join(', ') + ' — ' : ''}${sec.requirements.map((r) => (r.requirement || '').slice(0, 80)).join('; ')})`);
    }
    lines.push('');
    lines.push(subfactorBody(sec.key, opts.vault));
    lines.push('');

    const docType = sec.subsections[0]?.exampleDocType;
    if (docType) exampleDocTypes.add(docType);

    // Numbered sub-subsections (1.N.M).
    const subs = tmpl?.subs || [];
    subs.forEach((subTitle, i) => {
      lines.push(`    1.${secNo}.${i + 1}  ${subTitle}`);
      lines.push(`        ${subBody(subTitle)}`);
      lines.push('');
    });
  }

  // Appendices reminder — the real MACC attaches the full APP + resumes here.
  lines.push(`1.${secNo + 1}  Appendices`);
  lines.push(`    ${ph('Attach: Accident Prevention Plan (full), Key Personnel Resumes, Bonding Letter, QCP (full), any required certifications.')}`);

  return { text: lines.join('\n'), exampleDocTypes: [...exampleDocTypes] };
}
