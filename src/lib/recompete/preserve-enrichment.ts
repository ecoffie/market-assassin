/**
 * MINDY-007 — a less-complete source must not erase richer verified enrichment.
 *
 * spending_by_award returns psc_code / description NULL even when requested.
 * The hourly sync upserted those nulls over USASpending-detail / BQ fills.
 * Incoming non-null values still win (sync may improve known data).
 */

export interface EnrichmentFields {
  psc_code: string | null;
  description: string | null;
  psc_description?: string | null;
}

function present(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function keepRicher(incoming: string | null | undefined, existing: string | null | undefined): string | null {
  return present(incoming) ?? present(existing);
}

/** Merge one incoming sync row with the stored enrichment for the same contract_id. */
export function preserveRicherEnrichment<T extends EnrichmentFields>(
  incoming: T,
  existing: EnrichmentFields | undefined,
): T {
  if (!existing) return incoming;
  const next: T = {
    ...incoming,
    psc_code: keepRicher(incoming.psc_code, existing.psc_code),
    description: keepRicher(incoming.description, existing.description),
  };
  if ('psc_description' in incoming || existing.psc_description !== undefined) {
    (next as EnrichmentFields).psc_description = keepRicher(
      incoming.psc_description,
      existing.psc_description,
    );
  }
  return next;
}
