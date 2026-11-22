/**
 * Private inputs for /api/admin/classify-customers-v2.
 *
 * The route's named customer lists and its rollback SQL output are private operational data: they
 * are read from the environment / a path outside the repository at run time and are never committed.
 * When any required input is missing the route refuses before reading or writing anything, rather
 * than running with empty lists (which would silently change how accounts are classified).
 *
 * Each list env var is a comma- or whitespace-separated list of emails (normalised to lower case).
 */
export const CLASSIFY_V2_LIST_ENV = {
  expectedInnerCircle: 'CLASSIFY_V2_INNER_CIRCLE_EMAILS',
  internalTeam: 'CLASSIFY_V2_INTERNAL_TEAM_EMAILS',
  compTestimonial: 'CLASSIFY_V2_COMP_TESTIMONIAL_EMAILS',
  spotChecks: 'CLASSIFY_V2_SPOT_CHECK_EMAILS',
} as const;

/** Absolute path, outside the repository, where execute mode writes its rollback SQL. */
export const CLASSIFY_V2_ROLLBACK_PATH_ENV = 'CLASSIFY_V2_ROLLBACK_PATH';

export type ClassifyV2ListKey = keyof typeof CLASSIFY_V2_LIST_ENV;

export interface ClassifyV2Lists {
  expectedInnerCircle: string[];
  internalTeam: Set<string>;
  compTestimonial: Set<string>;
  spotChecks: string[];
}

export const EMPTY_CLASSIFY_V2_LISTS: ClassifyV2Lists = {
  expectedInnerCircle: [],
  internalTeam: new Set(),
  compTestimonial: new Set(),
  spotChecks: [],
};

export type ClassifyV2Inputs =
  | { ok: true; lists: ClassifyV2Lists; rollbackPath: string | null }
  | { ok: false; missing: string[] };

function parseList(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  return Array.from(new Set(raw.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'))));
}

export function getClassifyV2PrivateInputs(
  env: Record<string, string | undefined>,
  mode: 'preview' | 'execute',
  cwd: string = process.cwd(),
): ClassifyV2Inputs {
  const missing: string[] = [];
  const read = (key: ClassifyV2ListKey) => {
    const v = parseList(env[CLASSIFY_V2_LIST_ENV[key]]);
    if (!v) missing.push(CLASSIFY_V2_LIST_ENV[key]);
    return v ?? [];
  };
  const lists: ClassifyV2Lists = {
    expectedInnerCircle: read('expectedInnerCircle'),
    internalTeam: new Set(read('internalTeam')),
    compTestimonial: new Set(read('compTestimonial')),
    spotChecks: read('spotChecks'),
  };
  let rollbackPath: string | null = null;
  if (mode === 'execute') {
    const p = (env[CLASSIFY_V2_ROLLBACK_PATH_ENV] || '').trim();
    // Must be absolute and outside the working tree, so the rollback file can never be committed.
    const cwdPrefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
    if (!p || !p.startsWith('/') || p === cwd || p.startsWith(cwdPrefix)) missing.push(CLASSIFY_V2_ROLLBACK_PATH_ENV);
    else rollbackPath = p;
  }
  return missing.length ? { ok: false, missing } : { ok: true, lists, rollbackPath };
}
