export interface AwardsIngestClocks {
  sourceActionMax: string;
  acquiredAt: string;
  mergedAt: string;
  recipientsRebuiltAt: string;
}

export type AwardsIngestPipelineStatus =
  | 'success'
  | 'empty_acquisition'
  | 'failed_pipeline'
  | 'failed_recipients_rebuild';

export type AwardsFreshness =
  | { status: 'healthy'; sourceAgeDays: number; runAgeDays: number }
  | { status: 'upstream_stale'; sourceAgeDays: number; runAgeDays: number }
  | { status: 'ingest_broken'; sourceAgeDays: number | null; runAgeDays: number | null }
  | { status: 'unmeasured'; sourceAgeDays: null; runAgeDays: null };

export const AWARDS_INGEST_STALE_DAYS = 10;
const BLOCK_START = '[awards-ingest-clocks:v1]';
const BLOCK_END = '[/awards-ingest-clocks]';
const BLOCK_PATTERN = /\n?\[awards-ingest-clocks:v1\]\n([\s\S]*?)\n\[\/awards-ingest-clocks\]\n?/;

function isClocks(value: unknown): value is AwardsIngestClocks {
  if (!value || typeof value !== 'object') return false;
  if (!('sourceActionMax' in value) || !('acquiredAt' in value)
    || !('mergedAt' in value) || !('recipientsRebuiltAt' in value)) return false;
  return typeof value.sourceActionMax === 'string'
    && typeof value.acquiredAt === 'string'
    && typeof value.mergedAt === 'string'
    && typeof value.recipientsRebuiltAt === 'string'
    && Number.isFinite(Date.parse(value.sourceActionMax))
    && Number.isFinite(Date.parse(value.acquiredAt))
    && Number.isFinite(Date.parse(value.mergedAt))
    && Number.isFinite(Date.parse(value.recipientsRebuiltAt));
}

export function encodeAwardsIngestClocks(notes: string | null, clocks: AwardsIngestClocks): string {
  const humanNotes = (notes ?? '').replace(BLOCK_PATTERN, '\n').trim();
  const block = `${BLOCK_START}\n${JSON.stringify(clocks)}\n${BLOCK_END}`;
  return humanNotes ? `${humanNotes}\n\n${block}` : block;
}

export function decodeAwardsIngestClocks(notes: string | null | undefined): AwardsIngestClocks | null {
  const match = notes?.match(BLOCK_PATTERN);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return isClocks(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ageDays(value: string, nowMs: number): number | null {
  const valueMs = Date.parse(value);
  if (!Number.isFinite(valueMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - valueMs) / 86_400_000));
}

export function classifyFreshness(input: {
  clocks: AwardsIngestClocks | null;
  now?: string;
  pipelineStatus?: AwardsIngestPipelineStatus;
}): AwardsFreshness {
  if (input.pipelineStatus && input.pipelineStatus !== 'success') {
    return { status: 'ingest_broken', sourceAgeDays: null, runAgeDays: null };
  }
  if (!input.clocks) {
    return { status: 'unmeasured', sourceAgeDays: null, runAgeDays: null };
  }

  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const sourceAgeDays = ageDays(input.clocks.sourceActionMax, nowMs);
  const acquiredAgeDays = ageDays(input.clocks.acquiredAt, nowMs);
  const mergedAgeDays = ageDays(input.clocks.mergedAt, nowMs);
  const rebuiltAgeDays = ageDays(input.clocks.recipientsRebuiltAt, nowMs);
  if (sourceAgeDays === null || acquiredAgeDays === null
    || mergedAgeDays === null || rebuiltAgeDays === null) {
    return { status: 'unmeasured', sourceAgeDays: null, runAgeDays: null };
  }

  const runAgeDays = Math.max(acquiredAgeDays, mergedAgeDays, rebuiltAgeDays);
  if (runAgeDays > AWARDS_INGEST_STALE_DAYS) {
    return { status: 'ingest_broken', sourceAgeDays, runAgeDays };
  }
  if (sourceAgeDays > AWARDS_INGEST_STALE_DAYS) {
    return { status: 'upstream_stale', sourceAgeDays, runAgeDays };
  }
  return { status: 'healthy', sourceAgeDays, runAgeDays };
}
