/**
 * CONTRACTOR CORPUS ROLES — the approved P0 product decision, expressed in code.
 *
 * Decision (2026-09-12, docs/data-core-p0-decisions-approved.md, PR #1451):
 * Option C — hybrid with explicit roles. Each contractor store has exactly ONE job.
 *
 * THE FROZEN RULE:
 *   Only the canonical POPULATION store may make a corpus-size claim.
 *   Enrichment stores may enrich the canonical population, never redefine its size.
 *
 * Why this file exists: the census (PR #1446) found /contractors claiming
 * "290,000+" in its title while its body rendered ~2,710 rows from a static file —
 * a 107x divergence in which BOTH numbers were individually defensible and only
 * their pairing was wrong. Naming the roles in code is what stops the next
 * surface from re-deriving the ambiguity.
 */
import { CONTRACTOR_COUNT, contractorsLabel } from '@/lib/marketing-stats';

export type ContractorCorpusRole =
  /** Defines how many contractors exist. The ONLY role that may state a corpus size. */
  | 'canonical_population'
  /** Adds fields to companies already in the canonical population. Claims no size. */
  | 'enrichment_overlay'
  /** A distinct contact layer with its own population and its own claim. */
  | 'contact_layer'
  /** Traced but unclassified — must not be used for any claim until resolved. */
  | 'unresolved';

export interface ContractorStore {
  id: string;
  location: string;
  role: ContractorCorpusRole;
  /** True only for the canonical population store. */
  maySupportCorpusSizeClaim: boolean;
  purpose: string;
  census: string;
}

export const CONTRACTOR_STORES: ContractorStore[] = [
  {
    id: 'recipients_rollup_merged',
    location: 'BigQuery market-assasin.usaspending.recipients_rollup_merged',
    role: 'canonical_population',
    maySupportCorpusSizeClaim: true,
    purpose:
      'The federal contractor universe: one row per company with award history, UEI, NAICS, '
      + 'location, child_ueis[]. Backs /contractors/[slug] and contractor search.',
    census: 'Phase 0D — 296,445 measured live',
  },
  {
    id: 'contractors.json',
    location: 'src/data/contractors.json',
    role: 'enrichment_overlay',
    maySupportCorpusSizeClaim: false,
    purpose:
      'Curated overlay supplying fields BigQuery does not carry (sblo_name, email, phone, '
      + 'has_subcontract_plan, agencies). Highlighted subset on the /contractors index; '
      + 'slug fallback. NOT the contractor universe.',
    census: 'Phase 0B — 2,768 rows, no producer, frozen since 2025-12-27; contact coverage 1.2-2.6%',
  },
  {
    id: 'sblo-roster-2026-06.json',
    location: 'src/data/sblo-roster-2026-06.json',
    role: 'contact_layer',
    maySupportCorpusSizeClaim: false,
    purpose:
      'Canonical SBLO/teaming contact layer (200 legal names, re-researched Jun 2026). '
      + 'Deliberately NOT merged into the contractor population.',
    census: 'Phase 0A — manual curation, no automated producer',
  },
  {
    id: 'prime-contractors-database.json',
    location: 'src/data/prime-contractors-database.json',
    role: 'contact_layer',
    maySupportCorpusSizeClaim: false,
    purpose:
      'Broader SBLO fallback (3,502 primes with subcontracting plans) behind the teaming '
      + 'product. Its "3,500+ primes" claim is about THIS store, not the contractor universe.',
    census: 'Phase 0A/0B — importer only, older provenance',
  },
  {
    id: 'tier2-contractors-database.json',
    location: 'src/data/tier2-contractors-database.json',
    role: 'unresolved',
    maySupportCorpusSizeClaim: false,
    purpose:
      'UNRESOLVED — 207 rows, 2 consumers, name collides with the tier2_sblo registry key. '
      + 'Deliberately unclassified: the approved decision says do not assign a role by guess.',
    census: 'Phase 0B — untraced',
  },
];

/**
 * The label any surface must use when stating how many contractors exist.
 * Sourced from marketing-stats (CONTRACTOR_COUNT), which is rounded DOWN from the
 * live BigQuery count — never type a corpus number, import it.
 */
export const CANONICAL_POPULATION_LABEL = contractorsLabel;
export const CANONICAL_POPULATION_COUNT = CONTRACTOR_COUNT;

/** Whether a store may back a "how many contractors exist" claim. */
export function mayClaimCorpusSize(storeId: string): boolean {
  return CONTRACTOR_STORES.find((s) => s.id === storeId)?.maySupportCorpusSizeClaim ?? false;
}

export function corpusRole(storeId: string): ContractorCorpusRole | null {
  return CONTRACTOR_STORES.find((s) => s.id === storeId)?.role ?? null;
}
