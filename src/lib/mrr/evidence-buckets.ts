/**
 * Split already-retrieved evidence into the three buckets a KO must not mix:
 * buyer history, installation / mission context, and broader market capacity.
 *
 * This does not run a new retrieval and must not drop the office predicate.
 */
import type { EvidenceClass } from './market-scope';
import type { GroundedField } from './types';

export interface EvidenceBucketRow {
  contractNumber?: string | null;
  recipient?: string | null;
  awardingAgency?: string | null;
  awardingOffice?: string | null;
  title?: string | null;
  amountLabel?: string | null;
  period?: string | null;
  awardType?: string | null;
  whyItMatters: string;
  evidenceClass: EvidenceClass;
}

export interface EvidenceBucket {
  title: string;
  summary: string;
  rows: EvidenceBucketRow[];
  emptyReason?: string;
  /** Second line for abstention / empty-strict UX. */
  emptyNote?: string;
}

export interface EvidenceBuckets {
  buyerHistory: EvidenceBucket;
  installationContext: EvidenceBucket;
  broaderMarketCapacity: EvidenceBucket;
}

export interface HistoryAwardLite {
  contractNumber?: string | null;
  recipient?: string | null;
  awardingAgency?: string | null;
  awardingOffice?: string | null;
  title?: string | null;
  amountLabel?: string | null;
  period?: string | null;
  awardType?: string | null;
  evidenceClass?: EvidenceClass | null;
}

export interface EvidenceBucketSource {
  awards?: HistoryAwardLite[];
  awardsFinding?: GroundedField<string> | { state: string; text?: string; reason?: string; value?: string; label?: string };
  predecessorEvidenceClass?: EvidenceClass | null;
  predecessorId?: string | null;
  predecessorText?: string | null;
  supplierScopeLabel?: string | null;
  supplierEvidenceClass?: EvidenceClass | null;
}

function findingText(
  field: EvidenceBucketSource['awardsFinding'],
): string | undefined {
  if (!field) return undefined;
  if ('text' in field && typeof field.text === 'string') return field.text;
  if (field.state === 'value' && 'value' in field && typeof field.value === 'string') return field.value;
  if (field.state === 'true_zero' && typeof field.label === 'string') return field.label;
  if ('reason' in field && typeof field.reason === 'string') return field.reason;
  return undefined;
}

function whyItMatters(evidenceClass: EvidenceClass): string {
  switch (evidenceClass) {
    case 'in_scope':
      return 'Procured by the scoped contracting office — buyer history for this market.';
    case 'contextual':
      return 'Related work at this installation, procured by another buyer — not this office’s history.';
    case 'expanded':
      return 'Found only after an explicit scope expansion — treat as broader context.';
    case 'unresolved':
      return 'Evidence class could not be established for this row.';
    default:
      return 'Evidence retained for review.';
  }
}

function toRow(row: HistoryAwardLite, evidenceClass: EvidenceClass): EvidenceBucketRow {
  return {
    contractNumber: row.contractNumber ?? null,
    recipient: row.recipient ?? null,
    awardingAgency: row.awardingAgency ?? null,
    awardingOffice: row.awardingOffice ?? null,
    title: row.title ?? null,
    amountLabel: row.amountLabel ?? null,
    period: row.period ?? null,
    awardType: row.awardType ?? null,
    whyItMatters: whyItMatters(evidenceClass),
    evidenceClass,
  };
}

export function buildEvidenceBuckets(source: EvidenceBucketSource): EvidenceBuckets {
  const awards = source.awards ?? [];
  const buyerRows = awards.filter((row) => row.evidenceClass === 'in_scope');
  const contextRows = awards.filter(
    (row) => row.evidenceClass === 'contextual' || row.evidenceClass === 'expanded',
  );
  if (
    source.predecessorEvidenceClass === 'contextual' ||
    source.predecessorEvidenceClass === 'expanded'
  ) {
    const id = source.predecessorId || source.predecessorText || 'predecessor candidate';
    if (!contextRows.some((row) => row.contractNumber === id)) {
      contextRows.push({
        contractNumber: typeof id === 'string' ? id : String(id),
        recipient: null,
        awardingAgency: null,
        awardingOffice: null,
        title: 'Predecessor / incumbent candidate',
        evidenceClass: source.predecessorEvidenceClass,
      });
    }
  }

  const buyerEmpty = buyerRows.length === 0;
  const awardsFinding = findingText(source.awardsFinding);
  const capacityLabeled =
    source.supplierEvidenceClass === 'contextual' || Boolean(source.supplierScopeLabel);

  return {
    buyerHistory: {
      title: 'Buyer history',
      summary:
        'Work procured by the scoped contracting office. Installation work bought by another agency is not listed here.',
      rows: buyerRows.map((row) => toRow(row, 'in_scope')),
      ...(buyerEmpty
        ? {
            emptyReason: 'No buyer-specific history was found for this exact scope.',
            emptyNote: awardsFinding
              ? `Ralph did not broaden the search automatically. ${awardsFinding}`
              : 'Ralph did not broaden the search automatically.',
          }
        : {}),
    },
    installationContext: {
      title: 'Installation / mission context',
      summary:
        'Related work performed at the installation but procured by another buyer. This is not buyer history for the scoped office.',
      rows: contextRows.map((row) =>
        toRow(row, (row.evidenceClass as EvidenceClass) ?? 'contextual'),
      ),
      ...(contextRows.length === 0
        ? { emptyReason: 'No installation-context awards were identified for this run.' }
        : {}),
    },
    broaderMarketCapacity: {
      title: 'Broader market capacity',
      summary:
        source.supplierScopeLabel ||
        'Supplier and market evidence that is relevant but not buyer-specific.',
      rows: [],
      ...(capacityLabeled
        ? {
            emptyNote:
              'Supplier population evidence is labeled as market capacity — not a census of this contracting office.',
          }
        : {
            emptyReason: 'Market-capacity evidence was not labeled on this run.',
          }),
    },
  };
}
