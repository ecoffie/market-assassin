/**
 * FIND replay gate: every changed horizon between two snapshots must be explained, or this exits 1.
 *
 *   npx tsx scripts/mcp-find-replay-diff.ts old.json new.json --classification <file.json> [--md] [--template <out.json>]
 *
 * Inputs are snapshots from scripts/mcp-find-replay.ts. The classification is written for THIS comparison
 * (fixture → horizon → { cls, why, before, after }) and explains a change only when its before → after
 * signatures (status, matched_count, top-N id hash, evidence hash) match the observed ones exactly. No file means
 * every change is unexplained. A fixture in only one snapshot fails. Logic: src/lib/discovery/replay-diff.ts.
 * --template writes a skeleton for the unexplained changes (signatures filled; cls/why left for the reviewer).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { diffReplaySnapshots, classificationTemplate, type ReplayClassification } from '../src/lib/discovery/replay-diff';

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('--') && !['--classification', '--template'].includes(args[i - 1] ?? ''));
const [oldPath, newPath] = positional;
if (!oldPath || !newPath) { console.error('Usage: mcp-find-replay-diff.ts old.json new.json --classification <file> [--md] [--template <out>]'); process.exit(2); }
const md = args.includes('--md');
const clsPath = flag('classification');
const classification: ReplayClassification = clsPath ? JSON.parse(readFileSync(clsPath, 'utf8')) : {};
if (!clsPath) console.error('No --classification file: every change counts as unexplained.');

const result = diffReplaySnapshots(JSON.parse(readFileSync(oldPath, 'utf8')), JSON.parse(readFileSync(newPath, 'utf8')), classification);
const sig = (s: { status: string | null; matched_count: number | null; top: string } | null) => (s ? `${s.status}/${s.matched_count} top:${s.top}` : '—');
if (md) {
  console.log('| fixture | horizon | verdict | before → after | evidence |');
  console.log('|---|---|---|---|---|');
}
for (const c of result.changes) {
  const line = [c.fixture, c.horizon ?? '(fixture)', c.verdict === 'explained' ? c.cls : `**${c.verdict.toUpperCase()}**`, `${sig(c.before)} → ${sig(c.after)}`, c.why];
  console.log(md ? `| ${line.join(' | ')} |` : line.join('  ·  '));
}
const tpl = flag('template');
if (tpl) { writeFileSync(tpl, JSON.stringify(classificationTemplate(result), null, 2)); console.error(`Template for unexplained changes: ${tpl}`); }
console.error(`\nfixtures ${result.fixtures} · changed horizons ${result.changes.length} · unexplained ${result.unexplained} · unexpected regressions ${result.regressions}`);
process.exit(result.pass ? 0 : 1);
