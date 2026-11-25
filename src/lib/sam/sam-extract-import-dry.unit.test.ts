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
    const probeAt = src.indexOf(".from('sam_entities').select(['uei', ...PRESERVE_IF_BLANK].join(', ')).in('uei', ueis)");
    expect(probeAt).toBeGreaterThan(0);
    expect(probeAt).toBeLessThan(src.indexOf('if (DRY) {\n      // Same accounting'));
  });
  it('--resume is ignored on a dry run, and the report labels would-update / would-insert + sample rows', () => {
    expect(src).toMatch(/const RESUME = process\.argv\.includes\('--resume'\) && !DRY;/);
    expect(src).toMatch(/would update/);
    expect(src).toMatch(/SAMPLE ROWS/);
  });
});

describe('null-safety: a blank extract field never erases another writer\'s value (Agent 4, 2026-11-25)', () => {
  it('the payload never carries columns the extract does not hold (entity_url, POCs, cert records, PSC, exclusion, raw)', () => {
    const parse = src.slice(src.indexOf('function parseRecord'), src.indexOf('async function downloadIfNeeded'));
    for (const col of ['entity_url', 'points_of_contact', 'certification_records', 'psc_codes', 'exclusion_flag', 'raw_data', 'duns']) {
      expect(parse, col).not.toMatch(new RegExp(`\\b${col}\\s*:`));
    }
  });
  it('every blank-able payload column is in PRESERVE_IF_BLANK and is read back by the probe', () => {
    for (const col of ['cage_code', 'dba_name', 'physical_city', 'physical_state', 'physical_zip', 'physical_country', 'primary_naics', 'registration_status', 'registration_expiry']) {
      expect(src.slice(src.indexOf('const PRESERVE_IF_BLANK'), src.indexOf('];', src.indexOf('const PRESERVE_IF_BLANK')))).toContain(`'${col}'`);
    }
    expect(src).toMatch(/select\(\['uei', \.\.\.PRESERVE_IF_BLANK\]\.join\(', '\)\)/);
  });
  it('a blank (null, or registration_status Unknown) keeps the existing value and is counted', () => {
    expect(src).toMatch(/col === 'registration_status' \? \(r\[col\] == null \|\| r\[col\] === 'Unknown'\) : r\[col\] == null/);
    expect(src).toMatch(/r\[col\] = ex\[col\];\s*\n\s*preservedByCol\[col\]/);
  });
  it('a failed probe writes NOTHING for that batch (never a blind overwrite)', () => {
    const probeFail = src.slice(src.indexOf('if (exErr) {'), src.indexOf('preExisting = new Set((existing'));
    expect(probeFail).toMatch(/batch NOT written/);
    expect(probeFail).toMatch(/return;/);
  });
  it('the report prints NULL-SAFETY counts and the exact payload column set', () => {
    expect(src).toMatch(/NULL-SAFETY \(existing value kept/);
    expect(src).toMatch(/payload columns {7}\$\{PAYLOAD_COLUMNS/);
  });
});

describe('the SAM key never reaches a log (monthly GitHub Action prints this output)', () => {
  const dl = src.slice(src.indexOf('async function downloadIfNeeded'), src.indexOf('function redactSecrets'));
  it('the download URL is never logged; failures report status / error code only', () => {
    expect(dl).not.toMatch(/console\.\w+\([^)]*\burl\b/);
    expect(dl).toMatch(/download failed: HTTP \$\{r\.statusCode\}/);
    expect(dl).toMatch(/download failed: \$\{e\.code \|\| 'network error'\}/);
  });
  it('the fatal handler redacts api_key values and the raw key', () => {
    expect(src).toMatch(/main\(\)\.catch\(e => \{ console\.error\('FATAL', redactSecrets\(/);
    expect(src).toMatch(/replace\(\/api_key=\[\^&\\s"'\]\+\/gi, 'api_key=\*\*\*'\)/);
  });
});
