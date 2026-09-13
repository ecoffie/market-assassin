/** Types for the shared C3 reconciliation (registry-reconcile.mjs). */
export type RegistryStatus = 'aligned' | 'partially_aligned' | 'contradictory' | 'unregistered' | 'unmeasured';

export interface RegistryRow {
  key: string;
  layer: string;
  census: string;
  /** null = COULD NOT MEASURE (never "absent"). */
  inSupabase: boolean | null;
  inDocs: boolean | null;
  inTs: boolean | null;
  contradiction: string | null;
  status: RegistryStatus;
}

export interface RegistryReport {
  generatedAt: string;
  /** false = Supabase unreadable -> rows are `unmeasured`, NOT aligned/zero. */
  supabaseReadable: boolean;
  rows: RegistryRow[];
}

export function reconcileRegistries(root: string): Promise<RegistryReport>;
