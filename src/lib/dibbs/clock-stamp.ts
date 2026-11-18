/**
 * DIBBS control-plane clock stamp.
 *
 * A failed stamp is logged and never changes the job outcome. recordsLanded is 0
 * for a confirmed empty window even if a stray row was touched.
 *
 * supabase-js returns `{ error }` and does not throw. A thrown catch is not
 * enough: a rejected update must not be reported as a nonempty ingest.
 */
import { buildCollectionClockPatch, type CollectionClockPatch } from '@/lib/data-core/collection-clocks';

type ClockError = { message: string } | null;

type DibbsClockDb = {
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): {
        maybeSingle(): PromiseLike<{
          data: { last_verified_ingest?: string | null } | null;
          error: ClockError;
        }>;
      };
    };
    update(values: Record<string, string | null>): {
      eq(col: string, value: string): PromiseLike<{ error: ClockError }>;
    };
  };
};

export async function stampDibbsClocks(
  supabase: unknown,
  input: { upstreamReadable: boolean; recordsReceived: number; recordsLanded: number },
): Promise<{ patch: CollectionClockPatch; priorVerifiedIngest: string | null } | null> {
  const db = supabase as DibbsClockDb;
  const attemptedAt = new Date().toISOString();
  try {
    const read = await db
      .from('data_source_instances')
      .select('last_verified_ingest')
      .eq('source_key', 'dibbs_dla_flat_files')
      .maybeSingle();
    if (read.error) {
      console.error('[sync-dibbs] clock read failed:', read.error.message);
      return null;
    }
    const priorVerifiedIngest = (read.data?.last_verified_ingest as string | null) ?? null;
    const patch = buildCollectionClockPatch({
      attemptedAt,
      upstreamReadable: input.upstreamReadable,
      recordsReceived: input.recordsReceived,
      recordsLanded: input.recordsLanded,
      priorVerifiedIngest,
      cadenceHours: 24,
      now: attemptedAt,
    });
    const written = await db.from('data_source_instances').update({
      ...patch.clocks,
      updated_at: attemptedAt,
    }).eq('source_key', 'dibbs_dla_flat_files');
    if (written.error) {
      console.error('[sync-dibbs] clock write failed:', written.error.message);
      return null;
    }
    return { patch, priorVerifiedIngest };
  } catch (e) {
    console.error('[sync-dibbs] clock stamp failed:', (e as Error).message);
    return null;
  }
}

export function freshnessBody(
  stamped: { patch: CollectionClockPatch; priorVerifiedIngest: string | null } | null,
  recordsReceived: number,
) {
  const patch = stamped?.patch ?? null;
  return {
    lastAttempted: patch?.clocks.last_poll ?? null,
    lastSuccessfulCollection: patch?.clocks.last_successful_check ?? null,
    lastNonemptyIngest: patch?.advancedNonemptyIngest
      ? (patch.clocks.last_verified_ingest ?? null)
      : (stamped?.priorVerifiedIngest ?? null),
    recordsReceived,
    sourceState: patch?.sourceState ?? null,
    nonemptyIngestAdvanced: patch?.advancedNonemptyIngest ?? false,
  };
}
