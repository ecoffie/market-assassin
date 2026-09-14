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
  evidenceClass: EvidenceClass;
}

export interface EvidenceBucket {
  title: string;
  summary: string;
  rows: EvidenceBucketRow[];
  emptyReason?: string;
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
  evidenceClass?: EvidenceClass | null;
}

export interface EvidenceBucketSource {
  awards?: HistoryAwardLite[];
  awardsFinding?: GroundedField<string> | { state: string; text?: string; reason?: string; value?: string };
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
  if (field.state === 'true_zero' && 'label' in field && typeof (field as { label?: string }).label === 'string') {
    return (field as { label: string }).label;
  }
  if ('reason' in field && typeof field.reason === 'string') return field.reason;
  return undefined;
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
        evidenceClass: source.predecessorEvidenceClass,
      });
    }
  }

  const buyerEmpty = buyerRows.length === 0;
  const awardsFinding = findingText(source.awardsFinding);

  return {
    buyerHistory: {
      title: 'Buyer history',
      summary:
        'What the scoped contracting office bought. Installation work bought by another agency is not listed here.',
      rows: buyerRows.map((row) => ({
        contractNumber: row.contractNumber ?? null,
        recipient: row.recipient ?? null,
        awardingAgency: row.awardingAgency ?? null,
        awardingOffice: row.awardingOffice ?? null,
        evidenceClass: 'in_scope',
      })),
      ...(buyerEmpty
        ? {
            emptyReason:
              awardsFinding ||
              'No in-scope awards were retrieved for the scoped contracting office.',
          }
        : {}),
    },
    installationContext: {
      title: 'Installation / mission context',
      summary:
        'Related work at the location bought by another agency. This is not buyer history for the scoped office.',
      rows: contextRows.map((row) => ({
        contractNumber: row.contractNumber ?? null,
        recipient: row.recipient ?? null,
        awardingAgency: row.awardingAgency ?? null,
        awardingOffice: row.awardingOffice ?? null,
        evidenceClass: row.evidenceClass ?? 'contextual',
      })),
      ...(contextRows.length === 0
        ? { emptyReason: 'No installation-context awards were identified for this run.' }
        : {}),
    },
    broaderMarketCapacity: {
      title: 'Broader market capacity',
      summary:
        source.supplierScopeLabel ||
        'Supplier and market evidence outside the buyer-specific office scope.',
      rows: [],
      emptyReason:
        source.supplierEvidenceClass === 'contextual' || source.supplierScopeLabel
          ? undefined
          : 'Market-capacity evidence was not labeled on this run.',
    },
  };
}
