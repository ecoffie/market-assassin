/**
 * Pure helpers for scripts/import-sam-entity-extract.mjs (no env, no network — unit-tested).
 *
 * 1. resolveExtractFileName: the provenance label (naics_sb_source, sam_source_snapshot) must name the file
 *    actually imported. With --file the name comes from the file's basename; SAM_EXTRACT_FILE (the download name)
 *    must agree with it or the run refuses (Agent 4, 2026-11-25: the November dry run was stamped with the May name).
 * 2. findDatEntry: SAM wrapped the November 2026 extract in a SECOND zip. Open nested single-zip archives (bounded
 *    to 2 levels) until a .dat is found; fail loudly when none is, never read a zip as text.
 */
import { basename } from 'node:path';

export const DEFAULT_EXTRACT_FILENAME = 'SAM_PUBLIC_MONTHLY_V2_20260503.ZIP';

export function resolveExtractFileName({ fileArg, envName }) {
  const env = (envName || '').trim();
  if (fileArg) {
    const base = basename(fileArg);
    if (env && env.toUpperCase() !== base.toUpperCase()) {
      throw new Error(`SAM_EXTRACT_FILE (${env}) disagrees with the --file basename (${base}); refusing to stamp the wrong source.`);
    }
    return base;
  }
  return env || DEFAULT_EXTRACT_FILENAME;
}

/**
 * @param directory  an unzipper directory ({ files: [{ path, type, buffer() }] })
 * @param openBuffer (buf) => Promise<directory>   — unzipper.Open.buffer
 * @param depth      nesting levels still allowed
 * @returns { entry, nesting } — the .dat entry and how many zip layers were opened to reach it
 */
export async function findDatEntry(directory, openBuffer, depth = 2, nesting = 0) {
  const files = (directory.files || []).filter((f) => f.type !== 'Directory');
  const dat = files.find((f) => /\.dat$/i.test(f.path));
  if (dat) return { entry: dat, nesting };
  const zips = files.filter((f) => /\.zip$/i.test(f.path));
  if (zips.length === 1 && depth > 0) {
    const inner = await openBuffer(await zips[0].buffer());
    return findDatEntry(inner, openBuffer, depth - 1, nesting + 1);
  }
  const listing = files.map((f) => f.path).slice(0, 10).join(', ') || '(empty)';
  throw new Error(zips.length > 1
    ? `extract holds ${zips.length} zip files and no .dat — refusing to guess which to import (${listing})`
    : depth <= 0 && zips.length === 1
      ? `extract is nested more than 2 zip levels deep with no .dat — refusing (${listing})`
      : `no .dat file in the extract (${listing}) — not a SAM entity extract?`);
}
