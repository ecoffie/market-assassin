/**
 * Control-plane patch for one research collector run.
 * A fetch that did not land rows is unreachable. A landed run that changed
 * stored rows advances the data clock. A landed run that only matched existing
 * rows is upstream_quiet — we checked, the publisher had nothing new.
 * Counts are never invented here.
 */

export interface ResearchRunCounts {
  success: boolean;
  totalFound: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  now: string;
}

export function researchInstancePatch(input: ResearchRunCounts): Record<string, string> {
  const landed = input.success
    && input.totalFound > 0
    && (input.newCount + input.updatedCount + input.unchangedCount) > 0;
  if (!landed) {
    return { last_poll: input.now, source_state: 'unreachable', updated_at: input.now };
  }
  const advanced = input.newCount + input.updatedCount > 0;
  return {
    last_poll: input.now,
    last_successful_check: input.now,
    last_verified_ingest: input.now,
    source_state: advanced ? 'current' : 'upstream_quiet',
    updated_at: input.now,
    ...(advanced ? { last_data_advance: input.now } : {}),
  };
}
