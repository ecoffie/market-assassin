/**
 * SAM extract importer inputs (Agent 4, from Claude Local's November dry run, 2026-11-25):
 *  1. SAM wrapped the November extract in a SECOND zip — the importer must open it, never read a zip as text.
 *  2. The provenance label must name the imported file, not the May default.
 * Real zips built with jszip and opened with the importer's own unzipper.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import unzipper from 'unzipper';
// @ts-expect-error — plain .mjs helper, no types
import { findDatEntry, resolveExtractFileName, DEFAULT_EXTRACT_FILENAME } from '../../../scripts/lib/sam-extract-input.mjs';

const LINE = 'UEI123456789|x|y|CAGE1|' + '|'.repeat(40);
async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const z = new JSZip();
  for (const [name, body] of Object.entries(files)) z.file(name, body);
  return z.generateAsync({ type: 'nodebuffer' });
}
const open = (buf: Buffer) => unzipper.Open.buffer(buf);
async function readFirstLine(entry: { stream: () => NodeJS.ReadableStream }): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of entry.stream()) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString('utf8').split('\n')[0];
}

describe('findDatEntry', () => {
  it('a plain extract: the .dat at the top level', async () => {
    const { entry, nesting } = await findDatEntry(await open(await zipOf({ 'SAM_PUBLIC_MONTHLY_V2_20261101.dat': LINE })), open);
    expect(entry.path).toMatch(/\.dat$/);
    expect(nesting).toBe(0);
    expect(await readFirstLine(entry)).toBe(LINE);
  });
  it('the November shape: a zip inside the zip is opened and its .dat read (not the inner zip as text)', async () => {
    const inner = await zipOf({ 'SAM_PUBLIC_MONTHLY_V2_20261101.dat': LINE });
    const outer = await zipOf({ 'SAM_PUBLIC_MONTHLY_V2_20261101.ZIP': inner });
    const { entry, nesting } = await findDatEntry(await open(outer), open);
    expect(nesting).toBe(1);
    expect(await readFirstLine(entry)).toBe(LINE);
  });
  it('nesting is bounded to 2 levels', async () => {
    const l0 = await zipOf({ 'x.dat': LINE });
    const l1 = await zipOf({ 'a.zip': l0 });
    const l2 = await zipOf({ 'b.zip': l1 });
    expect((await findDatEntry(await open(l2), open)).nesting).toBe(2);
    const l3 = await zipOf({ 'c.zip': l2 });
    await expect(findDatEntry(await open(l3), open)).rejects.toThrow(/more than 2 zip levels/);
  });
  it('no .dat → fails loudly; several zips → refuses to guess', async () => {
    await expect(findDatEntry(await open(await zipOf({ 'readme.txt': 'hi' })), open)).rejects.toThrow(/no \.dat file/);
    const z = await zipOf({ 'a.zip': await zipOf({ 'a.dat': LINE }), 'b.zip': await zipOf({ 'b.dat': LINE }) });
    await expect(findDatEntry(await open(z), open)).rejects.toThrow(/refusing to guess/);
  });
});

describe('resolveExtractFileName', () => {
  it('--file decides the label (basename), matching SAM_EXTRACT_FILE is fine', () => {
    expect(resolveExtractFileName({ fileArg: '/tmp/sam/SAM_PUBLIC_MONTHLY_V2_20261101.ZIP', envName: '' })).toBe('SAM_PUBLIC_MONTHLY_V2_20261101.ZIP');
    expect(resolveExtractFileName({ fileArg: '/tmp/sam/SAM_PUBLIC_MONTHLY_V2_20261101.ZIP', envName: 'SAM_PUBLIC_MONTHLY_V2_20261101.ZIP' })).toBe('SAM_PUBLIC_MONTHLY_V2_20261101.ZIP');
  });
  it('a disagreeing SAM_EXTRACT_FILE refuses (never stamps the wrong source)', () => {
    expect(() => resolveExtractFileName({ fileArg: '/tmp/sam/SAM_PUBLIC_MONTHLY_V2_20261101.ZIP', envName: 'SAM_PUBLIC_MONTHLY_V2_20260503.ZIP' })).toThrow(/disagrees/);
  });
  it('no --file: SAM_EXTRACT_FILE, else the documented default', () => {
    expect(resolveExtractFileName({ fileArg: null, envName: 'SAM_PUBLIC_MONTHLY_V2_20261101.ZIP' })).toBe('SAM_PUBLIC_MONTHLY_V2_20261101.ZIP');
    expect(resolveExtractFileName({ fileArg: null, envName: '' })).toBe(DEFAULT_EXTRACT_FILENAME);
  });
});
