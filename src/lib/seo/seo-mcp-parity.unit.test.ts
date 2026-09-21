/**
 * Parity between the MCP/domain contractor layer and the public SEO surface.
 *
 * These tests encode the architecture decision, not just the code:
 *
 *   There is ONE contractor resolver. The MCP tools and the public SEO page
 *   both call it. They differ only in whether a cold BigQuery read is allowed.
 *   Every divergence is therefore a CACHE boundary issue, and the fix belongs
 *   at that boundary — never in a second slug-resolution implementation.
 *
 * Each test below exists because the corresponding mistake was actually made
 * (2026-09-21) or is one step away.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const recipients = read('src/lib/bigquery/recipients.ts');
const seoPage = read('src/app/contractors/[slug]/page.tsx');
const nameResolution = read('src/lib/contractor/name-resolution.ts');
const sitemap = read('src/app/sitemap.ts');
const warmer = read('scripts/warm-contractor-slugs.ts');
const robots = read('src/app/robots.ts');

describe('one source of contractor truth', () => {
  it('the MCP path and the SEO page resolve through the SAME function', () => {
    // MCP tools (get_contractor_profile / get_contractor_award_history)
    expect(nameResolution).toContain('getRollupOrSingleBySlug');
    expect(nameResolution).toContain("from '@/lib/bigquery/recipients'");
    // Public SEO page
    expect(seoPage).toContain('getRollupOrSingleBySlug');
    expect(seoPage).toContain("from '@/lib/bigquery/recipients'");
  });

  it('the single-slug reader and the batch warmer share ONE canonical-slug query', () => {
    // A forked copy of this SQL silently dropped the norm_match arm and left 49
    // URLs 404, general-dynamics-corporation among them.
    expect(recipients).toContain('export const CANONICAL_SLUG_SQL');
    const uses = recipients.split('CANONICAL_SLUG_SQL').length - 1;
    expect(uses).toBeGreaterThanOrEqual(3); // declaration + single + batch
    expect(recipients).toContain('resolveCanonicalSlugsBatch');
  });

  it('the canonical-slug query keeps all three resolution arms', () => {
    for (const arm of ['direct AS', 'child_match AS', 'norm_match AS']) {
      expect(recipients).toContain(arm);
    }
  });

  it('the single-slug and batch profile readers share ONE rollup query', () => {
    expect(recipients).toContain('export const ROLLUP_BY_SLUG_SQL');
    expect(recipients).toContain('getRollupsBySlugBatch');
    const uses = recipients.split('ROLLUP_BY_SLUG_SQL').length - 1;
    expect(uses).toBeGreaterThanOrEqual(3);
  });

  it('the warmer carries no SQL of its own', () => {
    // It must import the shared constants, never inline a SELECT.
    expect(warmer).toContain('ROLLUP_BY_SLUG_SQL');
    expect(warmer).toContain('CANONICAL_SLUG_SQL');
    expect(warmer).not.toMatch(/\bFROM\s+\$\{BQ_TABLES/);
  });
});

describe('Googlebot must never reach live BigQuery', () => {
  it('the SEO kill switch stays OFF by default', () => {
    const liveBq = read('src/lib/seo/live-bq.ts');
    expect(liveBq).toContain("v === '1'");
    // No default-true anywhere in the gate.
    expect(liveBq).not.toMatch(/return\s+true\s*;/);
  });

  it('sitemap generation is cache-only — it cannot cold-scan', () => {
    // Scope tightly to the sitemap query's own options object. A wider window
    // runs into getSimilarRecipients, which is an AUTHED path and is allowed
    // its cold read — the first version of this test failed on exactly that.
    const start = recipients.indexOf('cacheKey: `sitemap:top-recipients');
    expect(start).toBeGreaterThan(-1);
    const raw = recipients.slice(start, recipients.indexOf('});', start));
    // Strip // comments first: the block explains what the setting USED to be,
    // and the words in that explanation are not the setting.
    const block = raw.replace(/^\s*\/\/.*$/gm, '');
    expect(block).toContain('cacheOnly: true');
    expect(block).not.toContain('cacheOnly: false');
  });

  it('a public cache miss records the slug instead of querying', () => {
    expect(seoPage).toContain('recordWarmMiss');
    const missBlock = seoPage.slice(seoPage.indexOf('recordWarmMiss('));
    // The miss path ends in notFound(), not in a live query.
    expect(missBlock.slice(0, 200)).toContain('notFound()');
  });

  it('PIID vanity URLs stay blocked in robots.txt', () => {
    // The #1 query class by impressions and the worst by conversion:
    // 13,976 impressions → 32 clicks over six months, 28 of them branded.
    expect(robots).toContain("'/contracts/'");
  });
});

describe('the sitemap advertises only what the renderer can serve', () => {
  it('gates every contractor entry on verified cache presence', () => {
    expect(sitemap).toContain('getServeableSlugs');
    expect(sitemap).toContain('serveable.has(slug)');
  });

  it('the serveable check reads KV only, never BigQuery', () => {
    const served = read('src/lib/seo/served-slugs.ts');
    expect(served).toContain('kv.mget');
    expect(served).not.toContain('bqQuery');
    expect(served).not.toContain('BQ_TABLES');
  });

  it('the serveable check fails closed on a KV error', () => {
    const served = read('src/lib/seo/served-slugs.ts');
    const slice = served.slice(served.indexOf('catch (err)'));
    // On error we omit the batch; we must not add slugs optimistically.
    expect(slice).toContain('omitting this batch');
  });
});

describe('the warmer is bounded', () => {
  it('declares every required limit', () => {
    const limits = read('src/lib/seo/warm-limits.ts');
    for (const k of [
      'maxRecordsPerRun',
      'maxBytesPerScan',
      'maxBytesPerRun',
      'dailyScanBudgetBytes',
      'maxRuntimeMs',
      'kvWriteConcurrency',
      'maxRetriesPerScan',
    ]) {
      expect(limits).toContain(k);
    }
  });

  it('defaults to a dry run — executing requires an explicit --go', () => {
    expect(warmer).toContain("argv.includes('--go')");
    expect(warmer).toContain('Re-run with --go to warm');
  });

  it('dry-runs each batch for an estimate before executing it', () => {
    expect(warmer).toContain('bqDryRun');
    expect(warmer).toContain('stopReason(budget, est.bytesProcessed)');
  });

  it('passes a hard maximumBytesBilled into every batch query', () => {
    expect(warmer).toContain('String(L.maxBytesPerScan)');
    // The batch APIs REQUIRE the ceiling — it is not an optional argument.
    expect(recipients).toContain('maximumBytesBilled: string');
  });

  it('treats an unreadable daily budget as exhausted (fails closed)', () => {
    expect(warmer).toContain('Number.MAX_SAFE_INTEGER');
  });
});
