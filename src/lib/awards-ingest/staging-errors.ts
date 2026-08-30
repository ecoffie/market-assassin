/** Sanitized staging failures — basename only, no full paths or row payloads. */

export type StagingLoadErrorCode =
  | 'staging_plan_empty'
  | 'staging_header_invalid'
  | 'staging_header_read_truncated'
  | 'staging_conflicting_header'
  | 'staging_unrecognized_lead'
  | 'staging_bq_load_failed';

export class StagingLoadError extends Error {
  readonly code: StagingLoadErrorCode;
  readonly memberBasename: string;

  constructor(
    code: StagingLoadErrorCode,
    memberBasename: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StagingLoadError';
    this.code = code;
    this.memberBasename = memberBasename;
  }
}

export function formatStagingLoadFailure(error: unknown): string {
  if (error instanceof StagingLoadError) {
    return `failed_staging_load: ${error.code} member=${error.memberBasename} — ${error.message}`;
  }
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : '';
    const detail = cause ? `: ${sanitizeSnippet(cause)}` : '';
    return `failed_staging_load: staging_bq_load_failed — ${sanitizeSnippet(error.message)}${detail}`;
  }
  return 'failed_staging_load: staging_bq_load_failed — unknown error';
}

function sanitizeSnippet(text: string): string {
  return text
    .replace(/\/(?:Users|home)\/[^\s]+/g, '<path>')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
}

export function stagingLoadErrorFromUnknown(
  code: StagingLoadErrorCode,
  memberBasename: string,
  error: unknown,
): StagingLoadError {
  const detail = error instanceof Error ? sanitizeSnippet(error.message) : 'unknown';
  return new StagingLoadError(code, memberBasename, detail, { cause: error });
}
