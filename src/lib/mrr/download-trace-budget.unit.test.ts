import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const DOWNLOAD = join(ROOT, 'src/app/api/app/market-research/download/route.ts');
const READ = join(ROOT, 'src/lib/mrr/run-store-read.ts');
const NFT = join(
  ROOT,
  '.next/server/app/api/app/market-research/download/route.js.nft.json',
);
const BUDGET_BYTES = 200 * 1024 * 1024;

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('download function import graph', () => {
  it('imports only the lightweight reader, auth, and constants', () => {
    const download = src('src/app/api/app/market-research/download/route.ts');
    expect(download).toMatch(/from ['"]@\/lib\/mrr\/run-store-read['"]/);
    expect(download).toMatch(/from ['"]@\/lib\/mrr\/workspace-constants['"]/);
    expect(download).toMatch(/from ['"]@\/lib\/two-factor-session['"]/);
    expect(download).not.toMatch(/from ['"]@\/lib\/mrr\/run-store['"]/);
    expect(download).not.toMatch(/from ['"][^'"]*(run-phase1|docx-fill|assemble|review-from-evidence|bigquery|tool-registry|mindy-client|normalizer)['"]/);
    expect(download).toMatch(/readBoundArtifactFile/);
    expect(download).not.toMatch(/readFileSync\(artifact\.path\)/);
  });

  it('reader does not import generation, MCP, or BigQuery', () => {
    const reader = src('src/lib/mrr/run-store-read.ts');
    expect(reader).not.toMatch(/from ['"][^'"]*(run-phase1|docx-fill|assemble|appendix|bigquery|tool-registry|mindy-client)['"]/);
    expect(reader).not.toMatch(/runMcpTool|bqQuery/);
    expect(reader).toMatch(/join\(process\.cwd\(\), 'out', 'mrr-workspace'/);
    expect(reader).toMatch(/turbopackIgnore: true/);
  });
});

describe('download function NFT budget', () => {
  it('stays under 200 MB with no project-tree or pdfjs over-include when the trace is current', () => {
    if (!existsSync(NFT)) return;
    const nftStat = statSync(NFT);
    const sourceMtime = Math.max(statSync(DOWNLOAD).mtimeMs, statSync(READ).mtimeMs);
    if (nftStat.mtimeMs < sourceMtime) return;

    const data = JSON.parse(readFileSync(NFT, 'utf8')) as { files: string[] };
    const nftDir = dirname(NFT);
    let total = 0;
    const hits: string[] = [];
    for (const rel of data.files) {
      const abs = join(nftDir, rel);
      if (!existsSync(abs)) continue;
      total += statSync(abs).size;
      const normalized = abs.replace(/\\/g, '/');
      if (
        /\/presentations\//.test(normalized) ||
        /\/node_modules\/pdfjs-dist\//.test(normalized) ||
        /\/node_modules\/@sparticuz\/chromium\//.test(normalized) ||
        /\/node_modules\/puppeteer-core\//.test(normalized)
      ) {
        hits.push(normalized);
      }
    }
    expect(hits).toEqual([]);
    expect(total).toBeLessThan(BUDGET_BYTES);
  });
});
