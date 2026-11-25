/**
 * The SAM entity extract importer's --dry mode (Agent 4, 2026-11-25): Eric decides the real November refresh only after
 * seeing a dry run, so the dry path must write NOTHING: no GCS archive, no sam_entities upsert, no checkpoint, no
 * dead-letter file. It still probes existence (read-only) so would-update vs would-insert is real.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'scripts', 'import-sam-entity-extract.mjs'), 'utf8');

describe('import-sam-entity-extract --dry', () => {
  it('a dry run never archives (archiveOrRefuse is only called on the non-dry branch)', () => {
    expect(src).toMatch(/const archive = DRY\s*\n\s*\? \{ key: '\(dry run: not archived\)'/);
    expect(src).toMatch(/: await archiveOrRefuse\(ZIP_PATH\);/);
  });
  it('a dry batch returns BEFORE the upsert and the checkpoint write', () => {
    const dryAt = src.indexOf('if (DRY) {\n      // Same accounting');
    const upsertAt = src.indexOf(".upsert(rows, { onConflict: 'uei'");
    const ckptAt = src.indexOf('writeFileSync(CKPT');
    expect(dryAt).toBeGreaterThan(0);
    expect(dryAt).toBeLessThan(upsertAt);
    expect(dryAt).toBeLessThan(ckptAt);
    expect(src.slice(dryAt, upsertAt)).toMatch(/batch = \[\];\s*\n\s*return;/);
  });
  it('the pre-existence probe (read-only) still runs, so the split is measured', () => {
    const probeAt = src.indexOf(".from('sam_entities').select('uei').in('uei', ueis)");
    expect(probeAt).toBeGreaterThan(0);
    expect(probeAt).toBeLessThan(src.indexOf('if (DRY) {\n      // Same accounting'));
  });
  it('--resume is ignored on a dry run, and the report labels would-update / would-insert + sample rows', () => {
    expect(src).toMatch(/const RESUME = process\.argv\.includes\('--resume'\) && !DRY;/);
    expect(src).toMatch(/would update/);
    expect(src).toMatch(/SAMPLE ROWS/);
  });
});
