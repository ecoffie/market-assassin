/**
 * The repair ledger is TWO sources, read together everywhere:
 *   - docs/REPAIR-LEDGER.md        — the frozen ARCHIVE (rows up to 2026-11-22; never rewritten)
 *   - docs/repair-ledger/*.md      — one file per entry: <YYYY-MM-DD>-<pr-or-slug>.md
 *
 * One file per entry means two PRs never edit the same lines, so ledger rows stop conflicting.
 * Every reader (audit-repair-ledger.mjs, audit-ledger-coverage.mjs, render-repair-ledger.mjs) goes
 * through readLedger() so no reader can silently skip a source.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const ARCHIVE = 'docs/REPAIR-LEDGER.md';
export const ENTRY_DIR = 'docs/repair-ledger';
export const ENTRY_NAME_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9._-]*\.md$/;

/** Repo-relative paths of entry files (README excluded), oldest → newest by name. */
export function ledgerEntryFiles(root) {
  const dir = join(root, ENTRY_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((f) => `${ENTRY_DIR}/${f}`);
}

/** Is this repo-relative path part of the ledger (archive or an entry file)? */
export function isLedgerPath(p) {
  return p === ARCHIVE || (p.startsWith(`${ENTRY_DIR}/`) && p.endsWith('.md') && !/\/readme\.md$/i.test(p));
}

/**
 * { archive, entries: [{ path, name, md, validName }], sources: [{ path, md }] }
 * `sources` is archive first, then every entry, each read in full.
 */
export function readLedger(root) {
  const archive = readFileSync(join(root, ARCHIVE), 'utf8');
  const entries = ledgerEntryFiles(root).map((path) => {
    const name = path.slice(ENTRY_DIR.length + 1);
    return { path, name, md: readFileSync(join(root, path), 'utf8'), validName: ENTRY_NAME_RE.test(name) };
  });
  return { archive, entries, sources: [{ path: ARCHIVE, md: archive }, ...entries.map((e) => ({ path: e.path, md: e.md }))] };
}
