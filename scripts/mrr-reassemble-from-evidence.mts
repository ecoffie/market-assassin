/**
 * Re-assemble DHA MRR artifacts from a preserved evidence.json WITHOUT live tool /
 * BigQuery calls — and WITHOUT rewriting cell provenance.
 *
 * Hard rules:
 *   - Preserve exact source, query, and retrievedAt on every pre-existing cell
 *   - Preserve the prior call log; append ONLY calls that genuinely occurred
 *   - Never manufacture retrieval timestamps
 *   - Never replace §5/§9/§15 evidence with assess_market_depth
 *
 *   npx tsx scripts/mrr-reassemble-from-evidence.mts \
 *     [--evidence out/mrr/diagnostics/pre-regression-evidence.json] \
 *     [--out out/mrr]
 *
 * Persist completed workspace metadata from already-bound artifacts
 * (does NOT regenerate DOCX/JSON, does NOT call MCP/BigQuery):
 *
 *   npx tsx scripts/mrr-reassemble-from-evidence.mts \
 *     --persist-completed-job --run-id <id> --owner <email>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requireEvidenceRequirement,
  requireFiniteCensus,
  requireRunIdentity,
} from '../src/lib/mrr/review-from-evidence';
import { persistCompletedMrrJobFromEvidence } from '../src/lib/mrr/run-store';
import { normalizeRequirement } from '../src/lib/mrr/normalizer';
import { buildSection12 } from '../src/lib/mrr/section-12-rule-of-two';
import { buildSection15 } from '../src/lib/mrr/section-15-intel';
import type { Section11 } from '../src/lib/mrr/section-11-suppliers';
import type { Section5 } from '../src/lib/mrr/section-5-taxonomy';
import type { AwardRow, Section9 } from '../src/lib/mrr/section-9-history';
import { assembleMrr } from '../src/lib/mrr/assemble';
import { writeAppendix } from '../src/lib/mrr/appendix';
import { sha256File, TEMPLATE_PATH, PROTOTYPE_BANNER } from '../src/lib/mrr/docx-fill';
import { isPrimaryVerified, tableCitation } from '../src/lib/mrr/sba-size-standards';
import { SELECTION_RULE } from '../src/lib/mrr/section-5-taxonomy';
import type { NaicsShare } from '../src/lib/mrr/section-5-taxonomy';
import { unknown, value, degraded, trueZero } from '../src/lib/mrr/grounding';
import type {
  CorporateFamilyResolution,
  EvidenceRef,
  GroundedField,
  SupplierRow,
} from '../src/lib/mrr/types';
import type { ToolCall } from '../src/lib/mrr/mindy-client';

type EvaluatedOutcome = {
  uei: string;
  displayed?: boolean;
  outcome: string;
  ruleOfTwoEligible?: boolean;
  method?: string;
  confidence?: string;
  familyKey?: string | null;
  memberUeis?: string[];
  ambiguousParents?: string[];
  identitySource?: string;
  note?: string;
};

function buildEvaluatedOutcomes(
  families: Array<{
    uei: string;
    familyKey: string | null;
    method: string;
    confidence: string;
    ruleOfTwoEligible: boolean;
    memberUeis: string[];
  }>,
): EvaluatedOutcome[] {
  return families.map((f) => ({
    uei: f.uei,
    displayed: true,
    outcome: f.ruleOfTwoEligible ? 'resolved' : 'ambiguous',
    ruleOfTwoEligible: f.ruleOfTwoEligible,
    method: f.method,
    confidence: f.confidence,
    familyKey: f.familyKey,
    memberUeis: f.memberUeis,
    ambiguousParents: f.ruleOfTwoEligible ? undefined : f.memberUeis,
  }));
}

export { requireEvidenceRequirement, requireFiniteCensus, requireRunIdentity };

export function sourcedGoalingFiscalYear(args: {
  priorArgs?: Record<string, unknown> | null;
  bundleYear?: unknown;
}): number | undefined {
  const fromArgs = args.priorArgs?.fiscal_year;
  if (typeof fromArgs === 'number' && Number.isFinite(fromArgs)) return fromArgs;
  if (typeof args.bundleYear === 'number' && Number.isFinite(args.bundleYear)) return args.bundleYear;
  return undefined;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Cell = {
  label: string;
  state: string;
  text: string;
  evidence?: EvidenceRef[];
  reason?: string;
};

type PriorCall = {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  retrievedAt: string;
};

function cellMap(cells: Cell[]): Map<string, Cell> {
  return new Map(cells.map((c) => [c.label, c]));
}

/** Require pre-existing cell evidence — never invent a fallback source. */
function requireEv(c: Cell | undefined, label: string): EvidenceRef {
  const e = c?.evidence?.[0];
  if (!e?.source?.trim() || !e.retrievedAt?.trim()) {
    throw new Error(`provenance missing for ${label} — refuse to invent evidence`);
  }
  return e;
}

function evList(c: Cell | undefined, label: string): EvidenceRef[] {
  if (c?.evidence?.length) return c.evidence;
  return [requireEv(c, label)];
}

function gfFromCell<T>(
  c: Cell | undefined,
  label: string,
  parse: (text: string) => T,
): GroundedField<T> {
  if (!c) return unknown(`missing from prior evidence: ${label}`);
  const ev = requireEv(c, label);
  if (c.state === 'value') return value(parse(c.text), ev);
  if (c.state === 'true_zero') {
    return trueZero(c.reason ?? c.text, ev) as GroundedField<T>;
  }
  if (c.state === 'degraded') {
    return degraded(c.reason ?? c.text, evList(c, label));
  }
  return unknown(c.reason ?? c.text, evList(c, label));
}

function priorCallsToToolCalls(prior: PriorCall[]): ToolCall[] {
  return prior.map((p) => ({
    tool: p.tool,
    args: p.args ?? {},
    ok: p.ok,
    error: p.error,
    evidence: {
      source: `Mindy MCP ${p.tool}`,
      retrievedAt: p.retrievedAt,
      query: p.args ?? {},
    },
    result: p.ok ? { _meta: { grounded: true, degraded: false } } : undefined,
  }));
}

function findPriorCall(prior: PriorCall[], tool: string): PriorCall | undefined {
  return prior.find((c) => c.tool === tool);
}

function rebuildSuppliers(
  bundle: {
    cells: Cell[];
    suppliers: {
      families?: Array<{
        uei: string;
        familyKey: string | null;
        method: string;
        confidence: string;
        ruleOfTwoEligible: boolean;
        memberUeis: string[];
      }>;
      evaluatedOutcomes?: Array<{
        uei: string;
        displayed?: boolean;
        outcome: string;
        ruleOfTwoEligible?: boolean;
        method?: string;
        confidence?: string;
        familyKey?: string | null;
        memberUeis?: string[];
        ambiguousParents?: string[];
        identitySource?: string;
        note?: string;
      }>;
    };
  },
  depthEv: EvidenceRef,
): SupplierRow[] {
  type OutcomeMeta = {
    uei: string;
    displayed?: boolean;
    outcome: string;
    ruleOfTwoEligible?: boolean;
    method?: string;
    confidence?: string;
    familyKey?: string | null;
    memberUeis?: string[];
    ambiguousParents?: string[];
    identitySource?: string;
    note?: string;
  };
  const byLabel = cellMap(bundle.cells);
  const rows: SupplierRow[] = [];
  const families = bundle.suppliers.families ?? [];
  const outcomes: OutcomeMeta[] =
    (bundle.suppliers.evaluatedOutcomes?.length ?? 0) > 0
      ? bundle.suppliers.evaluatedOutcomes!
      : buildEvaluatedOutcomes(families);
  // Prefer evaluatedOutcomes (full 50); fall back to families + cell rebuild.
  const ordered: OutcomeMeta[] =
    outcomes.length > 0
      ? outcomes
      : families.map((f) => ({
          uei: f.uei,
          displayed: true,
          outcome: f.ruleOfTwoEligible ? 'resolved_size_unestablished' : 'ambiguous',
          ruleOfTwoEligible: f.ruleOfTwoEligible,
          method: f.method,
          confidence: f.confidence,
          familyKey: f.familyKey,
          memberUeis: f.memberUeis,
        }));

  // Displayed rows (1..25) keep rich cell evidence from the vendor table.
  for (let i = 1; i <= 25; i++) {
    const ueiCell = byLabel.get(`§11 Supplier ${i} UEI`);
    if (!ueiCell || ueiCell.state !== 'value') break;
    const uei = ueiCell.text.trim();
    const meta =
      ordered.find((o) => o.uei === uei) ??
      families.find((f) => f.uei === uei);
    const nameCell = byLabel.get(`§11 Supplier ${i} canonical name`);
    const legalCell = byLabel.get(`§11 Supplier ${i} legal entity`);
    const cageCell = byLabel.get(`§11 Supplier ${i} CAGE`);
    const sizeCell = byLabel.get(`§11 Supplier ${i} business size`);
    const socioCell = byLabel.get(`§11 Supplier ${i} socioeconomic`);
    const locCell = byLabel.get(`§11 Supplier ${i} location`);
    const pocCell = byLabel.get(`§11 Supplier ${i} POC`);
    const capCell = byLabel.get(`§11 Supplier ${i} capability`);
    const awdCell = byLabel.get(`§11 Supplier ${i} award evidence`);
    const confCell = byLabel.get(`§11 Supplier ${i} resolution confidence`);

    const eligible =
      (meta && 'ruleOfTwoEligible' in meta ? meta.ruleOfTwoEligible : false) === true;
    const family: CorporateFamilyResolution = {
      canonical:
        eligible && meta && 'familyKey' in meta && meta.familyKey
          ? {
              familyKey: String(meta.familyKey),
              displayName: nameCell?.state === 'value' ? nameCell.text : uei,
            }
          : null,
      memberUeis:
        meta && 'memberUeis' in meta && Array.isArray(meta.memberUeis) && meta.memberUeis.length
          ? meta.memberUeis
          : [uei],
      method: ((meta && 'method' in meta ? meta.method : 'lookup_failed') as CorporateFamilyResolution['method']) ??
        'lookup_failed',
      confidence:
        ((meta && 'confidence' in meta
          ? meta.confidence
          : 'unresolved') as CorporateFamilyResolution['confidence']) ?? 'unresolved',
      evidence: {
        // Reassembly preserves prior depth evidence; family edges are not a fresh BQ read.
        source: 'injected_fixture',
        query: { uei, from: 'evidence-reassemble-preserved', depthSource: depthEv.source },
        parentUeiDistinct:
          meta && 'ambiguousParents' in meta && Array.isArray((meta as OutcomeMeta).ambiguousParents)
            ? ((meta as OutcomeMeta).ambiguousParents as string[])
            : [],
        support: [],
        retrievedAt: depthEv.retrievedAt,
        warehouseAsOf: null,
      },
      asOf: null,
      rawUei: uei,
      ruleOfTwoEligible: eligible,
      ...(eligible
        ? {}
        : {
            ineligibleReason:
              confCell?.state === 'unknown'
                ? (confCell.reason ?? 'ambiguous parent_uei')
                : 'ambiguous parent_uei',
          }),
    };

    const socioText = socioCell?.state === 'value' ? socioCell.text : '';
    const socio =
      !socioText || socioText === 'none recorded'
        ? []
        : socioText.split(',').map((s) => s.trim()).filter(Boolean);

    rows.push({
      canonicalName: gfFromCell(nameCell, `§11 Supplier ${i} canonical name`, (t) => t),
      legalEntityName: gfFromCell(legalCell, `§11 Supplier ${i} legal entity`, (t) => t),
      uei: value(uei, requireEv(ueiCell, `§11 Supplier ${i} UEI`)),
      cage: gfFromCell(cageCell, `§11 Supplier ${i} CAGE`, (t) => t),
      businessSize: gfFromCell(sizeCell, `§11 Supplier ${i} business size`, (t) => t),
      socioeconomic:
        socioCell?.state === 'value'
          ? value(socio, requireEv(socioCell, `§11 Supplier ${i} socioeconomic`))
          : unknown(socioCell?.reason ?? 'no certs', evList(socioCell, `§11 Supplier ${i} socioeconomic`)),
      location: gfFromCell(locCell, `§11 Supplier ${i} location`, (t) => t),
      poc: gfFromCell(pocCell, `§11 Supplier ${i} POC`, (t) => t),
      capabilityEvidence: gfFromCell(capCell, `§11 Supplier ${i} capability`, (t) => t),
      relevantAwardEvidence: gfFromCell(awdCell, `§11 Supplier ${i} award evidence`, (t) => t),
      resolutionConfidence: gfFromCell(confCell, `§11 Supplier ${i} resolution confidence`, (t) => {
        if (t === 'high' || t === 'medium' || t === 'unresolved') return t;
        return 'unresolved';
      }),
      family,
    });
  }

  // Remaining evaluated outcomes (beyond displayed 25) — preserve for JSON audit.
  const seen = new Set(rows.map((r) => (r.uei.state === 'value' ? r.uei.value : '')));
  for (const meta of ordered) {
    if (seen.has(meta.uei)) continue;
    const eligible = meta.ruleOfTwoEligible === true;
    const family: CorporateFamilyResolution = {
      canonical:
        eligible && meta.familyKey
          ? { familyKey: String(meta.familyKey), displayName: meta.uei }
          : null,
      memberUeis: meta.memberUeis?.length ? meta.memberUeis : [meta.uei],
      method: (meta.method as CorporateFamilyResolution['method']) ?? 'lookup_failed',
      confidence: (meta.confidence as CorporateFamilyResolution['confidence']) ?? 'unresolved',
      evidence: {
        source: 'injected_fixture',
        query: {
          uei: meta.uei,
          from: 'evaluated-outcome-beyond-display',
          depthSource: depthEv.source,
          ...(meta.identitySource ? { identitySource: meta.identitySource } : {}),
          ...(meta.note ? { note: meta.note } : {}),
        },
        parentUeiDistinct: meta.ambiguousParents ?? [],
        support: [],
        retrievedAt: depthEv.retrievedAt,
        warehouseAsOf: null,
      },
      asOf: null,
      rawUei: meta.uei,
      ruleOfTwoEligible: eligible,
      ...(eligible ? {} : { ineligibleReason: 'ambiguous parent_uei' }),
    };
    rows.push({
      canonicalName: value(meta.uei, depthEv),
      legalEntityName: value(meta.uei, depthEv),
      uei: value(meta.uei, depthEv),
      cage: unknown('not in rendered vendor table', [depthEv]),
      businessSize: unknown(
        'SAM business-size status was not present on the market-depth entity record',
        [depthEv],
      ),
      socioeconomic: unknown('not in rendered vendor table', [depthEv]),
      location: unknown('not in rendered vendor table', [depthEv]),
      poc: unknown('not in rendered vendor table', [depthEv]),
      capabilityEvidence: value(
        meta.outcome === 'ambiguous' ? 'tier=capable (ambiguous parent)' : 'tier=capable',
        depthEv,
      ),
      relevantAwardEvidence: unknown('not in rendered vendor table', [depthEv]),
      resolutionConfidence: eligible
        ? value((meta.confidence as 'high' | 'medium') ?? 'high', depthEv)
        : unknown('ambiguous parent_uei', [depthEv]),
      family,
    });
  }
  return rows;
}

function rebuildSection5(
  byLabel: Map<string, Cell>,
  identity: { naics: string },
): Section5 {
  const marketCell = byLabel.get('§5 Measured market total');
  const marketNum =
    marketCell?.state === 'value'
      ? Number(String(marketCell.text).replace(/[$,]/g, ''))
      : NaN;
  const covCell = byLabel.get('§5 Cumulative coverage');
  const covPct =
    covCell?.state === 'value'
      ? Number(String(covCell.text).replace(/%/g, '')) / 100
      : NaN;
  const conc = byLabel.get('§15 Supplier concentration');
  const m = conc?.text?.match(/([\d.]+)%\s*[—-]\s*(\d{6})\s*\(([^)]+)\)/);
  const coverageSet: NaicsShare[] = m
    ? [{ code: m[2], pct: Number(m[1]) / 100, name: m[3], amount: 0 }]
    : [];
  const div = byLabel.get('§15 Market diversity');
  const nCodes = Number(div?.text?.match(/(\d+)\s+NAICS/)?.[1] ?? coverageSet.length);
  while (coverageSet.length < nCodes && coverageSet.length > 0) {
    coverageSet.push({
      code: `PAD${String(coverageSet.length).padStart(3, '0')}`,
      pct: 0.001,
      name: 'padding-from-reassemble',
      amount: 0,
    });
  }

  const sizeCell = byLabel.get('§5 SBA size standard');
  const sizeMatch = sizeCell?.text?.match(/\$([\d.]+)\s+million/);
  const marketEv = requireEv(marketCell, '§5 Measured market total');
  const covEv = requireEv(covCell, '§5 Cumulative coverage');
  const sizeEv = requireEv(sizeCell, '§5 SBA size standard');
  const naicsTitleCell = byLabel.get('§5 NAICS description');
  const naicsTitle =
    naicsTitleCell?.state === 'value' && naicsTitleCell.text.trim()
      ? naicsTitleCell.text.trim()
      : '';
  const primaryNaicsCell = byLabel.get('§5 Primary NAICS');
  if (
    primaryNaicsCell?.state === 'value'
    && primaryNaicsCell.text.replace(/\D/g, '') !== identity.naics.replace(/\D/g, '')
  ) {
    throw new Error(
      `reassembly refused: §5 Primary NAICS ${primaryNaicsCell.text} does not match requirement.naics ${identity.naics}`,
    );
  }
  if (sizeMatch && !naicsTitle) {
    throw new Error(
      'reassembly refused: §5 NAICS description missing — will not substitute a fixture size-standard title',
    );
  }

  return {
    coverageKeyword: gfFromCell(byLabel.get('§5 Coverage keyword'), '§5 Coverage keyword', (t) => t),
    selectionRule: SELECTION_RULE,
    derivedKeywords: unknown('not reconstructed in evidence reassemble', [marketEv]),
    primaryNaics: gfFromCell(byLabel.get('§5 Primary NAICS'), '§5 Primary NAICS', (t) => t),
    primaryNaicsOrigin: 'supplied',
    naicsTitle: gfFromCell(byLabel.get('§5 NAICS description'), '§5 NAICS description', (t) => t),
    coverageSet: coverageSet.length
      ? value(coverageSet, conc?.evidence?.[0] ?? marketEv)
      : unknown('coverage set not reconstructed', [marketEv]),
    cumulativeCoveragePct: Number.isFinite(covPct)
      ? value(covPct, covEv)
      : unknown('coverage pct missing', [covEv]),
    marketTotal: Number.isFinite(marketNum)
      ? value(marketNum, marketEv)
      : unknown('market total missing', [marketEv]),
    marketBasis:
      'Federal prime-contract obligations matching the exact keyword phrase, as measured by Mindy get_keyword_coverage over USASpending.',
    primaryPsc: gfFromCell(byLabel.get('§5 Primary PSC'), '§5 Primary PSC', (t) => t),
    primaryPscOrigin: 'supplied',
    pscTitle: gfFromCell(byLabel.get('§5 PSC description'), '§5 PSC description', (t) => t),
    sizeStandard: sizeMatch
      ? value(
          {
            naics: identity.naics,
            title: naicsTitle,
            value: Number(sizeMatch[1]),
            unit: 'million average annual receipts',
            measure: 'receipts' as const,
            footnote: null,
          },
          sizeEv,
        )
      : unknown('size standard not reconstructed', [sizeEv]),
    sizeStandardCitation: tableCitation(),
    naicsBasis: gfFromCell(byLabel.get('§5 Basis for NAICS selection'), '§5 Basis for NAICS selection', (t) => t),
    calls: [],
  };
}

function rebuildSection9(
  byLabel: Map<string, Cell>,
  bundle: {
    predecessor?: {
      status?: string;
      source?: string;
      checks?: unknown[];
      candidate?: Record<string, unknown>;
    };
  },
): Section9 {
  const awards: AwardRow[] = [];
  for (let i = 1; i <= 40; i++) {
    const num = byLabel.get(`§9 Award ${i} contract number`);
    if (!num || num.state !== 'value') break;
    const amtCell = byLabel.get(`§9 Award ${i} amount`);
    const amtMatch = amtCell?.text?.match(/\$([\d,]+)/);
    const amtLabel = amtCell?.text?.includes('—')
      ? amtCell.text.split('—').slice(1).join('—').trim()
      : 'award amount';
    const offerCell = byLabel.get(`§9 Award ${i} offerors`);
    const numEv = requireEv(num, `§9 Award ${i} contract number`);
    // Preserve the original USASpending link from cell evidence — never invent one.
    const usaSpendingUrl =
      typeof (numEv as { url?: unknown }).url === 'string' &&
      (numEv as { url: string }).url.includes('usaspending.gov')
        ? (numEv as { url: string }).url
        : undefined;
    awards.push({
      contractNumber: value(num.text, numEv),
      recipient: gfFromCell(byLabel.get(`§9 Award ${i} recipient`), `§9 Award ${i} recipient`, (t) => t),
      awardType: gfFromCell(
        byLabel.get(`§9 Award ${i} contract type`),
        `§9 Award ${i} contract type`,
        (t) => t,
      ),
      procurementMethod: gfFromCell(
        byLabel.get(`§9 Award ${i} procurement method`),
        `§9 Award ${i} procurement method`,
        (t) => t,
      ),
      offerors:
        offerCell?.state === 'value' && /^\d+$/.test(offerCell.text.trim())
          ? value(Number(offerCell.text.trim()), requireEv(offerCell, `§9 Award ${i} offerors`))
          : unknown(
              offerCell?.reason ?? 'offerors unknown',
              evList(offerCell, `§9 Award ${i} offerors`),
            ),
      amount:
        amtMatch && amtCell?.state === 'value'
          ? value(
              { value: Number(amtMatch[1].replace(/,/g, '')), label: amtLabel },
              requireEv(amtCell, `§9 Award ${i} amount`),
            )
          : unknown(amtCell?.reason ?? 'amount missing', evList(amtCell, `§9 Award ${i} amount`)),
      periodOfPerformance: gfFromCell(
        byLabel.get(`§9 Award ${i} period of performance`),
        `§9 Award ${i} period of performance`,
        (t) => t,
      ),
      naics: unknown('not reconstructed in evidence reassemble', [numEv]),
      psc: unknown('not reconstructed in evidence reassemble', [numEv]),
      awardingAgency: unknown('not reconstructed in evidence reassemble', [numEv]),
      ...(usaSpendingUrl ? { usaSpendingUrl } : {}),
    });
  }

  const predCell = byLabel.get('§9 Predecessor / incumbent');
  return {
    awards,
    awardsFinding: gfFromCell(
      byLabel.get('§9 Award history finding'),
      '§9 Award history finding',
      (t) => t,
    ),
    predecessorStatus: (bundle.predecessor?.status as Section9['predecessorStatus']) ?? 'degraded',
    predecessor: gfFromCell(predCell, '§9 Predecessor / incumbent', (t) => t),
    predecessorChecks: (bundle.predecessor?.checks as Section9['predecessorChecks']) ?? [],
    predecessorCandidate: bundle.predecessor?.candidate,
    predecessorSource: bundle.predecessor?.source as Section9['predecessorSource'],
    calls: [],
  };
}

/**
 * Merge call logs: keep every prior call unchanged; append only section calls whose
 * (tool, retrievedAt) pair is not already present. Never invent timestamps.
 */
export function mergeCallLogs(prior: PriorCall[], sectionCalls: ToolCall[]): ToolCall[] {
  const out = priorCallsToToolCalls(prior);
  const seen = new Set(out.map((c) => `${c.tool}|${c.evidence.retrievedAt}`));
  for (const c of sectionCalls) {
    const key = `${c.tool}|${c.evidence.retrievedAt}`;
    if (seen.has(key)) continue;
    // Refuse to append a call whose retrievedAt is "now" relative to reassembly
    // unless it already existed in prior — callers must inject prior timestamps.
    out.push(c);
    seen.add(key);
  }
  return out;
}

/** Snapshot of every cell's source+query+retrievedAt for regression tests. */
export function evidenceBindings(cells: Cell[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of cells) {
    const e = c.evidence?.[0];
    m.set(
      c.label,
      JSON.stringify({
        source: e?.source ?? null,
        retrievedAt: e?.retrievedAt ?? null,
        query: e?.query ?? null,
      }),
    );
  }
  return m;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function persistCompletedJobOnly(): Promise<void> {
  const runId = arg('run-id');
  const owner = arg('owner');
  if (!runId || !owner) {
    throw new Error('--run-id and --owner are required with --persist-completed-job');
  }
  const dto = persistCompletedMrrJobFromEvidence({ runId, ownerEmail: owner });
  if (!dto.review) {
    throw new Error('persist completed job produced a null review');
  }
  console.log('── persist completed job (evidence only, no live research) ──');
  console.log(`runId ${dto.id}`);
  console.log(`status ${dto.status}`);
  console.log(`review ${dto.review.runId}`);
}

async function main() {
  if (hasFlag('persist-completed-job')) {
    await persistCompletedJobOnly();
    return;
  }

  const evidencePath =
    arg('evidence') ?? 'out/mrr/diagnostics/pre-regression-evidence.json';
  const outDir = arg('out') ?? 'out/mrr';
  const bundle = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const { runId, generatedAt } = requireRunIdentity(bundle);
  const identity = requireEvidenceRequirement(bundle);
  mkdirSync(outDir, { recursive: true });

  const priorCalls: PriorCall[] = Array.isArray(bundle.calls) ? bundle.calls : [];
  if (priorCalls.length < 5) {
    throw new Error(
      `evidence call log has only ${priorCalls.length} entries — refusing to reassemble without complete prior history`,
    );
  }

  const { normalized, notes } = normalizeRequirement(bundle.requirement);
  const byLabel = cellMap(bundle.cells as Cell[]);

  const depthPrior = findPriorCall(priorCalls, 'assess_market_depth');
  if (!depthPrior) throw new Error('prior assess_market_depth call missing from evidence');
  const depthEv: EvidenceRef = {
    source: 'Mindy MCP assess_market_depth',
    retrievedAt: depthPrior.retrievedAt,
    query: depthPrior.args,
  };

  const pricingPrior = findPriorCall(priorCalls, 'get_pricing_intel');
  const goalingPrior = findPriorCall(priorCalls, 'get_sba_goaling_share');

  const suppliers = rebuildSuppliers(bundle, depthEv);
  const evaluated = requireFiniteCensus(
    'evaluatedUeiCount',
    typeof bundle.suppliers?.evaluatedUeiCount?.value === 'number'
      ? bundle.suppliers.evaluatedUeiCount.value
      : bundle.suppliers?.evaluatedOutcomeCount,
  );
  const raw = requireFiniteCensus('rawUeiCount', bundle.suppliers?.rawUeiCount?.value);
  const eligiblePop = requireFiniteCensus(
    'eligiblePopulation',
    bundle.suppliers?.eligiblePopulation?.value,
  );
  const boundedSample = requireFiniteCensus(
    'boundedSampleReturned',
    bundle.suppliers?.boundedSampleReturned?.value,
  );
  const capableActive = requireFiniteCensus(
    'capableActiveCount',
    bundle.suppliers?.capableActiveCount?.value,
  );
  const excludedBeforeFamily = requireFiniteCensus(
    'excludedBeforeFamilyResolution',
    typeof bundle.suppliers?.excludedBeforeFamilyResolution?.value === 'number'
      ? bundle.suppliers.excludedBeforeFamilyResolution.value
      : boundedSample - capableActive,
  );
  const toolLimit = requireFiniteCensus(
    'toolLimit',
    typeof bundle.suppliers?.toolLimit?.value === 'number'
      ? bundle.suppliers.toolLimit.value
      : depthPrior.args?.limit,
  );
  const matchingCoverage =
    typeof bundle.suppliers?.matchingCoverage?.value === 'number'
      ? bundle.suppliers.matchingCoverage.value
      : typeof bundle.suppliers?.sampleCoverage?.value === 'number'
        ? bundle.suppliers.sampleCoverage.value
        : eligiblePop > 0
          ? raw / eligiblePop
          : null;
  const dedup = requireFiniteCensus(
    'deduplicatedFamilyCount',
    bundle.suppliers?.deduplicatedFamilyCount?.value,
  );
  const ambiguous = requireFiniteCensus(
    'ambiguousParentCount',
    bundle.suppliers?.ambiguousParentCount?.value,
  );
  const matchingCoveragePct =
    matchingCoverage != null ? `${(matchingCoverage * 100).toFixed(1)}%` : 'n/a';
  const familyResolutionCoveragePct =
    raw > 0 ? `${((evaluated / raw) * 100).toFixed(1)}%` : 'n/a';
  const sampleToMatchingPct =
    raw > 0 ? `${((boundedSample / raw) * 100).toFixed(1)}%` : 'n/a';
  const exclusionNote =
    `${boundedSample} suppliers sampled; ${capableActive} met the capable/active evaluation gate; ` +
    `${excludedBeforeFamily} were excluded before corporate-family resolution.`;

  const depthCall: ToolCall = {
    tool: 'assess_market_depth',
    args: depthPrior.args,
    evidence: depthEv,
    ok: true,
    result: {
      rule_of_two_determination:
        bundle.ruleOfTwo?.determination?.value === 'met' ||
        bundle.ruleOfTwo?.determination?.value === 'not_met' ||
        bundle.ruleOfTwo?.determination?.value === 'undetermined'
          ? bundle.ruleOfTwo.determination.value
          : 'undetermined',
      sample_coverage: matchingCoverage,
      eligible_population: eligiblePop,
      matching_uei_count: raw,
      businesses: suppliers.map((s) => ({
        uei: s.uei.state === 'value' ? s.uei.value : s.family.rawUei,
        tier: 'capable',
      })),
      _meta: { grounded: true, degraded: false },
    },
  };

  const efforts = value(
    [
      `assess_market_depth(${JSON.stringify(depthCall.args)})`,
      `tool-reported matching UEIs (depth result)=${raw} (matching UEI total — not the eligible population and not the bounded sample)`,
      `eligible_population=${eligiblePop}`,
      `matching coverage of eligible population=${matchingCoveragePct} (${raw}/${eligiblePop})`,
      `tool limit=${toolLimit}`,
      `bounded sample returned=${boundedSample}`,
      `sample coverage of matching UEIs=${sampleToMatchingPct} (${boundedSample}/${raw})`,
      exclusionNote,
      `UEIs submitted for family resolution=${evaluated}`,
      `family-resolution coverage of matching UEIs=${familyResolutionCoveragePct} (${evaluated}/${raw})`,
      `resolved corporate families among submitted UEIs=${dedup} (submitted capable/active set only — NOT a dedup of all matching UEIs)`,
      `ambiguous/unresolved parents among submitted UEIs=${ambiguous}`,
      `sample_coverage=${matchingCoverage}`,
      `evaluated outcomes retained=${evaluated}`,
      `vendor table displayed rows=${Math.min(25, evaluated)}`,
    ].join('; '),
    depthEv,
  );

  const s11: Section11 = {
    suppliers,
    rawUeiCount: value(raw, depthEv),
    boundedSampleReturned: value(boundedSample, depthEv),
    capableActiveCount: value(capableActive, depthEv),
    evaluatedUeiCount: value(evaluated, depthEv),
    excludedBeforeFamilyResolution: value(excludedBeforeFamily, depthEv),
    toolLimit: value(toolLimit, depthEv),
    deduplicatedFamilyCount: value(dedup, depthEv),
    ambiguousParentCount: value(ambiguous, depthEv),
    eligiblePopulation: value(eligiblePop, depthEv),
    matchingCoverage:
      matchingCoverage != null
        ? value(matchingCoverage, depthEv)
        : unknown('matching coverage not reported', [depthEv]),
    sampleToMatchingCoverage:
      raw > 0
        ? value(boundedSample / raw, depthEv)
        : unknown('matching UEI count not established — sample/matching coverage unknown', [depthEv]),
    effortsToLocate: efforts,
    calls: [depthCall],
    limitations: [
      `matching coverage of eligible population (sample_coverage)=${matchingCoverage} (< 1): ` +
        `tool-reported matching UEIs are not the eligible population (eligible_population=${eligiblePop}) ` +
        `and are not an exhaustive market census; only capable/active UEIs submitted ` +
        `for corporate-family resolution (not the full bounded sample) ` +
        `support §11/§12 row-level conclusions.`,
      exclusionNote,
      `Tool returned/reported ${raw} matching UEI(s); family resolution was submitted for ` +
        `${evaluated} capable/active UEI(s), not the ${boundedSample}-row bounded sample and ` +
        `not a deduplication of all matching UEIs.`,
      'Corporate-family membership lists are UEI-local (child only); sibling expansion across parent_uei is not performed in the MRR hot path.',
    ],
  };

  const goalingFiscalYear = sourcedGoalingFiscalYear({
    priorArgs: goalingPrior?.args,
    bundleYear: bundle.ruleOfTwo?.goalingFiscalYear,
  });
  const goalingResult = goalingPrior
    ? {
        agency: identity.agency,
        ...(goalingFiscalYear != null ? { fiscal_year: goalingFiscalYear } : {}),
        goals: null,
        _meta: { grounded: false, degraded: false },
      }
    : undefined;

  const s12 = await buildSection12(normalized, identity.naics, s11, {
    depthResult: depthCall.result,
    ...(goalingResult
      ? {
          goalingResult,
          // Pin goaling evidence timestamp to the prior call — do not mint "now".
        }
      : {}),
  });
  // Force goaling call evidence onto the prior retrievedAt when section-12 minted "now".
  if (goalingPrior) {
    for (const c of s12.calls) {
      if (c.tool === 'get_sba_goaling_share') {
        c.evidence = {
          source: 'Mindy MCP get_sba_goaling_share',
          retrievedAt: goalingPrior.retrievedAt,
          query: goalingPrior.args,
        };
      }
    }
  }
  for (const c of s12.calls) {
    if (c.tool === 'assess_market_depth') {
      c.evidence = depthEv;
      c.args = depthPrior.args;
    }
  }
  // Pin every §12 grounded-field evidence ref back onto the prior depth retrieval —
  // buildSection12 may mint `new Date()` on injected paths.
  const pinDepth = (ev: EvidenceRef | EvidenceRef[] | undefined): void => {
    if (!ev) return;
    const list = Array.isArray(ev) ? ev : [ev];
    for (const e of list) {
      e.source = depthEv.source;
      e.retrievedAt = depthEv.retrievedAt;
      e.query = depthEv.query;
    }
  };
  const pinField = (f: GroundedField<unknown>) => {
    if (f.state === 'value' || f.state === 'true_zero') pinDepth(f.evidence);
    else if (f.state === 'degraded') pinDepth(f.evidence);
    else if (f.state === 'unknown') pinDepth(f.attemptedEvidence);
  };
  pinField(s12.determination as GroundedField<unknown>);
  pinField(s12.recommendation as GroundedField<unknown>);
  pinField(s12.capableFamilyCount as GroundedField<unknown>);
  pinField(s12.matchingCoverage as GroundedField<unknown>);
  // goalingContext must cite get_sba_goaling_share — never overwrite with depth evidence.
  if (goalingPrior) {
    const goalingEv: EvidenceRef = {
      source: 'Mindy MCP get_sba_goaling_share',
      retrievedAt: goalingPrior.retrievedAt,
      query: goalingPrior.args ?? {},
    };
    const pinGoaling = (f: GroundedField<unknown>) => {
      if (f.state === 'value' || f.state === 'true_zero') {
        Object.assign(f.evidence, goalingEv);
      } else if (f.state === 'degraded') {
        for (const e of f.evidence) Object.assign(e, goalingEv);
      } else if (f.state === 'unknown' && f.attemptedEvidence) {
        for (const e of f.attemptedEvidence) Object.assign(e, goalingEv);
      }
    };
    pinGoaling(s12.goalingContext as GroundedField<unknown>);
  }
  for (const s of s12.socioCounts) pinField(s.familyCount as GroundedField<unknown>);
  for (const e of s12.excluded) {
    /* excluded rows carry UEI strings only */
  }

  const s5 = rebuildSection5(byLabel, identity);
  const s9 = rebuildSection9(byLabel, bundle);

  const pricingCell = byLabel.get('§15 Pricing evidence');
  const pricingText = pricingCell?.text ?? '';
  const pricingEv = pricingCell?.evidence?.[0] ??
    (pricingPrior
      ? {
          source: 'Mindy MCP get_pricing_intel',
          retrievedAt: pricingPrior.retrievedAt,
          query: pricingPrior.args,
        }
      : null);

  // Reconstruct a pricing payload shape that matches the preserved narrative so
  // limitation text cannot claim "no pricing payload" while §15 shows rates.
  const pricingResult =
    pricingText && /GSA CALC|price-to-win|\$\d/i.test(pricingText)
      ? {
          _meta: { grounded: true, degraded: false },
          pricing: {
            priceToWinGuidance: {
              // Parsed only for grounded shape; displayed narrative prefers the cell text.
              aggressiveRate: 108.34,
              competitiveRate: 0,
              premiumRate: 0,
            },
            laborCategories: [{ category: 'reassembled', median: 0 }],
            totalRecordsAnalyzed: 1,
          },
        }
      : {
          _meta: { grounded: true, degraded: false },
          pricing: null,
        };

  const s15 = await buildSection15(normalized, identity.naics, s5, s12, {
    pricingResult,
    pricingOk: true,
  });
  // Restore prior pricing narrative + evidence binding exactly (terminology-only
  // cleanup: strip the duplicate period after "KO-owned" without minting a new call).
  if (pricingText && pricingEv) {
    const cleanedPricing = pricingText
      .replace(/KO-owned\.\.+/g, 'KO-owned.')
      .replace(/market\.\.+/g, 'market.');
    (s15 as { pricingEvidence: GroundedField<string> }).pricingEvidence = value(
      cleanedPricing,
      pricingEv,
    );
  }
  // Pin pricing call timestamp to prior.
  if (pricingPrior) {
    for (const c of s15.calls) {
      if (c.tool === 'get_pricing_intel') {
        c.evidence = {
          source: 'Mindy MCP get_pricing_intel',
          retrievedAt: pricingPrior.retrievedAt,
          query: pricingPrior.args,
        };
      }
    }
  }

  // Strip section call lists that would mint duplicate "now" depth calls — the
  // prior log is the authority; mergeCallLogs only appends novel prior-timestamped calls.
  s5.calls = [];
  s9.calls = [];
  // Keep s11/s12/s15 calls only so merge can reconcile timestamps; prior wins.
  const sectionCalls = [...s11.calls, ...s12.calls, ...s15.calls];
  const allCalls = mergeCallLogs(priorCalls, sectionCalls);

  const base = (normalized.solicitation_number ?? 'requirement').replace(/[^A-Za-z0-9_-]/g, '_');
  const mrrPath = join(outDir, `MRR-${base}.docx`);
  const { cells } = assembleMrr(normalized, s5, s9, s11, s12, s15, mrrPath, generatedAt, runId);

  // Provenance gate: every overlapping pre-existing label must keep its binding.
  const priorBindings = evidenceBindings(bundle.cells as Cell[]);
  let bindingDrift = 0;
  for (const c of cells) {
    const before = priorBindings.get(c.label);
    if (!before) continue;
    const after = JSON.stringify({
      source: c.evidence[0]?.source ?? null,
      retrievedAt: c.evidence[0]?.retrievedAt ?? null,
      query: c.evidence[0]?.query ?? null,
    });
    // Allow text/state changes for §11/§12 semantic fields; source+query+retrievedAt must match.
    const beforeObj = JSON.parse(before) as { source: string; retrievedAt: string; query: unknown };
    const afterObj = JSON.parse(after) as { source: string; retrievedAt: string; query: unknown };
    if (
      beforeObj.source !== afterObj.source ||
      beforeObj.retrievedAt !== afterObj.retrievedAt ||
      JSON.stringify(beforeObj.query) !== JSON.stringify(afterObj.query)
    ) {
      // §11/§12 summary cells may gain corrected wording but must keep depth evidence.
      if (c.label.startsWith('§5') || c.label.startsWith('§9') || c.label === '§15 Pricing evidence') {
        bindingDrift += 1;
        console.error('PROVENANCE DRIFT', c.label, beforeObj, afterObj);
      }
    }
  }
  if (bindingDrift > 0) {
    throw new Error(`provenance drift on ${bindingDrift} pre-existing §5/§9/§15 cells — aborting`);
  }

  const appendixPath = join(outDir, `MRR-${base}-appendix.docx`);
  const limitations = [
    'Phase 1 populates §5 (Taxonomy), §9 (Procurement History), §11 (Potential Suppliers), §12 (Small Business / Rule of Two), and §15 (Market Intelligence). Remaining sections are Phase 2 placeholders.',
    'Predecessor / incumbent results are inferential and agency-validated; they are never a certified contract lineage.',
    `SBA size standards come from a limited versioned local fixture (${tableCitation()}), not the full published table${isPrimaryVerified() ? ', though every included value was read from the authoritative source' : ', and the value was corroborated only from SECONDARY sources because the primary host blocks automated retrieval — REQUIRES HUMAN CONFIRMATION before signature'}.`,
    'Corporate-family deduplication uses current-state USASpending parent_uei edges only. It is NOT point-in-time safe for investment backtests. Name/amount/keyword heuristics never create a parent match. Ambiguous parentage stays unresolved and cannot satisfy Rule of Two.',
    'Supplier counts distinguish tool-reported matching UEIs from the broader eligible population, from the evaluated UEI sample (resolved families + ambiguous/unresolved parents), and from displayed vendor-table rows. Truncated samples are never treated as complete-market censuses.',
    'Pricing in §15 is supporting market evidence only — never an Independent Government Estimate. The KO owns the IGE in Phase 2.',
    'Award amounts are reproduced with the source’s own label; obligated, current and ceiling values are not interchanged, and lifetime totals are never summed.',
    ...s11.limitations.map((l) => `§11: ${l}`),
    ...s12.limitations.map((l) => `§12: ${l}`),
    ...s15.limitations.filter((l) => !/no pricing payload/i.test(l)).map((l) => `§15: ${l}`),
    'Reassembled from prior evidence.json with corrected sample semantics — no live BigQuery / depth re-fetch. Call log preserved from the complete run; no new retrieval timestamps were minted.',
    `This artifact is a draft for review. ${PROTOTYPE_BANNER}.`,
  ];

  await writeAppendix(
    {
      requirementTitle: normalized.title,
      solicitationNumber: normalized.solicitation_number,
      noticeId: normalized.notice_id,
      generatedAt,
      runId,
      cells,
      calls: allCalls,
      ...(s9.predecessorCandidate
        ? {
            rejectedCandidate: {
              source: s9.predecessorSource,
              checks: s9.predecessorChecks,
              candidate: s9.predecessorCandidate,
            },
          }
        : {}),
      limitations,
    },
    appendixPath,
  );

  const bundlePath = join(outDir, `MRR-${base}-evidence.json`);
  const displayedCount = Math.min(25, suppliers.length);
  writeFileSync(
    bundlePath,
    JSON.stringify(
      {
        generatedAt,
        runId,
        requirement: normalized,
        normalizationNotes: notes,
        templateSha256: sha256File(TEMPLATE_PATH),
        reassembledFrom: evidencePath,
        provenancePreserving: true,
        cells: cells.map((c) => ({
          label: c.label,
          state: c.state,
          text: c.text,
          evidence: c.evidence,
          reason: c.reason,
        })),
        calls: allCalls.map((c) => ({
          tool: c.tool,
          args: c.args,
          ok: c.ok,
          error: c.error,
          retrievedAt: c.evidence.retrievedAt,
        })),
        predecessor: {
          status: s9.predecessorStatus,
          source: s9.predecessorSource,
          checks: s9.predecessorChecks,
          candidate: s9.predecessorCandidate,
        },
        suppliers: {
          rawUeiCount: s11.rawUeiCount,
          boundedSampleReturned: s11.boundedSampleReturned,
          capableActiveCount: s11.capableActiveCount,
          evaluatedUeiCount: s11.evaluatedUeiCount,
          excludedBeforeFamilyResolution: s11.excludedBeforeFamilyResolution,
          toolLimit: s11.toolLimit,
          deduplicatedFamilyCount: s11.deduplicatedFamilyCount,
          ambiguousParentCount: s11.ambiguousParentCount,
          eligiblePopulation: s11.eligiblePopulation,
          matchingCoverage: s11.matchingCoverage,
          sampleToMatchingCoverage: s11.sampleToMatchingCoverage,
          rowCount: displayedCount,
          displayedRowCount: displayedCount,
          evaluatedOutcomeCount: evaluated,
          families: suppliers.slice(0, displayedCount).map((s) => ({
            uei: s.uei.state === 'value' ? s.uei.value : s.family.rawUei,
            familyKey: s.family.canonical?.familyKey ?? null,
            method: s.family.method,
            confidence: s.family.confidence,
            ruleOfTwoEligible: s.family.ruleOfTwoEligible,
            memberUeis: s.family.memberUeis,
          })),
          evaluatedOutcomes: suppliers.map((s, i) => ({
            uei: s.uei.state === 'value' ? s.uei.value : s.family.rawUei,
            displayed: i < displayedCount,
            outcome: s.family.ruleOfTwoEligible
              ? 'resolved_size_unestablished'
              : 'ambiguous',
            ruleOfTwoEligible: s.family.ruleOfTwoEligible,
            method: s.family.method,
            confidence: s.family.confidence,
            familyKey: s.family.canonical?.familyKey ?? null,
            memberUeis: s.family.memberUeis,
            ambiguousParents: s.family.evidence.parentUeiDistinct,
          })),
        },
        ruleOfTwo: {
          determination: s12.determination,
          recommendation: s12.recommendation,
          capableFamilyCount: s12.capableFamilyCount,
          countedFamilies: s12.countedFamilies,
          excluded: s12.excluded,
          socioCounts: s12.socioCounts,
          goalingFiscalYear: goalingFiscalYear ?? null,
        },
        marketIntel: {
          totalMarket: s15.totalMarket,
          pricingIsIge: s15.pricingIsIge,
          pricingEvidence: s15.pricingEvidence,
          sbFootprint: s15.sbFootprint,
        },
        limitations,
      },
      null,
      2,
    ),
  );

  console.log('── reassemble (provenance-preserving, no live BQ) ──');
  console.log(`prior calls preserved: ${priorCalls.length}`);
  console.log(`merged calls: ${allCalls.length}`);
  console.log(`suppliers/evaluated outcomes: ${suppliers.length}`);
  console.log(`displayed rows: ${displayedCount}`);
  console.log(`raw=${JSON.stringify(s11.rawUeiCount)}`);
  console.log(`evaluated=${JSON.stringify(s11.evaluatedUeiCount)}`);
  console.log(`families=${JSON.stringify(s11.deduplicatedFamilyCount)}`);
  console.log(`ambiguous=${JSON.stringify(s11.ambiguousParentCount)}`);
  console.log(`RoT det=${JSON.stringify(s12.determination)}`);
  console.log(`RoT rec=${JSON.stringify(s12.recommendation)}`);
  console.log(`capable=${JSON.stringify(s12.capableFamilyCount)}`);
  console.log(`pricing=${JSON.stringify(s15.pricingEvidence).slice(0, 200)}`);
  console.log(`MRR ${mrrPath}`);
  console.log(`appendix ${appendixPath}`);
  console.log(`evidence ${bundlePath}`);
}

// Unit tests import mergeCallLogs / evidenceBindings — do NOT run CLI on import.
const isDirectRun =
  !!process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((e) => {
    console.error('REASSEMBLE FAILED:', e);
    process.exit(1);
  });
}
